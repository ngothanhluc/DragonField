/**
 * Accumulate fractional damage into whole damage.
 *
 * Why: poison (1 dps × 16 ms/frame), crit ×2, execute +50% and the 50% explosion
 * all produce fractions. Subtracting straight from boss health over thousands of frames gives
 * `54.00000000000001`, and the HUD prints exactly that. Keeping **health integral** by
 * subtracting only the whole part, leaving the remainder in `carry` for the next frame — total
 * damage over time is unchanged, but there is no float noise.
 *
 * Pure functions, no `cc` import; BossView (`game/`) and the boss sim share them.
 */
export interface DamageStep {
  /** Remaining fraction, always in [0, 1). */
  readonly carry: number;
  /** Whole damage applied this frame. */
  readonly whole: number;
}

/** Below this threshold treat as 0 so `0.999999999` does not stay stuck in carry forever. */
const EPSILON = 1e-9;

/**
 * `carry + amount` → the whole part to subtract from health + the fraction kept back.
 * A negative/NaN/Infinity `amount` is a no-op (a broken config must not heal).
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
