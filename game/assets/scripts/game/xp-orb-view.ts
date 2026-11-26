/**
 * Standalone pooled world renderer for M12 XP crystal orbs (`small` / `medium` / `large`).
 *
 * - Pre-allocates `XP_ORB_POOL_SIZE` (128) sprite nodes up front — **zero `new` per drop or frame**.
 * - Loads each tier sheet through `loadPixelTexture` (`NEAREST` min/mag filtering) and sets
 *   `Sprite.SizeMode.CUSTOM` + exact `UITransform.setContentSize(width, height)` so sprites never
 *   default to Cocos's 100×100 box.
 * - Uses crisp diamond crystal silhouettes (`fx.xp-orb-small`, `fx.xp-orb-medium`, `fx.xp-orb-large`)
 *   distinct from both round enemy bullets (ADR-016) and warm-gold coins, scaled cleanly off
 *   `ACTOR_SCALE` (`10/16`, `13/16`, and exact `1:1` `16/16` texels) with subtle idle bob and
 *   area-preserving magnetic vacuum stretch.
 * - Re-exports `spawnLevelUpBurst` from `./fx/effect-pool` so Wave 2 (`xp-flow`) has one cohesive
 *   import surface for XP orbs + level-up / resume-knockback radial burst FX.
 */
import {
  Color as CocosColor,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import { frameRect, resolve } from '../core/art/manifest';
import { loadAnimationManifest } from './anim/sprite-animator';
import { loadPixelTexture } from './assets/texture-cache';
import { ACTOR_SCALE, sliceFrame, tileToWorld } from './level-view';

export {
  DEFAULT_LEVEL_UP_DURATION_MS,
  DEFAULT_LEVEL_UP_RADIUS_TILES,
  spawnLevelUpBurst,
  type FxShockwaveOptions,
  type LevelUpBurstOptions,
} from './fx/effect-pool';

type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;
type SpriteFrame = ReturnType<typeof sliceFrame>;

export type XpOrbTier = 'small' | 'medium' | 'large';

/** Plain visual snapshot consumed by `XpOrbView.sync` (room tile coordinates, top-left y-down). */
export interface XpOrbVisual {
  readonly x: number;
  readonly y: number;
  readonly tier: XpOrbTier;
  readonly vacuuming: boolean;
}

export const XP_ORB_POOL_SIZE = 128;

export const XP_ORB_TIERS: readonly XpOrbTier[] = ['small', 'medium', 'large'];

export const XP_ORB_MANIFEST_KEYS: Readonly<Record<XpOrbTier, string>> = {
  small: 'fx.xp-orb-small',
  medium: 'fx.xp-orb-medium',
  large: 'fx.xp-orb-large',
};

/** Sheet paths relative to `game/assets/` for chapter preload lists. */
export const XP_ORB_SHEETS: readonly string[] = [
  'resources/art/fx/xp-orb/xp-orb-small.png',
  'resources/art/fx/xp-orb/xp-orb-medium.png',
  'resources/art/fx/xp-orb/xp-orb-large.png',
];

/**
 * Tier scale factors relative to `ACTOR_SCALE` (`1/16` world unit per texture pixel).
 * `large` renders at exact 1:1 `ACTOR_SCALE` (16 px = 1.0 tile); `medium` = 13 px; `small` = 10 px.
 */
export const XP_ORB_TIER_PIXEL_RATIO: Readonly<Record<XpOrbTier, number>> = {
  small: 10 / 16,
  medium: 13 / 16,
  large: 1,
};

const BOB_AMPLITUDE_TILES = 0.05;
const BOB_SPEED_RAD_PER_SEC = 3.8;
const BOB_PHASE_STEP = 0.9;

/** Area-preserving stretch (`0.9 * 1.12 = 1.008 ≈ 1.0`) when pulled by magnet / room-clear vacuum. */
const VACUUM_SCALE_X = 0.9;
const VACUUM_SCALE_Y = 1.12;

const IDLE_TINTS: Readonly<Record<XpOrbTier, Color>> = {
  small: new CocosColor(245, 252, 255, 245),
  medium: new CocosColor(250, 245, 255, 250),
  large: new CocosColor(255, 250, 252, 255),
};

const VACUUM_TINTS: Readonly<Record<XpOrbTier, Color>> = {
  small: new CocosColor(255, 255, 255, 255),
  medium: new CocosColor(255, 255, 255, 255),
  large: new CocosColor(255, 255, 255, 255),
};

export interface XpOrbTransform {
  readonly bobOffsetTiles: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

/** Pure visual transform per orb slot — zero engine state, directly unit-testable. */
export function xpOrbTransform(
  orb: XpOrbVisual,
  slotIndex: number,
  elapsedSec: number,
): XpOrbTransform {
  const safeSec = Number.isFinite(elapsedSec) ? Math.max(0, elapsedSec) : 0;
  const baseScale = ACTOR_SCALE * XP_ORB_TIER_PIXEL_RATIO[orb.tier];
  if (orb.vacuuming) {
    return {
      bobOffsetTiles: 0,
      scaleX: baseScale * VACUUM_SCALE_X,
      scaleY: baseScale * VACUUM_SCALE_Y,
    };
  }
  return {
    bobOffsetTiles:
      Math.sin(safeSec * BOB_SPEED_RAD_PER_SEC + slotIndex * BOB_PHASE_STEP) * BOB_AMPLITUDE_TILES,
    scaleX: baseScale,
    scaleY: baseScale,
  };
}

interface TierFrameData {
  readonly frame: SpriteFrame;
  readonly width: number;
  readonly height: number;
}

interface OrbSlot {
  readonly node: Node;
  readonly sprite: Sprite;
  readonly transform: UITransform | null;
  lastTier: XpOrbTier | null;
  lastVacuuming: boolean | null;
}

export class XpOrbView {
  private readonly maxSlots: number;
  private readonly slots: OrbSlot[] = [];
  private readonly tierFrames = new Map<XpOrbTier, TierFrameData>();
  private container: Node | null = null;
  private activeSlots = 0;
  /** Reused mutable tile point passed to `tileToWorld` so `sync` creates no input object per orb. */
  private readonly scratchTile = { x: 0, y: 0 };

  constructor(capacity = XP_ORB_POOL_SIZE) {
    this.maxSlots = Math.max(1, Math.floor(capacity));
  }

  get capacity(): number {
    return this.maxSlots;
  }

  get activeCount(): number {
    return this.activeSlots;
  }

  /** Slice nearest-filtered tier frames and pre-allocate every pooled orb node under `parent`. */
  async init(parent: Node): Promise<void> {
    const manifest = await loadAnimationManifest();
    await Promise.all(
      XP_ORB_TIERS.map(async (tier) => {
        const entry = resolve(manifest, XP_ORB_MANIFEST_KEYS[tier]);
        const texture = await loadPixelTexture(entry.sheet);
        const rect = frameRect(entry, 'down', 0);
        this.tierFrames.set(tier, {
          frame: sliceFrame(texture, rect),
          width: rect.width,
          height: rect.height,
        });
      }),
    );

    const container = new CocosNode('xp-orbs');
    container.parent = parent;
    this.container = container;

    const defaultFrame = this.tierFrames.get('small');
    const fallbackWidth = defaultFrame?.width ?? 16;
    const fallbackHeight = defaultFrame?.height ?? 16;

    for (let index = 0; index < this.maxSlots; index += 1) {
      this.slots.push(this.createSlot(container, index, fallbackWidth, fallbackHeight));
    }
    this.activeSlots = 0;
  }

  /**
   * Synchronise pooled sprite nodes with active XP orbs.
   * Zero `new` allocations: extra orbs past `capacity` are silently skipped rather than growing nodes.
   */
  sync(orbs: readonly XpOrbVisual[], elapsedSec: number): void {
    if (this.slots.length === 0) return;

    const drawn = Math.min(orbs.length, this.slots.length);
    for (let index = 0; index < drawn; index += 1) {
      const orb = orbs[index];
      const slot = this.slots[index];
      if (orb === undefined || slot === undefined || !slot.node.isValid) continue;

      const data = this.tierFrames.get(orb.tier);
      if (data === undefined) continue;

      if (slot.lastTier !== orb.tier || slot.lastVacuuming !== orb.vacuuming) {
        if (slot.lastTier !== orb.tier) {
          slot.sprite.spriteFrame = data.frame;
          if (slot.transform !== null) {
            slot.transform.setContentSize(data.width, data.height);
          }
          slot.lastTier = orb.tier;
        }
        slot.sprite.color = orb.vacuuming ? VACUUM_TINTS[orb.tier] : IDLE_TINTS[orb.tier];
        slot.lastVacuuming = orb.vacuuming;
      }

      const motion = xpOrbTransform(orb, index, elapsedSec);
      this.scratchTile.x = orb.x;
      this.scratchTile.y = orb.y;
      const world = tileToWorld(this.scratchTile);

      slot.node.setPosition(world.x, world.y + motion.bobOffsetTiles, 0);
      slot.node.setScale(motion.scaleX, motion.scaleY, 1);
      if (!slot.node.active) slot.node.active = true;
    }

    for (let index = drawn; index < this.activeSlots; index += 1) {
      const slot = this.slots[index];
      if (slot !== undefined && slot.node.isValid) {
        slot.node.active = false;
      }
    }
    this.activeSlots = drawn;
  }

  /** Hide every active orb node immediately (e.g. on room transition). */
  clear(): void {
    for (let index = 0; index < this.activeSlots; index += 1) {
      const slot = this.slots[index];
      if (slot !== undefined && slot.node.isValid) {
        slot.node.active = false;
      }
    }
    this.activeSlots = 0;
  }

  /** Destroy all pooled nodes and release cached tier frames. */
  destroy(): void {
    for (const slot of this.slots) {
      if (slot.node.isValid) slot.node.destroy();
    }
    if (this.container !== null && this.container.isValid) {
      this.container.destroy();
    }
    this.container = null;
    this.slots.length = 0;
    this.tierFrames.clear();
    this.activeSlots = 0;
  }

  private createSlot(parent: Node, index: number, width: number, height: number): OrbSlot {
    const node = new CocosNode(`xp-orb-${index}`);
    node.parent = parent;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.type = CocosSprite.Type.SIMPLE;
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setContentSize(width, height);
    }

    node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);
    node.active = false;
    return {
      node,
      sprite,
      transform,
      lastTier: null,
      lastVacuuming: null,
    };
  }
}

/** Convenience factory matching `createFxPool(parent)`. */
export async function createXpOrbView(
  parent: Node,
  capacity = XP_ORB_POOL_SIZE,
): Promise<XpOrbView> {
  const view = new XpOrbView(capacity);
  await view.init(parent);
  return view;
}
