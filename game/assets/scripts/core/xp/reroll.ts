/**
 * Escalating gold reroll pricing and shared-gold deduction for level-up skill picks (M12, ADR-021).
 *
 * Pure logic — zero `cc` imports. Pricing comes from `config/tuning.json` (`xp.reroll`), escalating
 * linearly with `rerollsUsed` (`baseCost + costStep * rerollsUsed`). Shared gold spends current run
 * gold first and falls back to banked meta save gold, matching `core/run/special-rooms.ts`.
 */
import { XP_TUNING, type XpRerollTuning } from '../enemies/tuning';
import { shopGold } from '../run/special-rooms';
import type { SaveData } from '../save/save-data';

export type RerollSpendResult =
  | {
      readonly ok: true;
      readonly cost: number;
      readonly remainingGold: number;
      readonly nextRerollsUsed: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'not-enough-gold';
      readonly cost: number;
      readonly remainingGold: number;
      readonly nextRerollsUsed: number;
    };

export type SharedRerollSpendResult =
  | {
      readonly ok: true;
      readonly cost: number;
      readonly save: SaveData;
      readonly runGold: number;
      readonly nextRerollsUsed: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'not-enough-gold';
      readonly cost: number;
      readonly save: SaveData;
      readonly runGold: number;
      readonly nextRerollsUsed: number;
    };

function safeRerollsUsed(rerollsUsed: number): number {
  if (!Number.isFinite(rerollsUsed) || rerollsUsed <= 0) return 0;
  return Math.floor(rerollsUsed);
}

/**
 * Gold cost for the next reroll given how many rerolls have already been used (`0` = first reroll).
 * Escalates cleanly as `baseCost + costStep * rerollsUsed`.
 */
export function rerollCost(
  rerollsUsed: number,
  tuning: XpRerollTuning = XP_TUNING.reroll,
): number {
  const used = safeRerollsUsed(rerollsUsed);
  const raw = tuning.baseCost + tuning.costStep * used;
  return Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0;
}

/** Whether `availableGold` can pay for the next reroll. Non-finite or negative gold returns `false`. */
export function canReroll(
  availableGold: number,
  rerollsUsed: number,
  tuning: XpRerollTuning = XP_TUNING.reroll,
): boolean {
  if (!Number.isFinite(availableGold) || availableGold < 0) return false;
  return Math.trunc(availableGold) >= rerollCost(rerollsUsed, tuning);
}

/**
 * Pure gold deduction helper against a scalar `availableGold` balance.
 * Never allows gold to go negative; returns `ok: false` with `reason: 'not-enough-gold'` when short.
 */
export function deductRerollCost(
  availableGold: number,
  rerollsUsed: number,
  tuning: XpRerollTuning = XP_TUNING.reroll,
): RerollSpendResult {
  const used = safeRerollsUsed(rerollsUsed);
  const cost = rerollCost(used, tuning);
  const gold = Number.isFinite(availableGold) && availableGold > 0 ? Math.trunc(availableGold) : 0;

  if (!canReroll(availableGold, used, tuning)) {
    return {
      ok: false,
      reason: 'not-enough-gold',
      cost,
      remainingGold: gold,
      nextRerollsUsed: used,
    };
  }

  return {
    ok: true,
    cost,
    remainingGold: gold - cost,
    nextRerollsUsed: used + 1,
  };
}

/**
 * Spend shared gold (current run gold first, then banked meta save gold) to pay for a skill reroll.
 * Mirrors `buyFromShop` in `core/run/special-rooms.ts`: pure, immutable, never goes negative.
 */
export function spendSharedGoldForReroll(
  save: SaveData,
  runGold: number,
  rerollsUsed: number,
  tuning: XpRerollTuning = XP_TUNING.reroll,
): SharedRerollSpendResult {
  const used = safeRerollsUsed(rerollsUsed);
  const cost = rerollCost(used, tuning);
  const earned = Number.isFinite(runGold) && runGold > 0 ? Math.trunc(runGold) : 0;
  const banked = Number.isFinite(save.gold) && save.gold > 0 ? Math.trunc(save.gold) : 0;

  if (shopGold(save, earned) < cost) {
    return {
      ok: false,
      reason: 'not-enough-gold',
      cost,
      save,
      runGold: earned,
      nextRerollsUsed: used,
    };
  }

  const fromRun = Math.min(earned, cost);
  const fromBank = cost - fromRun;
  return {
    ok: true,
    cost,
    save: fromBank > 0 ? { ...save, gold: Math.max(0, banked - fromBank) } : save,
    runGold: earned - fromRun,
    nextRerollsUsed: used + 1,
  };
}
