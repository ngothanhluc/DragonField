/**
 * Unit coverage for the Mage class skills beyond the acceptance seam (#86): geometry, tuning
 * wiring, targeting fallbacks, and the events that must stay no-ops. The acceptance test owns the
 * end-to-end behaviour; these pin the individual helpers.
 */
import { describe, expect, it } from 'vitest';
import { CLASS_SKILLS_TUNING } from '../../assets/scripts/core/enemies/tuning';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import type { SeededRng } from '../../assets/scripts/core/rng';
import type {
  ClassSkillEffect,
  ClassSkillEventName,
} from '../../assets/scripts/core/skills/class-skill-hooks';
import { dispatchClassSkillEvent } from '../../assets/scripts/core/skills/class-skills';
import { frostOrbPositions } from '../../assets/scripts/core/skills/classes/mage';

const M = CLASS_SKILLS_TUNING.mage;
const CENTER: Vec2 = { x: 20, y: 10 };

function stacks(owned: Readonly<Record<string, number>>) {
  return (id: string): number => owned[id] ?? 0;
}

function fixedRng(value: number): SeededRng {
  return { next: () => value } as unknown as SeededRng;
}

function fire(
  event: ClassSkillEventName,
  owned: Readonly<Record<string, number>>,
  context: Record<string, unknown> = {},
): readonly ClassSkillEffect[] {
  return dispatchClassSkillEvent(event, 'mage', stacks(owned), {
    damage: 10,
    rng: fixedRng(0.99),
    ...context,
  });
}

describe('mage frost orb geometry', () => {
  it('places 2 (+1/stack) orbs evenly on the tuning radius', () => {
    for (const [count, orbCount] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ] as const) {
      const orbs = frostOrbPositions(count, false, 0, CENTER);
      expect(orbs).toHaveLength(orbCount);
      for (const orb of orbs) {
        expect(Math.hypot(orb.x - CENTER.x, orb.y - CENTER.y)).toBeCloseTo(
          M.frostOrbs.radiusTiles,
          5,
        );
      }
      const angles = orbs.map((orb) => Math.atan2(orb.y - CENTER.y, orb.x - CENTER.x));
      for (let index = 1; index < angles.length; index += 1) {
        const gap = (((angles[index]! - angles[index - 1]! + Math.PI * 2) % (Math.PI * 2)) +
          Math.PI * 2) % (Math.PI * 2);
        expect(gap).toBeCloseTo((Math.PI * 2) / orbCount, 5);
      }
    }
  });

  it('returns an empty orbit at 0 stacks', () => {
    expect(frostOrbPositions(0, false, 0, CENTER)).toEqual([]);
    expect(frostOrbPositions(0, true, 500, CENTER)).toEqual([]);
  });
});

describe('mage meteor tuning', () => {
  it('emits a burn status on the meteor AoE with tuned numbers', () => {
    const effects = fire('tick', { 'mage-meteor': 2 }, {
      nowMs: M.meteor.intervalMs - M.meteor.intervalStepMs,
      dtMs: 100,
      position: CENTER,
      enemies: [{ id: 'a', position: { x: 30, y: 10 } }],
    });
    const burn = effects.find((effect) => effect.kind === 'status');
    expect(burn).toBeDefined();
    expect(burn?.radiusTiles).toBe(M.meteor.radiusTiles);
    expect(burn?.burnDps).toBeCloseTo(10 * M.meteor.burnDpsRatio, 5);
    expect(burn?.durationMs).toBe(M.meteor.burnDurationMs);
    expect(effects.find((effect) => effect.kind === 'damage')?.amount).toBeCloseTo(
      10 * M.meteor.damageRatio,
      5,
    );
  });
});

describe('mage storm strike targeting', () => {
  it('falls back to the struck enemy when it is alone', () => {
    const struck = { id: 'solo', position: { x: 4, y: 4 } };
    const effects = fire('onHit', { 'mage-storm-strike': 1 }, {
      rng: fixedRng(0),
      position: struck.position,
      targetPosition: struck.position,
      targetId: 'solo',
      shotCount: 1,
      enemies: [struck],
    });
    const bolt = effects.find((effect) => effect.kind === 'damage');
    expect(bolt?.targetId).toBe('solo');
    expect(bolt?.position).toEqual(struck.position);
  });
});

describe('mage arcane pulse cadence', () => {
  it('only fires on multiples of the tuned shot cadence', () => {
    const context = (shotCount: number) => ({
      position: CENTER,
      targetPosition: CENTER,
      targetId: 'struck',
      shotCount,
      enemies: [{ id: 'struck', position: CENTER }],
    });
    for (let shot = 1; shot < M.arcanePulse.shotEvery; shot += 1) {
      expect(fire('onHit', { 'mage-arcane-pulse': 1 }, context(shot))).toHaveLength(0);
    }
    const ring = fire('onHit', { 'mage-arcane-pulse': 1 }, context(M.arcanePulse.shotEvery));
    expect(ring[0]?.radiusTiles).toBe(M.arcanePulse.radiusTiles);
  });
});

describe('mage hooks stay quiet outside their events', () => {
  const everything = {
    'mage-meteor': 3,
    'mage-frost-orbs': 3,
    'mage-storm-strike': 3,
    'mage-arcane-pulse': 3,
    'mage-elemental-cataclysm': 1,
  };

  it('onShot / onKill / onDash / onActive request nothing', () => {
    for (const event of ['onShot', 'onKill', 'onDash', 'onActive'] as const) {
      expect(fire(event, everything, { position: CENTER, nowMs: 900 })).toEqual([]);
    }
  });

  it('tick needs a clock, enemies, damage and a position', () => {
    expect(fire('tick', everything, { dtMs: 16, position: CENTER })).toEqual([]);
    expect(
      fire('tick', everything, {
        dtMs: 16,
        nowMs: 900,
        position: CENTER,
        damage: 10,
        enemies: [{ id: 'a', position: CENTER }],
      }).length,
    ).toBeGreaterThan(0);
  });
});
