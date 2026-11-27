/**
 * Unit tests — Ninja exclusive-skill runtime (M20, ADR-027; #84).
 *
 * The hooks (trigger rules + numbers) are pinned by the acceptance test and
 * `classes/ninja.test`-style dispatch checks; this file covers the stateful half the sim and the
 * Cocos combat loop both drive: clone fire cadence/lifetime, venom cloud ticks, the radial kunai
 * spread, and the smoke zone's two area queries.
 */
import { describe, expect, it } from 'vitest';
import type { ClassSkillEffect } from '../../assets/scripts/core/skills/class-skill-hooks';
import {
  NINJA_CLONE_SKILL,
  NINJA_KUNAI_SKILL,
  NINJA_SMOKE_SKILL,
  NINJA_VENOM_SKILL,
  NinjaSkillRuntime,
  type NinjaApplyContext,
  type NinjaTarget,
} from '../../assets/scripts/core/skills/ninja-runtime';
import { CLASS_SKILLS_TUNING } from '../../assets/scripts/core/enemies/tuning';

const STACK = 1;
const TUNING = CLASS_SKILLS_TUNING.ninja;
const STEP_MS = 16;

const STATS: NinjaApplyContext = {
  shotDamage: 10,
  critMultiplier: 2,
  aimDirection: { x: 1, y: 0 },
};

function at(x: number, y: number): NinjaTarget {
  return { id: 'e1', position: { x, y }, radiusTiles: 0.4 };
}

function cloneEffect(overrides: Partial<ClassSkillEffect> = {}): ClassSkillEffect {
  return {
    kind: 'spawn',
    skillId: NINJA_CLONE_SKILL,
    position: { x: 0, y: 0 },
    amount: TUNING.shadowClone.damageRatioByStack[STACK - 1]!,
    durationMs: TUNING.shadowClone.durationMs,
    ...overrides,
  };
}

function venomEffect(): ClassSkillEffect {
  return {
    kind: 'spawn',
    skillId: NINJA_VENOM_SKILL,
    position: { x: 0, y: 0 },
    amount: TUNING.venomShuriken.damageByStack[STACK - 1]!,
    radiusTiles: TUNING.venomShuriken.radiusTilesByStack[STACK - 1]!,
    durationMs: TUNING.venomShuriken.durationMsByStack[STACK - 1]!,
  };
}

function kunaiEffects(count: number): ClassSkillEffect[] {
  return Array.from({ length: count }, () => ({
    kind: 'spawn' as const,
    skillId: NINJA_KUNAI_SKILL,
    position: { x: 0, y: 0 },
    amount: TUNING.kunaiBurst.damage,
  }));
}

function smokeEffects(): ClassSkillEffect[] {
  const radiusTiles = TUNING.smokeBomb.radiusTilesByStack[STACK - 1]!;
  const durationMs = TUNING.smokeBomb.durationMsByStack[STACK - 1]!;
  return [
    {
      kind: 'status',
      skillId: NINJA_SMOKE_SKILL,
      position: { x: 0, y: 0 },
      amount: TUNING.smokeBomb.slowByStack[STACK - 1]!,
      radiusTiles,
      durationMs,
    },
    {
      kind: 'buff',
      skillId: NINJA_SMOKE_SKILL,
      position: { x: 0, y: 0 },
      amount: TUNING.smokeBomb.fireRateBonusByStack[STACK - 1]!,
      radiusTiles,
      durationMs,
    },
  ];
}

describe('NinjaSkillRuntime — shadow clone', () => {
  it('spawns one stationary decoy that fires a fraction-of-shot-damage shuriken at a nearby target', () => {
    const runtime = new NinjaSkillRuntime(TUNING);
    runtime.applyEffects([cloneEffect()], 0, STATS);
    expect(runtime.activeClones).toHaveLength(1);

    const hits = runtime.step(STEP_MS, STEP_MS, [at(0.5, 0)], STATS);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.skillId).toBe(NINJA_CLONE_SKILL);
    expect(hits[0]?.amount).toBeCloseTo(10 * 0.5, 6);
    expect(hits[0]?.crit).toBe(false);
  });

  it('applies the crit multiplier when the Evolution marks the clone as always-crit', () => {
    const runtime = new NinjaSkillRuntime(TUNING);
    runtime.applyEffects([cloneEffect({ crit: true })], 0, STATS);
    const hits = runtime.step(STEP_MS, STEP_MS, [at(0.5, 0)], STATS);
    expect(hits[0]?.crit).toBe(true);
    expect(hits[0]?.amount).toBeCloseTo(10 * 0.5 * 2, 6);
  });

  it('respects its fire cadence and disappears after its lifetime', () => {
    const runtime = new NinjaSkillRuntime(TUNING);
    runtime.applyEffects([cloneEffect()], 0, STATS);

    // First shuriken at t=16; the 700 ms cadence means no second one on the next frame.
    runtime.step(STEP_MS, STEP_MS, [at(0.5, 0)], STATS);
    expect(runtime.step(2 * STEP_MS, STEP_MS, [at(0.5, 0)], STATS)).toHaveLength(0);

    runtime.step(TUNING.shadowClone.durationMs, STEP_MS, [at(0.5, 0)], STATS);
    expect(runtime.activeClones).toHaveLength(0);
  });
});

describe('NinjaSkillRuntime — venom shuriken', () => {
  it('flies toward the aim, bursts into a cloud, and the cloud ticks damage on a cadence', () => {
    const runtime = new NinjaSkillRuntime(TUNING);
    runtime.applyEffects([venomEffect()], 0, STATS);
    expect(runtime.activeProjectiles).toHaveLength(1);

    // The first step already reaches the close target: the shuriken bursts into a cloud.
    runtime.step(STEP_MS, STEP_MS, [at(0.4, 0)], STATS);
    expect(runtime.activeClouds).toHaveLength(1);

    // No damage until the first cloud tick.
    expect(runtime.step(STEP_MS + 100, STEP_MS, [at(0.4, 0)], STATS)).toHaveLength(0);
    const ticked = runtime.step(
      STEP_MS + TUNING.venomShuriken.damageTickMs,
      STEP_MS,
      [at(0.4, 0)],
      STATS,
    );
    expect(ticked).toHaveLength(1);
    expect(ticked[0]?.skillId).toBe(NINJA_VENOM_SKILL);
    expect(ticked[0]?.amount).toBeCloseTo(TUNING.venomShuriken.damageByStack[STACK - 1]!, 6);
  });

  it('expires the cloud at the end of its lifetime', () => {
    const runtime = new NinjaSkillRuntime(TUNING);
    runtime.applyEffects([venomEffect()], 0, STATS);
    runtime.step(STEP_MS, STEP_MS, [at(0.4, 0)], STATS);
    runtime.step(TUNING.venomShuriken.durationMsByStack[STACK - 1]! + STEP_MS, STEP_MS, [], STATS);
    expect(runtime.activeClouds).toHaveLength(0);
  });
});

describe('NinjaSkillRuntime — kunai burst', () => {
  it('spawns one kunai per effect, evenly radial, and each kunai damages once', () => {
    const runtime = new NinjaSkillRuntime(TUNING);
    runtime.applyEffects(kunaiEffects(4), 0, STATS);
    const projectiles = runtime.activeProjectiles;
    expect(projectiles).toHaveLength(4);
    expect(projectiles.map((p) => p.skillId)).toEqual([
      NINJA_KUNAI_SKILL,
      NINJA_KUNAI_SKILL,
      NINJA_KUNAI_SKILL,
      NINJA_KUNAI_SKILL,
    ]);
    // Evenly spread over a full circle: +x, +y, -x, -y.
    expect(projectiles[0]?.velocity.y).toBeCloseTo(0, 6);
    expect(projectiles[1]?.velocity.x).toBeCloseTo(0, 6);
    expect(projectiles[2]?.velocity.x).toBeLessThan(0);
    expect(projectiles[3]?.velocity.y).toBeLessThan(0);

    const firstStep = runtime.step(STEP_MS, STEP_MS, [at(0.8, 0)], STATS);
    expect(firstStep).toHaveLength(0);
    const hits = runtime.step(2 * STEP_MS, STEP_MS, [at(0.8, 0)], STATS);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.skillId).toBe(NINJA_KUNAI_SKILL);
    expect(hits[0]?.amount).toBeCloseTo(TUNING.kunaiBurst.damage, 6);
  });

  it('stops after its short lifetime when nothing is hit', () => {
    const runtime = new NinjaSkillRuntime(TUNING);
    runtime.applyEffects(kunaiEffects(4), 0, STATS);
    runtime.step(TUNING.kunaiBurst.ttlMs + STEP_MS, TUNING.kunaiBurst.ttlMs + STEP_MS, [], STATS);
    expect(runtime.activeProjectiles).toHaveLength(0);
  });
});

describe('NinjaSkillRuntime — smoke bomb', () => {
  it('slows enemies inside and speeds up player fire only while inside and alive', () => {
    const runtime = new NinjaSkillRuntime(TUNING);
    runtime.applyEffects(smokeEffects(), 0, STATS);

    const inside = { x: 1, y: 0 };
    const outside = { x: 5, y: 0 };
    expect(runtime.enemySpeedMultiplierAt(inside, 100)).toBeCloseTo(0.55, 6);
    expect(runtime.fireRateBonusAt(inside, 100)).toBeCloseTo(0.3, 6);
    expect(runtime.enemySpeedMultiplierAt(outside, 100)).toBe(1);
    expect(runtime.fireRateBonusAt(outside, 100)).toBe(0);

    const expired = TUNING.smokeBomb.durationMsByStack[STACK - 1]! + 1;
    expect(runtime.enemySpeedMultiplierAt(inside, expired)).toBe(1);
    expect(runtime.fireRateBonusAt(inside, expired)).toBe(0);
  });
});

describe('NinjaSkillRuntime — lifecycle', () => {
  it('reset drops clones, projectiles, clouds and smoke zones', () => {
    const runtime = new NinjaSkillRuntime(TUNING);
    runtime.applyEffects([cloneEffect(), venomEffect(), ...kunaiEffects(2)], 0, STATS);
    runtime.applyEffects(smokeEffects(), 0, STATS);
    expect(runtime.isEmpty).toBe(false);
    runtime.reset();
    expect(runtime.isEmpty).toBe(true);
  });
});
