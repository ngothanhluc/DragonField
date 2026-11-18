import { distanceSquared, type Vec2 } from '../math/vec2';

export interface Targetable {
  readonly id: string;
  readonly position: Vec2;
  readonly alive: boolean;
}

/**
 * Choose a target for auto-aim: the nearest living enemy within range.
 *
 * Distance ties break on increasing `id` so the result is deterministic —
 * otherwise array iteration order would decide the target and tests would be flaky.
 */
export function findNearestTarget(
  from: Vec2,
  targets: readonly Targetable[],
  maxRange: number,
): Targetable | null {
  const maxRangeSquared = maxRange * maxRange;
  let best: Targetable | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const candidate of targets) {
    if (!candidate.alive) continue;

    const d = distanceSquared(from, candidate.position);
    if (d > maxRangeSquared) continue;

    const closer = d < bestDistanceSquared;
    const tieButLowerId = d === bestDistanceSquared && best !== null && candidate.id < best.id;

    if (closer || tieButLowerId) {
      best = candidate;
      bestDistanceSquared = d;
    }
  }

  return best;
}
