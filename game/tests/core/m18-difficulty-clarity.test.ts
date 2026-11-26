/**
 * M18 tests — Bullet-hell difficulty, zero enemy hit knockback/stagger, `dasher` & `gunner` AI
 * (normal + elite), wave escalation, i18n death causes, and combat visual clarity (ADR-026).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COMBAT_PROP_ALPHA,
  COMBAT_WEATHER_OPACITY_MAX,
  COMBAT_WEATHER_OPACITY_MIN,
  chapterAtmosphere,
  parseAtmosphereConfig,
  visibleAtmosphere,
} from '../../assets/scripts/core/atmosphere/atmosphere';
import {
  gunnerShotPlan,
  scheduleGunnerFollowUp,
  shootsProjectiles,
  stepPendingGunnerVolleys,
} from '../../assets/scripts/core/combat/enemy-fire';
import { startKnockback } from '../../assets/scripts/core/combat/knockback';
import { TELEGRAPH_MS } from '../../assets/scripts/core/combat/telegraph';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import {
  attackReleasedForRole,
  decideAction,
  maxHealthFor,
  staggerAfterHit,
  type EnemyAction,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import { ENEMY_TUNING, WAVES_TUNING } from '../../assets/scripts/core/enemies/tuning';
import {
  WaveScheduler,
  aliveCapForSlot,
  specialRoleMixForRoom,
} from '../../assets/scripts/core/enemies/wave-scheduler';
import { localizeEnemyRole } from '../../assets/scripts/core/i18n';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import {
  ENEMY_ROLES,
  parseLevelData,
  type EnemyRole,
  type LevelData,
} from '../../assets/scripts/core/level/level-data';
import { formatDeathCause } from '../../assets/scripts/core/run/run-summary';
import { xpForKill } from '../../assets/scripts/core/xp/xp-curve';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '..', '..', 'assets', 'resources', 'data');

function openRoom(chapter = 1): LevelData {
  return parseLevelData({
    id: `m18-room-ch${chapter}`,
    chapter,
    room: 1,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 16, y: 9 },
    waves: [{ enemies: [{ role: 'dasher', at: { x: 10, y: 9 }, elite: false }] }],
    obstacles: [],
    doors: [],
  });
}

function makeEnemy(
  role: EnemyRole,
  position: { x: number; y: number },
  overrides: Partial<EnemyState> = {},
): EnemyState {
  const elite = overrides.elite ?? false;
  const maxHealth = maxHealthFor(role, elite);
  return {
    id: overrides.id ?? `m18-${role}`,
    role,
    elite,
    position,
    health: overrides.health ?? maxHealth,
    maxHealth,
    action: overrides.action ?? { kind: 'idle' },
    actionStartedMs: overrides.actionStartedMs ?? 0,
  };
}

describe('M18 — zero enemy hit knockback & stagger (ADR-026)', () => {
  it('zeros enemy hit knockback and stagger in tuning while preserving hitstop and player knockback', () => {
    expect(DEFAULT_COMBAT.enemyKnockbackDistanceTiles).toBe(0);
    expect(DEFAULT_COMBAT.enemyKnockbackDurationMs).toBe(0);
    expect(DEFAULT_COMBAT.enemyStaggerMs).toBe(0);
    expect(DEFAULT_COMBAT.enemyHitstopMs).toBe(70);
    expect(DEFAULT_COMBAT.playerKnockbackDistanceTiles).toBeGreaterThan(0);
    expect(DEFAULT_COMBAT.playerKnockbackDurationMs).toBeGreaterThan(0);

    expect(
      startKnockback({ x: 10, y: 10 }, { x: 9, y: 10 }, {
        distanceTiles: DEFAULT_COMBAT.enemyKnockbackDistanceTiles,
        durationMs: DEFAULT_COMBAT.enemyKnockbackDurationMs,
      }),
    ).toBeNull();
  });

  it('staggerAfterHit with 0 ms leaves walk, telegraph, and charge actions untouched', () => {
    const walk: EnemyAction = { kind: 'walk', target: { x: 16, y: 9 } };
    const telegraph: EnemyAction = { kind: 'telegraph', sinceMs: 500 };
    const charge: EnemyAction = {
      kind: 'charge',
      direction: { x: 1, y: 0 },
      untilMs: 1200,
      speedTilesPerSecond: 9.5,
      followUps: 1,
    };

    expect(staggerAfterHit(walk, 600, DEFAULT_COMBAT.enemyStaggerMs)).toBe(walk);
    expect(staggerAfterHit(telegraph, 600, DEFAULT_COMBAT.enemyStaggerMs)).toBe(telegraph);
    expect(staggerAfterHit(charge, 600, DEFAULT_COMBAT.enemyStaggerMs)).toBe(charge);
  });
});

describe('M18 — dasher & gunner AI, telegraphs, elites, and i18n', () => {
  it('registers dasher and gunner in ENEMY_ROLES, TELEGRAPH_MS, XP table, and i18n', () => {
    expect(ENEMY_ROLES).toContain('dasher');
    expect(ENEMY_ROLES).toContain('gunner');
    expect(TELEGRAPH_MS.dasher).toBe(ENEMY_TUNING.roles.dasher.telegraphMs);
    expect(TELEGRAPH_MS.gunner).toBe(ENEMY_TUNING.roles.gunner.telegraphMs);
    expect(shootsProjectiles('gunner')).toBe(true);
    expect(shootsProjectiles('dasher')).toBe(false);
    expect(xpForKill('dasher', false)).toBeGreaterThan(0);
    expect(xpForKill('gunner', false)).toBeGreaterThan(0);

    expect(localizeEnemyRole('dasher', 'vi')).toBe('Ám Sát');
    expect(localizeEnemyRole('dasher', 'en')).toBe('Shadow Stalker');
    expect(localizeEnemyRole('gunner', 'vi')).toBe('Pháo Thủ Chùm');
    expect(localizeEnemyRole('gunner', 'en')).toBe('Volley Gunner');
    expect(formatDeathCause({ kind: 'enemy', role: 'dasher', elite: true }, 'vi')).toContain('Ám Sát');
    expect(formatDeathCause({ kind: 'enemy-bullet', role: 'gunner' }, 'en')).toContain('Volley Gunner');
  });

  it('dasher flanks diagonally outside 6 tiles, telegraphs in 3–6 tiles, and dashes; elite chains a second dash', () => {
    const level = openRoom(1);
    const player = { x: 16, y: 9 };

    // Far (> 6 tiles): walks with lateral flank target.
    const farDasher = makeEnemy('dasher', { x: 6, y: 9 });
    const farAction = decideAction({ state: farDasher, player, nowMs: 3000, level });
    expect(farAction.kind).toBe('walk');

    // Inside 3–6 tiles: starts telegraph.
    const midDasher = makeEnemy('dasher', { x: 11.5, y: 9 });
    const tele = decideAction({ state: midDasher, player, nowMs: 3000, level });
    expect(tele).toEqual({ kind: 'telegraph', sinceMs: 3000 });

    // After 350 ms telegraph: releases charge at 9.5 t/s for 280 ms (0 follow-ups for regular).
    const regularCharge = decideAction({
      state: { ...midDasher, action: tele, actionStartedMs: 3000 },
      player,
      nowMs: 3000 + ENEMY_TUNING.roles.dasher.telegraphMs,
      level,
    });
    expect(regularCharge.kind).toBe('charge');
    if (regularCharge.kind === 'charge') {
      expect(regularCharge.speedTilesPerSecond).toBe(ENEMY_TUNING.roles.dasher.chargeSpeedTilesPerSecond);
      expect(regularCharge.followUps).toBe(0);
    }
    expect(attackReleasedForRole('dasher', tele, regularCharge)).toBe('charge');

    // Elite dasher dashes twice (followUps = 1, re-locks onto moved player).
    const eliteDasher = makeEnemy('dasher', { x: 11.5, y: 9 }, { elite: true, action: tele, actionStartedMs: 3000 });
    const eliteFirst = decideAction({
      state: eliteDasher,
      player,
      nowMs: 3000 + ENEMY_TUNING.roles.dasher.telegraphMs,
      level,
    });
    expect(eliteFirst.kind).toBe('charge');
    if (eliteFirst.kind !== 'charge') return;
    expect(eliteFirst.followUps).toBe(1);

    const movedPlayer = { x: 16, y: 13 };
    const eliteSecond = decideAction({
      state: { ...eliteDasher, action: eliteFirst },
      player: movedPlayer,
      nowMs: eliteFirst.untilMs,
      level,
    });
    expect(eliteSecond.kind).toBe('charge');
    if (eliteSecond.kind === 'charge') {
      expect(eliteSecond.followUps).toBe(0);
      expect(eliteSecond.direction.y).toBeGreaterThan(0);
    }
  });

  it('gunner holds 5–7.4 tiles, fires 3-bullet fan in Ch1–2 and 5-bullet fan in Ch3–4; elite fires 2 staggered alternating volleys', () => {
    const level = openRoom(1);
    const player = { x: 16, y: 9 };

    // Inside band (6 tiles): telegraphs then releases 'shot'.
    const gunner = makeEnemy('gunner', { x: 10, y: 9 });
    const tele = decideAction({ state: gunner, player, nowMs: 3000, level });
    expect(tele).toEqual({ kind: 'telegraph', sinceMs: 3000 });

    const release = decideAction({
      state: { ...gunner, action: tele, actionStartedMs: 3000 },
      player,
      nowMs: 3000 + ENEMY_TUNING.roles.gunner.telegraphMs,
      level,
    });
    expect(release).toEqual({ kind: 'idle' });
    expect(attackReleasedForRole('gunner', tele, release)).toBe('shot');

    // Ch1–2: 3-bullet fan; Ch3–4: 5-bullet fan at 7.5 t/s.
    const ch1Plan = gunnerShotPlan(false, 1);
    expect(ch1Plan.angles).toHaveLength(3);
    expect(ch1Plan.speedTilesPerSecond).toBe(7.5);
    expect(ch1Plan.followUpDelayMs).toBeNull();

    const ch3Plan = gunnerShotPlan(false, 3);
    expect(ch3Plan.angles).toHaveLength(5);

    // Elite gunner schedules a staggered alternating second volley.
    const elitePlan = gunnerShotPlan(true, 3);
    expect(elitePlan.angles).toHaveLength(5);
    expect(elitePlan.followUpDelayMs).toBeGreaterThan(0);
    expect(elitePlan.followUpAngles).toHaveLength(5);
    expect(elitePlan.followUpAngles[0]).not.toBeCloseTo(elitePlan.angles[0]!, 5);

    const pending = scheduleGunnerFollowUp({
      enemyId: gunner.id,
      origin: gunner.position,
      aimTarget: player,
      damage: 27,
      plan: elitePlan,
      nowMs: 4000,
    });
    expect(pending).not.toBeNull();
    if (pending === null) return;
    expect(stepPendingGunnerVolleys([pending], 4100).triggered).toHaveLength(0);
    expect(stepPendingGunnerVolleys([pending], pending.triggerAtMs).triggered).toHaveLength(1);
  });

  it('WaveScheduler escalates aliveCap from 7 toward 30 and mixes dasher & gunner into rooms', () => {
    expect(WAVES_TUNING.aliveCapStart).toBe(7);
    expect(WAVES_TUNING.aliveCapStepPerRoom).toBe(4);
    expect(aliveCapForSlot(1)).toBe(7);
    expect(aliveCapForSlot(2)).toBe(11);
    expect(aliveCapForSlot(8)).toBe(30);

    expect(specialRoleMixForRoom(1, 2).dasherShare).toBeGreaterThan(0);
    expect(specialRoleMixForRoom(1, 2).gunnerShare).toBeGreaterThan(0);

    const ch3Room = chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, 'chapter-3'))).rooms.find(
      (room) => !room.isBossRoom,
    );
    if (ch3Room === undefined) throw new Error('missing ch3 normal room');
    const scheduler = new WaveScheduler(ch3Room, 18, 3);
    const seen = new Set<EnemyRole>();
    let alive = 0;
    const view = { x: 0, y: 0, width: 32, height: 18 };
    for (let nowMs = 0; nowMs < 300_000 && scheduler.spawned < scheduler.total; nowMs += 100) {
      for (const spawn of scheduler.step({ nowMs, player: ch3Room.playerStart, view, alive })) {
        seen.add(spawn.role);
        alive += 1;
      }
      if (nowMs % 400 === 0 && alive > 0) alive -= 1;
    }
    expect(seen.has('dasher')).toBe(true);
    expect(seen.has('gunner')).toBe(true);
  });
});

describe('M18 — combat visual clarity (0 living animals in combat, 30–40% weather alpha)', () => {
  it('disables wandering animals in combat rooms, mutes props to ~0.65, and bounds over-actor weather opacity to 30–40%', () => {
    const config = parseAtmosphereConfig(
      JSON.parse(readFileSync(join(DATA_DIR, 'atmosphere.json'), 'utf8')) as unknown,
    );

    for (const chapter of [1, 2, 3, 4]) {
      const atm = chapterAtmosphere(config, chapter);
      expect(atm).not.toBeNull();
      if (atm === null) continue;

      const combat = visibleAtmosphere(atm, 'full', { combat: true });
      expect(combat.animals, `ch${chapter} combat animals`).toBe(false);
      expect(combat.propAlpha, `ch${chapter} combat propAlpha`).toBeCloseTo(COMBAT_PROP_ALPHA, 5);

      // Village Hub / non-combat scenes keep animals available for M21.
      const hub = visibleAtmosphere(atm, 'full', { combat: false });
      expect(hub.animals, `ch${chapter} hub animals`).toBe(true);
      expect(hub.propAlpha, `ch${chapter} hub propAlpha`).toBe(1);

      for (const layer of atm.layers) {
        if (layer.depth === 'over-actors') {
          expect(layer.opacity).toBeGreaterThanOrEqual(COMBAT_WEATHER_OPACITY_MIN);
          expect(layer.opacity).toBeLessThanOrEqual(COMBAT_WEATHER_OPACITY_MAX);
        }
      }
    }
  });
});
