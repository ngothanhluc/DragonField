import { describe, expect, it } from 'vitest';
import { accumulateDamage } from '../../assets/scripts/core/combat/integer-damage';

/** Áp damage qua accumulator như BossView để chứng minh máu không nhiễm float. */
function applyAll(hp: number, hits: readonly number[]): { hp: number; carry: number } {
  let carry = 0;
  for (const hit of hits) {
    const step = accumulateDamage(carry, hit);
    carry = step.carry;
    hp = Math.max(0, hp - step.whole);
  }
  return { hp, carry };
}

describe('accumulateDamage — máu boss luôn nguyên', () => {
  it('0.3 × 20 lần cho đúng 6 damage, không ra 54.00000000000001', () => {
    const { hp, carry } = applyAll(60, Array.from({ length: 20 }, () => 0.3));
    expect(hp).toBe(54);
    expect(Number.isInteger(hp)).toBe(true);
    expect(carry).toBeLessThan(1);
  });

  it('poison 16 ms/frame: 1 dps trong 1 s = đúng 1 máu', () => {
    const hits = Array.from({ length: 62 }, () => (1 * 16) / 1000);
    const { hp } = applyAll(60, hits);
    // 62 × 0.016 = 0.992 → chưa đủ 1 máu; frame tiếp mới trừ.
    expect(hp).toBe(60);
    const next = accumulateDamage(0.992, 0.016);
    expect(next.whole).toBe(1);
  });

  it('crit/execute lẻ cộng dồn đúng tổng', () => {
    const { hp } = applyAll(60, [1.5, 1.5, 2.5, 0.5]);
    expect(hp).toBe(54);
  });

  it('amount âm/NaN/Infinity là no-op, carry hỏng được làm sạch', () => {
    expect(accumulateDamage(0.4, -3)).toEqual({ carry: 0.4, whole: 0 });
    expect(accumulateDamage(0.4, Number.NaN)).toEqual({ carry: 0.4, whole: 0 });
    expect(accumulateDamage(0.4, Number.POSITIVE_INFINITY)).toEqual({ carry: 0.4, whole: 0 });
    expect(accumulateDamage(-5, 1)).toEqual({ carry: 0, whole: 1 });
  });

  it('sai số sát 1 được làm tròn thành 1 thay vì kẹt carry', () => {
    expect(accumulateDamage(0.999999999, 0)).toEqual({ carry: 0.999999999, whole: 0 });
    expect(accumulateDamage(0.9999999995, 0.0000000001).whole).toBe(1);
  });
});
