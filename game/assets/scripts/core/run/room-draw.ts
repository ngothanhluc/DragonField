/**
 * Seeded room draw (M9, ticket #38, ADR-014): a run walks 8 distinct normal rooms drawn from the
 * chapter's pool, then the boss room.
 *
 * Chapters hold 15–18 generated normal rooms on disk (`scripts/generate-rooms.ts`); a run does not
 * play all of them, so two runs with different seeds feel different while the chapter's set of
 * rooms stays authored. The draw is pure and deterministic: the same chapter + seed always gives
 * the same list, in the same order.
 */
import type { ChapterData, LevelData } from '../level/level-data';
import { SeededRng } from '../rng';

/** Normal rooms per run before the boss (GDD §8). */
export const DRAWN_NORMAL_ROOMS = 8;

/** Seed offset of the room draw, so it never reuses the combat RNG stream of the run. */
const DRAW_SEED_SALT = 0x9e3779b1;

/**
 * The rooms a run plays, in order: `DRAWN_NORMAL_ROOMS` distinct normal rooms from the chapter's
 * pool chosen by `seed`, then the chapter's boss room. Pure and deterministic.
 *
 * A chapter with fewer normal rooms than `DRAWN_NORMAL_ROOMS` (a hand-built fixture, a chapter
 * still being authored) plays all of them; the boss is always last, and is the only room appended
 * even when the chapter has several, matching the order `chapterFromLevels` already validates.
 */
export function drawRunRooms(chapter: ChapterData, seed: number): LevelData[] {
  const normal = chapter.rooms.filter((room) => !room.isBossRoom);
  const boss = chapter.rooms.filter((room) => room.isBossRoom);

  // Fisher–Yates over a copy: `chapter.rooms` order is data order, never mutated.
  const rng = new SeededRng((Math.trunc(seed) >>> 0) ^ Math.imul(chapter.chapter, DRAW_SEED_SALT));
  const pool = normal.slice();
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapWith = rng.int(index + 1);
    const value = pool[index];
    const other = pool[swapWith];
    if (value === undefined || other === undefined) continue;
    pool[index] = other;
    pool[swapWith] = value;
  }

  return [...pool.slice(0, DRAWN_NORMAL_ROOMS), ...boss];
}
