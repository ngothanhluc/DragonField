/**
 * Unit tests for the #41 seam outside the acceptance contract: the scheduler's cap, the spawn
 * fairness rules and the view gate on `decideAction`. The acceptance suite
 * (`waves.acceptance.test.ts`) locks the numbers; this file locks the edges around them.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  WaveScheduler,
  aliveCapForSlot,
  canAttackFrom,
  edgeArrowTargets,
  enemyStateFromSpawn,
  roomEnemyTotal,
} from '../../assets/scripts/core/enemies/wave-scheduler';
import {
  attackReleased,
  decideAction,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import { ENEMY_TUNING, WAVES_TUNING } from '../../assets/scripts/core/enemies/tuning';
import { obstacleAt, type LevelData } from '../../assets/scripts/core/level/level-data';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import { distance, type Vec2 } from '../../assets/scripts/core/math/vec2';
import { loadTmxLevels, LEVELS_ROOT } from '../helpers/tmx-levels';

function normalRoom(chapter: number, index = 0): LevelData {
  const room = chapterFromLevels(
    loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`)),
  ).rooms.filter((level) => !level.isBossRoom)[index];
  if (room === undefined) throw new Error(`chapter ${chapter}: no normal room ${index}`);
  return room;
}

/** View of one screen centred on `centre`, clamped to the room (what the sim passes). */
function viewAround(centre: Vec2, level: LevelData) {
  const width = 32;
  const height = 18;
  return {
    x: Math.min(Math.max(centre.x - width / 2, 0), level.size.cols - width),
    y: Math.min(Math.max(centre.y - height / 2, 0), level.size.rows - height),
    width,
    height,
  };
}

function chaserAt(position: Vec2, action: EnemyState['action'] = { kind: 'idle' }): EnemyState {
  return {
    id: 'chaser',
    role: 'chaser',
    elite: false,
    position,
    health: 6,
    maxHealth: 6,
    action,
    actionStartedMs: 0,
  };
}

describe('roomEnemyTotal', () => {
  it('is a pure function of the room and seed', () => {
    const room = normalRoom(1);
    expect(roomEnemyTotal(room, 41)).toBe(roomEnemyTotal(room, 41));
  });

  it('a boss room keeps its authored add list instead of the 8× total', () => {
    const boss = chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, 'chapter-1'))).rooms.find(
      (level) => level.isBossRoom,
    );
    if (boss === undefined) throw new Error('chapter 1 has no boss room');
    const authored = boss.waves.reduce((sum, wave) => sum + wave.enemies.length, 0);
    expect(roomEnemyTotal(boss, 7)).toBe(authored);
  });
});

describe('WaveScheduler', () => {
  it('ramps the alive cap by run slot and never past aliveCap', () => {
    expect(aliveCapForSlot(1)).toBe(WAVES_TUNING.aliveCapStart);
    expect(aliveCapForSlot(2)).toBe(
      Math.min(WAVES_TUNING.aliveCap, WAVES_TUNING.aliveCapStart + WAVES_TUNING.aliveCapStepPerRoom),
    );
    expect(aliveCapForSlot(99)).toBe(WAVES_TUNING.aliveCap);
    expect(aliveCapForSlot(8)).toBe(
      Math.min(
        WAVES_TUNING.aliveCap,
        WAVES_TUNING.aliveCapStart + WAVES_TUNING.aliveCapStepPerRoom * 7,
      ),
    );
    expect(new WaveScheduler(normalRoom(1), 1, 1).aliveCap).toBe(WAVES_TUNING.aliveCapStart);
    expect(new WaveScheduler(normalRoom(1), 1, 8).aliveCap).toBe(aliveCapForSlot(8));
    // A missing/odd slot must never produce a negative or unbounded cap.
    expect(aliveCapForSlot(0)).toBe(WAVES_TUNING.aliveCapStart);
    expect(aliveCapForSlot(Number.NaN)).toBe(WAVES_TUNING.aliveCap);
  });

  it('opens a room with at most half its cap in the first batch', () => {
    const level = normalRoom(3);
    const scheduler = new WaveScheduler(level, 41, 1);
    const player = level.playerStart;
    const view = viewAround(player, level);
    const first = scheduler.step({ nowMs: 0, player, view, alive: 0 });
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(Math.ceil(scheduler.aliveCap / 2));
  });

  it('never exceeds the run slot’s alive cap even when nothing dies', () => {
    const level = normalRoom(3);
    const scheduler = new WaveScheduler(level, 41, 8);
    const cap = scheduler.aliveCap;
    expect(cap).toBe(aliveCapForSlot(8));
    expect(cap).toBeLessThanOrEqual(WAVES_TUNING.aliveCap);
    const player = level.playerStart;
    const view = viewAround(player, level);
    let alive = 0;
    let spawned = 0;
    let nowMs = 0;

    // Nobody dies: the scheduler fills to the cap and then holds.
    for (; nowMs < 300_000 && alive < cap; nowMs += 100) {
      const before = spawned;
      const spawns = scheduler.step({ nowMs, player, view, alive });
      alive += spawns.length;
      spawned += spawns.length;
      expect(alive).toBeLessThanOrEqual(cap);
      if (spawns.length === 0 && before === spawned && nowMs > 60_000) break;
    }
    expect(alive).toBe(cap);
    expect(spawned).toBe(cap);
    expect(scheduler.isCleared(alive)).toBe(false);

    // Kills free slots: the rest of the room follows, still under the cap.
    while (spawned < scheduler.total && nowMs < 600_000) {
      nowMs += 100;
      if (nowMs % 400 === 0 && alive > 0) alive -= 1;
      const spawns = scheduler.step({ nowMs, player, view, alive });
      alive += spawns.length;
      spawned += spawns.length;
      expect(alive).toBeLessThanOrEqual(cap);
    }

    expect(spawned).toBe(scheduler.total);
    expect(scheduler.isCleared(alive)).toBe(false);
    expect(scheduler.isCleared(0)).toBe(true);
  });

  it('walks the room’s own role mix, elites included', () => {
    const level = normalRoom(1, 7); // the chapter-1 room authored with an elite caster
    const scheduler = new WaveScheduler(level, 3);
    const player = level.playerStart;
    const view = viewAround(player, level);
    const roles = new Set<string>();
    let alive = 0;

    for (let nowMs = 0; nowMs < 300_000 && scheduler.spawned < scheduler.total; nowMs += 100) {
      for (const spawn of scheduler.step({ nowMs, player, view, alive })) {
        alive += 1;
        roles.add(`${spawn.role}${spawn.elite ? '*' : ''}`);
      }
      if (nowMs % 500 === 0 && alive > 0) alive -= 1;
    }

    const authored = level.waves.flatMap((wave) =>
      wave.enemies.map((enemy) => `${enemy.role}${enemy.elite ? '*' : ''}`),
    );
    for (const role of authored) expect(roles.has(role), role).toBe(true);
  });

  it('spawns on free ground, evenly spread, at least the minimum distance from the player', () => {
    const level = normalRoom(2);
    const scheduler = new WaveScheduler(level, 5);
    const player = level.playerStart;
    const view = viewAround(player, level);
    const points: Vec2[] = [];
    let alive = 0;

    for (let nowMs = 0; nowMs < 300_000 && scheduler.spawned < scheduler.total; nowMs += 100) {
      for (const spawn of scheduler.step({ nowMs, player, view, alive })) {
        points.push(spawn.at);
        alive += 1;
        expect(obstacleAt(level, spawn.at), JSON.stringify(spawn.at)).toBeNull();
        expect(distance(spawn.at, player)).toBeGreaterThanOrEqual(
          WAVES_TUNING.minSpawnDistanceTiles,
        );
      }
      if (nowMs % 400 === 0 && alive > 0) alive -= 1;
    }

    const distinct = new Set(points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`));
    expect(distinct.size).toBeGreaterThan(Math.min(8, points.length));
  });

  it('only an on-screen spawn asks for a telegraph', () => {
    const level = normalRoom(1);
    const scheduler = new WaveScheduler(level, 9);
    const player = { x: level.size.cols / 2, y: level.size.rows / 2 };
    // A room-sized view: every spawn is visible and therefore needs its telegraph.
    const everything = { x: 0, y: 0, width: level.size.cols, height: level.size.rows };
    const spawns = scheduler.step({ nowMs: 0, player, view: everything, alive: 0 });
    expect(spawns.length).toBeGreaterThan(0);
    for (const spawn of spawns) expect(spawn.telegraphMs).toBe(WAVES_TUNING.telegraphMs);
  });

  it('enemyStateFromSpawn applies chapter health and waits a cooldown', () => {
    const level = normalRoom(1);
    const state = enemyStateFromSpawn(
      level,
      { role: 'tank', elite: false, at: { x: 4, y: 4 }, telegraphMs: 0 },
      3,
      12_000,
    );
    expect(state.id).toBe('r1-s3');
    expect(state.health).toBeGreaterThan(1);
    expect(state.actionStartedMs).toBe(12_000);
  });
});

describe('decideAction with a view', () => {
  const level = normalRoom(1);
  const empty = { ...level, obstacles: [] } as LevelData;

  it('a far off-screen enemy idles instead of walking across the room', () => {
    const player = { x: 64, y: 36 };
    const far = { x: player.x + WAVES_TUNING.aggroRadiusTiles + 5, y: player.y };
    const view = viewAround(player, empty);
    const next = decideAction({ state: chaserAt(far), player, nowMs: 0, level: empty, view });
    expect(next.kind).toBe('idle');
  });

  it('an off-screen enemy inside the aggro radius still walks in', () => {
    const player = { x: 64, y: 36 };
    const near = { x: player.x + 12, y: player.y };
    const view = viewAround(player, empty);
    const next = decideAction({ state: chaserAt(near), player, nowMs: 0, level: empty, view });
    expect(next.kind).toBe('walk');
  });

  it('a charging enemy keeps its charge even when it starts the frame off screen', () => {
    const player = { x: 64, y: 36 };
    const far = { x: 4, y: 4 };
    const view = viewAround(player, empty);
    const charge: EnemyState['action'] = {
      kind: 'charge',
      direction: { x: 1, y: 1 },
      untilMs: 5_000,
      speedTilesPerSecond: 7,
      followUps: 0,
    };
    const next = decideAction({
      state: chaserAt(far, charge),
      player,
      nowMs: 1_000,
      level: empty,
      view,
    });
    expect(next.kind).toBe('charge');
  });

  it('a caster that leaves the view while telegraphing does not fire from off screen', () => {
    const player = { x: 64, y: 36 };
    const view = viewAround(player, empty);
    const caster: EnemyState = {
      id: 'caster',
      role: 'caster',
      elite: false,
      position: { x: 90, y: 36 }, // walked out of the right edge while winding up
      health: 4,
      maxHealth: 4,
      action: { kind: 'telegraph', sinceMs: 0 },
      actionStartedMs: 0,
    };
    const next = decideAction({
      state: caster,
      player,
      nowMs: ENEMY_TUNING.roles.caster.telegraphMs,
      level: empty,
      view,
    });
    // The telegraph is over, but a release here would put a shot on screen from outside it.
    expect(attackReleased(caster.action, next)).toBeNull();
    expect(next.kind).toBe('walk');
  });

  it('without a view the decision is the pre-#41 one (far chaser walks)', () => {
    const player = { x: 64, y: 36 };
    const far = { x: 4, y: 4 };
    const next = decideAction({ state: chaserAt(far), player, nowMs: 0, level: empty });
    expect(next.kind).toBe('walk');
  });
});

describe('canAttackFrom and arrows', () => {
  const view = { x: 40, y: 20, width: 32, height: 18 };

  it('honours the inset on every edge', () => {
    expect(canAttackFrom({ x: 41, y: 29 }, view)).toBe(true);
    expect(canAttackFrom({ x: 71, y: 29 }, view)).toBe(true);
    expect(canAttackFrom({ x: 72, y: 29 }, view)).toBe(false);
    expect(canAttackFrom({ x: 56, y: 20.5 }, view)).toBe(false);
    expect(canAttackFrom({ x: 56, y: 37 }, view)).toBe(true);
    expect(canAttackFrom({ x: 72, y: 29 }, view, 0)).toBe(true);
  });

  it('never points at an on-screen door once the room is cleared', () => {
    const player = { x: 56, y: 29 };
    const insideDoor = { x: 60, y: 30 };
    const outsideDoor = { x: 120, y: 60 };
    expect(edgeArrowTargets(player, view, [], [insideDoor, outsideDoor], true)).toEqual([
      outsideDoor,
    ]);
  });

  it('is limited by max', () => {
    const player = { x: 56, y: 29 };
    const enemies = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
      { x: 30, y: 30 },
    ];
    expect(edgeArrowTargets(player, view, enemies, [], false, 2)).toHaveLength(2);
    expect(edgeArrowTargets(player, view, enemies, [], false, 0)).toEqual([]);
  });
});
