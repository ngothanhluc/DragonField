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

/** One 16 ms bullet frame; returns how many bullets just hit the player. */
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
  it('normalises the direction, coincident points fly right', () => {
    expect(aimDirection({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(aimDirection({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual({ x: 1, y: 0 });
  });

  it('a 90° rotation changes axis, keeping length 1', () => {
    const rotated = rotateDirection({ x: 1, y: 0 }, Math.PI / 2);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(1);
    expect(Math.hypot(rotated.x, rotated.y)).toBeCloseTo(1);
  });
});

describe('eliteVolleyAngles — elite caster extra attack', () => {
  it('regular caster fires 1 straight bullet; elite fires 3 symmetric bullets', () => {
    expect(eliteVolleyAngles('caster', false)).toEqual([0]);

    const angles = eliteVolleyAngles('caster', true);
    expect(angles).toHaveLength(ENEMY_TUNING.elite.caster.volleyShots);
    expect(angles[1]).toBe(0);
    expect(angles[0]).toBeCloseTo(-ENEMY_TUNING.elite.caster.volleySpreadRadians);
    expect(angles[2]).toBeCloseTo(ENEMY_TUNING.elite.caster.volleySpreadRadians);
    expect((angles[0] ?? 0) + (angles[2] ?? 0)).toBeCloseTo(0);
  });

  it('chaser/tank fire no bullets — their extra attack is a charge', () => {
    expect(eliteVolleyAngles('chaser', true)).toEqual([]);
    expect(eliteVolleyAngles('tank', true)).toEqual([]);
  });
});

describe('fireEnemyVolley — spawns bullets through the pool', () => {
  it('one bullet goes straight at the player, at the right speed and with the enemy as owner', () => {
    const pool = new BulletPool(8);
    expect(fireEnemyVolley({ pool, from: ENEMY, to: PLAYER, damage: 2, angles: [0] })).toBe(1);

    const [bullet] = pool.snapshot();
    if (bullet === undefined) throw new Error('must have 1 bullet');

    expect(bullet.owner).toBe('enemy');
    expect(bullet.damage).toBe(2);
    expect(bullet.radiusTiles).toBe(ENEMY_BULLET_RADIUS_TILES);
    expect(bullet.ttlMs).toBe(ENEMY_BULLET_TTL_MS);
    expect(Math.hypot(bullet.velocity.x, bullet.velocity.y)).toBeCloseTo(
      ENEMY_BULLET_SPEED_TILES_PER_SECOND,
    );
    // Flies from the enemy toward the player: y increases (the player is below the enemy in tile space).
    expect(bullet.velocity.y).toBeGreaterThan(0);
    expect(bullet.position).toEqual(ENEMY);
  });

  it('3-bullet fan: the centre bullet goes straight, the other two offset either side', () => {
    const pool = new BulletPool(8);
    fireEnemyVolley({ pool, from: ENEMY, to: PLAYER, damage: 1, angles: [-0.22, 0, 0.22] });

    const bullets = pool.snapshot();
    expect(bullets).toHaveLength(3);

    const center = bullets[1];
    const left = bullets[0];
    const right = bullets[2];
    if (center === undefined || left === undefined || right === undefined) throw new Error('missing bullets');

    const base = aimDirection(ENEMY, PLAYER);
    expect(center.velocity.x).toBeCloseTo(base.x * ENEMY_BULLET_SPEED_TILES_PER_SECOND);
    // The outer two are offset in opposite signs around the centre bullet (cross product).
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      a.x * b.y - a.y * b.x;
    expect(cross(center.velocity, left.velocity)).toBeLessThan(0);
    expect(cross(center.velocity, right.velocity)).toBeGreaterThan(0);
  });

  it('no angles means nothing is spawned', () => {
    const pool = new BulletPool(4);
    expect(fireEnemyVolley({ pool, from: ENEMY, to: PLAYER, damage: 1, angles: [] })).toBe(0);
    expect(pool.active()).toHaveLength(0);
  });
});

describe('i-frame when hit by an enemy bullet', () => {
  it('the second bullet within 800 ms costs no heart, after 800 ms it does again', () => {
    const pool = new BulletPool(8);
    const health = new HealthState(DEFAULT_COMBAT);
    let nowMs = 0;
    const heartsBefore = health.current;

    // Bullet 1: flies from 5 tiles away, hits the player after ~1.2 s.
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

    // Bullet 2 spawns right on the player, hits on the next frame — still inside the i-frame.
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

    // Past the 800 ms mark: the third bullet costs a heart as usual.
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
