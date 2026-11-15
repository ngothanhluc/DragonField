import type { Vec2 } from '../math/vec2';

/** Trạng thái 4 phím di chuyển trong một frame. */
export interface MoveInput {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/** cos(45°) = sin(45°), dùng để chuẩn hoá vector chéo. */
const DIAGONAL_COMPONENT = Math.SQRT1_2;

/**
 * Đổi phím WASD thành vector 8 hướng, dài tối đa 1.
 *
 * Phím đối nhau triệt tiêu nhau (A + D = 0), nên không cần xử lý ưu tiên phím.
 * Vector chéo được chuẩn hoá để tốc độ đi chéo bằng tốc độ đi thẳng (GDD §3).
 */
export function normalizeMoveInput(input: MoveInput): Vec2 {
  const x = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const y = (input.up ? 1 : 0) - (input.down ? 1 : 0);

  if (x === 0 && y === 0) return { x: 0, y: 0 };
  if (x !== 0 && y !== 0) return { x: x * DIAGONAL_COMPONENT, y: y * DIAGONAL_COMPONENT };
  return { x, y };
}

/** Nhân vector hướng (dài ≤ 1) với tốc độ tile/giây để ra vận tốc. */
export function velocityFromInput(input: Vec2, speedTilesPerSecond: number): Vec2 {
  return { x: input.x * speedTilesPerSecond, y: input.y * speedTilesPerSecond };
}
