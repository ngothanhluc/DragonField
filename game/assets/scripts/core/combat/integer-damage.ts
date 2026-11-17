/**
 * Cộng dồn damage lẻ thành damage nguyên.
 *
 * Vì sao cần: poison (1 dps × 16 ms/frame), crit ×2, execute +50% và vụ nổ
 * 50% đều sinh số lẻ. Trừ thẳng vào máu boss qua hàng nghìn frame sẽ ra
 * `54.00000000000001`, và HUD in đúng con số đó. Giữ **máu là số nguyên** bằng
 * cách chỉ trừ phần nguyên, còn phần lẻ nằm trong `carry` cho frame sau — tổng
 * damage theo thời gian không đổi, nhưng không còn nhiễu float.
 *
 * Hàm thuần, không import `cc`; BossView (`game/`) và boss sim dùng chung.
 */
export interface DamageStep {
  /** Phần lẻ còn lại, luôn trong [0, 1). */
  readonly carry: number;
  /** Số damage nguyên được áp frame này. */
  readonly whole: number;
}

/** Dưới ngưỡng này coi như 0 để `0.999999999` không kẹt carry mãi. */
const EPSILON = 1e-9;

/**
 * `carry + amount` → phần nguyên để trừ máu + phần lẻ giữ lại.
 * `amount` âm/NaN/Infinity là no-op (config hỏng không được hồi máu).
 */
export function accumulateDamage(carry: number, amount: number): DamageStep {
  const safeCarry = Number.isFinite(carry) && carry > 0 ? carry : 0;
  if (!Number.isFinite(amount) || amount <= 0) {
    return { carry: safeCarry, whole: 0 };
  }

  const total = safeCarry + amount;
  const whole = Math.floor(total + EPSILON);
  if (!Number.isFinite(whole) || whole <= 0) {
    return { carry: total >= 0 ? total : 0, whole: 0 };
  }

  return { carry: Math.max(0, total - whole), whole };
}
