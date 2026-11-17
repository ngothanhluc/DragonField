/**
 * Hitbox quét (swept) cho đòn lao của brute/tank và cho đạn.
 *
 * Vì sao cần quét thay vì chỉ so vị trí cuối frame: tank lao 7 tile/s, ở frame
 * xấu nhất (adapter kẹp `MAX_STEP_MS = 50`) nó đi 0.35 tile. Cộng bán kính hai
 * bên (0.4 + 0.25) thì chưa xuyên qua được player, nhưng con số đó phụ thuộc
 * tuning và trần frame — đổi một trong hai là hitbox bắt đầu trượt qua người
 * chơi mà không ai thấy. Quét đoạn đường đi loại bỏ hẳn giả định đó, và cho phép
 * test đúng câu hỏi "cú lao có trúng không" bằng số học thuần.
 *
 * Hình học: khoảng cách nhỏ nhất từ tâm mục tiêu tới đoạn `from -> to`; trúng khi
 * `<= reach + targetRadius`.
 */
import { distanceSquared, type Vec2 } from '../math/vec2';

/**
 * Đoạn `from -> to` có đi qua hình tròn (`target`, `targetRadiusTiles`) không,
 * với vật di chuyển có bán kính `reachTiles`.
 *
 * - `from === to` thì chỉ còn phép so hai hình tròn tại một điểm.
 * - Chạm đúng một điểm vẫn tính là trúng (biên đóng), cùng quy ước `hitsCircle`.
 * - `reachTiles` mặc định 0: đoạn đường có cắt hình tròn không.
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

/** Bình phương khoảng cách từ `point` tới đoạn `from -> to`. */
export function closestPointDistanceSquared(from: Vec2, to: Vec2, point: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return distanceSquared(from, point);

  // Chiếu point lên đường thẳng, kẹp về [0, 1] để lấy điểm gần nhất trên đoạn.
  const raw = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  const nearest: Vec2 = { x: from.x + dx * t, y: from.y + dy * t };
  return distanceSquared(nearest, point);
}
