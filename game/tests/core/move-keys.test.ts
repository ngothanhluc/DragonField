import { describe, expect, it } from 'vitest';
import {
  IME_PROCESS_KEY_CODE,
  MoveKeyState,
  moveDirectionForKey,
} from '../../assets/scripts/core/movement/move-keys';

describe('moveDirectionForKey', () => {
  it('WASD and arrow keys by physical code', () => {
    expect(moveDirectionForKey({ code: 'KeyW', key: 'w', keyCode: 87 })).toBe('up');
    expect(moveDirectionForKey({ code: 'KeyA', key: 'a', keyCode: 65 })).toBe('left');
    expect(moveDirectionForKey({ code: 'KeyS', key: 's', keyCode: 83 })).toBe('down');
    expect(moveDirectionForKey({ code: 'KeyD', key: 'd', keyCode: 68 })).toBe('right');
    expect(moveDirectionForKey({ code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 })).toBe('up');
  });

  it('a composing Telex/VNI input method (key Process, keyCode 229) still resolves by code', () => {
    const ime = (code: string, key: string) => ({ code, key, keyCode: IME_PROCESS_KEY_CODE });
    expect(moveDirectionForKey(ime('KeyW', 'Process'))).toBe('up');
    expect(moveDirectionForKey(ime('KeyW', 'ư'))).toBe('up'); // i18n-allow: IME key data
    expect(moveDirectionForKey(ime('KeyD', 'đ'))).toBe('right'); // i18n-allow: IME key data
    expect(moveDirectionForKey(ime('KeyA', 'â'))).toBe('left'); // i18n-allow: IME key data
    expect(moveDirectionForKey(ime('KeyS', 'Process'))).toBe('down');
  });

  it('caps lock / shift do not change the direction', () => {
    expect(moveDirectionForKey({ code: 'KeyW', key: 'W', keyCode: 87 })).toBe('up');
  });

  it('other keys give null, even when the key text matches but the code is another key (AZERTY)', () => {
    expect(moveDirectionForKey({ code: 'KeyE', key: 'e', keyCode: 69 })).toBeNull();
    expect(moveDirectionForKey({ code: 'KeyZ', key: 'w', keyCode: 87 })).toBeNull();
  });

  it('without a code it falls back to key then keyCode, but skips 229', () => {
    expect(moveDirectionForKey({ code: '', key: 'd', keyCode: 0 })).toBe('right');
    expect(moveDirectionForKey({ code: '', key: '', keyCode: 65 })).toBe('left');
    expect(moveDirectionForKey({ code: '', key: 'Process', keyCode: IME_PROCESS_KEY_CODE })).toBeNull();
  });
});

describe('MoveKeyState', () => {
  it('keeps W + D through a keydown/keyup sequence with an IME, and stops on release', () => {
    const keys = new MoveKeyState();
    expect(keys.apply({ code: 'KeyW', key: 'Process', keyCode: 229 }, true)).toBe(true);
    keys.apply({ code: 'KeyD', key: 'đ', keyCode: 229 }, true); // i18n-allow: IME key data
    expect({ ...keys }).toEqual({ up: true, down: false, left: false, right: true });

    keys.apply({ code: 'KeyW', key: 'w', keyCode: 87 }, false);
    expect(keys.up).toBe(false);
    expect(keys.right).toBe(true);
  });

  it('an unrelated key returns false and leaves the state unchanged', () => {
    const keys = new MoveKeyState();
    expect(keys.apply({ code: 'Space', key: ' ', keyCode: 32 }, true)).toBe(false);
    expect({ ...keys }).toEqual({ up: false, down: false, left: false, right: false });
  });

  it('reset releases everything (focus lost while holding a key)', () => {
    const keys = new MoveKeyState();
    keys.apply({ code: 'KeyA', key: 'a', keyCode: 65 }, true);
    keys.reset();
    expect(keys.left).toBe(false);
  });
});
