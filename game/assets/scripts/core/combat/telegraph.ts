/**
 * Thời lượng telegraph (GDD §4, ADR-008). Enemy không có frame đòn, nên
 * telegraph là tín hiệu duy nhất cho người chơi biết đòn sắp ra.
 *
 * Thuần số học: không biết gì về engine, scene hay FX. Adapter dùng
 * `telegraphProgress` để scale vòng `Magic/Circle` dưới chân enemy.
 */
export const TELEGRAPH_MS = {
  caster: 500,
  tank: 700,
  boss: 800,
} as const;

export type TelegraphKind = keyof typeof TELEGRAPH_MS;

/** Đã đủ thời gian telegraph chưa (biên tính là xong). */
export function isTelegraphComplete(
  startedMs: number,
  nowMs: number,
  kind: TelegraphKind,
): boolean {
  return nowMs - startedMs >= TELEGRAPH_MS[kind];
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
