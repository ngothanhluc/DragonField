import { describe, expect, it } from 'vitest';
import { TELEGRAPH_MS, telegraphProgress } from '../../assets/scripts/core/combat/telegraph';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import {
  ELITE_EXTRA_TANK_CHARGES,
  ELITE_POUNCE_COOLDOWN_MS,
  ELITE_POUNCE_DURATION_MS,
  ELITE_POUNCE_RANGE_TILES,
  ELITE_POUNCE_SPEED_TILES_PER_SECOND,
  ELITE_POUNCE_TELEGRAPH_MS,
  TANK_CHARGE_DURATION_MS,
  TANK_CHARGE_SPEED_TILES_PER_SECOND,
  attackReleased,
  decideAction,
  staggerAction,
  type EnemyAction,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import { eliteExtraCharges, eliteScale } from '../../assets/scripts/core/enemies/elite';
import { ENEMY_TUNING, TUNING_SOURCE, parseTuning } from '../../assets/scripts/core/enemies/tuning';
import { parseLevelData, type EnemyRole } from '../../assets/scripts/core/level/level-data';

const level = parseLevelData({
  id: 'elite-room',
  chapter: 1,
  room: 1,
  isBossRoom: false,
  size: { cols: 32, rows: 18 },
  tileSizePx: 16,
  playerStart: { x: 16, y: 16 },
  waves: [{ enemies: [{ role: 'chaser', at: { x: 3, y: 3 }, elite: false }] }],
  obstacles: [],
  doors: [],
});

function enemyState(
  role: EnemyRole,
  position: { x: number; y: number },
  elite: boolean,
  overrides: Partial<EnemyState> = {},
): EnemyState {
  return {
    id: `elite-${role}`,
    role,
    elite,
    position,
    health: 10,
    maxHealth: 10,
    action: { kind: 'idle' },
    actionStartedMs: 0,
    ...overrides,
  };
}

function cloneSource(): Record<string, unknown> {
  return structuredClone(TUNING_SOURCE) as Record<string, unknown>;
}

describe('elite — numbers and scale from config/tuning.json', () => {
  it('elite scale comes from the JSON (GDD §4: 1.15)', () => {
    const raw = cloneSource().enemies as { elite: { scale: number } };
    expect(eliteScale()).toBe(raw.elite.scale);
    expect(eliteScale()).toBeCloseTo(1.15);
  });

  it('elite tank has 1 extra charge; chaser/caster have none', () => {
    expect(eliteExtraCharges('tank', true)).toBe(ELITE_EXTRA_TANK_CHARGES);
    expect(eliteExtraCharges('tank', true)).toBe(1);
    expect(eliteExtraCharges('tank', false)).toBe(0);
    expect(eliteExtraCharges('chaser', true)).toBe(0);
    expect(eliteExtraCharges('caster', true)).toBe(0);
  });
});

describe('elite chaser — extra attack: short pounce', () => {
  it('a regular chaser never telegraphs, only walks/stands', () => {
    const state = enemyState('chaser', { x: 8, y: 5 }, false);
    const action = decideAction({ state, player: { x: 16, y: 5 }, nowMs: 5000, level });
    expect(action.kind).toBe('walk');
  });

  it('an elite in range telegraphs then pounces, at the speed/duration from the JSON', () => {
    const player = { x: 8 + ELITE_POUNCE_RANGE_TILES - 1, y: 5 };
    const state = enemyState('chaser', { x: 8, y: 5 }, true);

    const telegraph = decideAction({ state, player, nowMs: ELITE_POUNCE_COOLDOWN_MS + 1, level });
    expect(telegraph).toEqual({ kind: 'telegraph', sinceMs: ELITE_POUNCE_COOLDOWN_MS + 1 });

    const telegraphing = {
      ...state,
      action: telegraph,
      actionStartedMs: ELITE_POUNCE_COOLDOWN_MS + 1,
    };
    const start = ELITE_POUNCE_COOLDOWN_MS + 1;

    // Telegraph not finished yet: still standing.
    expect(
      decideAction({ state: telegraphing, player, nowMs: start + ELITE_POUNCE_TELEGRAPH_MS - 1, level }),
    ).toEqual(telegraph);

    const charge = decideAction({
      state: telegraphing,
      player,
      nowMs: start + ELITE_POUNCE_TELEGRAPH_MS,
      level,
    });
    expect(charge.kind).toBe('charge');
    if (charge.kind !== 'charge') return;

    expect(charge.speedTilesPerSecond).toBe(ELITE_POUNCE_SPEED_TILES_PER_SECOND);
    expect(charge.untilMs).toBe(start + ELITE_POUNCE_TELEGRAPH_MS + ELITE_POUNCE_DURATION_MS);
    expect(charge.followUps).toBe(0);
    expect(attackReleased(telegraph, charge)).toBe('charge');
  });

  it('elite chaser telegraph uses the exact duration and progress 0..1', () => {
    expect(TELEGRAPH_MS.chaser).toBe(ELITE_POUNCE_TELEGRAPH_MS);
    expect(telegraphProgress(1000, 1000, 'chaser')).toBe(0);
    expect(telegraphProgress(1000, 1000 + ELITE_POUNCE_TELEGRAPH_MS / 2, 'chaser')).toBeCloseTo(0.5);
    expect(telegraphProgress(1000, 1000 + ELITE_POUNCE_TELEGRAPH_MS, 'chaser')).toBe(1);
  });

  it('outside pounce range it still only walks', () => {
    const state = enemyState('chaser', { x: 2, y: 5 }, true);
    const action = decideAction({
      state,
      player: { x: 2 + ELITE_POUNCE_RANGE_TILES + 2, y: 5 },
      nowMs: 10_000,
      level,
    });
    expect(action.kind).toBe('walk');
  });
});

describe('elite tank — extra attack: a second charge, locking a new direction', () => {
  it('the first charge has followUps = 1; after it, charge again toward the new player position', () => {
    const player = { x: 10, y: 5 };
    const state = enemyState('tank', { x: 10, y: 14 }, true, {
      action: { kind: 'telegraph', sinceMs: 1000 },
      actionStartedMs: 1000,
    });

    const first = decideAction({ state, player, nowMs: 1000 + ENEMY_TUNING.roles.tank.telegraphMs, level });
    expect(first.kind).toBe('charge');
    if (first.kind !== 'charge') return;
    expect(first.direction).toEqual({ x: 0, y: -1 });
    expect(first.followUps).toBe(ELITE_EXTRA_TANK_CHARGES);

    const charging = { ...state, action: first };
    // Player dodges to the right while the first charge runs.
    const playerAfterDodge = { x: 16, y: 5 };

    // Mid-charge: keeps the direction (does not track the player).
    const halfway = decideAction({
      state: charging,
      player: playerAfterDodge,
      nowMs: first.untilMs - 1,
      level,
    });
    expect(halfway).toMatchObject({ kind: 'charge', direction: { x: 0, y: -1 } });

    // First charge over: second charge, direction re-locked onto the new player position.
    const second = decideAction({
      state: charging,
      player: playerAfterDodge,
      nowMs: first.untilMs,
      level,
    });
    expect(second.kind).toBe('charge');
    if (second.kind !== 'charge') return;

    expect(second.followUps).toBe(0);
    expect(second.direction.x).toBeGreaterThan(0);
    expect(second.untilMs).toBe(first.untilMs + TANK_CHARGE_DURATION_MS);
    expect(second.speedTilesPerSecond).toBe(TANK_CHARGE_SPEED_TILES_PER_SECOND);
    // charge -> charge emits no extra "attack released" event for the adapter.
    expect(attackReleased(first, second)).toBeNull();

    const secondCharge = { ...charging, action: second };
    expect(
      decideAction({ state: secondCharge, player: playerAfterDodge, nowMs: second.untilMs, level }),
    ).toEqual({ kind: 'idle' });
  });

  it('a regular tank only charges once', () => {
    const player = { x: 10, y: 5 };
    const state = enemyState('tank', { x: 10, y: 14 }, false, {
      action: { kind: 'telegraph', sinceMs: 1000 },
      actionStartedMs: 1000,
    });
    const charge = decideAction({
      state,
      player,
      nowMs: 1000 + ENEMY_TUNING.roles.tank.telegraphMs,
      level,
    });
    expect(charge.kind).toBe('charge');
    if (charge.kind !== 'charge') return;
    expect(charge.followUps).toBe(0);
  });
});

describe('stagger — hit by a projectile it stands still and does not finish the telegraph', () => {
  it('a caster mid-telegraph that gets hit: stagger action, no shot fired', () => {
    const player = { x: 5, y: 5 };
    const telegraph: EnemyAction = { kind: 'telegraph', sinceMs: 1000 };
    const state = enemyState('caster', { x: 10, y: 5 }, false, {
      action: telegraph,
      actionStartedMs: 1000,
    });

    const stagger = staggerAction(1200, DEFAULT_COMBAT.enemyStaggerMs);
    expect(stagger).toEqual({ kind: 'stagger', untilMs: 1350 });

    const staggered = { ...state, action: stagger };
    // During the stun: holds, does not move.
    expect(decideAction({ state: staggered, player, nowMs: 1300, level })).toEqual(stagger);
    // Telegraph -> stagger is not a "shot".
    expect(attackReleased(telegraph, stagger)).toBeNull();

    // Stun over: back to normal behaviour; the cooldown counts from the stagger so it is still idle.
    expect(decideAction({ state: staggered, player, nowMs: 1350, level })).toEqual({ kind: 'idle' });
  });

  it('stagger does not stop an enemy from dying', () => {
    const dead = enemyState('tank', { x: 10, y: 5 }, false, {
      action: { kind: 'stagger', untilMs: 5000 },
      health: 0,
    });
    expect(decideAction({ state: dead, player: { x: 1, y: 1 }, nowMs: 1000, level })).toEqual({
      kind: 'dead',
    });
  });
});

describe('elite — numbers read from the JSON, not hardcoded', () => {
  it('changing pounceRange in the JSON stops the elite chaser from pouncing', () => {
    const raw = cloneSource();
    const elite = (raw.enemies as { elite: { chaser: Record<string, unknown> } }).elite;
    elite.chaser.pounceRangeTiles = 0;
    const tuning = parseTuning(raw).enemies;

    const state = enemyState('chaser', { x: 8, y: 5 }, true);
    const action = decideAction({
      state,
      player: { x: 12, y: 5 },
      nowMs: 10_000,
      level,
      tuning,
    });

    expect(action.kind).toBe('walk');
  });

  it('changing extraCharges in the JSON makes the elite tank charge exactly that many more', () => {
    const raw = cloneSource();
    const elite = (raw.enemies as { elite: { tank: Record<string, unknown> } }).elite;
    elite.tank.extraCharges = 2;
    const tuning = parseTuning(raw).enemies;

    const state = enemyState('tank', { x: 10, y: 14 }, true, {
      action: { kind: 'telegraph', sinceMs: 1000 },
      actionStartedMs: 1000,
    });
    const charge = decideAction({
      state,
      player: { x: 10, y: 5 },
      nowMs: 1000 + tuning.roles.tank.telegraphMs,
      level,
      tuning,
    });

    expect(charge.kind).toBe('charge');
    if (charge.kind !== 'charge') return;
    expect(charge.followUps).toBe(2);
  });
});
