/**
 * Cultivator class-exclusive skills + Class Evolution (M20, ADR-027; GDD §3).
 *
 * Data only in #83; ticket #87 implements the mechanics in this file.
 */
import type {
  ClassCrest,
  ClassEvolutionDef,
  ClassSkillHook,
  ClassSkillHooks,
} from '../class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from '../class-skill-hooks';
import type { SkillDef } from '../pool';

export const CULTIVATOR_SKILLS: readonly SkillDef[] = [
  {
    id: 'cultivator-orbit-swords',
    short: 'OS',
    name: 'Orbit Swords',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'cultivator',
    tags: [],
  },
  {
    id: 'cultivator-sword-array',
    short: 'SR',
    name: 'Sword Array',
    rarity: 'epic',
    maxStacks: 2,
    characterId: 'cultivator',
    tags: [],
  },
  {
    id: 'cultivator-sword-qi',
    short: 'SQ',
    name: 'Sword Qi',
    rarity: 'common',
    maxStacks: 3,
    characterId: 'cultivator',
    tags: [],
  },
  {
    id: 'cultivator-qi-barrier',
    short: 'QB',
    name: 'Qi Barrier',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'cultivator',
    tags: [],
  },
];

export const CULTIVATOR_EVOLUTION: ClassEvolutionDef = {
  id: 'cultivator-myriad-swords',
  short: 'MS',
  name: 'Myriad Swords',
  rarity: 'legendary',
  maxStacks: 1,
  characterId: 'cultivator',
  requires: ['cultivator-orbit-swords', 'cultivator-sword-array'],
  minStacksEach: 1,
  tags: [],
};

const noop: ClassSkillHook = () => NO_CLASS_SKILL_EFFECTS;

/** No-op mechanics until #87. */
export const CULTIVATOR_HOOKS: ClassSkillHooks = {
  onShot: noop,
  onHit: noop,
  onKill: noop,
  onDash: noop,
  onActive: noop,
  tick: noop,
};

/** Jade crest. */
export const CULTIVATOR_CREST: ClassCrest = { color: '#52D9B4', glyph: 'C' };
