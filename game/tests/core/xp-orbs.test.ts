/**
 * M12-T1 unit tests: pooled XP orbs — zero-leak capacity invariant, scatter glide, magnetic
 * acceleration & pickup, and full-room auto-vacuum on room clear.
 */
import { describe, expect, it } from 'vitest';
import { XP_TUNING, type XpOrbsTuning } from '../../assets/scripts/core/enemies/tuning';
import { XpOrbPool } from '../../assets/scripts/core/xp/xp-orbs';

describe('XpOrbPool — pooling and zero-leak invariant', () => {
  it('pre-allocates all slots and never leaks over 2,000 spawns and collections', () => {
    const pool = new XpOrbPool({ ...XP_TUNING.orbs, poolCapacity: 32 });
    expect(pool.size).toBe(0);
    expect(pool.recycledCount).toBe(32);

    let totalSpawnedXp = 0;
    let totalCollectedXp = 0;

    for (let wave = 0; wave < 50; wave += 1) {
      for (let i = 0; i < 40; i += 1) {
        pool.spawn({ position: { x: 10 + (i % 5), y: 10 }, value: 10 });
        totalSpawnedXp += 10;
        expect(pool.size + pool.recycledCount).toBe(32);
        expect(pool.size).toBeLessThanOrEqual(32);
      }
      // Vacuum everything cleanly to the player.
      for (let step = 0; step < 120 && pool.size > 0; step += 1) {
        totalCollectedXp += pool.step(1 / 60, { x: 10, y: 10 }, true);
      }
      expect(pool.size).toBe(0);
      expect(pool.recycledCount).toBe(32);
    }

    // Even when spawns overflowed capacity (40 > 32), oldest XP was merged so 0 XP was lost.
    expect(totalCollectedXp).toBe(totalSpawnedXp);
  });

  it('ignores non-positive or non-finite XP drops (e.g. 0-XP splitling)', () => {
    const pool = new XpOrbPool();
    expect(pool.spawn({ position: { x: 5, y: 5 }, value: 0 })).toBeNull();
    expect(pool.spawn({ position: { x: 5, y: 5 }, value: -5 })).toBeNull();
    expect(pool.spawn({ position: { x: 5, y: 5 }, value: Number.NaN })).toBeNull();
    expect(pool.size).toBe(0);
  });

  it('clear() recycles every active orb without losing capacity', () => {
    const pool = new XpOrbPool({ ...XP_TUNING.orbs, poolCapacity: 16 });
    for (let i = 0; i < 10; i += 1) {
      pool.spawn({ position: { x: i, y: 2 }, value: 12 });
    }
    expect(pool.size).toBe(10);
    pool.clear();
    expect(pool.size).toBe(0);
    expect(pool.recycledCount).toBe(16);
    expect(pool.activeOrbs).toHaveLength(0);
  });
});

describe('XpOrbPool — scatter, magnet acceleration, and pickup', () => {
  it('scatters briefly on drop and settles idle when outside magnet radius', () => {
    const pool = new XpOrbPool();
    const player = { x: 30, y: 30 };
    const orb = pool.spawn({
      position: { x: 5, y: 5 },
      value: 15,
      scatterDir: { x: 1, y: 0 },
    });
    expect(orb).not.toBeNull();
    expect(orb?.phase).toBe('scatter');

    // Step through the scatter window.
    const collected = pool.step(0.05, player, false);
    expect(collected).toBe(0);
    expect(pool.activeOrbs[0]?.position.x).toBeGreaterThan(5);

    for (let i = 0; i < 20; i += 1) {
      expect(pool.step(0.05, player, false)).toBe(0);
    }

    const settled = pool.activeOrbs[0];
    expect(settled?.phase).toBe('idle');
    const settledX = settled?.position.x ?? 0;

    // Outside magnet radius, orb stays put.
    pool.step(0.5, player, false);
    expect(pool.activeOrbs[0]?.position.x).toBe(settledX);
  });

  it('accelerates smoothly toward the player inside magnet radius and collects within pickup radius', () => {
    const tuning: XpOrbsTuning = {
      ...XP_TUNING.orbs,
      scatterDurationMs: 0,
      magnetRadiusTiles: 5,
      pickupRadiusTiles: 0.6,
    };
    const pool = new XpOrbPool(tuning);
    const player = { x: 10, y: 10 };
    pool.spawn({ position: { x: 14, y: 10 }, value: 25 });

    // Distance 4 <= magnetRadius 5: enters magnet phase and speeds up frame by frame.
    expect(pool.step(1 / 60, player, false)).toBe(0);
    const speed1 = pool.activeOrbs[0]?.pullSpeed ?? 0;
    const dist1 = Math.hypot((pool.activeOrbs[0]?.position.x ?? 0) - player.x, 0);
    expect(pool.activeOrbs[0]?.phase).toBe('magnet');
    expect(speed1).toBeGreaterThan(0);

    expect(pool.step(1 / 60, player, false)).toBe(0);
    const speed2 = pool.activeOrbs[0]?.pullSpeed ?? 0;
    const dist2 = Math.hypot((pool.activeOrbs[0]?.position.x ?? 0) - player.x, 0);
    expect(speed2).toBeGreaterThan(speed1);
    expect(dist2).toBeLessThan(dist1);

    // Continue stepping until collected.
    let collected = 0;
    for (let frame = 0; frame < 120 && pool.size > 0; frame += 1) {
      collected += pool.step(1 / 60, player, false);
    }
    expect(collected).toBe(25);
    expect(pool.size).toBe(0);
    expect(pool.lastCollectedCount).toBe(1);
  });
});

describe('XpOrbPool — full-room auto-vacuum on room clear', () => {
  it('vacuums orbs from opposite corners of a 64×36 room when roomCleared is true', () => {
    const pool = new XpOrbPool();
    const player = { x: 2, y: 2 };

    // Spawn orbs far outside magnet radius across a 64×36 room.
    pool.spawn({ position: { x: 62, y: 34 }, value: 30 });
    pool.spawn({ position: { x: 60, y: 3 }, value: 20 });
    pool.spawn({ position: { x: 3, y: 34 }, value: 15 });

    // While room is active, none of them magnetize or get collected.
    for (let i = 0; i < 60; i += 1) {
      expect(pool.step(1 / 60, player, false)).toBe(0);
    }
    expect(pool.size).toBe(3);

    // Room clears: every orb enters vacuum phase immediately and flies to the player.
    let collected = 0;
    collected += pool.step(1 / 60, player, true);
    for (const orb of pool.activeOrbs) {
      expect(orb.phase).toBe('vacuum');
    }

    for (let frame = 0; frame < 360 && pool.size > 0; frame += 1) {
      collected += pool.step(1 / 60, player, true);
    }

    expect(pool.size).toBe(0);
    expect(collected).toBe(65);
  });
});
