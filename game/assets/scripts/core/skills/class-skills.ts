/**
 * Aggregator for the 16 class-exclusive skills + 4 Class Evolutions (M20, ADR-027).
 *
 * One file per class (`classes/<id>.ts`) owns that class's data, crest and hooks, so tickets
 * #84–#87 can land in parallel without editing a shared file. This module only combines them and
 * exposes the lookups the roll, save, HUD and combat paths need.
 *
 * Pure TS: no `cc`, no file system.
 */
import type { CharacterId } from '../characters/roster';
import { ARCHER_CREST, ARCHER_EVOLUTION, ARCHER_HOOKS, ARCHER_SKILLS } from './classes/archer';
import {
  CULTIVATOR_CREST,
  CULTIVATOR_EVOLUTION,
  CULTIVATOR_HOOKS,
  CULTIVATOR_SKILLS,
} from './classes/cultivator';
import { MAGE_CREST, MAGE_EVOLUTION, MAGE_HOOKS, MAGE_SKILLS } from './classes/mage';
import { NINJA_CREST, NINJA_EVOLUTION, NINJA_HOOKS, NINJA_SKILLS } from './classes/ninja';
import type {
  ClassCrest,
  ClassEvolutionDef,
  ClassSkillEffect,
  ClassSkillEventContext,
  ClassSkillEventName,
  ClassSkillHooks,
  ClassSkillStackSource,
} from './class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from './class-skill-hooks';
import type { SkillDef } from './pool';

/** All 16 class-exclusive skills, grouped per class in roster order. */
export const CLASS_SKILLS: readonly SkillDef[] = [
  ...NINJA_SKILLS,
  ...ARCHER_SKILLS,
  ...MAGE_SKILLS,
  ...CULTIVATOR_SKILLS,
];

/** The 4 Legendary Class Evolutions, grouped per class in roster order. */
export const CLASS_EVOLUTIONS: readonly ClassEvolutionDef[] = [
  NINJA_EVOLUTION,
  ARCHER_EVOLUTION,
  MAGE_EVOLUTION,
  CULTIVATOR_EVOLUTION,
];

/** Exactly one class-exclusive skill list per playable character. */
export const CLASS_SKILLS_BY_CHARACTER: Readonly<Record<CharacterId, readonly SkillDef[]>> = {
  ninja: NINJA_SKILLS,
  archer: ARCHER_SKILLS,
  mage: MAGE_SKILLS,
  cultivator: CULTIVATOR_SKILLS,
};

/** Exactly one Class Evolution per playable character. */
export const CLASS_EVOLUTION_BY_CHARACTER: Readonly<
  Record<CharacterId, ClassEvolutionDef>
> = {
  ninja: NINJA_EVOLUTION,
  archer: ARCHER_EVOLUTION,
  mage: MAGE_EVOLUTION,
  cultivator: CULTIVATOR_EVOLUTION,
};

/** Per-class pick-card crest (colour + glyph); the UI adapter draws it with `Graphics`. */
export const CLASS_CRESTS: Readonly<Record<CharacterId, ClassCrest>> = {
  ninja: NINJA_CREST,
  archer: ARCHER_CREST,
  mage: MAGE_CREST,
  cultivator: CULTIVATOR_CREST,
};

/** Per-class no-op (until #84–#87) hook implementations. */
export const CLASS_SKILL_HOOKS: Readonly<Record<CharacterId, ClassSkillHooks>> = {
  ninja: NINJA_HOOKS,
  archer: ARCHER_HOOKS,
  mage: MAGE_HOOKS,
  cultivator: CULTIVATOR_HOOKS,
};

const CLASS_SKILLS_BY_ID: ReadonlyMap<string, SkillDef> = new Map(
  CLASS_SKILLS.map((skill) => [skill.id, skill]),
);

const CLASS_EVOLUTIONS_BY_ID: ReadonlyMap<string, ClassEvolutionDef> = new Map(
  CLASS_EVOLUTIONS.map((evolution) => [evolution.id, evolution]),
);

/** The 4 class-exclusive skills of one character, in GDD order (never another class's). */
export function classSkillsFor(characterId: CharacterId): readonly SkillDef[] {
  return CLASS_SKILLS_BY_CHARACTER[characterId];
}

/** The one Class Evolution of `characterId`. */
export function classEvolutionFor(characterId: CharacterId): ClassEvolutionDef {
  return CLASS_EVOLUTION_BY_CHARACTER[characterId];
}

/** Look up a class-exclusive base skill by id; `undefined` when the id is not a class skill. */
export function findClassSkill(id: string): SkillDef | undefined {
  return CLASS_SKILLS_BY_ID.get(id);
}

/** Look up a Class Evolution by id; `undefined` when the id is not a Class Evolution. */
export function findClassEvolution(id: string): ClassEvolutionDef | undefined {
  return CLASS_EVOLUTIONS_BY_ID.get(id);
}

/** Look up either a class-exclusive skill or a Class Evolution by id. */
export function findClassSkillOrEvolution(id: string): SkillDef | undefined {
  return CLASS_SKILLS_BY_ID.get(id) ?? CLASS_EVOLUTIONS_BY_ID.get(id);
}

/** True when `id` is one of the 4 Legendary Class Evolutions. */
export function isClassEvolutionId(id: string): boolean {
  return CLASS_EVOLUTIONS_BY_ID.has(id);
}

/** An owned class skill/Evolution with its clamped stack count. */
export interface OwnedClassCard {
  readonly def: SkillDef;
  readonly stacks: number;
}

function ownedCards(defs: readonly SkillDef[], owned: ReadonlyMap<string, number>): OwnedClassCard[] {
  const result: OwnedClassCard[] = [];
  for (const def of defs) {
    const raw = owned.get(def.id) ?? 0;
    if (!Number.isFinite(raw) || raw <= 0) continue;
    result.push({ def, stacks: Math.min(Math.floor(raw), def.maxStacks) });
  }
  return result;
}

/** Owned class-exclusive skills in `CLASS_SKILLS` order, clamped to `maxStacks`. */
export function resolveOwnedClassSkills(
  owned: ReadonlyMap<string, number>,
): OwnedClassCard[] {
  return ownedCards(CLASS_SKILLS, owned);
}

/** Owned Class Evolutions in `CLASS_EVOLUTIONS` order, clamped to `maxStacks`. */
export function resolveOwnedClassEvolutions(
  owned: ReadonlyMap<string, number>,
): OwnedClassCard[] {
  return ownedCards(CLASS_EVOLUTIONS, owned);
}

/** True when `characterId` owns at least one of its own class skills (or its Class Evolution). */
export function hasAnyClassSkill(
  characterId: CharacterId,
  owned: ClassSkillStackSource,
): boolean {
  for (const skill of classSkillsFor(characterId)) {
    if (owned(skill.id) > 0) return true;
  }
  return owned(classEvolutionFor(characterId).id) > 0;
}

/**
 * Call the active character's hook for `event`.
 *
 * Returns the shared empty list (no allocation) when the character owns none of its class skills,
 * so the per-frame tick is free until a class skill is actually picked. Call sites should guard
 * with `hasAnyClassSkill` before building a context object (both are cheap and allocation-free).
 */
export function dispatchClassSkillEvent(
  event: ClassSkillEventName,
  characterId: CharacterId,
  owned: ClassSkillStackSource,
  context: Omit<ClassSkillEventContext, 'characterId' | 'owned'>,
): readonly ClassSkillEffect[] {
  if (!hasAnyClassSkill(characterId, owned)) return NO_CLASS_SKILL_EFFECTS;
  return CLASS_SKILL_HOOKS[characterId][event]({ ...context, characterId, owned });
}
