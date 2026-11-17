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

describe('BulletPool — 1000 phát không rò rỉ', () => {
  it('sức chứa cứng: active + recycled không bao giờ vượt capacity', () => {
    const pool = new BulletPool(CAPACITY);
    const ids = new Set<number>();

    for (let index = 0; index < 1000; index += 1) {
      spawnShot(pool, index);
      ids.add(pool.active()[pool.active().length - 1]?.id ?? 0);

      // Mỗi 5 phát thì mô phỏng vài frame để TTL thu hồi slot.
      if (index % 5 === 0) {
        for (let frame = 0; frame < 4; frame += 1) pool.update(16);
      }

      expect(pool.size).toBeLessThanOrEqual(CAPACITY);
      expect(pool.size + pool.recycledCount).toBeLessThanOrEqual(CAPACITY);
    }

    expect(ids.size).toBe(1000);
  });

  it('slot được tái dùng: cùng object trả về sau khi viên cũ hết TTL', () => {
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

    // Cùng một object: không cấp phát slot mới cho phát thứ hai.
    expect(second).toBe(first);
    expect(second.id).toBeGreaterThan(firstId);
  });

  it('pool đầy thì đẩy viên cũ nhất, số slot giữ nguyên sau 1000 phát liên tục', () => {
    const pool = new BulletPool(16);

    for (let index = 0; index < 1000; index += 1) spawnShot(pool, index);

    expect(pool.size).toBe(16);
    expect(pool.recycledCount).toBe(0);
    expect(pool.size + pool.recycledCount).toBe(16);

    // Viên mới nhất luôn còn, viên cũ nhất đã bị lấy slot.
    const ids = pool.active().map((bullet) => bullet.id);
    expect(ids[ids.length - 1]).toBe(1000);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('1000 loạt đạn của caster elite vẫn nằm trong capacity và dọn sạch được', () => {
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
