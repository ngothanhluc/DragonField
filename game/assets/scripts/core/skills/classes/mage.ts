/**
 * Mage class-exclusive skills + Class Evolution (M20, ADR-027; GDD §3).
 *
 * Data only in #83; ticket #86 implements the mechanics in this file.
 */
import type {
  ClassCrest,
  ClassEvolutionDef,
  ClassSkillHook,
  ClassSkillHooks,
} from '../class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from '../class-skill-hooks';
import type { SkillDef } from '../pool';

export const MAGE_SKILLS: readonly SkillDef[] = [
  {
    id: 'mage-meteor',
    short: 'MT',
    name: 'Meteor',
    rarity: 'epic',
    maxStacks: 3,
    characterId: 'mage',
    tags: [],
  },
  {
    id: 'mage-frost-orbs',
    short: 'FO',
    name: 'Frost Orbs',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'mage',
    tags: [],
  },
  {
    id: 'mage-storm-strike',
    short: 'TH',
    name: 'Storm Strike',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'mage',
    tags: [],
  },
  {
    id: 'mage-arcane-pulse',
    short: 'AP',
    name: 'Arcane Pulse',
    rarity: 'common',
    maxStacks: 3,
    characterId: 'mage',
    tags: [],
  },
];

export const MAGE_EVOLUTION: ClassEvolutionDef = {
  id: 'mage-elemental-cataclysm',
  short: 'EC',
  name: 'Elemental Cataclysm',
  rarity: 'legendary',
  maxStacks: 1,
  characterId: 'mage',
  requires: ['mage-meteor', 'mage-frost-orbs'],
  minStacksEach: 1,
  tags: [],
};

const noop: ClassSkillHook = () => NO_CLASS_SKILL_EFFECTS;

/** No-op mechanics until #86. */
export const MAGE_HOOKS: ClassSkillHooks = {
  onShot: noop,
  onHit: noop,
  onKill: noop,
  onDash: noop,
  onActive: noop,
  tick: noop,
};

/** Arcane-cyan crest. */
export const MAGE_CREST: ClassCrest = { color: '#4FC3E8', glyph: 'M' };
