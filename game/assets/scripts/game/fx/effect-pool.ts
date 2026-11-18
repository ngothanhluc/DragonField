/**
 * Shared FX pool for every `fx.*` manifest effect (impact, explosion, smoke,
 * shield, ice, poison, gold sparkle).
 *
 * Each slot is a node + `Sprite`, built **once** on entering a chapter. Frames are
 * sliced from `animations.json` at init, and the whole pool shares **one** clock —
 * there is no `update` component or frame-loading promise per sprite any more (the first
 * version used `SpriteAnimator` and the stress test lost fps).
 */
import {
  Color as CocosColor,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import { resolve } from '../../core/art/manifest';
import type { Vec2 } from '../../core/math/vec2';
import { getFrame } from '../assets/sprite-frame-cache';
import { loadAnimationManifest } from '../anim/sprite-animator';
import { tileToWorld } from '../level-view';

type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;
type SpriteFrame = Awaited<ReturnType<typeof getFrame>>;

/** FX keys present in the manifest (see `REQUIRED_ACTOR_ANIMATIONS.fx`). */
export type FxKey =
  | 'fx.impact'
  | 'fx.explosion'
  | 'fx.smoke'
  | 'fx.shield'
  | 'fx.ice'
  | 'fx.poison';

interface FxStyle {
  /** Target width in world units (1 tile = 1 unit) when drawUnits is not passed. */
  readonly drawUnits: number;
  /** How long before it turns itself off; looping clips (shield) need this. */
  readonly lifetimeMs: number;
  /** Source frame px (longest side) used to derive scale from drawUnits. */
  readonly frameMaxPx: number;
}

const STYLES: Readonly<Record<FxKey, FxStyle>> = {
  'fx.impact': { drawUnits: 1.6, lifetimeMs: 320, frameMaxPx: 45 },
  'fx.explosion': { drawUnits: 2.6, lifetimeMs: 900, frameMaxPx: 40 },
  'fx.smoke': { drawUnits: 1.8, lifetimeMs: 700, frameMaxPx: 32 },
  'fx.shield': { drawUnits: 2.2, lifetimeMs: 450, frameMaxPx: 26 },
  'fx.ice': { drawUnits: 1.5, lifetimeMs: 500, frameMaxPx: 40 },
  'fx.poison': { drawUnits: 1.5, lifetimeMs: 500, frameMaxPx: 40 },
};

const POOL_SIZE = 32;
const NO_TINT = new CocosColor(255, 255, 255, 255);

interface Slot {
  readonly node: Node;
  readonly sprite: Sprite;
  frames: readonly SpriteFrame[];
  fps: number;
  frameIndex: number;
  remainingMs: number;
  active: boolean;
  readonly tint: Color;
}

export interface FxSpawnOptions {
  /** Width in world units; defaults per FX type. */
  readonly drawUnits?: number;
  /** Multiply colour (gold sparkle, status tint…). */
  readonly tint?: Color;
  readonly lifetimeMs?: number;
}

export class FxPool {
  private readonly slots: Slot[] = [];
  private readonly framesByKey = new Map<FxKey, { frames: readonly SpriteFrame[]; fps: number }>();
  private elapsedMs = 0;

  /** Initialise the pool under `parent`; slice frames from the manifest up front. */
  async init(parent: Node): Promise<void> {
    const manifest = await loadAnimationManifest();
    for (const key of Object.keys(STYLES) as FxKey[]) {
      const entry = resolve(manifest, key);
      const frames = await Promise.all(
        Array.from({ length: entry.frames }, (_, index) => getFrame(entry, 'down', index)),
      );
      this.framesByKey.set(key, { frames, fps: entry.fps });
    }

    for (let index = 0; index < POOL_SIZE; index += 1) {
      this.slots.push(this.createSlot(parent, index));
    }
  }

  /** Play an FX at `position` (tile units, y down). */
  spawn(key: FxKey, position: Vec2, options: FxSpawnOptions = {}): void {
    const data = this.framesByKey.get(key);
    if (data === undefined || data.frames.length === 0) return;
    const slot = this.slots.find((candidate) => !candidate.active) ?? this.slots[0];
    if (slot === undefined) return;

    const style = STYLES[key];
    const drawUnits = options.drawUnits ?? style.drawUnits;
    const scale = drawUnits / style.frameMaxPx;
    const world = tileToWorld(position);

    slot.active = true;
    slot.frames = data.frames;
    slot.fps = data.fps;
    slot.frameIndex = 0;
    slot.remainingMs = options.lifetimeMs ?? style.lifetimeMs;
    slot.node.active = true;
    slot.node.setPosition(world.x, world.y, 0);
    slot.node.setScale(scale, scale, 1);
    slot.sprite.spriteFrame = data.frames[0]!;

    const tint = options.tint ?? NO_TINT;
    slot.tint.r = tint.r;
    slot.tint.g = tint.g;
    slot.tint.b = tint.b;
    slot.tint.a = tint.a;
    slot.sprite.color = slot.tint;
  }

  update(deltaMs: number): void {
    this.elapsedMs += Math.max(0, deltaMs);
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.remainingMs -= deltaMs;
      if (slot.remainingMs <= 0) {
        slot.active = false;
        slot.node.active = false;
        continue;
      }

      const index = Math.floor((this.elapsedMs * slot.fps) / 1000) % slot.frames.length;
      if (index !== slot.frameIndex) {
        slot.frameIndex = index;
        const frame = slot.frames[index];
        if (frame !== undefined) slot.sprite.spriteFrame = frame;
      }
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      if (slot.node.isValid) slot.node.destroy();
    }
    this.slots.length = 0;
    this.framesByKey.clear();
  }

  private createSlot(parent: Node, index: number): Slot {
    const node = new CocosNode(`fx-${index}`);
    node.parent = parent;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) {
      // `sizeMode = CUSTOM` takes its size from UITransform; spawn overrides it per frame.
      transform.setContentSize(32, 32);
    }

    node.active = false;

    return {
      node,
      sprite,
      frames: [],
      fps: 10,
      frameIndex: 0,
      remainingMs: 0,
      active: false,
      tint: new CocosColor(255, 255, 255, 255),
    };
  }
}

/** Build the pool under `parent` (should be the FX layer above actors) — bootstrap awaits it once. */
export async function createFxPool(parent: Node): Promise<FxPool> {
  const pool = new FxPool();
  await pool.init(parent);
  return pool;
}
