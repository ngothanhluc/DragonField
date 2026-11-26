/**
 * Pooled world renderer for M17 Gold Coins & Health Potions (*Bình Hồi Máu*).
 *
 * - Pre-allocates every slot up front (zero runtime `new` per kill/frame).
 * - Gold Coin (`6.5 px` = `6.5/16` tiles): warm gold pulsing pixel halo + sparkle twinkle.
 * - Health Potion (`8.5 px` = `8.5/16` tiles using staged `fx.health-potion`): pulsing emerald/ruby
 *   halo that makes rare recovery drops immediately legible on every biome floor.
 * - Respects `Effects: Reduced` (static soft ring, zero bob/sparkle) and mounts strictly below
 *   actors, bullets, and telegraphs.
 */
import {
  Color as CocosColor,
  Graphics as CocosGraphics,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import { frameRect, resolve } from '../core/art/manifest';
import type { EffectsMode } from '../core/vfx/weapon-vfx';
import type { WorldPickup, WorldPickupKind } from '../core/xp/pickups';
import { loadAnimationManifest } from './anim/sprite-animator';
import { loadPixelTexture } from './assets/texture-cache';
import { ACTOR_SCALE, sliceFrame, tileToWorld } from './level-view';

type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;
type SpriteFrame = ReturnType<typeof sliceFrame>;

export const GOLD_COIN_PICKUP_SHEET = 'resources/art/ui/coin/GoldCoin.png';
export const HEALTH_POTION_MANIFEST_KEY = 'fx.health-potion';
export const HEALTH_POTION_PICKUP_SHEET = 'resources/art/generated/fx/health-potion.png';

/** Sheets to include in chapter preload lists so pickups never pop in. */
export const WORLD_PICKUP_SHEETS: readonly string[] = [
  GOLD_COIN_PICKUP_SHEET,
  HEALTH_POTION_PICKUP_SHEET,
];

/** Compact world display sizes (in source pixels at 16 px = 1 tile): 6.5 px coin, 8.5 px potion. */
export const PICKUP_DISPLAY_PX: Readonly<Record<WorldPickupKind, number>> = {
  gold: 6.5,
  'health-potion': 8.5,
};

const GOLD_HALO_COLOR = new CocosColor(255, 214, 72, 115);
const GOLD_SPARKLE_COLOR = new CocosColor(255, 250, 200, 220);
const POTION_HALO_COLOR = new CocosColor(72, 232, 148, 130);
const POTION_SPARKLE_COLOR = new CocosColor(255, 118, 138, 220);

const BOB_AMPLITUDE_TILES = 0.045;
const BOB_SPEED_RAD = 4.2;
const HALO_PULSE_SPEED = 4.8;
const VACUUM_SCALE_X = 0.9;
const VACUUM_SCALE_Y = 1.12;

interface PickupFrameData {
  readonly frame: SpriteFrame;
  readonly width: number;
  readonly height: number;
}

interface PickupSlot {
  readonly node: Node;
  readonly haloNode: Node;
  readonly haloGraphics: Graphics;
  readonly sparkleNode: Node;
  readonly sparkleGraphics: Graphics;
  readonly sprite: Sprite;
  readonly transform: UITransform | null;
  lastKind: WorldPickupKind | null;
}

export class WorldPickupView {
  private readonly maxSlots: number;
  private readonly slots: PickupSlot[] = [];
  private readonly frames = new Map<WorldPickupKind, PickupFrameData>();
  private container: Node | null = null;
  private activeSlots = 0;
  private effectsMode: EffectsMode = 'full';
  private readonly scratchTile = { x: 0, y: 0 };

  constructor(capacity = 160) {
    this.maxSlots = Math.max(1, Math.floor(capacity));
  }

  get capacity(): number {
    return this.maxSlots;
  }

  get activeCount(): number {
    return this.activeSlots;
  }

  setEffectsMode(mode: EffectsMode): void {
    this.effectsMode = mode;
  }

  async init(parent: Node): Promise<void> {
    const manifest = await loadAnimationManifest();
    const potionEntry = resolve(manifest, HEALTH_POTION_MANIFEST_KEY);
    const [coinTex, potionTex] = await Promise.all([
      loadPixelTexture(GOLD_COIN_PICKUP_SHEET),
      loadPixelTexture(potionEntry.sheet),
    ]);

    const potionRect = frameRect(potionEntry, 'down', 0);
    this.frames.set('gold', {
      frame: sliceFrame(coinTex, { x: 0, y: 0, width: 7, height: 7 }),
      width: 7,
      height: 7,
    });
    this.frames.set('health-potion', {
      frame: sliceFrame(potionTex, potionRect),
      width: potionRect.width,
      height: potionRect.height,
    });

    const container = new CocosNode('world-pickups');
    container.parent = parent;
    this.container = container;

    for (let index = 0; index < this.maxSlots; index += 1) {
      this.slots.push(this.createSlot(container, index));
    }
    this.activeSlots = 0;
  }

  /** Synchronise pooled pickup sprites & halos with active `WorldPickup` items (zero allocations). */
  sync(pickups: readonly WorldPickup[], elapsedSec: number): void {
    if (this.slots.length === 0) return;

    const reduced = this.effectsMode === 'reduced';
    const safeSec = Number.isFinite(elapsedSec) ? Math.max(0, elapsedSec) : 0;
    const drawn = Math.min(pickups.length, this.slots.length);

    for (let index = 0; index < drawn; index += 1) {
      const item = pickups[index];
      const slot = this.slots[index];
      if (item === undefined || slot === undefined || !slot.node.isValid) continue;

      const data = this.frames.get(item.kind);
      if (data === undefined) continue;

      if (slot.lastKind !== item.kind) {
        slot.sprite.spriteFrame = data.frame;
        if (slot.transform !== null) {
          slot.transform.setContentSize(data.width, data.height);
        }
        const haloRadius = item.kind === 'health-potion' ? 11.5 : 6.5;
        drawHalo(
          slot.haloGraphics,
          item.kind === 'health-potion' ? POTION_HALO_COLOR : GOLD_HALO_COLOR,
          haloRadius,
        );
        drawSparkle(
          slot.sparkleGraphics,
          item.kind === 'health-potion' ? POTION_SPARKLE_COLOR : GOLD_SPARKLE_COLOR,
          item.kind === 'health-potion' ? 6 : 4,
        );
        slot.lastKind = item.kind;
      }

      const displayPx = PICKUP_DISPLAY_PX[item.kind];
      const baseScale = (displayPx / Math.max(1, data.width)) * ACTOR_SCALE;
      const vacuuming = item.phase === 'vacuum' || item.phase === 'magnet';
      const bobY =
        reduced || vacuuming
          ? 0
          : Math.sin(safeSec * BOB_SPEED_RAD + index * 1.15) * BOB_AMPLITUDE_TILES;

      this.scratchTile.x = item.position.x;
      this.scratchTile.y = item.position.y;
      const world = tileToWorld(this.scratchTile);

      slot.node.setPosition(world.x, world.y + bobY, 0);
      slot.node.setScale(
        vacuuming ? baseScale * VACUUM_SCALE_X : baseScale,
        vacuuming ? baseScale * VACUUM_SCALE_Y : baseScale,
        1,
      );

      const pulse = reduced
        ? 0.92
        : 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(safeSec * HALO_PULSE_SPEED + index * 0.9));
      slot.haloNode.setScale(pulse, pulse, 1);

      const showSparkle = !reduced && Math.sin(safeSec * 7.5 + index * 2.1) > 0.35;
      if (slot.sparkleNode.active !== showSparkle) {
        slot.sparkleNode.active = showSparkle;
      }

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

  clear(): void {
    for (let index = 0; index < this.activeSlots; index += 1) {
      const slot = this.slots[index];
      if (slot !== undefined && slot.node.isValid) {
        slot.node.active = false;
      }
    }
    this.activeSlots = 0;
  }

  destroy(): void {
    for (const slot of this.slots) {
      if (slot.node.isValid) slot.node.destroy();
    }
    if (this.container !== null && this.container.isValid) {
      this.container.destroy();
    }
    this.container = null;
    this.slots.length = 0;
    this.frames.clear();
    this.activeSlots = 0;
  }

  private createSlot(parent: Node, index: number): PickupSlot {
    const node = new CocosNode(`pickup-${index}`);
    node.parent = parent;

    const haloNode = new CocosNode('halo');
    haloNode.parent = node;
    const haloGraphics: Graphics = haloNode.addComponent(CocosGraphics);

    const spriteNode = new CocosNode('sprite');
    spriteNode.parent = node;
    const sprite: Sprite = spriteNode.addComponent(CocosSprite);
    sprite.type = CocosSprite.Type.SIMPLE;
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    const transform: UITransform | null = spriteNode.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setContentSize(16, 16);
    }

    const sparkleNode = new CocosNode('sparkle');
    sparkleNode.parent = node;
    sparkleNode.setPosition(3.5, 3.5, 0);
    const sparkleGraphics: Graphics = sparkleNode.addComponent(CocosGraphics);
    sparkleNode.active = false;

    node.active = false;
    return {
      node,
      haloNode,
      haloGraphics,
      sparkleNode,
      sparkleGraphics,
      sprite,
      transform,
      lastKind: null,
    };
  }
}

function drawHalo(graphics: Graphics, color: Color, radius: number): void {
  graphics.clear();
  graphics.fillColor = color;
  graphics.circle(0, 0, radius);
  graphics.fill();
}

function drawSparkle(graphics: Graphics, color: Color, size: number): void {
  graphics.clear();
  graphics.fillColor = color;
  graphics.rect(-size * 0.5, -0.75, size, 1.5);
  graphics.rect(-0.75, -size * 0.5, 1.5, size);
  graphics.fill();
}

export async function createWorldPickupView(
  parent: Node,
  capacity = 160,
): Promise<WorldPickupView> {
  const view = new WorldPickupView(capacity);
  await view.init(parent);
  return view;
}
