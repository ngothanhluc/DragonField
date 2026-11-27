/**
 * Cultivator class-skill runtime (M20, #87): the state the pure hooks cannot hold.
 *
 * The acceptance test pins the hooks' trigger rules and the sim's damage; this file pins the
 * runtime mechanics the acceptance test cannot see — dart reach, array slice ticks, wave pierce,
 * and above all the Qi shield absorb (fill → shield + radial waves, one hit absorbed, the second
 * hit lands, recharge).
 */
import { describe, expect, it } from 'vitest';
import { CLASS_SKILLS_TUNING } from '../../assets/scripts/core/enemies/tuning';
import type {
  ClassSkillEffect,
  ClassSkillStackSource,
} from '../../assets/scripts/core/skills/class-skill-hooks';
import {
  CultivatorSkillRuntime,
  type CultivatorTarget,
} from '../../assets/scripts/core/skills/cultivator-runtime';

const T = CLASS_SKILLS_TUNING.cultivator;

const ORBIT = 'cultivator-orbit-swords';
const ARRAY = 'cultivator-sword-array';
const QI = 'cultivator-sword-qi';
const BARRIER = 'cultivator-qi-barrier';
const EVOLUTION = 'cultivator-myriad-swords';

const PLAYER = { x: 10, y: 10 } as const;

function stacks(entries: Readonly<Record<string, number>>): ClassSkillStackSource {
  return (id) => entries[id] ?? 0;
}

function target(
  id: string,
  position: { x: number; y: number },
  radiusTiles = 0.4,
): CultivatorTarget {
  return { id, position, radiusTiles };
}

function effect(
  skillId: string,
  overrides: Partial<ClassSkillEffect> = {},
): ClassSkillEffect {
  return {
    kind: 'spawn',
    skillId,
    position: PLAYER,
    amount: 1,
    radiusTiles: 1,
    durationMs: 1000,
    ...overrides,
  };
}

const CONTEXT = { shotDamage: 10, critMultiplier: 2 } as const;

describe('orbit sword darts', () => {
  it('darts to the nearest enemy inside reach and returns no hit when nothing is in range', () => {
    const runtime = new CultivatorSkillRuntime(T, stacks({ [ORBIT]: 1 }));
    const reach = T.orbitSwords.reachTilesByStack[0]!;
    const amount = T.orbitSwords.damageRatioByStack[0]!;

    runtime.applyEffects(
      [
        effect(ORBIT, { amount, radiusTiles: reach }),
        effect(ORBIT, { amount, radiusTiles: reach }),
      ],
      0,
      CONTEXT,
    );
    const inRange = target('near', { x: PLAYER.x + reach * 0.5, y: PLAYER.y });
    const hits = runtime.step(16, 16, [inRange]);
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(hit.skillId).toBe(ORBIT);
      expect(hit.targetId).toBe('near');
      expect(hit.amount).toBeCloseTo(10 * amount, 6);
    }

    runtime.applyEffects([effect(ORBIT, { amount, radiusTiles: reach })], 100, CONTEXT);
    const far = target('far', { x: PLAYER.x + reach + 2, y: PLAYER.y });
    expect(runtime.step(116, 16, [far])).toHaveLength(0);
  });
});

describe('sword array', () => {
  it('slices every enemy inside on its tick and expires after its duration', () => {
    const runtime = new CultivatorSkillRuntime(T, stacks({ [ARRAY]: 1 }));
    const radius = T.swordArray.radiusTilesByStack[0]!;
    const duration = T.swordArray.durationMsByStack[0]!;
    const tickMs = T.swordArray.tickMs;

    runtime.applyEffects(
      [effect(ARRAY, { radiusTiles: radius, durationMs: duration, amount: 0.4 })],
      0,
      CONTEXT,
    );
    const inside = target('inside', { x: PLAYER.x + radius * 0.5, y: PLAYER.y });
    const outside = target('outside', { x: PLAYER.x + radius + 2, y: PLAYER.y });

    expect(runtime.step(tickMs - 1, tickMs - 1, [inside, outside])).toHaveLength(0);

    const hits = runtime.step(tickMs, tickMs, [inside, outside]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.targetId).toBe('inside');
    expect(hits[0]?.skillId).toBe(ARRAY);
    expect(hits[0]?.amount).toBeCloseTo(10 * 0.4, 6);

    // Still slicing before the lifetime ends…
    expect(runtime.step(tickMs * 2, tickMs, [inside])).toHaveLength(1);
    // …and gone afterwards.
    expect(runtime.step(duration + tickMs, tickMs, [inside])).toHaveLength(0);
    expect(runtime.activeArrays).toHaveLength(0);
  });
});

describe('sword qi waves', () => {
  it('travels along the shot direction and pierces each enemy at most once', () => {
    const runtime = new CultivatorSkillRuntime(T, stacks({ [QI]: 1 }));
    const speed = T.swordQi.speedTilesPerSecond;
    const halfWidth = T.swordQi.halfWidthTilesByStack[0]!;
    const duration = T.swordQi.durationMsByStack[0]!;

    runtime.applyEffects(
      [
        effect(QI, {
          position: { x: 0, y: 0 },
          amount: 1,
          radiusTiles: halfWidth,
          durationMs: duration,
        }),
      ],
      0,
      { ...CONTEXT, aimDirection: { x: 1, y: 0 } },
    );
    expect(runtime.activeWaves).toHaveLength(1);

    const first = target('first', { x: speed * 0.2, y: 0 });
    const second = target('second', { x: speed * 0.4, y: 0 });
    const behind = target('behind', { x: -5, y: 0 });

    const seen = new Set<string>();
    for (let step = 1; step <= 20; step += 1) {
      const hits = runtime.step(step * 16, 16, [first, second, behind]);
      for (const hit of hits) seen.add(hit.targetId);
    }
    expect(seen).toEqual(new Set(['first', 'second']));
  });
});

describe('qi barrier', () => {
  it('fills the gauge, raises the shield with radial waves, absorbs exactly one hit, then recharges', () => {
    const runtime = new CultivatorSkillRuntime(T, stacks({ [BARRIER]: 1 }));
    const charge = T.qiBarrier.chargeByStack[0]!;
    const waves = T.qiBarrier.wavesByStack[0]!;
    const waveRadius = T.qiBarrier.waveHalfWidthTilesByStack[0]!;

    const chargeHit = (atMs: number): void => {
      runtime.applyEffects(
        [
          {
            kind: 'buff',
            skillId: BARRIER,
            position: PLAYER,
            amount: charge,
          },
        ],
        atMs,
        CONTEXT,
      );
    };

    // Two charges are not enough; the third fills the gauge.
    chargeHit(0);
    chargeHit(16);
    expect(runtime.hasQiShield).toBe(false);
    expect(runtime.gaugeFraction).toBeCloseTo(charge * 2, 6);

    chargeHit(32);
    expect(runtime.hasQiShield).toBe(true);
    expect(runtime.gaugeFraction).toBe(0);
    expect(runtime.activeWaves).toHaveLength(waves);

    // While the shield is up the gauge does not charge.
    chargeHit(48);
    expect(runtime.gaugeFraction).toBe(0);

    // The radial waves damage enemies around the player.
    const around = target('around', { x: PLAYER.x + 0.6, y: PLAYER.y }, waveRadius);
    const hits = runtime.step(64, 16, [around]);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.skillId).toBe(BARRIER);

    // Exactly one hit is absorbed.
    expect(runtime.consumeQiShield()).toBe(true);
    expect(runtime.hasQiShield).toBe(false);
    expect(runtime.consumeQiShield()).toBe(false);

    // The gauge restarts at 0 and charges again.
    expect(runtime.gaugeFraction).toBe(0);
    chargeHit(200);
    expect(runtime.gaugeFraction).toBeCloseTo(charge, 6);
    expect(runtime.hasQiShield).toBe(false);

    // A full second round raises the shield again.
    for (let index = 0; index < Math.ceil(1 / charge); index += 1) chargeHit(216 + index * 16);
    expect(runtime.hasQiShield).toBe(true);
  });

  it('emits one radial wave per stack', () => {
    for (const stack of [1, 2, 3]) {
      const runtime = new CultivatorSkillRuntime(T, stacks({ [BARRIER]: stack }));
      const charge = T.qiBarrier.chargeByStack[stack - 1]!;
      const hits = Math.ceil(1 / charge);
      for (let index = 0; index < hits; index += 1) {
        runtime.applyEffects(
          [{ kind: 'buff', skillId: BARRIER, position: PLAYER, amount: charge }],
          index * 16,
          CONTEXT,
        );
      }
      expect(runtime.activeWaves).toHaveLength(T.qiBarrier.wavesByStack[stack - 1]!);
    }
  });
});

describe('myriad swords', () => {
  it('fires one mini wave per orbiting sword, outward from the player', () => {
    const runtime = new CultivatorSkillRuntime(
      T,
      stacks({ [ORBIT]: 1, [ARRAY]: 1, [EVOLUTION]: 1 }),
    );
    const swords = T.orbitSwords.swordsByStack[0]!;
    const effects: ClassSkillEffect[] = [];
    for (let index = 0; index < swords; index += 1) {
      effects.push(effect(ORBIT, { amount: 0.5, radiusTiles: 2 }));
      effects.push(
        effect(EVOLUTION, {
          amount: T.myriadSwords.miniWaveDamageRatio,
          radiusTiles: T.myriadSwords.miniWaveRadiusTiles,
          durationMs: T.myriadSwords.miniWaveDurationMs,
        }),
      );
    }
    runtime.applyEffects(effects, 0, CONTEXT);
    expect(runtime.activeWaves).toHaveLength(swords);
    for (const wave of runtime.activeWaves) expect(wave.skillId).toBe(EVOLUTION);
  });
});
