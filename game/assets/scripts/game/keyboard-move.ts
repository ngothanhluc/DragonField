/**
 * Nghe WASD/mũi tên trực tiếp trên `document` (capture phase) theo `event.code`.
 *
 * Không dùng `input.on(KEY_DOWN)` của Cocos: engine chỉ chuyển `keyCode`, mà bộ
 * gõ tiếng Việt đang soạn chữ gửi `keyCode = 229` → WASD bị kẹt (bẫy trong
 * AGENTS.md). `code` là phím vật lý nên bộ gõ không đổi được. Mất focus thì nhả
 * hết phím, vì keyup rơi ra ngoài tab sẽ không bao giờ tới.
 */
import { MoveKeyState } from '../core/movement/move-keys';

/** Một dòng log phím cho `__yokai.keyLog()` khi `?debug=1`. */
export interface KeyLogEntry {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly isComposing: boolean;
  readonly t: number;
}

const KEY_LOG_LIMIT = 200;
const keyLogEntries: KeyLogEntry[] = [];

/** 200 event bàn phím gần nhất (mọi phím, không chỉ WASD) để chẩn đoán bộ gõ. */
export function keyLog(): readonly KeyLogEntry[] {
  return keyLogEntries.slice();
}

function record(event: KeyboardEvent): void {
  keyLogEntries.push({
    type: event.type,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    isComposing: event.isComposing,
    t: Math.round(performance.now()),
  });
  if (keyLogEntries.length > KEY_LOG_LIMIT) keyLogEntries.shift();
}

export class KeyboardMove {
  readonly keys = new MoveKeyState();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    record(event);
    if (this.keys.apply(event, true)) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    record(event);
    if (this.keys.apply(event, false)) event.preventDefault();
  };

  private readonly onBlur = (): void => {
    this.keys.reset();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState !== 'visible') this.keys.reset();
  };

  attach(): void {
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(): void {
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.keys.reset();
  }
}
