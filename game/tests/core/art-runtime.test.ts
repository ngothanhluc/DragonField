import { describe, expect, it } from 'vitest';
import type { Direction, SpriteEntry } from '../../assets/scripts/core/art/manifest';
import {
  directionFromVector,
  frameIndexAt,
  loopDurationMs,
  toResourcesPath,
} from '../../assets/scripts/core/art/runtime';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';

function entry(overrides: Partial<SpriteEntry> = {}): SpriteEntry {
  return {
    sheet: 'resources/art/characters/ninja-green/Idle.png',
    frameWidth: 32,
    frameHeight: 32,
    layout: 'grid',
    directions: ['down', 'up', 'left', 'right'],
    frames: 4,
    fps: 10,
    loop: true,
    ...overrides,
  };
}

describe('toResourcesPath', () => {
  it('bỏ prefix resources/ và đuôi .png', () => {
    expect(toResourcesPath('resources/art/characters/ninja-green/Idle.png')).toBe(
      'art/characters/ninja-green/Idle',
    );
  });

  it('giữ nguyên thư mục lồng nhau, không đụng tên file', () => {
    expect(toResourcesPath('resources/art/bosses/giant-blue-samurai/AttackLeft.png')).toBe(
      'art/bosses/giant-blue-samurai/AttackLeft',
    );
  });

  it('ném lỗi khi thiếu prefix resources/', () => {
    expect(() => toResourcesPath('art/characters/ninja-green/Idle.png')).toThrow(/resources\//);
  });

  it('ném lỗi khi không phải file png', () => {
    expect(() => toResourcesPath('resources/art/characters/ninja-green/Idle.jpg')).toThrow(/png/);
  });

  it('ném lỗi khi path rỗng sau khi bỏ prefix', () => {
    expect(() => toResourcesPath('resources/.png')).toThrow(/không trỏ tới file/);
  });
});

describe('loopDurationMs', () => {
  it('4 frame ở 10 fps là 400 ms', () => {
    expect(loopDurationMs(entry())).toBe(400);
  });

  it('1 frame ở 8 fps là 125 ms', () => {
    expect(loopDurationMs(entry({ frames: 1, fps: 8 }))).toBe(125);
  });

  it('fps <= 0 trả 0 thay vì chia cho 0', () => {
    expect(loopDurationMs(entry({ fps: 0 }))).toBe(0);
    expect(loopDurationMs(entry({ fps: -10 }))).toBe(0);
  });
});

describe('frameIndexAt', () => {
  it('đi qua từng frame theo nhịp fps', () => {
    const idle = entry();

    expect(frameIndexAt(idle, 0)).toBe(0);
    expect(frameIndexAt(idle, 99)).toBe(0);
    expect(frameIndexAt(idle, 100)).toBe(1);
    expect(frameIndexAt(idle, 250)).toBe(2);
    expect(frameIndexAt(idle, 399)).toBe(3);
  });

  it('loop quay vòng khi hết clip', () => {
    const idle = entry();

    expect(frameIndexAt(idle, 400)).toBe(0);
    expect(frameIndexAt(idle, 450)).toBe(0);
    expect(frameIndexAt(idle, 500)).toBe(1);
    expect(frameIndexAt(idle, 1200)).toBe(0);
  });

  it('không loop thì giữ frame cuối', () => {
    const attack = entry({ frames: 3, fps: 10, loop: false });

    expect(frameIndexAt(attack, 0)).toBe(0);
    expect(frameIndexAt(attack, 150)).toBe(1);
    expect(frameIndexAt(attack, 250)).toBe(2);
    expect(frameIndexAt(attack, 5000)).toBe(2);
  });

  it('fps <= 0 thì đứng ở frame 0', () => {
    expect(frameIndexAt(entry({ fps: 0 }), 10_000)).toBe(0);
    expect(frameIndexAt(entry({ fps: -5 }), 10_000)).toBe(0);
  });

  it('thời gian âm clamp về 0', () => {
    expect(frameIndexAt(entry(), -1000)).toBe(0);
    expect(frameIndexAt(entry({ loop: false }), -0.5)).toBe(0);
  });

  it('thời gian không hữu hạn không tạo ra frame NaN', () => {
    expect(frameIndexAt(entry(), Number.NaN)).toBe(0);
    expect(frameIndexAt(entry(), Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('directionFromVector', () => {
  it('lấy đúng 4 hướng trên trục', () => {
    expect(directionFromVector({ x: 1, y: 0 }, 'left')).toBe('right');
    expect(directionFromVector({ x: -1, y: 0 }, 'right')).toBe('left');
    expect(directionFromVector({ x: 0, y: 1 }, 'down')).toBe('up');
    expect(directionFromVector({ x: 0, y: -1 }, 'up')).toBe('down');
  });

  it('đi chéo thì chọn trục trội', () => {
    expect(directionFromVector({ x: 2, y: 1 }, 'down')).toBe('right');
    expect(directionFromVector({ x: -2, y: 1 }, 'down')).toBe('left');
    expect(directionFromVector({ x: 1, y: 2 }, 'down')).toBe('up');
    expect(directionFromVector({ x: 1, y: -2 }, 'up')).toBe('down');
  });

  it('chéo đúng 45° trả fallback để không nhảy hướng', () => {
    expect(directionFromVector({ x: 1, y: 1 }, 'left')).toBe('left');
    expect(directionFromVector({ x: -3, y: -3 }, 'up')).toBe('up');
  });

  it('vector 0 trả fallback (đứng yên)', () => {
    const still: Vec2 = { x: 0, y: 0 };

    expect(directionFromVector(still, 'up')).toBe('up');
    const fallback: Direction = 'right';
    expect(directionFromVector(still, fallback)).toBe(fallback);
  });
});
