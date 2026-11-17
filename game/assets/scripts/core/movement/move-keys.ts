import type { MoveInput } from './move-intent';

export type MoveDirection = keyof MoveInput;

/** Phần của `KeyboardEvent` cần để biết phím di chuyển — không phụ thuộc DOM/`cc`. */
export interface KeyIdentity {
  readonly code: string;
  readonly key: string;
  readonly keyCode: number;
}

/** keyCode trình duyệt gửi khi bộ gõ (IME) đang xử lý phím — không cho biết phím nào. */
export const IME_PROCESS_KEY_CODE = 229;

const BY_CODE: Readonly<Record<string, MoveDirection>> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};

const BY_KEY: Readonly<Record<string, MoveDirection>> = {
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
};

const BY_KEY_CODE: Readonly<Record<number, MoveDirection>> = {
  87: 'up',
  38: 'up',
  83: 'down',
  40: 'down',
  65: 'left',
  37: 'left',
  68: 'right',
  39: 'right',
};

/**
 * Phím di chuyển ứng với một event bàn phím, hoặc `null`.
 *
 * Ưu tiên `code` (phím **vật lý**): bộ gõ tiếng Việt (Telex/VNI) đổi `key` thành
 * `Process`/`ư`/`đ` và `keyCode` thành 229 khi đang soạn chữ, nhưng `code` vẫn là
 * `KeyW`. Trước đây player đọc `keyCode` qua `input` của Cocos nên WASD bị kẹt
 * khi bật bộ gõ. `key`/`keyCode` chỉ là đường lùi khi môi trường không gửi `code`.
 */
export function moveDirectionForKey(event: KeyIdentity): MoveDirection | null {
  const byCode = BY_CODE[event.code];
  if (byCode !== undefined) return byCode;
  if (event.code !== '') return null;

  const byKey = BY_KEY[event.key.toLowerCase()];
  if (byKey !== undefined) return byKey;
  if (event.keyCode === IME_PROCESS_KEY_CODE) return null;
  return BY_KEY_CODE[event.keyCode] ?? null;
}

/** Trạng thái 4 phím, cập nhật theo keydown/keyup; `reset` khi mất focus để không trôi. */
export class MoveKeyState implements MoveInput {
  up = false;
  down = false;
  left = false;
  right = false;

  /** Trả `true` khi event là phím di chuyển (caller có thể `preventDefault`). */
  apply(event: KeyIdentity, pressed: boolean): boolean {
    const direction = moveDirectionForKey(event);
    if (direction === null) return false;
    this[direction] = pressed;
    return true;
  }

  reset(): void {
    this.up = false;
    this.down = false;
    this.left = false;
    this.right = false;
  }
}
