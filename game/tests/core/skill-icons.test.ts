/**
 * M13 skill & Evolution icon mapping tests (ADR-022):
 * Every base skill (27) and every Legendary Evolution (7) maps to a strictly unique 24×24 icon.
 */
import { describe, expect, it } from 'vitest';
import { EVOLUTIONS, getEvolution } from '../../assets/scripts/core/skills/evolutions';
import {
  SKILL_ICONS,
  skillCardIconSheet,
  skillIconSheet,
} from '../../assets/scripts/core/skills/icons';
import { SKILLS, getSkill } from '../../assets/scripts/core/skills/pool';

describe('skill & Evolution icon mapping (data)', () => {
  it('maps every pool skill and every Legendary Evolution to a unique pack icon', () => {
    const allIds = [...SKILLS.map((s) => s.id), ...EVOLUTIONS.map((e) => e.id)].sort();
    expect(Object.keys(SKILL_ICONS).sort()).toEqual(allIds);

    const icons = Object.values(SKILL_ICONS);
    expect(new Set(icons).size).toBe(icons.length);
    expect(icons).not.toContain('Alchemy');
    expect(icons).not.toContain('LuckUpgrade');
    expect(icons).not.toContain('Money');
  });
});

describe('icon sheet API (HUD, cards, and later shop/doors)', () => {
  it('returns the resources sheet path of the normal icon for skills and Evolutions', () => {
    expect(skillIconSheet('sharpen')).toBe('resources/art/ui/skill-icons/AttackUpgrade.png');
    expect(skillIconSheet('executioner')).toBe('resources/art/ui/skill-icons/Death.png');
    expect(skillIconSheet('phantom-volley')).toBe('resources/art/ui/skill-icons/Arrow.png');
  });

  it('returns the Disabled variant on request', () => {
    expect(skillIconSheet('sharpen', { disabled: true })).toBe(
      'resources/art/ui/skill-icons/AttackUpgradeDisabled.png',
    );
    expect(skillIconSheet('second-wind', { disabled: true })).toBe(
      'resources/art/ui/skill-icons/BookPlantDisabled.png',
    );
    expect(skillIconSheet('cataclysm', { disabled: true })).toBe(
      'resources/art/ui/skill-icons/SunDisabled.png',
    );
  });

  it('throws on an unknown skill id', () => {
    expect(() => skillIconSheet('no-such-skill')).toThrow(/no-such-skill/);
  });

  it('pick cards use the Disabled variant only once the skill or Evolution is at max stack', () => {
    const homing = getSkill('homing'); // maxStacks 1
    expect(skillCardIconSheet(homing, 0)).toBe('resources/art/ui/skill-icons/Vision.png');
    expect(skillCardIconSheet(homing, 1)).toBe('resources/art/ui/skill-icons/VisionDisabled.png');

    const sharpen = getSkill('sharpen'); // maxStacks 5
    expect(skillCardIconSheet(sharpen, 4)).toBe('resources/art/ui/skill-icons/AttackUpgrade.png');
    expect(skillCardIconSheet(sharpen, 5)).toBe(
      'resources/art/ui/skill-icons/AttackUpgradeDisabled.png',
    );

    const evo = getEvolution('tempest-barrage'); // maxStacks 1
    expect(skillCardIconSheet(evo, 0)).toBe('resources/art/ui/skill-icons/Shuriken.png');
    expect(skillCardIconSheet(evo, 1)).toBe('resources/art/ui/skill-icons/ShurikenDisabled.png');
  });
});
