/** Squash/stretch (ticket #2). Contract: see tests/core/juice.test.ts. */
import type { Vec2 } from '../math/vec2';

const REST: Vec2 = { x: 1, y: 1 };

/**
 * Area-preserving deformation: `x = 1 + amount · (1 − e(t))`, `y = 1 / x`, with
 * `e` an ease-out cubic going 0 → 1 over `durationMs`.
 *
 * A positive `amount` = flatter and taller; negative = squeezed vertically and longer. Past the
 * duration it returns exactly `{x: 1, y: 1}` so the node returns to its original scale (no drift).
 */
export function squashScale(elapsedMs: number, durationMs: number, amount: number): Vec2 {
  if (!(durationMs > 0) || !Number.isFinite(elapsedMs) || elapsedMs >= durationMs) {
    return { ...REST };
  }

  const t = Math.max(0, elapsedMs) / durationMs;
  // Ease-out cubic: (1 − e(t)) = (1 − t)³ → starts at maximum deformation, fades out.
  const remaining = (1 - t) * (1 - t) * (1 - t);
  const x = 1 + amount * remaining;
  if (!(x > 0) || !Number.isFinite(x)) return { ...REST };

  return { x, y: 1 / x };
}
