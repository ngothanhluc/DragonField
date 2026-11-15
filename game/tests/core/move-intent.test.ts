import { describe, expect, it } from 'vitest';
import {
  normalizeMoveInput,
  velocityFromInput,
} from '../../assets/scripts/core/movement/move-intent';

const NONE = { up: false, down: false, left: false, right: false };

describe('normalizeMoveInput', () => {
  it('không bấm phím nào thì vector bằng 0', () => {
    expect(normalizeMoveInput(NONE)).toEqual({ x: 0, y: 0 });
  });

  it('mỗi phím đi theo đúng một trục', () => {
    expect(normalizeMoveInput({ ...NONE, up: true })).toEqual({ x: 0, y: 1 });
    expect(normalizeMoveInput({ ...NONE, down: true })).toEqual({ x: 0, y: -1 });
    expect(normalizeMoveInput({ ...NONE, left: true })).toEqual({ x: -1, y: 0 });
    expect(normalizeMoveInput({ ...NONE, right: true })).toEqual({ x: 1, y: 0 });
  });

  it('hai phím đối nhau triệt tiêu nhau', () => {
    expect(normalizeMoveInput({ up: true, down: true, left: false, right: false })).toEqual({
      x: 0,
      y: 0,
    });
    expect(normalizeMoveInput({ up: false, down: false, left: true, right: true })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('chéo có độ dài 1, không phải 1.414', () => {
    const diagonal = normalizeMoveInput({ up: true, down: false, left: false, right: true });

    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 10);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 10);
    expect(diagonal.y).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('giữ đúng dấu cho cả 4 hướng chéo', () => {
    expect(
      normalizeMoveInput({ up: true, down: false, left: true, right: false }),
    ).toEqual({ x: -Math.SQRT1_2, y: Math.SQRT1_2 });
    expect(
      normalizeMoveInput({ up: false, down: true, left: false, right: true }),
    ).toEqual({ x: Math.SQRT1_2, y: -Math.SQRT1_2 });
  });
});

describe('velocityFromInput', () => {
  it('nhân vector hướng với tốc độ', () => {
    expect(velocityFromInput({ x: 0, y: 1 }, 4)).toEqual({ x: 0, y: 4 });
    expect(velocityFromInput({ x: -1, y: 0 }, 4)).toEqual({ x: -4, y: 0 });
  });

  it('đứng yên thì vận tốc bằng 0', () => {
    expect(velocityFromInput({ x: 0, y: 0 }, 4)).toEqual({ x: 0, y: 0 });
  });

  it('đi chéo giữ nguyên độ lớn vận tốc', () => {
    const direction = normalizeMoveInput({ up: true, down: false, left: true, right: false });
    const velocity = velocityFromInput(direction, 5);

    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(5, 10);
  });
});
