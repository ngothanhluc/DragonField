/**
 * Rich Run Result & Death summary formatting helpers (GDD §15.5, M15).
 *
 * Pure TS — zero `cc` imports, testable with vitest.
 * Formats cause of death, acquired Legendary Evolutions + top skills with stack counts,
 * and unlocked chapters / heroes / Ascension tiers into compact lines for `ResultScreen`.
 */
import { BOSSES, type BossId } from '../boss/boss-defs';
import { CHARACTERS, isCharacterId, type CharacterId } from '../characters/roster';
import type { EnemyRole } from '../level/level-data';
import { resolveOwnedEvolutions } from '../skills/evolutions';
import { resolveOwnedSkills, type BaseRarity } from '../skills/pool';
import { ascensionLabel, clampAscension } from './ascension';

export type DeathCause =
  | { readonly kind: 'enemy'; readonly role: EnemyRole; readonly elite?: boolean }
  | { readonly kind: 'enemy-bullet'; readonly role?: EnemyRole }
  | { readonly kind: 'bomber-blast'; readonly elite?: boolean }
  | { readonly kind: 'boss'; readonly bossId: BossId; readonly phase?: number }
  | { readonly kind: 'victory' }
  | { readonly kind: 'unknown' };

export interface RunUnlocksSummary {
  readonly unlockedChapter?: number;
  readonly unlockedCharacters?: readonly CharacterId[];
  readonly unlockedAscension?: { readonly chapter: number; readonly level: number };
  readonly endlessUnlocked?: boolean;
}

export interface BuildSummaryOptions {
  /** Maximum characters per formatted line (default 54, sized for `ResultScreen` panelWidth 384). */
  readonly maxLineLength?: number;
  /** Maximum lines dedicated to base skills after Evolutions (default 2). */
  readonly maxSkillLines?: number;
}

const ROLE_DISPLAY_NAMES: Readonly<Record<EnemyRole, string>> = {
  chaser: 'Chaser',
  caster: 'Caster',
  tank: 'Tank',
  sniper: 'Sniper',
  splitter: 'Splitter',
  splitling: 'Splitling',
  bomber: 'Bomber',
  buffer: 'Buffer',
};

const RARITY_RANK: Readonly<Record<BaseRarity, number>> = {
  common: 1,
  rare: 2,
  epic: 3,
};

function enemyRoleLabel(role: EnemyRole): string {
  return ROLE_DISPLAY_NAMES[role] ?? 'Enemy';
}

/** Format a `DeathCause` into a crisp human-readable string for `ResultScreen`. */
export function formatDeathCause(cause: DeathCause): string {
  switch (cause.kind) {
    case 'enemy': {
      const name = enemyRoleLabel(cause.role);
      return cause.elite === true ? `Slain by Elite ${name}` : `Slain by ${name}`;
    }
    case 'enemy-bullet': {
      if (cause.role !== undefined) {
        return `Slain by ${enemyRoleLabel(cause.role)} bullet`;
      }
      return 'Slain by enemy bullet';
    }
    case 'bomber-blast': {
      return cause.elite === true
        ? 'Slain by Elite Bomber blast'
        : 'Slain by Bomber blast';
    }
    case 'boss': {
      const bossName = BOSSES[cause.bossId]?.displayName ?? cause.bossId;
      if (
        cause.phase !== undefined &&
        Number.isFinite(cause.phase) &&
        cause.phase >= 1
      ) {
        return `Slain by ${bossName} (Phase ${Math.trunc(cause.phase)})`;
      }
      return `Slain by ${bossName}`;
    }
    case 'victory':
      return 'Chapter Cleared!';
    case 'unknown':
      return 'Defeated in combat';
  }
}

function packCommaItems(
  prefix: string,
  items: readonly string[],
  maxLineLength: number,
  maxLines: number,
): string[] {
  if (items.length === 0 || maxLines <= 0) return [];

  const lines: string[] = [];
  let current = prefix;
  let countOnLine = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const separator = countOnLine === 0 ? '' : ', ';
    const remainingAfter = items.length - index - 1;
    const isLastLine = lines.length === maxLines - 1;
    const suffixReserve =
      isLastLine && remainingAfter > 0 ? ` (+${remainingAfter} more)` : '';
    const candidate = `${current}${separator}${item}`;

    if (
      candidate.length + suffixReserve.length <= maxLineLength ||
      (lines.length === 0 && countOnLine === 0)
    ) {
      current = candidate;
      countOnLine += 1;
      continue;
    }

    if (isLastLine) {
      const remaining = items.length - index;
      lines.push(`${current} (+${remaining} more)`);
      return lines;
    }

    lines.push(current);
    current = item;
    countOnLine = 1;
  }

  if (countOnLine > 0) {
    lines.push(current);
  }
  return lines;
}

/**
 * Format acquired Legendary Evolutions (prominently first) and top base skills with stack
 * counts into compact lines sized for `ResultScreen` without overflow.
 */
export function formatBuildSummary(
  ownedSkills: ReadonlyMap<string, number>,
  options: BuildSummaryOptions = {},
): string[] {
  const maxLineLength =
    options.maxLineLength !== undefined && Number.isFinite(options.maxLineLength)
      ? Math.max(24, Math.trunc(options.maxLineLength))
      : 54;
  const maxSkillLines =
    options.maxSkillLines !== undefined && Number.isFinite(options.maxSkillLines)
      ? Math.max(1, Math.trunc(options.maxSkillLines))
      : 2;

  const evolutions = resolveOwnedEvolutions(ownedSkills);
  const skills = resolveOwnedSkills(ownedSkills);

  if (evolutions.length === 0 && skills.length === 0) {
    return ['Build: None'];
  }

  const lines: string[] = [];

  if (evolutions.length > 0) {
    const evoNames = evolutions.map((evo) => evo.def.name);
    lines.push(
      ...packCommaItems('Evolutions: ', evoNames, maxLineLength, evolutions.length),
    );
  }

  if (skills.length > 0) {
    // Sort by stack count desc, rarity desc, then preserve deterministic SKILLS pool order.
    const sorted = skills.slice().sort((a, b) => {
      if (b.stacks !== a.stacks) return b.stacks - a.stacks;
      return RARITY_RANK[b.def.rarity] - RARITY_RANK[a.def.rarity];
    });
    const skillTokens = sorted.map((entry) => `${entry.def.name} x${entry.stacks}`);
    lines.push(...packCommaItems('Skills: ', skillTokens, maxLineLength, maxSkillLines));
  }

  return lines;
}

/** Format newly earned chapter, character, Ascension, and Endless unlocks into crisp lines. */
export function formatRunUnlocks(unlocks: RunUnlocksSummary): string[] {
  const lines: string[] = [];

  if (
    unlocks.unlockedChapter !== undefined &&
    Number.isFinite(unlocks.unlockedChapter) &&
    unlocks.unlockedChapter >= 1
  ) {
    lines.push(`Chapter ${Math.trunc(unlocks.unlockedChapter)} unlocked!`);
  }

  if (unlocks.unlockedCharacters !== undefined && unlocks.unlockedCharacters.length > 0) {
    const names: string[] = [];
    for (const id of unlocks.unlockedCharacters) {
      const name = isCharacterId(id) ? CHARACTERS[id].name : String(id);
      if (!names.includes(name)) names.push(name);
    }
    if (names.length === 1) {
      lines.push(`Hero unlocked: ${names[0]}`);
    } else if (names.length > 1) {
      lines.push(`Heroes unlocked: ${names.join(', ')}`);
    }
  }

  if (unlocks.unlockedAscension !== undefined) {
    const { chapter, level } = unlocks.unlockedAscension;
    const clampedLevel = clampAscension(level);
    if (clampedLevel >= 1 && Number.isFinite(chapter) && chapter >= 1) {
      lines.push(`Unlocked: Ch${Math.trunc(chapter)} ${ascensionLabel(clampedLevel)}`);
    }
  }

  if (unlocks.endlessUnlocked === true) {
    lines.push('Endless Mode unlocked!');
  }

  return lines;
}
