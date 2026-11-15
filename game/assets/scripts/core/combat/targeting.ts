import { distanceSquared, type Vec2 } from '../math/vec2';

export interface Targetable {
  readonly id: string;
  readonly position: Vec2;
  readonly alive: boolean;
}

/**
 * Chọn mục tiêu cho auto-aim: enemy còn sống, gần nhất, trong tầm.
 *
 * Hoà khoảng cách được phá bằng `id` tăng dần để kết quả tất định —
 * nếu không, thứ tự lặp của mảng sẽ quyết định mục tiêu và test sẽ flaky.
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
