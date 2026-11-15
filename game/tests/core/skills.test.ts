import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { SeededRng } from '../../assets/scripts/core/rng';
import { computeDerivedStats, estimateDps } from '../../assets/scripts/core/skills/derived-stats';
import { RARITIES, SKILLS, getSkill } from '../../assets/scripts/core/skills/pool';
import { DEFAULT_CHOICE_COUNT, rollChoices } from '../../assets/scripts/core/skills/roll';

function owned(...entries: readonly (readonly [string, number])[]): ReadonlyMap<string, number> {
  return new Map(entries);
}

/** Map mà mọi skill trong pool đều đạt maxStacks. */
function allMaxed(): ReadonlyMap<string, number> {
  return new Map(SKILLS.map((skill) => [skill.id, skill.maxStacks]));
}

function ids(skills: readonly { id: string }[]): string[] {
  return skills.map((skill) => skill.id);
}

describe('Skill pool', () => {
  it('có đúng 20 skill như GDD §6', () => {
    expect(SKILLS).toHaveLength(20);
  });

  it('id duy nhất và đúng kebab-case', () => {
    const idList = SKILLS.map((skill) => skill.id);

    expect(new Set(idList).size).toBe(idList.length);
    for (const id of idList) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('mọi rarity hợp lệ và mọi skill có ít nhất 1 stack', () => {
    for (const skill of SKILLS) {
      expect(RARITIES).toContain(skill.rarity);
      expect(skill.maxStacks).toBeGreaterThanOrEqual(1);
      expect(skill.tags.length).toBeGreaterThanOrEqual(1);
      expect(skill.name.length).toBeGreaterThan(0);
    }
  });

  it('trần stack khớp bảng GDD', () => {
    expect(getSkill('sharpen').maxStacks).toBe(5);
    expect(getSkill('twin-shot').maxStacks).toBe(3);
    expect(getSkill('homing').maxStacks).toBe(1);
    expect(getSkill('greed').maxStacks).toBe(4);
    expect(getSkill('executioner').maxStacks).toBe(2);
  });

  it('getSkill trả đúng skill và ném lỗi với id lạ', () => {
    expect(getSkill('rapid-fire').name).toBe('Rapid Fire');
    expect(() => getSkill('khong-ton-tai')).toThrow(/khong-ton-tai/);
  });
});

describe('RNG', () => {
  it('cùng seed cho cùng dãy số', () => {
    const a = SeededRng.fromSeed(1234);
    const b = SeededRng.fromSeed(1234);
    const other = SeededRng.fromSeed(4321);

    const sequenceA = Array.from({ length: 16 }, () => a.next());
    const sequenceB = Array.from({ length: 16 }, () => b.next());
    const sequenceOther = Array.from({ length: 16 }, () => other.next());

    expect(sequenceA).toEqual(sequenceB);
    expect(sequenceA).not.toEqual(sequenceOther);
  });

  it('next luôn nằm trong [0, 1)', () => {
    const rng = SeededRng.fromSeed(7);

    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int nằm trong khoảng và từ chối biên không hợp lệ', () => {
    const rng = SeededRng.fromSeed(99);
    const seen = new Set<number>();

    for (let i = 0; i < 1000; i += 1) seen.add(rng.int(6));

    expect([...seen].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(() => rng.int(0)).toThrow();
    expect(() => rng.int(-3)).toThrow();
    expect(() => rng.int(2.5)).toThrow();
  });

  it('weightedIndex tôn trọng trọng số', () => {
    const rng = SeededRng.fromSeed(2026);
    let first = 0;
    let second = 0;

    for (let i = 0; i < 10_000; i += 1) {
      if (rng.weightedIndex([1, 3]) === 0) first += 1;
      else second += 1;
    }

    // Kỳ vọng 25% / 75%; biên rộng để không flaky.
    expect(first / 10_000).toBeGreaterThan(0.2);
    expect(first / 10_000).toBeLessThan(0.3);
    expect(second / 10_000).toBeGreaterThan(0.7);
    expect(second / 10_000).toBeLessThan(0.8);
  });

  it('weightedIndex bỏ qua trọng số 0', () => {
    const rng = SeededRng.fromSeed(5);

    for (let i = 0; i < 200; i += 1) {
      expect(rng.weightedIndex([0, 1, 0])).toBe(1);
    }
  });

  it('weightedIndex từ chối mảng rỗng, toàn 0, hoặc có số âm', () => {
    const rng = SeededRng.fromSeed(1);

    expect(() => rng.weightedIndex([])).toThrow();
    expect(() => rng.weightedIndex([0, 0])).toThrow();
    expect(() => rng.weightedIndex([1, -1])).toThrow();
    expect(() => rng.weightedIndex([Number.NaN])).toThrow();
  });

  it('pick ném lỗi với mảng rỗng và chọn trong mảng', () => {
    const rng = SeededRng.fromSeed(3);

    expect(() => rng.pick([])).toThrow();
    for (let i = 0; i < 100; i += 1) {
      expect(['a', 'b']).toContain(rng.pick(['a', 'b']));
    }
  });
});

describe('Roll skill', () => {
  it('tất định với seed cố định', () => {
    const run = (seed: number): string[][] => {
      const rng = SeededRng.fromSeed(seed);
      return Array.from({ length: 40 }, () => ids(rollChoices({ rng, owned: owned() })));
    };

    expect(run(20261115)).toEqual(run(20261115));
    expect(run(20261115)).not.toEqual(run(7));
  });

  it('mặc định trả 3 thẻ, không trùng trong một lần quay', () => {
    const rng = SeededRng.fromSeed(11);

    for (let i = 0; i < 300; i += 1) {
      const roll = rollChoices({ rng, owned: owned() });

      expect(roll).toHaveLength(DEFAULT_CHOICE_COUNT);
      expect(new Set(ids(roll)).size).toBe(roll.length);
    }
  });

  it('không trả skill đã đạt maxStacks', () => {
    const rng = SeededRng.fromSeed(77);
    const maxed = owned(['sharpen', 5], ['rapid-fire', 5], ['twin-shot', 3]);

    for (let i = 0; i < 200; i += 1) {
      const rollIds = ids(rollChoices({ rng, owned: maxed }));

      expect(rollIds).not.toContain('sharpen');
      expect(rollIds).not.toContain('rapid-fire');
      expect(rollIds).not.toContain('twin-shot');
    }
  });

  it('trả ít hơn count khi pool gần cạn thay vì ném lỗi', () => {
    const rng = SeededRng.fromSeed(4);
    const nearlyEmpty = new Map(allMaxed());
    nearlyEmpty.delete('executioner');

    const roll = rollChoices({ rng, owned: nearlyEmpty });

    expect(ids(roll)).toEqual(['executioner']);
  });

  it('trả mảng rỗng khi mọi skill đã max', () => {
    const rng = SeededRng.fromSeed(4);

    expect(rollChoices({ rng, owned: allMaxed() })).toEqual([]);
  });

  it('count tuỳ biến được và từ chối count âm', () => {
    const rng = SeededRng.fromSeed(8);

    expect(rollChoices({ rng, owned: owned(), count: 1 })).toHaveLength(1);
    expect(rollChoices({ rng, owned: owned(), count: 5 })).toHaveLength(5);
    expect(() => rollChoices({ rng, owned: owned(), count: -1 })).toThrow();
    expect(() => rollChoices({ rng, owned: owned(), count: 1.5 })).toThrow();
  });

  it('Luck làm tăng tần suất rarity cao, trong biên hợp lý', () => {
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

    // 6000 thẻ: epic kỳ vọng 300 (5%) → 480 (8%). Biên rộng: test này chỉ cần
    // bắt được "Luck không có tác dụng", không phải kiểm tra con số chính xác.
    const withoutLuckEpic = withoutLuck.epic ?? 0;
    const withLuckEpic = withLuck.epic ?? 0;

    expect(withoutLuckEpic).toBeGreaterThan(240);
    expect(withoutLuckEpic).toBeLessThan(400);
    expect(withLuckEpic).toBeGreaterThan(withoutLuckEpic);
    expect(withLuckEpic / withoutLuckEpic).toBeGreaterThan(1.25);
    expect(withLuckEpic).toBeGreaterThan(400);
    expect(withLuckEpic).toBeLessThan(620);

    // Common vẫn là rarity phổ biến nhất.
    expect(withoutLuck.common ?? 0).toBeGreaterThan(withoutLuck.rare ?? 0);
    expect(withoutLuck.common ?? 0).toBeGreaterThan(withoutLuck.epic ?? 0);
  });
});

describe('Derived stats', () => {
  it('map rỗng cho đúng chỉ số base của DEFAULT_COMBAT', () => {
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

  it('map rỗng không sinh NaN/Infinity', () => {
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

  it('Rapid Fire 2 stack cho 1.5× nhịp bắn', () => {
    const stats = computeDerivedStats(owned(['rapid-fire', 2]));

    expect(stats.fireRatePerSecond).toBeCloseTo(DEFAULT_COMBAT.fireRatePerSecond * 1.5, 10);
  });

  it('stack dừng ở maxStacks', () => {
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

  it('Twin Shot cộng thêm viên đạn', () => {
    expect(computeDerivedStats(owned(['twin-shot', 1])).projectiles).toBe(2);
    expect(computeDerivedStats(owned(['twin-shot', 3])).projectiles).toBe(4);
  });

  it('Piercing cộng số enemy xuyên qua', () => {
    expect(computeDerivedStats(owned(['piercing', 2])).pierce).toBe(2);
    expect(computeDerivedStats(owned(['piercing', 99])).pierce).toBe(
      getSkill('piercing').maxStacks,
    );
  });

  it('Crit Eye cộng dồn cơ hội chí mạng và giữ hệ số ×2', () => {
    const stats = computeDerivedStats(owned(['crit-eye', 2]));

    expect(stats.critChance).toBeCloseTo(0.3, 10);
    expect(stats.critMultiplier).toBe(2);
  });

  it('Vitality, Swift, Greed, Lifesteal cộng dồn đúng', () => {
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

  it('Long i-frame 1 stack đưa i-frame từ 0.8 lên 1.1 s', () => {
    expect(computeDerivedStats(owned(['long-iframe', 1])).invulnerabilityMs).toBeCloseTo(1100, 10);
  });

  it('skill có hiệu ứng phụ bật đúng flag', () => {
    const stats = computeDerivedStats(
      owned(['shield', 2], ['thorns', 1], ['second-wind', 1], ['freeze', 1], ['poison', 2]),
    );

    expect(stats.shield).toEqual({ charges: 2, cooldownMs: 20_000 });
    expect(stats.thorns).toEqual({ damage: 2 });
    expect(stats.healPerRoom).toBe(2);
    expect(stats.slowOnHit).toEqual({ factor: 0.4, durationMs: 1000 });
    expect(stats.poisonOnHit).toEqual({ dps: 2, durationMs: 3000 });
  });

  it('Executioner cộng bonus nhưng giữ ngưỡng 30%', () => {
    const stats = computeDerivedStats(owned(['executioner', 2]));

    expect(stats.executeThreshold).toBeCloseTo(0.3, 10);
    expect(stats.executeBonus).toBeCloseTo(1, 10);
  });

  it('estimateDps tăng khi damage tăng và khi nhịp bắn tăng', () => {
    const base = estimateDps(computeDerivedStats(owned()));
    const moreDamage = estimateDps(computeDerivedStats(owned(['sharpen', 2])));
    const faster = estimateDps(computeDerivedStats(owned(['rapid-fire', 2])));
    const moreProjectiles = estimateDps(computeDerivedStats(owned(['twin-shot', 1])));

    expect(moreDamage).toBeGreaterThan(base);
    expect(faster).toBeGreaterThan(base);
    expect(moreProjectiles).toBeGreaterThan(base);
  });

  it('estimateDps tính kỳ vọng chí mạng', () => {
    const stats = computeDerivedStats(owned(['crit-eye', 3]));
    const base = computeDerivedStats(owned());

    // 45% ×2 → hệ số kỳ vọng 1.45.
    expect(estimateDps(stats)).toBeCloseTo(estimateDps(base) * 1.45, 10);
  });

  it('base tuỳ biến được truyền vào', () => {
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
