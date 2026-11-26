/**
 * M12-T1 unit tests: dedicated skill-roll sub-seed independence from combat RNG, reroll-friendly
 * card selection, and escalating gold reroll economics (ADR-021).
 */
import { describe, expect, it } from 'vitest';
import { XP_TUNING } from '../../assets/scripts/core/enemies/tuning';
import { SeededRng } from '../../assets/scripts/core/rng';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';
import { EVOLUTIONS } from '../../assets/scripts/core/skills/evolutions';
import { SKILLS } from '../../assets/scripts/core/skills/pool';
import {
  createSkillRollRng,
  rerollChoices,
  rollChoices,
  skillRollSeed,
} from '../../assets/scripts/core/skills/roll';
import {
  canReroll,
  deductRerollCost,
  rerollCost,
  spendSharedGoldForReroll,
} from '../../assets/scripts/core/xp/reroll';

function ids(cards: readonly { id: string }[]): string[] {
  return cards.map((card) => card.id);
}

describe('skill-roll sub-seed — independence from combat RNG (ADR-021)', () => {
  it('skillRollSeed is deterministic, uint32, and differs from raw runSeed', () => {
    for (const seed of [0, 1, 42, 20261126, -7]) {
      const sub = skillRollSeed(seed);
      expect(skillRollSeed(seed)).toBe(sub);
      expect(Number.isInteger(sub)).toBe(true);
      expect(sub).toBeGreaterThanOrEqual(0);
      expect(sub).toBeLessThan(2 ** 32);
      expect(sub).not.toBe(Math.trunc(seed) >>> 0);
    }
    expect(skillRollSeed(1)).not.toBe(skillRollSeed(2));
  });

  it('combat RNG draws never shift the dedicated skill-roll sequence', () => {
    const owned = new Map<string, number>();

    const runA = {
      combat: SeededRng.fromSeed(9001),
      skills: createSkillRollRng(9001),
    };
    const runB = {
      combat: SeededRng.fromSeed(9001),
      skills: createSkillRollRng(9001),
    };

    // Burn completely different numbers of combat RNG calls in run A vs run B.
    for (let i = 0; i < 37; i += 1) runA.combat.next();
    for (let i = 0; i < 412; i += 1) runB.combat.next();

    const offersA = Array.from({ length: 14 }, () =>
      ids(rollChoices({ rng: runA.skills, owned })),
    );
    const offersB = Array.from({ length: 14 }, () =>
      ids(rollChoices({ rng: runB.skills, owned })),
    );

    expect(offersA).toEqual(offersB);
  });
});

describe('rerollChoices & rollChoices(avoidIds) — fresh reroll offers', () => {
  it('avoids repeating any of the previous 3 cards when >= 3 fresh skills exist', () => {
    const rng = createSkillRollRng(12345);
    const owned = new Map<string, number>();

    let previous = rollChoices({ rng, owned });
    for (let i = 0; i < 50; i += 1) {
      const rerolled = rerollChoices({ rng, owned, previous });
      expect(rerolled).toHaveLength(3);
      const prevSet = new Set(ids(previous));
      for (const card of rerolled) {
        expect(prevSet.has(card.id)).toBe(false);
      }
      previous = rerolled;
    }
  });

  it('guarantees a differing hand when only 4 eligible skills remain (1 fresh + 2 deferred)', () => {
    const rng = createSkillRollRng(77);
    const owned = new Map<string, number>(
      [...SKILLS, ...EVOLUTIONS].map((skill) => [skill.id, skill.maxStacks]),
    );
    const keepIds = ['sharpen', 'rapid-fire', 'twin-shot', 'vitality'] as const;
    for (const id of keepIds) owned.delete(id);

    const previous = ['sharpen', 'rapid-fire', 'twin-shot'];
    for (let i = 0; i < 30; i += 1) {
      const rerolled = rerollChoices({ rng, owned, previous });
      const rerolledIds = ids(rerolled);
      expect(rerolledIds).toHaveLength(3);
      expect(new Set(rerolledIds).size).toBe(3);
      // Must include the fresh 4th skill so the hand never repeats identically.
      expect(rerolledIds).toContain('vitality');
      expect([...rerolledIds].sort()).not.toEqual([...previous].sort());
    }
  });

  it('degrades gracefully without throwing when <= 3 eligible skills remain', () => {
    const rng = createSkillRollRng(77);
    const owned = new Map<string, number>(
      [...SKILLS, ...EVOLUTIONS].map((skill) => [skill.id, skill.maxStacks]),
    );
    owned.delete('sharpen');
    owned.delete('rapid-fire');

    const rerolled = rerollChoices({ rng, owned, previous: ['sharpen', 'rapid-fire'] });
    expect(ids(rerolled).sort()).toEqual(['rapid-fire', 'sharpen']);
  });
});

describe('reroll economics — escalating gold cost and blocking', () => {
  it('escalates linearly from tuning.json', () => {
    const { baseCost, costStep } = XP_TUNING.reroll;
    expect(rerollCost(0)).toBe(baseCost);
    expect(rerollCost(1)).toBe(baseCost + costStep);
    expect(rerollCost(2)).toBe(baseCost + costStep * 2);
    expect(rerollCost(-3)).toBe(baseCost);
    expect(rerollCost(Number.NaN)).toBe(baseCost);
  });

  it('canReroll and deductRerollCost block cleanly when short on gold', () => {
    const firstCost = rerollCost(0);
    const secondCost = rerollCost(1);

    expect(canReroll(firstCost - 1, 0)).toBe(false);
    expect(canReroll(firstCost, 0)).toBe(true);
    expect(canReroll(-10, 0)).toBe(false);
    expect(canReroll(Number.NaN, 0)).toBe(false);

    const blocked = deductRerollCost(firstCost - 1, 0);
    expect(blocked).toEqual({
      ok: false,
      reason: 'not-enough-gold',
      cost: firstCost,
      remainingGold: firstCost - 1,
      nextRerollsUsed: 0,
    });

    const first = deductRerollCost(firstCost + secondCost, 0);
    expect(first).toEqual({
      ok: true,
      cost: firstCost,
      remainingGold: secondCost,
      nextRerollsUsed: 1,
    });

    const second = deductRerollCost(first.remainingGold, first.nextRerollsUsed);
    expect(second).toEqual({
      ok: true,
      cost: secondCost,
      remainingGold: 0,
      nextRerollsUsed: 2,
    });

    const third = deductRerollCost(second.remainingGold, second.nextRerollsUsed);
    expect(third.ok).toBe(false);
    expect(third.remainingGold).toBe(0);
  });

  it('spendSharedGoldForReroll spends run gold first, then banked meta gold, immutably', () => {
    const save = { ...createDefaultSave(), gold: 25 };
    const firstCost = rerollCost(0); // 10
    const secondCost = rerollCost(1); // 20

    // Run gold covers part, bank covers the rest.
    const r1 = spendSharedGoldForReroll(save, 6, 0);
    expect(r1.ok).toBe(true);
    expect(r1.cost).toBe(firstCost);
    expect(r1.runGold).toBe(0);
    expect(r1.save.gold).toBe(25 - (firstCost - 6));
    expect(r1.nextRerollsUsed).toBe(1);
    // Original save untouched.
    expect(save.gold).toBe(25);

    // Next reroll costs 20; remaining gold is 21 → succeeds with 1 left.
    const r2 = spendSharedGoldForReroll(r1.save, r1.runGold, r1.nextRerollsUsed);
    expect(r2.ok).toBe(true);
    expect(r2.cost).toBe(secondCost);
    expect(r2.save.gold).toBe(1);
    expect(r2.nextRerollsUsed).toBe(2);

    // Third reroll costs 30; only 1 gold left → blocked without modifying balance.
    const r3 = spendSharedGoldForReroll(r2.save, r2.runGold, r2.nextRerollsUsed);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe('not-enough-gold');
    expect(r3.save.gold).toBe(1);
    expect(r3.nextRerollsUsed).toBe(2);
  });
});
