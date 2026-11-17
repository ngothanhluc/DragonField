import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUME,
  VOLUME_STEP,
  stepVolume,
} from '../../assets/scripts/core/save/settings';

describe('stepVolume', () => {
  it('đi 10% mỗi bước và làm tròn, không sinh rác dấu phẩy động', () => {
    expect(VOLUME_STEP).toBe(0.1);
    expect(stepVolume(0.8, 1)).toBe(0.9);
    expect(stepVolume(0.3, 1)).toBe(0.4);
    expect(stepVolume(0.7, -1)).toBe(0.6);
    expect(stepVolume(0, 3)).toBe(0.3);
    expect(stepVolume(1, -2)).toBe(0.8);
  });

  it('kẹp 0..1', () => {
    expect(stepVolume(1, 5)).toBe(1);
    expect(stepVolume(0, -5)).toBe(0);
  });

  it('volume hỏng dùng mặc định GDD rồi mới đi bước', () => {
    expect(stepVolume(Number.NaN, 1)).toBeCloseTo(DEFAULT_VOLUME + VOLUME_STEP, 10);
    expect(stepVolume(Number.POSITIVE_INFINITY, 0)).toBe(DEFAULT_VOLUME);
  });

  it('steps hỏng/không nguyên không đổi volume', () => {
    expect(stepVolume(0.5, Number.NaN)).toBe(0.5);
    expect(stepVolume(0.5, 1.9)).toBe(0.6);
  });
});
