/**
 * Ascension Ladder (1–5) modifiers, unlock progression, and UI labels (GDD §15.5, M15).
 *
 * Pure TS — zero `cc` imports, deterministic and testable with vitest.
 * Tier 0 is Normal difficulty; Tiers 1–5 stack progressively harder combat/economy
 * modifiers paired with higher Gold rewards.
 */

/** Highest selectable Ascension tier. Tier 0 represents Normal difficulty. */
export const MAX_ASCENSION = 5;

export interface AscensionModifiers {
  readonly level: number;
  readonly enemyHealthMult: number;
  readonly enemyDamageMult: number;
  readonly enemySpeedMult: number;
  readonly bossHealthMult: number;
  readonly extraElitesPerRoom: number;
  readonly enemyFireRateMult: number;
  readonly shopPriceMult: number;
  readonly goldRewardMult: number;
}

const ASCENSION_TABLE: readonly AscensionModifiers[] = [
  {
    level: 0,
    enemyHealthMult: 1,
    enemyDamageMult: 1,
    enemySpeedMult: 1,
    bossHealthMult: 1,
    extraElitesPerRoom: 0,
    enemyFireRateMult: 1,
    shopPriceMult: 1,
    goldRewardMult: 1,
  },
  {
    level: 1,
    enemyHealthMult: 1.15,
    enemyDamageMult: 1,
    enemySpeedMult: 1,
    bossHealthMult: 1,
    extraElitesPerRoom: 1,
    enemyFireRateMult: 1,
    shopPriceMult: 1,
    goldRewardMult: 1.15,
  },
  {
    level: 2,
    enemyHealthMult: 1.15,
    enemyDamageMult: 1,
    enemySpeedMult: 1.06,
    bossHealthMult: 1.2,
    extraElitesPerRoom: 1,
    enemyFireRateMult: 1,
    shopPriceMult: 1,
    goldRewardMult: 1.3,
  },
  {
    level: 3,
    enemyHealthMult: 1.15,
    enemyDamageMult: 1,
    enemySpeedMult: 1.06,
    bossHealthMult: 1.2,
    extraElitesPerRoom: 1,
    enemyFireRateMult: 1.15,
    shopPriceMult: 1.2,
    goldRewardMult: 1.45,
  },
  {
    level: 4,
    enemyHealthMult: 1.35,
    enemyDamageMult: 1.15,
    enemySpeedMult: 1.06,
    bossHealthMult: 1.35,
    extraElitesPerRoom: 2,
    enemyFireRateMult: 1.15,
    shopPriceMult: 1.2,
    goldRewardMult: 1.65,
  },
  {
    level: 5,
    enemyHealthMult: 1.55,
    enemyDamageMult: 1.25,
    enemySpeedMult: 1.12,
    bossHealthMult: 1.55,
    extraElitesPerRoom: 3,
    enemyFireRateMult: 1.25,
    shopPriceMult: 1.35,
    goldRewardMult: 1.85,
  },
];

/** Clamp an Ascension tier into integer `[0, MAX_ASCENSION]`. Invalid/non-finite inputs become `0`. */
export function clampAscension(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.min(MAX_ASCENSION, Math.floor(level));
}

/** Return the stacked combat, economy, and gold modifiers for Ascension `level` (clamped `0..5`). */
export function ascensionModifiers(level: number): AscensionModifiers {
  const clamped = clampAscension(level);
  return ASCENSION_TABLE[clamped] ?? ASCENSION_TABLE[0]!;
}

/** Human-readable label (`Normal` for tier 0, `Ascension 1..5` for tiers 1–5). */
export function ascensionLabel(level: number): string {
  const clamped = clampAscension(level);
  return clamped === 0 ? 'Normal' : `Ascension ${clamped}`;
}

function bonusPercent(mult: number): number {
  return Math.round((mult - 1) * 100);
}

/**
 * Compact UI description lines for Chapter Select showing active modifiers for `level`.
 * Wraps entries cleanly at `maxLineLength` so labels never clip at 512×288 design resolution.
 */
export function ascensionSummaryLines(level: number, maxLineLength = 46): string[] {
  const mods = ascensionModifiers(level);
  if (mods.level === 0) {
    return ['Standard difficulty'];
  }

  const parts: string[] = [];
  if (mods.extraElitesPerRoom > 0) {
    const noun = mods.extraElitesPerRoom === 1 ? 'Elite' : 'Elites';
    parts.push(`+${mods.extraElitesPerRoom} ${noun}/room`);
  }
  if (mods.enemyHealthMult > 1) {
    parts.push(`+${bonusPercent(mods.enemyHealthMult)}% Enemy HP`);
  }
  if (mods.bossHealthMult > 1) {
    parts.push(`+${bonusPercent(mods.bossHealthMult)}% Boss HP`);
  }
  if (mods.enemyDamageMult > 1) {
    parts.push(`+${bonusPercent(mods.enemyDamageMult)}% Enemy DMG`);
  }
  if (mods.enemySpeedMult > 1) {
    parts.push(`+${bonusPercent(mods.enemySpeedMult)}% Speed`);
  }
  if (mods.enemyFireRateMult > 1) {
    parts.push(`+${bonusPercent(mods.enemyFireRateMult)}% Fire rate`);
  }
  if (mods.shopPriceMult > 1) {
    parts.push(`+${bonusPercent(mods.shopPriceMult)}% Shop price`);
  }
  if (mods.goldRewardMult > 1) {
    parts.push(`+${bonusPercent(mods.goldRewardMult)}% Gold`);
  }

  const lines: string[] = [];
  let current = '';
  for (const part of parts) {
    if (current.length === 0) {
      current = part;
      continue;
    }
    const candidate = `${current} · ${part}`;
    if (candidate.length <= maxLineLength) {
      current = candidate;
    } else {
      lines.push(current);
      current = part;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Compute the new highest unlocked Ascension tier after clearing `clearedAscension`,
 * preserving monotonic progression and capping at `MAX_ASCENSION`.
 */
export function nextAscensionUnlock(
  clearedAscension: number,
  currentMaxUnlocked: number,
): number {
  const current = clampAscension(currentMaxUnlocked);
  if (!Number.isFinite(clearedAscension) || clearedAscension < 0) {
    return current;
  }
  const cleared = clampAscension(clearedAscension);
  return Math.min(MAX_ASCENSION, Math.max(current, cleared + 1));
}
