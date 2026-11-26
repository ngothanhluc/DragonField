import { SeededRng } from '../rng';
import { RARITIES, SKILLS, luckPoints, type Rarity, type SkillDef } from './pool';

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

/** Base rarity weights from GDD §6: common 70 / rare 25 / epic 5 (sum 100). */
export const BASE_RARITY_WEIGHTS: Readonly<Record<Rarity, number>> = {
  common: 70,
  rare: 25,
  epic: 5,
};

/** Cards offered each time (GDD §6: pick 1 of 3). */
export const DEFAULT_CHOICE_COUNT = 3;

/**
 * Luck formula — each luck point (1 Luck stack = 0.01 points, see `luck-add`)
 * shifts weight from common toward higher rarities, keeping the total ≈ 100:
 *
 * ```text
 * epic   = 5  + 100 × L
 * rare   = 25 +  50 × L
 * common = max(0, 100 − epic − rare)
 * ```
 *
 * Example: 3 Luck stacks (L = 0.03) → common 65.5 / rare 26.5 / epic 8.
 *
 * When a rarity has no valid cards left (every skill of that rarity is at maxStacks),
 * its weight is dropped from the roll — `weightedIndex` renormalises over
 * the rarities still present, so their relative odds are unchanged.
 *
 * `L` is clamped to [0, 0.5]: the current pool only allows at most 0.03, but clamping stops
 * a broken save from producing negative weights or swallowing all of common.
 */
export function rarityWeights(luck: number): Record<Rarity, number> {
  const clampedLuck = Number.isFinite(luck) ? Math.min(Math.max(luck, 0), 0.5) : 0;
  const epic = BASE_RARITY_WEIGHTS.epic + 100 * clampedLuck;
  const rare = BASE_RARITY_WEIGHTS.rare + 50 * clampedLuck;
  const common = Math.max(0, 100 - epic - rare);

  return { common, rare, epic };
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
}

export interface RerollChoicesArgs {
  readonly rng: SeededRng;
  readonly owned: ReadonlyMap<string, number>;
  /** Previously offered cards or skill ids to avoid repeating. */
  readonly previous: readonly (SkillDef | string)[];
  readonly count?: number;
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
    const byRarity: Record<Rarity, SkillDef[]> = { common: [], rare: [], epic: [] };
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
 * `maxStacks`, and **no throwing when the pool runs dry** — returns fewer than `count`
 * (including an empty array). The caller must handle 0–3 cards: the UI just draws what it gets.
 *
 * Per card: pick a rarity by luck-weighted odds, then pick uniformly among the remaining skills
 * of that rarity. The chosen card leaves the pool so later picks cannot repeat it.
 */
export function rollChoices(args: RollChoicesArgs): SkillDef[] {
  const count = args.count ?? DEFAULT_CHOICE_COUNT;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`rollChoices needs count to be an integer >= 0, got ${count}`);
  }

  const eligible = SKILLS.filter(
    (skill) => (args.owned.get(skill.id) ?? 0) < skill.maxStacks,
  );
  const target = Math.min(count, eligible.length);
  if (target === 0) return [];

  const weights = rarityWeights(luckPoints(args.owned));
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
  });
}

/**
 * Whether at least one eligible skill not already in `previous` exists in the pool.
 * Used to disable Gold Reroll when rerolling could not surface any alternative skill.
 */
export function hasAlternativeSkills(
  owned: ReadonlyMap<string, number>,
  previous: readonly (SkillDef | string)[],
): boolean {
  const currentIds = new Set(previous.map((entry) => (typeof entry === 'string' ? entry : entry.id)));
  return SKILLS.some(
    (skill) => (owned.get(skill.id) ?? 0) < skill.maxStacks && !currentIds.has(skill.id),
  );
}
