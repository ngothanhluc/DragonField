/**
 * Đường bay coin về HUD (ticket #2).
 * Hợp đồng: xem tests/core/juice.test.ts.
 */
import type { Vec2 } from '../math/vec2';

/**
 * Vị trí coin ở tiến độ `t` (0 → 1) trên cung Bezier bậc 2 từ `from` tới `to`.
 *
 * Điểm điều khiển = trung điểm + pháp tuyến · 2·`arcHeight`, nên ở `t = 0.5`
 * coin cách đường thẳng đúng `arcHeight`. `arcHeight = 0` là bay thẳng.
 * `t` ngoài [0, 1] bị kẹp, và hai đầu trả đúng object vào/ra.
 */
export function coinFlyPosition(from: Vec2, to: Vec2, t: number, arcHeight: number): Vec2 {
  if (!Number.isFinite(t) || t <= 0) return from;
  if (t >= 1) return to;

  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const lift = Number.isFinite(arcHeight) ? arcHeight : 0;
  // Pháp tuyến đơn vị của đoạn thẳng; đoạn dài 0 thì không có cung để vẽ.
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
