import { describe, expect, it } from 'vitest';
import { ascensionModifiers } from '../../assets/scripts/core/run/ascension';
import {
  canStartEndless,
  combinedDifficultyModifiers,
  endlessModifiers,
  nextEndlessStep,
} from '../../assets/scripts/core/run/endless';

describe('canStartEndless', () => {
  it('is true only after winning Chapter 4', () => {
    expect(canStartEndless(4, true)).toBe(true);
    expect(canStartEndless(4, false)).toBe(false);
    expect(canStartEndless(1, true)).toBe(false);
    expect(canStartEndless(2, true)).toBe(false);
    expect(canStartEndless(3, true)).toBe(false);
    expect(canStartEndless(5, true)).toBe(false);
  });
});

describe('nextEndlessStep', () => {
  it('loops Ch1 -> Ch2 -> Ch3 -> Ch4 -> Ch1 (loop + 1)', () => {
    expect(nextEndlessStep(4, 0)).toEqual({ chapter: 1, loop: 1 });
    expect(nextEndlessStep(1, 1)).toEqual({ chapter: 2, loop: 1 });
    expect(nextEndlessStep(2, 1)).toEqual({ chapter: 3, loop: 1 });
    expect(nextEndlessStep(3, 1)).toEqual({ chapter: 4, loop: 1 });
    expect(nextEndlessStep(4, 1)).toEqual({ chapter: 1, loop: 2 });
    expect(nextEndlessStep(4, 4)).toEqual({ chapter: 1, loop: 5 });
  });

  it('sanitizes negative or non-finite inputs cleanly', () => {
    expect(nextEndlessStep(4, -3)).toEqual({ chapter: 1, loop: 1 });
    expect(nextEndlessStep(4, Number.NaN)).toEqual({ chapter: 1, loop: 1 });
    expect(nextEndlessStep(0, 2)).toEqual({ chapter: 2, loop: 2 });
  });
});

describe('endlessModifiers', () => {
  it('returns identity modifiers for loop 0 or negative/NaN', () => {
    const identity = {
      loop: 0,
      enemyHealthMult: 1,
      enemyDamageMult: 1,
      bossHealthMult: 1,
      extraElitesPerRoom: 0,
      goldRewardMult: 1,
    };
    expect(endlessModifiers(0)).toEqual(identity);
    expect(endlessModifiers(-2)).toEqual(identity);
    expect(endlessModifiers(Number.NaN)).toEqual(identity);
  });

  it('scales continuously for loop k >= 1', () => {
    expect(endlessModifiers(1)).toEqual({
      loop: 1,
      enemyHealthMult: 1.35,
      enemyDamageMult: 1.2,
      bossHealthMult: 1.4,
      extraElitesPerRoom: 1,
      goldRewardMult: 1.25,
    });

    const loop3 = endlessModifiers(3);
    expect(loop3.loop).toBe(3);
    expect(loop3.enemyHealthMult).toBeCloseTo(2.05, 10);
    expect(loop3.enemyDamageMult).toBeCloseTo(1.6, 10);
    expect(loop3.bossHealthMult).toBeCloseTo(2.2, 10);
    expect(loop3.extraElitesPerRoom).toBe(3);
    expect(loop3.goldRewardMult).toBeCloseTo(1.75, 10);
  });
});

describe('combinedDifficultyModifiers', () => {
  it('returns identity when ascension=0 and endlessLoop=0', () => {
    expect(combinedDifficultyModifiers(0, 0)).toEqual({
      ascension: 0,
      endlessLoop: 0,
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

  it('multiplies Ascension and Endless multipliers and sums extra elites', () => {
    const asc = ascensionModifiers(5);
    const end = endlessModifiers(2);
    const combined = combinedDifficultyModifiers(5, 2);

    expect(combined.ascension).toBe(5);
    expect(combined.endlessLoop).toBe(2);
    expect(combined.enemyHealthMult).toBeCloseTo(asc.enemyHealthMult * end.enemyHealthMult, 10);
    expect(combined.enemyDamageMult).toBeCloseTo(asc.enemyDamageMult * end.enemyDamageMult, 10);
    expect(combined.bossHealthMult).toBeCloseTo(asc.bossHealthMult * end.bossHealthMult, 10);
    expect(combined.goldRewardMult).toBeCloseTo(asc.goldRewardMult * end.goldRewardMult, 10);
    expect(combined.extraElitesPerRoom).toBe(asc.extraElitesPerRoom + end.extraElitesPerRoom);
    expect(combined.enemySpeedMult).toBe(asc.enemySpeedMult);
    expect(combined.enemyFireRateMult).toBe(asc.enemyFireRateMult);
    expect(combined.shopPriceMult).toBe(asc.shopPriceMult);
  });

  it('clamps ascension and loop inputs consistently', () => {
    const combined = combinedDifficultyModifiers(99, -5);
    expect(combined.ascension).toBe(5);
    expect(combined.endlessLoop).toBe(0);
    expect(combined.enemyHealthMult).toBe(1.55);
  });
});
