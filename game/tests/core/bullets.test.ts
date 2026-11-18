import { describe, expect, it } from 'vitest';
import { BulletPool, type Bullet } from '../../assets/scripts/core/combat/bullets';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';

const base = {
  radiusTiles: 0.15,
  damage: 1,
  owner: 'player' as const,
  ttlMs: 1000,
};

function spawnAt(pool: BulletPool, position: Vec2, damage = 1): Bullet {
  return pool.spawn({ ...base, position, velocity: { x: 0, y: 0 }, damage });
}

describe('BulletPool.consume', () => {
  it('retires a live bullet within the frame, without waiting for update', () => {
    const pool = new BulletPool();
    const bullet = spawnAt(pool, { x: 1, y: 1 });
    spawnAt(pool, { x: 2, y: 2 });

    expect(pool.consume(bullet.id)).toBe(true);

    expect(pool.size).toBe(1);
    expect(pool.active().map((live) => live.id)).not.toContain(bullet.id);

    // The remaining bullet is not shifted by the retire.
    pool.update(100);
    expect(pool.size).toBe(1);
  });

  it('returns false for an id not in the pool, and touches no other bullet', () => {
    const pool = new BulletPool();
    const bullet = spawnAt(pool, { x: 1, y: 1 });

    expect(pool.consume(bullet.id + 1000)).toBe(false);
    expect(pool.consume(-1)).toBe(false);
    expect(pool.consume(0)).toBe(false);

    expect(pool.size).toBe(1);
    expect(pool.active()[0]?.id).toBe(bullet.id);
  });

  it('a consumed id does not come back: a second call still returns false', () => {
    const pool = new BulletPool();
    const first = spawnAt(pool, { x: 0, y: 0 });
    // Capture the id now: `spawn` returns the pool slot itself, and that slot will be reused.
    const firstId = first.id;

    expect(pool.consume(firstId)).toBe(true);
    expect(pool.consume(firstId)).toBe(false);

    // The slot is reused but with a new id — the old id does not return.
    const second = spawnAt(pool, { x: 0, y: 0 });
    expect(second.id).toBeGreaterThan(firstId);
    expect(pool.active().map((bullet) => bullet.id)).toEqual([second.id]);
  });

  it('keeps oldest → newest order for the remaining bullets', () => {
    const pool = new BulletPool();
    const ids = [1, 2, 3, 4, 5].map((damage) => spawnAt(pool, { x: damage, y: 0 }, damage).id);

    expect(pool.consume(ids[1] ?? -1)).toBe(true);
    expect(pool.consume(ids[3] ?? -1)).toBe(true);

    expect(pool.active().map((bullet) => bullet.id)).toEqual([ids[0], ids[2], ids[4]]);
  });

  it('retiring is safe while iterating a captured id list (no bullet is skipped)', () => {
    const pool = new BulletPool(16);
    for (let index = 0; index < 10; index += 1) spawnAt(pool, { x: index, y: 0 }, index + 1);

    // Capture ids first then consume in a loop: the live array is compacted but this loop
    // only walks the id array, so no bullet is skipped.
    const ids = pool.snapshot().map((bullet) => bullet.id);
    let removed = 0;
    for (const id of ids) {
      if (pool.consume(id)) removed += 1;
    }

    expect(removed).toBe(10);
    expect(pool.size).toBe(0);
    expect(pool.active()).toEqual([]);
  });
});

describe('BulletPool.consumeWhere', () => {
  it('drops exactly the matching group and returns the count', () => {
    const pool = new BulletPool();
    spawnAt(pool, { x: 0, y: 0 }, 1);
    spawnAt(pool, { x: 0, y: 0 }, 2);
    spawnAt(pool, { x: 0, y: 0 }, 3);
    spawnAt(pool, { x: 0, y: 0 }, 4);

    const removed = pool.consumeWhere((bullet) => bullet.damage % 2 === 0);

    expect(removed).toBe(2);
    expect(pool.snapshot().map((bullet) => bullet.damage)).toEqual([1, 3]);
  });

  it('a predicate that matches nothing returns 0 and touches no pool state', () => {
    const pool = new BulletPool();
    spawnAt(pool, { x: 0, y: 0 });
    spawnAt(pool, { x: 1, y: 0 });

    expect(pool.consumeWhere(() => false)).toBe(0);
    expect(pool.size).toBe(2);
  });

  it('drops everything in one pass (used for room cleanup)', () => {
    const pool = new BulletPool();
    for (let index = 0; index < 5; index += 1) spawnAt(pool, { x: index, y: 0 });

    expect(pool.consumeWhere(() => true)).toBe(5);
    expect(pool.size).toBe(0);
  });

  it('collect hit ids while iterating then consume once — never consume mid-loop', () => {
    const pool = new BulletPool(8);
    for (let index = 0; index < 6; index += 1) {
      pool.spawn({
        ...base,
        position: { x: index, y: 0 },
        velocity: { x: 1, y: 0 },
        damage: index + 1,
      });
    }

    const hit = new Set<number>();
    for (const bullet of pool.active()) {
      if (bullet.damage > 3) hit.add(bullet.id);
    }

    expect(pool.consumeWhere((bullet) => hit.has(bullet.id))).toBe(3);
    expect(pool.snapshot().map((bullet) => bullet.damage)).toEqual([1, 2, 3]);
  });
});

describe('BulletPool — capacity across many consume/spawn cycles', () => {
  it('never exceeds capacity even with continuous spawn and consume', () => {
    const capacity = 8;
    const pool = new BulletPool(capacity);

    for (let cycle = 0; cycle < 500; cycle += 1) {
      spawnAt(pool, { x: cycle, y: 0 });

      if (cycle % 2 === 0) {
        const [oldest] = pool.active();
        if (oldest !== undefined) pool.consume(oldest.id);
      }
      if (cycle % 7 === 0) {
        pool.consumeWhere((bullet) => bullet.damage === 1 && bullet.id % 3 === 0);
      }

      expect(pool.size).toBeLessThanOrEqual(capacity);
    }

    expect(pool.active().length).toBe(pool.size);
    expect(pool.active().length).toBeLessThanOrEqual(capacity);
  });

  it('a consumed slot is reused, not newly allocated', () => {
    const pool = new BulletPool(2);
    const first = spawnAt(pool, { x: 0, y: 0 });
    const second = spawnAt(pool, { x: 1, y: 0 });
    expect(pool.size).toBe(2);

    pool.consume(first.id);
    const third = spawnAt(pool, { x: 2, y: 0 });

    // Capacity 2: the third shot must reuse the slot just retired, size stays 2.
    expect(pool.size).toBe(2);
    expect(third.id).toBeGreaterThan(second.id);
    expect(pool.snapshot().map((bullet) => bullet.damage)).toEqual([1, 1]);
  });
});
