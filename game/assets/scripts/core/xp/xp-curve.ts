/**
 * Deterministic XP threshold curve, enemy kill XP values, and multi-level-up tracker (M12, ADR-021).
 *
 * Pure logic — zero `cc` imports, zero randomness, zero wall-clock reads. All balance numbers come
 * from `game/config/tuning.json` (`xp` and `doors`) via `XP_TUNING` / `DOORS_TUNING`, and every
 * function accepts an optional tuning override so unit tests can verify there is no hardcoding.
 *
 * Curve design:
 *   threshold(level, chapter) = max(1, round((base + linear·i + quad·i²) · chapterMultiplier))
 *   where `i = max(0, floor(level) - 1)`.
 *
 * Per-chapter multipliers match the enemy volume jump from Chapter 1 (~250 enemies) to Chapter 4
 * (~550 enemies), landing every chapter cleanly in the 12–16 level-ups/run target band (~1.5–2/room).
 * `splitling` XP is tuned to 0 in `tuning.json` so splitters cannot be farmed for XP.
 */
import {
  DOORS_TUNING,
  XP_TUNING,
  type DoorsTuning,
  type XpTuning,
} from '../enemies/tuning';
import type { EnemyRole } from '../level/level-data';

export interface XpState {
  /** Current player level, starting at 1. */
  readonly level: number;
  /** XP accumulated toward `level + 1` (`0 <= currentXp < nextLevelXp`). */
  readonly currentXp: number;
  /** XP required to advance from `level` to `level + 1`. */
  readonly nextLevelXp: number;
  /** Cumulative XP earned in this run. */
  readonly totalXp: number;
  /** Unspent level-up skill picks waiting to be opened (supports multi-level-up bursts). */
  readonly pendingLevelUps: number;
  /** 1-based chapter index governing threshold scaling. */
  readonly chapter: number;
}

export interface GrantXpResult {
  readonly state: XpState;
  /** Number of new level-ups triggered by this grant (0, 1, or more). */
  readonly levelsGained: number;
  /** Sanitized XP amount actually added (>= 0). */
  readonly gainedXp: number;
}

/** Clamp a 1-based chapter index into `1..chapterMultipliers.length` and return its multiplier. */
export function chapterXpMultiplier(chapter: number, tuning: XpTuning = XP_TUNING): number {
  const multipliers = tuning.curve.chapterMultipliers;
  if (multipliers.length === 0) return 1;
  const safeChapter = Number.isFinite(chapter) ? Math.floor(chapter) : 1;
  const index = Math.min(Math.max(safeChapter, 1), multipliers.length) - 1;
  return multipliers[index] ?? multipliers[0] ?? 1;
}

/**
 * XP required to advance from `level` (1-based) to `level + 1` in `chapter`.
 * Pure, deterministic, strictly >= 1, and monotonically non-decreasing with level.
 */
export function xpForNextLevel(
  level: number,
  chapter = 1,
  tuning: XpTuning = XP_TUNING,
): number {
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  const index = safeLevel - 1;
  const { baseThreshold, linearStep, quadraticStep } = tuning.curve;
  const raw = baseThreshold + linearStep * index + quadraticStep * index * index;
  const scaled = raw * chapterXpMultiplier(chapter, tuning);
  return Math.max(1, Math.round(scaled));
}

/**
 * XP dropped when killing an enemy of `role`.
 *
 * - `splitling` has base XP 0 in `tuning.json`, so it always yields 0 even when elite or in an
 *   `xp` challenge room (prevents splitter farming).
 * - Elites multiply base XP by `tuning.eliteMultiplier`.
 * - `roomMultiplier` applies room-level modifiers (e.g. `DOORS_TUNING.xpRoomXpMultiplier` inside
 *   an `xp` / Elite challenge room).
 */
export function xpForKill(
  role: EnemyRole,
  elite: boolean,
  tuning: XpTuning = XP_TUNING,
  roomMultiplier = 1,
): number {
  const base = tuning.roles[role];
  if (!Number.isFinite(base) || base <= 0) return 0;
  const eliteScale = elite ? tuning.eliteMultiplier : 1;
  const roomScale = Number.isFinite(roomMultiplier) && roomMultiplier > 0 ? roomMultiplier : 1;
  return Math.max(0, Math.round(base * eliteScale * roomScale));
}

/**
 * Bonus XP chest awarded on clearing an `xp` / Elite challenge door room, scaled to the chapter
 * curve so the door feels equally rewarding from Chapter 1 through Chapter 4.
 */
export function xpDoorClearBonus(
  chapter = 1,
  doorsTuning: DoorsTuning = DOORS_TUNING,
  xpTuning: XpTuning = XP_TUNING,
): number {
  const base = Number.isFinite(doorsTuning.xpBonus) && doorsTuning.xpBonus > 0 ? doorsTuning.xpBonus : 0;
  if (base <= 0) return 0;
  return Math.max(0, Math.round(base * chapterXpMultiplier(chapter, xpTuning)));
}

/** Initial level-1 XP state for a fresh run in `chapter`. */
export function createXpState(chapter = 1, tuning: XpTuning = XP_TUNING): XpState {
  const safeChapter = Number.isFinite(chapter) ? Math.max(1, Math.floor(chapter)) : 1;
  return {
    level: 1,
    currentXp: 0,
    nextLevelXp: xpForNextLevel(1, safeChapter, tuning),
    totalXp: 0,
    pendingLevelUps: 0,
    chapter: safeChapter,
  };
}

/**
 * Pure XP grant supporting multi-level-up queuing: excess XP carries over across as many
 * thresholds as it crosses, incrementing `level` and `pendingLevelUps` for each threshold crossed.
 * Non-finite or `<= 0` amounts are ignored safely.
 */
export function grantXp(
  state: XpState,
  amount: number,
  tuning: XpTuning = XP_TUNING,
): GrantXpResult {
  const gainedXp = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
  if (gainedXp <= 0) {
    return { state, levelsGained: 0, gainedXp: 0 };
  }

  let level = state.level;
  let currentXp = state.currentXp + gainedXp;
  let nextLevelXp = xpForNextLevel(level, state.chapter, tuning);
  let levelsGained = 0;

  while (currentXp >= nextLevelXp) {
    currentXp -= nextLevelXp;
    level += 1;
    levelsGained += 1;
    nextLevelXp = xpForNextLevel(level, state.chapter, tuning);
  }

  const nextState: XpState = {
    level,
    currentXp,
    nextLevelXp,
    totalXp: state.totalXp + gainedXp,
    pendingLevelUps: state.pendingLevelUps + levelsGained,
    chapter: state.chapter,
  };

  return { state: nextState, levelsGained, gainedXp };
}

/** Consume one queued level-up after the player completes a skill pick modal. Pure. */
export function consumePendingLevelUp(state: XpState): XpState {
  if (state.pendingLevelUps <= 0) return state;
  return { ...state, pendingLevelUps: state.pendingLevelUps - 1 };
}

/** Normalized progress `[0, 1)` toward the next level, for the HUD XP bar. */
export function xpProgressRatio(state: XpState): number {
  if (!(state.nextLevelXp > 0)) return 0;
  const ratio = state.currentXp / state.nextLevelXp;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return ratio >= 1 ? 1 : ratio;
}

/**
 * Stateful convenience wrapper around `XpState` for runtime and simulation loops
 * (mirrors `RunRewards` and `HealthState`).
 */
export class XpTracker {
  private state: XpState;

  constructor(
    chapter = 1,
    private readonly tuning: XpTuning = XP_TUNING,
  ) {
    this.state = createXpState(chapter, tuning);
  }

  get level(): number {
    return this.state.level;
  }

  get currentXp(): number {
    return this.state.currentXp;
  }

  get nextLevelXp(): number {
    return this.state.nextLevelXp;
  }

  get totalXp(): number {
    return this.state.totalXp;
  }

  get pendingLevelUps(): number {
    return this.state.pendingLevelUps;
  }

  get chapter(): number {
    return this.state.chapter;
  }

  get progress(): number {
    return xpProgressRatio(this.state);
  }

  /** Immutable snapshot for HUD sync or assertions. */
  snapshot(): XpState {
    return this.state;
  }

  /** Add XP and queue any level-ups crossed. */
  grant(amount: number): GrantXpResult {
    const result = grantXp(this.state, amount, this.tuning);
    this.state = result.state;
    return result;
  }

  /** Consume one pending level-up pick. Returns `false` when none are queued. */
  consumeLevelUp(): boolean {
    if (this.state.pendingLevelUps <= 0) return false;
    this.state = consumePendingLevelUp(this.state);
    return true;
  }

  /** Reset to level 1 (optionally for a new chapter). */
  reset(chapter: number = this.state.chapter): void {
    this.state = createXpState(chapter, this.tuning);
  }

  /**
   * Restore XP progress from an `ActiveRunSave` snapshot (M15 safe-boundary resume).
   * Clamps fields defensively so a stale/edited snapshot never produces invalid thresholds.
   */
  restore(saved: {
    readonly level: number;
    readonly currentXp: number;
    readonly totalXp: number;
    readonly pendingLevelUps: number;
    readonly chapter: number;
  }): void {
    const chapter = Number.isFinite(saved.chapter) ? Math.max(1, Math.floor(saved.chapter)) : 1;
    const level = Number.isFinite(saved.level) ? Math.max(1, Math.floor(saved.level)) : 1;
    const nextLevelXp = xpForNextLevel(level, chapter, this.tuning);
    const rawCurrent = Number.isFinite(saved.currentXp)
      ? Math.max(0, Math.floor(saved.currentXp))
      : 0;
    const currentXp = Math.min(rawCurrent, Math.max(0, nextLevelXp - 1));
    const rawTotal = Number.isFinite(saved.totalXp) ? Math.max(0, Math.floor(saved.totalXp)) : 0;
    const totalXp = Math.max(currentXp, rawTotal);
    const pendingLevelUps = Number.isFinite(saved.pendingLevelUps)
      ? Math.max(0, Math.floor(saved.pendingLevelUps))
      : 0;

    this.state = {
      level,
      currentXp,
      nextLevelXp,
      totalXp,
      pendingLevelUps,
      chapter,
    };
  }

  /**
   * Update the active chapter (M15 Endless loop transition) while preserving level, XP, and
   * queued level-ups; recomputes `nextLevelXp` for the new chapter's curve.
   */
  setChapter(chapter: number): void {
    const safeChapter = Number.isFinite(chapter) ? Math.max(1, Math.floor(chapter)) : 1;
    const nextLevelXp = xpForNextLevel(this.state.level, safeChapter, this.tuning);
    this.state = {
      ...this.state,
      chapter: safeChapter,
      nextLevelXp,
    };
  }
}
