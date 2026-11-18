import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUME,
  VOLUME_STEP,
  stepVolume,
} from '../../assets/scripts/core/save/settings';

describe('stepVolume', () => {
  it('moves 10% per step and rounds, producing no floating-point noise', () => {
    expect(VOLUME_STEP).toBe(0.1);
    expect(stepVolume(0.8, 1)).toBe(0.9);
    expect(stepVolume(0.3, 1)).toBe(0.4);
    expect(stepVolume(0.7, -1)).toBe(0.6);
    expect(stepVolume(0, 3)).toBe(0.3);
    expect(stepVolume(1, -2)).toBe(0.8);
  });

  it('clamps to 0..1', () => {
    expect(stepVolume(1, 5)).toBe(1);
    expect(stepVolume(0, -5)).toBe(0);
  });

  it('broken volume uses the GDD default before stepping', () => {
    expect(stepVolume(Number.NaN, 1)).toBeCloseTo(DEFAULT_VOLUME + VOLUME_STEP, 10);
    expect(stepVolume(Number.POSITIVE_INFINITY, 0)).toBe(DEFAULT_VOLUME);
  });

  it('broken/non-integer steps leave volume unchanged', () => {
    expect(stepVolume(0.5, Number.NaN)).toBe(0.5);
    expect(stepVolume(0.5, 1.9)).toBe(0.6);
  });
});
