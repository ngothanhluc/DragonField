/**
 * Ninja class-exclusive skills + Class Evolution (M20, ADR-027; GDD §3).
 *
 * Data only in #83: `tags: []` keeps the shared stat pipeline untouched, and every hook returns
 * the shared empty effect list. Ticket #84 implements the mechanics in this file.
 */
import type {
  ClassCrest,
  ClassEvolutionDef,
  ClassSkillHook,
  ClassSkillHooks,
} from '../class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from '../class-skill-hooks';
import type { SkillDef } from '../pool';

export const NINJA_SKILLS: readonly SkillDef[] = [
  {
    id: 'ninja-shadow-clone',
    short: 'NL',
    name: 'Shadow Clone',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'ninja',
    tags: [],
  },
  {
    id: 'ninja-venom-shuriken',
    short: 'VS',
    name: 'Venom Shuriken',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'ninja',
    tags: [],
  },
  {
    id: 'ninja-kunai-burst',
    short: 'KB',
    name: 'Kunai Burst',
    rarity: 'common',
    maxStacks: 3,
    characterId: 'ninja',
    tags: [],
  },
  {
    id: 'ninja-smoke-bomb',
    short: 'SB',
    name: 'Smoke Bomb',
    rarity: 'epic',
    maxStacks: 2,
    characterId: 'ninja',
    tags: [],
  },
];

export const NINJA_EVOLUTION: ClassEvolutionDef = {
  id: 'ninja-phantom-assassin',
  short: 'PA',
  name: 'Phantom Assassin',
  rarity: 'legendary',
  maxStacks: 1,
  characterId: 'ninja',
  requires: ['ninja-shadow-clone', 'ninja-kunai-burst'],
  minStacksEach: 1,
  tags: [],
};

const noop: ClassSkillHook = () => NO_CLASS_SKILL_EFFECTS;

/** No-op mechanics until #84. */
export const NINJA_HOOKS: ClassSkillHooks = {
  onShot: noop,
  onHit: noop,
  onKill: noop,
  onDash: noop,
  onActive: noop,
  tick: noop,
};

/** Violet shadow crest. */
export const NINJA_CREST: ClassCrest = { color: '#8C6BFF', glyph: 'N' };
