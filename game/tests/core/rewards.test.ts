import { describe, expect, it } from 'vitest';
import { NORMAL_ROOMS_PER_CHAPTER, ROOMS_PER_CHAPTER } from '../../assets/scripts/core/run/run-state';
import {
  GOLD,
  MAX_GOLD,
  applyGold,
  goldForKill,
  goldForRoomClear,
  summariseRun,
} from '../../assets/scripts/core/run/rewards';
import { createDefaultSave, parseSaveData } from '../../assets/scripts/core/save/save-data';

describe('GOLD — reward table', () => {
  it('matches the GDD numbers: chaser/caster 1, tank 3, elite ×3, room 5, boss 50', () => {
    expect(GOLD).toEqual({
      chaser: 1,
      caster: 1,
      tank: 3,
      // #42 — sniper/splitter and their brood.
      sniper: 2,
      splitter: 2,
      splitling: 1,
      eliteMultiplier: 3,
      roomClear: 5,
      boss: 50,
    });
  });

  it('goldForKill returns the right amount per role', () => {
    expect(goldForKill('chaser', false)).toBe(1);
    expect(goldForKill('caster', false)).toBe(1);
    expect(goldForKill('tank', false)).toBe(3);
    expect(goldForKill('sniper', false)).toBe(2);
    expect(goldForKill('splitter', false)).toBe(2);
    expect(goldForKill('splitling', false)).toBe(1);
  });

  it('elites are ×3 and always higher than the regular version', () => {
    for (const role of ['chaser', 'caster', 'tank', 'sniper', 'splitter', 'splitling'] as const) {
      expect(goldForKill(role, true)).toBe(goldForKill(role, false) * GOLD.eliteMultiplier);
      expect(goldForKill(role, true)).toBeGreaterThan(goldForKill(role, false));
    }

    expect(goldForKill('tank', true)).toBe(9);
  });

  it('goldForRoomClear: regular room 5, boss 50', () => {
    expect(goldForRoomClear(false)).toBe(GOLD.roomClear);
    expect(goldForRoomClear(true)).toBe(GOLD.boss);
  });
});

describe('applyGold — adds and clamps', () => {
  it('adds to existing gold and returns the same value', () => {
    const save = { ...createDefaultSave(), gold: 40 };

    const { save: next, gold } = applyGold(save, 12);

    expect(gold).toBe(52);
    expect(next.gold).toBe(52);
  });

  it('does not modify the passed save, only returns a new one', () => {
    const save = { ...createDefaultSave(), gold: 40 };

    applyGold(save, 12);

    expect(save.gold).toBe(40);
  });

  it('keeps the other save fields intact', () => {
    const save = {
      ...createDefaultSave(),
      gold: 7,
      chaptersUnlocked: 2,
      best: { chapter: 1, room: NORMAL_ROOMS_PER_CHAPTER },
    };

    const { save: next } = applyGold(save, 5);

    expect(next.chaptersUnlocked).toBe(2);
    expect(next.best).toEqual(save.best);
    expect(next.upgrades).toEqual(save.upgrades);
    expect(next.settings).toEqual(save.settings);
    expect(next.version).toBe(save.version);
  });

  it('clamps negative numbers to 0, never negative gold', () => {
    expect(applyGold(createDefaultSave(), -10).gold).toBe(0);
    expect(applyGold({ ...createDefaultSave(), gold: 10 }, -50).gold).toBe(0);
  });

  it('clamps huge numbers to MAX_GOLD and stays finite', () => {
    const huge = applyGold(createDefaultSave(), Number.MAX_VALUE);
    expect(huge.gold).toBe(MAX_GOLD);
    expect(Number.isFinite(huge.gold)).toBe(true);

    const nearlyFull = applyGold({ ...createDefaultSave(), gold: MAX_GOLD }, 1_000);
    expect(nearlyFull.gold).toBe(MAX_GOLD);
  });

  it('NaN/±Infinity mint no gold', () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { gold } = applyGold({ ...createDefaultSave(), gold: 15 }, amount);
      expect(gold).toBe(15);
    }
  });

  it('floors to an integer and the result parses', () => {
    const { save, gold } = applyGold(createDefaultSave(), 2.9);

    expect(gold).toBe(2);
    expect(Number.isInteger(save.gold)).toBe(true);
    expect(parseSaveData(save).gold).toBe(2);
  });

  it('a broken save (NaN gold) is cleaned to 0 when adding', () => {
    const { gold } = applyGold({ ...createDefaultSave(), gold: Number.NaN }, 3);
    expect(gold).toBe(3);
  });
});

describe('summariseRun — shape for the result screen', () => {
  it('won run: right fields, right derived values', () => {
    const summary = summariseRun({
      roomsCleared: ROOMS_PER_CHAPTER,
      kills: 31,
      goldEarned: 123,
      durationMs: 60_800,
      status: 'won',
    });

    expect(summary).toEqual({
      status: 'won',
      roomsCleared: ROOMS_PER_CHAPTER,
      kills: 31,
      goldEarned: 123,
      durationMs: 60_800,
      durationSeconds: 60.8,
      won: true,
      roomLabel: `${ROOMS_PER_CHAPTER}/${ROOMS_PER_CHAPTER}`,
    });
  });

  it('lost run: won = false, still keeping the progress reached', () => {
    const summary = summariseRun({
      roomsCleared: 3,
      kills: 9,
      goldEarned: 20,
      durationMs: 12_345,
      status: 'lost',
    });

    expect(summary.won).toBe(false);
    expect(summary.roomLabel).toBe(`3/${ROOMS_PER_CHAPTER}`);
    expect(summary.durationSeconds).toBe(12.3);
  });

  it('sanitises negative/NaN/overflow numbers', () => {
    const summary = summariseRun({
      roomsCleared: -2,
      kills: Number.NaN,
      goldEarned: -50,
      durationMs: Number.POSITIVE_INFINITY,
      status: 'lost',
    });

    expect(summary.roomsCleared).toBe(0);
    expect(summary.kills).toBe(0);
    expect(summary.goldEarned).toBe(0);
    expect(summary.durationMs).toBe(0);
    expect(summary.durationSeconds).toBe(0);
    expect(summary.roomLabel).toBe(`0/${ROOMS_PER_CHAPTER}`);
  });

  it('roomsCleared beyond the room total is clamped to 9', () => {
    const summary = summariseRun({
      roomsCleared: 27,
      kills: 0,
      goldEarned: 0,
      durationMs: 0,
      status: 'won',
    });

    expect(summary.roomsCleared).toBe(ROOMS_PER_CHAPTER);
  });
});
