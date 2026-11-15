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
  it('trả về null khi không có mục tiêu nào', () => {
    expect(findNearestTarget(origin, [], 10)).toBeNull();
  });

  it('chọn enemy gần nhất còn sống', () => {
    const targets = [target('far', 5, 0), target('near', 2, 0), target('mid', 3, 0)];

    expect(findNearestTarget(origin, targets, 10)?.id).toBe('near');
  });

  it('bỏ qua enemy đã chết', () => {
    const targets = [target('corpse', 1, 0, false), target('alive', 4, 0)];

    expect(findNearestTarget(origin, targets, 10)?.id).toBe('alive');
  });

  it('bỏ qua enemy ngoài tầm bắn', () => {
    const targets = [target('out-of-range', 11, 0)];

    expect(findNearestTarget(origin, targets, 10)).toBeNull();
  });

  it('phá hoà khoảng cách bằng id tất định, không phụ thuộc thứ tự mảng', () => {
    const a = target('b-enemy', 3, 0);
    const b = target('a-enemy', -3, 0);

    expect(findNearestTarget(origin, [a, b], 10)?.id).toBe('a-enemy');
    expect(findNearestTarget(origin, [b, a], 10)?.id).toBe('a-enemy');
  });
});
