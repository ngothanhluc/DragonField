/**
 * Archer class-exclusive skills + Class Evolution (M20, ADR-027; GDD §3).
 *
 * Data only in #83; ticket #85 implements the mechanics in this file.
 */
import type {
  ClassCrest,
  ClassEvolutionDef,
  ClassSkillHook,
  ClassSkillHooks,
} from '../class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from '../class-skill-hooks';
import type { SkillDef } from '../pool';

export const ARCHER_SKILLS: readonly SkillDef[] = [
  {
    id: 'archer-arrow-rain',
    short: 'RN',
    name: 'Arrow Rain',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'archer',
    tags: [],
  },
  {
    id: 'archer-split-arrow',
    short: 'SA',
    name: 'Split Arrow',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'archer',
    tags: [],
  },
  {
    id: 'archer-hunters-mark',
    short: 'HM',
    name: "Hunter's Mark",
    rarity: 'epic',
    maxStacks: 2,
    characterId: 'archer',
    tags: [],
  },
  {
    id: 'archer-wind-arrow',
    short: 'WA',
    name: 'Wind Arrow',
    rarity: 'common',
    maxStacks: 3,
    characterId: 'archer',
    tags: [],
  },
];

export const ARCHER_EVOLUTION: ClassEvolutionDef = {
  id: 'archer-sky-tempest',
  short: 'ST',
  name: 'Sky Tempest',
  rarity: 'legendary',
  maxStacks: 1,
  characterId: 'archer',
  requires: ['archer-arrow-rain', 'archer-split-arrow'],
  minStacksEach: 1,
  tags: [],
};

const noop: ClassSkillHook = () => NO_CLASS_SKILL_EFFECTS;

/** No-op mechanics until #85. */
export const ARCHER_HOOKS: ClassSkillHooks = {
  onShot: noop,
  onHit: noop,
  onKill: noop,
  onDash: noop,
  onActive: noop,
  tick: noop,
};

/** Forest-green arrow crest. */
export const ARCHER_CREST: ClassCrest = { color: '#4FBF7A', glyph: 'A' };
