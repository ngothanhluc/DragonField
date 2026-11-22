import { describe, expect, it } from 'vitest';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import {
  obstacleAt,
  type ChapterData,
} from '../../assets/scripts/core/level/level-data';
import { loadTmxLevels, LEVELS_ROOT } from '../helpers/tmx-levels';
import { join } from 'node:path';

function loadChapter(chapter: number): ChapterData {
  return chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`)));
}

describe('chapter assets', () => {
  it('all 3 chapters have a room pool (16 normal + boss last) per GDD §5/#38', () => {
    for (const chapter of [1, 2, 3]) {
      const rooms = loadChapter(chapter).rooms;
      const normal = rooms.filter((room) => !room.isBossRoom);
      expect(normal.length, `chapter ${chapter} normal rooms`).toBeGreaterThanOrEqual(15);
      expect(normal.length, `chapter ${chapter} normal rooms`).toBeLessThanOrEqual(18);
      for (const room of normal) expect(room.size, room.id).toEqual({ cols: 128, rows: 72 });
    }

    const bosses = [1, 2, 3].map((chapter) => {
      const rooms = loadChapter(chapter).rooms;
      const last = rooms[rooms.length - 1];
      expect(last?.isBossRoom, `chapter ${chapter} boss is last`).toBe(true);
      expect(last?.size, `chapter ${chapter} boss size`).toEqual({ cols: 32, rows: 18 });
      return last?.boss?.name;
    });
    expect(bosses).toEqual(['TenguBlue', 'SquidGreen', 'GiantBlueSamurai']);
  });

  it('chapter 1: 3–4 enemies/wave; chapter 2: 5–6/room; chapter 3: 7–8/room + elite', () => {
    const chapterOne = loadChapter(1);
    for (const room of chapterOne.rooms.filter((candidate) => !candidate.isBossRoom)) {
      for (const wave of room.waves) {
        expect(wave.enemies.length, `ch1 r${room.room} wave`).toBeGreaterThanOrEqual(3);
        expect(wave.enemies.length, `ch1 r${room.room} wave`).toBeLessThanOrEqual(4);
      }
    }

    for (const chapter of [2, 3]) {
      const rooms = loadChapter(chapter).rooms.filter((room) => !room.isBossRoom);
      for (const room of rooms) {
        // GDD §4 counts enemies per room for chapters 2–3; each room splits into 2–3 waves.
        const count = room.waves.reduce((total, wave) => total + wave.enemies.length, 0);
        const range = chapter === 2 ? [5, 6] : [7, 8];
        expect(count, `chapter ${chapter} room ${room.room}`).toBeGreaterThanOrEqual(range[0] ?? 0);
        expect(count, `chapter ${chapter} room ${room.room}`).toBeLessThanOrEqual(range[1] ?? 9);
      }
    }

    const chapterThree = loadChapter(3);
    const elites = chapterThree.rooms.flatMap((room) =>
      room.waves.flatMap((wave) => wave.enemies.filter((enemy) => enemy.elite)),
    );
    // Elites start at room 4; rooms 1–3 are the chapter entrance.
    expect(elites.length).toBeGreaterThanOrEqual(4);
  });

  it('rooms 1–3 of chapters 2–3 split into multiple waves so the entrance is not 7 at once', () => {
    for (const chapter of [2, 3]) {
      for (const room of loadChapter(chapter).rooms.filter((candidate) => !candidate.isBossRoom).slice(0, 3)) {
        expect(room.waves.length, `ch${chapter} r${room.room}`).toBeGreaterThanOrEqual(2);
        expect(room.waves[0]?.enemies.length ?? 0, `ch${chapter} r${room.room} wave1`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('chapter 3 boss arena: the player stands on the boss row so a horizontal charge is meaningful', () => {
    const rooms = loadChapter(3).rooms;
    const bossRoom = rooms[rooms.length - 1];
    expect(bossRoom?.bossStart?.y).toBe(bossRoom?.playerStart.y);
  });

  it('every room has a playerStart and at least one valid obstacle/door', () => {
    for (const chapter of [1, 2, 3]) {
      for (const room of loadChapter(chapter).rooms) {
        expect(Number.isFinite(room.playerStart.x)).toBe(true);
        expect(Number.isFinite(room.playerStart.y)).toBe(true);
        expect(room.waves.length).toBeGreaterThan(0);
      }
    }
  });

  it('no spawn/player/boss stands inside an obstacle', () => {
    for (const chapter of [1, 2, 3]) {
      for (const room of loadChapter(chapter).rooms) {
        expect(obstacleAt(room, room.playerStart), `ch${chapter} r${room.room} player`).toBeNull();
        if (room.bossStart !== undefined) {
          expect(obstacleAt(room, room.bossStart), `ch${chapter} r${room.room} boss`).toBeNull();
        }
        for (const wave of room.waves) {
          for (const spawn of wave.enemies) {
            expect(
              obstacleAt(room, spawn.at),
              `ch${chapter} r${room.room} spawn ${spawn.role} @${spawn.at.x},${spawn.at.y}`,
            ).toBeNull();
          }
        }
      }
    }
  });

  it('the chapter 3 boss is not blocked by a pillar on the projectile path from playerStart', () => {
    const rooms = loadChapter(3).rooms;
    const room = rooms[rooms.length - 1];
    if (room?.bossStart === undefined) throw new Error('missing bossStart');
    // The player and boss rows coincide; any pillar on that row would block projectiles.
    for (let x = Math.floor(room.bossStart.x); x <= Math.ceil(room.playerStart.x); x += 1) {
      expect(
        obstacleAt(room, { x: x + 0.5, y: room.bossStart.y + 0.5 }),
        `pillar blocking the projectile at x=${x}`,
      ).toBeNull();
    }
  });
});
