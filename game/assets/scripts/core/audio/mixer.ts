/**
 * Pure perceptual audio mixer and smooth music ducking (M15-T3).
 *
 * Maps `[0, 1]` UI volume sliders through a squared gain curve (`v * v`) so perceptual loudness
 * changes evenly across the slider travel instead of bunching into the bottom fifth, keeps music
 * headroom below combat SFX (`MUSIC_HEADROOM`), and smoothly ducks music via frame-rate-independent
 * exponential smoothing while Pause or Level-up (`skill-pick`) is open.
 *
 * Pure TS: zero `cc` imports.
 */

/** Default normalized slider level for both Music and SFX channels. */
export const DEFAULT_CHANNEL_VOLUME = 0.8;

/** Headroom multiplier applied to Music so combat/UI SFX remain clear over the soundtrack. */
export const MUSIC_HEADROOM = 0.55;

/** Target multiplier applied to Music gain while ducked (Pause or Level-up modal open). */
export const MUSIC_DUCK_FACTOR = 0.35;

/** Exponential smoothing rate (`1/s`) for music ducking transitions. */
export const MUSIC_DUCK_RATE = 10;

/** Snap threshold around the target duck factor so settled channels stop touching WebAudio gain. */
export const MUSIC_DUCK_EPSILON = 0.002;

export interface ChannelGains {
  readonly musicGain: number;
  readonly sfxGain: number;
}

/**
 * Clamp a normalized `[0, 1]` slider or factor input cleanly, mapping non-finite values (`NaN`,
 * `±Infinity`) and `-0` / negatives to `+0`.
 */
export function clampVolume01(level01: number): number {
  if (!Number.isFinite(level01) || level01 <= 0) return 0;
  if (level01 >= 1) return 1;
  return level01;
}

/**
 * Perceptual squared gain curve: clamps `level01` to `[0, 1]` (non-finite -> `0`) and returns
 * `v * v` (`0 -> 0`, `0.5 -> 0.25`, `0.8 -> 0.64`, `1 -> 1`).
 */
export function squaredGain(level01: number): number {
  const v = clampVolume01(level01);
  return v * v;
}

/**
 * Compute linear `AudioSource.volume` gains for independent Music and SFX channels.
 * Ducking attenuates only `musicGain` so UI/level-up SFX play at their full configured gain.
 */
export function computeChannelGains(
  musicLevel: number,
  sfxLevel: number,
  duckFactor = 1,
): ChannelGains {
  const safeDuck = clampVolume01(duckFactor);
  const sfxGain = squaredGain(sfxLevel);
  const rawMusicGain = squaredGain(musicLevel) * MUSIC_HEADROOM * safeDuck;
  return {
    musicGain: rawMusicGain === 0 ? 0 : rawMusicGain,
    sfxGain,
  };
}

/**
 * Frame-rate-independent exponential smoother for music ducking between `1` (normal) and
 * `MUSIC_DUCK_FACTOR` (ducked). `step(dtSec)` returns `true` only when `factor` actually changed.
 */
export class MusicDucker {
  private ducked = false;
  private currentFactor = 1;
  private readonly duckFactor: number;
  private readonly rate: number;
  private readonly epsilon: number;

  constructor(
    duckFactor: number = MUSIC_DUCK_FACTOR,
    rate: number = MUSIC_DUCK_RATE,
    epsilon: number = MUSIC_DUCK_EPSILON,
  ) {
    this.duckFactor = Number.isFinite(duckFactor)
      ? Math.min(1, Math.max(0, duckFactor))
      : MUSIC_DUCK_FACTOR;
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : MUSIC_DUCK_RATE;
    this.epsilon =
      Number.isFinite(epsilon) && epsilon > 0 ? epsilon : MUSIC_DUCK_EPSILON;
  }

  get isDucked(): boolean {
    return this.ducked;
  }

  get factor(): number {
    return this.currentFactor;
  }

  setDucked(ducked: boolean): void {
    this.ducked = Boolean(ducked);
  }

  /**
   * Advance the ducking envelope by `dtSec` seconds using `1 - Math.exp(-rate * dtSec)`.
   * Snaps cleanly within `epsilon` (`0.002`) and returns `true` iff `factor` changed.
   */
  step(dtSec: number): boolean {
    if (!Number.isFinite(dtSec) || dtSec <= 0) return false;

    const target = this.ducked ? this.duckFactor : 1;
    if (this.currentFactor === target) return false;

    const alpha = 1 - Math.exp(-this.rate * dtSec);
    const next = this.currentFactor + (target - this.currentFactor) * alpha;
    const snapped = Math.abs(target - next) <= this.epsilon ? target : next;
    const clamped = Math.min(1, Math.max(this.duckFactor, snapped));

    if (clamped === this.currentFactor) return false;
    this.currentFactor = clamped;
    return true;
  }

  reset(): void {
    this.ducked = false;
    this.currentFactor = 1;
  }
}
