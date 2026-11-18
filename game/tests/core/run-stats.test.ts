import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { applyUpgradesToBaseline, metaBaseline } from '../../assets/scripts/core/meta/run-stats';
import { createDefaultUpgrades } from '../../assets/scripts/core/meta/upgrades';
import { computeDerivedStats } from '../../assets/scripts/core/skills/derived-stats';

describe('applyUpgradesToBaseline', () => {
  it('level 0 keeps the baseline', () => {
    expect(
      applyUpgradesToBaseline(DEFAULT_COMBAT, {
        maxHeartsBonus: 0,
        damageMultiplier: 1,
        fireRateMultiplier: 1,
      }),
    ).toEqual(DEFAULT_COMBAT);
  });

  it('adds hearts, multiplies damage and fire rate on the base stats', () => {
    const base = applyUpgradesToBaseline(DEFAULT_COMBAT, {
      maxHeartsBonus: 3,
      damageMultiplier: 1.2,
      fireRateMultiplier: 1.15,
    });

    expect(base.playerMaxHearts).toBe(DEFAULT_COMBAT.playerMaxHearts + 3);
    expect(base.damage).toBeCloseTo(DEFAULT_COMBAT.damage * 1.2, 10);
    expect(base.fireRatePerSecond).toBeCloseTo(DEFAULT_COMBAT.fireRatePerSecond * 1.15, 10);
  });

  it('does not modify the passed baseline', () => {
    const before = { ...DEFAULT_COMBAT };
    applyUpgradesToBaseline(DEFAULT_COMBAT, {
      maxHeartsBonus: 2,
      damageMultiplier: 1.5,
      fireRateMultiplier: 1.3,
    });
    expect(DEFAULT_COMBAT).toEqual(before);
  });

  it('a maxed save gives max bonus: +5 hearts, +50% damage, +30% fire rate', () => {
    const state = {
      upgrades: { hearts: 5, damage: 10, fireRate: 10 },
    };
    const base = metaBaseline(DEFAULT_COMBAT, state);

    expect(base.playerMaxHearts).toBe(11);
    expect(base.damage).toBeCloseTo(1.5, 10);
    expect(base.fireRatePerSecond).toBeCloseTo(2.6, 10);
  });

  it('the skill layer adds on top of the meta baseline, never replacing it', () => {
    const base = metaBaseline(DEFAULT_COMBAT, {
      upgrades: { hearts: 1, damage: 2, fireRate: 0 },
    });
    const stats = computeDerivedStats(new Map<string, number>(), base);

    expect(stats.maxHearts).toBe(7);
    expect(stats.damage).toBeCloseTo(1.1, 10);
    expect(stats.fireRatePerSecond).toBeCloseTo(2, 10);
  });

  it('broken data does not produce negative/NaN stats', () => {
    const base = applyUpgradesToBaseline(DEFAULT_COMBAT, {
      maxHeartsBonus: Number.NaN,
      damageMultiplier: Number.NaN,
      fireRateMultiplier: -4,
    });

    expect(base.playerMaxHearts).toBeGreaterThanOrEqual(1);
    expect(base.damage).toBe(0);
    expect(base.fireRatePerSecond).toBe(0);
  });

  it('a new save without upgrades still runs', () => {
    const base = metaBaseline(DEFAULT_COMBAT, { upgrades: createDefaultUpgrades() });
    expect(base.damage).toBe(DEFAULT_COMBAT.damage);
    expect(base.fireRatePerSecond).toBe(DEFAULT_COMBAT.fireRatePerSecond);
    expect(base.playerMaxHearts).toBe(DEFAULT_COMBAT.playerMaxHearts);
  });
});
