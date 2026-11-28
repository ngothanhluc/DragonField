/**
 * Ticket #34 acceptance: enemies path around obstacles with one shared flow field, rebuilt only
 * when the player changes tile (throttled), and ranged enemies fire only with line of sight.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ROOM_EDGE_MARGIN_TILES,
  decideAction,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import {
  FlowFieldCache,
  buildFlowField,
  buildNavGrid,
  hasLineOfSight,
} from '../../assets/scripts/core/enemies/navigation';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import {
  parseLevelData,
  type LevelData,
  type Obstacle,
} from '../../assets/scripts/core/level/level-data';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { moveWithCollision } from '../../assets/scripts/core/movement/collision';
import { simulateRun, type InputPolicy } from '../../sim/run-simulation';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const RADIUS = 0.4;
const MARGIN = ROOM_EDGE_MARGIN_TILES;

function room(obstacles: Obstacle[]): LevelData {
  return parseLevelData({
    id: 'nav-room',
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

/** A 1-tile-thick vertical wall at x = 15..16 from y = 2 to y = 16, open above and below. */
const WALL: Obstacle = { kind: 'wall', x: 15, y: 2, width: 1, height: 14 };

function gapToRect(point: Vec2, rect: Obstacle): number {
  const cx = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  return Math.hypot(point.x - cx, point.y - cy);
}

/** Independent reference: octile Dijkstra over cell centres free for `radius`, no corner cutting. */
function optimalPathLength(level: LevelData, from: Vec2, to: Vec2, radius: number): number {
  const { cols, rows } = level.size;
  const free = (c: number, r: number): boolean => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    const p = { x: c + 0.5, y: r + 0.5 };
    if (p.x < MARGIN || p.y < MARGIN || p.x > cols - MARGIN || p.y > rows - MARGIN) return false;
    return level.obstacles.every((o) => gapToRect(p, o) >= radius);
  };
  const start = Math.floor(from.y) * cols + Math.floor(from.x);
  const goal = Math.floor(to.y) * cols + Math.floor(to.x);
  const dist = new Array<number>(cols * rows).fill(Infinity);
  const done = new Array<boolean>(cols * rows).fill(false);
  dist[start] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < dist.length; i += 1) {
      if (!done[i] && (dist[i] ?? Infinity) < Infinity && (best < 0 || (dist[i] ?? 0) < (dist[best] ?? 0))) best = i;
    }
    if (best < 0 || best === goal) break;
    done[best] = true;
    const c = best % cols;
    const r = (best - c) / cols;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (!free(nc, nr)) continue;
      if (dc !== 0 && dr !== 0 && (!free(c + dc, r) || !free(c, r + dr))) continue;
      const n = nr * cols + nc;
      const cost = (dist[best] ?? 0) + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (cost < (dist[n] ?? Infinity)) dist[n] = cost;
    }
  }
  return dist[goal] ?? Infinity;
}

describe('nav grid', () => {
  it('blocks cells whose centre circle overlaps an obstacle, inflated by the radius', () => {
    const grid = buildNavGrid(room([WALL]), RADIUS, MARGIN);
    expect(grid.isBlocked(15, 8)).toBe(true);
    // Cell 14's centre is 0.5 tiles from the wall face: free for 0.4, blocked for a 0.6 radius.
    expect(grid.isBlocked(14, 8)).toBe(false);
    expect(buildNavGrid(room([WALL]), 0.6, MARGIN).isBlocked(14, 8)).toBe(true);
    expect(grid.isBlocked(5, 8)).toBe(false);
  });
});

describe('flow field', () => {
  const level = room([WALL]);
  const grid = buildNavGrid(level, RADIUS, MARGIN);
  const player = { x: 25.5, y: 9.5 };
  const field = buildFlowField(grid, player);

  it('an enemy behind a wall walks around it, within 1.2x the optimal path', () => {
    let position: Vec2 = { x: 6.5, y: 9.5 };
    let walked = 0;
    for (let step = 0; step < 4000 && Math.hypot(position.x - player.x, position.y - player.y) > 0.75; step += 1) {
      const direction = field.directionAt(position);
      if (direction === null) break;
      const next = moveWithCollision(position, { x: direction.x * 0.05, y: direction.y * 0.05 }, RADIUS, level, MARGIN);
      walked += Math.hypot(next.x - position.x, next.y - position.y);
      position = next;
    }
    expect(Math.hypot(position.x - player.x, position.y - player.y)).toBeLessThanOrEqual(0.75);
    const optimal = optimalPathLength(level, { x: 6.5, y: 9.5 }, player, RADIUS);
    expect(walked).toBeLessThanOrEqual(optimal * 1.2);
  });

  it('distances follow the shortest path, not the straight line', () => {
    const straight = Math.hypot(25.5 - 6.5, 0);
    expect(field.distanceAt(6, 9)).toBeGreaterThan(straight + 4);
    expect(field.distanceAt(6, 9)).toBeLessThan(Infinity);
    expect(field.distanceAt(15, 9)).toBe(Infinity);
  });

  it('never cuts a blocked corner', () => {
    // A single blocked cell diagonal to the path: stepping diagonally past it would cut its corner.
    const pillar: Obstacle = { kind: 'pillar', x: 10, y: 8, width: 1, height: 1 };
    const pillarLevel = room([pillar]);
    const tight = buildFlowField(buildNavGrid(pillarLevel, 0.25, MARGIN), { x: 11.5, y: 7.5 });
    const direction = tight.directionAt({ x: 9.5, y: 9.5 });
    expect(direction).not.toBeNull();
    // From (9,9) the diagonal to (10,8) is blocked and (10,9)->(11,8) would clip (10,8): the first step must be orthogonal.
    expect(Math.abs(direction?.x ?? 0) < 1e-6 || Math.abs(direction?.y ?? 0) < 1e-6).toBe(true);
  });

  it('an unreachable goal returns null directions and Infinity, without hanging', () => {
    const box: Obstacle[] = [
      { kind: 'wall', x: 20, y: 5, width: 8, height: 1 },
      { kind: 'wall', x: 20, y: 12, width: 8, height: 1 },
      { kind: 'wall', x: 20, y: 5, width: 1, height: 8 },
      { kind: 'wall', x: 27, y: 5, width: 1, height: 8 },
    ];
    const boxed = buildFlowField(buildNavGrid(room(box), RADIUS, MARGIN), { x: 23.5, y: 8.5 });
    expect(boxed.distanceAt(5, 5)).toBe(Infinity);
    expect(boxed.directionAt({ x: 5.5, y: 5.5 })).toBeNull();
  });
});

describe('flow field cache', () => {
  it('rebuilds only when the player changes tile and the throttle has passed', () => {
    const cache = new FlowFieldCache(buildNavGrid(room([WALL]), RADIUS, MARGIN), 250);
    cache.update({ x: 5.2, y: 5.2 }, 0);
    cache.update({ x: 5.8, y: 5.8 }, 300); // same tile
    expect(cache.rebuildCount).toBe(1);
    cache.update({ x: 6.2, y: 5.8 }, 400); // new tile, 400 ms since the last build
    expect(cache.rebuildCount).toBe(2);
    cache.update({ x: 7.2, y: 5.8 }, 500); // new tile, 100 ms since the last build
    expect(cache.rebuildCount).toBe(2);
    cache.update({ x: 7.2, y: 5.8 }, 700); // still a different tile from the last build, throttle passed
    expect(cache.rebuildCount).toBe(3);
  });
});

describe('line of sight', () => {
  const level = room([WALL, { kind: 'pit', x: 5, y: 2, width: 2, height: 14 }]);

  it('walls block sight, pits do not', () => {
    expect(hasLineOfSight(level, { x: 10, y: 9 }, { x: 20, y: 9 })).toBe(false);
    expect(hasLineOfSight(level, { x: 2, y: 9 }, { x: 10, y: 9 })).toBe(true);
    expect(hasLineOfSight(level, { x: 10, y: 1 }, { x: 20, y: 1 })).toBe(true);
  });

  it('a caster with a wall between it and the player does not start a telegraph', () => {
    const caster: EnemyState = {
      id: 'c',
      role: 'caster',
      elite: false,
      position: { x: 12.5, y: 9.5 },
      health: 4,
      maxHealth: 4,
      action: { kind: 'idle' },
      actionStartedMs: -10_000,
    };
    const player = { x: 17.5, y: 9.5 }; // 5 tiles away: inside the caster's 4..6 band
    const blocked = decideAction({ state: caster, player, nowMs: 0, level: room([WALL]) });
    expect(blocked.kind).not.toBe('telegraph');
    const open = decideAction({ state: caster, player, nowMs: 0, level: room([]) });
    expect(open.kind).toBe('telegraph');
  });
});

describe('headless runs: no enemy gets stuck', () => {
  for (const chapterNumber of [1, 2, 3, 4]) {
    it(`chapter ${chapterNumber}: no enemy keeps walking for 2 s while moving < 0.5 tiles`, () => {
      const chapter = chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapterNumber}`)));
      const windows = new Map<string, { since: number; from: Vec2 }>();
      const stuck: string[] = [];
      const policy: InputPolicy = (world) => {
        for (const enemy of world.enemies) {
          // #41: with up to 24 bodies converging on a standing player, the ring right around them is
          // blocked by other bodies, not by the level; only path-finding stalls count (owner decision 2026-11-22).
          const crowded = Math.hypot(enemy.position.x - world.player.x, enemy.position.y - world.player.y) <= 3;
          if (enemy.health <= 0 || enemy.action.kind !== 'walk' || crowded) {
            windows.delete(enemy.id);
            continue;
          }
          const window = windows.get(enemy.id);
          if (window === undefined) {
            windows.set(enemy.id, { since: world.nowMs, from: { ...enemy.position } });
            continue;
          }
          if (world.nowMs - window.since >= 2000) {
            const moved = Math.hypot(enemy.position.x - window.from.x, enemy.position.y - window.from.y);
            if (moved < 0.5) stuck.push(`room ${world.room} ${enemy.id} at ${JSON.stringify(enemy.position)}`);
            windows.set(enemy.id, { since: world.nowMs, from: { ...enemy.position } });
          }
        }
        // Stand still: enemies must come to the player wherever the room put them.
        return { up: false, down: false, left: false, right: false };
      };
      simulateRun({ seed: 34, level: chapter, policy, godMode: true, maxDurationMs: 120_000 });
      expect(stuck.slice(0, 5)).toEqual([]);
    });
  }
});
