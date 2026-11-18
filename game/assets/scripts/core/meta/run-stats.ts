/**
 * Meta upgrades → the base stats of a run (GDD §7).
 *
 * `core/meta/upgrades.ts` only converts levels into 3 bonuses; this file applies them to
 * `StatsBaseline` **before** the skill layer stacks its own. That gives:
 *
 * - meta is the floor of every run (buy more, every later run is stronger);
 * - skills still multiply/add on top of that floor, with no second source of truth;
 * - testable with vitest, no engine needed.
 *
 * Convention: meta damage and fire rate are **factors on the base stats**, hearts are
 * **added directly** to the health cap. Never apply the factors to the skill bonus — skills
 * have their own stacking rules in `core/skills/derived-stats.ts`.
 */
import type { StatsBaseline } from '../skills/derived-stats';
import { applyUpgrades, type UpgradeBonuses, type UpgradeState } from './upgrades';

function sanitize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
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

/** One entry point for bootstrap: save → the run's baseline. */
export function metaBaseline(base: StatsBaseline, state: UpgradeState): StatsBaseline {
  return applyUpgradesToBaseline(base, applyUpgrades(state));
}
