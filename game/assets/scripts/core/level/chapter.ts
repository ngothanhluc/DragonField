/**
 * Gom các phòng đã parse từ `.tmx` thành một chapter, **không cần code biết
 * chapter có bao nhiêu phòng**: sắp theo property `room`, rồi validate quan hệ
 * giữa các phòng (trùng số, door trỏ tới phòng không tồn tại) bằng
 * `parseChapterData`.
 *
 * Nhờ vậy thả thêm `room-10.tmx` vào thư mục chapter là run tự có 10 phòng,
 * HUD hiện `x/10` — không có hằng số nào phải sửa.
 */
import { parseChapterData } from './level-data';
import type { ChapterData, LevelData } from './level-data';

/** Sắp bản sao theo `room`; không sửa mảng đầu vào (bootstrap giữ map room → asset). */
export function sortLevelsByRoom(levels: readonly LevelData[]): LevelData[] {
  return levels.slice().sort((a, b) => a.room - b.room);
}

/**
 * `LevelData[]` (mỗi file `.tmx` một phần tử, thứ tự load tuỳ engine) → `ChapterData`.
 *
 * Ném lỗi nếu rỗng, nếu các phòng thuộc chapter khác nhau, hoặc nếu
 * `parseChapterData` phát hiện trùng số phòng / door hỏng.
 */
export function chapterFromLevels(levels: readonly LevelData[]): ChapterData {
  if (levels.length === 0) {
    throw new Error('chapterFromLevels: không có phòng nào — kiểm tra thư mục .tmx đã import chưa');
  }

  const first = levels[0];
  if (first === undefined) {
    throw new Error('chapterFromLevels: không có phòng nào');
  }

  for (const level of levels) {
    if (level.chapter !== first.chapter) {
      throw new Error(
        `chapterFromLevels: phòng ${level.id} thuộc chapter ${level.chapter}, ` +
          `nhưng ${first.id} thuộc chapter ${first.chapter}. Mỗi thư mục chỉ chứa một chapter.`,
      );
    }
  }

  const sorted = sortLevelsByRoom(levels);
  // parseChapterData validate lại từng phòng (dữ liệu do parser sinh nên chắc chắn
  // đúng) và quan hệ giữa các phòng — trùng số phòng / door hỏng nổi ở đây trước.
  const chapter = parseChapterData({ chapter: first.chapter, rooms: sorted });

  // `RunState` đi tuần tự 1..N, nên dãy phòng phải liền mạch: thiếu `room-3.tmx` là
  // run kẹt ở phòng 3 với `levelFor(3) === null`. Báo ngay lúc load, kèm số phòng thiếu.
  sorted.forEach((level, index) => {
    if (level.room !== index + 1) {
      throw new Error(
        `chapterFromLevels: phòng phải liền mạch từ 1; vị trí ${index + 1} là phòng ` +
          `${level.room} (${level.id}). Thiếu room-${index + 1}.tmx?`,
      );
    }
  });

  return chapter;
}
