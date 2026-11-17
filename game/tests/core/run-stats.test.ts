import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { applyUpgradesToBaseline, metaBaseline } from '../../assets/scripts/core/meta/run-stats';
import { createDefaultUpgrades } from '../../assets/scripts/core/meta/upgrades';
import { computeDerivedStats } from '../../assets/scripts/core/skills/derived-stats';

describe('applyUpgradesToBaseline', () => {
  it('cấp 0 giữ nguyên baseline', () => {
    expect(
      applyUpgradesToBaseline(DEFAULT_COMBAT, {
        maxHeartsBonus: 0,
        damageMultiplier: 1,
        fireRateMultiplier: 1,
      }),
    ).toEqual(DEFAULT_COMBAT);
  });

  it('cộng tim, nhân damage và nhịp bắn trên chỉ số gốc', () => {
    const base = applyUpgradesToBaseline(DEFAULT_COMBAT, {
      maxHeartsBonus: 3,
      damageMultiplier: 1.2,
      fireRateMultiplier: 1.15,
    });

    expect(base.playerMaxHearts).toBe(DEFAULT_COMBAT.playerMaxHearts + 3);
    expect(base.damage).toBeCloseTo(DEFAULT_COMBAT.damage * 1.2, 10);
    expect(base.fireRatePerSecond).toBeCloseTo(DEFAULT_COMBAT.fireRatePerSecond * 1.15, 10);
  });

  it('không sửa baseline truyền vào', () => {
    const before = { ...DEFAULT_COMBAT };
    applyUpgradesToBaseline(DEFAULT_COMBAT, {
      maxHeartsBonus: 2,
      damageMultiplier: 1.5,
      fireRateMultiplier: 1.3,
    });
    expect(DEFAULT_COMBAT).toEqual(before);
  });

  it('save max track cho bonus max: +5 tim, +50% damage, +30% nhịp bắn', () => {
    const state = {
      upgrades: { hearts: 5, damage: 10, fireRate: 10 },
    };
    const base = metaBaseline(DEFAULT_COMBAT, state);

    expect(base.playerMaxHearts).toBe(11);
    expect(base.damage).toBeCloseTo(1.5, 10);
    expect(base.fireRatePerSecond).toBeCloseTo(2.6, 10);
  });

  it('skill layer cộng trên baseline của meta, không thay thế nó', () => {
    const base = metaBaseline(DEFAULT_COMBAT, {
      upgrades: { hearts: 1, damage: 2, fireRate: 0 },
    });
    const stats = computeDerivedStats(new Map<string, number>(), base);

    expect(stats.maxHearts).toBe(7);
    expect(stats.damage).toBeCloseTo(1.1, 10);
    expect(stats.fireRatePerSecond).toBeCloseTo(2, 10);
  });

  it('dữ liệu hỏng không tạo chỉ số âm/NaN', () => {
    const base = applyUpgradesToBaseline(DEFAULT_COMBAT, {
      maxHeartsBonus: Number.NaN,
      damageMultiplier: Number.NaN,
      fireRateMultiplier: -4,
    });

    expect(base.playerMaxHearts).toBeGreaterThanOrEqual(1);
    expect(base.damage).toBe(0);
    expect(base.fireRatePerSecond).toBe(0);
  });

  it('save mới không có upgrade vẫn chạy', () => {
    const base = metaBaseline(DEFAULT_COMBAT, { upgrades: createDefaultUpgrades() });
    expect(base.damage).toBe(DEFAULT_COMBAT.damage);
    expect(base.fireRatePerSecond).toBe(DEFAULT_COMBAT.fireRatePerSecond);
    expect(base.playerMaxHearts).toBe(DEFAULT_COMBAT.playerMaxHearts);
  });
});
