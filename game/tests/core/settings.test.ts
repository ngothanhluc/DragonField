import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  DEFAULT_VOLUME,
  VOLUME_STEP,
  applySettings,
  stepChannelVolume,
  stepMusicVolume,
  stepSfxVolume,
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

describe('stepChannelVolume — independent Music & SFX sliders (M15)', () => {
  it('steps musicVolume independently without altering sfxVolume and syncs legacy volume', () => {
    const base = { ...DEFAULT_SETTINGS };
    const quieterMusic = stepChannelVolume(base, 'music', -3);

    expect(quieterMusic.musicVolume).toBe(0.5);
    expect(quieterMusic.sfxVolume).toBe(0.8);
    expect(quieterMusic.volume).toBe(0.8);
    expect(base.musicVolume).toBe(0.8); // pure

    const louderSfx = stepSfxVolume(quieterMusic, 2);
    expect(louderSfx.musicVolume).toBe(0.5);
    expect(louderSfx.sfxVolume).toBe(1);
    expect(louderSfx.volume).toBe(1);

    const bothMuted = stepSfxVolume(stepMusicVolume(louderSfx, -10), -10);
    expect(bothMuted.musicVolume).toBe(0);
    expect(bothMuted.sfxVolume).toBe(0);
    expect(bothMuted.volume).toBe(0);
  });

  it('applySettings syncs legacy volume from split channels when volume is omitted', () => {
    const split = applySettings({ musicVolume: 0.3, sfxVolume: 0.9 });
    expect(split.musicVolume).toBe(0.3);
    expect(split.sfxVolume).toBe(0.9);
    expect(split.volume).toBe(0.9);
  });
});
