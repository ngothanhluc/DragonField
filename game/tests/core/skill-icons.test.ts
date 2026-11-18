/**
 * #5 acceptance — skill icons replace abbreviations.
 * Expected mapping copied from docs/art/import-checklist.md §5.2 (the table already chosen for the pack).
 */
import { describe, expect, it } from 'vitest';
import { SKILLS, getSkill } from '../../assets/scripts/core/skills/pool';
import {
  SKILL_ICONS,
  skillCardIconSheet,
  skillIconSheet,
} from '../../assets/scripts/core/skills/icons';

const EXPECTED: Readonly<Record<string, string>> = {
  sharpen: 'AttackUpgrade',
  'rapid-fire': 'Fireball',
  'twin-shot': 'Permutation',
  piercing: 'RockSpike',
  ricochet: 'BookThunder',
  homing: 'Vision',
  explosive: 'Explosion',
  'crit-eye': 'Counter',
  vitality: 'Heal',
  'second-wind': 'BookPlant',
  shield: 'DefenseUpgrade',
  thorns: 'BookDarkness',
  swift: 'BookWind',
  'long-iframe': 'Mist',
  freeze: 'BookIce',
  poison: 'BookDeath',
  lifesteal: 'MagicWeapon',
  greed: 'Alchemy',
  luck: 'LuckUpgrade',
  executioner: 'Death',
};

describe('skill icon mapping (data)', () => {
  it('maps exactly the 20 pool skills, each to its chosen pack icon', () => {
    expect(SKILLS).toHaveLength(20);
    expect(Object.keys(SKILL_ICONS).sort()).toEqual(SKILLS.map((skill) => skill.id).sort());
    for (const skill of SKILLS) {
      expect(SKILL_ICONS[skill.id], skill.id).toBe(EXPECTED[skill.id]);
    }
  });

  it('has no duplicate icons', () => {
    const icons = Object.values(SKILL_ICONS);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('icon sheet API (HUD, cards, and later shop/doors)', () => {
  it('returns the resources sheet path of the normal icon', () => {
    expect(skillIconSheet('sharpen')).toBe('resources/art/ui/skill-icons/AttackUpgrade.png');
    expect(skillIconSheet('executioner')).toBe('resources/art/ui/skill-icons/Death.png');
  });

  it('returns the Disabled variant on request', () => {
    expect(skillIconSheet('sharpen', { disabled: true })).toBe(
      'resources/art/ui/skill-icons/AttackUpgradeDisabled.png',
    );
    expect(skillIconSheet('second-wind', { disabled: true })).toBe(
      'resources/art/ui/skill-icons/BookPlantDisabled.png',
    );
  });

  it('throws on an unknown skill id', () => {
    expect(() => skillIconSheet('no-such-skill')).toThrow(/no-such-skill/);
  });

  it('pick cards use the Disabled variant only once the skill is at max stack', () => {
    const homing = getSkill('homing'); // maxStacks 1
    expect(skillCardIconSheet(homing, 0)).toBe('resources/art/ui/skill-icons/Vision.png');
    expect(skillCardIconSheet(homing, 1)).toBe('resources/art/ui/skill-icons/VisionDisabled.png');

    const sharpen = getSkill('sharpen'); // maxStacks 5
    expect(skillCardIconSheet(sharpen, 4)).toBe('resources/art/ui/skill-icons/AttackUpgrade.png');
    expect(skillCardIconSheet(sharpen, 5)).toBe('resources/art/ui/skill-icons/AttackUpgradeDisabled.png');
  });
});
