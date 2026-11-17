/**
 * Toán chạy animation — thuần TS, không import `cc`, test được bằng vitest.
 *
 * Adapter Cocos (`game/`) chỉ được gọi các hàm ở đây để quyết định *frame nào* và *hướng nào*;
 * bản thân module này không biết gì về texture hay node.
 */
import type { Vec2 } from '../math/vec2';
import type { Direction, SpriteEntry } from './manifest';

const RESOURCES_PREFIX = 'resources/';
const PNG_EXTENSION = '.png';

/**
 * Đổi đường dẫn trong manifest (`resources/art/x/Idle.png`) thành path của resources bundle
 * (`art/x/Idle`). Ném lỗi nếu path không nằm trong `resources/` hoặc không phải file png — cả hai
 * trường hợp đều là manifest hỏng, không phải "pack thiếu".
 */
export function toResourcesPath(sheet: string): string {
  if (!sheet.startsWith(RESOURCES_PREFIX)) {
    throw new Error(`sheet phải bắt đầu bằng "${RESOURCES_PREFIX}", nhận "${sheet}"`);
  }
  if (!sheet.endsWith(PNG_EXTENSION)) {
    throw new Error(`sheet phải kết thúc bằng "${PNG_EXTENSION}", nhận "${sheet}"`);
  }

  const path = sheet.slice(RESOURCES_PREFIX.length, -PNG_EXTENSION.length);
  if (path.length === 0) {
    throw new Error(`sheet không trỏ tới file nào: "${sheet}"`);
  }
  return path;
}

/** Độ dài một vòng clip, ms. fps hoặc frames không hợp lệ ⇒ 0 (không có gì để chạy). */
export function loopDurationMs(entry: SpriteEntry): number {
  if (entry.fps <= 0 || entry.frames <= 0) {
    return 0;
  }
  return (entry.frames / entry.fps) * 1000;
}

/**
 * Anchor dọc (0..1, tính từ đáy frame) để giữ pivot nhất quán giữa các anim
 * khác kích thước. Actor đứng bằng chân tại `footPx`; FX neo giữa frame.
 */
export function entryAnchorY(entry: SpriteEntry): number {
  if (entry.anchor === 'center') return 0.5;
  if (entry.frameHeight <= 0) return 0.5;
  return Math.min(1, Math.max(0, entry.footPx / entry.frameHeight));
}

/**
 * Frame đang hiển thị tại thời điểm `elapsedMs` kể từ lúc `play`.
 *
 * - `loop`: quay vòng; thời gian đúng bằng một vòng trở về frame 0.
 * - không `loop`: giữ frame cuối, không bao giờ vượt `frames - 1`.
 * - `elapsedMs` âm hoặc không hữu hạn ⇒ frame 0. `fps <= 0` ⇒ frame 0 (không thể suy ra frame).
 */
export function frameIndexAt(entry: SpriteEntry, elapsedMs: number): number {
  if (entry.fps <= 0 || entry.frames <= 0) {
    return 0;
  }

  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const advanced = Math.floor((elapsed * entry.fps) / 1000);

  if (entry.loop) {
    return advanced % entry.frames;
  }
  return Math.min(advanced, entry.frames - 1);
}

/**
 * Hướng nhìn từ vector di chuyển: lấy trục trội.
 *
 * Khi `|x| == |y|` (kể cả vector 0) trả `fallback` thay vì chọn bừa một trục — nếu không, đứng yên
 * sẽ làm sprite nhảy hướng liên tục.
 */
export function directionFromVector(v: Vec2, fallback: Direction): Direction {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);

  if (ax === ay) {
    return fallback;
  }
  if (ax > ay) {
    return v.x > 0 ? 'right' : 'left';
  }
  return v.y > 0 ? 'up' : 'down';
}
