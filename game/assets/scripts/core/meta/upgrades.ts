/**
 * Meta progression: 3 permanent tracks bought with gold kept after each run (GDD §7).
 *
 * This file only defines **data + rules**; it knows nothing about `localStorage`
 * or the engine (the browser adapter lives in `assets/scripts/game/`). Every function is
 * pure: `buy` returns new state and never mutates its input.
 */

export const UPGRADE_TRACKS = ['hearts', 'damage', 'fireRate'] as const;
export type UpgradeTrack = (typeof UPGRADE_TRACKS)[number];

/** Maximum level of a track (GDD §7: 10 levels per track). */
export const MAX_LEVEL = 10;

/**
 * The health track alone is capped at 5 levels instead of 10.
 *
 * GDD §7 lists 10 levels for the health track with prices 50 → 500. But each level is
 * **+1 heart** on top of the base 6 hearts (`DEFAULT_COMBAT.playerMaxHearts`), so 10 levels gives
 * 16 hearts — does not fit the 512×288 HUD and breaks the difficulty curve; the Vitality skill (GDD §6)
 * only adds at most +5 hearts either. So the permanent track keeps exactly the +5 hearts threshold.
 * The price table still keeps all 10 GDD steps for reference and so the cap can be raised later
 * without re-tuning prices.
 */
export const MAX_HEARTS_TRACK = 5;

/**
 * Purchase price per level, index 0 = the price to reach level 1. Explicit table (no formula)
 * so every number is reviewable: hearts 50 → 500 (≈×1.29/level),
 * damage/fireRate 40 → 400, matching GDD §7.
 */
const HEARTS_COSTS: readonly number[] = Object.freeze([
  50, 65, 85, 110, 140, 180, 235, 300, 390, 500,
]);

/** Damage and fire rate share one price ladder per GDD §7. */
const COMBAT_COSTS: readonly number[] = Object.freeze([
  40, 50, 65, 85, 110, 145, 185, 240, 310, 400,
]);

export const UPGRADE_COSTS: Readonly<Record<UpgradeTrack, readonly number[]>> = Object.freeze({
  hearts: HEARTS_COSTS,
  damage: COMBAT_COSTS,
  fireRate: COMBAT_COSTS,
});

/** +5% damage per level. */
export const DAMAGE_PER_LEVEL = 0.05;
/** +3% fire rate per level. */
export const FIRE_RATE_PER_LEVEL = 0.03;

/** The part of the state the purchase rules need. `SaveData` satisfies it, so it can be used directly. */
export interface UpgradeState {
  readonly upgrades: Record<UpgradeTrack, number>;
}

/**
 * Additive/multiplicative factors from meta, for the skill layer to merge into `DerivedStats`.
 * `DerivedStats` is not redeclared here — no second source of truth.
 */
export interface UpgradeBonuses {
  /** Hearts added to max health (+1/level). */
  readonly maxHeartsBonus: number;
  /** Multiplier on base damage, 1 = unchanged. */
  readonly damageMultiplier: number;
  /** Multiplier on base fire rate, 1 = unchanged. */
  readonly fireRateMultiplier: number;
}

export interface BuyResult {
  /** New state; the passed state is not modified. */
  readonly state: UpgradeState;
  /** Remaining gold. */
  readonly gold: number;
}

/** Level 0 for all 3 tracks. Used as the default for a new save. */
export function createDefaultUpgrades(): Record<UpgradeTrack, number> {
  return { hearts: 0, damage: 0, fireRate: 0 };
}

/** Maximum level of a track; hearts are lower for the reason in `MAX_HEARTS_TRACK`. */
export function maxLevelFor(track: UpgradeTrack): number {
  return track === 'hearts' ? MAX_HEARTS_TRACK : MAX_LEVEL;
}

/** Price to go from level `nextLevel - 1` to `nextLevel` (1-based, as the UI shows it). */
export function costFor(track: UpgradeTrack, nextLevel: number): number {
  if (!Number.isInteger(nextLevel) || nextLevel < 1 || nextLevel > MAX_LEVEL) {
    throw new Error(`Purchase level must be an integer 1..${MAX_LEVEL}, got ${nextLevel} (track '${track}')`);
  }

  const cost = UPGRADE_COSTS[track][nextLevel - 1];
  if (cost === undefined) {
    throw new Error(`Price table for track '${track}' is missing level ${nextLevel}`);
  }
  return cost;
}

/**
 * Current level, normalised: an integer in 0..max. A broken save cannot turn into
 * an infinite bonus.
 */
function safeLevel(state: UpgradeState, track: UpgradeTrack): number {
  const level = state.upgrades[track];
  if (!Number.isFinite(level)) return 0;
  return Math.min(Math.max(Math.trunc(level), 0), maxLevelFor(track));
}

/** Whether the next level of `track` can be bought. Never throws. */
export function canBuy(state: UpgradeState, track: UpgradeTrack, gold: number): boolean {
  const level = safeLevel(state, track);
  if (level >= maxLevelFor(track)) return false;
  if (!Number.isFinite(gold)) return false;
  return gold >= costFor(track, level + 1);
}

/**
 * Buy one level. Throws when the track is maxed or gold is short — that is a bug or a broken
 * UI, not a normal state, so it does not silently return the old state.
 */
export function buy(state: UpgradeState, track: UpgradeTrack, gold: number): BuyResult {
  const level = safeLevel(state, track);
  const maxLevel = maxLevelFor(track);

  if (level >= maxLevel) {
    throw new Error(`Track '${track}' is already at maximum level ${maxLevel}`);
  }

  const price = costFor(track, level + 1);
  if (!Number.isFinite(gold) || gold < price) {
    throw new Error(
      `Not enough gold to buy '${track}' level ${level + 1}: need ${price}, have ${gold}`,
    );
  }

  return {
    state: { upgrades: withLevel(state.upgrades, track, level + 1) },
    gold: gold - price,
  };
}

/** Deliberate copy: keeps the Record type and never mutates the old state. */
function withLevel(
  levels: Record<UpgradeTrack, number>,
  track: UpgradeTrack,
  level: number,
): Record<UpgradeTrack, number> {
  return {
    hearts: track === 'hearts' ? level : levels.hearts,
    damage: track === 'damage' ? level : levels.damage,
    fireRate: track === 'fireRate' ? level : levels.fireRate,
  };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Convert meta levels into usable bonuses. Rounds to 4 decimals to avoid floating-point
 * noise (1 + 3×0.03 = 1.0900000000000001) when comparing/displaying.
 */
export function applyUpgrades(state: UpgradeState): UpgradeBonuses {
  const hearts = safeLevel(state, 'hearts');
  const damage = safeLevel(state, 'damage');
  const fireRate = safeLevel(state, 'fireRate');

  return {
    maxHeartsBonus: hearts,
    damageMultiplier: roundTo(1 + damage * DAMAGE_PER_LEVEL, 4),
    fireRateMultiplier: roundTo(1 + fireRate * FIRE_RATE_PER_LEVEL, 4),
  };
}
