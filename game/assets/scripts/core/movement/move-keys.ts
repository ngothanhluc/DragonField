import type { MoveInput } from './move-intent';

export type MoveDirection = keyof MoveInput;

/** The part of `KeyboardEvent` needed to identify a movement key — no DOM/`cc` dependency. */
export interface KeyIdentity {
  readonly code: string;
  readonly key: string;
  readonly keyCode: number;
}

/** keyCode the browser sends while an input method editor (IME) is handling a key — reveals nothing. */
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
 * The movement key for a keyboard event, or `null`.
 *
 * `code` (the **physical** key) wins: a Vietnamese input method (Telex/VNI) turns
 * `key` into `Process` or a composed letter and `keyCode` into 229 while composing
 * text, but `code` still says `KeyW`. The player used to read `keyCode` through Cocos
 * `input`, so WASD got stuck when the IME was on. `key`/`keyCode` are only the
 * fallback for environments that do not send `code`.
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

/** State of the 4 keys, updated on keydown/keyup; `reset` on focus loss so it cannot drift. */
export class MoveKeyState implements MoveInput {
  up = false;
  down = false;
  left = false;
  right = false;

  /** Returns `true` when the event is movement key (the caller may `preventDefault`). */
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
