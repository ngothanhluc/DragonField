import { describe, expect, it } from 'vitest';
import { BulletPool, hitsCircle } from '../../assets/scripts/core/combat/bullets';
import {
  ENEMY_BULLET_RADIUS_TILES,
  ENEMY_BULLET_SPEED_TILES_PER_SECOND,
  ENEMY_BULLET_TTL_MS,
  aimDirection,
  fireEnemyVolley,
  rotateDirection,
} from '../../assets/scripts/core/combat/enemy-fire';
import { HealthState } from '../../assets/scripts/core/combat/health';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { eliteVolleyAngles } from '../../assets/scripts/core/enemies/elite';
import { ENEMY_TUNING } from '../../assets/scripts/core/enemies/tuning';

const PLAYER = { x: 16, y: 9 };
const ENEMY = { x: 16, y: 4 };
const PLAYER_RADIUS = 0.25;

/** Một frame 16 ms của đạn; trả về số viên vừa trúng player. */
function stepBulletsAgainstPlayer(
  pool: BulletPool,
  nowMs: number,
  health: HealthState,
): { nowMs: number; hits: number } {
  pool.update(16);
  const nextNow = nowMs + 16;
  let hits = 0;

  for (const bullet of pool.active()) {
    if (bullet.owner !== 'enemy') continue;
    const area = { position: bullet.position, radiusTiles: bullet.radiusTiles };
    if (!hitsCircle(area, { position: PLAYER, radiusTiles: PLAYER_RADIUS })) continue;

    const result = health.tryDamage(bullet.damage, nextNow);
    pool.consume(bullet.id);
    if (result.applied) hits += 1;
  }

  return { nowMs: nextNow, hits };
}

describe('aimDirection / rotateDirection', () => {
  it('chuẩn hoá hướng, hai điểm trùng nhau thì bay sang phải', () => {
    expect(aimDirection({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(aimDirection({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual({ x: 1, y: 0 });
  });

  it('xoay 90° đổi trục, giữ độ dài 1', () => {
    const rotated = rotateDirection({ x: 1, y: 0 }, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
    expect(Math.hypot(rotated.x, rotated.y)).toBeCloseTo(1);
  });
});

describe('eliteVolleyAngles — đòn thêm của elite caster', () => {
  it('caster thường 1 viên đi thẳng; elite 3 viên đối xứng', () => {
    expect(eliteVolleyAngles('caster', false)).toEqual([0]);

    const angles = eliteVolleyAngles('caster', true);
    expect(angles).toHaveLength(ENEMY_TUNING.elite.caster.volleyShots);
    expect(angles[1]).toBe(0);
    expect(angles[0]).toBeCloseTo(-ENEMY_TUNING.elite.caster.volleySpreadRadians);
    expect(angles[2]).toBeCloseTo(ENEMY_TUNING.elite.caster.volleySpreadRadians);
    expect((angles[0] ?? 0) + (angles[2] ?? 0)).toBeCloseTo(0);
  });

  it('chaser/tank không bắn đạn — đòn thêm của chúng là lao', () => {
    expect(eliteVolleyAngles('chaser', true)).toEqual([]);
    expect(eliteVolleyAngles('tank', true)).toEqual([]);
  });
});

describe('fireEnemyVolley — sinh đạn qua pool', () => {
  it('một viên đi đúng hướng player, đúng tốc độ và owner enemy', () => {
    const pool = new BulletPool(8);
    expect(fireEnemyVolley({ pool, from: ENEMY, to: PLAYER, damage: 2, angles: [0] })).toBe(1);

    const [bullet] = pool.snapshot();
    if (bullet === undefined) throw new Error('phải có 1 viên');

    expect(bullet.owner).toBe('enemy');
    expect(bullet.damage).toBe(2);
    expect(bullet.radiusTiles).toBe(ENEMY_BULLET_RADIUS_TILES);
    expect(bullet.ttlMs).toBe(ENEMY_BULLET_TTL_MS);
    expect(Math.hypot(bullet.velocity.x, bullet.velocity.y)).toBeCloseTo(
      ENEMY_BULLET_SPEED_TILES_PER_SECOND,
    );
    // Bay từ enemy về phía player: y tăng (player ở dưới enemy trong hệ tile).
    expect(bullet.velocity.y).toBeGreaterThan(0);
    expect(bullet.position).toEqual(ENEMY);
  });

  it('3 viên toả quạt: viên giữa đi thẳng, hai viên lệch hai bên', () => {
    const pool = new BulletPool(8);
    fireEnemyVolley({ pool, from: ENEMY, to: PLAYER, damage: 1, angles: [-0.22, 0, 0.22] });

    const bullets = pool.snapshot();
    expect(bullets).toHaveLength(3);

    const center = bullets[1];
    const left = bullets[0];
    const right = bullets[2];
    if (center === undefined || left === undefined || right === undefined) throw new Error('thiếu đạn');

    const base = aimDirection(ENEMY, PLAYER);
    expect(center.velocity.x).toBeCloseTo(base.x * ENEMY_BULLET_SPEED_TILES_PER_SECOND);
    // Hai viên ngoài lệch ngược dấu nhau quanh viên giữa (cross product).
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      a.x * b.y - a.y * b.x;
    expect(cross(center.velocity, left.velocity)).toBeLessThan(0);
    expect(cross(center.velocity, right.velocity)).toBeGreaterThan(0);
  });

  it('không có góc nào thì không spawn gì', () => {
    const pool = new BulletPool(4);
    expect(fireEnemyVolley({ pool, from: ENEMY, to: PLAYER, damage: 1, angles: [] })).toBe(0);
    expect(pool.active()).toHaveLength(0);
  });
});

describe('i-frame khi trúng đạn enemy', () => {
  it('viên thứ hai trong 800 ms không trừ tim, sau 800 ms lại trừ', () => {
    const pool = new BulletPool(8);
    const health = new HealthState(DEFAULT_COMBAT);
    let nowMs = 0;
    const heartsBefore = health.current;

    // Viên 1: bay từ enemy 5 tile, trúng player sau ~1.2 s.
    fireEnemyVolley({ pool, from: ENEMY, to: PLAYER, damage: 1, angles: [0] });
    let hits = 0;
    for (let guard = 0; guard < 200 && hits === 0; guard += 1) {
      const step = stepBulletsAgainstPlayer(pool, nowMs, health);
      nowMs = step.nowMs;
      hits = step.hits;
    }

    expect(hits).toBe(1);
    expect(health.current).toBe(heartsBefore - 1);
    expect(health.isInvulnerable(nowMs)).toBe(true);

    // Viên 2 spawn ngay trên người player, trúng ở frame kế tiếp — vẫn trong i-frame.
    pool.spawn({
      position: { x: PLAYER.x, y: PLAYER.y - 0.3 },
      velocity: { x: 0, y: 2 },
      radiusTiles: ENEMY_BULLET_RADIUS_TILES,
      damage: 1,
      owner: 'enemy',
      ttlMs: 1000,
    });
    const second = stepBulletsAgainstPlayer(pool, nowMs, health);
    nowMs = second.nowMs;
    expect(second.hits).toBe(0);
    expect(health.current).toBe(heartsBefore - 1);

    // Qua mốc 800 ms: viên thứ ba trừ tim bình thường.
    nowMs += DEFAULT_COMBAT.invulnerabilityMs;
    pool.spawn({
      position: { x: PLAYER.x, y: PLAYER.y - 0.3 },
      velocity: { x: 0, y: 2 },
      radiusTiles: ENEMY_BULLET_RADIUS_TILES,
      damage: 1,
      owner: 'enemy',
      ttlMs: 1000,
    });
    const third = stepBulletsAgainstPlayer(pool, nowMs, health);
    expect(third.hits).toBe(1);
    expect(health.current).toBe(heartsBefore - 2);
  });
});
