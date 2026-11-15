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
  it('thu hồi đạn đang sống ngay trong frame, không chờ update', () => {
    const pool = new BulletPool();
    const bullet = spawnAt(pool, { x: 1, y: 1 });
    spawnAt(pool, { x: 2, y: 2 });

    expect(pool.consume(bullet.id)).toBe(true);

    expect(pool.size).toBe(1);
    expect(pool.active().map((live) => live.id)).not.toContain(bullet.id);

    // Viên còn lại không bị dịch chuyển bởi việc thu hồi.
    pool.update(100);
    expect(pool.size).toBe(1);
  });

  it('trả false với id không có trong pool, và không đụng đạn khác', () => {
    const pool = new BulletPool();
    const bullet = spawnAt(pool, { x: 1, y: 1 });

    expect(pool.consume(bullet.id + 1000)).toBe(false);
    expect(pool.consume(-1)).toBe(false);
    expect(pool.consume(0)).toBe(false);

    expect(pool.size).toBe(1);
    expect(pool.active()[0]?.id).toBe(bullet.id);
  });

  it('id đã consume không sống lại: gọi lần hai vẫn false', () => {
    const pool = new BulletPool();
    const first = spawnAt(pool, { x: 0, y: 0 });
    // Chụp id ngay: `spawn` trả về chính slot của pool, slot đó sẽ bị tái dùng.
    const firstId = first.id;

    expect(pool.consume(firstId)).toBe(true);
    expect(pool.consume(firstId)).toBe(false);

    // Slot được tái dùng nhưng id mới — id cũ không quay lại.
    const second = spawnAt(pool, { x: 0, y: 0 });
    expect(second.id).toBeGreaterThan(firstId);
    expect(pool.active().map((bullet) => bullet.id)).toEqual([second.id]);
  });

  it('giữ thứ tự cũ → mới của các viên còn lại', () => {
    const pool = new BulletPool();
    const ids = [1, 2, 3, 4, 5].map((damage) => spawnAt(pool, { x: damage, y: 0 }, damage).id);

    expect(pool.consume(ids[1] ?? -1)).toBe(true);
    expect(pool.consume(ids[3] ?? -1)).toBe(true);

    expect(pool.active().map((bullet) => bullet.id)).toEqual([ids[0], ids[2], ids[4]]);
  });

  it('thu hồi an toàn khi duyệt danh sách id chụp trước (không bỏ sót viên nào)', () => {
    const pool = new BulletPool(16);
    for (let index = 0; index < 10; index += 1) spawnAt(pool, { x: index, y: 0 }, index + 1);

    // Chụp id trước rồi consume trong vòng lặp: mảng live bị dồn nhưng vòng lặp
    // này chỉ đi trên mảng id, nên không viên nào bị nhảy cóc.
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
  it('bỏ đúng nhóm viên và trả về số lượng', () => {
    const pool = new BulletPool();
    spawnAt(pool, { x: 0, y: 0 }, 1);
    spawnAt(pool, { x: 0, y: 0 }, 2);
    spawnAt(pool, { x: 0, y: 0 }, 3);
    spawnAt(pool, { x: 0, y: 0 }, 4);

    const removed = pool.consumeWhere((bullet) => bullet.damage % 2 === 0);

    expect(removed).toBe(2);
    expect(pool.snapshot().map((bullet) => bullet.damage)).toEqual([1, 3]);
  });

  it('predicate không khớp gì thì trả 0 và không đụng pool', () => {
    const pool = new BulletPool();
    spawnAt(pool, { x: 0, y: 0 });
    spawnAt(pool, { x: 1, y: 0 });

    expect(pool.consumeWhere(() => false)).toBe(0);
    expect(pool.size).toBe(2);
  });

  it('bỏ tất cả trong một lượt (dùng cho dọn phòng)', () => {
    const pool = new BulletPool();
    for (let index = 0; index < 5; index += 1) spawnAt(pool, { x: index, y: 0 });

    expect(pool.consumeWhere(() => true)).toBe(5);
    expect(pool.size).toBe(0);
  });

  it('gom id trúng trong lúc duyệt rồi consume một lần — không consume giữa vòng lặp', () => {
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

describe('BulletPool — sức chứa sau nhiều chu kỳ consume/spawn', () => {
  it('không bao giờ vượt capacity dù spawn và consume liên tục', () => {
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

  it('slot consume được tái dùng, không cấp phát mới', () => {
    const pool = new BulletPool(2);
    const first = spawnAt(pool, { x: 0, y: 0 });
    const second = spawnAt(pool, { x: 1, y: 0 });
    expect(pool.size).toBe(2);

    pool.consume(first.id);
    const third = spawnAt(pool, { x: 2, y: 0 });

    // Capacity 2: phát thứ ba phải dùng lại slot vừa thu hồi, size vẫn là 2.
    expect(pool.size).toBe(2);
    expect(third.id).toBeGreaterThan(second.id);
    expect(pool.snapshot().map((bullet) => bullet.damage)).toEqual([1, 1]);
  });
});
