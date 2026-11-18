/**
 * A run's gold (GDD §2, §7, §9). Three entry points:
 *
 * - `goldForKill` — reward per enemy role, elites ×3.
 * - `goldForRoomClear` — room-clear reward, boss 50 instead of 5.
 * - `applyGold` — add to the save, **always** returning finite gold >= 0.
 *
 * Knows nothing about the engine/localStorage: all functions are pure, no clock reads.
 * `summariseRun` packages the numbers for the result screen with a fixed shape so the UI
 * and tests do not have to guess which fields exist.
 */
import type { EnemyRole } from '../level/level-data';
import type { SaveData } from '../save/save-data';
import { ROOMS_PER_CHAPTER, type RunStatus } from './run-state';

export const GOLD = {
  chaser: 1,
  caster: 1,
  tank: 3,
  /** Elites are ×3 the regular version (GDD §4: elites only change health/damage). */
  eliteMultiplier: 3,
  roomClear: 5,
  boss: 50,
} as const;

/**
 * Gold cap: `SaveData.gold` is an integer in `0..Number.MAX_SAFE_INTEGER`
 * (`save-data.ts`), so every add must clamp here before serializing.
 */
export const MAX_GOLD = Number.MAX_SAFE_INTEGER;

/** Gold earned for killing one enemy. Elites are ×`GOLD.eliteMultiplier`. */
export function goldForKill(role: EnemyRole, elite: boolean): number {
  const base = GOLD[role];
  return elite ? base * GOLD.eliteMultiplier : base;
}

/** Gold for clearing a room. A boss room pays much more. */
export function goldForRoomClear(isBossRoom: boolean): number {
  return isBossRoom ? GOLD.boss : GOLD.roomClear;
}

export interface GoldResult {
  /** New save; the passed save is not modified. */
  readonly save: SaveData;
  /** Total gold after adding, clamped into `0..MAX_GOLD`. */
  readonly gold: number;
}

/**
 * Add gold to the save.
 *
 * - A non-finite `amount` (NaN/±Infinity) counts as 0: a broken reward is **not**
 *   allowed to mint gold.
 * - The result floors to an integer because the save schema only accepts integers.
 * - Clamped to `0..MAX_GOLD` so the save always passes `parseSaveData`.
 */
export function applyGold(save: SaveData, amount: number): GoldResult {
  const delta = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  // A broken save (NaN gold) must not swallow the reward just earned.
  const current = Number.isFinite(save.gold) ? save.gold : 0;
  const gold = clampGold(current + delta);
  return { save: { ...save, gold }, gold };
}

export interface RunSummaryArgs {
  readonly roomsCleared: number;
  readonly kills: number;
  readonly goldEarned: number;
  readonly durationMs: number;
  readonly status: RunStatus;
}

/** Fixed shape for the result screen (GDD §9: rooms reached, gold, time). */
export interface RunSummary {
  readonly status: RunStatus;
  /** Rooms cleared, clamped into `0..ROOMS_PER_CHAPTER`. */
  readonly roomsCleared: number;
  readonly kills: number;
  readonly goldEarned: number;
  readonly durationMs: number;
  /** Time in seconds, rounded to 1 decimal — for display. */
  readonly durationSeconds: number;
  readonly won: boolean;
  /** HUD/result label, e.g. `3/9`. */
  readonly roomLabel: string;
}

/**
 * Package the run result for the result screen. Every incoming number is sanitised: negative,
 * NaN or Infinity from a broken run must not leak into the UI.
 */
export function summariseRun(args: RunSummaryArgs): RunSummary {
  const roomsCleared = clampCount(args.roomsCleared, ROOMS_PER_CHAPTER);
  const durationMs = clampDuration(args.durationMs);

  return {
    status: args.status,
    roomsCleared,
    kills: clampCount(args.kills, MAX_GOLD),
    goldEarned: clampGold(args.goldEarned),
    durationMs,
    durationSeconds: Math.round(durationMs / 100) / 10,
    won: args.status === 'won',
    roomLabel: `${roomsCleared}/${ROOMS_PER_CHAPTER}`,
  };
}

function clampGold(value: number): number {
  // NaN carries no information → 0. +Infinity is overflow while summing → the cap.
  if (Number.isNaN(value)) return 0;
  if (!Number.isFinite(value)) return value > 0 ? MAX_GOLD : 0;
  return Math.min(MAX_GOLD, Math.max(0, Math.trunc(value)));
}

function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
