/**
 * Per-chapter atmosphere config (#6). STUB written by the orchestrator with the agreed
 * signatures only; the executor implements it. Pure TS: must not import 'cc'.
 *
 * Source data: `assets/resources/data/atmosphere.json` (one entry per chapter, 1–4).
 */
import type { EffectsMode } from '../vfx/weapon-vfx';

export const ATMOSPHERE_LAYER_KINDS = [
  'raylight',
  'leaves',
  'fog',
  'ripples',
  'ash',
  'vignette',
  'sand',
  'heat-haze',
] as const;
export type AtmosphereLayerKind = (typeof ATMOSPHERE_LAYER_KINDS)[number];

/**
 * Where a layer draws. `under-actors`: above the tile map, below obstacles/actors/bullets.
 * `over-actors`: above the world, below the HUD — must stay low alpha so it never hides
 * telegraphs or projectiles.
 */
export type AtmosphereDepth = 'under-actors' | 'over-actors';

export interface AtmosphereLayer {
  readonly kind: AtmosphereLayerKind;
  /** Secondary = particles/extra motion; Effects Reduced drops these. */
  readonly secondary: boolean;
  readonly depth: AtmosphereDepth;
  /** Manifest key in `animations.json` (e.g. `fx.raylight`); `null` = drawn with `Graphics` only. */
  readonly sprite: string | null;
  /** Peak opacity, 0 < opacity ≤ 1. */
  readonly opacity: number;
  /** How many sprites/particles the layer uses (≥ 1). */
  readonly count: number;
}

/** What living decor a chapter's rooms get. */
export interface DecorSpec {
  /** Manifest keys of animals (`animal.*`) picked for the chapter's rooms. */
  readonly animals: readonly string[];
  /** Manifest keys of animated props (`decor.*`: flags, flowers, plants). */
  readonly props: readonly string[];
  /** Exactly this many animals per room. */
  readonly animalsPerRoom: number;
  /** Exactly this many animated props per room. */
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
  /** Animals are created at all. */
  readonly animals: boolean;
  /** Animated props (flags/flowers/plants) are created at all. */
  readonly animatedProps: boolean;
}

/** Validate raw JSON; throws naming the broken chapter/layer/field. */
export function parseAtmosphereConfig(_raw: unknown): AtmosphereConfig {
  throw new Error('not implemented');
}

/** The chapter's atmosphere, or `null` when the chapter has none. */
export function chapterAtmosphere(
  _config: AtmosphereConfig,
  _chapter: number,
): ChapterAtmosphere | null {
  throw new Error('not implemented');
}

/** Full: everything. Reduced: only non-secondary layers, no animals, no animated props. */
export function visibleAtmosphere(
  _atmosphere: ChapterAtmosphere,
  _mode: EffectsMode,
): VisibleAtmosphere {
  throw new Error('not implemented');
}
