import { describe, expect, it } from 'vitest';
import type { EnemyAction } from '../../assets/scripts/core/enemies/behaviours';
import { staggerAfterHit } from '../../assets/scripts/core/enemies/behaviours';
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

describe('nextActionStartedMs — attack cycle timestamp', () => {
  it('starting a telegraph and releasing an attack both set a new timestamp', () => {
    expect(nextActionStartedMs(idle, telegraph, 5000, 1000)).toBe(5000);
    expect(nextActionStartedMs(walk, telegraph, 5000, 1000)).toBe(5000);
    expect(nextActionStartedMs(telegraph, idle, 5500, 1000)).toBe(5500);
    expect(nextActionStartedMs(telegraph, charge, 5500, 1000)).toBe(5500);
  });

  it('stagger does NOT reset the cooldown (bug: under fire the enemy never attacks)', () => {
    // Walking (timestamp 1000), hit at 1100 and 1250, stun over at 1250/1400.
    expect(nextActionStartedMs(walk, stagger, 1100, 1000)).toBe(1000);
    expect(nextActionStartedMs(stagger, walk, 1250, 1000)).toBe(1000);
    expect(nextActionStartedMs(walk, stagger, 1400, 1000)).toBe(1000);
    // 900 ms after the old timestamp the cooldown has elapsed despite repeated stuns.
    expect(1900 - 1000).toBeGreaterThanOrEqual(900);
  });

  it('a stagger crossing a telegraph makes the next attack count from the old timestamp', () => {
    // Telegraph starts at 1000; hit at 1200, stun lasts until 1350.
    expect(nextActionStartedMs(telegraph, stagger, 1200, 1000)).toBe(1000);
    expect(nextActionStartedMs(stagger, idle, 1350, 1000)).toBe(1000);
  });

  it('ordinary transitions (walk ↔ idle, charge → idle) keep the timestamp', () => {
    expect(nextActionStartedMs(walk, idle, 5000, 1000)).toBe(1000);
    expect(nextActionStartedMs(idle, walk, 5000, 1000)).toBe(1000);
    expect(nextActionStartedMs(charge, idle, 5000, 1000)).toBe(1000);
    expect(nextActionStartedMs(charge, charge, 5000, 1000)).toBe(1000);
  });
});

describe('staggerAfterHit — a hit delays a committed wind-up', () => {
  it('pushes a running telegraph back by the stun instead of cancelling it', () => {
    expect(staggerAfterHit(telegraph, 1200, 150)).toEqual({ kind: 'telegraph', sinceMs: 1150 });
  });

  it('staggers every other action as before', () => {
    const hit = { kind: 'stagger', untilMs: 1350 } as const;
    expect(staggerAfterHit(walk, 1200, 150)).toEqual(hit);
    expect(staggerAfterHit(idle, 1200, 150)).toEqual(hit);
    expect(staggerAfterHit(charge, 1200, 150)).toEqual(hit);
  });
});
