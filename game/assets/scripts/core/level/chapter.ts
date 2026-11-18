/**
 * Group the rooms parsed from `.tmx` into one chapter, **without any code knowing
 * how many rooms a chapter has**: sort by the `room` property, then validate the
 * relationships between rooms (duplicate numbers, doors pointing at missing rooms) with
 * `parseChapterData`.
 *
 * So dropping a `room-10.tmx` into a chapter folder gives a run with 10 rooms and
 * the HUD shows `x/10` — no constant needs changing.
 */
import { parseChapterData } from './level-data';
import type { ChapterData, LevelData } from './level-data';

/** Sort a copy by `room`; never mutates the input array (bootstrap keeps the room → asset map). */
export function sortLevelsByRoom(levels: readonly LevelData[]): LevelData[] {
  return levels.slice().sort((a, b) => a.room - b.room);
}

/**
 * `LevelData[]` (one element per `.tmx` file, in engine load order) → `ChapterData`.
 *
 * Throws if empty, if rooms belong to different chapters, if
 * `parseChapterData` finds duplicate room numbers / broken doors, if the room sequence
 * has a gap, or if the boss room is not the last room / there is more than one boss room.
 */
export function chapterFromLevels(levels: readonly LevelData[]): ChapterData {
  if (levels.length === 0) {
    throw new Error('chapterFromLevels: no rooms — check that the .tmx folder has been imported');
  }

  const first = levels[0];
  if (first === undefined) {
    throw new Error('chapterFromLevels: no rooms');
  }

  for (const level of levels) {
    if (level.chapter !== first.chapter) {
      throw new Error(
        `chapterFromLevels: room ${level.id} belongs to chapter ${level.chapter}, ` +
          `but ${first.id} belongs to chapter ${first.chapter}. A folder must hold one chapter only.`,
      );
    }
  }

  const sorted = sortLevelsByRoom(levels);
  // parseChapterData re-validates each room (the parser produced it, so it is certainly
  // valid) and the relationships between rooms — duplicate room numbers / broken doors surface here first.
  const chapter = parseChapterData({ chapter: first.chapter, rooms: sorted });

  // `RunState` walks 1..N sequentially, so the room sequence must be contiguous: a missing
  // `room-3.tmx` leaves the run stuck at room 3 with `levelFor(3) === null`. Report at load time, naming the missing room.
  sorted.forEach((level, index) => {
    if (level.room !== index + 1) {
      throw new Error(
        `chapterFromLevels: rooms must be contiguous from 1; position ${index + 1} is room ` +
          `${level.room} (${level.id}). Missing room-${index + 1}.tmx?`,
      );
    }
  });

  // The boss must be the last room, and there must be exactly one boss room. `RunState`/bootstrap treat the last
  // room of a chapter as the end of the run; a mid-chapter boss would make the player fight the boss and then
  // still face regular rooms, while two boss rooms means the author copied a `.tmx` by mistake.
  // A boss is not **required**: a chapter still being authored must load.
  const bossRooms = sorted.filter((level) => level.isBossRoom);
  if (bossRooms.length > 1) {
    throw new Error(
      `chapterFromLevels: chapter ${first.chapter} has ${bossRooms.length} boss rooms ` +
        `(${bossRooms.map((level) => level.id).join(', ')}), there can only be one.`,
    );
  }
  const onlyBoss = bossRooms[0];
  const last = sorted[sorted.length - 1];
  if (onlyBoss !== undefined && last !== undefined && onlyBoss.room !== last.room) {
    throw new Error(
      `chapterFromLevels: boss room ${onlyBoss.id} must be the last room, but chapter ` +
        `${first.chapter} still has room ${last.room} (${last.id}) after it.`,
    );
  }

  return chapter;
}
