import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseChapterData,
  type ChapterData,
} from '../../assets/scripts/core/level/level-data';

const here = dirname(fileURLToPath(import.meta.url));
const chapterFile = join(here, '../../assets/resources/data/levels/chapter-1.json');

function loadChapter(): ChapterData {
  return parseChapterData(JSON.parse(readFileSync(chapterFile, 'utf8')));
}

/**
 * Test file JSON thật, không phải fixture inline.
 * Mục đích: file trong `assets/resources/data/` không thể lệch schema mà build vẫn xanh.
 */
describe('assets/resources/data/levels/chapter-1.json', () => {
  it('parse được và có đủ 9 phòng', () => {
    const chapter = loadChapter();

    expect(chapter.rooms).toHaveLength(9);
  });

  it('phòng 1 có ít nhất 3 wave và vật cản để né đạn', () => {
    const [first] = loadChapter().rooms;

    expect(first).toBeDefined();
    expect(first?.waves.length).toBeGreaterThanOrEqual(3);
    expect(first?.obstacles.length).toBeGreaterThan(0);
  });

  it('phòng 1 chứa đủ 3 vai trò địch', () => {
    const roles = new Set(
      (loadChapter().rooms[0]?.waves ?? []).flatMap((wave) =>
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
