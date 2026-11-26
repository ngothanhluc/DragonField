import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHANNEL_VOLUME,
  MUSIC_DUCK_EPSILON,
  MUSIC_DUCK_FACTOR,
  MUSIC_DUCK_RATE,
  MUSIC_HEADROOM,
  MusicDucker,
  clampVolume01,
  computeChannelGains,
  squaredGain,
} from "../../assets/scripts/core/audio/mixer";

describe("squaredGain perceptual curve", () => {
  it("maps [0, 1] slider levels through v * v", () => {
    expect(squaredGain(0)).toBe(0);
    expect(squaredGain(0.25)).toBe(0.0625);
    expect(squaredGain(0.5)).toBe(0.25);
    expect(squaredGain(0.8)).toBeCloseTo(0.64, 12);
    expect(squaredGain(1)).toBe(1);
  });

  it("is strictly monotonic on [0, 1] and sits below linear amplitude on (0, 1)", () => {
    let previous = squaredGain(0);
    for (let step = 1; step <= 10; step += 1) {
      const level = step / 10;
      const gain = squaredGain(level);
      expect(gain).toBeGreaterThan(previous);
      if (step < 10) {
        expect(gain).toBeLessThan(level);
      }
      previous = gain;
    }
  });

  it("clamps out-of-range and non-finite inputs cleanly without producing -0 or NaN", () => {
    expect(Object.is(squaredGain(-0), 0)).toBe(true);
    expect(squaredGain(-0.001)).toBe(0);
    expect(squaredGain(-5)).toBe(0);
    expect(squaredGain(1.001)).toBe(1);
    expect(squaredGain(42)).toBe(1);
    expect(squaredGain(Number.NaN)).toBe(0);
    expect(squaredGain(Number.POSITIVE_INFINITY)).toBe(0);
    expect(squaredGain(Number.NEGATIVE_INFINITY)).toBe(0);

    expect(Object.is(clampVolume01(-0), 0)).toBe(true);
    expect(clampVolume01(Number.NaN)).toBe(0);
    expect(clampVolume01(-2)).toBe(0);
    expect(clampVolume01(2)).toBe(1);
    expect(clampVolume01(DEFAULT_CHANNEL_VOLUME)).toBe(0.8);
  });
});

describe("computeChannelGains (independent Music & SFX channels)", () => {
  it("applies squared gain to both channels and MUSIC_HEADROOM only to music", () => {
    expect(MUSIC_HEADROOM).toBe(0.55);
    expect(MUSIC_DUCK_FACTOR).toBe(0.35);
    expect(MUSIC_DUCK_RATE).toBe(10);
    expect(MUSIC_DUCK_EPSILON).toBe(0.002);

    const defaults = computeChannelGains(0.8, 0.8, 1);
    expect(defaults.sfxGain).toBeCloseTo(0.64, 12);
    expect(defaults.musicGain).toBeCloseTo(0.64 * MUSIC_HEADROOM, 12);
    expect(defaults.musicGain).toBeLessThan(defaults.sfxGain);

    const full = computeChannelGains(1, 1);
    expect(full.sfxGain).toBe(1);
    expect(full.musicGain).toBeCloseTo(MUSIC_HEADROOM, 12);
  });

  it("controls Music and SFX independently so muting one channel preserves the other", () => {
    const musicMuted = computeChannelGains(0, 0.8, 1);
    expect(Object.is(musicMuted.musicGain, 0)).toBe(true);
    expect(musicMuted.sfxGain).toBeCloseTo(0.64, 12);

    const sfxMuted = computeChannelGains(0.8, 0, 1);
    expect(sfxMuted.musicGain).toBeCloseTo(0.64 * MUSIC_HEADROOM, 12);
    expect(Object.is(sfxMuted.sfxGain, 0)).toBe(true);

    const asymmetric = computeChannelGains(0.5, 1, 1);
    expect(asymmetric.musicGain).toBeCloseTo(0.25 * MUSIC_HEADROOM, 12);
    expect(asymmetric.sfxGain).toBe(1);
  });

  it("scales only musicGain by duckFactor while keeping sfxGain untouched", () => {
    const unducked = computeChannelGains(0.8, 0.7, 1);
    const ducked = computeChannelGains(0.8, 0.7, MUSIC_DUCK_FACTOR);

    expect(ducked.sfxGain).toBeCloseTo(unducked.sfxGain, 12);
    expect(ducked.sfxGain).toBeCloseTo(0.49, 12);
    expect(ducked.musicGain).toBeCloseTo(
      unducked.musicGain * MUSIC_DUCK_FACTOR,
      12,
    );
    expect(ducked.musicGain).toBeCloseTo(
      0.64 * MUSIC_HEADROOM * MUSIC_DUCK_FACTOR,
      12,
    );
  });

  it("sanitizes non-finite or out-of-range channel levels and duck factors", () => {
    const corrupt = computeChannelGains(Number.NaN, -1, Number.NaN);
    expect(Object.is(corrupt.musicGain, 0)).toBe(true);
    expect(Object.is(corrupt.sfxGain, 0)).toBe(true);

    const clamped = computeChannelGains(2, 2, 2);
    expect(clamped.sfxGain).toBe(1);
    expect(clamped.musicGain).toBeCloseTo(MUSIC_HEADROOM, 12);
  });
});

describe("MusicDucker smooth exponential ducking", () => {
  it("starts unducked at factor 1 and reports no change while settled", () => {
    const ducker = new MusicDucker();
    expect(ducker.isDucked).toBe(false);
    expect(ducker.factor).toBe(1);
    expect(ducker.step(1 / 60)).toBe(false);
    expect(ducker.factor).toBe(1);
  });

  it("smoothly ramps down to MUSIC_DUCK_FACTOR on pause/level-up and stops reporting changes once snapped", () => {
    const ducker = new MusicDucker();
    ducker.setDucked(true);
    expect(ducker.isDucked).toBe(true);
    expect(ducker.factor).toBe(1);

    const dt = 1 / 60;
    let previous = ducker.factor;
    let changedSteps = 0;

    // First step matches exact exponential formula (well above epsilon snap).
    expect(ducker.step(dt)).toBe(true);
    changedSteps += 1;
    const expectedFirst =
      1 + (MUSIC_DUCK_FACTOR - 1) * (1 - Math.exp(-MUSIC_DUCK_RATE * dt));
    expect(ducker.factor).toBeCloseTo(expectedFirst, 12);
    expect(ducker.factor).toBeLessThan(previous);
    expect(ducker.factor).toBeGreaterThan(MUSIC_DUCK_FACTOR);
    previous = ducker.factor;

    // Continue stepping up to 1 second; factor must descend monotonically and snap cleanly.
    for (let i = 1; i < 60; i += 1) {
      const changed = ducker.step(dt);
      if (changed) {
        changedSteps += 1;
        expect(ducker.factor).toBeLessThan(previous);
        expect(ducker.factor).toBeGreaterThanOrEqual(MUSIC_DUCK_FACTOR);
        previous = ducker.factor;
      } else {
        expect(ducker.factor).toBe(MUSIC_DUCK_FACTOR);
      }
    }

    expect(changedSteps).toBeGreaterThan(20);
    expect(changedSteps).toBeLessThan(50);
    expect(ducker.factor).toBe(MUSIC_DUCK_FACTOR);
    expect(ducker.step(dt)).toBe(false);
  });

  it("smoothly ramps back up to 1.0 on resume and snaps cleanly within epsilon", () => {
    const ducker = new MusicDucker();
    ducker.setDucked(true);
    expect(ducker.step(2)).toBe(true);
    expect(ducker.factor).toBe(MUSIC_DUCK_FACTOR);

    ducker.setDucked(false);
    expect(ducker.isDucked).toBe(false);
    expect(ducker.factor).toBe(MUSIC_DUCK_FACTOR);

    const dt = 1 / 60;
    let previous = ducker.factor;
    let changedSteps = 0;

    for (let i = 0; i < 60; i += 1) {
      const changed = ducker.step(dt);
      if (changed) {
        changedSteps += 1;
        expect(ducker.factor).toBeGreaterThan(previous);
        expect(ducker.factor).toBeLessThanOrEqual(1);
        previous = ducker.factor;
      } else {
        expect(ducker.factor).toBe(1);
      }
    }

    expect(changedSteps).toBeGreaterThan(20);
    expect(ducker.factor).toBe(1);
    expect(ducker.step(dt)).toBe(false);
  });

  it("is frame-rate independent across 30 fps, 60 fps, 120 fps, and single-step updates", () => {
    const runFor = (
      steps: number,
      totalSec: number,
      startDucked: boolean,
    ): number => {
      const ducker = new MusicDucker();
      if (!startDucked) {
        ducker.setDucked(true);
        ducker.step(5);
      }
      ducker.setDucked(startDucked);
      const dt = totalSec / steps;
      for (let i = 0; i < steps; i += 1) {
        ducker.step(dt);
      }
      return ducker.factor;
    };

    // Ramp down over 0.2 s (before the ~0.58 s epsilon snap).
    const downSingle = runFor(1, 0.2, true);
    const down30 = runFor(6, 0.2, true);
    const down60 = runFor(12, 0.2, true);
    const down120 = runFor(24, 0.2, true);

    expect(down30).toBeCloseTo(downSingle, 12);
    expect(down60).toBeCloseTo(downSingle, 12);
    expect(down120).toBeCloseTo(downSingle, 12);

    // Ramp up over 0.2 s from settled ducked state.
    const upSingle = runFor(1, 0.2, false);
    const up30 = runFor(6, 0.2, false);
    const up60 = runFor(12, 0.2, false);
    const up120 = runFor(24, 0.2, false);

    expect(up30).toBeCloseTo(upSingle, 12);
    expect(up60).toBeCloseTo(upSingle, 12);
    expect(up120).toBeCloseTo(upSingle, 12);
  });

  it("reverses smoothly mid-transition without discontinuous jumps and supports reset()", () => {
    const ducker = new MusicDucker();
    ducker.setDucked(true);
    ducker.step(0.1);
    const midFactor = ducker.factor;
    expect(midFactor).toBeGreaterThan(MUSIC_DUCK_FACTOR);
    expect(midFactor).toBeLessThan(1);

    // Unpausing mid-ramp starts smoothly from midFactor rather than jumping.
    ducker.setDucked(false);
    expect(ducker.factor).toBe(midFactor);
    expect(ducker.step(1 / 60)).toBe(true);
    expect(ducker.factor).toBeGreaterThan(midFactor);
    expect(ducker.factor).toBeLessThan(1);

    // Invalid dt values never corrupt factor or report spurious changes.
    const beforeInvalid = ducker.factor;
    expect(ducker.step(0)).toBe(false);
    expect(ducker.step(-0.5)).toBe(false);
    expect(ducker.step(Number.NaN)).toBe(false);
    expect(ducker.step(Number.POSITIVE_INFINITY)).toBe(false);
    expect(ducker.factor).toBe(beforeInvalid);

    ducker.reset();
    expect(ducker.isDucked).toBe(false);
    expect(ducker.factor).toBe(1);
  });
});
