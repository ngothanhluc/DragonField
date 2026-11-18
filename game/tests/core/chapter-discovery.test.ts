import { describe, expect, it } from 'vitest';
import { chapterFromLevels, sortLevelsByRoom } from '../../assets/scripts/core/level/chapter';
import type { LevelData } from '../../assets/scripts/core/level/level-data';
import { RunState } from '../../assets/scripts/core/run/run-state';
import { loadChapterOne, loadTmxLevels } from '../helpers/tmx-levels';

/** A copy of a room with a new number/id — simulates "dropping another .tmx into the folder". */
function renumber(level: LevelData, room: number, chapter = level.chapter): LevelData {
  return {
    ...level,
    id: `ch${chapter}-r${room}`,
    chapter,
    room,
    // A door pointing outside the chapter would make chapterFromLevels fail; drop it when the test
    // only cares about room numbers.
    doors: [],
    ...(level.boss !== undefined ? { boss: level.boss } : {}),
  };
}

describe('chapterFromLevels — discovers rooms from data', () => {
  it('re-sorts by room number, regardless of the order the engine returns', () => {
    const levels = loadTmxLevels();
    const shuffled = [levels[4], levels[0], levels[8], levels[2], levels[6], levels[1], levels[7], levels[3], levels[5]]
      .filter((level): level is LevelData => level !== undefined);

    const chapter = chapterFromLevels(shuffled);

    expect(chapter.rooms.map((room) => room.room)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(chapter).toEqual(loadChapterOne());
  });

  it('adding room-10.tmx gives a chapter with 10 rooms, RunState shows "x/10"', () => {
    const levels = loadTmxLevels();
    const bossRoom = levels[8];
    if (bossRoom === undefined) throw new Error('missing room 9');

    // The boss must be the last room (the M3 rule), so adding room 10 means moving the boss
    // to room 10 and turning room 9 back into a regular room. This is exactly the authoring
    // work in Tiled: edit the `boss`/`isBossRoom` property of the two .tmx files.
    const nonBossCopy: LevelData = {
      ...bossRoom,
      id: 'ch1-r9',
      room: 9,
      isBossRoom: false,
      doors: [],
    };
    delete (nonBossCopy as { boss?: unknown }).boss;
    delete (nonBossCopy as { bossStart?: unknown }).bossStart;

    const chapter = chapterFromLevels([...levels.slice(0, 8), nonBossCopy, renumber(bossRoom, 10)]);

    expect(chapter.rooms).toHaveLength(10);
    expect(chapter.rooms[8]?.room).toBe(9);
    expect(chapter.rooms[9]?.room).toBe(10);
    expect(chapter.rooms[9]?.isBossRoom).toBe(true);

    const run = new RunState(1, chapter.rooms.length);
    expect(run.roomLabel).toBe('1/10');
    expect(run.roomsTotal).toBe(10);

    // Room 9 is no longer the last room: the run must continue to 10.
    for (let room = 1; room < 10; room += 1) {
      expect(run.isBossRoom).toBe(room === 10);
      run.onRoomCleared();
      run.advanceToNextRoom();
    }
    expect(run.room).toBe(10);
    expect(run.isBossRoom).toBe(true);
    expect(run.roomLabel).toBe('10/10');
  });

  it('rejects a boss room in the middle of a chapter', () => {
    const levels = loadTmxLevels();
    const first = levels[0];
    if (first === undefined) throw new Error('missing room 1');

    // Add a regular room after the boss: the run would "win" at room 9 so room 10
    // is unreachable — the author put the boss in the wrong place.
    expect(() => chapterFromLevels([...levels, renumber(first, 10)])).toThrow(
      /boss room .* must be the last room/,
    );
  });

  it('rejects two boss rooms in one chapter', () => {
    const levels = loadTmxLevels();
    const bossRoom = levels[8];
    if (bossRoom === undefined) throw new Error('missing room 9');

    const secondBoss = renumber(levels[7] ?? bossRoom, 10);
    expect(() =>
      chapterFromLevels([
        ...levels,
        { ...secondBoss, isBossRoom: true, boss: { name: 'TenguBlue' }, doors: [] },
      ]),
    ).toThrow(/there can only be one/);
  });

  it('rejects an empty folder', () => {
    expect(() => chapterFromLevels([])).toThrow(/no rooms/);
  });

  it('rejects a duplicate room number', () => {
    const levels = loadTmxLevels();
    const first = levels[0];
    if (first === undefined) throw new Error('missing room 1');

    expect(() => chapterFromLevels([...levels, renumber(first, 1)])).toThrow(/room number 1 is duplicated/);
  });

  it('rejects a missing number in the middle (the run would get stuck)', () => {
    // Drop the door so the error surfaces in the right place: a gap in the room sequence, not a broken door.
    const levels = loadTmxLevels()
      .filter((level) => level.room !== 3)
      .map((level) => ({ ...level, doors: [] }));

    expect(() => chapterFromLevels(levels)).toThrow(/must be contiguous from 1.*Missing room-3/);
  });

  it('rejects mixing two chapters in one folder', () => {
    const levels = loadTmxLevels();
    const first = levels[0];
    if (first === undefined) throw new Error('missing room 1');

    expect(() => chapterFromLevels([...levels, renumber(first, 10, 2)])).toThrow(/chapter/);
  });

  it('sortLevelsByRoom does not mutate the input array', () => {
    const levels = loadTmxLevels();
    const original = levels.map((level) => level.room);

    const sorted = sortLevelsByRoom([...levels].reverse());

    expect(levels.map((level) => level.room)).toEqual(original);
    expect(sorted.map((level) => level.room)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
