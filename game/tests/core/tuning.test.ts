import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import {
  ATTACK_COOLDOWN_MS,
  CASTER_MAX_RANGE_TILES,
  CASTER_MIN_RANGE_TILES,
  CHASER_CONTACT_RANGE_TILES,
  TANK_CHARGE_DURATION_MS,
  TANK_CHARGE_RANGE_TILES,
  contactDamageFor,
  decideAction,
  maxHealthFor,
  speedFor,
  visualScaleFor,
  type EnemyState,
} from '../../assets/scripts/core/enemies/behaviours';
import {
  CHARACTERS_TUNING,
  COMBAT_TUNING,
  ENEMY_TUNING,
  TUNING,
  TUNING_CHARACTER_IDS,
  TUNING_SOURCE,
  parseTuning,
  type EnemiesTuning,
} from '../../assets/scripts/core/enemies/tuning';
import { isTelegraphElapsed } from '../../assets/scripts/core/combat/telegraph';
import { parseLevelData, type EnemyRole } from '../../assets/scripts/core/level/level-data';

/**
 * `game/config/tuning.json` is the single source of balance numbers (AGENTS rule 3).
 * The generated module `enemies/tuning.generated.ts` is a print of it; `tuning-sync.test.ts`
 * locks the two together, while this suite locks both directions:
 *
 * 1. JSON → code: every `behaviours` function returns the number from the JSON.
 * 2. Change JSON → change behaviour: feed a mutated copy into `decideAction` and
 *    see the behaviour differ. If anyone hardcodes the numbers again, test 2 goes red.
 */

/** Deep copy of the source JSON to mutate without touching the exported object. */
function cloneSource(): Record<string, unknown> {
  return structuredClone(TUNING_SOURCE) as Record<string, unknown>;
}

function rolesOf(raw: Record<string, unknown>): Record<string, unknown> {
  const enemies = raw.enemies as Record<string, unknown>;
  return enemies.roles as Record<string, unknown>;
}

function roleOf(raw: Record<string, unknown>, role: EnemyRole): Record<string, unknown> {
  return rolesOf(raw)[role] as Record<string, unknown>;
}

/** Read one number field from the raw JSON, so tests need not cast the whole object. */
function numberAt(source: Record<string, unknown>, field: string): number {
  const value = source[field];
  if (typeof value !== 'number') throw new Error(`config/tuning.json: ${field} must be a number`);
  return value;
}

/** Replacement tuning set: parsed from a mutated copy, along the game's own path. */
function tuningWith(mutate: (raw: Record<string, unknown>) => void): EnemiesTuning {
  const raw = cloneSource();
  mutate(raw);
  return parseTuning(raw).enemies;
}

const level = parseLevelData({
  id: 'tuning-room',
  chapter: 1,
  room: 1,
  isBossRoom: false,
  size: { cols: 32, rows: 18 },
  tileSizePx: 16,
  playerStart: { x: 16, y: 16 },
  waves: [{ enemies: [{ role: 'chaser', at: { x: 2, y: 2 }, elite: false }] }],
  obstacles: [],
  doors: [],
});

function enemyState(
  role: EnemyRole,
  position: { x: number; y: number },
  tuning: EnemiesTuning,
): EnemyState {
  const maxHealth = maxHealthFor(role, false, tuning);
  return {
    id: `tuning-${role}`,
    role,
    elite: false,
    position,
    health: maxHealth,
    maxHealth,
    action: { kind: 'idle' },
    actionStartedMs: 0,
  };
}

describe('tuning — config/tuning.json is the single source', () => {
  it('re-parsing the source JSON gives the same object in use', () => {
    expect(parseTuning(TUNING_SOURCE)).toEqual(TUNING);
  });

  it('DEFAULT_COMBAT is the config combat object itself, not a copy', () => {
    expect(DEFAULT_COMBAT).toBe(COMBAT_TUNING);
    expect(DEFAULT_COMBAT.fireRatePerSecond).toBe(
      (cloneSource().combat as { fireRatePerSecond: number }).fireRatePerSecond,
    );
  });

  it('a missing field throws naming the exact path, instead of silently using 0', () => {
    const raw = cloneSource();
    delete roleOf(raw, 'caster').health;

    expect(() => parseTuning(raw)).toThrowError(/enemies\.roles\.caster\.health.*missing field/);
  });

  it('a mistyped or negative field is caught too', () => {
    const wrongType = cloneSource();
    roleOf(wrongType, 'chaser').speedTilesPerSecond = 'nhanh';
    expect(() => parseTuning(wrongType)).toThrowError(/must be a finite number/);

    const negative = cloneSource();
    (negative.combat as Record<string, unknown>).damage = -1;
    expect(() => parseTuning(negative)).toThrowError(/must not be negative/);

    const zeroRate = cloneSource();
    (zeroRate.combat as Record<string, unknown>).fireRatePerSecond = 0;
    expect(() => parseTuning(zeroRate)).toThrowError(/must be > 0/);
  });

  it('an inverted range is caught', () => {
    const raw = cloneSource();
    roleOf(raw, 'caster').preferredRangeMinTiles = 9;
    expect(() => parseTuning(raw)).toThrowError(/preferredRangeMaxTiles.*must be >=/);
  });

  it('every number behaviours uses matches the JSON', () => {
    for (const role of ['chaser', 'caster', 'tank'] as const) {
      const raw = roleOf(cloneSource(), role);
      const tuning = ENEMY_TUNING.roles[role];

      // `parse` must not change any number from the JSON.
      expect(tuning).toEqual(raw);

      expect(maxHealthFor(role, false)).toBe(numberAt(raw, 'health'));
      expect(maxHealthFor(role, true)).toBe(
        Math.round(numberAt(raw, 'health') * ENEMY_TUNING.eliteHealthMultiplier),
      );
      expect(speedFor(role, false)).toBe(numberAt(raw, 'speedTilesPerSecond'));
      expect(contactDamageFor(role, false)).toBe(numberAt(raw, 'contactDamage'));
      expect(contactDamageFor(role, true)).toBe(
        Math.round(numberAt(raw, 'contactDamage') * ENEMY_TUNING.eliteDamageMultiplier),
      );
      expect(ATTACK_COOLDOWN_MS[role]).toBe(numberAt(raw, 'attackCooldownMs'));
    }

    const chaser = ENEMY_TUNING.roles.chaser;
    const caster = ENEMY_TUNING.roles.caster;
    const tank = ENEMY_TUNING.roles.tank;

    expect(CHASER_CONTACT_RANGE_TILES).toBe(chaser.preferredRangeMaxTiles);
    expect(CASTER_MIN_RANGE_TILES).toBe(caster.preferredRangeMinTiles);
    expect(CASTER_MAX_RANGE_TILES).toBe(caster.preferredRangeMaxTiles);
    expect(TANK_CHARGE_RANGE_TILES).toBe(tank.preferredRangeMaxTiles);
    expect(TANK_CHARGE_DURATION_MS).toBe(tank.chargeDurationMs);
  });
});

describe('tuning — changing the JSON changes behaviour (no hardcoding)', () => {
  it('enemy health and speed come from the injected tuning set', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'chaser').health = 99;
      roleOf(raw, 'chaser').speedTilesPerSecond = 0.5;
    });

    expect(maxHealthFor('chaser', false, tuning)).toBe(99);
    expect(speedFor('chaser', false, tuning)).toBe(0.5);
    // The default set is unchanged: no hidden state was written.
    expect(maxHealthFor('chaser', false)).toBe(ENEMY_TUNING.roles.chaser.health);
  });

  it('contact damage and elite multipliers come from the tuning set', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'tank').contactDamage = 3;
      (raw.enemies as Record<string, unknown>).eliteDamageMultiplier = 4;
    });

    expect(contactDamageFor('tank', false, tuning)).toBe(3);
    expect(contactDamageFor('tank', true, tuning)).toBe(12);
  });

  it('caster keeps exactly the spacing band from the tuning set', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'caster').preferredRangeMinTiles = 2;
      roleOf(raw, 'caster').preferredRangeMaxTiles = 3;
    });

    const state = enemyState('caster', { x: 10, y: 5 }, tuning);
    const action = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 5000, level, tuning });

    expect(action.kind).toBe('walk');
    if (action.kind !== 'walk') return;
    expect(action.target.x - 5).toBeCloseTo(3);
  });

  it('caster uses the cooldown and telegraph from the tuning set', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'caster').attackCooldownMs = 100;
      roleOf(raw, 'caster').telegraphMs = 2000;
    });

    const state = { ...enemyState('caster', { x: 10, y: 5 }, tuning), actionStartedMs: 1000 };
    const atCooldown = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 1050, level, tuning });
    expect(atCooldown).toEqual({ kind: 'idle' });

    const ready = decideAction({ state, player: { x: 5, y: 5 }, nowMs: 1200, level, tuning });
    expect(ready).toEqual({ kind: 'telegraph', sinceMs: 1200 });

    const telegraphing = { ...state, action: ready, actionStartedMs: 1200 };
    expect(
      decideAction({ state: telegraphing, player: { x: 5, y: 5 }, nowMs: 3000, level, tuning }),
    ).toEqual({ kind: 'telegraph', sinceMs: 1200 });
    expect(
      decideAction({ state: telegraphing, player: { x: 5, y: 5 }, nowMs: 3200, level, tuning }),
    ).toEqual({ kind: 'idle' });
  });

  it('tank uses the strike range and charge time from the tuning set', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'tank').preferredRangeMaxTiles = 2;
      roleOf(raw, 'tank').attackCooldownMs = 0;
      roleOf(raw, 'tank').telegraphMs = 100;
      roleOf(raw, 'tank').chargeDurationMs = 250;
    });

    const far = enemyState('tank', { x: 10, y: 14 }, tuning);
    // Player 10 tiles away > 2 → walks, no attack.
    expect(decideAction({ state: far, player: { x: 10, y: 4 }, nowMs: 1000, level, tuning })).toMatchObject(
      { kind: 'walk' },
    );

    const near = enemyState('tank', { x: 10, y: 6 }, tuning);
    const telegraph = decideAction({ state: near, player: { x: 10, y: 4 }, nowMs: 1000, level, tuning });
    expect(telegraph).toEqual({ kind: 'telegraph', sinceMs: 1000 });

    const ready = { ...near, action: telegraph, actionStartedMs: 1000 };
    const charge = decideAction({ state: ready, player: { x: 10, y: 4 }, nowMs: 1100, level, tuning });
    expect(charge.kind).toBe('charge');
    if (charge.kind !== 'charge') return;
    expect(charge.untilMs).toBe(1100 + 250);
  });

  it('chaser stops at the contact distance from the tuning set', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'chaser').preferredRangeMinTiles = 3;
      roleOf(raw, 'chaser').preferredRangeMaxTiles = 3;
    });

    const state = enemyState('chaser', { x: 10, y: 5 }, tuning);
    const action = decideAction({ state, player: { x: 7.5, y: 5 }, nowMs: 0, level, tuning });

    expect(action).toEqual({ kind: 'idle' });
  });

  it('behaviours telegraph equals the duration from the tuning set', () => {
    // `isTelegraphElapsed` is a pure function taking a duration, so the same number as the JSON.
    expect(isTelegraphElapsed(0, ENEMY_TUNING.roles.caster.telegraphMs - 1, ENEMY_TUNING.roles.caster.telegraphMs)).toBe(false);
    expect(isTelegraphElapsed(0, ENEMY_TUNING.roles.caster.telegraphMs, ENEMY_TUNING.roles.caster.telegraphMs)).toBe(true);
  });
});

describe('tuning — M3: hitstop, stagger, elite extra attacks', () => {
  it('70 ms hitstop and 150 ms stagger come from the JSON, not hardcoded', () => {
    const rawCombat = (cloneSource().combat as Record<string, unknown>);
    expect(DEFAULT_COMBAT.enemyHitstopMs).toBe(70);
    expect(DEFAULT_COMBAT.enemyStaggerMs).toBe(150);
    expect(rawCombat.enemyHitstopMs).toBe(DEFAULT_COMBAT.enemyHitstopMs);
    expect(rawCombat.enemyStaggerMs).toBe(DEFAULT_COMBAT.enemyStaggerMs);

    const changed = cloneSource();
    (changed.combat as Record<string, unknown>).enemyStaggerMs = 400;
    expect(parseTuning(changed).combat.enemyStaggerMs).toBe(400);
  });

  it('elite scale / volley / extraCharges come from the JSON', () => {
    const elite = (cloneSource().enemies as { elite: Record<string, unknown> }).elite;
    expect(ENEMY_TUNING.elite.scale).toBe(elite.scale);
    expect(ENEMY_TUNING.elite.caster).toEqual(elite.caster);
    expect(ENEMY_TUNING.elite.tank).toEqual(elite.tank);
    expect(ENEMY_TUNING.elite.chaser).toEqual(elite.chaser);
  });

  it('a mistyped/negative elite value is caught at parse time, with the path', () => {
    const negativeCharges = cloneSource();
    const tank = (
      (negativeCharges.enemies as { elite: { tank: Record<string, unknown> } }).elite
    ).tank;
    tank.extraCharges = -1;
    expect(() => parseTuning(negativeCharges)).toThrowError(/enemies\.elite\.tank\.extraCharges/);

    const fractionalShots = cloneSource();
    const caster = (
      (fractionalShots.enemies as { elite: { caster: Record<string, unknown> } }).elite
    ).caster;
    caster.volleyShots = 2.5;
    expect(() => parseTuning(fractionalShots)).toThrowError(/must be an integer/);

    const missingElite = cloneSource();
    delete (missingElite.enemies as Record<string, unknown>).elite;
    expect(() => parseTuning(missingElite)).toThrowError(/enemies\.elite.*missing field/);
  });
});

describe('tuning — M3 round 2: silhouette per role', () => {
  it('brute scale is clearly larger than chaser/caster, read from the JSON', () => {
    const roles = (cloneSource().enemies as Record<string, unknown>).roles as Record<
      string,
      Record<string, unknown>
    >;
    expect(visualScaleFor('tank')).toBe(roles.tank?.scale);
    expect(visualScaleFor('tank')).toBeGreaterThanOrEqual(1.6);
    expect(visualScaleFor('tank')).toBeLessThanOrEqual(1.8);
    expect(visualScaleFor('chaser')).toBe(1);
    expect(visualScaleFor('caster')).toBe(1);
  });

  it('changing the scale in the JSON changes the helper, no hardcoding', () => {
    const tuning = tuningWith((raw) => {
      roleOf(raw, 'tank').scale = 2.25;
    });
    expect(visualScaleFor('tank', tuning)).toBe(2.25);
    // The default set is not written.
    expect(visualScaleFor('tank')).toBe(ENEMY_TUNING.roles.tank.scale);
  });

  it('scale <= 0 is rejected', () => {
    const raw = cloneSource();
    roleOf(raw, 'tank').scale = 0;
    expect(() => parseTuning(raw)).toThrowError(/enemies\.roles\.tank\.scale.*must be > 0/);
  });
});

describe('tuning — M11: boss intro grace & chapter HP', () => {
  it('boss.introGraceMs and boss.healthByChapter match config/tuning.json', () => {
    const rawBoss = cloneSource().boss as { introGraceMs: number; healthByChapter: number[] };
    expect(TUNING.boss.introGraceMs).toBe(rawBoss.introGraceMs);
    expect(TUNING.boss.healthByChapter).toEqual(rawBoss.healthByChapter);
    expect(TUNING.boss.introGraceMs).toBeGreaterThanOrEqual(800);
  });

  it('rejects invalid boss tuning fields', () => {
    const negativeGrace = cloneSource();
    (negativeGrace.boss as Record<string, unknown>).introGraceMs = -100;
    expect(() => parseTuning(negativeGrace)).toThrowError(/boss\.introGraceMs/);

    const shortHp = cloneSource();
    (shortHp.boss as Record<string, unknown>).healthByChapter = [80, 100];
    expect(() => parseTuning(shortHp)).toThrowError(/boss\.healthByChapter/);

    const zeroHp = cloneSource();
    (zeroHp.boss as Record<string, unknown>).healthByChapter = [80, 0, 140, 180];
    expect(() => parseTuning(zeroHp)).toThrowError(/boss\.healthByChapter\[1\]/);

    const missingBoss = cloneSource();
    delete missingBoss.boss;
    expect(() => parseTuning(missingBoss)).toThrowError(/boss.*must be an object/);
  });
});

describe('tuning — M14: 4-class characters block', () => {
  it('characters tuning matches config/tuning.json for all 4 classes', () => {
    const rawChars = cloneSource().characters as Record<string, unknown>;
    expect(CHARACTERS_TUNING).toBe(TUNING.characters);
    for (const id of TUNING_CHARACTER_IDS) {
      expect(CHARACTERS_TUNING[id]).toEqual(rawChars[id]);
    }
    expect(CHARACTERS_TUNING.ninja.unlockChapter).toBe(0);
    expect(CHARACTERS_TUNING.ninja.unlockGoldCost).toBe(0);
    expect(CHARACTERS_TUNING.archer.unlockChapter).toBe(1);
    expect(CHARACTERS_TUNING.mage.unlockChapter).toBe(2);
    expect(CHARACTERS_TUNING.cultivator.unlockChapter).toBe(3);
    expect(CHARACTERS_TUNING.cultivator.signature.hideAttachmentMs).toBe(1200);
  });

  it('rejects invalid characters tuning fields with exact paths', () => {
    const missingChars = cloneSource();
    delete missingChars.characters;
    expect(() => parseTuning(missingChars)).toThrowError(/characters.*must be an object/);

    const badChapter = cloneSource();
    ((badChapter.characters as Record<string, Record<string, unknown>>).archer!).unlockChapter = 9;
    expect(() => parseTuning(badChapter)).toThrowError(/characters\.archer\.unlockChapter/);

    const badDelta = cloneSource();
    (
      ((badDelta.characters as Record<string, Record<string, unknown>>).mage!).baseStats as Record<
        string,
        unknown
      >
    ).maxHpDelta = 1.5;
    expect(() => parseTuning(badDelta)).toThrowError(/characters\.mage\.baseStats\.maxHpDelta/);

    const invertedProjectiles = cloneSource();
    (
      (
        (invertedProjectiles.characters as Record<string, Record<string, unknown>>).cultivator!
      ).signature as Record<string, unknown>
    ).maxProjectileCount = 2;
    expect(() => parseTuning(invertedProjectiles)).toThrowError(
      /characters\.cultivator\.signature\.maxProjectileCount/,
    );
  });
});
