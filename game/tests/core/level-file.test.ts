import { describe, expect, it } from 'vitest';
import type { ChapterData } from '../../assets/scripts/core/level/level-data';
import { loadChapterOne, roomOf } from '../helpers/tmx-levels';

function loadChapter(): ChapterData {
  return loadChapterOne();
}

/**
 * Test trên file `.tmx` thật, không phải fixture inline.
 * Mục đích: file trong `assets/resources/data/levels/` không thể lệch schema mà
 * `bun run check` vẫn xanh.
 */
describe('assets/resources/data/levels/chapter-1/*.tmx', () => {
  it('parse được và có đủ 9 phòng', () => {
    const chapter = loadChapter();

    expect(chapter.rooms).toHaveLength(9);
  });

  it('phòng 1 có ít nhất 3 wave và vật cản để né đạn', () => {
    const first = roomOf(loadChapter(), 1);

    expect(first.waves.length).toBeGreaterThanOrEqual(3);
    expect(first.obstacles.length).toBeGreaterThan(0);
  });

  it('phòng 1 chứa đủ 2 vai trò địch (chaser + caster)', () => {
    const roles = new Set(
      roomOf(loadChapter(), 1).waves.flatMap((wave) =>
        wave.enemies.map((enemy) => enemy.role),
      ),
    );

    expect(roles).toEqual(new Set(['chaser', 'caster']));
  });

  it('phòng cuối là boss room có tên boss', () => {
    const rooms = loadChapter().rooms;
    const last = rooms[rooms.length - 1];

    expect(last?.isBossRoom).toBe(true);
    expect(last?.boss?.name).toBe('TenguBlue');
  });
});
