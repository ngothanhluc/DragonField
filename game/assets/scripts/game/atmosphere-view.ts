/**
 * Draw one chapter's atmosphere layers (#6, rebuilt in M11 per ADR-019), engine side.
 *
 * Pure decisions live in `core/atmosphere/atmosphere.ts` (`visibleAtmosphere`,
 * `ATMOSPHERE_LAYER_STYLES`, `particleScaleForEntry`); this file only turns the visible layers
 * into pooled sprite nodes:
 *
 * - Every weather sprite uses strict **1:1 pixel scale** (`ACTOR_SCALE` = `1 / 16` tile per px)
 *   and crisp opacity — no full-screen `Graphics` vignette/heat-haze overlays and no `Raylight`
 *   or `Fog` washes.
 * - `under-actors` layers (`cloud-shadows`, `rain-splash`, `ripples`) are inserted in `roomRoot`
 *   right after the water node in **world space** (`0..cols × 0..rows`), so they drift/pop on the
 *   ground below obstacles, actors, telegraphs, and bullets, and are culled off-screen by
 *   `world-culler.ts`.
 * - `over-actors` layers (`leaves`, `blossoms`, `rain`, `ash`, `sand`) sit in the screen-space
 *   `atmosphere-layer` (`ROOM_COLS × ROOM_ROWS`) pinned to the camera.
 * - Every particle of a group is driven by **one** `update` and **one** shared clock (~60 sprites
 *   cost one component tick, holding 60 fps in `stress()`).
 */
import {
  _decorator,
  Color as CocosColor,
  Component,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  warn,
} from 'cc';
import type {
  AtmosphereConfig,
  AtmosphereLayer,
  AtmosphereLayerKind,
  AtmosphereLayerStyle,
  AtmosphereMotion,
  DecorSpec,
  VisibleAtmosphere,
} from '../core/atmosphere/atmosphere';
import {
  ATMOSPHERE_LAYER_STYLES,
  PARTICLE_PIXEL_SCALE,
  chapterAtmosphere,
  particleScaleForEntry,
  visibleAtmosphere,
} from '../core/atmosphere/atmosphere';
import { resolve, type AnimationManifest } from '../core/art/manifest';
import type { LevelData, Obstacle, RoomSize } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { SeededRng } from '../core/rng';
import type { EffectsMode } from '../core/vfx/weapon-vfx';
import { attachLivingDecor, type DecorHandle } from './living-decor-view';
import { getFrame } from './assets/sprite-frame-cache';
import { ACTOR_SCALE } from './level-view';

type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;
type SpriteFrame = Awaited<ReturnType<typeof getFrame>>;

const { ccclass } = _decorator;

// Compile-time & runtime sanity: engine `ACTOR_SCALE` and core `PARTICLE_PIXEL_SCALE` are one rule.
const PIXEL_SCALE = ACTOR_SCALE === PARTICLE_PIXEL_SCALE ? ACTOR_SCALE : PARTICLE_PIXEL_SCALE;

interface Particle {
  readonly node: Node;
  readonly sprite: Sprite;
  readonly frames: readonly SpriteFrame[];
  readonly fps: number;
  /** Frame-phase offset (0..1) so particles of one layer do not flip in lockstep. */
  phase: number;
  /** World units (or view units for `over-actors`), y up. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  frameIndex: number;
  /** Animation loop counter so `rain-splash` relocates each time its 3-frame splash finishes. */
  cycle: number;
}

interface LayerRuntime {
  readonly layer: AtmosphereLayer;
  readonly particles: Particle[];
  readonly motion: AtmosphereMotion;
  readonly boundsCols: number;
  readonly boundsRows: number;
}

/** World rect (tile units, top-left origin, y down) ripples may be placed in. */
export interface RippleArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

@ccclass('AtmosphereLayers')
export class AtmosphereLayers extends Component {
  private readonly layers: LayerRuntime[] = [];
  private rippleAreas: readonly RippleArea[] = [];
  private obstacles: readonly Obstacle[] = [];
  private rng = new SeededRng(1);
  private elapsedMs = 0;
  private roomSize: RoomSize = { cols: ROOM_COLS, rows: ROOM_ROWS };

  /** Build the layers that `visibleAtmosphere` allows; returns the kinds actually created. */
  async init(
    visible: VisibleAtmosphere,
    manifest: AnimationManifest,
    seed: number,
    rippleAreas: readonly RippleArea[] = [],
    roomSize: RoomSize = { cols: ROOM_COLS, rows: ROOM_ROWS },
    obstacles: readonly Obstacle[] = [],
  ): Promise<AtmosphereLayerKind[]> {
    this.rng = new SeededRng(seed);
    this.rippleAreas = rippleAreas;
    this.roomSize = roomSize;
    this.obstacles = obstacles;
    const created: AtmosphereLayerKind[] = [];
    const screens = roomScreens(roomSize);

    for (const layer of visible.layers) {
      let frames: readonly SpriteFrame[];
      let fps: number;
      let scale: number;
      try {
        const entry = resolve(manifest, layer.sprite);
        frames = await Promise.all(
          Array.from({ length: entry.frames }, (_, index) => getFrame(entry, 'down', index)),
        );
        fps = entry.fps;
        scale = particleScaleForEntry(entry) * (PIXEL_SCALE / PARTICLE_PIXEL_SCALE);
        created.push(layer.kind);
      } catch (error: unknown) {
        warn(`[YokaiField] Atmosphere layer ${layer.kind} skipped: ${String(error)}`);
        continue;
      }
      if (!this.isValid) return created;

      const style = ATMOSPHERE_LAYER_STYLES[layer.kind];
      const worldSpace = layer.depth === 'under-actors';
      const boundsCols = worldSpace ? roomSize.cols : ROOM_COLS;
      const boundsRows = worldSpace ? roomSize.rows : ROOM_ROWS;
      // Under-actors layers live across the whole room (culled off-screen by `world-culler`),
      // so scale their count by screen area to hold constant per-screen density.
      const count = worldSpace ? Math.max(1, Math.round(layer.count * screens)) : layer.count;

      const particles: Particle[] = [];
      for (let index = 0; index < count; index += 1) {
        const particle = this.createParticle(
          layer,
          frames,
          fps,
          style,
          scale,
          frames[0]!.rect.width,
          frames[0]!.rect.height,
        );
        this.placeParticle(layer.kind, style, particle, boundsCols, boundsRows, this.rng);
        particles.push(particle);
      }
      this.layers.push({ layer, particles, motion: style.motion, boundsCols, boundsRows });
    }
    return created;
  }

  update(deltaTime: number): void {
    const dtMs = Math.min(1000, Math.max(0, deltaTime) * 1000);
    if (dtMs <= 0) return;
    this.elapsedMs += dtMs;
    const dtSec = dtMs / 1000;

    for (const runtime of this.layers) {
      const { motion, boundsCols, boundsRows } = runtime;
      const gustFactor =
        motion === 'gust' ? 0.78 + 0.42 * Math.sin(this.elapsedMs / 1100) : 1;

      for (const particle of runtime.particles) {
        // Frame animation shares one clock for the whole layer group.
        if (particle.frames.length > 1) {
          const totalFrames = (this.elapsedMs * particle.fps) / 1000 + particle.phase * particle.frames.length;
          const frame = Math.floor(totalFrames) % particle.frames.length;
          if (frame !== particle.frameIndex) {
            particle.frameIndex = frame;
            const next = particle.frames[frame];
            if (next !== undefined) particle.sprite.spriteFrame = next;
          }
          if (motion === 'splash') {
            const cycle = Math.floor(totalFrames / particle.frames.length);
            if (cycle !== particle.cycle) {
              particle.cycle = cycle;
              const spot = this.pickWalkableGroundSpot(boundsCols, boundsRows, this.rng);
              particle.x = spot.x;
              particle.y = spot.y;
              particle.node.setPosition(particle.x, particle.y, 0);
            }
            continue;
          }
        }

        if (motion === 'still' || motion === 'splash') {
          continue;
        }

        if (motion === 'flutter') {
          const sway = Math.sin(this.elapsedMs / 650 + particle.phase * Math.PI * 2) * 0.55;
          particle.x += (particle.vx + sway) * dtSec;
          particle.y += particle.vy * dtSec;
          particle.x = wrapRange(particle.x, -1, boundsCols + 1);
          particle.y = wrapRange(particle.y, -1, boundsRows + 1);
        } else if (motion === 'rain') {
          particle.x += particle.vx * dtSec;
          particle.y += particle.vy * dtSec;
          particle.x = wrapRange(particle.x, -1, boundsCols + 1);
          particle.y = wrapRange(particle.y, -1, boundsRows + 1);
        } else if (motion === 'gust') {
          const wobble = Math.sin(this.elapsedMs / 480 + particle.phase * Math.PI * 2) * 0.35;
          particle.x += particle.vx * gustFactor * dtSec;
          particle.y += (particle.vy * gustFactor + wobble) * dtSec;
          particle.x = wrapRange(particle.x, -1, boundsCols + 1);
          particle.y = wrapRange(particle.y, -1, boundsRows + 1);
        } else if (motion === 'drift') {
          // `Clouds.png` is 5 tiles wide: use a 3.5-tile margin so shadows enter/leave smoothly off-screen.
          particle.x += particle.vx * dtSec;
          particle.y += particle.vy * dtSec;
          particle.x = wrapRange(particle.x, -3.5, boundsCols + 3.5);
          particle.y = wrapRange(particle.y, -2, boundsRows + 2);
        }

        particle.node.setPosition(particle.x, particle.y, 0);
      }
    }
  }

  private createParticle(
    layer: AtmosphereLayer,
    frames: readonly SpriteFrame[],
    fps: number,
    style: AtmosphereLayerStyle,
    scale: number,
    frameWidth: number,
    frameHeight: number,
  ): Particle {
    const node = new CocosNode(`${layer.kind}-particle`);
    node.parent = this.node;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.spriteFrame = frames[0]!;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    // CUSTOM reads its size from UITransform (defaults to 100×100) — set the exact pixel frame size.
    if (transform !== null) transform.setContentSize(frameWidth, frameHeight);

    node.setScale(scale, scale, 1);

    const alpha = clampByte(layer.opacity * 255);
    const color: Color = new CocosColor(style.tint[0], style.tint[1], style.tint[2], alpha);
    sprite.color = color;

    return {
      node,
      sprite,
      frames,
      fps,
      phase: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      frameIndex: 0,
      cycle: 0,
    };
  }

  /** Initial position/velocity per layer kind. */
  private placeParticle(
    kind: AtmosphereLayerKind,
    style: AtmosphereLayerStyle,
    particle: Particle,
    boundsCols: number,
    boundsRows: number,
    rng: SeededRng,
  ): void {
    particle.vx = sampleRange(style.vxRange, rng);
    particle.vy = sampleRange(style.vyRange, rng);

    if (kind === 'ripples') {
      const areas = this.rippleAreas;
      if (areas.length > 0) {
        const area = areas[rng.int(areas.length)] ?? areas[0]!;
        // Keep the 1×1 ripple sprite half a tile inside the water rectangle.
        particle.x = area.x + 0.5 + rng.next() * Math.max(0, area.width - 1);
        particle.y = this.roomSize.rows - (area.y + 0.5 + rng.next() * Math.max(0, area.height - 1));
      } else {
        particle.x = 1 + rng.next() * Math.max(1, boundsCols - 2);
        particle.y = 1 + rng.next() * Math.max(1, boundsRows - 2);
      }
    } else if (kind === 'rain-splash') {
      const spot = this.pickWalkableGroundSpot(boundsCols, boundsRows, rng);
      particle.x = spot.x;
      particle.y = spot.y;
    } else {
      particle.x = rng.next() * boundsCols;
      particle.y = rng.next() * boundsRows;
    }

    particle.phase = rng.next();
    particle.node.setPosition(particle.x, particle.y, 0);
  }

  /** Pick a walkable floor point (world units, y up) off obstacles/pits and off river water. */
  private pickWalkableGroundSpot(cols: number, rows: number, rng: SeededRng): Vec2 {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const tileX = 1 + rng.next() * Math.max(1, cols - 2);
      const tileY = 1 + rng.next() * Math.max(1, rows - 2);
      if (this.inObstacleOrWater(tileX, tileY)) continue;
      return { x: tileX, y: rows - tileY };
    }
    return {
      x: 1 + rng.next() * Math.max(1, cols - 2),
      y: 1 + rng.next() * Math.max(1, rows - 2),
    };
  }

  private inObstacleOrWater(tileX: number, tileY: number): boolean {
    for (const obs of this.obstacles) {
      if (
        tileX >= obs.x - 0.25 &&
        tileX <= obs.x + obs.width + 0.25 &&
        tileY >= obs.y - 0.25 &&
        tileY <= obs.y + obs.height + 0.25
      ) {
        return true;
      }
    }
    for (const area of this.rippleAreas) {
      if (
        tileX >= area.x &&
        tileX <= area.x + area.width &&
        tileY >= area.y &&
        tileY <= area.y + area.height
      ) {
        return true;
      }
    }
    return false;
  }
}

function sampleRange(range: readonly [number, number], rng: SeededRng): number {
  return range[0] + rng.next() * (range[1] - range[0]);
}

function wrapRange(value: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0)) return min;
  if (value >= min && value <= max) return value;
  return ((((value - min) % span) + span) % span) + min;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** How many 32×18 screens a room covers (1 for boss arenas, 4 for 64×36 rooms). */
function roomScreens(size: { readonly cols: number; readonly rows: number }): number {
  return Math.max(1, (size.cols / ROOM_COLS) * (size.rows / ROOM_ROWS));
}

export interface AtmosphereAttachOptions {
  readonly visible: VisibleAtmosphere;
  readonly manifest: AnimationManifest;
  readonly seed: number;
  /** Water rectangles of this room (ch2), so ripples land on water and splashes stay on land. */
  readonly rippleAreas?: readonly RippleArea[];
  /** Room height (tiles): kept for backwards-compatible callers; overridden by `roomSize` when given. */
  readonly rows: number;
  /** Full room dimensions (tiles) so world-space under-actors layers cover 64×36 rooms. */
  readonly roomSize?: RoomSize;
  /** Obstacles (walls, props, river pits) so `rain-splash` pops on walkable ground. */
  readonly obstacles?: readonly Obstacle[];
}

export interface AtmosphereHandle {
  readonly under: Node | null;
  readonly over: Node | null;
  readonly kinds: readonly AtmosphereLayerKind[];
  destroy(): void;
}

/**
 * Attach a chapter's visible layers to the room (under) and the world (over).
 * The under node sits right after the water node so it never covers actors or bullets.
 */
export function attachAtmosphere(
  roomRoot: Node,
  overLayer: Node | null,
  options: AtmosphereAttachOptions,
): AtmosphereHandle {
  const kinds: AtmosphereLayerKind[] = [];
  const nodes: Node[] = [];
  const size: RoomSize = options.roomSize ?? { cols: ROOM_COLS, rows: options.rows };

  const build = (
    visible: VisibleAtmosphere,
    parent: Node,
    name: string,
    siblingIndex: number | null,
    seedOffset: number,
  ): Node | null => {
    if (visible.layers.length === 0) return null;
    const node = new CocosNode(name);
    node.parent = parent;
    if (siblingIndex !== null) node.setSiblingIndex(siblingIndex);
    const view: AtmosphereLayers = node.addComponent(AtmosphereLayers);
    void view
      .init(
        visible,
        options.manifest,
        (options.seed + seedOffset) >>> 0,
        options.rippleAreas ?? [],
        size,
        options.obstacles ?? [],
      )
      .catch((error: unknown) => {
        warn(`[YokaiField] Could not build the atmosphere: ${String(error)}`);
      });
    nodes.push(node);
    return node;
  };

  const underLayers: AtmosphereLayer[] = [];
  const overLayers: AtmosphereLayer[] = [];
  for (const layer of options.visible.layers) {
    kinds.push(layer.kind);
    if (layer.depth === 'under-actors') underLayers.push(layer);
    else overLayers.push(layer);
  }

  const under = build(
    { ...options.visible, layers: underLayers },
    roomRoot,
    'atmosphere-under',
    // 0 = tile map, 1 = water; atmosphere goes right above the water.
    2,
    0,
  );
  const over =
    overLayer === null
      ? null
      : build({ ...options.visible, layers: overLayers }, overLayer, 'atmosphere-over', null, 97);

  return {
    under,
    over,
    kinds,
    destroy(): void {
      for (const node of nodes) {
        if (node.isValid) node.destroy();
      }
      nodes.length = 0;
    },
  };
}

/** Live counts of what a room's atmosphere/decor really drew (read by the debug snapshots). */
export interface RoomAtmosphereSnapshot {
  chapter: number;
  /** Layer kinds created, already filtered by the Effects mode. */
  layers: readonly string[];
  /** Animals / animated props really created (0 under Effects Reduced). */
  animals: number;
  props: number;
}

export interface RoomAtmosphereOptions {
  /** The room root; the under-actors layers and the living decor live under it. */
  readonly roomRoot: Node;
  /** World node for over-actors layers (must be destroyed separately — see `destroy`). */
  readonly overLayer: Node | null;
  readonly level: LevelData;
  readonly config: AtmosphereConfig;
  readonly manifest: AnimationManifest;
  readonly effects: EffectsMode;
  /** Run seed mixed with chapter/room, or a fixed per-chapter seed in the menus. */
  readonly seed: number;
  /** Water rectangles of this room (ch2), so ripples land on water instead of the floor. */
  readonly rippleAreas?: readonly RippleArea[];
  /** Player position in tile units (animals flee it); `null` when there is no player. */
  readonly playerOf: () => Vec2 | null;
  /** True for combat rooms (default, ADR-026: disables wandering animals & mutes decor props). */
  readonly combat?: boolean;
}

export interface RoomAtmosphereParts {
  readonly atmosphere: AtmosphereHandle;
  readonly decor: DecorHandle;
  /** Planned counts immediately, real counts once the decor textures load. */
  readonly snapshot: RoomAtmosphereSnapshot;
  /** Destroy both handles (the over-actors node is not under the room root). */
  destroy(): void;
}

/**
 * Build the atmosphere layers + living decor of one room (#6, M11) for the current Effects mode.
 *
 * Shared by the run (`bootstrap.rebuildRoomAtmosphere`) and the living menu backdrop (#8), so the
 * menu shows exactly what a run would. Returns `null` when the chapter has no atmosphere config.
 */
export function attachRoomAtmosphere(options: RoomAtmosphereOptions): RoomAtmosphereParts | null {
  const atmosphere = chapterAtmosphere(options.config, options.level.chapter);
  if (atmosphere === null) return null;

  const visible = visibleAtmosphere(atmosphere, options.effects, {
    combat: options.combat ?? true,
  });
  // Living decor is a world thing: keep the same density per screen when the room is bigger
  // than one screen (#37). A 32×18 room keeps exactly the chapter's number.
  const screens = roomScreens(options.level.size);
  const decorSpec: DecorSpec = {
    ...atmosphere.decor,
    animalsPerRoom: Math.round(atmosphere.decor.animalsPerRoom * screens),
    propsPerRoom: Math.round(atmosphere.decor.propsPerRoom * screens),
  };

  const handle = attachAtmosphere(options.roomRoot, options.overLayer, {
    visible,
    manifest: options.manifest,
    seed: options.seed,
    rows: options.level.size.rows,
    roomSize: options.level.size,
    obstacles: options.level.obstacles,
    ...(options.rippleAreas !== undefined ? { rippleAreas: options.rippleAreas } : {}),
  });

  const decor = attachLivingDecor(options.roomRoot, {
    level: options.level,
    tuning: options.config.animal,
    manifest: options.manifest,
    seed: (options.seed + 1) >>> 0,
    playerOf: options.playerOf,
    visible,
    spec: decorSpec,
  });

  const snapshot: RoomAtmosphereSnapshot = {
    chapter: options.level.chapter,
    layers: handle.kinds,
    animals: visible.animals ? decorSpec.animalsPerRoom : 0,
    props: visible.animatedProps ? decorSpec.propsPerRoom : 0,
  };
  void decor.ready.then((counts) => {
    snapshot.animals = counts.animals;
    snapshot.props = counts.props;
  });

  return {
    atmosphere: handle,
    decor,
    snapshot,
    destroy(): void {
      handle.destroy();
      decor.destroy();
    },
  };
}
