import { describe, expect, it } from 'vitest';
import { BulletPool } from '../../assets/scripts/core/combat/bullets';
import { HealthState } from '../../assets/scripts/core/combat/health';
import { firePlayerVolley } from '../../assets/scripts/core/combat/player-fire';
import {
  HOMING_TURN_RATE_RADIANS_PER_SECOND,
  TWIN_SPREAD_RADIANS,
  damageAfterExecute,
  damageWithStatusBonus,
  lifestealHeal,
  planVolley,
  ricochetTarget,
  shockArcTargets,
  steerVelocity,
} from '../../assets/scripts/core/combat/shot-effects';
import { ShieldCharger } from '../../assets/scripts/core/combat/shield';
import { StatusEffects } from '../../assets/scripts/core/combat/status-effects';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { SeededRng } from '../../assets/scripts/core/rng';
import { computeDerivedStats, estimateDps } from '../../assets/scripts/core/skills/derived-stats';

function statsOf(...entries: readonly (readonly [string, number])[]) {
  return computeDerivedStats(new Map(entries));
}

describe('planVolley — the skill DPS formula', () => {
  it('base: 1 bullet, damage 1, no crit', () => {
    const plans = planVolley(statsOf(), new SeededRng(1));
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ angleOffset: 0, damage: 1, crit: false });
  });

  it('Twin Shot n bullets: one flies straight, extra bullets offset ±12°', () => {
    const plans = planVolley(statsOf(['twin-shot', 2]), new SeededRng(2));
    expect(plans).toHaveLength(3);

    // A middle bullet always flies straight so Twin Shot does not lose long-range DPS.
    expect(plans[0]?.angleOffset).toBe(0);
    expect(plans[1]?.angleOffset).toBeCloseTo(TWIN_SPREAD_RADIANS, 10);
    expect(plans[2]?.angleOffset).toBeCloseTo(-TWIN_SPREAD_RADIANS, 10);
    for (const plan of plans) expect(plan.damage).toBe(1);
  });

  it('Twin Shot 1 stack does not reduce long-range hit chance', () => {
    const plans = planVolley(statsOf(['twin-shot', 1]), new SeededRng(3));
    expect(plans).toHaveLength(2);
    expect(plans.some((plan) => plan.angleOffset === 0)).toBe(true);
  });

  it('estimated DPS matches damage × projectiles × rate × crit', () => {
    const loadoutStats = statsOf(['sharpen', 1], ['rapid-fire', 2], ['twin-shot', 1]);
    // damage 2, rate 2 × 1.5 = 3, projectiles 2 → 12.
    expect(estimateDps(loadoutStats)).toBeCloseTo(12, 10);
    expect(
      loadoutStats.damage * loadoutStats.projectiles * loadoutStats.fireRatePerSecond,
    ).toBeCloseTo(12, 10);
  });

  it('crit multiplies each bullet damage, matching estimateDps in expectation', () => {
    const stats = statsOf(['crit-eye', 3]); // 45% ×2
    const rng = new SeededRng(2026);
    let total = 0;
    const samples = 20_000;
    for (let index = 0; index < samples; index += 1) {
      total += planVolley(stats, rng)[0]?.damage ?? 0;
    }
    expect(total / samples).toBeCloseTo(1.45, 1);
    expect(estimateDps(stats)).toBeCloseTo(2 * 1.45, 10);
  });

  it('pierce/ricochet/homing/explosive travel with the bullet metadata', () => {
    const plans = planVolley(
      statsOf(['piercing', 2], ['ricochet', 1], ['homing', 1], ['explosive', 2]),
      new SeededRng(3),
    );
    expect(plans[0]).toMatchObject({
      pierce: 2,
      ricochet: 1,
      homing: true,
      explosiveRadiusTiles: 1.5,
      explosiveDamage: 1,
    });
  });

  it('same seed gives the same crit sequence', () => {
    const stats = statsOf(['crit-eye', 3]);
    const a = planVolley(stats, new SeededRng(77));
    const b = planVolley(stats, new SeededRng(77));
    expect(a).toEqual(b);
  });
});

describe('execute / lifesteal', () => {
  it('execute bonus only adds below the health threshold', () => {
    const stats = computeDerivedStats(new Map(), {
      ...DEFAULT_COMBAT,
      executeThreshold: 0.3,
      executeBonus: 1,
    });
    expect(damageAfterExecute(stats, 1, 0.5)).toBe(1);
    expect(damageAfterExecute(stats, 1, 0.29)).toBeCloseTo(2, 10);
    expect(damageAfterExecute(stats, 1, 0.3)).toBe(1);
    expect(damageAfterExecute(stats, 1, 0.30001)).toBe(1);
  });

  it('lifesteal rounds down exactly as the GDD says', () => {
    const stats = statsOf(['lifesteal', 1]); // 5%
    expect(lifestealHeal(stats, 3)).toBe(0);
    expect(lifestealHeal(stats, 20)).toBe(1);
    expect(lifestealHeal(stats, 40)).toBe(2);
    expect(lifestealHeal(statsOf(), 40)).toBe(0);
  });
});

describe('ricochetTarget / steerVelocity', () => {
  const from = { x: 0, y: 0 };

  it('picks the nearest enemy not yet hit and ignores out-of-range ones', () => {
    const target = ricochetTarget(
      from,
      [
        { id: 'a', position: { x: 2, y: 0 } },
        { id: 'b', position: { x: 1, y: 0 } },
        { id: 'c', position: { x: 20, y: 0 } },
      ],
      ['b'],
    );
    expect(target?.id).toBe('a');
    expect(ricochetTarget(from, [{ id: 'z', position: { x: 12, y: 0 } }], [])).toBeNull();
  });

  it('homing turns at a limited rate and keeps speed', () => {
    const velocity = { x: 10, y: 0 };
    const next = steerVelocity(velocity, { x: 0, y: 0 }, { x: 0, y: 10 }, 0.2);
    expect(Math.hypot(next.x, next.y)).toBeCloseTo(10, 10);
    expect(Math.atan2(next.y, next.x)).toBeCloseTo(0.2, 10);

    const fullTurn = steerVelocity(
      velocity,
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      HOMING_TURN_RATE_RADIANS_PER_SECOND,
    );
    expect(fullTurn.x).toBeCloseTo(0, 6);
    expect(fullTurn.y).toBeCloseTo(10, 6);
  });
});

describe('StatusEffects', () => {
  it('slow applies the right factor for the right time then ends', () => {
    const status = new StatusEffects();
    status.apply({ slowOnHit: { factor: 0.4, durationMs: 1000 } }, 100);
    expect(status.speedMultiplier(500)).toBeCloseTo(0.4, 10);
    expect(status.speedMultiplier(1099)).toBeCloseTo(0.4, 10);
    expect(status.speedMultiplier(1100)).toBe(1);
  });

  it('poison deals the right dps without exceeding duration even on long frames', () => {
    const status = new StatusEffects();
    status.apply({ poisonOnHit: { dps: 2, durationMs: 3000 } }, 0);

    expect(status.poisonDamage(0, 1000)).toBeCloseTo(2, 10);
    expect(status.poisonDamage(2500, 1000)).toBeCloseTo(1, 10);
    expect(status.poisonDamage(3000, 1000)).toBe(0);
  });

  it('re-applying takes the stronger effect and the longer duration', () => {
    const status = new StatusEffects();
    status.apply({ slowOnHit: { factor: 0.7, durationMs: 500 } }, 0);
    status.apply({ slowOnHit: { factor: 0.4, durationMs: 1000 } }, 100);
    expect(status.speedMultiplier(300)).toBeCloseTo(0.4, 10);
    expect(status.speedMultiplier(900)).toBeCloseTo(0.4, 10);
    expect(status.speedMultiplier(1100)).toBe(1);
  });
});

describe('ShieldCharger', () => {
  it('blocks exactly the given number of charges then regenerates after cooldown', () => {
    const shield = new ShieldCharger(2, 20_000);
    expect(shield.tryBlock(0)).toBe(true);
    expect(shield.tryBlock(100)).toBe(true);
    expect(shield.tryBlock(200)).toBe(false);
    expect(shield.charges).toBe(0);

    shield.update(19_000);
    expect(shield.charges).toBe(0);
    shield.update(20_100);
    expect(shield.charges).toBe(2);
  });

  it('maxCharges = 0 never blocks and never errors', () => {
    const shield = new ShieldCharger(0, 1000);
    expect(shield.tryBlock(0)).toBe(false);
    shield.update(10_000);
    expect(shield.charges).toBe(0);
  });
});

describe('HealthState.configure', () => {
  it('Vitality raises the cap, keeps current health, and heal does not exceed the cap', () => {
    const health = new HealthState(DEFAULT_COMBAT, 5);
    health.configure(7, 1100);
    expect(health.max).toBe(7);
    expect(health.current).toBe(5);
    expect(health.heal(99)).toBe(7);
  });

  it('lowering the cap clamps health, and the new i-frame only then applies', () => {
    const health = new HealthState(DEFAULT_COMBAT, 6);
    health.configure(3, 2000);
    expect(health.current).toBe(3);
    health.tryDamage(1, 0);
    expect(health.current).toBe(2);
    expect(health.tryDamage(1, 1000).applied).toBe(false);
    expect(health.tryDamage(1, 2000).applied).toBe(true);
  });
});

describe('firePlayerVolley + BulletPool metadata', () => {
  it('spawns every bullet with damage/flags, and a reused slot resets hitIds', () => {
    const pool = new BulletPool(8);
    const fired = firePlayerVolley({
      pool,
      stats: statsOf(['twin-shot', 1], ['piercing', 1], ['ricochet', 1]),
      rng: new SeededRng(5),
      origin: { x: 16, y: 16 },
      direction: { x: 1, y: 0 },
      speedTilesPerSecond: 12,
      radiusTiles: 0.15,
      ttlMs: 1000,
    });

    expect(fired).toBe(2);
    const bullets = pool.snapshot();
    expect(bullets).toHaveLength(2);
    expect(bullets[0]?.pierceRemaining).toBe(1);
    expect(bullets[0]?.ricochetRemaining).toBe(1);
    expect(Math.hypot(bullets[0]?.velocity.x ?? 0, bullets[0]?.velocity.y ?? 0)).toBeCloseTo(12, 10);

    const reused = pool.active()[0];
    if (reused === undefined) throw new Error('missing bullet');
    reused.hitIds.push('x');
    pool.consume(reused.id);
    firePlayerVolley({
      pool,
      stats: statsOf(),
      rng: new SeededRng(6),
      origin: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      speedTilesPerSecond: 12,
      radiusTiles: 0.15,
      ttlMs: 1000,
    });
    expect(pool.active()[0]?.hitIds).toEqual([]);
  });
});

describe('M13 burn, status amp, and shock arcs', () => {
  it('StatusEffects tracks burn DoT without exceeding duration and reports hasAnyStatus', () => {
    const status = new StatusEffects();
    expect(status.hasAnyStatus(0)).toBe(false);

    status.apply({ burnOnHit: { dps: 2, durationMs: 2500 } }, 100);
    expect(status.isBurned(100)).toBe(true);
    expect(status.hasAnyStatus(100)).toBe(true);
    expect(status.burnDamage(100, 1000)).toBeCloseTo(2, 10);
    expect(status.burnDamage(2100, 1000)).toBeCloseTo(1, 10);
    expect(status.isBurned(2600)).toBe(false);
    expect(status.hasAnyStatus(2600)).toBe(false);

    status.clear();
    expect(status.hasAnyStatus(100)).toBe(false);
  });

  it('damageWithStatusBonus scales damage only when target is afflicted and bonus > 0', () => {
    const stats = statsOf(['blightfrost', 1]); // +35%
    expect(damageWithStatusBonus(stats, 4, false)).toBe(4);
    expect(damageWithStatusBonus(stats, 4, true)).toBeCloseTo(5.4, 10);
    expect(damageWithStatusBonus(statsOf(), 4, true)).toBe(4);
  });

  it('shockArcTargets chains through nearest unvisited targets within rangeTiles', () => {
    const shock = { arcs: 2, damageRatio: 0.45, rangeTiles: 4 };
    const candidates = [
      { id: 'origin', position: { x: 0, y: 0 } },
      { id: 'a', position: { x: 2, y: 0 } },
      { id: 'b', position: { x: 5, y: 0 } }, // 3 tiles from 'a', 5 from 'origin'
      { id: 'far', position: { x: 20, y: 0 } },
    ];
    const arcs = shockArcTargets('origin', { x: 0, y: 0 }, shock, candidates);
    expect(arcs.map((t) => t.id)).toEqual(['a', 'b']);

    // Out of range from 'origin' -> empty
    expect(
      shockArcTargets('origin', { x: 0, y: 0 }, shock, [{ id: 'far', position: { x: 9, y: 0 } }]),
    ).toEqual([]);
  });
});
