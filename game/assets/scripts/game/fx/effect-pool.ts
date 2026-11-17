/**
 * Pool FX dùng chung cho mọi hiệu ứng manifest `fx.*` (impact, explosion, smoke,
 * shield, ice, poison, gold sparkle).
 *
 * Mỗi slot là một node + `Sprite`, dựng **một lần** khi vào chapter. Frame được
 * slice sẵn từ `animations.json` lúc init, và cả pool chỉ có **một** clock chung —
 * không có một component `update`/một promise load frame cho mỗi sprite nữa (bản
 * đầu dùng `SpriteAnimator`, đo stress bị tụt fps).
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

/** Key FX có trong manifest (xem `REQUIRED_ACTOR_ANIMATIONS.fx`). */
export type FxKey =
  | 'fx.impact'
  | 'fx.explosion'
  | 'fx.smoke'
  | 'fx.shield'
  | 'fx.ice'
  | 'fx.poison';

interface FxStyle {
  /** Bề rộng mong muốn trong world unit (1 tile = 1 unit) khi không truyền drawUnits. */
  readonly drawUnits: number;
  /** Tự tắt sau bao lâu; clip loop (shield) cần giá trị này. */
  readonly lifetimeMs: number;
  /** Frame gốc px (max cạnh) để tính scale từ drawUnits. */
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
  /** Bề rộng world unit; mặc định theo loại FX. */
  readonly drawUnits?: number;
  /** Màu nhân (gold sparkle, tint theo status…). */
  readonly tint?: Color;
  readonly lifetimeMs?: number;
}

export class FxPool {
  private readonly slots: Slot[] = [];
  private readonly framesByKey = new Map<FxKey, { frames: readonly SpriteFrame[]; fps: number }>();
  private elapsedMs = 0;

  /** Khởi tạo pool dưới `parent`; slice sẵn frame từ manifest. */
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

  /** Phát FX tại `position` (tile unit, y hướng xuống). */
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
      // `sizeMode = CUSTOM` lấy kích thước từ UITransform; spawn ghi đè theo frame.
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

/** Dựng pool dưới `parent` (nên là layer FX trên actor) — bootstrap await một lần. */
export async function createFxPool(parent: Node): Promise<FxPool> {
  const pool = new FxPool();
  await pool.init(parent);
  return pool;
}
