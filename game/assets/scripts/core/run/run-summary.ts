/**
 * Rich Run Result & Death summary formatting helpers (GDD §15.5, M15).
 *
 * Pure TS — zero `cc` imports, testable with vitest.
 * Formats cause of death, acquired Legendary Evolutions + top skills with stack counts,
 * and unlocked chapters / heroes / Ascension tiers into compact lines for `ResultScreen`.
 */
import { BOSSES, type BossId } from '../boss/boss-defs';
import { isCharacterId, type CharacterId } from '../characters/roster';
import {
  getLocale,
  localizeBossName,
  localizeCharacterName,
  localizeEnemyRole,
  localizeSkillName,
  t,
  type Locale,
} from '../i18n';
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

const RARITY_RANK: Readonly<Record<BaseRarity, number>> = {
  common: 1,
  rare: 2,
  epic: 3,
};

/** Format a `DeathCause` into a crisp human-readable string for `ResultScreen`. */
export function formatDeathCause(cause: DeathCause, locale: Locale = getLocale()): string {
  switch (cause.kind) {
    case 'enemy': {
      const role = localizeEnemyRole(cause.role, locale);
      return cause.elite === true
        ? t('death.enemyElite', { role }, locale)
        : t('death.enemy', { role }, locale);
    }
    case 'enemy-bullet': {
      if (cause.role !== undefined) {
        return t(
          'death.enemyBulletRole',
          { role: localizeEnemyRole(cause.role, locale) },
          locale,
        );
      }
      return t('death.enemyBullet', undefined, locale);
    }
    case 'bomber-blast':
      return cause.elite === true
        ? t('death.bomberBlastElite', undefined, locale)
        : t('death.bomberBlast', undefined, locale);
    case 'boss': {
      const boss =
        BOSSES[cause.bossId] !== undefined
          ? localizeBossName(cause.bossId, locale)
          : cause.bossId;
      if (
        cause.phase !== undefined &&
        Number.isFinite(cause.phase) &&
        cause.phase >= 1
      ) {
        return t('death.bossPhase', { boss, phase: Math.trunc(cause.phase) }, locale);
      }
      return t('death.boss', { boss }, locale);
    }
    case 'victory':
      return t('death.victory', undefined, locale);
    case 'unknown':
      return t('death.unknown', undefined, locale);
  }
}

function packCommaItems(
  prefix: string,
  items: readonly string[],
  maxLineLength: number,
  maxLines: number,
  locale: Locale,
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
      isLastLine && remainingAfter > 0
        ? t('result.moreSuffix', { count: remainingAfter }, locale)
        : '';
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
      lines.push(`${current}${t('result.moreSuffix', { count: remaining }, locale)}`);
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
  locale: Locale = getLocale(),
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
    return [t('result.buildNone', undefined, locale)];
  }

  const lines: string[] = [];

  if (evolutions.length > 0) {
    const evoNames = evolutions.map((evo) => localizeSkillName(evo.def.id, evo.def.name, locale));
    lines.push(
      ...packCommaItems(
        t('result.evolutionsPrefix', undefined, locale),
        evoNames,
        maxLineLength,
        evolutions.length,
        locale,
      ),
    );
  }

  if (skills.length > 0) {
    // Sort by stack count desc, rarity desc, then preserve deterministic SKILLS pool order.
    const sorted = skills.slice().sort((a, b) => {
      if (b.stacks !== a.stacks) return b.stacks - a.stacks;
      return RARITY_RANK[b.def.rarity] - RARITY_RANK[a.def.rarity];
    });
    const skillTokens = sorted.map(
      (entry) => `${localizeSkillName(entry.def.id, entry.def.name, locale)} x${entry.stacks}`,
    );
    lines.push(
      ...packCommaItems(
        t('result.skillsPrefix', undefined, locale),
        skillTokens,
        maxLineLength,
        maxSkillLines,
        locale,
      ),
    );
  }

  return lines;
}

/** Format newly earned chapter, character, Ascension, and Endless unlocks into crisp lines. */
export function formatRunUnlocks(
  unlocks: RunUnlocksSummary,
  locale: Locale = getLocale(),
): string[] {
  const lines: string[] = [];

  if (
    unlocks.unlockedChapter !== undefined &&
    Number.isFinite(unlocks.unlockedChapter) &&
    unlocks.unlockedChapter >= 1
  ) {
    lines.push(t('result.unlockChapter', { chapter: Math.trunc(unlocks.unlockedChapter) }, locale));
  }

  if (unlocks.unlockedCharacters !== undefined && unlocks.unlockedCharacters.length > 0) {
    const names: string[] = [];
    for (const id of unlocks.unlockedCharacters) {
      const name = isCharacterId(id) ? localizeCharacterName(id, locale) : String(id);
      if (!names.includes(name)) names.push(name);
    }
    if (names.length === 1) {
      lines.push(t('result.unlockHeroOne', { name: names[0]! }, locale));
    } else if (names.length > 1) {
      lines.push(t('result.unlockHeroMany', { names: names.join(', ') }, locale));
    }
  }

  if (unlocks.unlockedAscension !== undefined) {
    const { chapter, level } = unlocks.unlockedAscension;
    const clampedLevel = clampAscension(level);
    if (clampedLevel >= 1 && Number.isFinite(chapter) && chapter >= 1) {
      lines.push(
        t(
          'result.unlockAscension',
          { chapter: Math.trunc(chapter), label: ascensionLabel(clampedLevel, locale) },
          locale,
        ),
      );
    }
  }

  if (unlocks.endlessUnlocked === true) {
    lines.push(t('result.unlockEndless', undefined, locale));
  }

  return lines;
}
