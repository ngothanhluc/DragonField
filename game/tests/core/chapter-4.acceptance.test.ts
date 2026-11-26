/**
 * Ticket #45 acceptance: chapter 4 (desert) — a 15–18 room 64×36 pool + a 32×18 boss arena using
 * the ch4 boss pool, a prop catalogue, unlocked after clearing ch3, and the save v1 → v2 migration.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOSS_POOLS, pickBoss } from '../../assets/scripts/core/boss/boss-pool';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import { PROP_CATALOGUE } from '../../assets/scripts/core/level/props';
import { CHAPTERS_PER_RUN } from '../../assets/scripts/core/run/run-state';
import { drawRunRooms } from '../../assets/scripts/core/run/room-draw';
import {
  SAVE_VERSION,
  createDefaultSave,
  migrate,
  unlockNextChapter,
} from '../../assets/scripts/core/save/save-data';
import { simulateRun } from '../../assets/scripts/core/sim/run-simulation';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

function chapterFour() {
  return chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, 'chapter-4')));
}

describe('chapter 4 content', () => {
  it('has a pool of 15–18 normal 64×36 rooms and one 32×18 boss room, last', () => {
    const chapter = chapterFour();
    expect(chapter.chapter).toBe(4);
    const normal = chapter.rooms.filter((room) => !room.isBossRoom);
    expect(normal.length).toBeGreaterThanOrEqual(15);
    expect(normal.length).toBeLessThanOrEqual(18);
    for (const room of normal) expect(room.size, room.id).toEqual({ cols: 64, rows: 36 });
    const last = chapter.rooms[chapter.rooms.length - 1];
    expect(last?.isBossRoom).toBe(true);
    expect(last?.size).toEqual({ cols: 32, rows: 18 });
  });

  it('draws 8 rooms + boss per seed, and its boss comes from the ch4 pool', () => {
    const rooms = drawRunRooms(chapterFour(), 45);
    expect(rooms).toHaveLength(9);
    expect([...(BOSS_POOLS[4] ?? [])].sort()).toEqual(['racoon', 'redtengu']);
    for (let seed = 1; seed <= 10; seed += 1) expect(BOSS_POOLS[4]).toContain(pickBoss(4, seed));
  });

  it('has a desert prop catalogue with houses/tents and trees or cacti', () => {
    const defs = PROP_CATALOGUE[4] ?? [];
    expect(defs.filter((def) => def.solid).length).toBeGreaterThanOrEqual(8);
    expect(defs.filter((def) => !def.solid).length).toBeGreaterThanOrEqual(6);
    expect(defs.some((def) => def.kind === 'house')).toBe(true);
    expect(defs.some((def) => def.sheet.includes('Desert') || def.sheet.includes('camp'))).toBe(true);
  });

  it('a god-mode run of chapter 4 reaches the boss and wins', () => {
    const result = simulateRun({
      seed: 45,
      level: chapterFour(),
      policy: () => ({ up: false, down: false, left: false, right: false }),
      godMode: true,
      maxDurationMs: 4_500_000,
    });
    expect(result.status).toBe('won');
    expect(result.roomsCleared).toBe(9);
  }, 600_000);
});

describe('four chapters and the unlock', () => {
  it('a run has 4 chapters and clearing ch3 unlocks ch4', () => {
    expect(CHAPTERS_PER_RUN).toBe(4);
    const save = { ...createDefaultSave(), chaptersUnlocked: 3 };
    expect(unlockNextChapter(save, 3).chaptersUnlocked).toBe(4);
    expect(unlockNextChapter(save, 2).chaptersUnlocked).toBe(3);
  });
});

describe('save v1 → v2', () => {
  const v1 = {
    version: 1,
    gold: 321,
    upgrades: { hearts: 2, damage: 3, fireRate: 1 },
    chaptersUnlocked: 3,
    best: { chapter: 3, room: 9 },
    settings: { volume: 0.4, fullscreen: false, screenShake: false, damageNumbers: true, effects: 'reduced' },
  };

  it('a fresh save is at least v2', () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(2);
    expect(createDefaultSave().version).toBe(SAVE_VERSION);
  });

  it('keeps gold, upgrades, unlocks, best and settings; ch4 stays locked until ch3 is cleared again', () => {
    const migrated = migrate(v1);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.gold).toBe(321);
    expect(migrated.upgrades).toMatchObject({ hearts: 2, damage: 3, fireRate: 1 });
    expect(migrated.chaptersUnlocked).toBe(3);
    expect(migrated.best).toEqual({ chapter: 3, room: 9 });
    expect(migrated.settings).toMatchObject({ volume: 0.4, screenShake: false, damageNumbers: true, effects: 'reduced' });
    expect(unlockNextChapter(migrated, 3).chaptersUnlocked).toBe(4);
  });

  it('a v2 save round-trips unchanged', () => {
    const migrated = migrate(v1);
    expect(migrate(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });
});
