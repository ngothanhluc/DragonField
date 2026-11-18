import { describe, expect, it } from 'vitest';
import {
  normalizeMoveInput,
  velocityFromInput,
} from '../../assets/scripts/core/movement/move-intent';

const NONE = { up: false, down: false, left: false, right: false };

describe('normalizeMoveInput', () => {
  it('with no key pressed the vector is 0', () => {
    expect(normalizeMoveInput(NONE)).toEqual({ x: 0, y: 0 });
  });

  it('each key moves along exactly one axis', () => {
    expect(normalizeMoveInput({ ...NONE, up: true })).toEqual({ x: 0, y: 1 });
    expect(normalizeMoveInput({ ...NONE, down: true })).toEqual({ x: 0, y: -1 });
    expect(normalizeMoveInput({ ...NONE, left: true })).toEqual({ x: -1, y: 0 });
    expect(normalizeMoveInput({ ...NONE, right: true })).toEqual({ x: 1, y: 0 });
  });

  it('two opposite keys cancel each other out', () => {
    expect(normalizeMoveInput({ up: true, down: true, left: false, right: false })).toEqual({
      x: 0,
      y: 0,
    });
    expect(normalizeMoveInput({ up: false, down: false, left: true, right: true })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('a diagonal has length 1, not 1.414', () => {
    const diagonal = normalizeMoveInput({ up: true, down: false, left: false, right: true });

    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 10);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 10);
    expect(diagonal.y).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('keeps the right signs for all 4 diagonal directions', () => {
    expect(
      normalizeMoveInput({ up: true, down: false, left: true, right: false }),
    ).toEqual({ x: -Math.SQRT1_2, y: Math.SQRT1_2 });
    expect(
      normalizeMoveInput({ up: false, down: true, left: false, right: true }),
    ).toEqual({ x: Math.SQRT1_2, y: -Math.SQRT1_2 });
  });
});

describe('velocityFromInput', () => {
  it('multiplies the direction vector by speed', () => {
    expect(velocityFromInput({ x: 0, y: 1 }, 4)).toEqual({ x: 0, y: 4 });
    expect(velocityFromInput({ x: -1, y: 0 }, 4)).toEqual({ x: -4, y: 0 });
  });

  it('standing still gives zero velocity', () => {
    expect(velocityFromInput({ x: 0, y: 0 }, 4)).toEqual({ x: 0, y: 0 });
  });

  it('diagonal movement keeps the same velocity magnitude', () => {
    const direction = normalizeMoveInput({ up: true, down: false, left: true, right: false });
    const velocity = velocityFromInput(direction, 5);

    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(5, 10);
  });
});
