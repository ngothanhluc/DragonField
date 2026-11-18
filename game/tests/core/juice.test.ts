/**
 * Acceptance test for ticket #2 (juice). Written by the orchestrator; the executor does NOT edit this file.
 */
import { describe, expect, it } from 'vitest';
import { ScreenShake, TEXEL_TILES } from '../../assets/scripts/core/feel/screen-shake';
import { squashScale } from '../../assets/scripts/core/feel/squash';
import { coinFlyPosition } from '../../assets/scripts/core/feel/coin-fly';
import { damagePopupState, formatDamage } from '../../assets/scripts/core/feel/damage-number';
import { DEFAULT_SETTINGS, applySettings } from '../../assets/scripts/core/save/settings';
import { migrate, parseSaveData, serializeSave, createDefaultSave } from '../../assets/scripts/core/save/save-data';

const isTexelMultiple = (value: number): boolean =>
  Math.abs(value / TEXEL_TILES - Math.round(value / TEXEL_TILES)) < 1e-9;

/** random() returns the given values in order, repeating. */
const sequence = (...values: number[]): (() => number) => {
  let index = 0;
  return () => values[index++ % values.length]!;
};

describe('ScreenShake — trauma', () => {
  const options = { maxOffsetTiles: 0.5, decayPerSecond: 2 };

  it('trauma starts at 0, accumulates, and clamps at 1', () => {
    const shake = new ScreenShake(options, () => 0.5);
    expect(shake.trauma).toBe(0);
    shake.addTrauma(0.6);
    expect(shake.trauma).toBeCloseTo(0.6, 10);
    shake.addTrauma(0.6);
    expect(shake.trauma).toBe(1);
    shake.addTrauma(-5);
    expect(shake.trauma).toBe(1);
  });

  it('trauma decays linearly at decayPerSecond and never goes below 0', () => {
    const shake = new ScreenShake(options, () => 0.5);
    shake.addTrauma(1);
    shake.update(250);
    expect(shake.trauma).toBeCloseTo(0.5, 10);
    shake.update(10_000);
    expect(shake.trauma).toBe(0);
  });

  it('offset = trunc(max · trauma² · (2r − 1) / texel) · texel, random called for x then y', () => {
    const shake = new ScreenShake(options, sequence(1, 0));
    shake.addTrauma(1);
    const full = shake.offset();
    expect(full.x).toBeCloseTo(0.5, 10);
    expect(full.y).toBeCloseTo(-0.5, 10);

    const partial = new ScreenShake(options, sequence(1, 1));
    partial.addTrauma(0.7);
    // 0.5 · 0.49 = 0.245 tile = 3.92 texel → 3 texel (rounds toward 0)
    const offset = partial.offset();
    expect(offset.x).toBeCloseTo(3 * TEXEL_TILES, 10);
    expect(offset.y).toBeCloseTo(3 * TEXEL_TILES, 10);
  });

  it('offset is always an integer multiple of 1 texel within the trauma² amplitude', () => {
    const shake = new ScreenShake(options, sequence(0.03, 0.97, 0.41, 0.66, 0.5, 0.12, 0.88));
    for (const trauma of [1, 0.9, 0.6, 0.33, 0.1]) {
      const fresh = new ScreenShake(options, sequence(0.03, 0.97, 0.41, 0.66, 0.5, 0.12, 0.88));
      fresh.addTrauma(trauma);
      for (let i = 0; i < 7; i += 1) {
        const { x, y } = fresh.offset();
        expect(isTexelMultiple(x)).toBe(true);
        expect(isTexelMultiple(y)).toBe(true);
        const bound = options.maxOffsetTiles * trauma * trauma + 1e-9;
        expect(Math.abs(x)).toBeLessThanOrEqual(bound);
        expect(Math.abs(y)).toBeLessThanOrEqual(bound);
      }
    }
    expect(shake.trauma).toBe(0);
  });

  it('offset = 0 when trauma = 0 or when the setting is off', () => {
    const idle = new ScreenShake(options, () => 1);
    const o = idle.offset();
    expect(o.x === 0 && o.y === 0).toBe(true);

    const off = new ScreenShake(options, () => 1);
    off.enabled = false;
    off.addTrauma(1);
    const o2 = off.offset();
    expect(o2.x === 0 && o2.y === 0).toBe(true);
  });
});

describe('squashScale', () => {
  it('starts at full deformation: x = 1 + amount, preserving area x·y = 1', () => {
    const start = squashScale(0, 120, 0.25);
    expect(start.x).toBeCloseTo(1.25, 10);
    expect(start.x * start.y).toBeCloseTo(1, 10);
  });

  it('preserves area and converges to 1 throughout the duration', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const elapsed of [0, 20, 40, 60, 80, 100, 119]) {
      const s = squashScale(elapsed, 120, 0.25);
      expect(s.x * s.y).toBeCloseTo(1, 10);
      const deviation = Math.abs(s.x - 1);
      expect(deviation).toBeLessThanOrEqual(previous + 1e-12);
      previous = deviation;
    }
  });

  it('past the duration (and after) returns exactly {1, 1}; duration ≤ 0 too', () => {
    expect(squashScale(120, 120, 0.25)).toEqual({ x: 1, y: 1 });
    expect(squashScale(5_000, 120, 0.25)).toEqual({ x: 1, y: 1 });
    expect(squashScale(0, 0, 0.25)).toEqual({ x: 1, y: 1 });
  });

  it('a negative amount = squeeze horizontally, stretch vertically', () => {
    const s = squashScale(0, 100, -0.2);
    expect(s.x).toBeCloseTo(0.8, 10);
    expect(s.y).toBeCloseTo(1 / 0.8, 10);
  });
});

describe('coinFlyPosition', () => {
  const from = { x: 4, y: 10 };
  const to = { x: 30, y: 1 };

  it('t = 0 at the start, t = 1 at the end, t outside [0,1] is clamped', () => {
    expect(coinFlyPosition(from, to, 0, 2)).toEqual(from);
    expect(coinFlyPosition(from, to, 1, 2)).toEqual(to);
    expect(coinFlyPosition(from, to, -1, 2)).toEqual(from);
    expect(coinFlyPosition(from, to, 3, 2)).toEqual(to);
  });

  it('flies an arc: at t = 0.5 it is exactly arcHeight above the straight midpoint', () => {
    const mid = coinFlyPosition(from, to, 0.5, 2);
    const straightMid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    expect(Math.hypot(mid.x - straightMid.x, mid.y - straightMid.y)).toBeCloseTo(2, 6);
  });

  it('arcHeight = 0 is a straight line', () => {
    const p = coinFlyPosition(from, to, 0.25, 0);
    expect(p.x).toBeCloseTo(4 + 26 * 0.25, 10);
    expect(p.y).toBeCloseTo(10 - 9 * 0.25, 10);
  });
});

describe('damage popup', () => {
  const base = { lifetimeMs: 600, riseTiles: 1, crit: false };

  it('starts visible before flying; by end of life it is fully faded and has risen riseTiles', () => {
    const start = damagePopupState(0, base);
    expect(start.rise).toBe(0);
    expect(start.alpha).toBe(1);
    const end = damagePopupState(600, base);
    expect(end.rise).toBeCloseTo(1, 10);
    expect(end.alpha).toBe(0);
    expect(damagePopupState(9_999, base).alpha).toBe(0);
  });

  it('alpha never increases and rise never decreases over time', () => {
    let alpha = 1;
    let rise = 0;
    for (let t = 0; t <= 600; t += 50) {
      const s = damagePopupState(t, base);
      expect(s.alpha).toBeLessThanOrEqual(alpha + 1e-12);
      expect(s.rise).toBeGreaterThanOrEqual(rise - 1e-12);
      alpha = s.alpha;
      rise = s.rise;
    }
  });

  it('crit is bigger than normal', () => {
    const normal = damagePopupState(100, base);
    const crit = damagePopupState(100, { ...base, crit: true });
    expect(normal.scale).toBe(1);
    expect(crit.scale).toBeGreaterThan(normal.scale);
  });

  it('formatDamage: integer, crit adds "!"', () => {
    expect(formatDamage(3, false)).toBe('3');
    expect(formatDamage(12, true)).toBe('12!');
    expect(formatDamage(2.6, false)).toBe('3');
  });
});

describe('Settings — screenShake / damageNumbers', () => {
  it('defaults: screen shake on, damage numbers off', () => {
    expect(DEFAULT_SETTINGS.screenShake).toBe(true);
    expect(DEFAULT_SETTINGS.damageNumbers).toBe(false);
    expect(applySettings({}).screenShake).toBe(true);
    expect(applySettings({}).damageNumbers).toBe(false);
  });

  it('applySettings keeps valid boolean values and drops mistyped ones', () => {
    const s = applySettings({ screenShake: false, damageNumbers: true });
    expect(s.screenShake).toBe(false);
    expect(s.damageNumbers).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately feeding broken data
    const broken = applySettings({ screenShake: 'yes' as any, damageNumbers: 1 as any });
    expect(broken.screenShake).toBe(true);
    expect(broken.damageNumbers).toBe(false);
  });

  it('round-trip qua serialize/parse', () => {
    const save = { ...createDefaultSave(), settings: { ...DEFAULT_SETTINGS, screenShake: false, damageNumbers: true } };
    const back = parseSaveData(JSON.parse(serializeSave(save)));
    expect(back.settings.screenShake).toBe(false);
    expect(back.settings.damageNumbers).toBe(true);
  });

  it('an old save (volume + fullscreen only) migrates to defaults for new fields, without a version bump', () => {
    const old = { version: 1, gold: 5, settings: { volume: 0.4, fullscreen: true } };
    const migrated = migrate(old);
    expect(migrated.version).toBe(1);
    expect(migrated.settings).toEqual({ volume: 0.4, fullscreen: true, screenShake: true, damageNumbers: false });
  });

  it('parse reports a mistyped field', () => {
    const bad = { ...createDefaultSave(), settings: { volume: 0.5, fullscreen: false, screenShake: 'x', damageNumbers: false } };
    expect(() => parseSaveData(bad)).toThrow(/settings\.screenShake/);
  });
});
