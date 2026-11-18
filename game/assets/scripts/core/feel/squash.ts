/** Squash/stretch (ticket #2). Hợp đồng: xem tests/core/juice.test.ts. */
import type { Vec2 } from '../math/vec2';

const REST: Vec2 = { x: 1, y: 1 };

/**
 * Biến dạng giữ diện tích: `x = 1 + amount · (1 − e(t))`, `y = 1 / x`, với
 * `e` là ease-out cubic đi 0 → 1 trong `durationMs`.
 *
 * `amount` dương = bẹt ngang, cao lên; âm = bóp dọc, dài ra. Hết thời gian trả
 * đúng `{x: 1, y: 1}` để node về scale gốc tuyệt đối (không trôi).
 */
export function squashScale(elapsedMs: number, durationMs: number, amount: number): Vec2 {
  if (!(durationMs > 0) || !Number.isFinite(elapsedMs) || elapsedMs >= durationMs) {
    return { ...REST };
  }

  const t = Math.max(0, elapsedMs) / durationMs;
  // Ease-out cubic: (1 − e(t)) = (1 − t)³ → bắt đầu biến dạng mạnh nhất, tắt dần.
  const remaining = (1 - t) * (1 - t) * (1 - t);
  const x = 1 + amount * remaining;
  if (!(x > 0) || !Number.isFinite(x)) return { ...REST };

  return { x, y: 1 / x };
}
