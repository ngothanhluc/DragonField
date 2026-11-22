/**
 * Ticket #38 acceptance: each chapter has a pool of 15–18 generated 128×72 normal rooms plus its
 * 32×18 boss room; a run draws 8 distinct normal rooms by seed, then the boss; every generated
 * room is traversable from the player start to every door and spreads its spawns.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOM_EDGE_MARGIN_TILES } from '../../assets/scripts/core/enemies/behaviours';
import { buildFlowField, buildNavGrid } from '../../assets/scripts/core/enemies/navigation';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import type { ChapterData, LevelData } from '../../assets/scripts/core/level/level-data';
import { DRAWN_NORMAL_ROOMS, drawRunRooms } from '../../assets/scripts/core/run/room-draw';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const chapters: Readonly<Record<number, ChapterData>> = Object.fromEntries(
  [1, 2, 3, 4].map((n) => [n, chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${n}`)))]),
);

function normalRooms(chapter: ChapterData): LevelData[] {
  return chapter.rooms.filter((room) => !room.isBossRoom);
}

describe('room pool on disk', () => {
  for (const n of [1, 2, 3, 4]) {
    it(`chapter ${n}: 15–18 normal rooms of 128×72, then one 32×18 boss room`, () => {
      const chapter = chapters[n];
      if (chapter === undefined) throw new Error('chapter');
      const normal = normalRooms(chapter);
      expect(normal.length).toBeGreaterThanOrEqual(15);
      expect(normal.length).toBeLessThanOrEqual(18);
      for (const room of normal) expect(room.size, room.id).toEqual({ cols: 128, rows: 72 });
      const boss = chapter.rooms.filter((room) => room.isBossRoom);
      expect(boss).toHaveLength(1);
      expect(boss[0]?.size).toEqual({ cols: 32, rows: 18 });
    });
  }
});

describe('seeded draw', () => {
  const chapter = chapters[1];
  if (chapter === undefined) throw new Error('chapter');

  it('draws 8 distinct normal rooms then the boss, deterministic per seed', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const rooms = drawRunRooms(chapter, seed);
      expect(rooms).toHaveLength(DRAWN_NORMAL_ROOMS + 1);
      expect(DRAWN_NORMAL_ROOMS).toBe(8);
      const normal = rooms.slice(0, 8);
      expect(new Set(normal.map((room) => room.id)).size).toBe(8);
      expect(normal.every((room) => !room.isBossRoom)).toBe(true);
      expect(rooms[8]?.isBossRoom).toBe(true);
      expect(drawRunRooms(chapter, seed).map((room) => room.id)).toEqual(rooms.map((room) => room.id));
    }
  });

  it('different seeds give different runs, and the whole pool gets used', () => {
    const runs = new Set<string>();
    const used = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const ids = drawRunRooms(chapter, seed).map((room) => room.id);
      runs.add(ids.join(','));
      for (const id of ids) used.add(id);
    }
    expect(runs.size).toBeGreaterThan(30);
    expect(used.size).toBe(normalRooms(chapter).length + 1);
  });
});

describe('generated room geometry', () => {
  for (const n of [1, 2, 3, 4]) {
    it(`chapter ${n}: start reaches every door, spawns spread over the room, obstacles per screen bounded`, () => {
      const chapter = chapters[n];
      if (chapter === undefined) throw new Error('chapter');
      const problems: string[] = [];
      for (const room of normalRooms(chapter)) {
        const grid = buildNavGrid(room, 0.25, ROOM_EDGE_MARGIN_TILES);
        // Two door spots per room: the door choice (#39) offers 2 doors after each normal room.
        if (room.doors.length < 2) problems.push(`${room.id}: ${room.doors.length} doors`);
        for (const door of room.doors) {
          const field = buildFlowField(grid, door.at);
          const distance = field.distanceAt(Math.floor(room.playerStart.x), Math.floor(room.playerStart.y));
          if (!Number.isFinite(distance)) problems.push(`${room.id}: door ${JSON.stringify(door.at)} unreachable`);
        }
        // Spawn points cover at least 4 different screens of the 4×4 grid of 32×18 screens.
        const screens = new Set<string>();
        for (const wave of room.waves) {
          for (const enemy of wave.enemies) screens.add(`${Math.floor(enemy.at.x / 32)},${Math.floor(enemy.at.y / 18)}`);
        }
        if (screens.size < 4) problems.push(`${room.id}: spawns in only ${screens.size} screens`);
        // Every screen has some cover to dodge behind, and none is a maze.
        for (let sx = 0; sx < 4; sx += 1) {
          for (let sy = 0; sy < 4; sy += 1) {
            const count = room.obstacles.filter((o) => {
              const cx = o.x + o.width / 2;
              const cy = o.y + o.height / 2;
              return cx >= sx * 32 && cx < (sx + 1) * 32 && cy >= sy * 18 && cy < (sy + 1) * 18;
            }).length;
            if (count < 1 || count > 16) problems.push(`${room.id}: screen ${sx},${sy} has ${count} obstacles`);
          }
        }
      }
      expect(problems.slice(0, 10)).toEqual([]);
    });
  }
});
