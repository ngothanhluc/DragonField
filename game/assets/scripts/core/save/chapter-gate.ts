/**
 * Cổng vào chapter (GDD §2: chapter sau chỉ mở khi thắng chapter trước).
 *
 * Đây là **luật**, không phải trạng thái nút. Chapter select vẽ nút khoá bằng
 * `chapterGate`, và bootstrap gọi lại đúng hàm này trước khi load `.tmx` — nên
 * một debug hook hay click sai toạ độ cũng không thể bắt đầu chapter chưa mở.
 */
import { CHAPTERS_PER_RUN } from '../run/run-state';
import type { SaveData } from './save-data';

export interface ChapterGate {
  readonly allowed: boolean;
  /** Lý do bằng tiếng Việt để log; `null` khi được phép. */
  readonly reason: string | null;
}

const ALLOWED: ChapterGate = { allowed: true, reason: null };

/**
 * `chapter` 1..`CHAPTERS_PER_RUN`, phải có dữ liệu level và không vượt
 * `chaptersUnlocked` của save. Save hỏng (unlocked không phải số) bị coi như 1
 * thay vì mở toàn bộ chapter.
 */
export function chapterGate(
  save: Pick<SaveData, 'chaptersUnlocked'>,
  chapter: number,
  hasData: boolean,
): ChapterGate {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) {
    return { allowed: false, reason: `Chapter ${chapter} không tồn tại` };
  }
  if (!hasData) {
    return { allowed: false, reason: `Chapter ${chapter} chưa có dữ liệu level` };
  }

  const unlocked = Number.isInteger(save.chaptersUnlocked) ? save.chaptersUnlocked : 1;
  if (chapter > unlocked) {
    return { allowed: false, reason: `Chapter ${chapter} còn khoá (đã mở 1..${unlocked})` };
  }

  return ALLOWED;
}
