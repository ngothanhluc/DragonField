/**
 * Telegraph duration (GDD §4, ADR-008). Enemies have no attack frame, so
 * the telegraph is the only signal telling the player an attack is coming.
 *
 * Pure arithmetic: knows nothing about the engine, scene or FX. The adapter uses
 * `telegraphProgress` to scale the `Magic/Circle` ring under the enemy's feet.
 *
 * Enemy numbers come from `config/tuning.json` (`enemies.roles.<role>.telegraphMs`).
 * The elite chaser uses `enemies.elite.chaser.pounceTelegraphMs` because the pounce
 * (the elite's extra attack) is the only thing it telegraphs.
 * Bosses keep 800 ms here because boss patterns are owned by `core/boss/` and are not yet
 * in the regular enemy tuning table.
 */
import { ENEMY_TUNING } from '../enemies/tuning';

export const TELEGRAPH_MS = {
  chaser: ENEMY_TUNING.elite.chaser.pounceTelegraphMs,
  caster: ENEMY_TUNING.roles.caster.telegraphMs,
  tank: ENEMY_TUNING.roles.tank.telegraphMs,
  sniper: ENEMY_TUNING.roles.sniper.telegraphMs,
  boss: 800,
} as const;

export type TelegraphKind = keyof typeof TELEGRAPH_MS;

/** Has `durationMs` elapsed since `startedMs` (the boundary counts as done)? */
export function isTelegraphElapsed(startedMs: number, nowMs: number, durationMs: number): boolean {
  return nowMs - startedMs >= durationMs;
}

/** Like above but looks up the duration by enemy kind. */
export function isTelegraphComplete(
  startedMs: number,
  nowMs: number,
  kind: TelegraphKind,
): boolean {
  return isTelegraphElapsed(startedMs, nowMs, TELEGRAPH_MS[kind]);
}

/** Progress 0..1 to draw the FX; outside the telegraph window it clamps to 0 or 1. */
export function telegraphProgress(
  startedMs: number,
  nowMs: number,
  kind: TelegraphKind,
): number {
  const elapsed = nowMs - startedMs;
  if (!(elapsed > 0)) return 0;

  const progress = elapsed / TELEGRAPH_MS[kind];
  return progress > 1 ? 1 : progress;
}
