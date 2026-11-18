/**
 * One part of settings. Split out because both the save and the Settings screen use it, and so
 * `save-data.ts` does not have to redefine the shape.
 *
 * The last two fields are accessibility (ticket #2): motion-sensitive players can turn off
 * shake, and damage numbers are off by default until the player enables them.
 * `effects` (ticket #3) is the Full/Reduced VFX switch: Reduced drops trails, auras and
 * secondary particles, but keeps impacts and telegraphs.
 */
import type { EffectsMode } from '../vfx/weapon-vfx';

export interface Settings {
  /** Master volume 0..1. */
  readonly volume: number;
  readonly fullscreen: boolean;
  /** Screen shake on hit/explosion/boss impact (on by default). */
  readonly screenShake: boolean;
  /** Damage numbers floating up on hit (off by default). */
  readonly damageNumbers: boolean;
  /** VFX level: `full` (default) or `reduced`. */
  readonly effects: EffectsMode;
}

/** GDD §10 uses 0.8 as the default. */
export const DEFAULT_VOLUME = 0.8;

/** Each left/right press on the Volume row moves 10%. */
export const VOLUME_STEP = 0.1;

export const DEFAULT_SETTINGS: Settings = {
  volume: DEFAULT_VOLUME,
  fullscreen: false,
  screenShake: true,
  damageNumbers: false,
  effects: 'full',
};

/**
 * Clamp volume into 0..1. NaN/Infinity (broken data, a failed `parseFloat`) returns the
 * default instead of 0 — volume 0 looks like the game lost its audio, which is harder to debug.
 */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * Move `steps` × 10% from the current volume (negative = quieter). Rounds to 1 decimal
 * place so 0.8 → 0.9 does not become 0.8999999999999999 when displayed/serialized.
 */
export function stepVolume(volume: number, steps: number): number {
  const current = clampVolume(volume);
  const delta = Number.isFinite(steps) ? Math.trunc(steps) * VOLUME_STEP : 0;
  return clampVolume(Math.round((current + delta) * 10) / 10);
}

/**
 * Normalised settings: volume clamped, missing/mistyped fields take defaults.
 * Takes `Partial` because data from an old save may lack fields.
 *
 * Returns a **plain object** with all 5 own keys in serialize order (volume, fullscreen,
 * screenShake, damageNumbers, effects) — spread/JSON.stringify/direct reads all behave correctly.
 */
export function applySettings(settings: Partial<Settings> = {}): Settings {
  const volume = settings.volume === undefined ? DEFAULT_VOLUME : settings.volume;
  return {
    volume: clampVolume(volume),
    fullscreen: typeof settings.fullscreen === 'boolean' ? settings.fullscreen : DEFAULT_SETTINGS.fullscreen,
    screenShake:
      typeof settings.screenShake === 'boolean' ? settings.screenShake : DEFAULT_SETTINGS.screenShake,
    damageNumbers:
      typeof settings.damageNumbers === 'boolean'
        ? settings.damageNumbers
        : DEFAULT_SETTINGS.damageNumbers,
    effects: settings.effects === 'reduced' ? 'reduced' : DEFAULT_SETTINGS.effects,
  };
}
