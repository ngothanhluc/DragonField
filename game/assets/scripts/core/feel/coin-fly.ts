/**
 * Coin flight path toward the HUD (ticket #2).
 * Contract: see tests/core/juice.test.ts.
 */
import type { Vec2 } from '../math/vec2';

/**
 * Coin position at progress `t` (0 → 1) on a quadratic Bezier from `from` to `to`.
 *
 * The control point = midpoint + normal · 2·`arcHeight`, so at `t = 0.5`
 * the coin is exactly `arcHeight` above the straight line. `arcHeight = 0` is a straight flight.
 * `t` outside [0, 1] clamps, and both ends return exactly the input/output object.
 */
export function coinFlyPosition(from: Vec2, to: Vec2, t: number, arcHeight: number): Vec2 {
  if (!Number.isFinite(t) || t <= 0) return from;
  if (t >= 1) return to;

  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const lift = Number.isFinite(arcHeight) ? arcHeight : 0;
  // Unit normal of the segment; a zero-length segment has no arc to draw.
  const control =
    length > 0 && lift !== 0
      ? { x: mid.x + (-dy / length) * 2 * lift, y: mid.y + (dx / length) * 2 * lift }
      : mid;

  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}
