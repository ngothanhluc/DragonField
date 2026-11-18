/**
 * Listen for WASD/arrow keys directly on `document` (capture phase) via `event.code`.
 *
 * Not Cocos `input.on(KEY_DOWN)`: the engine only forwards `keyCode`, and an IME while
 * composing text sends `keyCode = 229` → WASD sticks (a pitfall listed in AGENTS.md).
 * `code` is the physical key, which the IME cannot change. On losing focus, release
 * every key, because a keyup that lands outside the tab will never arrive.
 */
import { MoveKeyState } from '../core/movement/move-keys';

/** One key log line for `__yokai.keyLog()` when `?debug=1`. */
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

/** The last 200 keyboard events (every key, not just WASD) for IME diagnosis. */
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
