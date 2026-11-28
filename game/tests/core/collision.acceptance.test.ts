/**
 * Ticket #33 acceptance: the player and enemies collide with obstacles; pits stop walkers
 * but not bullets.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { firstHit } from '../../assets/scripts/core/combat/bullets';
import { startKnockback, stepKnockback } from '../../assets/scripts/core/combat/knockback';
import { visualScaleFor } from '../../assets/scripts/core/enemies/behaviours';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import {
  OBSTACLE_KINDS,
  parseLevelData,
  type ChapterData,
  type LevelData,
  type Obstacle,
  type ObstacleKind,
} from '../../assets/scripts/core/level/level-data';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { moveWithCollision } from '../../assets/scripts/core/movement/collision';
import { simulateRun, type InputPolicy } from '../../sim/run-simulation';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const MARGIN = 0.5;
const EPS = 1e-6;
const PLAYER_RADIUS = 0.25;
const ENEMY_RADIUS = 0.4;
/** Player at 4 tiles/s for one 16 ms frame. */
const FRAME_STEP = 0.064;

function room(obstacles: Obstacle[]): LevelData {
  return parseLevelData({
    id: 'collision-room',
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

function obstacle(kind: ObstacleKind, x: number, y: number, width: number, height: number): Obstacle {
  return { kind, x, y, width, height };
}

/** Distance from a point to a rectangle (0 when inside). */
function gapToRect(point: Vec2, rect: Obstacle): number {
  const cx = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  return Math.hypot(point.x - cx, point.y - cy);
}

function overlaps(point: Vec2, radius: number, rect: Obstacle): boolean {
  return gapToRect(point, rect) < radius - EPS;
}

const DIRECTIONS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
];

describe('moveWithCollision', () => {
  const radii = [PLAYER_RADIUS, ENEMY_RADIUS, ENEMY_RADIUS * 1.4];

  for (const kind of OBSTACLE_KINDS) {
    it(`never ends overlapping a ${kind}, pushed in from 8 directions`, () => {
      const block = obstacle(kind, 14, 8, 2, 2);
      const level = room([block]);
      const centre = { x: 15, y: 9 };
      for (const radius of radii) {
        for (const dir of DIRECTIONS) {
          let position: Vec2 = { x: centre.x - dir.x * 4, y: centre.y - dir.y * 4 };
          for (let frame = 0; frame < 120; frame += 1) {
            position = moveWithCollision(
              position,
              { x: dir.x * FRAME_STEP, y: dir.y * FRAME_STEP },
              radius,
              level,
              MARGIN,
            );
            expect(overlaps(position, radius, block), `${kind} r=${radius} dir=${JSON.stringify(dir)} frame ${frame} at ${JSON.stringify(position)}`).toBe(false);
          }
          // It got close: it pressed against the obstacle instead of stopping early.
          expect(gapToRect(position, block)).toBeLessThan(radius + 0.1);
        }
      }
    });
  }

  it('slides along a wall when pushed diagonally into it', () => {
    const wall = obstacle('wall', 10, 0, 2, 18);
    const level = room([wall]);
    let position: Vec2 = { x: 9, y: 5 };
    for (let frame = 0; frame < 20; frame += 1) {
      position = moveWithCollision(position, { x: 0.1, y: 0.1 }, PLAYER_RADIUS, level, MARGIN);
    }
    expect(position.x).toBeLessThanOrEqual(10 - PLAYER_RADIUS + EPS);
    expect(position.x).toBeGreaterThan(10 - PLAYER_RADIUS - 0.1);
    // The along-wall component is kept in full.
    expect(position.y).toBeCloseTo(7, 6);
  });

  it('does not tunnel through a 1-tile pillar in one long move', () => {
    const pillar = obstacle('pillar', 10, 8, 1, 1);
    const level = room([pillar]);
    const end = moveWithCollision({ x: 8.5, y: 8.5 }, { x: 5, y: 0 }, PLAYER_RADIUS, level, MARGIN);
    expect(end.x).toBeLessThanOrEqual(10 - PLAYER_RADIUS + EPS);
    expect(overlaps(end, PLAYER_RADIUS, pillar)).toBe(false);
  });

  it('still clamps to the room edge and moves freely in the open', () => {
    const level = room([]);
    expect(moveWithCollision({ x: 1, y: 1 }, { x: -5, y: -5 }, PLAYER_RADIUS, level, MARGIN)).toEqual({ x: 0.5, y: 0.5 });
    expect(moveWithCollision({ x: 31, y: 17 }, { x: 5, y: 5 }, PLAYER_RADIUS, level, MARGIN)).toEqual({ x: 31.5, y: 17.5 });
    const free = moveWithCollision({ x: 5, y: 5 }, { x: 0.3, y: -0.2 }, PLAYER_RADIUS, level, MARGIN);
    expect(free.x).toBeCloseTo(5.3, 9);
    expect(free.y).toBeCloseTo(4.8, 9);
  });
});

describe('bullets and pits', () => {
  it('stop on pillar and wall but fly over a pit', () => {
    const path = { from: { x: 8, y: 9 }, to: { x: 18, y: 9 } };
    expect(firstHit(path, room([obstacle('pillar', 12, 8, 2, 2)]))).not.toBeNull();
    expect(firstHit(path, room([obstacle('wall', 12, 8, 2, 2)]))).not.toBeNull();
    expect(firstHit(path, room([obstacle('pit', 12, 8, 2, 2)]))).toBeNull();
  });
});

describe('knockback', () => {
  it('keeps the whole circle out of the obstacle, not just the centre', () => {
    const pillar = obstacle('pillar', 10, 8, 2, 2);
    const level = room([pillar]);
    let position: Vec2 = { x: 8.6, y: 9 };
    let state = startKnockback(position, { x: 7, y: 9 }, { distanceTiles: 3, durationMs: 180 });
    while (state !== null) {
      const result = stepKnockback(position, state, 16, level, MARGIN, PLAYER_RADIUS);
      position = result.position;
      state = result.state;
      expect(overlaps(position, PLAYER_RADIUS, pillar)).toBe(false);
    }
  });
});

function loadChapter(chapter: number): ChapterData {
  return chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`)));
}

describe('rooms on disk', () => {
  it('no playerStart or spawn overlaps an obstacle', () => {
    const problems: string[] = [];
    for (const chapter of [1, 2, 3, 4]) {
      for (const level of loadChapter(chapter).rooms) {
        for (const block of level.obstacles) {
          if (overlaps(level.playerStart, PLAYER_RADIUS, block)) problems.push(`${level.id} playerStart`);
          level.waves.forEach((wave, index) => {
            for (const spawn of wave.enemies) {
              const radius = ENEMY_RADIUS * visualScaleFor(spawn.role);
              if (overlaps(spawn.at, radius, block)) problems.push(`${level.id} wave ${index + 1} ${spawn.role} at ${JSON.stringify(spawn.at)}`);
            }
          });
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('balance sim uses the same collision', () => {
  /** Walks into the obstacles of the current room one after another, 2 s each. */
  function pushIntoObstacles(chapter: ChapterData, overlapsFound: string[]): InputPolicy {
    return (world) => {
      const level = chapter.rooms.find((candidate) => candidate.room === world.room);
      if (level === undefined || level.isBossRoom || level.obstacles.length === 0) {
        return { up: false, down: false, left: false, right: false };
      }
      for (const block of level.obstacles) {
        if (overlaps(world.player, PLAYER_RADIUS, block)) {
          overlapsFound.push(`${level.id} player ${JSON.stringify(world.player)} in ${block.kind}`);
        }
        for (const enemy of world.enemies) {
          if (enemy.health <= 0) continue;
          const radius = ENEMY_RADIUS * visualScaleFor(enemy.role);
          if (overlaps(enemy.position, radius, block)) {
            overlapsFound.push(`${level.id} ${enemy.role} ${JSON.stringify(enemy.position)} in ${block.kind}`);
          }
        }
      }
      const target = level.obstacles[Math.floor(world.nowMs / 2000) % level.obstacles.length];
      if (target === undefined) return { up: false, down: false, left: false, right: false };
      const dx = target.x + target.width / 2 - world.player.x;
      const dy = target.y + target.height / 2 - world.player.y;
      return { up: dy < -0.05, down: dy > 0.05, left: dx < -0.05, right: dx > 0.05 };
    };
  }

  for (const chapterNumber of [1, 2, 3, 4]) {
    it(`chapter ${chapterNumber}: neither the player nor an enemy ever overlaps an obstacle`, () => {
      const chapter = loadChapter(chapterNumber);
      const overlapsFound: string[] = [];
      simulateRun({
        seed: 33,
        level: chapter,
        policy: pushIntoObstacles(chapter, overlapsFound),
        godMode: true,
        maxDurationMs: 60_000,
      });
      expect(overlapsFound.slice(0, 5)).toEqual([]);
    });
  }
});
