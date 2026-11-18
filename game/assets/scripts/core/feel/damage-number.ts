/**
 * Số damage bay lên (ticket #2).
 * Hợp đồng: xem tests/core/juice.test.ts.
 */

export interface DamagePopupOptions {
  readonly lifetimeMs: number;
  /** Bay lên bao nhiêu tile trong cả đời. */
  readonly riseTiles: number;
  readonly crit: boolean;
}

export interface DamagePopupState {
  /** Đã bay lên bao nhiêu tile (dương = lên). */
  readonly rise: number;
  /** 1 = rõ, 0 = mất. */
  readonly alpha: number;
  readonly scale: number;
}

/** Crit to hơn số thường để đọc bằng mắt giữa đám đông. */
export const CRIT_POPUP_SCALE = 1.4;

/**
 * Trạng thái popup sau `elapsedMs`: bay lên đều theo thời gian, mờ dần tuyến
 * tính, crit to hơn chút. Hết đời (hoặc quá) thì alpha 0, đã bay đủ `riseTiles`.
 */
export function damagePopupState(
  elapsedMs: number,
  options: DamagePopupOptions,
): DamagePopupState {
  const lifetime = options.lifetimeMs;
  const t =
    Number.isFinite(lifetime) && lifetime > 0
      ? Math.min(1, Math.max(0, (Number.isFinite(elapsedMs) ? elapsedMs : 0) / lifetime))
      : 1;

  return {
    rise: options.riseTiles * t,
    alpha: 1 - t,
    scale: options.crit ? CRIT_POPUP_SCALE : 1,
  };
}

/** Số hiển thị: làm tròn về số nguyên, crit thêm `!`. */
export function formatDamage(amount: number, crit: boolean): string {
  const rounded = Number.isFinite(amount) ? Math.round(amount) : 0;
  return crit ? `${rounded}!` : String(rounded);
}
