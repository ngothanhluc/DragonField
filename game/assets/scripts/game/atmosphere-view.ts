/**
 * Draw one chapter's atmosphere layers (#6), engine side.
 *
 * Pure decisions live in `core/atmosphere/atmosphere.ts` (`visibleAtmosphere`); this file only
 * turns the visible layers into nodes:
 *
 * - `under-actors` layers are inserted in the room root right after the water node, so they sit
 *   above the tile map but below obstacles/actors/bullets.
 * - `over-actors` layers go into the dedicated `atmosphere-layer` of the world (after `fx-layer`,
 *   still below the HUD), at the low alpha the data allows — they never hide telegraphs/bullets.
 * - Vignette and heat haze are `Graphics` (ADR-017: sprites + Graphics, no custom shaders).
 *
 * Every particle of a group is driven by **one** `update` and **one** clock (same rule as
 * `WaterView`/`FxPool`): ~60 sprites cost one component tick, not 60.
 */
import {
  _decorator,
  Color as CocosColor,
  Component,
  Graphics as CocosGraphics,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  warn,
} from 'cc';
import type {
  AtmosphereConfig,
  AtmosphereLayer,
  AtmosphereLayerKind,
  VisibleAtmosphere,
} from '../core/atmosphere/atmosphere';
import { chapterAtmosphere, visibleAtmosphere } from '../core/atmosphere/atmosphere';
import { resolve, type AnimationManifest } from '../core/art/manifest';
import type { LevelData } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { SeededRng } from '../core/rng';
import type { EffectsMode } from '../core/vfx/weapon-vfx';
import { attachLivingDecor, type DecorHandle } from './living-decor-view';
import { getFrame } from './assets/sprite-frame-cache';

type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;
type SpriteFrame = Awaited<ReturnType<typeof getFrame>>;

const { ccclass } = _decorator;

type Motion = 'still' | 'fall' | 'wind' | 'fog';

/** Per-kind draw size (world units = tiles) and motion; `still` layers only animate frames. */
const STYLE: Readonly<
  Record<AtmosphereLayerKind, { readonly motion: Motion; readonly drawUnits: number; readonly tint: readonly [number, number, number] }>
> = {
  raylight: { motion: 'still', drawUnits: 13, tint: [255, 246, 200] },
  leaves: { motion: 'fall', drawUnits: 0.45, tint: [255, 255, 255] },
  fog: { motion: 'fog', drawUnits: 34, tint: [220, 230, 240] },
  ripples: { motion: 'still', drawUnits: 1, tint: [255, 255, 255] },
  ash: { motion: 'fall', drawUnits: 0.3, tint: [210, 205, 200] },
  vignette: { motion: 'still', drawUnits: 1, tint: [12, 8, 16] },
  sand: { motion: 'wind', drawUnits: 0.5, tint: [224, 196, 138] },
  'heat-haze': { motion: 'still', drawUnits: 1, tint: [255, 236, 190] },
};

/** Layers drawn with `Graphics` instead of a sprite (data has `sprite: null`). */
interface Particle {
  readonly node: Node;
  readonly sprite: Sprite;
  readonly frames: readonly SpriteFrame[];
  readonly fps: number;
  /** Frame-phase offset (0..1) so particles of one layer do not flip in lockstep. */
  phase: number;
  readonly color: Color;
  /** World units, y up. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  frameIndex: number;
  /** Last written alpha (0..255) so a pulsing layer does not rewrite the colour every frame. */
  alpha: number;
}

interface LayerRuntime {
  readonly layer: AtmosphereLayer;
  readonly particles: Particle[];
  readonly motion: Motion;
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
  private elapsedMs = 0;

  /** Build the layers that `visibleAtmosphere` allows; returns the kinds actually created. */
  async init(
    visible: VisibleAtmosphere,
    manifest: AnimationManifest,
    seed: number,
    rippleAreas: readonly RippleArea[] = [],
  ): Promise<AtmosphereLayerKind[]> {
    const rng = new SeededRng(seed);
    this.rippleAreas = rippleAreas;
    const created: AtmosphereLayerKind[] = [];

    for (const layer of visible.layers) {
      if (layer.sprite === null) {
        this.drawGraphics(layer);
        created.push(layer.kind);
        continue;
      }

      let frames: readonly SpriteFrame[];
      let fps: number;
      let frameWidth: number;
      let frameHeight: number;
      try {
        const entry = resolve(manifest, layer.sprite);
        frames = await Promise.all(
          Array.from({ length: entry.frames }, (_, index) => getFrame(entry, 'down', index)),
        );
        fps = entry.fps;
        frameWidth = entry.frameWidth;
        frameHeight = entry.frameHeight;
        created.push(layer.kind);
      } catch (error: unknown) {
        warn(`[YokaiField] Atmosphere layer ${layer.kind} skipped: ${String(error)}`);
        continue;
      }

      const style = STYLE[layer.kind];
      const scale = style.drawUnits / Math.max(1, frameWidth, frameHeight);
      const particles: Particle[] = [];
      for (let index = 0; index < layer.count; index += 1) {
        const particle = this.createParticle(
          layer,
          frames,
          fps,
          style,
          scale,
          frames[0]!.rect.width,
          frames[0]!.rect.height,
        );
        this.placeParticle(layer.kind, particle, index, layer.count, rng);
        particles.push(particle);
      }
      this.layers.push({ layer, particles, motion: style.motion });
    }
    return created;
  }

  update(deltaTime: number): void {
    const dtMs = Math.min(1000, Math.max(0, deltaTime) * 1000);
    if (dtMs <= 0) return;
    this.elapsedMs += dtMs;
    const dtSec = dtMs / 1000;

    for (const runtime of this.layers) {
      const { motion } = runtime;
      for (const particle of runtime.particles) {
        // Frame animation shares one clock for the whole layer group.
        if (particle.frames.length > 1) {
          const frame = Math.floor((this.elapsedMs * particle.fps) / 1000 + particle.phase) % particle.frames.length;
          if (frame !== particle.frameIndex) {
            particle.frameIndex = frame;
            const next = particle.frames[frame];
            if (next !== undefined) particle.sprite.spriteFrame = next;
          }
        }

        if (motion === 'still') {
          // Light shafts breathe instead of moving (no allocation: only the alpha changes).
          if (runtime.layer.kind === 'raylight') {
            const pulse = 0.7 + 0.3 * Math.sin(this.elapsedMs / 1400 + particle.phase * Math.PI * 2);
            const alpha = clampByte(runtime.layer.opacity * pulse * 255);
            if (Math.abs(alpha - particle.alpha) >= 2) {
              particle.alpha = alpha;
              particle.color.a = alpha;
              particle.sprite.color = particle.color;
            }
          }
          continue;
        }

        if (motion === 'fall') {
          particle.y += particle.vy * dtSec;
          particle.x += Math.sin(this.elapsedMs / 900 + particle.phase * Math.PI * 2) * 0.35 * dtSec;
          if (particle.y < -1) {
            particle.y = ROOM_ROWS + 1;
            particle.x = ((particle.x % ROOM_COLS) + ROOM_COLS) % ROOM_COLS;
          }
        } else if (motion === 'wind') {
          particle.x += particle.vx * dtSec;
          particle.y += Math.sin(this.elapsedMs / 700 + particle.phase * Math.PI * 2) * 0.2 * dtSec;
          if (particle.x > ROOM_COLS + 2) {
            particle.x = -2;
            particle.y = ((particle.y % ROOM_ROWS) + ROOM_ROWS) % ROOM_ROWS;
          }
        } else {
          particle.x += particle.vx * dtSec;
          if (particle.x > ROOM_COLS + 4) particle.x = -4;
        }

        particle.node.setPosition(particle.x, particle.y, 0);
      }
    }
  }

  private createParticle(
    layer: AtmosphereLayer,
    frames: readonly SpriteFrame[],
    fps: number,
    style: (typeof STYLE)[AtmosphereLayerKind],
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
    // CUSTOM reads its size from UITransform (defaults to 100×100) — set the real frame size.
    if (transform !== null) transform.setContentSize(frameWidth, frameHeight);

    node.setScale(scale, scale, 1);

    const alpha = clampByte(layer.opacity * 255);
    const color = new CocosColor(style.tint[0], style.tint[1], style.tint[2], alpha);
    sprite.color = color;

    return {
      node,
      sprite,
      frames,
      fps,
      phase: 0,
      color,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      frameIndex: 0,
      alpha: -1,
    };
  }

  /** Initial position/velocity per layer kind. */
  private placeParticle(
    kind: AtmosphereLayerKind,
    particle: Particle,
    index: number,
    count: number,
    rng: SeededRng,
  ): void {
    switch (kind) {
      case 'raylight': {
        particle.x = ((index + 0.5) * ROOM_COLS) / count;
        particle.y = ROOM_ROWS - 2.5;
        break;
      }
      case 'fog': {
        particle.x = (index * ROOM_COLS) / count;
        particle.y = ROOM_ROWS / 2;
        particle.vx = 0.25 + rng.next() * 0.2;
        break;
      }
      case 'leaves': {
        particle.x = rng.next() * ROOM_COLS;
        particle.y = rng.next() * ROOM_ROWS;
        particle.vy = -(0.8 + rng.next() * 0.6);
        break;
      }
      case 'ash': {
        particle.x = rng.next() * ROOM_COLS;
        particle.y = rng.next() * ROOM_ROWS;
        particle.vy = -(0.5 + rng.next() * 0.5);
        break;
      }
      case 'sand': {
        particle.x = rng.next() * ROOM_COLS;
        particle.y = rng.next() * ROOM_ROWS;
        particle.vx = 5 + rng.next() * 3;
        break;
      }
      case 'ripples': {
        const areas = this.rippleAreas;
        if (areas.length > 0) {
          const area = areas[rng.int(areas.length)] ?? areas[0]!;
          // The 1×1 ripple sprite must stay fully inside the water: keep half a tile off each edge.
          particle.x = area.x + 0.5 + rng.next() * Math.max(0, area.width - 1);
          // Tile y (down) → world y (up): the ripple sits on the water surface.
          particle.y = ROOM_ROWS - (area.y + 0.5 + rng.next() * Math.max(0, area.height - 1));
        } else {
          particle.x = 1 + rng.next() * (ROOM_COLS - 2);
          particle.y = 1 + rng.next() * (ROOM_ROWS - 2);
        }
        break;
      }
      default: {
        particle.x = ROOM_COLS / 2;
        particle.y = ROOM_ROWS / 2;
        break;
      }
    }

    // Spread the frame phase so ripples/particles do not flip in lockstep.
    particle.phase = rng.next();
    particle.node.setPosition(particle.x, particle.y, 0);
  }

  /**
   * Vignette / heat haze with `Graphics` (no texture, no shader). Drawn once at build time.
   *
   * One node per colour: `Graphics.fill()` fills every subpath in the buffer again, so stacking
   * differently-coloured rects in one node would paint the earlier ones twice.
   */
  private drawGraphics(layer: AtmosphereLayer): void {
    const style = STYLE[layer.kind];

    if (layer.kind === 'vignette') {
      // Thin, many rings: 6 thick bands read as a picture frame, 12 thin ones as a gradient.
      const rings = 12;
      const thickness = 0.32;
      for (let ring = 0; ring < rings; ring += 1) {
        const inset = ring * thickness;
        const width = ROOM_COLS - inset * 2;
        const height = ROOM_ROWS - inset * 2;
        if (width <= 0 || height <= 0) break;
        const alpha = clampByte(layer.opacity * 255 * 0.5 * ((ring + 1) / rings));
        this.fillRects(
          `vignette-${ring}`,
          new CocosColor(style.tint[0], style.tint[1], style.tint[2], alpha),
          [
            { x: inset, y: inset, width, height: thickness },
            { x: inset, y: inset + height - thickness, width, height: thickness },
            { x: inset, y: inset, width: thickness, height },
            { x: inset + width - thickness, y: inset, width: thickness, height },
          ],
        );
      }
      return;
    }

    // Heat haze: a few thin, faint horizontal bands (still cheaper than a shader).
    const bands: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (let band = 0; band < 6; band += 1) {
      bands.push({ x: 0.5, y: ROOM_ROWS * 0.12 + band * 1.1, width: ROOM_COLS - 1, height: 0.35 });
    }
    this.fillRects(
      'heat-haze',
      new CocosColor(style.tint[0], style.tint[1], style.tint[2], clampByte(layer.opacity * 255 * 0.5)),
      bands,
    );
  }

  /** One `Graphics` node holding same-coloured rectangles (a single `fill` pass). */
  private fillRects(
    name: string,
    color: Color,
    rects: ReadonlyArray<{ x: number; y: number; width: number; height: number }>,
  ): void {
    const node = new CocosNode(name);
    node.parent = this.node;
    const graphics: Graphics = node.addComponent(CocosGraphics);
    graphics.fillColor = color;
    for (const rect of rects) graphics.rect(rect.x, rect.y, rect.width, rect.height);
    graphics.fill();
  }
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

export interface AtmosphereAttachOptions {
  readonly visible: VisibleAtmosphere;
  readonly manifest: AnimationManifest;
  readonly seed: number;
  /** Water rectangles of this room (ch2), so ripples land on water instead of the floor. */
  readonly rippleAreas?: readonly RippleArea[];
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

  const build = (
    visible: VisibleAtmosphere,
    parent: Node,
    name: string,
    siblingIndex: number | null,
  ): Node | null => {
    if (visible.layers.length === 0) return null;
    const node = new CocosNode(name);
    node.parent = parent;
    if (siblingIndex !== null) node.setSiblingIndex(siblingIndex);
    const view: AtmosphereLayers = node.addComponent(AtmosphereLayers);
    void view
      .init(visible, options.manifest, options.seed, options.rippleAreas ?? [])
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
  );
  const over = overLayer === null
    ? null
    : build({ ...options.visible, layers: overLayers }, overLayer, 'atmosphere-over', null);

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
 * Build the atmosphere layers + living decor of one room (#6) for the current Effects mode.
 *
 * Shared by the run (`bootstrap.rebuildRoomAtmosphere`) and the living menu backdrop (#8), so the
 * menu shows exactly what a run would. Returns `null` when the chapter has no atmosphere config.
 */
export function attachRoomAtmosphere(options: RoomAtmosphereOptions): RoomAtmosphereParts | null {
  const atmosphere = chapterAtmosphere(options.config, options.level.chapter);
  if (atmosphere === null) return null;

  const visible = visibleAtmosphere(atmosphere, options.effects);
  const handle = attachAtmosphere(options.roomRoot, options.overLayer, {
    visible,
    manifest: options.manifest,
    seed: options.seed,
    ...(options.rippleAreas !== undefined ? { rippleAreas: options.rippleAreas } : {}),
  });

  const decor = attachLivingDecor(options.roomRoot, {
    level: options.level,
    tuning: options.config.animal,
    manifest: options.manifest,
    seed: (options.seed + 1) >>> 0,
    playerOf: options.playerOf,
    visible,
    spec: atmosphere.decor,
  });

  const snapshot: RoomAtmosphereSnapshot = {
    chapter: options.level.chapter,
    layers: handle.kinds,
    animals: visible.animals ? atmosphere.decor.animalsPerRoom : 0,
    props: visible.animatedProps ? atmosphere.decor.propsPerRoom : 0,
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
