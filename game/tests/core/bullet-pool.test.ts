import { describe, expect, it } from 'vitest';
import { BulletPool } from '../../assets/scripts/core/combat/bullets';
import { fireEnemyVolley } from '../../assets/scripts/core/combat/enemy-fire';

const CAPACITY = 256;

function spawnShot(pool: BulletPool, index: number): void {
  pool.spawn({
    position: { x: index % 32, y: (index % 18) + 1 },
    velocity: { x: 0, y: 4 },
    radiusTiles: 0.15,
    damage: 1,
    owner: index % 3 === 0 ? 'enemy' : 'player',
    ttlMs: 500,
  });
}

describe('BulletPool — 1000 shots without a leak', () => {
  it('hard capacity: active + recycled never exceeds capacity', () => {
    const pool = new BulletPool(CAPACITY);
    const ids = new Set<number>();

    for (let index = 0; index < 1000; index += 1) {
      spawnShot(pool, index);
      ids.add(pool.active()[pool.active().length - 1]?.id ?? 0);

      // Every 5 shots simulate a few frames so TTL retires a slot.
      if (index % 5 === 0) {
        for (let frame = 0; frame < 4; frame += 1) pool.update(16);
      }

      expect(pool.size).toBeLessThanOrEqual(CAPACITY);
      expect(pool.size + pool.recycledCount).toBeLessThanOrEqual(CAPACITY);
    }

    expect(ids.size).toBe(1000);
  });

  it('slots are reused: the same object comes back after the old bullet TTL expires', () => {
    const pool = new BulletPool(2);
    const first = pool.spawn({
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      radiusTiles: 0.15,
      damage: 1,
      owner: 'player',
      ttlMs: 100,
    });

    pool.update(100);
    expect(pool.active()).toHaveLength(0);
    expect(pool.recycledCount).toBe(1);
    const firstId = first.id;

    const second = pool.spawn({
      position: { x: 1, y: 1 },
      velocity: { x: 0, y: 0 },
      radiusTiles: 0.15,
      damage: 1,
      owner: 'player',
      ttlMs: 100,
    });

    // The same object: no new slot is allocated for the second shot.
    expect(second).toBe(first);
    expect(second.id).toBeGreaterThan(firstId);
  });

  it('a full pool pushes out the oldest bullet, slot count stays fixed after 1000 continuous shots', () => {
    const pool = new BulletPool(16);

    for (let index = 0; index < 1000; index += 1) spawnShot(pool, index);

    expect(pool.size).toBe(16);
    expect(pool.recycledCount).toBe(0);
    expect(pool.size + pool.recycledCount).toBe(16);

    // The newest bullet is always present, the oldest has lost its slot.
    const ids = pool.active().map((bullet) => bullet.id);
    expect(ids[ids.length - 1]).toBe(1000);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('1000 elite caster volleys stay within capacity and can be fully cleared', () => {
    const pool = new BulletPool(CAPACITY);

    for (let volley = 0; volley < 1000; volley += 1) {
      fireEnemyVolley({
        pool,
        from: { x: 16, y: 2 },
        to: { x: 16, y: 16 },
        damage: 1,
        angles: [-0.22, 0, 0.22],
      });
      pool.update(16);
      expect(pool.size).toBeLessThanOrEqual(CAPACITY);
      expect(pool.size + pool.recycledCount).toBeLessThanOrEqual(CAPACITY);
    }

    pool.clear();
    expect(pool.size).toBe(0);
    expect(pool.size + pool.recycledCount).toBeLessThanOrEqual(CAPACITY);
  });
});
