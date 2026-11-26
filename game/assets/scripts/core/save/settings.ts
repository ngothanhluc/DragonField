/**
 * Player settings model shared by `save-data.ts` and the Settings / Pause screens.
 *
 * M15 (GDD §15.5): splits audio control into independent `musicVolume` and `sfxVolume`
 * channels (0..1, default 0.8), while retaining backwards-compatible `volume` synced across
 * legacy callers until all UI screens read the channel sliders directly.
 *
 * The accessibility fields (`screenShake`, `damageNumbers`, `effects`) apply live and round-trip
 * through the save. Legacy `cultivatorEnabled` (M10 migration flag) was retired in M14 save v4
 * once the 4-class chapter/gold unlock system landed.
 */
import type { EffectsMode } from '../vfx/weapon-vfx';

export type AudioChannel = 'music' | 'sfx';

export interface Settings {
  /** Legacy master volume 0..1 (kept synced with music/sfx channels for compatibility). */
  readonly volume: number;
  /** Background music channel volume 0..1 (M15, GDD §15.5). */
  readonly musicVolume: number;
  /** Sound effects channel volume 0..1 (M15, GDD §15.5). */
  readonly sfxVolume: number;
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

/** Each left/right press on a Volume row moves 10%. */
export const VOLUME_STEP = 0.1;

export const DEFAULT_SETTINGS: Settings = {
  volume: DEFAULT_VOLUME,
  musicVolume: DEFAULT_VOLUME,
  sfxVolume: DEFAULT_VOLUME,
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
 * Step a single audio channel (`music` or `sfx`) by `steps × 10%` on a `Settings` snapshot,
 * syncing the backwards-compatible `volume` field to `max(musicVolume, sfxVolume)`.
 * Never mutates the input.
 */
export function stepChannelVolume(
  settings: Settings,
  channel: AudioChannel,
  steps: number,
): Settings {
  const normalized = applySettings(settings);
  const nextMusic =
    channel === 'music' ? stepVolume(normalized.musicVolume, steps) : normalized.musicVolume;
  const nextSfx =
    channel === 'sfx' ? stepVolume(normalized.sfxVolume, steps) : normalized.sfxVolume;

  return {
    ...normalized,
    volume: Math.max(nextMusic, nextSfx),
    musicVolume: nextMusic,
    sfxVolume: nextSfx,
  };
}

/** Convenience wrapper stepping only the Music channel by `steps × 10%`. */
export function stepMusicVolume(settings: Settings, steps: number): Settings {
  return stepChannelVolume(settings, 'music', steps);
}

/** Convenience wrapper stepping only the SFX channel by `steps × 10%`. */
export function stepSfxVolume(settings: Settings, steps: number): Settings {
  return stepChannelVolume(settings, 'sfx', steps);
}

/**
 * Normalised settings: volumes clamped, missing/mistyped fields take defaults.
 * Takes `Partial` because data from an old save may lack fields.
 *
 * Volume resolution:
 * - If only legacy `volume` is supplied, both `musicVolume` and `sfxVolume` inherit it.
 * - If only `musicVolume` / `sfxVolume` are supplied, `volume` syncs to `max(music, sfx)`.
 * - If all three are supplied, each is clamped independently so serialized saves round-trip cleanly.
 *
 * Returns a **plain object** with all 7 own keys in canonical serialize order (`volume`,
 * `musicVolume`, `sfxVolume`, `fullscreen`, `screenShake`, `damageNumbers`, `effects`).
 */
export function applySettings(settings: Partial<Settings> = {}): Settings {
  const hasVolume = settings.volume !== undefined;
  const hasMusic = settings.musicVolume !== undefined;
  const hasSfx = settings.sfxVolume !== undefined;

  let volume: number;
  let musicVolume: number;
  let sfxVolume: number;

  if (hasVolume) {
    volume = clampVolume(settings.volume as number);
    musicVolume = hasMusic ? clampVolume(settings.musicVolume as number) : volume;
    sfxVolume = hasSfx ? clampVolume(settings.sfxVolume as number) : volume;
  } else {
    musicVolume = hasMusic ? clampVolume(settings.musicVolume as number) : DEFAULT_VOLUME;
    sfxVolume = hasSfx ? clampVolume(settings.sfxVolume as number) : DEFAULT_VOLUME;
    volume = Math.max(musicVolume, sfxVolume);
  }

  return {
    volume,
    musicVolume,
    sfxVolume,
    fullscreen:
      typeof settings.fullscreen === 'boolean' ? settings.fullscreen : DEFAULT_SETTINGS.fullscreen,
    screenShake:
      typeof settings.screenShake === 'boolean'
        ? settings.screenShake
        : DEFAULT_SETTINGS.screenShake,
    damageNumbers:
      typeof settings.damageNumbers === 'boolean'
        ? settings.damageNumbers
        : DEFAULT_SETTINGS.damageNumbers,
    effects: settings.effects === 'reduced' ? 'reduced' : DEFAULT_SETTINGS.effects,
  };
}
