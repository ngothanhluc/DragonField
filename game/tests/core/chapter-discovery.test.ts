import { describe, expect, it } from 'vitest';
import { chapterFromLevels, sortLevelsByRoom } from '../../assets/scripts/core/level/chapter';
import type { LevelData } from '../../assets/scripts/core/level/level-data';
import { RunState } from '../../assets/scripts/core/run/run-state';
import { loadChapterOne, loadTmxLevels } from '../helpers/tmx-levels';

/** Bản sao phòng với số/id mới — mô phỏng "thả thêm .tmx vào thư mục". */
function renumber(level: LevelData, room: number, chapter = level.chapter): LevelData {
  return {
    ...level,
    id: `ch${chapter}-r${room}`,
    chapter,
    room,
    // Door trỏ ra ngoài chapter sẽ làm chapterFromLevels báo lỗi; bỏ door khi test
    // chỉ quan tâm số phòng.
    doors: [],
    ...(level.boss !== undefined ? { boss: level.boss } : {}),
  };
}

describe('chapterFromLevels — khám phá phòng từ dữ liệu', () => {
  it('sắp lại theo số phòng, không quan tâm thứ tự engine trả về', () => {
    const levels = loadTmxLevels();
    const shuffled = [levels[4], levels[0], levels[8], levels[2], levels[6], levels[1], levels[7], levels[3], levels[5]]
      .filter((level): level is LevelData => level !== undefined);

    const chapter = chapterFromLevels(shuffled);

    expect(chapter.rooms.map((room) => room.room)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(chapter).toEqual(loadChapterOne());
  });

  it('thêm room-10.tmx là chapter có 10 phòng, RunState hiện "x/10"', () => {
    const levels = loadTmxLevels();
    const first = levels[0];
    if (first === undefined) throw new Error('thiếu phòng 1');

    const chapter = chapterFromLevels([...levels, renumber(first, 10)]);

    expect(chapter.rooms).toHaveLength(10);
    expect(chapter.rooms[9]?.room).toBe(10);

    const run = new RunState(1, chapter.rooms.length);
    expect(run.roomLabel).toBe('1/10');
    expect(run.roomsTotal).toBe(10);

    // Phòng 9 không còn là phòng cuối: run phải đi tiếp tới 10.
    for (let room = 1; room < 10; room += 1) {
      expect(run.isBossRoom).toBe(room === 10);
      run.onRoomCleared();
      run.advanceToNextRoom();
    }
    expect(run.room).toBe(10);
    expect(run.isBossRoom).toBe(true);
    expect(run.roomLabel).toBe('10/10');
  });

  it('từ chối thư mục rỗng', () => {
    expect(() => chapterFromLevels([])).toThrow(/không có phòng nào/);
  });

  it('từ chối trùng số phòng', () => {
    const levels = loadTmxLevels();
    const first = levels[0];
    if (first === undefined) throw new Error('thiếu phòng 1');

    expect(() => chapterFromLevels([...levels, renumber(first, 1)])).toThrow(/số phòng 1 bị trùng/);
  });

  it('từ chối thiếu số phòng ở giữa (run sẽ kẹt)', () => {
    // Bỏ door để lỗi nổi ở đúng chỗ cần test: dãy phòng đứt quãng, không phải door hỏng.
    const levels = loadTmxLevels()
      .filter((level) => level.room !== 3)
      .map((level) => ({ ...level, doors: [] }));

    expect(() => chapterFromLevels(levels)).toThrow(/phải liền mạch từ 1.*Thiếu room-3/);
  });

  it('từ chối trộn hai chapter trong một thư mục', () => {
    const levels = loadTmxLevels();
    const first = levels[0];
    if (first === undefined) throw new Error('thiếu phòng 1');

    expect(() => chapterFromLevels([...levels, renumber(first, 10, 2)])).toThrow(/chapter/);
  });

  it('sortLevelsByRoom không sửa mảng gốc', () => {
    const levels = loadTmxLevels();
    const original = levels.map((level) => level.room);

    const sorted = sortLevelsByRoom([...levels].reverse());

    expect(levels.map((level) => level.room)).toEqual(original);
    expect(sorted.map((level) => level.room)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
