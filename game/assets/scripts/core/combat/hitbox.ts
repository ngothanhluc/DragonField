/**
 * Swept hitbox for brute/tank charges and for projectiles.
 *
 * Why a sweep instead of only comparing end-of-frame positions: a tank charges at 7 tiles/s, and in the
 * worst frame (adapter clamps `MAX_STEP_MS = 50`) it covers 0.35 tiles. Adding both radii
 * (0.4 + 0.25) still cannot tunnel through the player, but that number depends on
 * tuning and the frame cap — change either and the hitbox starts slipping through the
 * player with nobody noticing. Sweeping the travelled segment removes that assumption and lets
 * tests answer "did the charge hit" with pure arithmetic.
 *
 * Geometry: minimum distance from the target centre to the `from -> to` segment; a hit when
 * `<= reach + targetRadius`.
 */
import { distanceSquared, type Vec2 } from '../math/vec2';

/**
 * Does the `from -> to` segment pass through the circle (`target`, `targetRadiusTiles`)
 * for a moving object of radius `reachTiles`?
 *
 * - `from === to` reduces to comparing two circles at one point.
 * - Touching at exactly one point still counts as a hit (closed boundary), same convention as `hitsCircle`.
 * - `reachTiles` defaults to 0: does the segment intersect the circle.
 */
export function segmentHitsCircle(
  from: Vec2,
  to: Vec2,
  target: Vec2,
  targetRadiusTiles: number,
  reachTiles = 0,
): boolean {
  const reach = Math.max(0, targetRadiusTiles) + Math.max(0, reachTiles);
  return closestPointDistanceSquared(from, to, target) <= reach * reach;
}

/** Squared distance from `point` to the `from -> to` segment. */
export function closestPointDistanceSquared(from: Vec2, to: Vec2, point: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return distanceSquared(from, point);

  // Project the point onto the line, clamp to [0, 1] to get the nearest point on the segment.
  const raw = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  const nearest: Vec2 = { x: from.x + dx * t, y: from.y + dy * t };
  return distanceSquared(nearest, point);
}
