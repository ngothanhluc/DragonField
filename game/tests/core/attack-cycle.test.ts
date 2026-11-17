import { describe, expect, it } from 'vitest';
import type { EnemyAction } from '../../assets/scripts/core/enemies/behaviours';
import { nextActionStartedMs } from '../../assets/scripts/core/enemies/attack-cycle';

const idle: EnemyAction = { kind: 'idle' };
const walk: EnemyAction = { kind: 'walk', target: { x: 1, y: 1 } };
const telegraph: EnemyAction = { kind: 'telegraph', sinceMs: 1000 };
const charge: EnemyAction = {
  kind: 'charge',
  direction: { x: 0, y: -1 },
  untilMs: 1700,
  speedTilesPerSecond: 7,
  followUps: 0,
};
const stagger: EnemyAction = { kind: 'stagger', untilMs: 1200 };

describe('nextActionStartedMs — mốc chu kỳ đòn', () => {
  it('telegraph bắt đầu và đòn được thả đều đặt mốc mới', () => {
    expect(nextActionStartedMs(idle, telegraph, 5000, 1000)).toBe(5000);
    expect(nextActionStartedMs(walk, telegraph, 5000, 1000)).toBe(5000);
    expect(nextActionStartedMs(telegraph, idle, 5500, 1000)).toBe(5500);
    expect(nextActionStartedMs(telegraph, charge, 5500, 1000)).toBe(5500);
  });

  it('stagger KHÔNG reset cooldown (bug: bị bắn liên tục là enemy không ra đòn)', () => {
    // Đang đi bộ (mốc 1000), trúng đạn ở 1100 và 1250, hết choáng ở 1250/1400.
    expect(nextActionStartedMs(walk, stagger, 1100, 1000)).toBe(1000);
    expect(nextActionStartedMs(stagger, walk, 1250, 1000)).toBe(1000);
    expect(nextActionStartedMs(walk, stagger, 1400, 1000)).toBe(1000);
    // Sau 900 ms kể từ mốc cũ, cooldown đã hết dù bị choáng nhiều lần.
    expect(1900 - 1000).toBeGreaterThanOrEqual(900);
  });

  it('stagger cắt ngang telegraph thì lần ra đòn kế tính từ mốc cũ', () => {
    // Telegraph bắt đầu 1000; trúng đạn ở 1200 rồi choáng tới 1350.
    expect(nextActionStartedMs(telegraph, stagger, 1200, 1000)).toBe(1000);
    expect(nextActionStartedMs(stagger, idle, 1350, 1000)).toBe(1000);
  });

  it('các chuyển đổi thường (walk ↔ idle, charge → idle) giữ nguyên mốc', () => {
    expect(nextActionStartedMs(walk, idle, 5000, 1000)).toBe(1000);
    expect(nextActionStartedMs(idle, walk, 5000, 1000)).toBe(1000);
    expect(nextActionStartedMs(charge, idle, 5000, 1000)).toBe(1000);
    expect(nextActionStartedMs(charge, charge, 5000, 1000)).toBe(1000);
  });
});
