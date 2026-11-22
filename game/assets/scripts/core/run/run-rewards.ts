/**
 * Gold earned in **one run** (GDD §2, §7, §9).
 *
 * `core/run/rewards.ts` knows what an enemy/room is worth in gold; this file tracks the
 * run's total, applies the Greed factor (`DerivedStats.goldMultiplier`) and counts kills
 * for the result screen. Knows nothing about the engine or localStorage.
 *
 * Gold is only written to the save at **end of run** (death, win, quit, restart) —
 * see `game/run-end.ts`. That gives the HUD a live number during the run while
 * `SaveData.gold` is not written to localStorage on every kill. `spend` takes a shop
 * purchase back out of the run's gold, so the end-of-run bank adds only what is left.
 */
import type { EnemyRole } from '../level/level-data';
import { MAX_GOLD, goldForKill, goldForRoomClear } from './rewards';

/**
 * Multiply the reward then round. Greed +20% on a tank (3 gold) must give 4, not
 * 3 — flooring would make the skill useless against the enemy worth the most.
 */
function scaled(base: number, multiplier: number): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  const factor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.max(0, Math.round(base * factor));
}

function clampGold(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_GOLD, Math.max(0, Math.trunc(value)));
}

/** Total gold/kills of the current run. Every method is pure-ish: it only mutates internal state. */
export class RunRewards {
  private earned = 0;
  private kills = 0;

  get goldEarned(): number {
    return this.earned;
  }

  get killCount(): number {
    return this.kills;
  }

  /** Kill one enemy; returns the gold just added. Elites are already included in `goldForKill`. */
  awardKill(role: EnemyRole, elite: boolean, goldMultiplier = 1): number {
    this.kills += 1;
    const amount = scaled(goldForKill(role, elite), goldMultiplier);
    this.earned = clampGold(this.earned + amount);
    return amount;
  }

  /** Clear the room; a boss pays `GOLD.boss`, a regular room `GOLD.roomClear`. */
  awardRoomClear(isBossRoom: boolean, goldMultiplier = 1): number {
    const amount = scaled(goldForRoomClear(isBossRoom), goldMultiplier);
    this.earned = clampGold(this.earned + amount);
    return amount;
  }

  /** A flat bonus outside the kill/room table — the `gold` door's clear reward (#39). */
  awardBonus(amount: number): number {
    const safe = Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
    this.earned = clampGold(this.earned + safe);
    return safe;
  }

  /**
   * Spend up to `amount` (a whole, positive number; anything broken counts as 0) of this run's
   * gold — a shop purchase. Never goes below 0 and returns the amount actually removed.
   */
  spend(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const spent = Math.min(this.earned, Math.trunc(amount));
    this.earned -= spent;
    return spent;
  }

  /** Read only: the rule-based reward for one enemy, used by tooltips/tests. */
  static killValue(role: EnemyRole, elite: boolean, goldMultiplier = 1): number {
    return scaled(goldForKill(role, elite), goldMultiplier);
  }
}
