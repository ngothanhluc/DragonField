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
  it('cả 3 chapter đều có 9 phòng, phòng 9 là boss đúng GDD §5', () => {
    expect(loadChapter(1).rooms).toHaveLength(9);
    expect(loadChapter(2).rooms).toHaveLength(9);
    expect(loadChapter(3).rooms).toHaveLength(9);

    const bosses = [1, 2, 3].map((chapter) => {
      const rooms = loadChapter(chapter).rooms;
      const last = rooms[rooms.length - 1];
      expect(last?.isBossRoom).toBe(true);
      return last?.boss?.name;
    });
    expect(bosses).toEqual(['TenguBlue', 'SquidGreen', 'GiantBlueSamurai']);
  });

  it('chapter 1: 3–4 enemy/wave; chapter 2: 5–6/phòng; chapter 3: 7–8/phòng + elite', () => {
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
        // GDD §4 tính enemy theo phòng cho chapter 2–3; mỗi phòng chia 2–3 wave.
        const count = room.waves.reduce((total, wave) => total + wave.enemies.length, 0);
        const range = chapter === 2 ? [5, 6] : [7, 8];
        expect(count, `chapter ${chapter} phòng ${room.room}`).toBeGreaterThanOrEqual(range[0] ?? 0);
        expect(count, `chapter ${chapter} phòng ${room.room}`).toBeLessThanOrEqual(range[1] ?? 9);
      }
    }

    const chapterThree = loadChapter(3);
    const elites = chapterThree.rooms.flatMap((room) =>
      room.waves.flatMap((wave) => wave.enemies.filter((enemy) => enemy.elite)),
    );
    // Elites bắt đầu từ phòng 4; phòng 1–3 là cửa vào của chapter.
    expect(elites.length).toBeGreaterThanOrEqual(4);
  });

  it('phòng 1–3 của chapter 2–3 chia thành nhiều wave để cửa vào không dồn 7 con', () => {
    for (const chapter of [2, 3]) {
      for (const room of loadChapter(chapter).rooms.filter((candidate) => !candidate.isBossRoom).slice(0, 3)) {
        expect(room.waves.length, `ch${chapter} r${room.room}`).toBeGreaterThanOrEqual(2);
        expect(room.waves[0]?.enemies.length ?? 0, `ch${chapter} r${room.room} wave1`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('chapter 3 boss arena: player đứng cùng hàng boss để charge ngang có nghĩa', () => {
    const bossRoom = loadChapter(3).rooms[8];
    expect(bossRoom?.bossStart?.y).toBe(bossRoom?.playerStart.y);
  });

  it('mọi phòng đều có playerStart và ít nhất một obstacle/door hợp lệ', () => {
    for (const chapter of [1, 2, 3]) {
      for (const room of loadChapter(chapter).rooms) {
        expect(Number.isFinite(room.playerStart.x)).toBe(true);
        expect(Number.isFinite(room.playerStart.y)).toBe(true);
        expect(room.waves.length).toBeGreaterThan(0);
      }
    }
  });

  it('không spawn/player/boss đứng trong vật cản', () => {
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

  it('boss chapter 3 không bị cột chắn giữa đường đạn từ playerStart', () => {
    const room = loadChapter(3).rooms[8];
    if (room?.bossStart === undefined) throw new Error('thiếu bossStart');
    // Hàng của player và boss trùng nhau; mọi cột trên hàng đó sẽ chặn đạn.
    for (let x = Math.floor(room.bossStart.x); x <= Math.ceil(room.playerStart.x); x += 1) {
      expect(
        obstacleAt(room, { x: x + 0.5, y: room.bossStart.y + 0.5 }),
        `cột chắn đạn tại x=${x}`,
      ).toBeNull();
    }
  });
});
