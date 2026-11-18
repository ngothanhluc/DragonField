import type { SeededRng } from '../rng';
import { RARITIES, SKILLS, luckPoints, type Rarity, type SkillDef } from './pool';

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

  const candidates = SKILLS.filter(
    (skill) => (args.owned.get(skill.id) ?? 0) < skill.maxStacks,
  );
  const chosen: SkillDef[] = [];
  const target = Math.min(count, candidates.length);
  const weights = rarityWeights(luckPoints(args.owned));

  while (chosen.length < target) {
    const byRarity: Record<Rarity, SkillDef[]> = { common: [], rare: [], epic: [] };
    for (const skill of candidates) byRarity[skill.rarity].push(skill);

    const availableRarities = RARITIES.filter((rarity) => byRarity[rarity].length > 0);
    const rarityIndex = args.rng.weightedIndex(
      availableRarities.map((rarity) => weights[rarity]),
    );
    const rarity = availableRarities[rarityIndex];
    if (rarity === undefined) {
      throw new Error('rollChoices: no rarity could be picked although the pool has cards');
    }

    const skill = args.rng.pick(byRarity[rarity]);
    chosen.push(skill);
    candidates.splice(candidates.indexOf(skill), 1);
  }

  return chosen;
}
