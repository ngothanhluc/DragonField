/**
 * Ticket #39 acceptance: after each normal room the player picks 1 of 2 doors with a reward
 * (at least one a fight), the last normal room leads to the boss, and the chosen door decides the
 * next room's clear reward (skill pick or a gold bonus).
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../assets/scripts/core/enemies/tuning';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import { COMBAT_REWARDS, clearRewardFor, doorOffers, type DoorReward } from '../../assets/scripts/core/run/doors';
import { simulateRun } from '../../sim/run-simulation';
import { loadTmxLevels } from '../helpers/tmx-levels';

const XP_GOLD: readonly DoorReward[] = ['xp', 'gold'];
const ALL: readonly DoorReward[] = ['xp', 'gold', 'heal', 'shop', 'chest'];
const doorsTuning = (TUNING as unknown as { doors?: { goldBonus: number; xpBonus: number } }).doors;

describe('door offers (M17 single North Portal cadence)', () => {
  it('always opens exactly 1 North Portal per room, deterministic per seed', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      for (let room = 1; room <= 7; room += 1) {
        const offers = doorOffers(seed, room, 8, XP_GOLD);
        expect(offers, `seed ${seed} room ${room}`).toHaveLength(1);
        expect(offers.every((reward) => XP_GOLD.includes(reward))).toBe(true);
        expect(doorOffers(seed, room, 8, XP_GOLD)).toEqual(offers);
      }
    }
  });

  it('after the last normal room there is one Boss Portal', () => {
    for (let seed = 1; seed <= 10; seed += 1) expect(doorOffers(seed, 8, 8, ALL)).toEqual(['boss']);
  });

  it('after Room 4 opens a seeded mid-chapter Special Room (Shop or Chest) and normal portals elsewhere', () => {
    const midSeen = new Set<DoorReward>();
    for (let seed = 1; seed <= 200; seed += 1) {
      for (let room = 1; room <= 7; room += 1) {
        const offers = doorOffers(seed, room, 8, ALL);
        expect(offers).toHaveLength(1);
        if (room === 4) {
          expect(['shop', 'chest']).toContain(offers[0]);
          midSeen.add(offers[0]!);
        } else {
          expect(COMBAT_REWARDS).toContain(offers[0]!);
        }
      }
    }
    expect([...midSeen].sort()).toEqual(['chest', 'shop']);
  });

  it('seeds vary the mid-chapter Special Room offer across runs', () => {
    const specialPicks = new Set<DoorReward>();
    for (let seed = 1; seed <= 30; seed += 1) {
      specialPicks.add(doorOffers(seed, 4, 8, ALL)[0]!);
    }
    expect(specialPicks.size).toBe(2);
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

describe('balance sim models the single North Portal + mid-chapter Special Room cadence', () => {
  it('plays Rooms 1–4, enters 1 mid-chapter Special Room after Room 4, then Rooms 5–8 and Room 9 Boss', () => {
    const chapter = chapterFromLevels(loadTmxLevels());
    type DoorEvent = { kind: 'door'; room: number; offers: DoorReward[]; chosen: DoorReward };
    type SpecialEvent = { kind: 'special'; room: number; reward: DoorReward };
    const result = simulateRun({
      seed: 39,
      level: chapter,
      policy: () => ({ up: false, down: false, left: false, right: false }),
      godMode: true,
    });
    const events = result.events as unknown as readonly { kind: string }[];
    const doors = events.filter((event) => event.kind === 'door') as unknown as DoorEvent[];
    const specials = events.filter((event) => event.kind === 'special') as unknown as SpecialEvent[];

    expect(result.status).toBe('won');
    expect(result.roomsCleared).toBe(9);
    for (const door of doors) expect(door.offers).toHaveLength(1);
    expect(specials).toHaveLength(1);
    expect(specials[0]?.room).toBe(4);
    expect(['shop', 'chest']).toContain(specials[0]?.reward);
    expect(doors[doors.length - 1]?.chosen).toBe('boss');
  });
});
