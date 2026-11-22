/**
 * Ticket #41 acceptance: 8× enemies per room in waves under an alive cap of 24, fair spawns,
 * on-screen-only attacks, and edge arrows toward off-screen enemies / the doors.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decideAction, type EnemyState } from '../../assets/scripts/core/enemies/behaviours';
import { ENEMY_TUNING, TUNING } from '../../assets/scripts/core/enemies/tuning';
import {
  WaveScheduler,
  canAttackFrom,
  edgeArrowTargets,
  roomEnemyTotal,
} from '../../assets/scripts/core/enemies/wave-scheduler';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import type { LevelData, Obstacle } from '../../assets/scripts/core/level/level-data';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const RANGES: Readonly<Record<number, readonly [number, number]>> = { 1: [24, 32], 2: [40, 48], 3: [56, 64] };
const VIEW_W = 32;
const VIEW_H = 18;

function normalRooms(chapter: number): LevelData[] {
  return chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`))).rooms.filter((room) => !room.isBossRoom);
}

function viewAround(centre: Vec2, level: LevelData): { x: number; y: number; width: number; height: number } {
  const x = Math.min(Math.max(centre.x - VIEW_W / 2, 0), level.size.cols - VIEW_W);
  const y = Math.min(Math.max(centre.y - VIEW_H / 2, 0), level.size.rows - VIEW_H);
  return { x, y, width: VIEW_W, height: VIEW_H };
}

function inside(point: Vec2, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function insideObstacle(point: Vec2, obstacles: readonly Obstacle[]): boolean {
  return obstacles.some((o) => point.x > o.x && point.x < o.x + o.width && point.y > o.y && point.y < o.y + o.height);
}

describe('room totals', () => {
  for (const chapter of [1, 2, 3]) {
    it(`chapter ${chapter}: every room spawns 8× the v1 count`, () => {
      const [min, max] = RANGES[chapter] ?? [0, 0];
      for (const level of normalRooms(chapter)) {
        for (const seed of [1, 2, 3]) {
          const total = roomEnemyTotal(level, seed);
          expect(total, `${level.id} seed ${seed}`).toBeGreaterThanOrEqual(min);
          expect(total, `${level.id} seed ${seed}`).toBeLessThanOrEqual(max);
        }
      }
    });
  }

  it('the alive cap is 24 and lives in tuning', () => {
    const waves = (TUNING as unknown as { waves?: { aliveCap: number } }).waves;
    expect(waves?.aliveCap).toBe(24);
  });
});

describe('wave scheduler', () => {
  for (const chapter of [1, 3]) {
    it(`chapter ${chapter}: spawns the whole room under the cap, never near the player, in an obstacle, or unannounced on screen`, () => {
      const level = normalRooms(chapter)[0];
      if (level === undefined) throw new Error('room');
      const scheduler = new WaveScheduler(level, 41);
      const player = level.playerStart;
      const view = viewAround(player, level);
      let alive = 0;
      let spawned = 0;
      const problems: string[] = [];
      for (let nowMs = 0; nowMs < 600_000 && spawned < scheduler.total; nowMs += 100) {
        const spawns = scheduler.step({ nowMs, player, view, alive });
        for (const spawn of spawns) {
          if (Math.hypot(spawn.at.x - player.x, spawn.at.y - player.y) < 6) problems.push(`near player ${JSON.stringify(spawn.at)}`);
          if (insideObstacle(spawn.at, level.obstacles)) problems.push(`in obstacle ${JSON.stringify(spawn.at)}`);
          if (inside(spawn.at, view) && spawn.telegraphMs <= 0) problems.push(`unannounced on screen ${JSON.stringify(spawn.at)}`);
        }
        alive += spawns.length;
        spawned += spawns.length;
        if (alive > 24) problems.push(`alive ${alive} at ${nowMs}`);
        // The player kills one enemy every 400 ms.
        if (nowMs % 400 === 0 && alive > 0) alive -= 1;
      }
      expect(problems.slice(0, 5)).toEqual([]);
      expect(spawned).toBe(scheduler.total);
      expect(scheduler.spawned).toBe(scheduler.total);
      expect(scheduler.isCleared(0)).toBe(true);
      expect(scheduler.isCleared(1)).toBe(false);
    });
  }
});

describe('fairness', () => {
  const view = { x: 40, y: 20, width: 32, height: 18 };

  it('enemies attack only inside the view', () => {
    expect(canAttackFrom({ x: 56, y: 29 }, view)).toBe(true);
    expect(canAttackFrom({ x: 39, y: 29 }, view)).toBe(false);
    expect(canAttackFrom({ x: 56, y: 39 }, view)).toBe(false);
    expect(canAttackFrom({ x: 40.5, y: 29 }, view)).toBe(false); // inside the 1-tile inset
  });

  it('a caster in its band but off screen does not telegraph; on screen it does', () => {
    const level = normalRooms(1)[0];
    if (level === undefined) throw new Error('room');
    const band = (ENEMY_TUNING.roles.caster.preferredRangeMinTiles + ENEMY_TUNING.roles.caster.preferredRangeMaxTiles) / 2;
    const player = { x: 64, y: 36 };
    const caster: EnemyState = {
      id: 'c', role: 'caster', elite: false, position: { x: 64 + band, y: 36 }, health: 4, maxHealth: 4,
      action: { kind: 'idle' }, actionStartedMs: -10_000,
    };
    const empty = { ...level, obstacles: [] } as LevelData;
    const offScreen = { x: 30, y: 27, width: 32, height: 18 }; // caster at x 69 is right of it
    const onScreen = { x: 48, y: 27, width: 32, height: 18 };
    const args = { state: caster, player, nowMs: 0, level: empty };
    expect(decideAction({ ...args, view: offScreen } as Parameters<typeof decideAction>[0]).kind).not.toBe('telegraph');
    expect(decideAction({ ...args, view: onScreen } as Parameters<typeof decideAction>[0]).kind).toBe('telegraph');
  });
});

describe('edge arrows', () => {
  const view = { x: 40, y: 20, width: 32, height: 18 };
  const player = { x: 56, y: 29 };

  it('point at the nearest off-screen enemies, never at on-screen ones', () => {
    const enemies = [{ x: 56, y: 30 }, { x: 90, y: 29 }, { x: 20, y: 29 }, { x: 56, y: 60 }, { x: 120, y: 70 }];
    const targets = edgeArrowTargets(player, view, enemies, [], false, 3);
    expect(targets).toEqual([{ x: 56, y: 60 }, { x: 90, y: 29 }, { x: 20, y: 29 }]);
  });

  it('point at the doors once the room is cleared', () => {
    const doors = [{ x: 64, y: 71 }, { x: 64, y: 0.5 }];
    expect(edgeArrowTargets(player, view, [], doors, true, 3)).toEqual([{ x: 64, y: 0.5 }, { x: 64, y: 71 }]);
  });
});
