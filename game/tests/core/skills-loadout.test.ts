import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { describeSkill, skillAbbreviation } from '../../assets/scripts/core/skills/description';
import { EVOLUTIONS } from '../../assets/scripts/core/skills/evolutions';
import { SkillLoadout, pickupHeal } from '../../assets/scripts/core/skills/loadout';
import { SKILLS, getSkill } from '../../assets/scripts/core/skills/pool';
import { estimateDps } from '../../assets/scripts/core/skills/derived-stats';

describe('SkillLoadout', () => {
  it('acquire adds stacks and stops at maxStacks', () => {
    const loadout = new SkillLoadout();

    expect(loadout.acquire('sharpen').stacks).toBe(1);
    expect(loadout.acquire('sharpen', 3).stacks).toBe(4);
    expect(loadout.acquire('sharpen', 99)).toMatchObject({ added: 1, stacks: 5 });
    expect(loadout.acquire('sharpen')).toMatchObject({ acquired: false, added: 0, stacks: 5 });
    expect(loadout.stacks('sharpen')).toBe(5);
  });

  it('an unknown id is a no-op, no throw', () => {
    const loadout = new SkillLoadout();
    expect(loadout.acquire('khong-ton-tai')).toEqual({
      acquired: false,
      added: 0,
      stacks: 0,
      healNow: 0,
    });
    expect(loadout.size).toBe(0);
  });

  it('Vitality heals 25 HP per stack at pickup time, not as a persistent stat', () => {
    const loadout = new SkillLoadout();
    expect(loadout.acquire('vitality').healNow).toBe(25);
    expect(loadout.acquire('vitality', 2).healNow).toBe(50);
    expect(loadout.acquire('rapid-fire').healNow).toBe(0);
    expect(pickupHeal(getSkill('vitality'))).toBe(25);
  });

  it('stats = computeDerivedStats of exactly the owned map', () => {
    const loadout = SkillLoadout.from(new Map([['sharpen', 2], ['rapid-fire', 2]]));
    const stats = loadout.stats();

    expect(stats.damage).toBe(DEFAULT_COMBAT.damage + 2);
    expect(stats.fireRatePerSecond).toBeCloseTo(DEFAULT_COMBAT.fireRatePerSecond * 1.5, 10);
    expect(estimateDps(stats)).toBeCloseTo(3 * 3, 10);
  });

  it('from() clamps broken stacks instead of carrying them into the run', () => {
    const loadout = SkillLoadout.from(new Map([['sharpen', 99], ['twin-shot', -2], ['la', 3]]));
    expect(loadout.stacks('sharpen')).toBe(5);
    expect(loadout.stacks('twin-shot')).toBe(0);
    expect(loadout.stacks('la')).toBe(0);
  });

  it('a snapshot is a copy: editing outside does not change the loadout', () => {
    const loadout = SkillLoadout.from(new Map([['sharpen', 1]]));
    const snapshot = loadout.snapshot() as Map<string, number>;
    snapshot.set('sharpen', 5);

    expect(loadout.stacks('sharpen')).toBe(1);
  });
});

describe('Skill & Evolution descriptions', () => {
  it('every skill and Evolution in the pool has a description and an abbreviation', () => {
    for (const card of [...SKILLS, ...EVOLUTIONS]) {
      expect(describeSkill(card).length, card.id).toBeGreaterThan(0);
      expect(skillAbbreviation(card), card.id).toMatch(/^[A-Z0-9]{2}$/);
    }
  });

  it('descriptions take numbers from tags, not hardcoded (in both Vietnamese and English)', () => {
    expect(describeSkill(getSkill('sharpen'))).toContain('+1 sát thương');
    expect(describeSkill(getSkill('rapid-fire'))).toContain('+25% tốc độ bắn');
    expect(describeSkill(getSkill('ignite'))).toContain('Cháy');
    expect(describeSkill(getSkill('phantom-dash'))).toContain('hồi chiêu lướt');

    expect(describeSkill(getSkill('sharpen'), 'en')).toContain('+1 damage');
    expect(describeSkill(getSkill('rapid-fire'), 'en')).toContain('+25% fire rate');
    expect(describeSkill(getSkill('twin-shot'), 'en')).toContain('±12°');
    expect(describeSkill(getSkill('shield'), 'en')).toContain('20s');
    expect(describeSkill(getSkill('poison'), 'en')).toContain('3s');
    expect(describeSkill(getSkill('ignite'), 'en')).toContain('Burn');
    expect(describeSkill(getSkill('phantom-dash'), 'en')).toContain('dash cooldown');
  });

  it('HUD abbreviations are readable and strictly unique across all skills & Evolutions', () => {
    expect(skillAbbreviation(getSkill('rapid-fire'))).toBe('RF');
    expect(skillAbbreviation(getSkill('shield'))).toBe('SD');
    expect(skillAbbreviation(getSkill('crit-eye'))).toBe('CE');

    const allCards = [...SKILLS, ...EVOLUTIONS];
    const codes = allCards.map(skillAbbreviation);
    expect(new Set(codes).size).toBe(allCards.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{2}$/);
  });
});
