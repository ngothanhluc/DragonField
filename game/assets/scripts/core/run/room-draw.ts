/**
 * Seeded room draw (M9, ticket #38, ADR-014): a run walks 8 distinct normal rooms drawn from the
 * chapter's pool, then the boss room.
 *
 * STUB written with the red acceptance test: it takes the first rooms in file order. The executor
 * replaces the body; the exported name and signature are the agreed seam.
 */
import type { ChapterData, LevelData } from '../level/level-data';

/** Normal rooms per run before the boss (GDD §8). */
export const DRAWN_NORMAL_ROOMS = 8;

/**
 * The rooms a run plays, in order: `DRAWN_NORMAL_ROOMS` distinct normal rooms from the chapter's
 * pool chosen by `seed`, then the chapter's boss room. Pure and deterministic.
 */
export function drawRunRooms(chapter: ChapterData, seed: number): LevelData[] {
  void seed;
  const normal = chapter.rooms.filter((room) => !room.isBossRoom).slice(0, DRAWN_NORMAL_ROOMS);
  const boss = chapter.rooms.filter((room) => room.isBossRoom);
  return [...normal, ...boss];
}
