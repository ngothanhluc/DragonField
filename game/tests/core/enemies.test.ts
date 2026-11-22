import { describe, expect, it } from 'vitest';
import { BulletPool, firstHit, hitsCircle } from '../../assets/scripts/core/combat/bullets';
import {
  TELEGRAPH_MS,
  isTelegraphComplete,
  telegraphProgress,
} from '../../assets/scripts/core/combat/telegraph';
import {
  CASTER_MAX_RANGE_TILES,
  TANK_CHARGE_DURATION_MS,
  attackReleased,
  contactDamageFor,
  decideAction,
  maxHealthFor,
  speedFor,
  type EnemyAction,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import {
  isWaveCleared,
  nextWaveIndex,
  spawnWave,
} from '../../assets/scripts/core/enemies/waves';
import { ENEMY_TUNING } from '../../assets/scripts/core/enemies/tuning';
import {
  parseLevelData,
  type EnemyRole,
  type LevelData,
  type Obstacle,
} from '../../assets/scripts/core/level/level-data';
import { distance } from '../../assets/scripts/core/math/vec2';

/**
 * Test room 32×18 with 3 waves: [chaser ×2], [caster elite], [tank].
 * Built through `parseLevelData` so the test uses the real data contract, not a
 * hand-rolled `LevelData` that could drift from the schema.
 */
function makeLevel(obstacles: readonly Obstacle[] = []): LevelData {
  return parseLevelData({
    id: 'test-room',
    chapter: 1,
    room: 3,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 16, y: 16 },
    waves: [
      {
        enemies: [
          { role: 'chaser', at: { x: 3, y: 3 }, elite: false },
          { role: 'chaser', at: { x: 28, y: 3 }, elite: false },
        ],
      },
      { enemies: [{ role: 'caster', at: { x: 29, y: 2 }, elite: true }] },
      { enemies: [{ role: 'tank', at: { x: 16, y: 2 }, elite: false }] },
    ],
    obstacles: [...obstacles],
    doors: [],
  });
}

const level = makeLevel();

interface EnemyOptions {
  readonly role: EnemyRole;
  readonly x: number;
  readonly y: number;
  readonly elite?: boolean;
  readonly health?: number;
  readonly action?: EnemyAction;
  readonly actionStartedMs?: number;
}

function enemy(options: EnemyOptions): EnemyState {
  const elite = options.elite ?? false;
  const maxHealth = maxHealthFor(options.role, elite);
  return {
    id: `test-${options.role}`,
    role: options.role,
    elite,
    position: { x: options.x, y: options.y },
    health: options.health ?? maxHealth,
    maxHealth,
    action: options.action ?? { kind: 'idle' },
    actionStartedMs: options.actionStartedMs ?? 0,
  };
}

describe('enemy behaviours — chaser', () => {
  it('moves toward the player so the distance shrinks', () => {
    const state = enemy({ role: 'chaser', x: 2, y: 5 });
    const player = { x: 20, y: 5 };

    const action = decideAction({ state, player, nowMs: 0, level });

    expect(action.kind).toBe('walk');
    if (action.kind !== 'walk') return;

    expect(distance(action.target, player)).toBeLessThan(distance(state.position, player));
    expect(speedFor('chaser', false)).toBeGreaterThan(0);
  });

  it('stands still once it touches the player', () => {
    const action = decideAction({
      state: enemy({ role: 'chaser', x: 10, y: 5 }),
      player: { x: 10.2, y: 5 },
      nowMs: 0,
      level,
    });

    expect(action).toEqual({ kind: 'idle' });
  });
});

describe('enemy behaviours — caster', () => {
  it('backs off when the player is closer than 4 tiles', () => {
    const state = enemy({ role: 'caster', x: 6, y: 5 });
    const player = { x: 5, y: 5 };

    const action = decideAction({ state, player, nowMs: 0, level });

    expect(action.kind).toBe('walk');
    if (action.kind !== 'walk') return;

    const before = distance(state.position, player);
    const after = distance(action.target, player);
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(CASTER_MAX_RANGE_TILES);
  });

  it('steps in when the player is farther than 6 tiles', () => {
    const state = enemy({ role: 'caster', x: 25, y: 5 });
    const player = { x: 5, y: 5 };

    const action = decideAction({ state, player, nowMs: 0, level });

    expect(action.kind).toBe('walk');
    if (action.kind !== 'walk') return;

    expect(distance(action.target, player)).toBeLessThan(distance(state.position, player));
    expect(distance(action.target, player)).toBeCloseTo(CASTER_MAX_RANGE_TILES);
  });

  it('telegraphs before firing, and an attack in telegraph runs to completion', () => {
    const player = { x: 5, y: 5 };
    // Cooldown derived from tuning (#66 retuned it); the timestamp only has to be past it.
    const start = ENEMY_TUNING.roles.caster.attackCooldownMs;
    const state = enemy({ role: 'caster', x: 10, y: 5 });

    // 5 tiles: inside 4–6, cooldown already elapsed.
    const telegraph = decideAction({ state, player, nowMs: start, level });
    expect(telegraph).toEqual({ kind: 'telegraph', sinceMs: start });

    const telegraphing: EnemyState = { ...state, action: telegraph, actionStartedMs: start };

    const justBefore = decideAction({
      state: telegraphing,
      player,
      nowMs: start + TELEGRAPH_MS.caster - 1,
      level,
    });
    expect(justBefore).toEqual({ kind: 'telegraph', sinceMs: start });

    // Player backs far away: the telegraph must still finish.
    const playerFled = { x: 30, y: 5 };
    const fired = decideAction({
      state: telegraphing,
      player: playerFled,
      nowMs: start + TELEGRAPH_MS.caster,
      level,
    });
    expect(fired).toEqual({ kind: 'idle' });
    expect(attackReleased(telegraph, fired)).toBe('shot');
  });

  it('does not fire again right after the previous shot — waits for the cooldown', () => {
    const player = { x: 5, y: 5 };
    const cooldownMs = ENEMY_TUNING.roles.caster.attackCooldownMs;
    const state = enemy({ role: 'caster', x: 10, y: 5, actionStartedMs: 1000 });

    // Exactly one cooldown after the last shot: idle before it, telegraph at it.
    expect(decideAction({ state, player, nowMs: 1000 + cooldownMs - 1, level })).toEqual({
      kind: 'idle',
    });
    expect(decideAction({ state, player, nowMs: 1000 + cooldownMs, level }).kind).toBe('telegraph');
  });

  it('closes the distance when the spacing point falls inside an obstacle', () => {
    const blockedLevel = makeLevel([{ kind: 'pillar', x: 18, y: 2, width: 2, height: 2 }]);
    const state = enemy({ role: 'caster', x: 15, y: 3 });
    const player = { x: 13, y: 3 };

    // Player is right next (2 tiles < 4) so the caster backs off; the retreat point 6 tiles from the player
    // falls exactly on the pillar at x = 18..20.
    const action = decideAction({
      state,
      player,
      nowMs: 0,
      level: blockedLevel,
    });

    // No stand-off spot exists there, so approach instead of standing on the spot: a `walk` whose
    // target is the walker's own position reports "walking" forever while moving nowhere (the stuck
    // guard then detours in circles). The range band stops the walk again once it is close enough.
    expect(action).toEqual({ kind: 'walk', target: { x: player.x, y: player.y } });
  });
});

describe('enemy behaviours — tank', () => {
  it('walks when the player is outside charge range', () => {
    const state = enemy({ role: 'tank', x: 2, y: 16 });
    const action = decideAction({ state, player: { x: 2, y: 2 }, nowMs: 0, level });

    expect(action.kind).toBe('walk');
  });

  it('telegraphs for 700 ms then charges straight, and rests when the charge ends', () => {
    const player = { x: 10, y: 9 };
    const state = enemy({ role: 'tank', x: 10, y: 14 });
    // The tank's first telegraph opens exactly when its attack cooldown runs out (#66 retuned it
    // to 1600 ms); derive the start from tuning instead of hardcoding the old 900.
    const start = ENEMY_TUNING.roles.tank.attackCooldownMs;

    expect(decideAction({ state, player, nowMs: start - 1, level })).toEqual({ kind: 'idle' });

    const telegraph = decideAction({ state, player, nowMs: start, level });
    expect(telegraph).toEqual({ kind: 'telegraph', sinceMs: start });

    const telegraphing: EnemyState = { ...state, action: telegraph, actionStartedMs: start };
    expect(
      decideAction({ state: telegraphing, player, nowMs: start + TELEGRAPH_MS.tank - 1, level }),
    ).toEqual(telegraph);

    const charge = decideAction({
      state: telegraphing,
      player,
      nowMs: start + TELEGRAPH_MS.tank,
      level,
    });
    expect(charge.kind).toBe('charge');
    if (charge.kind !== 'charge') return;

    expect(charge.direction).toEqual({ x: 0, y: -1 });
    expect(charge.untilMs).toBe(start + TELEGRAPH_MS.tank + TANK_CHARGE_DURATION_MS);
    expect(attackReleased(telegraph, charge)).toBe('charge');

    // Player dodges sideways: the charge direction was locked and does not follow.
    const charging: EnemyState = { ...telegraphing, action: charge };
    expect(
      decideAction({
        state: charging,
        player: { x: 25, y: 9 },
        nowMs: charge.untilMs - 1,
        level,
      }),
    ).toEqual(charge);

    expect(decideAction({ state: charging, player, nowMs: charge.untilMs, level })).toEqual({
      kind: 'idle',
    });
  });
});

describe('enemy behaviours — pure contract', () => {
  it('same input at the same nowMs gives the same action, without mutating state', () => {
    const state = enemy({ role: 'caster', x: 10, y: 5 });
    const before = JSON.stringify(state);

    const first = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 5000, level });
    const second = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 5000, level });

    expect(second).toEqual(first);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('dead is final, no resurrection', () => {
    const dead = decideAction({
      state: enemy({ role: 'chaser', x: 2, y: 2, action: { kind: 'dead' }, health: 3 }),
      player: { x: 20, y: 2 },
      nowMs: 10_000,
      level,
    });
    expect(dead).toEqual({ kind: 'dead' });

    const killed = decideAction({
      state: enemy({ role: 'tank', x: 2, y: 2, health: 0 }),
      player: { x: 20, y: 2 },
      nowMs: 10_000,
      level,
    });
    expect(killed).toEqual({ kind: 'dead' });
  });

  it('elites only change health and damage, not speed', () => {
    for (const role of ['chaser', 'caster', 'tank'] as const) {
      expect(speedFor(role, true)).toBe(speedFor(role, false));
      expect(contactDamageFor(role, true)).toBeGreaterThan(contactDamageFor(role, false));
      expect(maxHealthFor(role, true)).toBeGreaterThan(maxHealthFor(role, false));
    }
  });
});

describe('telegraph', () => {
  it('progress 0 at the start, 1 at the end, clamped outside the window', () => {
    expect(telegraphProgress(1000, 1000, 'caster')).toBe(0);
    expect(telegraphProgress(1000, 1250, 'caster')).toBe(0.5);
    expect(telegraphProgress(1000, 1500, 'caster')).toBe(1);
    expect(telegraphProgress(1000, 9000, 'caster')).toBe(1);
    expect(telegraphProgress(1000, 0, 'caster')).toBe(0);
  });

  it('isTelegraphComplete is correct at each boundary', () => {
    expect(isTelegraphComplete(1000, 1000 + TELEGRAPH_MS.caster - 1, 'caster')).toBe(false);
    expect(isTelegraphComplete(1000, 1000 + TELEGRAPH_MS.caster, 'caster')).toBe(true);
    expect(isTelegraphComplete(0, TELEGRAPH_MS.tank, 'tank')).toBe(true);
    expect(isTelegraphComplete(0, TELEGRAPH_MS.boss, 'boss')).toBe(true);
    expect(TELEGRAPH_MS.boss).toBe(800);
  });
});

describe('BulletPool', () => {
  const base = {
    radiusTiles: 0.1,
    damage: 1,
    owner: 'player' as const,
    ttlMs: 1000,
  };

  it('flies exactly velocity × delta', () => {
    const pool = new BulletPool(4);
    pool.spawn({ ...base, position: { x: 1, y: 1 }, velocity: { x: 6, y: -3 } });

    pool.update(500);

    const [bullet] = pool.snapshot();
    expect(bullet?.position).toEqual({ x: 4, y: -0.5 });
    expect(bullet?.ttlMs).toBe(500);
  });

  it('retires projectiles past their ttl', () => {
    const pool = new BulletPool(4);
    pool.spawn({ ...base, position: { x: 0, y: 0 }, velocity: { x: 1, y: 0 }, ttlMs: 100 });

    pool.update(60);
    expect(pool.active()).toHaveLength(1);

    pool.update(40);
    expect(pool.active()).toHaveLength(0);
  });

  it('at capacity it retires the oldest projectile, without growing the array', () => {
    const pool = new BulletPool(3);

    for (let damage = 1; damage <= 5; damage += 1) {
      pool.spawn({ ...base, position: { x: damage, y: 0 }, velocity: { x: 0, y: 0 }, damage });
    }

    expect(pool.active()).toHaveLength(3);
    expect(pool.snapshot().map((bullet) => bullet.damage)).toEqual([3, 4, 5]);
    expect(pool.snapshot().map((bullet) => bullet.id)).toEqual([3, 4, 5]);
  });

  it('a snapshot is a copy, later updates do not change it', () => {
    const pool = new BulletPool(2);
    pool.spawn({ ...base, position: { x: 0, y: 0 }, velocity: { x: 4, y: 0 }, ttlMs: 2000 });

    const snapshot = pool.snapshot();
    pool.update(1000);

    expect(snapshot[0]?.position).toEqual({ x: 0, y: 0 });
    expect(pool.snapshot()[0]?.position).toEqual({ x: 4, y: 0 });
  });

  it('clear retires everything', () => {
    const pool = new BulletPool(2);
    pool.spawn({ ...base, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } });

    pool.clear();

    expect(pool.active()).toHaveLength(0);
    expect(pool.size).toBe(0);
  });
});

describe('hitsCircle', () => {
  it('touching exactly one point still counts as a hit, slightly beyond is a miss', () => {
    const a = { position: { x: 0, y: 0 }, radiusTiles: 0.5 };

    expect(hitsCircle(a, { position: { x: 1, y: 0 }, radiusTiles: 0.5 })).toBe(true);
    expect(hitsCircle(a, { position: { x: 1.0001, y: 0 }, radiusTiles: 0.5 })).toBe(false);
    expect(hitsCircle(a, { position: { x: 0.6, y: 0.6 }, radiusTiles: 0.25 })).toBe(false);
  });
});

describe('firstHit', () => {
  const withObstacles = makeLevel([
    { kind: 'pillar', x: 10, y: 4, width: 2, height: 2 },
    { kind: 'pillar', x: 15, y: 4, width: 2, height: 2 },
  ]);

  it('stops at the first obstacle on the projectile path', () => {
    const hit = firstHit({ from: { x: 5, y: 5 }, to: { x: 20, y: 5 } }, withObstacles);
    expect(hit).not.toBeNull();
    if (hit === null) return;

    expect(hit.obstacle.x).toBe(10);
    expect(hit.point.x).toBeGreaterThanOrEqual(10);
    expect(hit.point.x).toBeLessThan(10 + 0.25);
    expect(hit.progress).toBeCloseTo((hit.point.x - 5) / 15);
  });

  it('returns null when the path hits nothing', () => {
    expect(firstHit({ from: { x: 5, y: 2 }, to: { x: 20, y: 2 } }, withObstacles)).toBeNull();
  });

  it('hitting at the start point gives progress 0', () => {
    const hit = firstHit({ from: { x: 10.5, y: 5 }, to: { x: 20, y: 5 } }, withObstacles);
    expect(hit?.progress).toBe(0);
  });

  it('flies over a pit (only pillars and walls stop a projectile)', () => {
    const withPit = makeLevel([{ kind: 'pit', x: 10, y: 4, width: 2, height: 2 }]);

    expect(firstHit({ from: { x: 5, y: 5 }, to: { x: 20, y: 5 } }, withPit)).toBeNull();
  });

  it('catches a corner grazed diagonally instead of stepping over it', () => {
    // A 1×0.5 prop collider: the segment crosses its top-right corner for ~0.06 tiles, which is
    // shorter than any sampling step. This is the exact geometry that stalled a room (#66):
    // the caster behind the crate saw the player, every player bullet hit the crate.
    const withCrate = makeLevel([{ kind: 'prop', x: 27, y: 13, width: 1, height: 0.5 }]);

    const hit = firstHit({ from: { x: 32, y: 16 }, to: { x: 27.41, y: 12.6 } }, withCrate);
    expect(hit).not.toBeNull();
    expect(hit?.obstacle.x).toBe(27);
    expect(hit?.progress).toBeGreaterThan(0.8);
  });
});

describe('waves', () => {
  it('ids are deterministic and unique, respawning gives the same result', () => {
    const all = [0, 1, 2].flatMap((index) => spawnWave(level, index));
    const ids = all.map((state) => state.id);

    expect(ids).toEqual(['r3-w0-e0', 'r3-w0-e1', 'r3-w1-e0', 'r3-w2-e0']);
    expect(new Set(ids).size).toBe(ids.length);
    expect(spawnWave(level, 0)).toEqual(spawnWave(level, 0));
  });

  it('elites have more health than the regular version', () => {
    const [normal] = spawnWave(level, 0);
    const [elite] = spawnWave(level, 1);

    expect(normal?.elite).toBe(false);
    expect(elite?.elite).toBe(true);
    expect(elite?.maxHealth).toBeGreaterThan(normal?.maxHealth ?? 0);
    expect(elite?.health).toBe(elite?.maxHealth);
  });

  it('an out-of-range waveIndex throws', () => {
    expect(() => spawnWave(level, 3)).toThrow();
  });

  it('a wave is clear only when every enemy is dead', () => {
    const states = spawnWave(level, 0);
    expect(isWaveCleared(states)).toBe(false);

    const [first, second] = states;
    if (first === undefined || second === undefined) throw new Error('wave 0 must have 2 enemies');

    expect(isWaveCleared([{ ...first, health: 0 }, second])).toBe(false);
    expect(
      isWaveCleared([
        { ...first, health: 0 },
        { ...second, action: { kind: 'dead' } },
      ]),
    ).toBe(true);
    expect(isWaveCleared([])).toBe(true);
  });

  it('nextWaveIndex returns null on the last wave', () => {
    expect(nextWaveIndex(0, level)).toBe(1);
    expect(nextWaveIndex(1, level)).toBe(2);
    expect(nextWaveIndex(2, level)).toBeNull();
    expect(() => nextWaveIndex(-1, level)).toThrow();
  });
});
