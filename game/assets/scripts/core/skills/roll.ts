import type { CharacterId } from '../characters/roster';
import { SeededRng } from '../rng';
import { classSkillsFor } from './class-skills';
import { unlockedClassEvolution, unlockedEvolutions } from './evolutions';
import { RARITIES, SKILLS, type Rarity, type SkillDef } from './pool';

/** Salt isolating the skill-roll RNG stream from combat/door/room RNG streams (ADR-021). */
const SKILL_ROLL_SEED_SALT = 0x517cc1b7;
const SKILL_ROLL_MIX_PRIME = 0x9e3779b1;

/**
 * Deterministic uint32 sub-seed for a run's skill rolls and rerolls (ADR-021).
 *
 * Keeping skill rolls on their own sub-seed decouples level-up card offers from combat RNG
 * (crit rolls, lifesteal, boss patterns), so two runs with the same seed see consistent skill
 * offers regardless of combat variance.
 */
export function skillRollSeed(runSeed: number): number {
  const base = Number.isFinite(runSeed) ? Math.trunc(runSeed) >>> 0 : 0;
  return Math.imul(base ^ SKILL_ROLL_SEED_SALT, SKILL_ROLL_MIX_PRIME) >>> 0;
}

/** Create the dedicated deterministic `SeededRng` stream for skill rolls and rerolls (ADR-021). */
export function createSkillRollRng(runSeed: number): SeededRng {
  return new SeededRng(skillRollSeed(runSeed));
}

/**
 * Deterministic rarity weights: common 58 / rare 32 / epic 10, plus high-priority legendary (80)
 * whenever at least one Legendary Evolution is unlocked and eligible in the roll pool.
 *
 * When a rarity has no eligible cards, `drawWeightedFrom` drops it from `availableRarities`
 * and `weightedIndex` renormalises over the remaining rarities.
 */
export const BASE_RARITY_WEIGHTS: Readonly<Record<Rarity, number>> = {
  common: 65,
  rare: 25,
  epic: 10,
  legendary: 80,
};

/** Cards offered each time (pick 1 of 3). */
export const DEFAULT_CHOICE_COUNT = 3;

/** Deterministic rarity weights (economy/luck skills removed in M13). */
export function rarityWeights(): Readonly<Record<Rarity, number>> {
  return BASE_RARITY_WEIGHTS;
}

export interface RollChoicesArgs {
  readonly rng: SeededRng;
  /** id → current stack count. Skills at `maxStacks` no longer appear. */
  readonly owned: ReadonlyMap<string, number>;
  /** How many cards to roll, 3 by default. */
  readonly count?: number;
  /**
   * Optional skill ids from a previous offer to avoid repeating on a reroll.
   * When enough fresh skills remain, none of these are offered; when the pool is tight,
   * fresh skills are drawn first so a reroll never repeats the exact same hand if any fresh
   * choice exists.
   */
  readonly avoidIds?: readonly string[];
  /**
   * Whether unlocked Legendary Evolutions can enter the roll pool (default `true`).
   * Mid-run shops pass `false` since Evolutions are level-up rewards only.
   */
  readonly includeEvolutions?: boolean;
  /**
   * Active character, which adds **only** that character's 4 exclusives and its unlocked
   * Class Evolution to the pool (M20, ADR-027). Omitted = shared-only pool (shop / legacy).
   */
  readonly characterId?: CharacterId;
}

export interface RerollChoicesArgs {
  readonly rng: SeededRng;
  readonly owned: ReadonlyMap<string, number>;
  /** Previously offered cards or skill ids to avoid repeating. */
  readonly previous: readonly (SkillDef | string)[];
  readonly count?: number;
  /** Same class scoping as `RollChoicesArgs.characterId`; forwarded to `rollChoices`. */
  readonly characterId?: CharacterId;
}

function eligiblePool(
  owned: ReadonlyMap<string, number>,
  includeEvolutions: boolean,
  characterId?: CharacterId,
): SkillDef[] {
  const baseEligible: SkillDef[] = SKILLS.filter(
    (skill) => (owned.get(skill.id) ?? 0) < skill.maxStacks,
  );
  if (characterId !== undefined) {
    for (const skill of classSkillsFor(characterId)) {
      if ((owned.get(skill.id) ?? 0) < skill.maxStacks) baseEligible.push(skill);
    }
  }
  if (!includeEvolutions) return baseEligible;

  baseEligible.push(...unlockedEvolutions(owned));
  if (characterId !== undefined) {
    const classEvo = unlockedClassEvolution(characterId, owned);
    if (classEvo !== undefined) baseEligible.push(classEvo);
  }
  return baseEligible;
}

/** Draw `target` rarity-weighted cards from `pool` (mutating `pool` to prevent duplicates). */
function drawWeightedFrom(
  rng: SeededRng,
  pool: SkillDef[],
  weights: Readonly<Record<Rarity, number>>,
  target: number,
  out: SkillDef[],
): void {
  const goal = Math.min(target, pool.length);
  for (let i = 0; i < goal; i += 1) {
    const byRarity: Record<Rarity, SkillDef[]> = {
      common: [],
      rare: [],
      epic: [],
      legendary: [],
    };
    for (const skill of pool) byRarity[skill.rarity].push(skill);

    const availableRarities = RARITIES.filter((rarity) => byRarity[rarity].length > 0);
    const rarityIndex = rng.weightedIndex(availableRarities.map((rarity) => weights[rarity]));
    const rarity = availableRarities[rarityIndex];
    if (rarity === undefined) {
      throw new Error('rollChoices: no rarity could be picked although the pool has cards');
    }

    const skill = rng.pick(byRarity[rarity]);
    out.push(skill);
    pool.splice(pool.indexOf(skill), 1);
  }
}

/**
 * Roll `count` skill cards: no duplicates in one roll, never a skill already at
 * `maxStacks`, includes unlocked Legendary Evolutions at high priority (unless
 * `includeEvolutions: false`), and **no throwing when the pool runs dry**.
 */
export function rollChoices(args: RollChoicesArgs): SkillDef[] {
  const count = args.count ?? DEFAULT_CHOICE_COUNT;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`rollChoices needs count to be an integer >= 0, got ${count}`);
  }

  const eligible = eligiblePool(args.owned, args.includeEvolutions ?? true, args.characterId);
  const target = Math.min(count, eligible.length);
  if (target === 0) return [];

  const weights = rarityWeights();
  const chosen: SkillDef[] = [];

  if (args.avoidIds !== undefined && args.avoidIds.length > 0) {
    const avoid = new Set(args.avoidIds);
    const fresh = eligible.filter((skill) => !avoid.has(skill.id));
    const deferred = eligible.filter((skill) => avoid.has(skill.id));

    drawWeightedFrom(args.rng, fresh, weights, target, chosen);
    if (chosen.length < target) {
      drawWeightedFrom(args.rng, deferred, weights, target - chosen.length, chosen);
    }
    return chosen;
  }

  drawWeightedFrom(args.rng, eligible, weights, target, chosen);
  return chosen;
}

/**
 * Convenience reroll helper: rolls a fresh hand avoiding `previous` cards whenever enough
 * eligible skills remain (ADR-021).
 */
export function rerollChoices(args: RerollChoicesArgs): SkillDef[] {
  const avoidIds = args.previous.map((entry) => (typeof entry === 'string' ? entry : entry.id));
  return rollChoices({
    rng: args.rng,
    owned: args.owned,
    count: args.count,
    avoidIds,
    characterId: args.characterId,
  });
}

/**
 * Whether at least one eligible skill or unlocked Evolution not already in `previous` exists.
 * Used to disable Gold Reroll when rerolling could not surface any alternative card.
 */
export function hasAlternativeSkills(
  owned: ReadonlyMap<string, number>,
  previous: readonly (SkillDef | string)[],
  characterId?: CharacterId,
): boolean {
  const currentIds = new Set(previous.map((entry) => (typeof entry === 'string' ? entry : entry.id)));
  return eligiblePool(owned, true, characterId).some((skill) => !currentIds.has(skill.id));
}
