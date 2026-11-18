/**
 * Shared FX pool for every `fx.*` manifest effect (impact, explosion, smoke,
 * shield, ice, poison, gold sparkle, weapon VFX).
 *
 * Each slot is a node + `Sprite`, built **once** on entering a chapter. Frames are
 * sliced from `animations.json` at init, and the whole pool shares **one** clock —
 * there is no `update` component or frame-loading promise per sprite any more (the first
 * version used `SpriteAnimator` and the stress test lost fps).
 *
 * Three things beyond one-shot sprites live here, each with its own pre-built nodes:
 * - the **aura** ring at the player's feet (`setAura`, loops while visible, follows the player);
 * - short **tracer lines** for Ricochet (`line`, `Graphics`, not a sprite);
 * - **flying particles** for Lifesteal (`spawn` with `to`/`travelMs` moves the slot).
 */
import {
  Color as CocosColor,
  Graphics as CocosGraphics,
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
type Graphics = InstanceType<typeof CocosGraphics>;
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
  | 'fx.poison'
  | 'fx.spark'
  | 'fx.cut'
  | 'fx.slash-arc'
  | 'fx.boost'
  | 'fx.smoke-circular'
  | 'fx.aura'
  | 'fx.bubble';

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
  // Ticket #3. `fx.aura` has no lifetime: it is driven by `setAura`, not by `spawn`.
  'fx.spark': { drawUnits: 0.5, lifetimeMs: 240, frameMaxPx: 10 },
  'fx.cut': { drawUnits: 1.1, lifetimeMs: 260, frameMaxPx: 32 },
  'fx.slash-arc': { drawUnits: 1.8, lifetimeMs: 380, frameMaxPx: 38 },
  'fx.boost': { drawUnits: 2.4, lifetimeMs: 850, frameMaxPx: 53 },
  'fx.smoke-circular': { drawUnits: 2.0, lifetimeMs: 900, frameMaxPx: 15 },
  'fx.aura': { drawUnits: 2.2, lifetimeMs: 0, frameMaxPx: 25 },
  'fx.bubble': { drawUnits: 0.5, lifetimeMs: 420, frameMaxPx: 16 },
};

const POOL_SIZE = 40;
const LINE_SLOTS = 8;
const LINE_LIFETIME_MS = 170;
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
  /** Optional travel (`to`/`travelMs`): the ghost flies from spawn to `to` instead of staying put. */
  move: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    durationMs: number;
    elapsedMs: number;
  } | null;
}

interface LineSlot {
  readonly node: Node;
  readonly graphics: Graphics;
  remainingMs: number;
  active: boolean;
}

export interface FxSpawnOptions {
  /** Width in world units; defaults per FX type. */
  readonly drawUnits?: number;
  /** Multiply colour (gold sparkle, status tint…). */
  readonly tint?: Color;
  readonly lifetimeMs?: number;
  /** Fly from the spawn point to this tile position (Lifesteal particles). */
  readonly to?: Vec2;
  /** Travel time when `to` is set, ms. */
  readonly travelMs?: number;
}

export class FxPool {
  private readonly slots: Slot[] = [];
  private readonly lineSlots: LineSlot[] = [];
  private readonly framesByKey = new Map<FxKey, { frames: readonly SpriteFrame[]; fps: number }>();
  private elapsedMs = 0;

  /** One dedicated looping aura ring; `null` position = hidden. */
  private auraNode: Node | null = null;
  private auraSprite: Sprite | null = null;
  private auraFrames: readonly SpriteFrame[] = [];
  private auraFps = 10;
  private auraFrameIndex = 0;
  private auraElapsedMs = 0;
  private auraActive = false;
  private readonly auraTint = new CocosColor(255, 255, 255, 255);

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
    for (let index = 0; index < LINE_SLOTS; index += 1) {
      this.lineSlots.push(this.createLineSlot(parent, index));
    }

    const aura = this.framesByKey.get('fx.aura');
    if (aura !== undefined) {
      this.auraFrames = aura.frames;
      this.auraFps = aura.fps;
    }
    this.auraNode = this.createSpriteSlot(parent, 'fx-aura', NO_TINT).node;
    this.auraSprite = this.auraNode.getComponent(CocosSprite);
    this.auraNode.active = false;
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
    const frame = data.frames[0]!;
    slot.sprite.spriteFrame = frame;
    // `sizeMode = CUSTOM` takes its size from UITransform — a fixed 32 box makes a 10 px spark
    // and a 53 px boost draw at different scales. Set the real frame size once per spawn.
    const transform = slot.node.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setContentSize(frame.rect.width, frame.rect.height);
    }

    const to = options.to;
    if (to !== undefined) {
      const target = tileToWorld(to);
      slot.move = {
        fromX: world.x,
        fromY: world.y,
        toX: target.x,
        toY: target.y,
        durationMs: Math.max(1, options.travelMs ?? 220),
        elapsedMs: 0,
      };
    } else {
      slot.move = null;
    }

    const tint = options.tint ?? NO_TINT;
    slot.tint.r = tint.r;
    slot.tint.g = tint.g;
    slot.tint.b = tint.b;
    slot.tint.a = tint.a;
    slot.sprite.color = slot.tint;
  }

  /**
   * Show/hide the aura ring at the player's feet. `position` is in tile units; `null` hides it.
   * The ring loops while visible and is tinted by the loadout's strongest element.
   */
  setAura(position: Vec2 | null, tint: Color | null, drawUnits?: number): void {
    const node = this.auraNode;
    const sprite = this.auraSprite;
    if (node === null || sprite === null || this.auraFrames.length === 0) return;

    if (position === null) {
      if (this.auraActive) node.active = false;
      this.auraActive = false;
      return;
    }

    const world = tileToWorld(position);
    const units = drawUnits ?? STYLES['fx.aura'].drawUnits;
    const scale = units / STYLES['fx.aura'].frameMaxPx;
    if (!this.auraActive) {
      this.auraActive = true;
      this.auraElapsedMs = 0;
      this.auraFrameIndex = 0;
      node.active = true;
      const first = this.auraFrames[0]!;
      sprite.spriteFrame = first;
      const transform = node.getComponent(CocosUITransform);
      if (transform !== null) transform.setContentSize(first.rect.width, first.rect.height);
    }
    node.setPosition(world.x, world.y, 0);
    node.setScale(scale, scale, 1);

    const colour = tint ?? NO_TINT;
    this.auraTint.r = colour.r;
    this.auraTint.g = colour.g;
    this.auraTint.b = colour.b;
    this.auraTint.a = colour.a;
    sprite.color = this.auraTint;
  }

  get auraVisible(): boolean {
    return this.auraActive;
  }

  /** Short straight tracer (Ricochet); both ends are tile positions, y down. */
  line(from: Vec2, to: Vec2, tint: Color, lifetimeMs = LINE_LIFETIME_MS): void {
    const slot = this.lineSlots.find((candidate) => !candidate.active) ?? this.lineSlots[0];
    if (slot === undefined) return;

    const a = tileToWorld(from);
    const b = tileToWorld(to);
    const graphics = slot.graphics;
    graphics.clear();
    // World units (1 tile = 1): a visible hairline, not a 2-tile bar.
    graphics.lineWidth = 0.08;
    graphics.strokeColor = tint;
    graphics.moveTo(a.x, a.y);
    graphics.lineTo(b.x, b.y);
    graphics.stroke();

    slot.active = true;
    slot.remainingMs = Math.max(1, lifetimeMs);
    slot.node.active = true;
  }

  update(deltaMs: number): void {
    this.elapsedMs += Math.max(0, deltaMs);
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.remainingMs -= deltaMs;
      if (slot.remainingMs <= 0) {
        slot.active = false;
        slot.node.active = false;
        slot.move = null;
        continue;
      }

      if (slot.move !== null) {
        slot.move.elapsedMs += deltaMs;
        const t = Math.min(1, slot.move.elapsedMs / slot.move.durationMs);
        slot.node.setPosition(
          slot.move.fromX + (slot.move.toX - slot.move.fromX) * t,
          slot.move.fromY + (slot.move.toY - slot.move.fromY) * t,
          0,
        );
      }

      const index = Math.floor((this.elapsedMs * slot.fps) / 1000) % slot.frames.length;
      if (index !== slot.frameIndex) {
        slot.frameIndex = index;
        const frame = slot.frames[index];
        if (frame !== undefined) slot.sprite.spriteFrame = frame;
      }
    }

    for (const slot of this.lineSlots) {
      if (!slot.active) continue;
      slot.remainingMs -= deltaMs;
      if (slot.remainingMs <= 0) {
        slot.active = false;
        slot.graphics.clear();
        slot.node.active = false;
      }
    }

    if (this.auraActive && this.auraFrames.length > 1) {
      this.auraElapsedMs += Math.max(0, deltaMs);
      const index =
        Math.floor((this.auraElapsedMs * this.auraFps) / 1000) % this.auraFrames.length;
      if (index !== this.auraFrameIndex) {
        this.auraFrameIndex = index;
        const frame = this.auraFrames[index];
        if (frame !== undefined && this.auraSprite !== null) {
          this.auraSprite.spriteFrame = frame;
        }
      }
    }
  }

  destroy(): void {
    for (const slot of this.slots) {
      if (slot.node.isValid) slot.node.destroy();
    }
    for (const slot of this.lineSlots) {
      if (slot.node.isValid) slot.node.destroy();
    }
    if (this.auraNode !== null && this.auraNode.isValid) this.auraNode.destroy();
    this.auraNode = null;
    this.auraSprite = null;
    this.auraFrames = [];
    this.auraActive = false;
    this.slots.length = 0;
    this.lineSlots.length = 0;
    this.framesByKey.clear();
  }

  private createSlot(parent: Node, index: number): Slot {
    const tint = new CocosColor(255, 255, 255, 255);
    const { node, sprite } = this.createSpriteSlot(parent, `fx-${index}`, tint);
    return {
      node,
      sprite,
      frames: [],
      fps: 10,
      frameIndex: 0,
      remainingMs: 0,
      active: false,
      tint,
      move: null,
    };
  }

  private createSpriteSlot(parent: Node, name: string, tint: Color): { node: Node; sprite: Sprite } {
    const node = new CocosNode(name);
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
    sprite.color = tint;
    return { node, sprite };
  }

  private createLineSlot(parent: Node, index: number): LineSlot {
    const node = new CocosNode(`fx-line-${index}`);
    node.parent = parent;
    const graphics: Graphics = node.addComponent(CocosGraphics);
    node.active = false;
    return { node, graphics, remainingMs: 0, active: false };
  }
}

/** Build the pool under `parent` (should be the FX layer above actors) — bootstrap awaits it once. */
export async function createFxPool(parent: Node): Promise<FxPool> {
  const pool = new FxPool();
  await pool.init(parent);
  return pool;
}
