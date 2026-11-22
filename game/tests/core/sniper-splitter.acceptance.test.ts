/**
 * Ticket #42 acceptance: sniper (far, ≥ 800 ms line telegraph, one fast shot, only with line of
 * sight) and splitter (splits into 2–3 splitlings that do not split again).
 */
import { describe, expect, it } from 'vitest';
import { ENEMY_BULLET_SPEED_TILES_PER_SECOND } from '../../assets/scripts/core/combat/enemy-fire';
import { attackReleased, decideAction, type EnemyState } from '../../assets/scripts/core/enemies/behaviours';
import { splitOnDeath } from '../../assets/scripts/core/enemies/splitter';
import { ENEMY_TUNING } from '../../assets/scripts/core/enemies/tuning';
import { ENEMY_ROLES, parseLevelData, type EnemyRole, type LevelData, type Obstacle } from '../../assets/scripts/core/level/level-data';
import { simulateRun } from '../../assets/scripts/core/sim/run-simulation';

type RoleTuning = Record<string, number>;
const roles = ENEMY_TUNING.roles as unknown as Record<string, RoleTuning | undefined>;

function room(
  obstacles: Obstacle[] = [],
  spawns: { role: string; x: number; y: number }[] = [{ role: 'chaser', x: 30, y: 16 }],
): LevelData {
  return parseLevelData({
    id: 'r42',
    chapter: 1,
    room: 1,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 4, y: 9 },
    waves: [{ enemies: spawns.map((s) => ({ role: s.role, at: { x: s.x, y: s.y }, elite: false })) }],
    obstacles,
    doors: [],
  });
}

function enemy(role: string, x: number, y: number, extra: Partial<EnemyState> = {}): EnemyState {
  return {
    id: `${role}-1`,
    role: role as EnemyRole,
    elite: false,
    position: { x, y },
    health: 4,
    maxHealth: 4,
    action: { kind: 'idle' },
    actionStartedMs: -10_000,
    ...extra,
  };
}

describe('new roles exist and parse', () => {
  it('sniper, splitter and splitling are enemy roles with tuning', () => {
    for (const role of ['sniper', 'splitter', 'splitling']) {
      expect(ENEMY_ROLES as readonly string[]).toContain(role);
      expect(roles[role], role).toBeDefined();
    }
    const level = room([], [{ role: 'sniper', x: 28, y: 9 }, { role: 'splitter', x: 20, y: 4 }]);
    expect(level.waves[0]?.enemies.map((e) => e.role)).toEqual(['sniper', 'splitter']);
  });
});

describe('sniper', () => {
  const tuning = (): RoleTuning => roles.sniper ?? {};

  it('keeps far, telegraphs at least 800 ms, and fires one fast shot', () => {
    expect(tuning().telegraphMs ?? 0).toBeGreaterThanOrEqual(800);
    expect(tuning().preferredRangeMinTiles ?? 0).toBeGreaterThanOrEqual(8);
    expect(tuning().projectileSpeedTilesPerSecond ?? 0).toBeGreaterThanOrEqual(ENEMY_BULLET_SPEED_TILES_PER_SECOND * 2.5);
  });

  it('in range with sight: telegraph, still telegraphing before 800 ms, released as a shot after', () => {
    const level = room();
    const player = { x: 4, y: 9 };
    const range = ((tuning().preferredRangeMinTiles ?? 8) + (tuning().preferredRangeMaxTiles ?? 12)) / 2;
    const sniper = enemy('sniper', 4 + range, 9);
    const first = decideAction({ state: sniper, player, nowMs: 0, level });
    expect(first.kind).toBe('telegraph');
    const waiting = decideAction({ state: { ...sniper, action: first, actionStartedMs: 0 }, player, nowMs: 799, level });
    expect(waiting.kind).toBe('telegraph');
    const after = decideAction({ state: { ...sniper, action: first, actionStartedMs: 0 }, player, nowMs: 1000, level });
    expect(attackReleased(first, after)).toBe('shot');
  });

  it('never telegraphs without line of sight', () => {
    const wall: Obstacle = { kind: 'wall', x: 12, y: 2, width: 1, height: 14 };
    const level = room([wall]);
    const range = ((tuning().preferredRangeMinTiles ?? 8) + (tuning().preferredRangeMaxTiles ?? 12)) / 2;
    const sniper = enemy('sniper', 4 + range, 9);
    const action = decideAction({ state: sniper, player: { x: 4, y: 9 }, nowMs: 0, level });
    expect(action.kind).not.toBe('telegraph');
  });
});

describe('splitter', () => {
  it('splits into the configured 2–3 splitlings on free ground; splitlings do not split', () => {
    const count = roles.splitter?.splitCount ?? 0;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
    const pillar: Obstacle = { kind: 'pillar', x: 16, y: 8, width: 2, height: 2 };
    const level = room([pillar]);
    const dead = enemy('splitter', 15.5, 9, { health: 0, action: { kind: 'dead' } });
    const children = splitOnDeath(dead, level, 1234);
    expect(children).toHaveLength(count);
    const ids = new Set(children.map((child) => child.id));
    expect(ids.size).toBe(count);
    for (const child of children) {
      expect(child.role).toBe('splitling');
      expect(child.health).toBeGreaterThan(0);
      const insidePillar =
        child.position.x > pillar.x && child.position.x < pillar.x + pillar.width &&
        child.position.y > pillar.y && child.position.y < pillar.y + pillar.height;
      expect(insidePillar).toBe(false);
      expect(splitOnDeath({ ...child, health: 0, action: { kind: 'dead' } }, level, 2000)).toEqual([]);
    }
    expect(splitOnDeath(enemy('chaser', 10, 9, { health: 0 }), level, 0)).toEqual([]);
  });

  it('the balance sim kills the splitter and every splitling before the room clears', () => {
    const level = room([], [{ role: 'splitter', x: 12, y: 9 }]);
    const result = simulateRun({
      seed: 42,
      level: { chapter: 1, rooms: [level] },
      policy: () => ({ up: false, down: false, left: false, right: false }),
      godMode: true,
      maxDurationMs: 60_000,
    });
    const kills = result.events.filter((event) => event.kind === 'kill').map((event) => (event as { role: string }).role);
    expect(kills.filter((role) => role === 'splitter')).toHaveLength(1);
    expect(kills.filter((role) => role === 'splitling')).toHaveLength(roles.splitter?.splitCount ?? -1);
  });
});
