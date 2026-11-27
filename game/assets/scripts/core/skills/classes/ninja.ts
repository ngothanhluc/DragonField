/**
 * Ninja class-exclusive skills + Class Evolution (M20, ADR-027; GDD §3).
 *
 * #83 shipped the data only; #84 implements the four mechanics as pure, stateless hooks. Every
 * number comes from `config/tuning.json` (`TUNING.classSkills.ninja`), never from this file.
 *
 * Hooks return `ClassSkillEffect[]` requests and hold no state: the live clones/clouds/zones and
 * their stepping live in `core/skills/ninja-runtime.ts`, which both the headless sim and the Cocos
 * combat loop drive.
 *
 * Per-stack scaling follows the GDD: stack 1 is exactly the GDD number, and every extra stack is no
 * weaker in any field and strictly stronger in at least one (the acceptance test pins this).
 */
import { CLASS_SKILLS_TUNING } from '../../enemies/tuning';
import type {
  ClassCrest,
  ClassEvolutionDef,
  ClassSkillEffect,
  ClassSkillEventContext,
  ClassSkillHook,
  ClassSkillHooks,
  ClassSkillStackSource,
} from '../class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from '../class-skill-hooks';
import type { SkillDef } from '../pool';

const T = CLASS_SKILLS_TUNING.ninja;

export const NINJA_SHADOW_CLONE_ID = 'ninja-shadow-clone';
export const NINJA_VENOM_SHURIKEN_ID = 'ninja-venom-shuriken';
export const NINJA_KUNAI_BURST_ID = 'ninja-kunai-burst';
export const NINJA_SMOKE_BOMB_ID = 'ninja-smoke-bomb';
export const NINJA_EVOLUTION_ID = 'ninja-phantom-assassin';

export const NINJA_SKILLS: readonly SkillDef[] = [
  {
    id: NINJA_SHADOW_CLONE_ID,
    short: 'NL',
    name: 'Shadow Clone',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'ninja',
    tags: [],
  },
  {
    id: NINJA_VENOM_SHURIKEN_ID,
    short: 'VS',
    name: 'Venom Shuriken',
    rarity: 'rare',
    maxStacks: 3,
    characterId: 'ninja',
    tags: [],
  },
  {
    id: NINJA_KUNAI_BURST_ID,
    short: 'KB',
    name: 'Kunai Burst',
    rarity: 'common',
    maxStacks: 3,
    characterId: 'ninja',
    tags: [],
  },
  {
    id: NINJA_SMOKE_BOMB_ID,
    short: 'SB',
    name: 'Smoke Bomb',
    rarity: 'epic',
    maxStacks: 2,
    characterId: 'ninja',
    tags: [],
  },
];

export const NINJA_EVOLUTION: ClassEvolutionDef = {
  id: NINJA_EVOLUTION_ID,
  short: 'PA',
  name: 'Phantom Assassin',
  rarity: 'legendary',
  maxStacks: 1,
  characterId: 'ninja',
  requires: [NINJA_SHADOW_CLONE_ID, NINJA_KUNAI_BURST_ID],
  minStacksEach: 1,
  tags: [],
};

/** Max stacks per Ninja skill, read from the data above (never duplicated as a magic number). */
const MAX_STACKS: ReadonlyMap<string, number> = new Map(
  NINJA_SKILLS.map((skill) => [skill.id, skill.maxStacks]),
);

/** Owned stacks clamped to the skill's max (0 when not owned). */
function stacksOf(owned: ClassSkillStackSource, id: string): number {
  const raw = owned(id);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  const max = MAX_STACKS.get(id) ?? 1;
  return Math.min(Math.floor(raw), max);
}

/** Value for `stack` (1-based), clamped to the table length. */
function atStack(table: readonly number[], stack: number): number {
  const index = Math.max(0, Math.min(table.length - 1, stack - 1));
  return table[index] ?? 0;
}

/** True when *Ảnh Sát Tuyệt Kỹ* is owned together with both of its prerequisites. */
function hasPhantomAssassin(owned: ClassSkillStackSource): boolean {
  return (
    owned(NINJA_EVOLUTION_ID) > 0 &&
    owned(NINJA_SHADOW_CLONE_ID) > 0 &&
    owned(NINJA_KUNAI_BURST_ID) > 0
  );
}

/** *Bom Khói Ẩn Thân*: one enemy-slow zone + one player fire-rate buff, both from one smoke. */
function smokeEffects(
  owned: ClassSkillStackSource,
  position: ClassSkillEventContext['position'],
): ClassSkillEffect[] {
  const stacks = stacksOf(owned, NINJA_SMOKE_BOMB_ID);
  if (stacks <= 0 || position === undefined) return [];
  const radiusTiles = atStack(T.smokeBomb.radiusTilesByStack, stacks);
  const durationMs = atStack(T.smokeBomb.durationMsByStack, stacks);
  return [
    {
      kind: 'status',
      skillId: NINJA_SMOKE_BOMB_ID,
      position,
      amount: atStack(T.smokeBomb.slowByStack, stacks),
      radiusTiles,
      durationMs,
    },
    {
      kind: 'buff',
      skillId: NINJA_SMOKE_BOMB_ID,
      position,
      amount: atStack(T.smokeBomb.fireRateBonusByStack, stacks),
      radiusTiles,
      durationMs,
    },
  ];
}

const onShot: ClassSkillHook = (context) => {
  const stacks = stacksOf(context.owned, NINJA_VENOM_SHURIKEN_ID);
  if (stacks <= 0 || context.position === undefined) return NO_CLASS_SKILL_EFFECTS;
  const shotCount = context.shotCount;
  if (shotCount === undefined || shotCount % T.venomShuriken.everyNShots !== 0) {
    return NO_CLASS_SKILL_EFFECTS;
  }
  return [
    {
      kind: 'spawn',
      skillId: NINJA_VENOM_SHURIKEN_ID,
      position: context.position,
      amount: atStack(T.venomShuriken.damageByStack, stacks),
      radiusTiles: atStack(T.venomShuriken.radiusTilesByStack, stacks),
      durationMs: atStack(T.venomShuriken.durationMsByStack, stacks),
    },
  ];
};

const onHit: ClassSkillHook = () => NO_CLASS_SKILL_EFFECTS;

const onKill: ClassSkillHook = (context) => {
  const stacks = stacksOf(context.owned, NINJA_KUNAI_BURST_ID);
  if (stacks <= 0 || context.position === undefined) return NO_CLASS_SKILL_EFFECTS;
  // No chains: a kunai kill never bursts more kunai.
  if (context.killedBy === NINJA_KUNAI_BURST_ID) return NO_CLASS_SKILL_EFFECTS;
  // A clone's shuriken only bursts kunai once *Ảnh Sát Tuyệt Kỹ* is owned.
  if (context.killedBy === NINJA_SHADOW_CLONE_ID && !hasPhantomAssassin(context.owned)) {
    return NO_CLASS_SKILL_EFFECTS;
  }

  const count = T.kunaiBurst.baseKunai + T.kunaiBurst.kunaiPerStack * (stacks - 1);
  const effects: ClassSkillEffect[] = [];
  for (let index = 0; index < count; index += 1) {
    effects.push({
      kind: 'spawn',
      skillId: NINJA_KUNAI_BURST_ID,
      position: context.position,
      amount: T.kunaiBurst.damage,
    });
  }
  return effects;
};

const onDash: ClassSkillHook = (context) => {
  const cloneStacks = stacksOf(context.owned, NINJA_SHADOW_CLONE_ID);
  const smoke = smokeEffects(context.owned, context.position);
  if (cloneStacks <= 0) return smoke.length > 0 ? smoke : NO_CLASS_SKILL_EFFECTS;
  if (context.position === undefined) return smoke.length > 0 ? smoke : NO_CLASS_SKILL_EFFECTS;

  const clone: ClassSkillEffect = {
    kind: 'spawn',
    skillId: NINJA_SHADOW_CLONE_ID,
    position: context.position,
    amount: atStack(T.shadowClone.damageRatioByStack, cloneStacks),
    durationMs: T.shadowClone.durationMs,
    ...(hasPhantomAssassin(context.owned) ? { crit: true } : {}),
  };
  return [clone, ...smoke];
};

const onActive: ClassSkillHook = (context) => smokeEffects(context.owned, context.position);

const tick: ClassSkillHook = () => NO_CLASS_SKILL_EFFECTS;

/** Ninja mechanics (M20, #84). All six hooks, pure and stateless (context → effects). */
export const NINJA_HOOKS: ClassSkillHooks = {
  onShot,
  onHit,
  onKill,
  onDash,
  onActive,
  tick,
};

/** Violet shadow crest. */
export const NINJA_CREST: ClassCrest = { color: '#8C6BFF', glyph: 'N' };
