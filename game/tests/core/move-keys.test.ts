import { describe, expect, it } from 'vitest';
import {
  IME_PROCESS_KEY_CODE,
  MoveKeyState,
  moveDirectionForKey,
} from '../../assets/scripts/core/movement/move-keys';

describe('moveDirectionForKey', () => {
  it('WASD và phím mũi tên theo code vật lý', () => {
    expect(moveDirectionForKey({ code: 'KeyW', key: 'w', keyCode: 87 })).toBe('up');
    expect(moveDirectionForKey({ code: 'KeyA', key: 'a', keyCode: 65 })).toBe('left');
    expect(moveDirectionForKey({ code: 'KeyS', key: 's', keyCode: 83 })).toBe('down');
    expect(moveDirectionForKey({ code: 'KeyD', key: 'd', keyCode: 68 })).toBe('right');
    expect(moveDirectionForKey({ code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 })).toBe('up');
  });

  it('bộ gõ Telex/VNI đang soạn chữ (key Process, keyCode 229) vẫn ra đúng hướng theo code', () => {
    const ime = (code: string, key: string) => ({ code, key, keyCode: IME_PROCESS_KEY_CODE });
    expect(moveDirectionForKey(ime('KeyW', 'Process'))).toBe('up');
    expect(moveDirectionForKey(ime('KeyW', 'ư'))).toBe('up');
    expect(moveDirectionForKey(ime('KeyD', 'đ'))).toBe('right');
    expect(moveDirectionForKey(ime('KeyA', 'â'))).toBe('left');
    expect(moveDirectionForKey(ime('KeyS', 'Process'))).toBe('down');
  });

  it('caps lock / shift không đổi hướng', () => {
    expect(moveDirectionForKey({ code: 'KeyW', key: 'W', keyCode: 87 })).toBe('up');
  });

  it('phím khác thì null, kể cả khi key trùng chữ nhưng code là phím khác (layout AZERTY)', () => {
    expect(moveDirectionForKey({ code: 'KeyE', key: 'e', keyCode: 69 })).toBeNull();
    expect(moveDirectionForKey({ code: 'KeyZ', key: 'w', keyCode: 87 })).toBeNull();
  });

  it('không có code thì lùi về key rồi keyCode, nhưng bỏ qua 229', () => {
    expect(moveDirectionForKey({ code: '', key: 'd', keyCode: 0 })).toBe('right');
    expect(moveDirectionForKey({ code: '', key: '', keyCode: 65 })).toBe('left');
    expect(moveDirectionForKey({ code: '', key: 'Process', keyCode: IME_PROCESS_KEY_CODE })).toBeNull();
  });
});

describe('MoveKeyState', () => {
  it('giữ W + D qua chuỗi keydown/keyup có IME, nhả thì dừng', () => {
    const keys = new MoveKeyState();
    expect(keys.apply({ code: 'KeyW', key: 'Process', keyCode: 229 }, true)).toBe(true);
    keys.apply({ code: 'KeyD', key: 'đ', keyCode: 229 }, true);
    expect({ ...keys }).toEqual({ up: true, down: false, left: false, right: true });

    keys.apply({ code: 'KeyW', key: 'w', keyCode: 87 }, false);
    expect(keys.up).toBe(false);
    expect(keys.right).toBe(true);
  });

  it('phím không liên quan trả false và không đổi state', () => {
    const keys = new MoveKeyState();
    expect(keys.apply({ code: 'Space', key: ' ', keyCode: 32 }, true)).toBe(false);
    expect({ ...keys }).toEqual({ up: false, down: false, left: false, right: false });
  });

  it('reset nhả hết (mất focus giữa lúc giữ phím)', () => {
    const keys = new MoveKeyState();
    keys.apply({ code: 'KeyA', key: 'a', keyCode: 65 }, true);
    keys.reset();
    expect(keys.left).toBe(false);
  });
});
