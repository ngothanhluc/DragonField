/**
 * Ticket #39 acceptance: after each normal room the player picks 1 of 2 doors with a reward
 * (at least one a fight), the last normal room leads to the boss, and the chosen door decides the
 * next room's clear reward (skill pick or a gold bonus).
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../assets/scripts/core/enemies/tuning';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import { COMBAT_REWARDS, clearRewardFor, doorOffers, type DoorReward } from '../../assets/scripts/core/run/doors';
import { simulateRun } from '../../assets/scripts/core/sim/run-simulation';
import { loadTmxLevels } from '../helpers/tmx-levels';

const XP_GOLD: readonly DoorReward[] = ['xp', 'gold'];
const ALL: readonly DoorReward[] = ['xp', 'gold', 'heal', 'shop', 'chest'];
const doorsTuning = (TUNING as unknown as { doors?: { goldBonus: number; xpBonus: number } }).doors;

describe('door offers', () => {
  it('rooms 1–7: two doors, at least one a fight, only enabled rewards, deterministic', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      for (let room = 1; room <= 7; room += 1) {
        const offers = doorOffers(seed, room, 8, XP_GOLD);
        expect(offers, `seed ${seed} room ${room}`).toHaveLength(2);
        expect(offers.some((reward) => COMBAT_REWARDS.includes(reward))).toBe(true);
        expect(offers.every((reward) => XP_GOLD.includes(reward))).toBe(true);
        expect(doorOffers(seed, room, 8, XP_GOLD)).toEqual(offers);
      }
    }
  });

  it('after the last normal room there is one door, to the boss', () => {
    for (let seed = 1; seed <= 10; seed += 1) expect(doorOffers(seed, 8, 8, ALL)).toEqual(['boss']);
  });

  it('with every reward enabled: never two non-fight doors, and specials do come up', () => {
    const seen = new Set<DoorReward>();
    for (let seed = 1; seed <= 200; seed += 1) {
      for (let room = 1; room <= 7; room += 1) {
        const offers = doorOffers(seed, room, 8, ALL);
        expect(offers.filter((reward) => !COMBAT_REWARDS.includes(reward)).length).toBeLessThanOrEqual(1);
        for (const reward of offers) seen.add(reward);
      }
    }
    expect([...seen].sort()).toEqual(['chest', 'gold', 'heal', 'shop', 'xp']);
  });

  it('seeds change the offers', () => {
    const runs = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      runs.add(Array.from({ length: 7 }, (_, i) => doorOffers(seed, i + 1, 8, XP_GOLD).join('+')).join('|'));
    }
    expect(runs.size).toBeGreaterThan(20);
  });
});

describe('clear rewards', () => {
  it('room 1 always defaults to xp; later rooms take the chosen door', () => {
    expect(clearRewardFor(1, null)).toBe('xp');
    expect(clearRewardFor(2, 'gold')).toBe('gold');
    expect(clearRewardFor(3, 'xp')).toBe('xp');
  });

  it('the gold and xp door bonuses live in tuning', () => {
    expect(doorsTuning?.goldBonus ?? 0).toBeGreaterThan(0);
    expect(doorsTuning?.xpBonus ?? 0).toBeGreaterThan(0);
  });
});

describe('balance sim models the door choice', () => {
  it('always taking the gold door turns later xp rooms into gold bonuses', () => {
    const chapter = chapterFromLevels(loadTmxLevels());
    type DoorEvent = { kind: 'door'; room: number; offers: DoorReward[]; chosen: DoorReward };
    type RewardEvent = { kind: 'reward'; room: number; reward: DoorReward; gold: number };
    const options = {
      seed: 39,
      level: chapter,
      policy: () => ({ up: false, down: false, left: false, right: false }),
      godMode: true,
      chooseDoor: (offers: readonly DoorReward[]) => Math.max(0, offers.indexOf('gold')),
    };
    const result = simulateRun(options as Parameters<typeof simulateRun>[0]);
    const events = result.events as unknown as readonly { kind: string }[];
    const doors = events.filter((event) => event.kind === 'door') as unknown as DoorEvent[];
    const rewards = events.filter((event) => event.kind === 'reward') as unknown as RewardEvent[];
    expect(doors.length).toBeGreaterThanOrEqual(7);
    expect(rewards.find((event) => event.room === 1)?.reward).toBe('xp');
    for (const door of doors) {
      const next = rewards.find((event) => event.room === door.room + 1);
      if (door.chosen === 'boss' || next === undefined) continue;
      expect(next.reward, `room ${door.room + 1}`).toBe(door.chosen);
      if (door.chosen === 'gold') expect(next.gold).toBeGreaterThanOrEqual(doorsTuning?.goldBonus ?? 1);
    }
    expect(doors.some((door) => door.chosen === 'gold')).toBe(true);
  });
});
