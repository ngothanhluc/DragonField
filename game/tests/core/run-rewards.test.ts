import { describe, expect, it } from 'vitest';
import { RunRewards } from '../../assets/scripts/core/run/run-rewards';
import { MAX_GOLD } from '../../assets/scripts/core/run/rewards';

describe('RunRewards — kill', () => {
  it('adds the right amount per role and counts kills', () => {
    const rewards = new RunRewards();

    expect(rewards.awardKill('chaser', false)).toBe(1);
    expect(rewards.awardKill('caster', false)).toBe(1);
    expect(rewards.awardKill('tank', false)).toBe(3);

    expect(rewards.goldEarned).toBe(5);
    expect(rewards.killCount).toBe(3);
  });

  it('elites are ×3', () => {
    const rewards = new RunRewards();
    expect(rewards.awardKill('tank', true)).toBe(9);
    expect(rewards.goldEarned).toBe(9);
  });

  it('Greed multiplies each kill and rounds instead of losing gold', () => {
    const rewards = new RunRewards();

    // 3 gold × 1.5 = 4.5 → 5 (not 4 via floor).
    expect(rewards.awardKill('tank', false, 1.5)).toBe(5);
    // 9 × 1.5 = 13.5 → 14.
    expect(rewards.awardKill('tank', true, 1.5)).toBe(14);
    expect(rewards.goldEarned).toBe(19);
  });

  it('a broken Greed factor counts as 1, producing no negative gold', () => {
    const rewards = new RunRewards();

    expect(rewards.awardKill('chaser', false, Number.NaN)).toBe(1);
    expect(rewards.awardKill('chaser', false, -2)).toBe(1);
    expect(rewards.awardKill('chaser', false, 0)).toBe(1);
    expect(rewards.goldEarned).toBe(3);
  });
});

describe('RunRewards — rooms', () => {
  it('regular room 5, boss 50, applying Greed like kills', () => {
    const rewards = new RunRewards();

    expect(rewards.awardRoomClear(false)).toBe(5);
    expect(rewards.awardRoomClear(true)).toBe(50);
    expect(rewards.goldEarned).toBe(55);

    expect(new RunRewards().awardRoomClear(true, 1.2)).toBe(60);
  });

  it('never exceeds MAX_GOLD', () => {
    const rewards = new RunRewards();
    for (let index = 0; index < 2000; index += 1) rewards.awardRoomClear(true, 1.3);
    expect(rewards.goldEarned).toBeLessThanOrEqual(MAX_GOLD);
  });
});
