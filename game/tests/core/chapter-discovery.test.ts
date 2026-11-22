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

function bossOf(levels: readonly LevelData[]): LevelData {
  const boss = levels.find((level) => level.isBossRoom);
  if (boss === undefined) throw new Error('fixture has no boss room');
  return boss;
}

describe('chapterFromLevels — discovers rooms from data', () => {
  it('re-sorts by room number, regardless of the order the engine returns', () => {
    const levels = loadTmxLevels();
    // Reverse-load order must give the same chapter as the sorted one.
    const shuffled = [...levels].reverse();

    const chapter = chapterFromLevels(shuffled);

    expect(chapter.rooms.map((room) => room.room)).toEqual(
      levels.map((room) => room.room).sort((a, b) => a - b),
    );
    expect(chapter).toEqual(loadChapterOne());
  });

  it('adding a room after the pool gives a chapter with one more room, RunState shows "x/(N+1)"', () => {
    const levels = loadTmxLevels();
    const bossRoom = bossOf(levels);
    const lastNormal = levels.filter((level) => !level.isBossRoom).sort((a, b) => a.room - b.room).pop();
    if (lastNormal === undefined) throw new Error('missing the last normal room');

    // The boss must be the last room (the M3 rule), so adding a room means moving the boss one
    // further and turning the pool's last room into an extra normal room. This is exactly the
    // authoring work in Tiled: edit the `boss`/`isBossRoom` property of the two .tmx files.
    const withoutBoss = levels.filter((level) => !level.isBossRoom);
    const extra: LevelData = { ...renumber(lastNormal, bossRoom.room), doors: [] };
    const chapter = chapterFromLevels([...withoutBoss, extra, renumber(bossRoom, bossRoom.room + 1)]);

    expect(chapter.rooms).toHaveLength(levels.length + 1);
    expect(chapter.rooms[chapter.rooms.length - 1]?.room).toBe(bossRoom.room + 1);
    expect(chapter.rooms[chapter.rooms.length - 1]?.isBossRoom).toBe(true);

    const run = new RunState(1, chapter.rooms.length);
    expect(run.roomLabel).toBe(`1/${chapter.rooms.length}`);
    expect(run.roomsTotal).toBe(chapter.rooms.length);

    // Every room but the last is a normal room: the run must continue to the boss.
    for (let room = 1; room < chapter.rooms.length; room += 1) {
      expect(run.isBossRoom).toBe(room === chapter.rooms.length);
      run.onRoomCleared();
      run.advanceToNextRoom();
    }
    expect(run.room).toBe(chapter.rooms.length);
    expect(run.isBossRoom).toBe(true);
    expect(run.roomLabel).toBe(`${chapter.rooms.length}/${chapter.rooms.length}`);
  });

  it('rejects a boss room in the middle of a chapter', () => {
    const levels = loadTmxLevels();
    const first = levels[0];
    if (first === undefined) throw new Error('missing room 1');

    // Add a regular room after the boss: the run would "win" at the boss so the extra room
    // is unreachable — the author put the boss in the wrong place.
    const bossRoom = bossOf(levels);
    expect(() => chapterFromLevels([...levels, renumber(first, bossRoom.room + 1)])).toThrow(
      /boss room .* must be the last room/,
    );
  });

  it('rejects two boss rooms in one chapter', () => {
    const levels = loadTmxLevels();
    const bossRoom = bossOf(levels);

    const secondBoss = renumber(bossRoom, bossRoom.room + 1);
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

    const bossRoom = bossOf(levels);
    expect(() => chapterFromLevels([...levels, renumber(first, bossRoom.room + 1, 2)])).toThrow(/chapter/);
  });

  it('sortLevelsByRoom does not mutate the input array', () => {
    const levels = loadTmxLevels();
    const original = levels.map((level) => level.room);
    const sortedNumbers = [...original].sort((a, b) => a - b);

    const sorted = sortLevelsByRoom([...levels].reverse());

    expect(levels.map((level) => level.room)).toEqual(original);
    expect(sorted.map((level) => level.room)).toEqual(sortedNumbers);
  });
});
