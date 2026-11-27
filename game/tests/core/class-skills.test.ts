/**
 * Class-skill aggregator + no-op hook seam (M20, ADR-027).
 *
 * #83 ships data and the seam; #84–#87 implement one class each. These tests pin the seam shape
 * (every hook exists for every class, everything returns no effects) and per-class isolation.
 */
import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS } from '../../assets/scripts/core/characters/roster';
import type { ClassSkillStackSource } from '../../assets/scripts/core/skills/class-skill-hooks';
import { CLASS_SKILL_EVENTS } from '../../assets/scripts/core/skills/class-skill-hooks';
import {
  CLASS_CRESTS,
  CLASS_EVOLUTIONS,
  CLASS_SKILL_HOOKS,
  CLASS_SKILLS,
  classEvolutionFor,
  classSkillsFor,
  dispatchClassSkillEvent,
  findClassEvolution,
  findClassSkill,
  hasAnyClassSkill,
} from '../../assets/scripts/core/skills/class-skills';

const emptyStacks: ClassSkillStackSource = () => 0;

describe('class skill aggregator (M20, ADR-027)', () => {
  it('registers 4 exclusive skills + 1 Class Evolution per character', () => {
    expect(CLASS_SKILLS).toHaveLength(16);
    expect(CLASS_EVOLUTIONS).toHaveLength(4);
    for (const characterId of CHARACTER_IDS) {
      const skills = classSkillsFor(characterId);
      expect(skills).toHaveLength(4);
      for (const skill of skills) {
        expect(skill.characterId).toBe(characterId);
        expect(skill.tags).toEqual([]);
        expect(findClassSkill(skill.id)).toBe(skill);
      }
      const evolution = classEvolutionFor(characterId);
      expect(evolution.characterId).toBe(characterId);
      expect(evolution.rarity).toBe('legendary');
      expect(findClassEvolution(evolution.id)).toBe(evolution);
    }
  });

  it('gives every class a distinct crest colour and glyph', () => {
    const colours = new Set<string>();
    const glyphs = new Set<string>();
    for (const characterId of CHARACTER_IDS) {
      const crest = CLASS_CRESTS[characterId];
      expect(crest.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(crest.glyph.length).toBeGreaterThan(0);
      colours.add(crest.color);
      glyphs.add(crest.glyph);
    }
    expect(colours.size).toBe(CHARACTER_IDS.length);
    expect(glyphs.size).toBe(CHARACTER_IDS.length);
  });
});

describe('class skill no-op hooks (M20 seam for #84–#87)', () => {
  // #84 implemented Ninja and #87 Cultivator; Archer/Mage still return the shared empty list.
  const UNIMPLEMENTED = CHARACTER_IDS.filter(
    (characterId) => characterId !== 'ninja' && characterId !== 'cultivator',
  );

  it('defines every hook for all 4 classes and returns the shared empty effect list', () => {
    for (const characterId of UNIMPLEMENTED) {
      const hooks = CLASS_SKILL_HOOKS[characterId];
      const source: ClassSkillStackSource = (id) =>
        classSkillsFor(characterId)[0]?.id === id ? 1 : 0;
      for (const event of CLASS_SKILL_EVENTS) {
        expect(typeof hooks[event]).toBe('function');
        const effects = dispatchClassSkillEvent(event, characterId, source, {
          shotCount: 3,
          dtMs: 16,
          position: { x: 2, y: 3 },
          targetPosition: { x: 4, y: 5 },
          elite: false,
        });
        expect(effects).toEqual([]);
      }
    }
  });

  it('reports no class skill owned for an empty loadout and skips every hook', () => {
    for (const characterId of CHARACTER_IDS) {
      expect(hasAnyClassSkill(characterId, emptyStacks)).toBe(false);
      expect(dispatchClassSkillEvent('tick', characterId, emptyStacks, { dtMs: 16 })).toEqual([]);
    }
  });

  it('detects ownership of any class skill or the Class Evolution', () => {
    for (const characterId of CHARACTER_IDS) {
      const first = classSkillsFor(characterId)[0];
      expect(first).toBeDefined();
      if (first === undefined) continue;
      expect(hasAnyClassSkill(characterId, (id) => (id === first.id ? 1 : 0))).toBe(true);
      const evolution = classEvolutionFor(characterId);
      expect(hasAnyClassSkill(characterId, (id) => (id === evolution.id ? 1 : 0))).toBe(true);
    }
  });
});
