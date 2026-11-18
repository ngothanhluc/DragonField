/**
 * Damage numbers floating up (ticket #2).
 * Contract: see tests/core/juice.test.ts.
 */

export interface DamagePopupOptions {
  readonly lifetimeMs: number;
  /** How many tiles it rises over its whole life. */
  readonly riseTiles: number;
  readonly crit: boolean;
}

export interface DamagePopupState {
  /** How many tiles it has risen (positive = up). */
  readonly rise: number;
  /** 1 = visible, 0 = gone. */
  readonly alpha: number;
  readonly scale: number;
}

/** Crits are bigger than normal numbers so they read at a glance in a crowd. */
export const CRIT_POPUP_SCALE = 1.4;

/**
 * Popup state after `elapsedMs`: rises steadily over time, fades linearly,
 * crits slightly bigger. Past its life (or beyond) alpha is 0 and it has risen `riseTiles`.
 */
export function damagePopupState(
  elapsedMs: number,
  options: DamagePopupOptions,
): DamagePopupState {
  const lifetime = options.lifetimeMs;
  const t =
    Number.isFinite(lifetime) && lifetime > 0
      ? Math.min(1, Math.max(0, (Number.isFinite(elapsedMs) ? elapsedMs : 0) / lifetime))
      : 1;

  return {
    rise: options.riseTiles * t,
    alpha: 1 - t,
    scale: options.crit ? CRIT_POPUP_SCALE : 1,
  };
}

/** Display number: rounded to an integer, crits get a `!`. */
export function formatDamage(amount: number, crit: boolean): string {
  const rounded = Number.isFinite(amount) ? Math.round(amount) : 0;
  return crit ? `${rounded}!` : String(rounded);
}
