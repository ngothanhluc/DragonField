import { describe, expect, it } from 'vitest';
import {
  findNearestTarget,
  type Targetable,
} from '../../assets/scripts/core/combat/targeting';

function target(id: string, x: number, y: number, alive = true): Targetable {
  return { id, position: { x, y }, alive };
}

const origin = { x: 0, y: 0 };

describe('findNearestTarget', () => {
  it('returns null when there is no target', () => {
    expect(findNearestTarget(origin, [], 10)).toBeNull();
  });

  it('picks the nearest living enemy', () => {
    const targets = [target('far', 5, 0), target('near', 2, 0), target('mid', 3, 0)];

    expect(findNearestTarget(origin, targets, 10)?.id).toBe('near');
  });

  it('skips dead enemies', () => {
    const targets = [target('corpse', 1, 0, false), target('alive', 4, 0)];

    expect(findNearestTarget(origin, targets, 10)?.id).toBe('alive');
  });

  it('skips enemies out of range', () => {
    const targets = [target('out-of-range', 11, 0)];

    expect(findNearestTarget(origin, targets, 10)).toBeNull();
  });

  it('breaks distance ties deterministically by id, independent of array order', () => {
    const a = target('b-enemy', 3, 0);
    const b = target('a-enemy', -3, 0);

    expect(findNearestTarget(origin, [a, b], 10)?.id).toBe('a-enemy');
    expect(findNearestTarget(origin, [b, a], 10)?.id).toBe('a-enemy');
  });
});
