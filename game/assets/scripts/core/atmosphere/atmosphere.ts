/**
 * Per-chapter atmosphere config (#6, rebuilt in M11 per ADR-019). Pure TS: must not import 'cc'.
 *
 * Source data: `assets/resources/data/atmosphere.json` (one entry per chapter, 1–4).
 * This module owns the schema, validation, 1:1 pixel-scale rule (`PARTICLE_PIXEL_SCALE`),
 * per-layer motion/tint metadata, and the Effects-mode filter; the Cocos adapter
 * (`game/atmosphere-view.ts`) only draws what `visibleAtmosphere` hands it.
 */
import { TILE_SIZE_PX } from '../level/level-data';
import type { EffectsMode } from '../vfx/weapon-vfx';

/**
 * Valid chapter weather layer kinds (ADR-019).
 * Full-screen/oversized overlays (`raylight`, `fog`, `vignette`, `heat-haze`) were removed in M11.
 */
export const ATMOSPHERE_LAYER_KINDS = [
  'leaves',
  'blossoms',
  'cloud-shadows',
  'rain',
  'rain-splash',
  'ripples',
  'ash',
  'sand',
] as const;
export type AtmosphereLayerKind = (typeof ATMOSPHERE_LAYER_KINDS)[number];

/**
 * Where a layer draws.
 * - `under-actors`: in world space above the tile map/water, below props/obstacles/actors/bullets.
 * - `over-actors`: in screen space above world FX, below the HUD — crisp 1:1 particles that stay
 *   sparse/compact so they never hide telegraphs or projectiles.
 */
export type AtmosphereDepth = 'under-actors' | 'over-actors';

/** Motion family driven by the shared `AtmosphereLayers` clock. */
export type AtmosphereMotion = 'flutter' | 'rain' | 'splash' | 'drift' | 'gust' | 'still';

/**
 * Strict 1:1 pixel scale in world units (ADR-019): 1 texture pixel = `1 / TILE_SIZE_PX` (1/16) tile,
 * identical to `ACTOR_SCALE` in `game/level-view.ts`. Weather sprites are never crushed or stretched.
 */
export const PARTICLE_PIXEL_SCALE = 1 / TILE_SIZE_PX;

export interface AtmosphereLayerStyle {
  readonly motion: AtmosphereMotion;
  readonly tint: readonly [number, number, number];
  /** Velocity bounds in world units/s (x right, y up). */
  readonly vxRange: readonly [number, number];
  readonly vyRange: readonly [number, number];
}

/** Per-kind visual/motion style; scale is always `PARTICLE_PIXEL_SCALE` (1:1 pixel art). */
export const ATMOSPHERE_LAYER_STYLES: Readonly<Record<AtmosphereLayerKind, AtmosphereLayerStyle>> = {
  leaves: {
    motion: 'flutter',
    tint: [255, 255, 255],
    vxRange: [1.6, 2.6],
    vyRange: [-1.7, -1.0],
  },
  blossoms: {
    motion: 'flutter',
    tint: [255, 255, 255],
    vxRange: [1.8, 2.9],
    vyRange: [-1.5, -0.9],
  },
  'cloud-shadows': {
    motion: 'drift',
    // Palette dark `#141b1b` so the white `Clouds.png` silhouette renders as a soft ground shadow.
    tint: [20, 27, 27],
    vxRange: [0.55, 0.95],
    vyRange: [-0.22, -0.1],
  },
  rain: {
    motion: 'rain',
    tint: [255, 255, 255],
    // Aligned with `Rain.png`'s `/` pixel angle (down-left in world-up space).
    vxRange: [-7.2, -5.6],
    vyRange: [-16.0, -13.0],
  },
  'rain-splash': {
    motion: 'splash',
    tint: [255, 255, 255],
    vxRange: [0, 0],
    vyRange: [0, 0],
  },
  ripples: {
    motion: 'still',
    tint: [255, 255, 255],
    vxRange: [0, 0],
    vyRange: [0, 0],
  },
  ash: {
    motion: 'flutter',
    tint: [255, 255, 255],
    vxRange: [1.3, 2.2],
    vyRange: [-1.4, -0.85],
  },
  sand: {
    motion: 'gust',
    tint: [255, 255, 255],
    vxRange: [9.0, 13.0],
    vyRange: [-3.5, -2.0],
  },
};

/** Node scale for any atmosphere particle sprite: strictly 1:1 pixel scale (`1 / 16` tile/px). */
export function particleScaleForEntry(entry: {
  readonly frameWidth: number;
  readonly frameHeight: number;
}): number {
  if (!(entry.frameWidth > 0) || !(entry.frameHeight > 0)) {
    throw new Error(`atmosphere sprite must have positive pixel size, got ${entry.frameWidth}×${entry.frameHeight}`);
  }
  return PARTICLE_PIXEL_SCALE;
}

/** World size in tiles of an atmosphere sprite drawn at 1:1 pixel scale. */
export function particleDrawSizeTiles(entry: {
  readonly frameWidth: number;
  readonly frameHeight: number;
}): { readonly width: number; readonly height: number } {
  return {
    width: entry.frameWidth * PARTICLE_PIXEL_SCALE,
    height: entry.frameHeight * PARTICLE_PIXEL_SCALE,
  };
}

export interface AtmosphereLayer {
  readonly kind: AtmosphereLayerKind;
  /** Secondary = extra particles / ground shadows; `Effects: Reduced` drops these. */
  readonly secondary: boolean;
  readonly depth: AtmosphereDepth;
  /** Manifest key in `animations.json` (e.g. `fx.leaf`, `fx.rain`). */
  readonly sprite: string;
  /** Peak opacity, 0 < opacity ≤ 1. */
  readonly opacity: number;
  /** Base particle count per 32×18 screen (≥ 1). */
  readonly count: number;
}

/** What living decor a chapter's rooms get. */
export interface DecorSpec {
  /** Manifest keys of animals (`animal.*`) picked for the chapter's rooms. */
  readonly animals: readonly string[];
  /** Manifest keys of animated props (`decor.*`: campfires, flags, flowers, plants). */
  readonly props: readonly string[];
  /** Exactly this many animals per 32×18 screen. */
  readonly animalsPerRoom: number;
  /** Exactly this many animated props per 32×18 screen. */
  readonly propsPerRoom: number;
}

export interface ChapterAtmosphere {
  readonly chapter: number;
  readonly layers: readonly AtmosphereLayer[];
  readonly decor: DecorSpec;
}

/** Animal movement numbers (data, not `tuning.json`: they never affect balance). */
export interface AnimalTuning {
  /** Player closer than this (tile units) → the animal flees. */
  readonly fleeRadiusTiles: number;
  readonly wanderSpeedTilesPerSec: number;
  readonly fleeSpeedTilesPerSec: number;
}

export interface AtmosphereConfig {
  readonly version: 1;
  readonly animal: AnimalTuning;
  /** Keyed by chapter number as a string (`"1"` … `"4"`). */
  readonly chapters: Readonly<Record<string, ChapterAtmosphere>>;
}

/** What is actually drawn for a chapter under an effects mode. */
export interface VisibleAtmosphere {
  readonly layers: readonly AtmosphereLayer[];
  /** Animals are created at all (disabled in combat rooms per ADR-026; reserved for M21 Village Hub). */
  readonly animals: boolean;
  /** Animated props (campfires/flags/flowers/plants) are created at all. */
  readonly animatedProps: boolean;
  /** Opacity multiplier for static/animated background props in combat (`0.65`) vs hub/menu (`1`). */
  readonly propAlpha: number;
}

/** M18 (ADR-026): muted opacity for background decor props in combat rooms so enemies/bullets pop. */
export const COMBAT_PROP_ALPHA = 0.65;
/** M18 (ADR-026): over-actor combat weather opacity bounds (`30–40%`, i.e. alpha `80–102`). */
export const COMBAT_WEATHER_OPACITY_MIN = 0.3;
export const COMBAT_WEATHER_OPACITY_MAX = 0.4;

export const ATMOSPHERE_VERSION = 1;

export const ANIMAL_SPRITE_PREFIX = 'animal.';
export const PROP_SPRITE_PREFIX = 'decor.';

const DEPTHS: readonly AtmosphereDepth[] = ['under-actors', 'over-actors'];

/** Collect every problem, then throw one `Error` — same style as `parseLevelData`. */
class ProblemList {
  private readonly items: string[] = [];

  add(path: string, message: string): void {
    this.items.push(path === '' ? message : `${path}: ${message}`);
  }

  throwIfAny(header: string): void {
    if (this.items.length === 0) return;
    const details = this.items.map((item) => `  - ${item}`).join('\n');
    throw new Error(`${header} (${this.items.length} problem(s))\n${details}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isLayerKind(value: unknown): value is AtmosphereLayerKind {
  return typeof value === 'string' && (ATMOSPHERE_LAYER_KINDS as readonly string[]).includes(value);
}

function isDepth(value: unknown): value is AtmosphereDepth {
  return typeof value === 'string' && (DEPTHS as readonly string[]).includes(value);
}

function readNumber(
  record: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
): number | null {
  const value = record[field];
  if (!isFiniteNumber(value)) {
    problems.add(`${path}.${field}`, `must be a finite number, got ${describeValue(value)}`);
    return null;
  }
  return value;
}

function readSpriteKeys(
  value: unknown,
  path: string,
  prefix: string,
  problems: ProblemList,
): string[] {
  if (!Array.isArray(value)) {
    problems.add(path, `must be an array of "${prefix}*" manifest keys, got ${describeValue(value)}`);
    return [];
  }
  const keys: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !entry.startsWith(prefix) || entry.length <= prefix.length) {
      problems.add(
        `${path}[${index}]`,
        `must be a "${prefix}*" manifest key, got ${describeValue(entry)}`,
      );
      return;
    }
    if (keys.includes(entry)) {
      problems.add(`${path}[${index}]`, `duplicates "${entry}"`);
      return;
    }
    keys.push(entry);
  });
  return keys;
}

function readLayer(value: unknown, path: string, problems: ProblemList): AtmosphereLayer | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object AtmosphereLayer, got ${describeValue(value)}`);
    return null;
  }

  const kind = value['kind'];
  const kindOk = isLayerKind(kind);
  if (!kindOk) {
    problems.add(
      `${path}.kind`,
      `invalid (${describeValue(kind)}); expected one of ${ATMOSPHERE_LAYER_KINDS.join(', ')}`,
    );
  }

  const secondary = value['secondary'];
  if (typeof secondary !== 'boolean') {
    problems.add(`${path}.secondary`, `must be a boolean, got ${describeValue(secondary)}`);
  }

  const depth = value['depth'];
  const depthOk = isDepth(depth);
  if (!depthOk) {
    problems.add(
      `${path}.depth`,
      `invalid (${describeValue(depth)}); expected one of ${DEPTHS.join(', ')}`,
    );
  }

  const sprite = value['sprite'];
  const spriteOk = typeof sprite === 'string' && sprite.length > 0;
  if (!spriteOk) {
    problems.add(
      `${path}.sprite`,
      `must be a non-empty manifest key (Graphics overlays were removed in M11), got ${describeValue(sprite)}`,
    );
  }

  const opacity = readNumber(value, 'opacity', path, problems);
  if (opacity !== null && (opacity <= 0 || opacity > 1)) {
    problems.add(`${path}.opacity`, `must be in (0, 1], got ${opacity}`);
  }

  const count = value['count'];
  const countOk = isInteger(count) && count >= 1;
  if (!countOk) {
    problems.add(`${path}.count`, `must be an integer >= 1, got ${describeValue(count)}`);
  }

  if (!kindOk || typeof secondary !== 'boolean' || !depthOk || !spriteOk || opacity === null || !countOk) {
    return null;
  }
  return { kind, secondary, depth, sprite, opacity, count };
}

function readDecor(value: unknown, path: string, problems: ProblemList): DecorSpec | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object DecorSpec, got ${describeValue(value)}`);
    return null;
  }

  const animals = readSpriteKeys(value['animals'], `${path}.animals`, ANIMAL_SPRITE_PREFIX, problems);
  const props = readSpriteKeys(value['props'], `${path}.props`, PROP_SPRITE_PREFIX, problems);

  const animalsPerRoom = value['animalsPerRoom'];
  const animalsCountOk = isInteger(animalsPerRoom) && animalsPerRoom >= 0;
  if (!animalsCountOk) {
    problems.add(
      `${path}.animalsPerRoom`,
      `must be an integer >= 0, got ${describeValue(animalsPerRoom)}`,
    );
  }

  const propsPerRoom = value['propsPerRoom'];
  const propsCountOk = isInteger(propsPerRoom) && propsPerRoom >= 0;
  if (!propsCountOk) {
    problems.add(`${path}.propsPerRoom`, `must be an integer >= 0, got ${describeValue(propsPerRoom)}`);
  }

  if (animalsCountOk && animalsPerRoom > 0 && animals.length === 0) {
    problems.add(`${path}.animals`, `must list at least one key when animalsPerRoom is ${animalsPerRoom}`);
  }
  if (propsCountOk && propsPerRoom > 0 && props.length === 0) {
    problems.add(`${path}.props`, `must list at least one key when propsPerRoom is ${propsPerRoom}`);
  }

  if (!animalsCountOk || !propsCountOk) return null;
  return { animals, props, animalsPerRoom, propsPerRoom };
}

function readChapter(
  value: unknown,
  chapter: number,
  path: string,
  problems: ProblemList,
): ChapterAtmosphere | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object ChapterAtmosphere, got ${describeValue(value)}`);
    return null;
  }

  if (value['chapter'] !== chapter) {
    problems.add(`${path}.chapter`, `must equal the key (${chapter}), got ${describeValue(value['chapter'])}`);
  }

  const layers: AtmosphereLayer[] = [];
  const rawLayers = value['layers'];
  if (!Array.isArray(rawLayers)) {
    problems.add(`${path}.layers`, `must be an array of AtmosphereLayer, got ${describeValue(rawLayers)}`);
  } else {
    if (rawLayers.length === 0) problems.add(`${path}.layers`, 'must have at least 1 layer');
    rawLayers.forEach((rawLayer, index) => {
      const layer = readLayer(rawLayer, `${path}.layers[${index}]`, problems);
      if (layer !== null) layers.push(layer);
    });
  }

  const decor = readDecor(value['decor'], `${path}.decor`, problems);

  if (!Array.isArray(rawLayers) || decor === null) return null;
  return { chapter, layers, decor };
}

function readAnimalTuning(
  value: unknown,
  path: string,
  problems: ProblemList,
): AnimalTuning | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object AnimalTuning, got ${describeValue(value)}`);
    return null;
  }

  const fleeRadiusTiles = readNumber(value, 'fleeRadiusTiles', path, problems);
  const wanderSpeedTilesPerSec = readNumber(value, 'wanderSpeedTilesPerSec', path, problems);
  const fleeSpeedTilesPerSec = readNumber(value, 'fleeSpeedTilesPerSec', path, problems);

  if (fleeRadiusTiles !== null && fleeRadiusTiles <= 0) {
    problems.add(`${path}.fleeRadiusTiles`, `must be > 0, got ${fleeRadiusTiles}`);
  }
  if (wanderSpeedTilesPerSec !== null && wanderSpeedTilesPerSec <= 0) {
    problems.add(`${path}.wanderSpeedTilesPerSec`, `must be > 0, got ${wanderSpeedTilesPerSec}`);
  }
  if (
    wanderSpeedTilesPerSec !== null &&
    fleeSpeedTilesPerSec !== null &&
    fleeSpeedTilesPerSec <= wanderSpeedTilesPerSec
  ) {
    problems.add(
      `${path}.fleeSpeedTilesPerSec`,
      `must be greater than wanderSpeedTilesPerSec (${wanderSpeedTilesPerSec}), got ${fleeSpeedTilesPerSec}`,
    );
  }

  if (fleeRadiusTiles === null || wanderSpeedTilesPerSec === null || fleeSpeedTilesPerSec === null) {
    return null;
  }
  return { fleeRadiusTiles, wanderSpeedTilesPerSec, fleeSpeedTilesPerSec };
}

/** Validate raw JSON; throws naming the broken chapter/layer/field. */
export function parseAtmosphereConfig(raw: unknown): AtmosphereConfig {
  const problems = new ProblemList();

  if (!isRecord(raw)) {
    throw new Error(`atmosphere.json must be an object, got ${describeValue(raw)}`);
  }
  if (raw['version'] !== ATMOSPHERE_VERSION) {
    problems.add(
      'version',
      `must be ${ATMOSPHERE_VERSION}, got ${describeValue(raw['version'])}`,
    );
  }

  const animal = readAnimalTuning(raw['animal'], 'animal', problems);

  const chapters: Record<string, ChapterAtmosphere> = {};
  const rawChapters = raw['chapters'];
  if (!isRecord(rawChapters)) {
    problems.add('chapters', `must be an object keyed by chapter number, got ${describeValue(rawChapters)}`);
  } else {
    for (const [key, value] of Object.entries(rawChapters)) {
      const chapter = Number(key);
      if (!isInteger(chapter) || chapter < 1) {
        problems.add(`chapters["${key}"]`, `chapter keys must be positive integers, got "${key}"`);
        continue;
      }
      const parsed = readChapter(value, chapter, `chapter ${chapter}`, problems);
      if (parsed !== null) chapters[key] = parsed;
    }
  }

  problems.throwIfAny('atmosphere.json is invalid');
  if (animal === null) throw new Error('atmosphere.json is invalid: missing animal tuning');
  return { version: ATMOSPHERE_VERSION, animal, chapters };
}

/** The chapter's atmosphere, or `null` when the chapter has none. */
export function chapterAtmosphere(
  config: AtmosphereConfig,
  chapter: number,
): ChapterAtmosphere | null {
  if (!Number.isInteger(chapter) || chapter < 1) return null;
  return config.chapters[String(chapter)] ?? null;
}

export interface VisibleAtmosphereOptions {
  /**
   * True for combat rooms (default, M18 ADR-026): disables wandering `LivingDecor` animals
   * (reserved for M21 Village Hub) and mutes background animated props to `COMBAT_PROP_ALPHA`.
   * Pass `false` for non-combat scenes (Village Hub, living menu backdrop).
   */
  readonly combat?: boolean;
}

/** Full: weather + props (animals only outside combat). Reduced: primary weather only, no animals/props. */
export function visibleAtmosphere(
  atmosphere: ChapterAtmosphere,
  mode: EffectsMode,
  options: VisibleAtmosphereOptions = {},
): VisibleAtmosphere {
  const combat = options.combat ?? true;
  if (mode !== 'reduced') {
    return {
      layers: atmosphere.layers,
      animals: !combat,
      animatedProps: true,
      propAlpha: combat ? COMBAT_PROP_ALPHA : 1,
    };
  }
  return {
    layers: atmosphere.layers.filter((layer) => !layer.secondary),
    animals: false,
    animatedProps: false,
    propAlpha: combat ? COMBAT_PROP_ALPHA : 1,
  };
}
