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
    anchor: 'feet',
    footPx: 0,
    ...overrides,
  };
}

describe('toResourcesPath', () => {
  it('strips the resources/ prefix and the .png extension', () => {
    expect(toResourcesPath('resources/art/characters/ninja-green/Idle.png')).toBe(
      'art/characters/ninja-green/Idle',
    );
  });

  it('keeps nested folders and leaves the file name alone', () => {
    expect(toResourcesPath('resources/art/bosses/giant-blue-samurai/AttackLeft.png')).toBe(
      'art/bosses/giant-blue-samurai/AttackLeft',
    );
  });

  it('throws when the resources/ prefix is missing', () => {
    expect(() => toResourcesPath('art/characters/ninja-green/Idle.png')).toThrow(/resources\//);
  });

  it('throws when the file is not a png', () => {
    expect(() => toResourcesPath('resources/art/characters/ninja-green/Idle.jpg')).toThrow(/png/);
  });

  it('throws when the path is empty after the prefix is stripped', () => {
    expect(() => toResourcesPath('resources/.png')).toThrow(/does not point at any file/);
  });
});

describe('loopDurationMs', () => {
  it('4 frames at 10 fps is 400 ms', () => {
    expect(loopDurationMs(entry())).toBe(400);
  });

  it('1 frame at 8 fps is 125 ms', () => {
    expect(loopDurationMs(entry({ frames: 1, fps: 8 }))).toBe(125);
  });

  it('fps <= 0 returns 0 instead of dividing by 0', () => {
    expect(loopDurationMs(entry({ fps: 0 }))).toBe(0);
    expect(loopDurationMs(entry({ fps: -10 }))).toBe(0);
  });
});

describe('frameIndexAt', () => {
  it('walks through each frame at the fps cadence', () => {
    const idle = entry();

    expect(frameIndexAt(idle, 0)).toBe(0);
    expect(frameIndexAt(idle, 99)).toBe(0);
    expect(frameIndexAt(idle, 100)).toBe(1);
    expect(frameIndexAt(idle, 250)).toBe(2);
    expect(frameIndexAt(idle, 399)).toBe(3);
  });

  it('loop wraps around when the clip ends', () => {
    const idle = entry();

    expect(frameIndexAt(idle, 400)).toBe(0);
    expect(frameIndexAt(idle, 450)).toBe(0);
    expect(frameIndexAt(idle, 500)).toBe(1);
    expect(frameIndexAt(idle, 1200)).toBe(0);
  });

  it('without loop it holds the last frame', () => {
    const attack = entry({ frames: 3, fps: 10, loop: false });

    expect(frameIndexAt(attack, 0)).toBe(0);
    expect(frameIndexAt(attack, 150)).toBe(1);
    expect(frameIndexAt(attack, 250)).toBe(2);
    expect(frameIndexAt(attack, 5000)).toBe(2);
  });

  it('fps <= 0 stays on frame 0', () => {
    expect(frameIndexAt(entry({ fps: 0 }), 10_000)).toBe(0);
    expect(frameIndexAt(entry({ fps: -5 }), 10_000)).toBe(0);
  });

  it('negative time clamps to 0', () => {
    expect(frameIndexAt(entry(), -1000)).toBe(0);
    expect(frameIndexAt(entry({ loop: false }), -0.5)).toBe(0);
  });

  it('non-finite time does not produce a NaN frame', () => {
    expect(frameIndexAt(entry(), Number.NaN)).toBe(0);
    expect(frameIndexAt(entry(), Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('directionFromVector', () => {
  it('gets the right direction on each axis', () => {
    expect(directionFromVector({ x: 1, y: 0 }, 'left')).toBe('right');
    expect(directionFromVector({ x: -1, y: 0 }, 'right')).toBe('left');
    expect(directionFromVector({ x: 0, y: 1 }, 'down')).toBe('up');
    expect(directionFromVector({ x: 0, y: -1 }, 'up')).toBe('down');
  });

  it('diagonal movement picks the dominant axis', () => {
    expect(directionFromVector({ x: 2, y: 1 }, 'down')).toBe('right');
    expect(directionFromVector({ x: -2, y: 1 }, 'down')).toBe('left');
    expect(directionFromVector({ x: 1, y: 2 }, 'down')).toBe('up');
    expect(directionFromVector({ x: 1, y: -2 }, 'up')).toBe('down');
  });

  it('an exact 45° diagonal returns the fallback so it does not flip direction', () => {
    expect(directionFromVector({ x: 1, y: 1 }, 'left')).toBe('left');
    expect(directionFromVector({ x: -3, y: -3 }, 'up')).toBe('up');
  });

  it('the zero vector returns the fallback (standing still)', () => {
    const still: Vec2 = { x: 0, y: 0 };

    expect(directionFromVector(still, 'up')).toBe('up');
    const fallback: Direction = 'right';
    expect(directionFromVector(still, fallback)).toBe(fallback);
  });
});
