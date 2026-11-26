import { describe, expect, it } from 'vitest';
import { SeededRng } from '../../assets/scripts/core/rng';
import { computeDerivedStats } from '../../assets/scripts/core/skills/derived-stats';
import {
  EVOLUTIONS,
  evolutionHintsForSkill,
  findSkillOrEvolution,
  getEvolution,
  isEvolutionId,
  isEvolutionUnlocked,
  unlockedEvolutions,
} from '../../assets/scripts/core/skills/evolutions';
import { SkillLoadout } from '../../assets/scripts/core/skills/loadout';
import { SKILLS, getSkill } from '../../assets/scripts/core/skills/pool';
import {
  hasAlternativeSkills,
  rerollChoices,
  rollChoices,
} from '../../assets/scripts/core/skills/roll';

describe('Legendary Evolutions (M13, ADR-022)', () => {
  it('defines 6–8 Legendary Evolutions with valid disjoint prerequisite pairs', () => {
    expect(EVOLUTIONS.length).toBeGreaterThanOrEqual(6);
    expect(EVOLUTIONS.length).toBeLessThanOrEqual(8);
    expect(EVOLUTIONS).toHaveLength(7);

    const skillIds = new Set(SKILLS.map((skill) => skill.id));
    const seenPairs = new Set<string>();

    for (const evo of EVOLUTIONS) {
      expect(evo.rarity).toBe('legendary');
      expect(evo.maxStacks).toBe(1);
      expect(evo.minStacksEach).toBeGreaterThanOrEqual(1);
      expect(evo.tags.length).toBeGreaterThanOrEqual(1);
      expect(skillIds.has(evo.id)).toBe(false);
      expect(isEvolutionId(evo.id)).toBe(true);
      expect(getEvolution(evo.id)).toBe(evo);
      expect(findSkillOrEvolution(evo.id)).toBe(evo);

      const [reqA, reqB] = evo.requires;
      expect(reqA).not.toBe(reqB);
      expect(getSkill(reqA).id).toBe(reqA);
      expect(getSkill(reqB).id).toBe(reqB);
      expect(seenPairs.has(reqA), `duplicate req ${reqA}`).toBe(false);
      expect(seenPairs.has(reqB), `duplicate req ${reqB}`).toBe(false);
      seenPairs.add(reqA);
      seenPairs.add(reqB);
    }

    expect(isEvolutionId('sharpen')).toBe(false);
    expect(() => getEvolution('sharpen')).toThrow();
    expect(findSkillOrEvolution('no-such-card')).toBeUndefined();
  });

  it('unlocks an Evolution only when both prerequisites meet minStacksEach and not yet owned', () => {
    const phantom = getEvolution('phantom-volley');
    expect(isEvolutionUnlocked(phantom, new Map())).toBe(false);
    expect(isEvolutionUnlocked(phantom, new Map([['twin-shot', 1]]))).toBe(false);
    expect(isEvolutionUnlocked(phantom, new Map([['piercing', 1]]))).toBe(false);
    expect(isEvolutionUnlocked(phantom, new Map([['twin-shot', 1], ['piercing', 1]]))).toBe(true);
    expect(
      isEvolutionUnlocked(
        phantom,
        new Map([
          ['twin-shot', 1],
          ['piercing', 1],
          ['phantom-volley', 1],
        ]),
      ),
    ).toBe(false);

    expect(
      unlockedEvolutions(
        new Map([
          ['twin-shot', 1],
          ['piercing', 1],
          ['freeze', 1],
          ['poison', 1],
        ]),
      ).map((evo) => evo.id),
    ).toEqual(['phantom-volley', 'blightfrost']);
  });

  it('provides accurate pairing hints for prerequisite skill cards', () => {
    const noneOwned = evolutionHintsForSkill('twin-shot', new Map());
    expect(noneOwned).toHaveLength(1);
    expect(noneOwned[0]).toMatchObject({
      partnerId: 'piercing',
      partnerName: 'Piercing',
      partnerOwned: false,
      ready: false,
      text: 'Pair: Piercing',
    });

    const partnerOwned = evolutionHintsForSkill('twin-shot', new Map([['piercing', 1]]));
    expect(partnerOwned).toHaveLength(1);
    expect(partnerOwned[0]).toMatchObject({
      partnerId: 'piercing',
      partnerOwned: true,
      ready: true,
      text: 'Ready: Phantom Volley',
    });

    const alreadyEvolved = evolutionHintsForSkill(
      'twin-shot',
      new Map([
        ['piercing', 1],
        ['phantom-volley', 1],
      ]),
    );
    expect(alreadyEvolved).toEqual([]);
    expect(evolutionHintsForSkill('sharpen', new Map())).toEqual([]);
  });

  it('surfaces unlocked Evolutions deterministically with high priority in rollChoices & rerollChoices', () => {
    const owned = new Map<string, number>([
      ['twin-shot', 1],
      ['piercing', 1],
    ]);

    let seenCount = 0;
    const trials = 100;
    for (let i = 0; i < trials; i += 1) {
      const offers = rollChoices({ rng: SeededRng.fromSeed(100 + i), owned });
      if (offers.some((card) => card.id === 'phantom-volley')) seenCount += 1;
    }
    expect(seenCount).toBeGreaterThan(60);

    // Shop mode (`includeEvolutions: false`) never offers Legendary Evolutions.
    for (let i = 0; i < 40; i += 1) {
      const shopRoll = rollChoices({
        rng: SeededRng.fromSeed(500 + i),
        owned,
        includeEvolutions: false,
      });
      expect(shopRoll.every((card) => card.rarity !== 'legendary')).toBe(true);
    }

    // `hasAlternativeSkills` detects an unlocked Evolution outside `previous`.
    const allBaseMaxed = new Map<string, number>(SKILLS.map((s) => [s.id, s.maxStacks]));
    expect(hasAlternativeSkills(allBaseMaxed, ['phantom-volley'])).toBe(true);
    expect(
      hasAlternativeSkills(
        allBaseMaxed,
        EVOLUTIONS.map((evo) => evo.id),
      ),
    ).toBe(false);

    // Reroll avoids a previously offered Evolution when other choices remain.
    const rerolled = rerollChoices({
      rng: SeededRng.fromSeed(7),
      owned,
      previous: ['phantom-volley', 'sharpen', 'swift'],
    });
    expect(rerolled.map((c) => c.id)).not.toContain('phantom-volley');
  });

  it('applies Evolution stats in computeDerivedStats and keeps SkillLoadout entries safe for HUD', () => {
    const loadout = new SkillLoadout();
    expect(loadout.acquire('twin-shot').acquired).toBe(true);
    expect(loadout.acquire('piercing').acquired).toBe(true);
    expect(loadout.acquire('phantom-volley')).toMatchObject({ acquired: true, added: 1, stacks: 1 });
    expect(loadout.acquire('phantom-volley')).toMatchObject({ acquired: false, added: 0, stacks: 1 });

    // `entries` keeps only BaseSkillDef (common|rare|epic) for HUD safety; `evolutions` tracks Evolutions.
    expect(loadout.entries.map((entry) => entry.def.id)).toEqual(['twin-shot', 'piercing']);
    expect(loadout.evolutions.map((entry) => entry.def.id)).toEqual(['phantom-volley']);
    expect(loadout.allEntries.map((entry) => entry.def.id)).toEqual([
      'twin-shot',
      'piercing',
      'phantom-volley',
    ]);

    const stats = loadout.stats();
    expect(stats.projectiles).toBe(4); // 1 base + 1 twin-shot + 2 phantom-volley
    expect(stats.pierce).toBe(3); // 1 piercing + 2 phantom-volley
    expect(stats.activeEvolutions).toEqual(['phantom-volley']);

    const fullEvoStats = computeDerivedStats(
      new Map([
        ['explosive', 1],
        ['crit-eye', 1],
        ['cataclysm', 1],
        ['freeze', 1],
        ['poison', 1],
        ['blightfrost', 1],
        ['shield', 1],
        ['thorns', 1],
        ['aegis-retribution', 1],
        ['swift', 1],
        ['phantom-dash', 1],
        ['shadowstep', 1],
        ['rapid-fire', 1],
        ['shadow-conduit', 1],
        ['tempest-barrage', 1],
      ]),
    );
    expect(fullEvoStats.activeEvolutions).toEqual([
      'cataclysm',
      'blightfrost',
      'aegis-retribution',
      'shadowstep',
      'tempest-barrage',
    ]);
    expect(fullEvoStats.explosive?.radiusTiles).toBe(2.5);
    expect(fullEvoStats.burnOnHit?.dps).toBe(2);
    expect(fullEvoStats.statusDamageBonus).toBeCloseTo(0.35, 10);
    expect(fullEvoStats.thorns?.damage).toBe(7);
    expect(fullEvoStats.shield?.charges).toBe(2);
    expect(fullEvoStats.dashNova?.damage).toBe(4);
    expect(fullEvoStats.activePowerMult).toBeCloseTo(1.5, 10);
  });
});
