/**
 * M12-T1 unit tests: radial level-up knockback wave and 0.6 s resume i-frame (ADR-021).
 */
import { describe, expect, it } from 'vitest';
import { BulletPool } from '../../assets/scripts/core/combat/bullets';
import { stepKnockback } from '../../assets/scripts/core/combat/knockback';
import { XP_TUNING } from '../../assets/scripts/core/enemies/tuning';
import { parseLevelData } from '../../assets/scripts/core/level/level-data';
import {
  LEVEL_UP_RESUME_IFRAME_MS,
  computeLevelUpKnockback,
  levelUpResumeIframeMs,
} from '../../assets/scripts/core/xp/level-up-wave';

const openLevel = parseLevelData({
  id: 'wave-arena',
  chapter: 1,
  room: 1,
  isBossRoom: false,
  size: { cols: 32, rows: 18 },
  tileSizePx: 16,
  playerStart: { x: 16, y: 9 },
  waves: [{ enemies: [{ role: 'chaser', at: { x: 18, y: 9 }, elite: false }] }],
  obstacles: [],
  doors: [],
});

describe('level-up resume i-frame', () => {
  it('matches the 600 ms (0.6 s) tuning value and supports tuning overrides', () => {
    expect(LEVEL_UP_RESUME_IFRAME_MS).toBe(600);
    expect(LEVEL_UP_RESUME_IFRAME_MS).toBe(XP_TUNING.levelUpWave.resumeInvulnerabilityMs);
    expect(
      levelUpResumeIframeMs({ ...XP_TUNING.levelUpWave, resumeInvulnerabilityMs: 750 }),
    ).toBe(750);
  });
});

describe('computeLevelUpKnockback', () => {
  it('pushes nearby enemies radially away from the player and leaves distant enemies untouched', () => {
    const player = { x: 16, y: 9 };
    const enemies = [
      { id: 'east', position: { x: 18, y: 9 } },
      { id: 'north', position: { x: 16, y: 6 } },
      { id: 'diag', position: { x: 13, y: 5 } }, // distance = 5 (on boundary)
      { id: 'far', position: { x: 25, y: 9 } }, // distance = 9 > radius 5
    ];

    const hits = computeLevelUpKnockback(player, enemies, 5, 3, 200);
    expect(hits.map((hit) => hit.id)).toEqual(['east', 'north', 'diag']);

    const east = hits.find((hit) => hit.id === 'east');
    expect(east?.knockback.direction.x).toBeCloseTo(1, 6);
    expect(east?.knockback.direction.y).toBeCloseTo(0, 6);
    expect(east?.knockback.remainingMs).toBe(200);
    expect(east?.knockback.speedTilesPerSecond).toBeCloseTo(15, 6);

    const north = hits.find((hit) => hit.id === 'north');
    expect(north?.knockback.direction.x).toBeCloseTo(0, 6);
    expect(north?.knockback.direction.y).toBeCloseTo(-1, 6);

    const diag = hits.find((hit) => hit.id === 'diag');
    expect(diag?.knockback.direction.x).toBeCloseTo(-0.6, 6);
    expect(diag?.knockback.direction.y).toBeCloseTo(-0.8, 6);

    // Integrates cleanly with stepKnockback to move the enemy outward by exactly 3 tiles.
    if (east === undefined) throw new Error('missing east hit');
    const stepped = stepKnockback({ x: 18, y: 9 }, east.knockback, 200, openLevel, 0.5, 0.4);
    expect(stepped.position.x).toBeCloseTo(21, 3);
    expect(stepped.position.y).toBeCloseTo(9, 3);
    expect(stepped.state).toBeNull();
  });

  it('separates enemies standing directly on top of the player deterministically', () => {
    const player = { x: 10, y: 10 };
    const hits = computeLevelUpKnockback(
      player,
      [
        { id: 'on-top-a', position: { x: 10, y: 10 } },
        { id: 'on-top-b', position: { x: 10, y: 10 } },
      ],
      5,
      2.5,
      200,
    );

    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      const len = Math.hypot(hit.knockback.direction.x, hit.knockback.direction.y);
      expect(len).toBeCloseTo(1, 6);
      expect(hit.knockback.remainingMs).toBe(200);
    }
    // Two coincident enemies get pushed along distinct radial angles.
    expect(hits[0]?.knockback.direction).not.toEqual(hits[1]?.knockback.direction);
  });

  it('never touches enemy bullets (preserving bullet-hell tension per ADR-021)', () => {
    const bullets = new BulletPool();
    bullets.spawn({
      position: { x: 17, y: 9 },
      velocity: { x: -4, y: 0 },
      radiusTiles: 0.25,
      damage: 1,
      owner: 'enemy',
      ttlMs: 3000,
    });

    const hits = computeLevelUpKnockback({ x: 16, y: 9 }, [{ id: 'e1', position: { x: 18, y: 9 } }]);
    expect(hits).toHaveLength(1);
    // Enemy bullet pool stays 100% intact.
    expect(bullets.size).toBe(1);
    expect(bullets.active()[0]?.owner).toBe('enemy');
  });

  it('returns an empty list when radius, distance, or duration is non-positive', () => {
    const enemies = [{ id: 'e1', position: { x: 17, y: 9 } }];
    expect(computeLevelUpKnockback({ x: 16, y: 9 }, enemies, 0, 3, 200)).toEqual([]);
    expect(computeLevelUpKnockback({ x: 16, y: 9 }, enemies, 5, 0, 200)).toEqual([]);
    expect(computeLevelUpKnockback({ x: 16, y: 9 }, enemies, 5, 3, 0)).toEqual([]);
  });
});
