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
 * Ném lỗi nếu rỗng, nếu các phòng thuộc chapter khác nhau, nếu
 * `parseChapterData` phát hiện trùng số phòng / door hỏng, nếu dãy phòng đứt
 * quãng, hoặc nếu phòng boss không phải phòng cuối / có hơn một phòng boss.
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

  // Boss phải là phòng cuối, và chỉ một phòng boss. `RunState`/bootstrap coi phòng cuối
  // của chapter là hết run; boss nằm giữa sẽ khiến người chơi gặp boss rồi vẫn còn
  // phòng thường phía sau, còn hai boss room là dữ liệu author nhầm (copy .tmx).
  // Không bắt buộc **phải có** boss: chapter đang author dở vẫn load được.
  const bossRooms = sorted.filter((level) => level.isBossRoom);
  if (bossRooms.length > 1) {
    throw new Error(
      `chapterFromLevels: chapter ${first.chapter} có ${bossRooms.length} phòng boss ` +
        `(${bossRooms.map((level) => level.id).join(', ')}), chỉ được có một.`,
    );
  }
  const onlyBoss = bossRooms[0];
  const last = sorted[sorted.length - 1];
  if (onlyBoss !== undefined && last !== undefined && onlyBoss.room !== last.room) {
    throw new Error(
      `chapterFromLevels: phòng boss ${onlyBoss.id} phải là phòng cuối, nhưng chapter ` +
        `${first.chapter} còn phòng ${last.room} (${last.id}) sau nó.`,
    );
  }

  return chapter;
}
