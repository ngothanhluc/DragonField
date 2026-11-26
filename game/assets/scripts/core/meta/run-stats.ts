/**
 * Meta upgrades + 4-class Layer 1/Layer 2 stats → the base stats of a run (GDD §7, §15.4, M14).
 *
 * Composition order for a run (`statsForRun`):
 * 1. Base combat numbers (`DEFAULT_COMBAT` from `config/tuning.json`).
 * 2. Class Layer 1 base stat deltas/multipliers (`applyCharacterBaseStats`): hearts delta,
 *    damage, fire rate, move speed, projectile speed, targeting range.
 * 3. Permanent Meta upgrades (`applyUpgradesToBaseline`): +1 heart/level, +5% damage/level,
 *    +3% fire rate/level.
 * 4. Class Layer 2 starting passive (`applyCharacterPassive`):
 *    - **Ninja** (*Shadow Agility*): +10% move speed & -15% Dash cooldown
 *    - **Archer** (*Keen Sight*): +1 pierce & +12% crit chance (2× crit multiplier)
 *    - **Mage** (*Arcane Attunement*): -20% Active cooldown & +25% Active/AoE power
 *    - **Cultivator** (*Sword Heart*): +15% damage & +10% execute bonus (<30% HP)
 * 5. In-run skills & Legendary Evolutions stack on top via `computeDerivedStats`.
 */
import {
  DEFAULT_CHARACTER_ID,
  resolveSelectedCharacter,
  type CharacterId,
  type CharacterSelectionSource,
} from '../characters/roster';
import { DEFAULT_COMBAT } from '../config';
import { CHARACTERS_TUNING, type CharactersTuning } from '../enemies/tuning';
import {
  computeDerivedStats,
  type DerivedStats,
  type StatsBaseline,
} from '../skills/derived-stats';
import {
  applyUpgrades,
  applyUtilityUpgrades,
  type UpgradeBonuses,
  type UpgradeState,
  type UtilityUpgradeBonuses,
} from './upgrades';

/** Utility modifiers applied from Meta Shop Utility tracks at run start (M15). */
export type RunUtilityStats = UtilityUpgradeBonuses;

/**
 * Derive run utility modifiers (`xpMagnetMult`, `goldBonusMult`, `freeRerolls`) from a save.
 * Safe against missing/out-of-range levels; never mutates `save`.
 */
export function utilityStatsFromSave(save: UpgradeState): RunUtilityStats {
  return applyUtilityUpgrades(save);
}

function sanitize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Apply precomputed meta bonuses to the baseline. Never mutates `base`. */
export function applyUpgradesToBaseline(
  base: StatsBaseline,
  bonuses: UpgradeBonuses,
): StatsBaseline {
  return {
    ...base,
    damage: sanitize(roundTo(base.damage * bonuses.damageMultiplier, 4)),
    fireRatePerSecond: sanitize(
      roundTo(base.fireRatePerSecond * bonuses.fireRateMultiplier, 4),
    ),
    playerMaxHearts: Math.max(
      1,
      Math.floor(sanitize(base.playerMaxHearts + bonuses.maxHeartsBonus)),
    ),
  };
}

/** One entry point for legacy meta-only callers: save → the run's meta baseline. */
export function metaBaseline(base: StatsBaseline, state: UpgradeState): StatsBaseline {
  return applyUpgradesToBaseline(base, applyUpgrades(state));
}

/**
 * Apply Layer 1 per-class base stat deltas & multipliers from `CHARACTERS_TUNING`.
 * Ninja uses neutral multipliers (`1` / `maxHeartsDelta: 0`) so its Layer 1 baseline matches
 * `DEFAULT_COMBAT` identically. Never mutates `base`.
 */
export function applyCharacterBaseStats(
  base: StatsBaseline,
  characterId: CharacterId = DEFAULT_CHARACTER_ID,
  charactersTuning: CharactersTuning = CHARACTERS_TUNING,
): StatsBaseline {
  const stats = charactersTuning[characterId].baseStats;
  const baseProjectileSpeed =
    base.projectileSpeedTilesPerSecond ?? DEFAULT_COMBAT.projectileSpeedTilesPerSecond;
  const baseRange = base.targetingRangeTiles ?? DEFAULT_COMBAT.targetingRangeTiles;

  return {
    ...base,
    playerMaxHearts: Math.max(
      1,
      Math.floor(sanitize(base.playerMaxHearts + stats.maxHeartsDelta)),
    ),
    damage: sanitize(roundTo(base.damage * stats.damageMult, 4)),
    fireRatePerSecond: sanitize(roundTo(base.fireRatePerSecond * stats.fireRateMult, 4)),
    moveSpeedTilesPerSecond: sanitize(
      roundTo(base.moveSpeedTilesPerSecond * stats.moveSpeedMult, 4),
    ),
    projectileSpeedTilesPerSecond: sanitize(
      roundTo(baseProjectileSpeed * stats.projectileSpeedMult, 4),
    ),
    targetingRangeTiles: sanitize(roundTo(baseRange * stats.targetingRangeMult, 4)),
  };
}

/**
 * Apply Layer 2 per-class starting passive from `CHARACTERS_TUNING` onto a `StatsBaseline`.
 * Never mutates `base`.
 */
export function applyCharacterPassive(
  base: StatsBaseline,
  characterId: CharacterId = DEFAULT_CHARACTER_ID,
  charactersTuning: CharactersTuning = CHARACTERS_TUNING,
): StatsBaseline {
  const passive = charactersTuning[characterId].passive;
  const currentPierce = sanitize(base.pierce ?? 0);
  const currentCritChance = clamp01(sanitize(base.critChance ?? 0));
  const currentCritMult = Math.max(1, sanitize(base.critMultiplier ?? 1));
  const currentExecuteThreshold = clamp01(sanitize(base.executeThreshold ?? 0));
  const currentExecuteBonus = sanitize(base.executeBonus ?? 0);
  const currentDashCooldownMult = sanitize(base.dashCooldownMult ?? 1);
  const currentActiveCooldownMult = sanitize(base.activeCooldownMult ?? 1);
  const currentActivePowerMult = sanitize(base.activePowerMult ?? 1);
  const currentAoePowerMult = Math.max(1, sanitize(base.aoePowerMult ?? 1));

  return {
    ...base,
    damage: sanitize(roundTo(base.damage * (1 + passive.damageBonus), 4)),
    moveSpeedTilesPerSecond: sanitize(
      roundTo(base.moveSpeedTilesPerSecond * (1 + passive.moveSpeedBonus), 4),
    ),
    pierce: Math.floor(currentPierce + passive.pierceAdd),
    critChance: clamp01(roundTo(currentCritChance + passive.critChanceAdd, 4)),
    critMultiplier: Math.max(currentCritMult, passive.critMultiplier),
    executeThreshold: Math.max(currentExecuteThreshold, passive.executeThreshold),
    executeBonus: sanitize(roundTo(currentExecuteBonus + passive.executeBonus, 4)),
    dashCooldownMult: sanitize(roundTo(currentDashCooldownMult * passive.dashCooldownMult, 4)),
    activeCooldownMult: sanitize(
      roundTo(currentActiveCooldownMult * passive.activeCooldownMult, 4),
    ),
    activePowerMult: sanitize(roundTo(currentActivePowerMult + passive.activePowerBonus, 4)),
    aoePowerMult: Math.max(1, sanitize(roundTo(currentAoePowerMult * (1 + passive.aoePowerBonus), 4))),
  };
}

/** Minimal save input accepted by `statsForRun`. `SaveData` satisfies it directly. */
export interface RunStatsSource extends UpgradeState, CharacterSelectionSource {}

/**
 * Compute the complete starting `StatsBaseline` for a run from `save` and `characterId`
 * (defaults to `resolveSelectedCharacter(save).id`):
 * Layer 1 class base stats → permanent Meta upgrades → Layer 2 class starting passive.
 */
export function statsForRun(
  save: RunStatsSource,
  characterId?: CharacterId,
  base: StatsBaseline = DEFAULT_COMBAT,
  charactersTuning: CharactersTuning = CHARACTERS_TUNING,
): StatsBaseline {
  const id = characterId ?? resolveSelectedCharacter(save).id;
  const withClassBase = applyCharacterBaseStats(base, id, charactersTuning);
  const withMeta = applyUpgradesToBaseline(withClassBase, applyUpgrades(save));
  return applyCharacterPassive(withMeta, id, charactersTuning);
}

/** Convenience entry point returning full `DerivedStats` for a run's character, meta, and skills. */
export function derivedStatsForRun(
  save: RunStatsSource,
  owned: ReadonlyMap<string, number> = new Map<string, number>(),
  characterId?: CharacterId,
  base: StatsBaseline = DEFAULT_COMBAT,
  charactersTuning: CharactersTuning = CHARACTERS_TUNING,
): DerivedStats {
  return computeDerivedStats(owned, statsForRun(save, characterId, base, charactersTuning));
}
