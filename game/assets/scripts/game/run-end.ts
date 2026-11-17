/**
 * Ghi tiến trình mở chapter sau khi thắng boss cuối (GDD §2).
 *
 * Tách khỏi bootstrap: đây là luật save/meta, không phải run flow. Lỗi save được
 * caller (bootstrap) log và bỏ qua — thắng chapter không được chết vì localStorage.
 */
import { unlockNextChapter } from '../core/save/save-data';
import type { SaveData } from '../core/save/save-data';
import type { SaveRepository } from '../core/save/storage';

export interface ChapterUnlock {
  readonly save: SaveData;
  readonly unlocked: boolean;
  readonly chaptersUnlocked: number;
}

/** Trả save mới (đã ghi nếu mở thêm chapter). Save đầu vào không bị sửa. */
export function persistChapterUnlock(
  save: SaveData,
  repository: SaveRepository,
  clearedChapter: number,
): ChapterUnlock {
  const next = unlockNextChapter(save, clearedChapter);
  const unlocked = next.chaptersUnlocked !== save.chaptersUnlocked;
  if (unlocked) repository.save(next);
  return { save: next, unlocked, chaptersUnlocked: next.chaptersUnlocked };
}
