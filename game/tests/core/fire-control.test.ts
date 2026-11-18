import { describe, expect, it } from 'vitest';
import { FireControl } from '../../assets/scripts/core/combat/fire-control';

describe('FireControl', () => {
  it('fires on the very first tick', () => {
    const fire = new FireControl(500);

    expect(fire.tick(0)).toBe(true);
  });

  it('does not fire again before the interval elapses', () => {
    const fire = new FireControl(500);
    fire.tick(0);

    expect(fire.tick(250)).toBe(false);
    expect(fire.tick(249)).toBe(false);
  });

  it('fires again once the interval is met, counting the frame remainder', () => {
    const fire = new FireControl(500);
    fire.tick(0);

    expect(fire.tick(250)).toBe(false);
    expect(fire.tick(250)).toBe(true);
  });

  it('the rate does not drift when frame time is uneven', () => {
    const fire = new FireControl(500);
    let shots = 0;

    // 10 seconds at 16 ms frames, starting with an immediate shot.
    for (let elapsed = 0; elapsed < 10_000; elapsed += 16) {
      if (fire.tick(16)) shots += 1;
    }

    expect(shots).toBeGreaterThanOrEqual(20);
    expect(shots).toBeLessThanOrEqual(21);
  });

  it('derives the interval from the fire rate per second', () => {
    expect(FireControl.fromRate(2).intervalMs).toBe(500);
    expect(FireControl.fromRate(4).intervalMs).toBe(250);
  });

  it('rejects an invalid interval', () => {
    expect(() => new FireControl(0)).toThrow();
    expect(() => new FireControl(-1)).toThrow();
  });
});
