/**
 * Mid-combat level-up resume safety wave (M12, ADR-021).
 *
 * Closing the level-up skill pick modal emits a radial knockback wave that pushes nearby enemies
 * away from the player and grants a 0.6 s (`LEVEL_UP_RESUME_IFRAME_MS`) invulnerability window.
 * Enemy bullets are intentionally untouched to preserve bullet-hell dodging tension.
 *
 * Pure logic — zero `cc` imports, zero mutation of inputs; produces `KnockbackState` values that
 * plug directly into `core/combat/knockback.ts` (`stepKnockback`).
 */
import { startKnockback, type KnockbackState } from '../combat/knockback';
import { XP_TUNING, type LevelUpWaveTuning } from '../enemies/tuning';
import type { Vec2 } from '../math/vec2';

export interface KnockbackTarget {
  readonly id: string;
  readonly position: Vec2;
}

export interface LevelUpKnockbackHit {
  readonly id: string;
  readonly knockback: KnockbackState;
}

/** Resume i-frame duration after closing the level-up modal, ms (ADR-021: 600 ms from tuning.json). */
export const LEVEL_UP_RESUME_IFRAME_MS: number = XP_TUNING.levelUpWave.resumeInvulnerabilityMs;

/** Read resume i-frame duration from an injectable tuning block (for tests/overrides). */
export function levelUpResumeIframeMs(
  tuning: LevelUpWaveTuning = XP_TUNING.levelUpWave,
): number {
  const ms = tuning.resumeInvulnerabilityMs;
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
}

/** Deterministic fallback angle (radians) when an enemy stands directly on top of the player. */
const COINCIDENT_ANGLE_STEP_RAD = 2.399963229728653;

/**
 * Compute radial knockback states for every enemy within `radius` tiles of `playerPos`.
 *
 * - Enemies strictly outside `radius` are unaffected (omitted from the returned list).
 * - Enemies standing directly on `playerPos` (distance ~ 0) still get pushed along a deterministic
 *   radial direction so they cannot remain stacked on the player after resuming.
 * - Operates strictly on enemies; enemy bullets are never included or cleared (ADR-021).
 */
export function computeLevelUpKnockback(
  playerPos: Vec2,
  enemies: readonly KnockbackTarget[],
  radius: number = XP_TUNING.levelUpWave.knockbackRadiusTiles,
  distance: number = XP_TUNING.levelUpWave.knockbackDistanceTiles,
  durationMs: number = XP_TUNING.levelUpWave.knockbackDurationMs,
): LevelUpKnockbackHit[] {
  if (!(radius > 0) || !(distance > 0) || !(durationMs > 0)) return [];

  const speedTilesPerSecond = distance / (durationMs / 1000);
  const hits: LevelUpKnockbackHit[] = [];

  for (let index = 0; index < enemies.length; index += 1) {
    const enemy = enemies[index];
    if (enemy === undefined) continue;

    const dx = enemy.position.x - playerPos.x;
    const dy = enemy.position.y - playerPos.y;
    const gap = Math.hypot(dx, dy);
    if (!Number.isFinite(gap) || gap > radius) continue;

    const push = startKnockback(enemy.position, playerPos, {
      distanceTiles: distance,
      durationMs,
    });
    if (push !== null) {
      hits.push({ id: enemy.id, knockback: push });
      continue;
    }

    // Enemy coincides with player: push along a deterministic radial direction so it separates cleanly.
    const angle = index * COINCIDENT_ANGLE_STEP_RAD;
    hits.push({
      id: enemy.id,
      knockback: {
        direction: { x: Math.cos(angle), y: Math.sin(angle) },
        speedTilesPerSecond,
        remainingMs: durationMs,
      },
    });
  }

  return hits;
}
