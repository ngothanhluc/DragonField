import { describe, expect, it } from 'vitest';
import { BulletPool } from '../../assets/scripts/core/combat/bullets';
import { HealthState } from '../../assets/scripts/core/combat/health';
import { firePlayerVolley } from '../../assets/scripts/core/combat/player-fire';
import {
  HOMING_TURN_RATE_RADIANS_PER_SECOND,
  TWIN_SPREAD_RADIANS,
  damageAfterExecute,
  lifestealHeal,
  planVolley,
  ricochetTarget,
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

describe('planVolley — công thức DPS của skill', () => {
  it('base: 1 viên, damage 1, không crit', () => {
    const plans = planVolley(statsOf(), new SeededRng(1));
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ angleOffset: 0, damage: 1, crit: false });
  });

  it('Twin Shot n viên: một viên đi thẳng, viên thêm lệch ±12°', () => {
    const plans = planVolley(statsOf(['twin-shot', 2]), new SeededRng(2));
    expect(plans).toHaveLength(3);

    // Một viên giữa luôn đi thẳng để Twin Shot không làm mất DPS tầm xa.
    expect(plans[0]?.angleOffset).toBe(0);
    expect(plans[1]?.angleOffset).toBeCloseTo(TWIN_SPREAD_RADIANS, 10);
    expect(plans[2]?.angleOffset).toBeCloseTo(-TWIN_SPREAD_RADIANS, 10);
    for (const plan of plans) expect(plan.damage).toBe(1);
  });

  it('Twin Shot 1 stack không làm giảm khả năng trúng ở tầm xa', () => {
    const plans = planVolley(statsOf(['twin-shot', 1]), new SeededRng(3));
    expect(plans).toHaveLength(2);
    expect(plans.some((plan) => plan.angleOffset === 0)).toBe(true);
  });

  it('DPS ước lượng khớp công thức damage × projectiles × rate × crit', () => {
    const loadoutStats = statsOf(['sharpen', 1], ['rapid-fire', 2], ['twin-shot', 1]);
    // damage 2, rate 2 × 1.5 = 3, projectiles 2 → 12.
    expect(estimateDps(loadoutStats)).toBeCloseTo(12, 10);
    expect(
      loadoutStats.damage * loadoutStats.projectiles * loadoutStats.fireRatePerSecond,
    ).toBeCloseTo(12, 10);
  });

  it('crit nhân damage từng viên, kỳ vọng khớp estimateDps', () => {
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

  it('pierce/ricochet/homing/explosive đi theo metadata của viên', () => {
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

  it('cùng seed cho cùng loạt crit', () => {
    const stats = statsOf(['crit-eye', 3]);
    const a = planVolley(stats, new SeededRng(77));
    const b = planVolley(stats, new SeededRng(77));
    expect(a).toEqual(b);
  });
});

describe('execute / lifesteal', () => {
  it('Executioner chỉ cộng khi máu dưới ngưỡng', () => {
    const stats = statsOf(['executioner', 2]);
    expect(damageAfterExecute(stats, 1, 0.5)).toBe(1);
    expect(damageAfterExecute(stats, 1, 0.29)).toBeCloseTo(2, 10);
    expect(damageAfterExecute(stats, 1, 0.3)).toBe(1);
    expect(damageAfterExecute(stats, 1, 0.30001)).toBe(1);
  });

  it('lifesteal làm tròn xuống đúng chữ GDD', () => {
    const stats = statsOf(['lifesteal', 1]); // 5%
    expect(lifestealHeal(stats, 3)).toBe(0);
    expect(lifestealHeal(stats, 20)).toBe(1);
    expect(lifestealHeal(stats, 40)).toBe(2);
    expect(lifestealHeal(statsOf(), 40)).toBe(0);
  });
});

describe('ricochetTarget / steerVelocity', () => {
  const from = { x: 0, y: 0 };

  it('chọn enemy gần nhất chưa trúng và bỏ qua ngoài tầm', () => {
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

  it('homing xoay có giới hạn và giữ nguyên tốc độ', () => {
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
  it('slow đúng hệ số trong đúng thời gian rồi hết', () => {
    const status = new StatusEffects();
    status.apply({ slowOnHit: { factor: 0.4, durationMs: 1000 } }, 100);
    expect(status.speedMultiplier(500)).toBeCloseTo(0.4, 10);
    expect(status.speedMultiplier(1099)).toBeCloseTo(0.4, 10);
    expect(status.speedMultiplier(1100)).toBe(1);
  });

  it('poison chảy đúng dps, không vượt quá duration kể cả frame dài', () => {
    const status = new StatusEffects();
    status.apply({ poisonOnHit: { dps: 2, durationMs: 3000 } }, 0);

    expect(status.poisonDamage(0, 1000)).toBeCloseTo(2, 10);
    expect(status.poisonDamage(2500, 1000)).toBeCloseTo(1, 10);
    expect(status.poisonDamage(3000, 1000)).toBe(0);
  });

  it('áp lại lấy hiệu ứng mạnh hơn và thời gian xa hơn', () => {
    const status = new StatusEffects();
    status.apply({ slowOnHit: { factor: 0.7, durationMs: 500 } }, 0);
    status.apply({ slowOnHit: { factor: 0.4, durationMs: 1000 } }, 100);
    expect(status.speedMultiplier(300)).toBeCloseTo(0.4, 10);
    expect(status.speedMultiplier(900)).toBeCloseTo(0.4, 10);
    expect(status.speedMultiplier(1100)).toBe(1);
  });
});

describe('ShieldCharger', () => {
  it('chặn đúng số charge rồi hồi sau cooldown', () => {
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

  it('maxCharges = 0 luôn không chặn và không lỗi', () => {
    const shield = new ShieldCharger(0, 1000);
    expect(shield.tryBlock(0)).toBe(false);
    shield.update(10_000);
    expect(shield.charges).toBe(0);
  });
});

describe('HealthState.configure', () => {
  it('Vitality nâng trần, giữ máu hiện tại, heal không vượt trần', () => {
    const health = new HealthState(DEFAULT_COMBAT, 5);
    health.configure(7, 1100);
    expect(health.max).toBe(7);
    expect(health.current).toBe(5);
    expect(health.heal(99)).toBe(7);
  });

  it('giảm trần kẹp máu, i-frame mới có hiệu lực', () => {
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
  it('spawn đủ viên với damage/flags, slot tái dùng reset hitIds', () => {
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
    if (reused === undefined) throw new Error('thiếu đạn');
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
