import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { SeededRng } from '../../assets/scripts/core/rng';
import { computeDerivedStats, estimateDps } from '../../assets/scripts/core/skills/derived-stats';
import { RARITIES, SKILLS, getSkill } from '../../assets/scripts/core/skills/pool';
import { DEFAULT_CHOICE_COUNT, rollChoices } from '../../assets/scripts/core/skills/roll';

function owned(...entries: readonly (readonly [string, number])[]): ReadonlyMap<string, number> {
  return new Map(entries);
}

/** A map where every skill in the pool is at maxStacks. */
function allMaxed(): ReadonlyMap<string, number> {
  return new Map(SKILLS.map((skill) => [skill.id, skill.maxStacks]));
}

function ids(skills: readonly { id: string }[]): string[] {
  return skills.map((skill) => skill.id);
}

describe('Skill pool', () => {
  it('has exactly 20 skills like GDD §6', () => {
    expect(SKILLS).toHaveLength(20);
  });

  it('ids are unique and kebab-case', () => {
    const idList = SKILLS.map((skill) => skill.id);

    expect(new Set(idList).size).toBe(idList.length);
    for (const id of idList) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every rarity is valid and every skill has at least 1 stack', () => {
    for (const skill of SKILLS) {
      expect(RARITIES).toContain(skill.rarity);
      expect(skill.maxStacks).toBeGreaterThanOrEqual(1);
      expect(skill.tags.length).toBeGreaterThanOrEqual(1);
      expect(skill.name.length).toBeGreaterThan(0);
    }
  });

  it('stack caps match the GDD table', () => {
    expect(getSkill('sharpen').maxStacks).toBe(5);
    expect(getSkill('twin-shot').maxStacks).toBe(3);
    expect(getSkill('homing').maxStacks).toBe(1);
    expect(getSkill('greed').maxStacks).toBe(4);
    expect(getSkill('executioner').maxStacks).toBe(2);
  });

  it('getSkill returns the right skill and throws on an unknown id', () => {
    expect(getSkill('rapid-fire').name).toBe('Rapid Fire');
    expect(() => getSkill('khong-ton-tai')).toThrow(/khong-ton-tai/);
  });
});

describe('RNG', () => {
  it('same seed gives the same number sequence', () => {
    const a = SeededRng.fromSeed(1234);
    const b = SeededRng.fromSeed(1234);
    const other = SeededRng.fromSeed(4321);

    const sequenceA = Array.from({ length: 16 }, () => a.next());
    const sequenceB = Array.from({ length: 16 }, () => b.next());
    const sequenceOther = Array.from({ length: 16 }, () => other.next());

    expect(sequenceA).toEqual(sequenceB);
    expect(sequenceA).not.toEqual(sequenceOther);
  });

  it('next is always within [0, 1)', () => {
    const rng = SeededRng.fromSeed(7);

    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int stays in range and rejects invalid bounds', () => {
    const rng = SeededRng.fromSeed(99);
    const seen = new Set<number>();

    for (let i = 0; i < 1000; i += 1) seen.add(rng.int(6));

    expect([...seen].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(() => rng.int(0)).toThrow();
    expect(() => rng.int(-3)).toThrow();
    expect(() => rng.int(2.5)).toThrow();
  });

  it('weightedIndex respects the weights', () => {
    const rng = SeededRng.fromSeed(2026);
    let first = 0;
    let second = 0;

    for (let i = 0; i < 10_000; i += 1) {
      if (rng.weightedIndex([1, 3]) === 0) first += 1;
      else second += 1;
    }

    // Expect 25% / 75%; wide bounds to avoid flakiness.
    expect(first / 10_000).toBeGreaterThan(0.2);
    expect(first / 10_000).toBeLessThan(0.3);
    expect(second / 10_000).toBeGreaterThan(0.7);
    expect(second / 10_000).toBeLessThan(0.8);
  });

  it('weightedIndex skips zero weights', () => {
    const rng = SeededRng.fromSeed(5);

    for (let i = 0; i < 200; i += 1) {
      expect(rng.weightedIndex([0, 1, 0])).toBe(1);
    }
  });

  it('weightedIndex rejects an empty array, all zeros, or a negative number', () => {
    const rng = SeededRng.fromSeed(1);

    expect(() => rng.weightedIndex([])).toThrow();
    expect(() => rng.weightedIndex([0, 0])).toThrow();
    expect(() => rng.weightedIndex([1, -1])).toThrow();
    expect(() => rng.weightedIndex([Number.NaN])).toThrow();
  });

  it('pick throws on an empty array and selects within the array', () => {
    const rng = SeededRng.fromSeed(3);

    expect(() => rng.pick([])).toThrow();
    for (let i = 0; i < 100; i += 1) {
      expect(['a', 'b']).toContain(rng.pick(['a', 'b']));
    }
  });
});

describe('Roll skill', () => {
  it('is deterministic for a fixed seed', () => {
    const run = (seed: number): string[][] => {
      const rng = SeededRng.fromSeed(seed);
      return Array.from({ length: 40 }, () => ids(rollChoices({ rng, owned: owned() })));
    };

    expect(run(20261115)).toEqual(run(20261115));
    expect(run(20261115)).not.toEqual(run(7));
  });

  it('returns 3 cards by default, without duplicates in one roll', () => {
    const rng = SeededRng.fromSeed(11);

    for (let i = 0; i < 300; i += 1) {
      const roll = rollChoices({ rng, owned: owned() });

      expect(roll).toHaveLength(DEFAULT_CHOICE_COUNT);
      expect(new Set(ids(roll)).size).toBe(roll.length);
    }
  });

  it('never returns a skill already at maxStacks', () => {
    const rng = SeededRng.fromSeed(77);
    const maxed = owned(['sharpen', 5], ['rapid-fire', 5], ['twin-shot', 3]);

    for (let i = 0; i < 200; i += 1) {
      const rollIds = ids(rollChoices({ rng, owned: maxed }));

      expect(rollIds).not.toContain('sharpen');
      expect(rollIds).not.toContain('rapid-fire');
      expect(rollIds).not.toContain('twin-shot');
    }
  });

  it('returns fewer than count when the pool nearly runs out instead of throwing', () => {
    const rng = SeededRng.fromSeed(4);
    const nearlyEmpty = new Map(allMaxed());
    nearlyEmpty.delete('executioner');

    const roll = rollChoices({ rng, owned: nearlyEmpty });

    expect(ids(roll)).toEqual(['executioner']);
  });

  it('returns an empty array when every skill is maxed', () => {
    const rng = SeededRng.fromSeed(4);

    expect(rollChoices({ rng, owned: allMaxed() })).toEqual([]);
  });

  it('count is customisable and a negative count is rejected', () => {
    const rng = SeededRng.fromSeed(8);

    expect(rollChoices({ rng, owned: owned(), count: 1 })).toHaveLength(1);
    expect(rollChoices({ rng, owned: owned(), count: 5 })).toHaveLength(5);
    expect(() => rollChoices({ rng, owned: owned(), count: -1 })).toThrow();
    expect(() => rollChoices({ rng, owned: owned(), count: 1.5 })).toThrow();
  });

  it('Luck raises the frequency of high rarities, within sensible bounds', () => {
    const countRarities = (luckStacks: number): Record<string, number> => {
      const rng = SeededRng.fromSeed(2026);
      const ownedMap = luckStacks > 0 ? owned(['luck', luckStacks]) : owned();
      const counts: Record<string, number> = { common: 0, rare: 0, epic: 0 };

      for (let i = 0; i < 2000; i += 1) {
        for (const skill of rollChoices({ rng, owned: ownedMap })) {
          counts[skill.rarity] = (counts[skill.rarity] ?? 0) + 1;
        }
      }

      return counts;
    };

    const withoutLuck = countRarities(0);
    const withLuck = countRarities(3);

    // 6000 cards: epic expected 300 (5%) → 480 (8%). Wide bounds: this test only needs
    // to catch "Luck has no effect", not to check the exact number.
    const withoutLuckEpic = withoutLuck.epic ?? 0;
    const withLuckEpic = withLuck.epic ?? 0;

    expect(withoutLuckEpic).toBeGreaterThan(240);
    expect(withoutLuckEpic).toBeLessThan(400);
    expect(withLuckEpic).toBeGreaterThan(withoutLuckEpic);
    expect(withLuckEpic / withoutLuckEpic).toBeGreaterThan(1.25);
    expect(withLuckEpic).toBeGreaterThan(400);
    expect(withLuckEpic).toBeLessThan(620);

    // Common is still the most frequent rarity.
    expect(withoutLuck.common ?? 0).toBeGreaterThan(withoutLuck.rare ?? 0);
    expect(withoutLuck.common ?? 0).toBeGreaterThan(withoutLuck.epic ?? 0);
  });
});

describe('Derived stats', () => {
  it('an empty map gives exactly the DEFAULT_COMBAT base stats', () => {
    const stats = computeDerivedStats(owned());

    expect(stats.damage).toBe(1);
    expect(stats.fireRatePerSecond).toBe(DEFAULT_COMBAT.fireRatePerSecond);
    expect(stats.projectiles).toBe(1);
    expect(stats.pierce).toBe(0);
    expect(stats.critChance).toBe(0);
    expect(stats.critMultiplier).toBe(1);
    expect(stats.maxHearts).toBe(DEFAULT_COMBAT.playerMaxHearts);
    expect(stats.invulnerabilityMs).toBe(DEFAULT_COMBAT.invulnerabilityMs);
    expect(stats.moveSpeedTilesPerSecond).toBeGreaterThan(0);
    expect(stats.lifestealPercent).toBe(0);
    expect(stats.goldMultiplier).toBe(1);
    expect(stats.executeThreshold).toBe(0);
    expect(stats.executeBonus).toBe(0);
    expect(stats.slowOnHit).toBeUndefined();
    expect(stats.poisonOnHit).toBeUndefined();
    expect(stats.shield).toBeUndefined();
    expect(stats.thorns).toBeUndefined();
    expect(stats.healPerRoom).toBeUndefined();
  });

  it('an empty map produces no NaN/Infinity', () => {
    const stats = computeDerivedStats(owned());
    const numbers = Object.values(stats).filter(
      (value): value is number => typeof value === 'number',
    );

    for (const value of numbers) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isFinite(estimateDps(stats))).toBe(true);
  });

  it('1 stack Sharpen cho +1 damage', () => {
    const stats = computeDerivedStats(owned(['sharpen', 1]));

    expect(stats.damage).toBe(computeDerivedStats(owned()).damage + 1);
  });

  it('Rapid Fire 2 stacks gives 1.5× fire rate', () => {
    const stats = computeDerivedStats(owned(['rapid-fire', 2]));

    expect(stats.fireRatePerSecond).toBeCloseTo(DEFAULT_COMBAT.fireRatePerSecond * 1.5, 10);
  });

  it('stacks stop at maxStacks', () => {
    const sharpen = computeDerivedStats(owned(['sharpen', 99]));
    const rapidFire = computeDerivedStats(owned(['rapid-fire', 99]));
    const twinShot = computeDerivedStats(owned(['twin-shot', 99]));

    expect(sharpen.damage).toBe(1 + getSkill('sharpen').maxStacks);
    expect(rapidFire.fireRatePerSecond).toBeCloseTo(
      DEFAULT_COMBAT.fireRatePerSecond * (1 + 0.25 * getSkill('rapid-fire').maxStacks),
      10,
    );
    expect(twinShot.projectiles).toBe(1 + getSkill('twin-shot').maxStacks);
  });

  it('Twin Shot adds a projectile', () => {
    expect(computeDerivedStats(owned(['twin-shot', 1])).projectiles).toBe(2);
    expect(computeDerivedStats(owned(['twin-shot', 3])).projectiles).toBe(4);
  });

  it('Piercing adds enemies passed through', () => {
    expect(computeDerivedStats(owned(['piercing', 2])).pierce).toBe(2);
    expect(computeDerivedStats(owned(['piercing', 99])).pierce).toBe(
      getSkill('piercing').maxStacks,
    );
  });

  it('Crit Eye stacks crit chance and keeps the ×2 factor', () => {
    const stats = computeDerivedStats(owned(['crit-eye', 2]));

    expect(stats.critChance).toBeCloseTo(0.3, 10);
    expect(stats.critMultiplier).toBe(2);
  });

  it('Vitality, Swift, Greed, Lifesteal stack correctly', () => {
    const stats = computeDerivedStats(
      owned(['vitality', 2], ['swift', 2], ['greed', 2], ['lifesteal', 1]),
    );

    expect(stats.maxHearts).toBe(DEFAULT_COMBAT.playerMaxHearts + 2);
    expect(stats.moveSpeedTilesPerSecond).toBeCloseTo(
      computeDerivedStats(owned()).moveSpeedTilesPerSecond * 1.2,
      10,
    );
    expect(stats.goldMultiplier).toBeCloseTo(1.5, 10);
    expect(stats.lifestealPercent).toBeCloseTo(0.05, 10);
  });

  it('Long i-frame 1 stack takes the i-frame from 0.8 to 1.1 s', () => {
    expect(computeDerivedStats(owned(['long-iframe', 1])).invulnerabilityMs).toBeCloseTo(1100, 10);
  });

  it('skills with side effects turn on the right flags', () => {
    const stats = computeDerivedStats(
      owned(['shield', 2], ['thorns', 1], ['second-wind', 1], ['freeze', 1], ['poison', 2]),
    );

    expect(stats.shield).toEqual({ charges: 2, cooldownMs: 20_000 });
    expect(stats.thorns).toEqual({ damage: 2 });
    expect(stats.healPerRoom).toBe(2);
    expect(stats.slowOnHit).toEqual({ factor: 0.4, durationMs: 1000 });
    expect(stats.poisonOnHit).toEqual({ dps: 2, durationMs: 3000 });
  });

  it('Executioner adds bonus while keeping the 30% threshold', () => {
    const stats = computeDerivedStats(owned(['executioner', 2]));

    expect(stats.executeThreshold).toBeCloseTo(0.3, 10);
    expect(stats.executeBonus).toBeCloseTo(1, 10);
  });

  it('estimateDps rises with damage and with fire rate', () => {
    const base = estimateDps(computeDerivedStats(owned()));
    const moreDamage = estimateDps(computeDerivedStats(owned(['sharpen', 2])));
    const faster = estimateDps(computeDerivedStats(owned(['rapid-fire', 2])));
    const moreProjectiles = estimateDps(computeDerivedStats(owned(['twin-shot', 1])));

    expect(moreDamage).toBeGreaterThan(base);
    expect(faster).toBeGreaterThan(base);
    expect(moreProjectiles).toBeGreaterThan(base);
  });

  it('estimateDps includes the crit expectation', () => {
    const stats = computeDerivedStats(owned(['crit-eye', 3]));
    const base = computeDerivedStats(owned());

    // 45% ×2 → expected factor 1.45.
    expect(estimateDps(stats)).toBeCloseTo(estimateDps(base) * 1.45, 10);
  });

  it('a custom base can be passed in', () => {
    const stats = computeDerivedStats(owned(['sharpen', 1]), {
      fireRatePerSecond: 3,
      playerMaxHearts: 8,
      invulnerabilityMs: 500,
      damage: 2,
      projectiles: 2,
      moveSpeedTilesPerSecond: 5,
    });

    expect(stats.damage).toBe(3);
    expect(stats.fireRatePerSecond).toBe(3);
    expect(stats.maxHearts).toBe(8);
    expect(stats.projectiles).toBe(2);
    expect(stats.invulnerabilityMs).toBe(500);
    expect(stats.moveSpeedTilesPerSecond).toBe(5);
  });
});
