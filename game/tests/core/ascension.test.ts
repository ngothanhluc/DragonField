import { describe, expect, it } from 'vitest';
import {
  MAX_ASCENSION,
  ascensionLabel,
  ascensionModifiers,
  ascensionSummaryLines,
  clampAscension,
  nextAscensionUnlock,
} from '../../assets/scripts/core/run/ascension';

describe('clampAscension', () => {
  it('keeps integers in 0..MAX_ASCENSION and clamps out-of-range/invalid inputs', () => {
    expect(MAX_ASCENSION).toBe(5);
    for (let tier = 0; tier <= MAX_ASCENSION; tier += 1) {
      expect(clampAscension(tier)).toBe(tier);
    }
    expect(clampAscension(-3)).toBe(0);
    expect(clampAscension(6)).toBe(5);
    expect(clampAscension(99)).toBe(5);
    expect(clampAscension(2.9)).toBe(2);
    expect(clampAscension(Number.NaN)).toBe(0);
    expect(clampAscension(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampAscension(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('ascensionModifiers', () => {
  it('returns identity modifiers for tier 0 (Normal)', () => {
    expect(ascensionModifiers(0)).toEqual({
      level: 0,
      enemyHealthMult: 1,
      enemyDamageMult: 1,
      enemySpeedMult: 1,
      bossHealthMult: 1,
      extraElitesPerRoom: 0,
      enemyFireRateMult: 1,
      shopPriceMult: 1,
      goldRewardMult: 1,
    });
  });

  it('stacks modifiers accurately across tiers 1..5', () => {
    expect(ascensionModifiers(1)).toEqual({
      level: 1,
      enemyHealthMult: 1.15,
      enemyDamageMult: 1,
      enemySpeedMult: 1,
      bossHealthMult: 1,
      extraElitesPerRoom: 1,
      enemyFireRateMult: 1,
      shopPriceMult: 1,
      goldRewardMult: 1.15,
    });

    expect(ascensionModifiers(2)).toEqual({
      level: 2,
      enemyHealthMult: 1.15,
      enemyDamageMult: 1,
      enemySpeedMult: 1.06,
      bossHealthMult: 1.2,
      extraElitesPerRoom: 1,
      enemyFireRateMult: 1,
      shopPriceMult: 1,
      goldRewardMult: 1.3,
    });

    expect(ascensionModifiers(3)).toEqual({
      level: 3,
      enemyHealthMult: 1.15,
      enemyDamageMult: 1,
      enemySpeedMult: 1.06,
      bossHealthMult: 1.2,
      extraElitesPerRoom: 1,
      enemyFireRateMult: 1.15,
      shopPriceMult: 1.2,
      goldRewardMult: 1.45,
    });

    expect(ascensionModifiers(4)).toEqual({
      level: 4,
      enemyHealthMult: 1.35,
      enemyDamageMult: 1.15,
      enemySpeedMult: 1.06,
      bossHealthMult: 1.35,
      extraElitesPerRoom: 2,
      enemyFireRateMult: 1.15,
      shopPriceMult: 1.2,
      goldRewardMult: 1.65,
    });

    expect(ascensionModifiers(5)).toEqual({
      level: 5,
      enemyHealthMult: 1.55,
      enemyDamageMult: 1.25,
      enemySpeedMult: 1.12,
      bossHealthMult: 1.55,
      extraElitesPerRoom: 3,
      enemyFireRateMult: 1.25,
      shopPriceMult: 1.35,
      goldRewardMult: 1.85,
    });
  });

  it('is monotonically non-decreasing across all stats from tier 0 to tier 5', () => {
    for (let tier = 1; tier <= MAX_ASCENSION; tier += 1) {
      const prev = ascensionModifiers(tier - 1);
      const curr = ascensionModifiers(tier);
      expect(curr.enemyHealthMult).toBeGreaterThanOrEqual(prev.enemyHealthMult);
      expect(curr.enemyDamageMult).toBeGreaterThanOrEqual(prev.enemyDamageMult);
      expect(curr.enemySpeedMult).toBeGreaterThanOrEqual(prev.enemySpeedMult);
      expect(curr.bossHealthMult).toBeGreaterThanOrEqual(prev.bossHealthMult);
      expect(curr.extraElitesPerRoom).toBeGreaterThanOrEqual(prev.extraElitesPerRoom);
      expect(curr.enemyFireRateMult).toBeGreaterThanOrEqual(prev.enemyFireRateMult);
      expect(curr.shopPriceMult).toBeGreaterThanOrEqual(prev.shopPriceMult);
      expect(curr.goldRewardMult).toBeGreaterThan(prev.goldRewardMult);
    }
  });

  it('clamps out-of-range levels passed to ascensionModifiers', () => {
    expect(ascensionModifiers(-1)).toEqual(ascensionModifiers(0));
    expect(ascensionModifiers(99)).toEqual(ascensionModifiers(5));
  });
});

describe('ascensionLabel & ascensionSummaryLines', () => {
  it('formats tier labels cleanly', () => {
    expect(ascensionLabel(0)).toBe('Normal');
    expect(ascensionLabel(1)).toBe('Ascension 1');
    expect(ascensionLabel(5)).toBe('Ascension 5');
    expect(ascensionLabel(-1)).toBe('Normal');
    expect(ascensionLabel(10)).toBe('Ascension 5');
  });

  it('formats compact Chapter Select summary lines within width bounds', () => {
    expect(ascensionSummaryLines(0)).toEqual(['Standard difficulty']);

    const t1 = ascensionSummaryLines(1);
    expect(t1.join(' ')).toContain('+1 Elite/room');
    expect(t1.join(' ')).toContain('+15% Enemy HP');
    expect(t1.join(' ')).toContain('+15% Gold');

    const t5 = ascensionSummaryLines(5);
    expect(t5.length).toBeGreaterThanOrEqual(2);
    expect(t5.length).toBeLessThanOrEqual(4);
    for (const line of t5) {
      expect(line.length).toBeLessThanOrEqual(46);
    }
    const joined = t5.join(' ');
    expect(joined).toContain('+3 Elites/room');
    expect(joined).toContain('+55% Enemy HP');
    expect(joined).toContain('+55% Boss HP');
    expect(joined).toContain('+25% Enemy DMG');
    expect(joined).toContain('+12% Speed');
    expect(joined).toContain('+25% Fire rate');
    expect(joined).toContain('+35% Shop price');
    expect(joined).toContain('+85% Gold');
  });
});

describe('nextAscensionUnlock', () => {
  it('unlocks the next tier sequentially up to MAX_ASCENSION', () => {
    expect(nextAscensionUnlock(0, 0)).toBe(1);
    expect(nextAscensionUnlock(1, 1)).toBe(2);
    expect(nextAscensionUnlock(2, 2)).toBe(3);
    expect(nextAscensionUnlock(3, 3)).toBe(4);
    expect(nextAscensionUnlock(4, 4)).toBe(5);
    expect(nextAscensionUnlock(5, 5)).toBe(5);
  });

  it('never regresses or jumps ahead when replaying a lower tier', () => {
    expect(nextAscensionUnlock(0, 3)).toBe(3);
    expect(nextAscensionUnlock(1, 3)).toBe(3);
    expect(nextAscensionUnlock(2, 3)).toBe(3);
  });

  it('ignores invalid clearedAscension without unlocking tier 1', () => {
    expect(nextAscensionUnlock(-1, 0)).toBe(0);
    expect(nextAscensionUnlock(Number.NaN, 2)).toBe(2);
  });
});
