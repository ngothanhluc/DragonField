/**
 * Continue Endless loop progression, scaling modifiers, and unified difficulty composition (GDD §15.5, M15).
 *
 * Pure TS — zero `cc` imports, testable with vitest.
 * After beating the Chapter 4 Boss (`canStartEndless`), the player can continue looping
 * Chapters 1 → 2 → 3 → 4 → 1… with continuous per-loop scaling until death.
 */
import { ascensionModifiers } from './ascension';
import { CHAPTERS_PER_RUN } from './run-state';

export interface EndlessModifiers {
  readonly loop: number;
  readonly enemyHealthMult: number;
  readonly enemyDamageMult: number;
  readonly bossHealthMult: number;
  readonly extraElitesPerRoom: number;
  readonly goldRewardMult: number;
}

export interface EndlessStep {
  readonly chapter: number;
  readonly loop: number;
}

/**
 * Unified difficulty modifiers combining Ascension (0–5) and Endless Loop (0+)
 * so combat, waves, bosses, mid-run shops, and gold rewards read one clean source.
 */
export interface RunDifficultyModifiers {
  readonly ascension: number;
  readonly endlessLoop: number;
  readonly enemyHealthMult: number;
  readonly enemyDamageMult: number;
  readonly enemySpeedMult: number;
  readonly bossHealthMult: number;
  readonly extraElitesPerRoom: number;
  readonly enemyFireRateMult: number;
  readonly shopPriceMult: number;
  readonly goldRewardMult: number;
}

function clampLoop(loop: number): number {
  if (!Number.isFinite(loop) || loop <= 0) return 0;
  return Math.floor(loop);
}

/** True when Endless Mode can be entered (specifically after winning Chapter 4). */
export function canStartEndless(chapter: number, won: boolean): boolean {
  return won === true && Number.isInteger(chapter) && chapter === CHAPTERS_PER_RUN;
}

/**
 * Advance one chapter in Endless Mode:
 * - Chapter 1–3 → `{ chapter: chapter + 1, loop }`
 * - Chapter 4 → `{ chapter: 1, loop: loop + 1 }`
 */
export function nextEndlessStep(chapter: number, loop: number): EndlessStep {
  const safeLoop = clampLoop(loop);
  const safeChapter = Number.isFinite(chapter)
    ? Math.min(CHAPTERS_PER_RUN, Math.max(1, Math.trunc(chapter)))
    : 1;

  if (safeChapter >= CHAPTERS_PER_RUN) {
    return { chapter: 1, loop: safeLoop + 1 };
  }
  return { chapter: safeChapter + 1, loop: safeLoop };
}

/**
 * Endless scaling modifiers for `loop`:
 * - Loop 0: identity (`1` multipliers, `0` extra elites).
 * - Loop `k >= 1`: continuous per-loop scaling for enemy/boss HP, enemy damage, elites, and gold.
 */
export function endlessModifiers(loop: number): EndlessModifiers {
  const k = clampLoop(loop);
  if (k === 0) {
    return {
      loop: 0,
      enemyHealthMult: 1,
      enemyDamageMult: 1,
      bossHealthMult: 1,
      extraElitesPerRoom: 0,
      goldRewardMult: 1,
    };
  }
  return {
    loop: k,
    enemyHealthMult: 1 + 0.35 * k,
    enemyDamageMult: 1 + 0.2 * k,
    bossHealthMult: 1 + 0.4 * k,
    extraElitesPerRoom: k,
    goldRewardMult: 1 + 0.25 * k,
  };
}

/**
 * Combine Ascension tier (`0..5`) and Endless loop (`0+`) into one unified
 * `RunDifficultyModifiers` object by multiplying multipliers and summing extra elites.
 */
export function combinedDifficultyModifiers(
  ascension: number,
  endlessLoop: number,
): RunDifficultyModifiers {
  const asc = ascensionModifiers(ascension);
  const end = endlessModifiers(endlessLoop);

  return {
    ascension: asc.level,
    endlessLoop: end.loop,
    enemyHealthMult: asc.enemyHealthMult * end.enemyHealthMult,
    enemyDamageMult: asc.enemyDamageMult * end.enemyDamageMult,
    enemySpeedMult: asc.enemySpeedMult,
    bossHealthMult: asc.bossHealthMult * end.bossHealthMult,
    extraElitesPerRoom: asc.extraElitesPerRoom + end.extraElitesPerRoom,
    enemyFireRateMult: asc.enemyFireRateMult,
    shopPriceMult: asc.shopPriceMult,
    goldRewardMult: asc.goldRewardMult * end.goldRewardMult,
  };
}
