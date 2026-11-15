import { describe, expect, it } from 'vitest';
import { FireControl } from '../../assets/scripts/core/combat/fire-control';

describe('FireControl', () => {
  it('bắn ngay ở tick đầu tiên', () => {
    const fire = new FireControl(500);

    expect(fire.tick(0)).toBe(true);
  });

  it('không bắn lại trước khi hết interval', () => {
    const fire = new FireControl(500);
    fire.tick(0);

    expect(fire.tick(250)).toBe(false);
    expect(fire.tick(249)).toBe(false);
  });

  it('bắn lại khi đủ interval, tính cả phần dư của frame', () => {
    const fire = new FireControl(500);
    fire.tick(0);

    expect(fire.tick(250)).toBe(false);
    expect(fire.tick(250)).toBe(true);
  });

  it('không trôi nhịp khi frame time không đều', () => {
    const fire = new FireControl(500);
    let shots = 0;

    // 10 giây với frame 16 ms, bắt đầu bằng một phát ngay lập tức.
    for (let elapsed = 0; elapsed < 10_000; elapsed += 16) {
      if (fire.tick(16)) shots += 1;
    }

    expect(shots).toBeGreaterThanOrEqual(20);
    expect(shots).toBeLessThanOrEqual(21);
  });

  it('tính interval từ nhịp bắn mỗi giây', () => {
    expect(FireControl.fromRate(2).intervalMs).toBe(500);
    expect(FireControl.fromRate(4).intervalMs).toBe(250);
  });

  it('từ chối interval không hợp lệ', () => {
    expect(() => new FireControl(0)).toThrow();
    expect(() => new FireControl(-1)).toThrow();
  });
});
