import { describe, expect, it } from 'vitest';
import type { ChapterData } from '../../assets/scripts/core/level/level-data';
import { loadChapterOne, roomOf } from '../helpers/tmx-levels';

function loadChapter(): ChapterData {
  return loadChapterOne();
}

/**
 * Tests against real `.tmx` files, not inline fixtures.
 * Purpose: files under `assets/resources/data/levels/` cannot drift from the schema
 * while `bun run check` stays green.
 */
describe('assets/resources/data/levels/chapter-1/*.tmx', () => {
  it('parses and has all 9 rooms', () => {
    const chapter = loadChapter();

    expect(chapter.rooms).toHaveLength(9);
  });

  it('room 1 has at least 3 waves and obstacles to dodge projectiles', () => {
    const first = roomOf(loadChapter(), 1);

    expect(first.waves.length).toBeGreaterThanOrEqual(3);
    expect(first.obstacles.length).toBeGreaterThan(0);
  });

  it('room 1 has both enemy roles (chaser + caster)', () => {
    const roles = new Set(
      roomOf(loadChapter(), 1).waves.flatMap((wave) =>
        wave.enemies.map((enemy) => enemy.role),
      ),
    );

    expect(roles).toEqual(new Set(['chaser', 'caster']));
  });

  it('the last room is a boss room with a boss name', () => {
    const rooms = loadChapter().rooms;
    const last = rooms[rooms.length - 1];

    expect(last?.isBossRoom).toBe(true);
    expect(last?.boss?.name).toBe('TenguBlue');
  });
});
