/**
 * `moveWithCollision` — the movement rule shared by the player, enemies and the balance sim
 * (ticket #33). The acceptance contract lives in `collision.acceptance.test.ts`; these are the
 * small units of the same seam.
 */
import { describe, expect, it } from 'vitest';
import type { LevelData, Obstacle } from '../../assets/scripts/core/level/level-data';
import { obstacleAt, parseLevelData } from '../../assets/scripts/core/level/level-data';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { moveWithCollision } from '../../assets/scripts/core/movement/collision';

const MARGIN = 0.5;
const PLAYER_RADIUS = 0.25;

function room(obstacles: Obstacle[] = []): LevelData {
  return parseLevelData({
    id: 'movement-room',
    chapter: 1,
    room: 1,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 2, y: 2 },
    waves: [{ enemies: [{ role: 'chaser', at: { x: 30, y: 16 }, elite: false }] }],
    obstacles,
    doors: [],
  });
}

function pillar(): Obstacle {
  return { kind: 'pillar', x: 10, y: 8, width: 1, height: 1 };
}

describe('moveWithCollision — contact', () => {
  it('stops a circle flush against a pillar instead of walking into it', () => {
    const end = moveWithCollision(
      { x: 9, y: 8.5 },
      { x: 2, y: 0 },
      PLAYER_RADIUS,
      room([pillar()]),
      MARGIN,
    );

    expect(end.x).toBeCloseTo(10 - PLAYER_RADIUS, 9);
    expect(end.y).toBeCloseTo(8.5, 9);
  });

  it('a pit stops a walker just like a pillar', () => {
    const pit: Obstacle = { kind: 'pit', x: 10, y: 8, width: 1, height: 1 };
    const end = moveWithCollision({ x: 9, y: 8.5 }, { x: 2, y: 0 }, PLAYER_RADIUS, room([pit]), MARGIN);

    expect(end.x).toBeCloseTo(10 - PLAYER_RADIUS, 9);
  });

  it('touching a wall is not an overlap: the actor can still move along it', () => {
    const wall: Obstacle = { kind: 'wall', x: 10, y: 0, width: 2, height: 18 };
    const end = moveWithCollision(
      { x: 10 - PLAYER_RADIUS, y: 5 },
      { x: 0, y: 0.5 },
      PLAYER_RADIUS,
      room([wall]),
      MARGIN,
    );

    expect(end.x).toBeCloseTo(10 - PLAYER_RADIUS, 9);
    expect(end.y).toBeCloseTo(5.5, 9);
  });
});

describe('moveWithCollision — sliding and bounds', () => {
  it('keeps the along-wall component when pushed diagonally into a wall', () => {
    const wall: Obstacle = { kind: 'wall', x: 10, y: 0, width: 2, height: 18 };
    const end = moveWithCollision({ x: 9, y: 5 }, { x: 1, y: 0.5 }, PLAYER_RADIUS, room([wall]), MARGIN);

    expect(end.x).toBeCloseTo(10 - PLAYER_RADIUS, 9);
    expect(end.y).toBeCloseTo(5.5, 9);
  });

  it('clamps the centre to the room edge margin and moves freely in the open', () => {
    const level = room();

    expect(moveWithCollision({ x: 1, y: 1 }, { x: -5, y: -5 }, PLAYER_RADIUS, level, MARGIN)).toEqual({
      x: 0.5,
      y: 0.5,
    });
    const free = moveWithCollision({ x: 5, y: 5 }, { x: 0.3, y: -0.2 }, PLAYER_RADIUS, level, MARGIN);
    expect(free.x).toBeCloseTo(5.3, 9);
    expect(free.y).toBeCloseTo(4.8, 9);
  });
});

describe('moveWithCollision — tunnelling', () => {
  it('does not pass through a 1-tile pillar in one long move', () => {
    const level = room([pillar()]);
    const end = moveWithCollision({ x: 7, y: 8.5 }, { x: 10, y: 0 }, PLAYER_RADIUS, level, MARGIN);

    expect(obstacleAt(level, end)).toBeNull();
    expect(end.x).toBeLessThan(10);
  });

  it('never mutates its inputs', () => {
    const position: Vec2 = { x: 9, y: 8.5 };
    const delta: Vec2 = { x: 2, y: 0 };
    moveWithCollision(position, delta, PLAYER_RADIUS, room([pillar()]), MARGIN);

    expect(position).toEqual({ x: 9, y: 8.5 });
    expect(delta).toEqual({ x: 2, y: 0 });
  });
});
