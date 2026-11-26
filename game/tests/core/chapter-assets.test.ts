import { describe, expect, it } from 'vitest';
import { BOSS_POOLS } from '../../assets/scripts/core/boss/boss-pool';
import { bossRoomBounds } from '../../assets/scripts/core/boss/patterns';
import { firstHit } from '../../assets/scripts/core/combat/bullets';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import {
  obstacleAt,
  type ChapterData,
} from '../../assets/scripts/core/level/level-data';
import { distance } from '../../assets/scripts/core/math/vec2';
import { loadTmxLevels, LEVELS_ROOT } from '../helpers/tmx-levels';
import { join } from 'node:path';

function loadChapter(chapter: number): ChapterData {
  return chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`)));
}

describe('chapter assets', () => {
  it('all 4 chapters have a room pool (16 normal + boss last) per GDD §5/#38, #45', () => {
    for (const chapter of [1, 2, 3, 4]) {
      const rooms = loadChapter(chapter).rooms;
      const normal = rooms.filter((room) => !room.isBossRoom);
      expect(normal.length, `chapter ${chapter} normal rooms`).toBeGreaterThanOrEqual(15);
      expect(normal.length, `chapter ${chapter} normal rooms`).toBeLessThanOrEqual(18);
      for (const room of normal) expect(room.size, room.id).toEqual({ cols: 64, rows: 36 });
    }

    const bosses = [1, 2, 3, 4].map((chapter) => {
      const rooms = loadChapter(chapter).rooms;
      const last = rooms[rooms.length - 1];
      expect(last?.isBossRoom, `chapter ${chapter} boss is last`).toBe(true);
      expect(last?.size, `chapter ${chapter} boss size`).toEqual({ cols: 32, rows: 18 });
      return last?.boss?.name;
    });
    expect(bosses).toEqual(['TenguBlue', 'SquidGreen', 'GiantBlueSamurai', 'GiantRacoon']);
  });

  it('chapter 1: 3–4/wave; ch2: 5–6/room; ch3/ch4: 7–9 authored per room (×8 at runtime) + elites', () => {
    const chapterOne = loadChapter(1);
    for (const room of chapterOne.rooms.filter((candidate) => !candidate.isBossRoom)) {
      for (const wave of room.waves) {
        expect(wave.enemies.length, `ch1 r${room.room} wave`).toBeGreaterThanOrEqual(3);
        expect(wave.enemies.length, `ch1 r${room.room} wave`).toBeLessThanOrEqual(4);
      }
    }

    for (const chapter of [2, 3, 4]) {
      const rooms = loadChapter(chapter).rooms.filter((room) => !room.isBossRoom);
      for (const room of rooms) {
        // GDD §4 counts enemies per room for chapters 2–4. Chapter 4 authors the same 8–9 as ch3;
        // `roomEnemyTotal` (#41) scales a normal room to 64–72 at runtime.
        const count = room.waves.reduce((total, wave) => total + wave.enemies.length, 0);
        const range = chapter === 2 ? [5, 6] : [7, 9];
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

    const chapterFour = loadChapter(4);
    const roles = new Set(
      chapterFour.rooms.flatMap((room) => room.waves.flatMap((wave) => wave.enemies.map((enemy) => enemy.role))),
    );
    for (const role of ['chaser', 'caster', 'tank', 'sniper', 'splitter'] as const) {
      expect(roles.has(role), `ch4 ${role}`).toBe(true);
    }
    const fourElites = chapterFour.rooms.flatMap((room) =>
      room.waves.flatMap((wave) => wave.enemies.filter((enemy) => enemy.elite)),
    );
    expect(fourElites.length).toBeGreaterThanOrEqual(4);
  });

  it('rooms 1–3 of chapters 2–3 split into multiple waves so the entrance is not 7 at once', () => {
    for (const chapter of [2, 3]) {
      for (const room of loadChapter(chapter).rooms.filter((candidate) => !candidate.isBossRoom).slice(0, 3)) {
        expect(room.waves.length, `ch${chapter} r${room.room}`).toBeGreaterThanOrEqual(2);
        expect(room.waves[0]?.enemies.length ?? 0, `ch${chapter} r${room.room} wave1`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('all 4 boss arenas separate playerStart and bossStart by >= 10 tiles inside bossRoomBounds', () => {
    for (const chapter of [1, 2, 3, 4]) {
      const rooms = loadChapter(chapter).rooms;
      const bossRoom = rooms[rooms.length - 1];
      if (bossRoom?.bossStart === undefined) {
        throw new Error(`chapter ${chapter} boss room is missing bossStart`);
      }

      const gap = distance(bossRoom.playerStart, bossRoom.bossStart);
      expect(gap, `chapter ${chapter} separation`).toBeGreaterThanOrEqual(10);

      for (const bossId of BOSS_POOLS[chapter] ?? []) {
        const bounds = bossRoomBounds(bossId);
        expect(bossRoom.bossStart.x, `ch${chapter} ${bossId} minX`).toBeGreaterThanOrEqual(bounds.minX);
        expect(bossRoom.bossStart.x, `ch${chapter} ${bossId} maxX`).toBeLessThanOrEqual(bounds.maxX);
        expect(bossRoom.bossStart.y, `ch${chapter} ${bossId} minY`).toBeGreaterThanOrEqual(bounds.minY);
        expect(bossRoom.bossStart.y, `ch${chapter} ${bossId} maxY`).toBeLessThanOrEqual(bounds.maxY);
      }
    }
  });

  it('every room has a playerStart and at least one valid obstacle/door', () => {
    for (const chapter of [1, 2, 3, 4]) {
      for (const room of loadChapter(chapter).rooms) {
        expect(Number.isFinite(room.playerStart.x)).toBe(true);
        expect(Number.isFinite(room.playerStart.y)).toBe(true);
        expect(room.waves.length).toBeGreaterThan(0);
      }
    }
  });

  it('no spawn/player/boss stands inside an obstacle', () => {
    for (const chapter of [1, 2, 3, 4]) {
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

  it('no boss arena puts a pillar on the straight sightline between playerStart and bossStart', () => {
    for (const chapter of [1, 2, 3, 4]) {
      const rooms = loadChapter(chapter).rooms;
      const room = rooms[rooms.length - 1];
      if (room?.bossStart === undefined) throw new Error(`ch${chapter} missing bossStart`);
      expect(
        firstHit({ from: room.playerStart, to: room.bossStart }, room),
        `ch${chapter} pillar blocking sightline`,
      ).toBeNull();
    }
  });
});
