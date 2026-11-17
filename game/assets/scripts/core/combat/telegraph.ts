/**
 * Thời lượng telegraph (GDD §4, ADR-008). Enemy không có frame đòn, nên
 * telegraph là tín hiệu duy nhất cho người chơi biết đòn sắp ra.
 *
 * Thuần số học: không biết gì về engine, scene hay FX. Adapter dùng
 * `telegraphProgress` để scale vòng `Magic/Circle` dưới chân enemy.
 *
 * Số của enemy đọc từ `config/tuning.json` (`enemies.roles.<role>.telegraphMs`).
 * Riêng chaser elite dùng `enemies.elite.chaser.pounceTelegraphMs` vì cú lao
 * (đòn thêm của bản elite) là thứ duy nhất nó telegraph.
 * Boss giữ 800 ms ở đây vì pattern boss do `core/boss/` sở hữu và chưa nằm
 * trong bảng tune enemy thường.
 */
import { ENEMY_TUNING } from '../enemies/tuning';

export const TELEGRAPH_MS = {
  chaser: ENEMY_TUNING.elite.chaser.pounceTelegraphMs,
  caster: ENEMY_TUNING.roles.caster.telegraphMs,
  tank: ENEMY_TUNING.roles.tank.telegraphMs,
  boss: 800,
} as const;

export type TelegraphKind = keyof typeof TELEGRAPH_MS;

/** Đã đủ `durationMs` kể từ `startedMs` chưa (biên tính là xong). */
export function isTelegraphElapsed(startedMs: number, nowMs: number, durationMs: number): boolean {
  return nowMs - startedMs >= durationMs;
}

/** Như trên nhưng tra thời lượng theo loại enemy. */
export function isTelegraphComplete(
  startedMs: number,
  nowMs: number,
  kind: TelegraphKind,
): boolean {
  return isTelegraphElapsed(startedMs, nowMs, TELEGRAPH_MS[kind]);
}

/** Tiến độ 0..1 để vẽ FX; ngoài cửa sổ telegraph thì kẹp về 0 hoặc 1. */
export function telegraphProgress(
  startedMs: number,
  nowMs: number,
  kind: TelegraphKind,
): number {
  const elapsed = nowMs - startedMs;
  if (!(elapsed > 0)) return 0;

  const progress = elapsed / TELEGRAPH_MS[kind];
  return progress > 1 ? 1 : progress;
}
