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
import { effectsLayers, type EffectsMode } from '../../core/vfx/weapon-vfx';
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
  'fx.impact': { drawUnits: 1.6, lifetimeMs: 420, frameMaxPx: 35 },
  'fx.explosion': { drawUnits: 2.6, lifetimeMs: 650, frameMaxPx: 40 },
  'fx.smoke': { drawUnits: 1.8, lifetimeMs: 620, frameMaxPx: 32 },
  'fx.shield': { drawUnits: 2.2, lifetimeMs: 450, frameMaxPx: 26 },
  'fx.ice': { drawUnits: 1.5, lifetimeMs: 630, frameMaxPx: 32 },
  'fx.poison': { drawUnits: 1.5, lifetimeMs: 580, frameMaxPx: 30 },
  // Ticket #3. `fx.aura` has no lifetime: it is driven by `setAura`, not by `spawn`.
  'fx.spark': { drawUnits: 0.5, lifetimeMs: 390, frameMaxPx: 10 },
  'fx.cut': { drawUnits: 1.1, lifetimeMs: 260, frameMaxPx: 32 },
  'fx.slash-arc': { drawUnits: 1.8, lifetimeMs: 350, frameMaxPx: 38 },
  'fx.boost': { drawUnits: 2.4, lifetimeMs: 820, frameMaxPx: 53 },
  'fx.smoke-circular': { drawUnits: 2.0, lifetimeMs: 580, frameMaxPx: 30 },
  'fx.aura': { drawUnits: 2.2, lifetimeMs: 0, frameMaxPx: 25 },
  'fx.bubble': { drawUnits: 0.5, lifetimeMs: 420, frameMaxPx: 16 },
};

const POOL_SIZE = 40;
const LINE_SLOTS = 8;
const RING_SLOTS = 4;
const LINE_LIFETIME_MS = 170;
const SHOCKWAVE_SEGMENTS = 28;
export const DEFAULT_LEVEL_UP_RADIUS_TILES = 3.6;
export const DEFAULT_LEVEL_UP_DURATION_MS = 380;
const LEVEL_UP_SPARK_RAYS = 8;

const NO_TINT = new CocosColor(255, 255, 255, 255);
const LEVEL_UP_BOOST_TINT = new CocosColor(255, 240, 170, 255);
const LEVEL_UP_RING_FULL_TINT = new CocosColor(255, 226, 120, 240);
const LEVEL_UP_RING_REDUCED_TINT = new CocosColor(255, 226, 120, 175);
const LEVEL_UP_INNER_RING_TINT = new CocosColor(143, 239, 241, 210);
const LEVEL_UP_SPARK_TINT = new CocosColor(255, 235, 130, 255);

const UNIT_CIRCLE_X: readonly number[] = Array.from({ length: SHOCKWAVE_SEGMENTS }, (_, i) =>
  Math.cos((i * Math.PI * 2) / SHOCKWAVE_SEGMENTS),
);
const UNIT_CIRCLE_Y: readonly number[] = Array.from({ length: SHOCKWAVE_SEGMENTS }, (_, i) =>
  Math.sin((i * Math.PI * 2) / SHOCKWAVE_SEGMENTS),
);

interface Slot {
  readonly node: Node;
  readonly sprite: Sprite;
  frames: readonly SpriteFrame[];
  fps: number;
  loop: boolean;
  elapsedMs: number;
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

interface ShockwaveSlot {
  readonly node: Node;
  readonly graphics: Graphics;
  readonly color: Color;
  baseAlpha: number;
  startRadius: number;
  endRadius: number;
  lineWidth: number;
  durationMs: number;
  elapsedMs: number;
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

export interface FxShockwaveOptions {
  readonly startRadiusTiles?: number;
  readonly endRadiusTiles?: number;
  readonly durationMs?: number;
  readonly lineWidth?: number;
  readonly tint?: Color;
}

export interface LevelUpBurstOptions {
  /** Outer radial knockback wave radius in world tiles (defaults to 3.6 tiles). */
  readonly radiusTiles?: number;
  /** Shockwave expansion duration in ms (defaults to 380 ms). */
  readonly durationMs?: number;
}

export class FxPool {
  private readonly slots: Slot[] = [];
  private readonly lineSlots: LineSlot[] = [];
  private readonly ringSlots: ShockwaveSlot[] = [];
  private readonly framesByKey = new Map<
    FxKey,
    { frames: readonly SpriteFrame[]; fps: number; loop: boolean }
  >();
  /** Round-robin cursor: picking a free slot must not scan from 0 on every spawn. */
  private slotCursor = 0;

  /** One dedicated looping aura ring; `null` position = hidden. */
  private auraNode: Node | null = null;
  private auraSprite: Sprite | null = null;
  private auraFrames: readonly SpriteFrame[] = [];
  private auraFps = 10;
  private auraFrameIndex = 0;
  private auraElapsedMs = 0;
  private auraActive = false;
  private readonly auraTint = new CocosColor(255, 255, 255, 255);
  private auraScale = Number.NaN;

  /** Initialise the pool under `parent`; slice frames from the manifest up front. */
  async init(parent: Node): Promise<void> {
    const manifest = await loadAnimationManifest();
    for (const key of Object.keys(STYLES) as FxKey[]) {
      const entry = resolve(manifest, key);
      const frames = await Promise.all(
        Array.from({ length: entry.frames }, (_, index) => getFrame(entry, 'down', index)),
      );
      this.framesByKey.set(key, { frames, fps: entry.fps, loop: entry.loop });
    }

    for (let index = 0; index < POOL_SIZE; index += 1) {
      this.slots.push(this.createSlot(parent, index));
    }
    for (let index = 0; index < LINE_SLOTS; index += 1) {
      this.lineSlots.push(this.createLineSlot(parent, index));
    }
    for (let index = 0; index < RING_SLOTS; index += 1) {
      this.ringSlots.push(this.createRingSlot(parent, index));
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
    const slot = this.takeSlot();
    if (slot === undefined) return;

    const style = STYLES[key];
    const drawUnits = options.drawUnits ?? style.drawUnits;
    const scale = drawUnits / style.frameMaxPx;
    const world = tileToWorld(position);

    slot.active = true;
    slot.frames = data.frames;
    slot.fps = data.fps;
    slot.loop = data.loop;
    slot.elapsedMs = 0;
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
    if (this.auraScale !== scale) {
      this.auraScale = scale;
      node.setScale(scale, scale, 1);
    }

    // Color is a material value: only write it when the element really changed (every frame
    // this method runs, the position changes but the colour almost never does).
    const colour = tint ?? NO_TINT;
    if (
      this.auraTint.r !== colour.r ||
      this.auraTint.g !== colour.g ||
      this.auraTint.b !== colour.b ||
      this.auraTint.a !== colour.a
    ) {
      this.auraTint.r = colour.r;
      this.auraTint.g = colour.g;
      this.auraTint.b = colour.b;
      this.auraTint.a = colour.a;
      sprite.color = this.auraTint;
    }
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

  /**
   * Expanding world-space shockwave ring centred on `position` (tile units, y down).
   * Drawn as a closed 28-segment polygon in world units so Cocos's pixel chord tessellation
   * never turns small world-unit radii into coarse polygons.
   */
  spawnShockwave(position: Vec2, options: FxShockwaveOptions = {}): void {
    const slot = this.takeRingSlot();
    if (slot === undefined) return;

    const world = tileToWorld(position);
    const startRadius = Math.max(0.05, options.startRadiusTiles ?? 0.45);
    const endRadius = Math.max(startRadius, options.endRadiusTiles ?? DEFAULT_LEVEL_UP_RADIUS_TILES);
    const durationMs = Math.max(40, options.durationMs ?? DEFAULT_LEVEL_UP_DURATION_MS);
    const lineWidth = Math.max(0.03, options.lineWidth ?? 0.09);
    const tint = options.tint ?? LEVEL_UP_RING_FULL_TINT;

    slot.color.r = tint.r;
    slot.color.g = tint.g;
    slot.color.b = tint.b;
    slot.color.a = tint.a;
    slot.baseAlpha = tint.a;
    slot.startRadius = startRadius;
    slot.endRadius = endRadius;
    slot.lineWidth = lineWidth;
    slot.durationMs = durationMs;
    slot.elapsedMs = 0;
    slot.active = true;
    slot.node.setPosition(world.x, world.y, 0);
    slot.node.active = true;
    this.drawRing(slot.graphics, startRadius, lineWidth, slot.color);
  }

  /**
   * Celebratory level-up & resume-knockback radial burst at `position` (tile units, y down).
   *
   * - Always plays `fx.boost` (`Magic/Boost`) + primary expanding shockwave ring so the player
   *   sees the radial knockback wave clearly in both `full` and `reduced` modes.
   * - Under `Effects: Full`, adds an inner spirit-cyan echo ring and radial `fx.spark` motes;
   *   under `Effects: Reduced`, drops all secondary rings/motes (`effectsLayers(mode)`).
   */
  spawnLevelUpBurst(
    position: Vec2,
    mode: EffectsMode = 'full',
    options: LevelUpBurstOptions = {},
  ): void {
    const layers = effectsLayers(mode);
    const radiusTiles = Math.max(0.8, options.radiusTiles ?? DEFAULT_LEVEL_UP_RADIUS_TILES);
    const durationMs = Math.max(80, options.durationMs ?? DEFAULT_LEVEL_UP_DURATION_MS);

    this.spawn('fx.boost', position, {
      drawUnits: 2.8,
      tint: LEVEL_UP_BOOST_TINT,
    });
    this.spawnShockwave(position, {
      startRadiusTiles: 0.45,
      endRadiusTiles: radiusTiles,
      durationMs,
      lineWidth: layers.secondaryParticles ? 0.1 : 0.08,
      tint: layers.secondaryParticles ? LEVEL_UP_RING_FULL_TINT : LEVEL_UP_RING_REDUCED_TINT,
    });

    if (!layers.secondaryParticles) return;

    this.spawnShockwave(position, {
      startRadiusTiles: 0.25,
      endRadiusTiles: radiusTiles * 0.68,
      durationMs: Math.round(durationMs * 0.72),
      lineWidth: 0.06,
      tint: LEVEL_UP_INNER_RING_TINT,
    });

    const sparkTravelMs = Math.round(durationMs * 0.75);
    const sparkDist = radiusTiles * 0.88;
    for (let ray = 0; ray < LEVEL_UP_SPARK_RAYS; ray += 1) {
      const angle = (ray * Math.PI * 2) / LEVEL_UP_SPARK_RAYS;
      this.spawn('fx.spark', position, {
        drawUnits: 0.65,
        lifetimeMs: sparkTravelMs + 60,
        travelMs: sparkTravelMs,
        tint: LEVEL_UP_SPARK_TINT,
        to: {
          x: position.x + Math.cos(angle) * sparkDist,
          y: position.y + Math.sin(angle) * sparkDist,
        },
      });
    }
  }

  get activeShockwaves(): number {
    return this.ringSlots.filter((slot) => slot.active).length;
  }

  update(deltaMs: number): void {
    const stepMs = Math.max(0, deltaMs);
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.remainingMs -= stepMs;
      if (slot.remainingMs <= 0) {
        slot.active = false;
        slot.node.active = false;
        slot.move = null;
        continue;
      }

      slot.elapsedMs += stepMs;
      if (slot.move !== null) {
        slot.move.elapsedMs += stepMs;
        const t = Math.min(1, slot.move.elapsedMs / slot.move.durationMs);
        slot.node.setPosition(
          slot.move.fromX + (slot.move.toX - slot.move.fromX) * t,
          slot.move.fromY + (slot.move.toY - slot.move.fromY) * t,
          0,
        );
      }

      const rawIndex = Math.floor((slot.elapsedMs * slot.fps) / 1000);
      const index = slot.loop
        ? rawIndex % slot.frames.length
        : Math.min(slot.frames.length - 1, rawIndex);
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

    for (const slot of this.ringSlots) {
      if (!slot.active) continue;
      slot.elapsedMs += Math.max(0, deltaMs);
      if (slot.elapsedMs >= slot.durationMs) {
        slot.active = false;
        slot.graphics.clear();
        slot.node.active = false;
        continue;
      }
      const t = Math.min(1, slot.elapsedMs / slot.durationMs);
      // Ease-out quad so the shockwave snaps outward quickly then settles cleanly at `endRadius`.
      const eased = 1 - (1 - t) * (1 - t);
      const radius = slot.startRadius + (slot.endRadius - slot.startRadius) * eased;
      slot.color.a = Math.max(0, Math.round(slot.baseAlpha * (1 - t)));
      this.drawRing(slot.graphics, radius, slot.lineWidth, slot.color);
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
    for (const slot of this.ringSlots) {
      if (slot.node.isValid) slot.node.destroy();
    }
    if (this.auraNode !== null && this.auraNode.isValid) this.auraNode.destroy();
    this.auraNode = null;
    this.auraSprite = null;
    this.auraFrames = [];
    this.auraActive = false;
    this.slots.length = 0;
    this.lineSlots.length = 0;
    this.ringSlots.length = 0;
    this.framesByKey.clear();
  }

  /** First inactive slot from the cursor; when all are busy, hand out slots round-robin. */
  private takeSlot(): Slot | undefined {
    const count = this.slots.length;
    for (let offset = 0; offset < count; offset += 1) {
      const index = (this.slotCursor + offset) % count;
      const slot = this.slots[index];
      if (slot !== undefined && !slot.active) {
        this.slotCursor = (index + 1) % count;
        return slot;
      }
    }
    const fallback = this.slots[this.slotCursor];
    if (fallback !== undefined) this.slotCursor = (this.slotCursor + 1) % count;
    return fallback;
  }

  private createSlot(parent: Node, index: number): Slot {
    const tint = new CocosColor(255, 255, 255, 255);
    const { node, sprite } = this.createSpriteSlot(parent, `fx-${index}`, tint);
    return {
      node,
      sprite,
      frames: [],
      fps: 10,
      loop: false,
      elapsedMs: 0,
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

  private createRingSlot(parent: Node, index: number): ShockwaveSlot {
    const node = new CocosNode(`fx-ring-${index}`);
    node.parent = parent;
    const graphics: Graphics = node.addComponent(CocosGraphics);
    node.active = false;
    return {
      node,
      graphics,
      color: new CocosColor(255, 226, 120, 240),
      baseAlpha: 240,
      startRadius: 0.45,
      endRadius: DEFAULT_LEVEL_UP_RADIUS_TILES,
      lineWidth: 0.09,
      durationMs: DEFAULT_LEVEL_UP_DURATION_MS,
      elapsedMs: 0,
      active: false,
    };
  }

  private takeRingSlot(): ShockwaveSlot | undefined {
    const free = this.ringSlots.find((candidate) => !candidate.active);
    if (free !== undefined) return free;
    let oldest = this.ringSlots[0];
    for (const candidate of this.ringSlots) {
      if (oldest !== undefined && candidate.elapsedMs > oldest.elapsedMs) {
        oldest = candidate;
      }
    }
    return oldest;
  }

  private drawRing(graphics: Graphics, radius: number, lineWidth: number, color: Color): void {
    graphics.clear();
    graphics.lineWidth = lineWidth;
    graphics.strokeColor = color;
    const firstX = UNIT_CIRCLE_X[0]! * radius;
    const firstY = UNIT_CIRCLE_Y[0]! * radius;
    graphics.moveTo(firstX, firstY);
    for (let index = 1; index < SHOCKWAVE_SEGMENTS; index += 1) {
      graphics.lineTo(UNIT_CIRCLE_X[index]! * radius, UNIT_CIRCLE_Y[index]! * radius);
    }
    graphics.lineTo(firstX, firstY);
    graphics.stroke();
  }
}

/** Standalone helper for triggering the M12 level-up / resume-knockback radial burst FX. */
export function spawnLevelUpBurst(
  fx: FxPool | null | undefined,
  position: Vec2,
  mode: EffectsMode = 'full',
  options?: LevelUpBurstOptions,
): void {
  fx?.spawnLevelUpBurst(position, mode, options);
}

/** Build the pool under `parent` (should be the FX layer above actors) — bootstrap awaits it once. */
export async function createFxPool(parent: Node): Promise<FxPool> {
  const pool = new FxPool();
  await pool.init(parent);
  return pool;
}
