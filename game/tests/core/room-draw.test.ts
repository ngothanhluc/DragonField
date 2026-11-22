/**
 * Unit tests for the seeded room draw (`core/run/room-draw.ts`, ticket #38).
 *
 * The acceptance test (`room-pool.acceptance.test.ts`) proves the real chapters on disk; these
 * pin the small rules the run flow depends on: the draw is a permutation of the pool, the boss is
 * always last, and a chapter with fewer normal rooms than `DRAWN_NORMAL_ROOMS` (a fixture, a
 * chapter still being authored) plays all of them instead of inventing rooms.
 */
import { describe, expect, it } from 'vitest';
import { parseLevelData, type ChapterData, type LevelData } from '../../assets/scripts/core/level/level-data';
import { DRAWN_NORMAL_ROOMS, drawRunRooms } from '../../assets/scripts/core/run/room-draw';

/** Minimal valid room of `chapter`, one chaser, no obstacles. */
function room(chapter: number, number: number, boss = false): LevelData {
  return parseLevelData({
    id: `ch${chapter}-r${number}`,
    chapter,
    room: number,
    isBossRoom: boss,
    size: boss ? { cols: 32, rows: 18 } : { cols: 128, rows: 72 },
    tileSizePx: 16,
    playerStart: { x: 4, y: 4 },
    waves: [{ enemies: [{ role: 'chaser', at: { x: 20, y: 10 }, elite: false }] }],
    obstacles: [],
    doors: [],
    ...(boss ? { boss: { name: 'TenguBlue' }, bossStart: { x: 16, y: 5 } } : {}),
  });
}

function chapter(normal: number, withBoss = true): ChapterData {
  const rooms: LevelData[] = [];
  for (let index = 1; index <= normal; index += 1) rooms.push(room(1, index));
  if (withBoss) rooms.push(room(1, normal + 1, true));
  return { chapter: 1, rooms };
}

describe('drawRunRooms', () => {
  it('plays 8 distinct normal rooms and the boss last', () => {
    const data = chapter(16);
    for (let seed = 1; seed <= 20; seed += 1) {
      const drawn = drawRunRooms(data, seed);
      expect(drawn).toHaveLength(DRAWN_NORMAL_ROOMS + 1);
      const normal = drawn.slice(0, DRAWN_NORMAL_ROOMS);
      expect(new Set(normal.map((level) => level.id)).size).toBe(DRAWN_NORMAL_ROOMS);
      expect(normal.every((level) => !level.isBossRoom)).toBe(true);
      expect(drawn[DRAWN_NORMAL_ROOMS]?.isBossRoom).toBe(true);
    }
  });

  it('is deterministic per seed and never mutates the chapter', () => {
    const data = chapter(16);
    const order = data.rooms.map((level) => level.id);

    const first = drawRunRooms(data, 42).map((level) => level.id);
    expect(drawRunRooms(data, 42).map((level) => level.id)).toEqual(first);
    expect(drawRunRooms(data, 7).map((level) => level.id)).not.toEqual(first);
    expect(data.rooms.map((level) => level.id)).toEqual(order);
  });

  it('a chapter with fewer normal rooms than a run needs plays all of them', () => {
    const three = drawRunRooms(chapter(3, false), 5);
    expect(three.map((level) => level.room).sort((a, b) => a - b)).toEqual([1, 2, 3]);

    const twoAndBoss = drawRunRooms(chapter(2), 5);
    expect(twoAndBoss).toHaveLength(3);
    expect(twoAndBoss[twoAndBoss.length - 1]?.isBossRoom).toBe(true);
  });

  it('a boss-only chapter plays just the boss', () => {
    const drawn = drawRunRooms(chapter(0), 1);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.isBossRoom).toBe(true);
  });
});
