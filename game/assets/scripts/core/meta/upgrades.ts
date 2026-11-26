/**
 * Meta progression: 6 permanent tracks bought with gold kept after each run (GDD §7, §15.5, M15).
 *
 * Organized into two categories:
 * - **Stats (3):** `hearts` (+1 heart/lv, max 5), `damage` (+5%/lv, max 10), `fireRate` (+3%/lv, max 10).
 * - **Utilities (3, NO Revive):** `xpMagnet` (+15% magnet radius/lv, max 5),
 *   `goldBonus` (+12% gold earned/lv, max 5), `freeRerolls` (+1 free skill reroll/run, max 3).
 *
 * This file only defines **data + rules**; it knows nothing about `localStorage`
 * or the engine (the browser adapter lives in `assets/scripts/game/`). Every function is
 * pure: `buy` returns new state and never mutates its input.
 */

export const STAT_UPGRADE_TRACKS = ['hearts', 'damage', 'fireRate'] as const;
export type StatUpgradeTrack = (typeof STAT_UPGRADE_TRACKS)[number];

export const UTILITY_UPGRADE_TRACKS = ['xpMagnet', 'goldBonus', 'freeRerolls'] as const;
export type UtilityUpgradeTrack = (typeof UTILITY_UPGRADE_TRACKS)[number];

export const UPGRADE_TRACKS = [...STAT_UPGRADE_TRACKS, ...UTILITY_UPGRADE_TRACKS] as const;
export type UpgradeTrack = (typeof UPGRADE_TRACKS)[number];

export type UpgradeCategory = 'stat' | 'utility';

/** Maximum level of the combat stat tracks (`damage`, `fireRate`; GDD §7: 10 levels). */
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

/** Utility track caps (GDD §15.5, M15). */
export const MAX_XP_MAGNET_TRACK = 5;
export const MAX_GOLD_BONUS_TRACK = 5;
export const MAX_FREE_REROLLS_TRACK = 3;

/**
 * Purchase price per level, index 0 = the price to reach level 1. Explicit tables (no formula)
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

/** Utility track price ladders (M15, GDD §15.5). */
const XP_MAGNET_COSTS: readonly number[] = Object.freeze([30, 60, 100, 150, 220]);
const GOLD_BONUS_COSTS: readonly number[] = Object.freeze([35, 70, 120, 180, 260]);
const FREE_REROLLS_COSTS: readonly number[] = Object.freeze([60, 140, 260]);

export const UPGRADE_COSTS: Readonly<Record<UpgradeTrack, readonly number[]>> = Object.freeze({
  hearts: HEARTS_COSTS,
  damage: COMBAT_COSTS,
  fireRate: COMBAT_COSTS,
  xpMagnet: XP_MAGNET_COSTS,
  goldBonus: GOLD_BONUS_COSTS,
  freeRerolls: FREE_REROLLS_COSTS,
});

export interface UpgradeTrackMeta {
  readonly id: UpgradeTrack;
  readonly name: string;
  readonly category: UpgradeCategory;
  readonly maxLevel: number;
  readonly costs: readonly number[];
  readonly effectSummary: string;
}

export const UPGRADE_TRACK_META: Readonly<Record<UpgradeTrack, UpgradeTrackMeta>> = Object.freeze({
  hearts: {
    id: 'hearts',
    name: 'Hearts',
    category: 'stat',
    maxLevel: MAX_HEARTS_TRACK,
    costs: HEARTS_COSTS,
    effectSummary: '+1 max heart / lv',
  },
  damage: {
    id: 'damage',
    name: 'Damage',
    category: 'stat',
    maxLevel: MAX_LEVEL,
    costs: COMBAT_COSTS,
    effectSummary: '+5% damage / lv',
  },
  fireRate: {
    id: 'fireRate',
    name: 'Fire Rate',
    category: 'stat',
    maxLevel: MAX_LEVEL,
    costs: COMBAT_COSTS,
    effectSummary: '+3% fire rate / lv',
  },
  xpMagnet: {
    id: 'xpMagnet',
    name: 'XP Magnet',
    category: 'utility',
    maxLevel: MAX_XP_MAGNET_TRACK,
    costs: XP_MAGNET_COSTS,
    effectSummary: '+15% XP magnet / lv',
  },
  goldBonus: {
    id: 'goldBonus',
    name: 'Gold Bonus',
    category: 'utility',
    maxLevel: MAX_GOLD_BONUS_TRACK,
    costs: GOLD_BONUS_COSTS,
    effectSummary: '+12% gold / lv',
  },
  freeRerolls: {
    id: 'freeRerolls',
    name: 'Free Rerolls',
    category: 'utility',
    maxLevel: MAX_FREE_REROLLS_TRACK,
    costs: FREE_REROLLS_COSTS,
    effectSummary: '+1 free reroll / run',
  },
});

/** +5% damage per level. */
export const DAMAGE_PER_LEVEL = 0.05;
/** +3% fire rate per level. */
export const FIRE_RATE_PER_LEVEL = 0.03;
/** +15% XP orb magnet pickup radius per level (max +75% at lv 5). */
export const XP_MAGNET_PER_LEVEL = 0.15;
/** +12% gold earned per level (max +60% at lv 5; replaces legacy Greed skill). */
export const GOLD_BONUS_PER_LEVEL = 0.12;
/** +1 free skill-pick reroll per run per level (max 3/run at lv 3). */
export const FREE_REROLLS_PER_LEVEL = 1;

/** The part of the state the purchase rules need. `SaveData` satisfies it, so it can be used directly. */
export interface UpgradeState {
  readonly upgrades: Record<UpgradeTrack, number>;
}

/**
 * Additive/multiplicative stat factors from meta, for the skill layer to merge into `DerivedStats`.
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

/** Utility bonuses derived from the 3 Meta Shop Utility tracks (M15). */
export interface UtilityUpgradeBonuses {
  /** Multiplier on XP orb magnetic pickup radius, 1 = unchanged. */
  readonly xpMagnetMult: number;
  /** Multiplier on gold earned in a run, 1 = unchanged. */
  readonly goldBonusMult: number;
  /** Free skill-pick rerolls granted per run (0..3). */
  readonly freeRerolls: number;
}

export interface BuyResult {
  /** New state; the passed state is not modified. */
  readonly state: UpgradeState;
  /** Remaining gold. */
  readonly gold: number;
}

/** Level 0 for all 6 tracks. Used as the default for a new save. */
export function createDefaultUpgrades(): Record<UpgradeTrack, number> {
  return {
    hearts: 0,
    damage: 0,
    fireRate: 0,
    xpMagnet: 0,
    goldBonus: 0,
    freeRerolls: 0,
  };
}

/** Category of a track (`'stat'` or `'utility'`). */
export function categoryFor(track: UpgradeTrack): UpgradeCategory {
  return UPGRADE_TRACK_META[track].category;
}

/** Maximum purchasable level of a track. */
export function maxLevelFor(track: UpgradeTrack): number {
  return UPGRADE_TRACK_META[track].maxLevel;
}

/** Price to go from level `nextLevel - 1` to `nextLevel` (1-based, as the UI shows it). */
export function costFor(track: UpgradeTrack, nextLevel: number): number {
  const table = UPGRADE_COSTS[track];
  const tableMax = table.length;
  if (!Number.isInteger(nextLevel) || nextLevel < 1 || nextLevel > tableMax) {
    throw new Error(
      `Purchase level must be an integer 1..${tableMax}, got ${nextLevel} (track '${track}')`,
    );
  }

  const cost = table[nextLevel - 1];
  if (cost === undefined) {
    throw new Error(`Price table for track '${track}' is missing level ${nextLevel}`);
  }
  return cost;
}

/** Alias for `costFor` — price to buy `nextLevel` (1-based) of `track`. */
export function upgradePrice(track: UpgradeTrack, nextLevel: number): number {
  return costFor(track, nextLevel);
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

/** Alias for `canBuy` — whether `track` can be upgraded with `gold`. */
export function canBuyUpgrade(state: UpgradeState, track: UpgradeTrack, gold: number): boolean {
  return canBuy(state, track, gold);
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

/** Alias for `buy` — purchase one level of `track` using `gold`. */
export function buyUpgrade(state: UpgradeState, track: UpgradeTrack, gold: number): BuyResult {
  return buy(state, track, gold);
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
    xpMagnet: track === 'xpMagnet' ? level : levels.xpMagnet,
    goldBonus: track === 'goldBonus' ? level : levels.goldBonus,
    freeRerolls: track === 'freeRerolls' ? level : levels.freeRerolls,
  };
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Convert permanent stat meta levels into usable combat bonuses. Rounds to 4 decimals to avoid
 * floating-point noise (1 + 3×0.03 = 1.0900000000000001) when comparing/displaying.
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

/**
 * Convert permanent Utility meta levels into run utility bonuses:
 * XP magnet radius multiplier, gold earned multiplier, and free skill rerolls per run.
 */
export function applyUtilityUpgrades(state: UpgradeState): UtilityUpgradeBonuses {
  const xpMagnet = safeLevel(state, 'xpMagnet');
  const goldBonus = safeLevel(state, 'goldBonus');
  const freeRerolls = safeLevel(state, 'freeRerolls');

  return {
    xpMagnetMult: roundTo(1 + xpMagnet * XP_MAGNET_PER_LEVEL, 4),
    goldBonusMult: roundTo(1 + goldBonus * GOLD_BONUS_PER_LEVEL, 4),
    freeRerolls: freeRerolls * FREE_REROLLS_PER_LEVEL,
  };
}
