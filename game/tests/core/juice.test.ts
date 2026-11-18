/**
 * Test nghiệm thu ticket #2 (juice). Orchestrator viết; executor KHÔNG sửa file này.
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

/** random() trả lần lượt các giá trị cho sẵn, lặp lại. */
const sequence = (...values: number[]): (() => number) => {
  let index = 0;
  return () => values[index++ % values.length]!;
};

describe('ScreenShake — trauma', () => {
  const options = { maxOffsetTiles: 0.5, decayPerSecond: 2 };

  it('trauma bắt đầu 0, cộng dồn và kẹp ở 1', () => {
    const shake = new ScreenShake(options, () => 0.5);
    expect(shake.trauma).toBe(0);
    shake.addTrauma(0.6);
    expect(shake.trauma).toBeCloseTo(0.6, 10);
    shake.addTrauma(0.6);
    expect(shake.trauma).toBe(1);
    shake.addTrauma(-5);
    expect(shake.trauma).toBe(1);
  });

  it('trauma giảm tuyến tính theo decayPerSecond và không xuống dưới 0', () => {
    const shake = new ScreenShake(options, () => 0.5);
    shake.addTrauma(1);
    shake.update(250);
    expect(shake.trauma).toBeCloseTo(0.5, 10);
    shake.update(10_000);
    expect(shake.trauma).toBe(0);
  });

  it('offset = trunc(max · trauma² · (2r − 1) / texel) · texel, random gọi cho x rồi y', () => {
    const shake = new ScreenShake(options, sequence(1, 0));
    shake.addTrauma(1);
    const full = shake.offset();
    expect(full.x).toBeCloseTo(0.5, 10);
    expect(full.y).toBeCloseTo(-0.5, 10);

    const partial = new ScreenShake(options, sequence(1, 1));
    partial.addTrauma(0.7);
    // 0.5 · 0.49 = 0.245 tile = 3.92 texel → 3 texel (làm tròn về phía 0)
    const offset = partial.offset();
    expect(offset.x).toBeCloseTo(3 * TEXEL_TILES, 10);
    expect(offset.y).toBeCloseTo(3 * TEXEL_TILES, 10);
  });

  it('offset luôn là bội số nguyên của 1 texel và nằm trong biên độ trauma²', () => {
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

  it('offset = 0 khi trauma = 0 hoặc khi tắt setting', () => {
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
  it('bắt đầu ở biến dạng đầy đủ: x = 1 + amount, giữ diện tích x·y = 1', () => {
    const start = squashScale(0, 120, 0.25);
    expect(start.x).toBeCloseTo(1.25, 10);
    expect(start.x * start.y).toBeCloseTo(1, 10);
  });

  it('giữ diện tích và tiến dần về 1 trong suốt thời gian', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const elapsed of [0, 20, 40, 60, 80, 100, 119]) {
      const s = squashScale(elapsed, 120, 0.25);
      expect(s.x * s.y).toBeCloseTo(1, 10);
      const deviation = Math.abs(s.x - 1);
      expect(deviation).toBeLessThanOrEqual(previous + 1e-12);
      previous = deviation;
    }
  });

  it('hết thời gian (và sau đó) trả đúng {1, 1}; duration ≤ 0 cũng vậy', () => {
    expect(squashScale(120, 120, 0.25)).toEqual({ x: 1, y: 1 });
    expect(squashScale(5_000, 120, 0.25)).toEqual({ x: 1, y: 1 });
    expect(squashScale(0, 0, 0.25)).toEqual({ x: 1, y: 1 });
  });

  it('amount âm = bóp ngang, kéo dọc', () => {
    const s = squashScale(0, 100, -0.2);
    expect(s.x).toBeCloseTo(0.8, 10);
    expect(s.y).toBeCloseTo(1 / 0.8, 10);
  });
});

describe('coinFlyPosition', () => {
  const from = { x: 4, y: 10 };
  const to = { x: 30, y: 1 };

  it('t = 0 ở điểm đầu, t = 1 ở điểm cuối, t ngoài [0,1] bị kẹp', () => {
    expect(coinFlyPosition(from, to, 0, 2)).toEqual(from);
    expect(coinFlyPosition(from, to, 1, 2)).toEqual(to);
    expect(coinFlyPosition(from, to, -1, 2)).toEqual(from);
    expect(coinFlyPosition(from, to, 3, 2)).toEqual(to);
  });

  it('bay vòng cung: ở t = 0.5 cách trung điểm đoạn thẳng đúng arcHeight', () => {
    const mid = coinFlyPosition(from, to, 0.5, 2);
    const straightMid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    expect(Math.hypot(mid.x - straightMid.x, mid.y - straightMid.y)).toBeCloseTo(2, 6);
  });

  it('arcHeight = 0 là đường thẳng', () => {
    const p = coinFlyPosition(from, to, 0.25, 0);
    expect(p.x).toBeCloseTo(4 + 26 * 0.25, 10);
    expect(p.y).toBeCloseTo(10 - 9 * 0.25, 10);
  });
});

describe('damage popup', () => {
  const base = { lifetimeMs: 600, riseTiles: 1, crit: false };

  it('bắt đầu rõ, chưa bay; hết đời thì mờ hẳn và đã bay đủ riseTiles', () => {
    const start = damagePopupState(0, base);
    expect(start.rise).toBe(0);
    expect(start.alpha).toBe(1);
    const end = damagePopupState(600, base);
    expect(end.rise).toBeCloseTo(1, 10);
    expect(end.alpha).toBe(0);
    expect(damagePopupState(9_999, base).alpha).toBe(0);
  });

  it('alpha không tăng và rise không giảm theo thời gian', () => {
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

  it('crit to hơn thường', () => {
    const normal = damagePopupState(100, base);
    const crit = damagePopupState(100, { ...base, crit: true });
    expect(normal.scale).toBe(1);
    expect(crit.scale).toBeGreaterThan(normal.scale);
  });

  it('formatDamage: số nguyên, crit thêm "!"', () => {
    expect(formatDamage(3, false)).toBe('3');
    expect(formatDamage(12, true)).toBe('12!');
    expect(formatDamage(2.6, false)).toBe('3');
  });
});

describe('Settings — screenShake / damageNumbers', () => {
  it('mặc định: screen shake bật, số damage tắt', () => {
    expect(DEFAULT_SETTINGS.screenShake).toBe(true);
    expect(DEFAULT_SETTINGS.damageNumbers).toBe(false);
    expect(applySettings({}).screenShake).toBe(true);
    expect(applySettings({}).damageNumbers).toBe(false);
  });

  it('applySettings giữ giá trị boolean hợp lệ, bỏ giá trị sai kiểu', () => {
    const s = applySettings({ screenShake: false, damageNumbers: true });
    expect(s.screenShake).toBe(false);
    expect(s.damageNumbers).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cố ý đưa dữ liệu hỏng
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

  it('save cũ (chỉ volume + fullscreen) migrate ra mặc định cho field mới, không đổi version', () => {
    const old = { version: 1, gold: 5, settings: { volume: 0.4, fullscreen: true } };
    const migrated = migrate(old);
    expect(migrated.version).toBe(1);
    expect(migrated.settings).toEqual({ volume: 0.4, fullscreen: true, screenShake: true, damageNumbers: false });
  });

  it('parse báo lỗi field sai kiểu', () => {
    const bad = { ...createDefaultSave(), settings: { volume: 0.5, fullscreen: false, screenShake: 'x', damageNumbers: false } };
    expect(() => parseSaveData(bad)).toThrow(/settings\.screenShake/);
  });
});
