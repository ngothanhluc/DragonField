/**
 * Ticket #37 acceptance: room size is data (multiples of the 32×18 view, boss rooms one screen),
 * and a follow camera that never shows past the room, is frame-rate independent, texel-aligned,
 * hard-cuts on entry, and keeps today's static centre for single-screen rooms.
 */
import { describe, expect, it } from 'vitest';
import { FollowCamera, TEXEL_TILES, type FollowCameraTuning } from '../../assets/scripts/core/camera/follow-camera';
import { parseLevelData } from '../../assets/scripts/core/level/level-data';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';

const VIEW = { cols: 32, rows: 18 };
const BIG = { cols: 128, rows: 72 };
const TUNING: FollowCameraTuning = {
  deadzoneHalfTiles: { x: 2, y: 1.5 },
  lookAheadTiles: 2,
  followRate: 8,
  lookAheadRate: 4,
};
const EPS = 1e-9;

function rawRoom(size: { cols: number; rows: number }, isBossRoom = false): unknown {
  return {
    id: 'cam-room',
    chapter: 1,
    room: isBossRoom ? 9 : 1,
    isBossRoom,
    size,
    tileSizePx: 16,
    playerStart: { x: 4, y: 4 },
    waves: [{ enemies: [{ role: 'chaser', at: { x: 10, y: 10 }, elite: false }] }],
    obstacles: [],
    doors: [],
    ...(isBossRoom ? { boss: { name: 'TenguBlue' } } : {}),
  };
}

function isTexelAligned(value: number): boolean {
  const texels = value / TEXEL_TILES;
  return Math.abs(texels - Math.round(texels)) < 1e-6;
}

function insideRoom(camera: FollowCamera): boolean {
  const rect = camera.viewRect();
  return rect.x >= -EPS && rect.y >= -EPS && rect.x + rect.width <= BIG.cols + EPS && rect.y + rect.height <= BIG.rows + EPS;
}

describe('room size is data', () => {
  it('accepts a 128×72 normal room and keeps 32×18', () => {
    expect(parseLevelData(rawRoom(BIG)).size).toEqual(BIG);
    expect(parseLevelData(rawRoom(VIEW)).size).toEqual(VIEW);
    expect(parseLevelData(rawRoom({ cols: 64, rows: 36 })).size).toEqual({ cols: 64, rows: 36 });
  });

  it('rejects sizes that are not whole multiples of the view, and big boss rooms', () => {
    expect(() => parseLevelData(rawRoom({ cols: 40, rows: 18 }))).toThrow();
    expect(() => parseLevelData(rawRoom({ cols: 16, rows: 9 }))).toThrow();
    expect(() => parseLevelData(rawRoom(BIG, true))).toThrow();
    expect(parseLevelData(rawRoom(VIEW, true)).size).toEqual(VIEW);
  });
});

describe('follow camera', () => {
  it('a single-screen room keeps the static centre', () => {
    const camera = new FollowCamera(VIEW, VIEW, TUNING);
    camera.reset({ x: 3, y: 3 });
    expect(camera.position).toEqual({ x: 16, y: 9 });
    for (let i = 0; i < 60; i += 1) camera.update({ x: 30, y: 16 }, { x: 4, y: 0 }, 1 / 60);
    expect(camera.position).toEqual({ x: 16, y: 9 });
  });

  it('room entry is a hard cut, clamped to the room', () => {
    const camera = new FollowCamera(BIG, VIEW, TUNING);
    expect(camera.reset({ x: 60, y: 40 })).toEqual({ x: 60, y: 40 });
    expect(camera.position).toEqual({ x: 60, y: 40 });
    camera.reset({ x: 1, y: 1 });
    expect(camera.position).toEqual({ x: 16, y: 9 });
    camera.reset({ x: 127, y: 71 });
    expect(camera.position).toEqual({ x: 112, y: 63 });
  });

  it('the view never leaves the room and is always texel-aligned', () => {
    const camera = new FollowCamera(BIG, VIEW, TUNING);
    camera.reset({ x: 64, y: 36 });
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    let target: Vec2 = { x: 64, y: 36 };
    for (let frame = 0; frame < 3000; frame += 1) {
      if (frame % 90 === 0) target = { x: random() * BIG.cols, y: random() * BIG.rows };
      camera.update(target, { x: (random() - 0.5) * 8, y: (random() - 0.5) * 8 }, 1 / 60);
      expect(insideRoom(camera), `frame ${frame}`).toBe(true);
      expect(isTexelAligned(camera.position.x) && isTexelAligned(camera.position.y), `frame ${frame}`).toBe(true);
    }
  });

  it('follows the player: after running 8 tiles right the camera has moved right', () => {
    const camera = new FollowCamera(BIG, VIEW, TUNING);
    camera.reset({ x: 50, y: 36 });
    let x = 50;
    for (let frame = 0; frame < 120; frame += 1) {
      x += 4 / 60;
      camera.update({ x, y: 36 }, { x: 4, y: 0 }, 1 / 60);
    }
    expect(camera.position.x).toBeGreaterThan(55);
    expect(camera.position.y).toBeCloseTo(36, 6);
  });

  it('is frame-rate independent: lag differs by < 0.1 tile between 30 and 144 fps', () => {
    const lagAt = (fps: number): number => {
      const camera = new FollowCamera(BIG, VIEW, TUNING);
      camera.reset({ x: 40, y: 36 });
      const dt = 1 / fps;
      let x = 40;
      for (let t = 0; t < 2 - 1e-9; t += dt) {
        x += 4 * dt;
        camera.update({ x, y: 36 }, { x: 4, y: 0 }, dt);
      }
      return x - camera.position.x;
    };
    const slow = lagAt(30);
    const fast = lagAt(144);
    expect(Math.abs(slow - fast)).toBeLessThan(0.1);
  });

  it('a small step inside the deadzone does not move the camera', () => {
    const camera = new FollowCamera(BIG, VIEW, TUNING);
    camera.reset({ x: 64, y: 36 });
    for (let frame = 0; frame < 60; frame += 1) camera.update({ x: 64.5, y: 36.5 }, { x: 0, y: 0 }, 1 / 60);
    expect(camera.position).toEqual({ x: 64, y: 36 });
  });
});
