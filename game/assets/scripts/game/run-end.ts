/**
 * Write the run result to the save **once** (M5/M15). See `commitRunEnd` and `buildRichRunResult`.
 */
import {
  CHARACTER_IDS,
  isCharacterUnlocked,
  type CharacterId,
} from '../core/characters/roster';
import { clampAscension } from '../core/run/ascension';
import { canStartEndless } from '../core/run/endless';
import { applyGold } from '../core/run/rewards';
import type { DeathCause, RunUnlocksSummary } from '../core/run/run-summary';
import {
  unlockChapterAscension,
  unlockNextChapter,
  unlockedAscensionForChapter,
  type SaveData,
} from '../core/save/save-data';
import type { SaveRepository } from '../core/save/storage';

export interface ChapterUnlock {
  readonly save: SaveData;
  readonly unlocked: boolean;
  readonly chaptersUnlocked: number;
}

export interface RunEndArgs {
  readonly chapter: number;
  /** Gold earned in the run (Meta Gold Bonus & Ascension already applied). */
  readonly goldEarned: number;
  readonly won: boolean;
  /** Active Ascension tier (`0..5`, M15); defaults to `0`. */
  readonly ascension?: number;
  /** Active Endless loop (`0` = normal, `>= 1` = endless, M15); defaults to `0`. */
  readonly endlessLoop?: number;
}

export interface RunEndCommit extends ChapterUnlock {
  /** Total gold in the save after adding. */
  readonly gold: number;
  /** Newly unlocked Ascension tier for this chapter on a non-Endless win, if any. */
  readonly unlockedAscension?: { readonly chapter: number; readonly level: number };
  /** Playable characters newly unlocked by chapter clear progression. */
  readonly unlockedCharacters: readonly CharacterId[];
  /** True when this victory unlocked Endless Mode for the first time (first Ch4 clear). */
  readonly endlessUnlocked: boolean;
  /** Structured M15 unlock summary for `ResultScreen`. */
  readonly unlocks: RunUnlocksSummary;
}

/**
 * Full M15 run result payload prepared before run teardown so `ResultScreen` (once merged)
 * and debug hooks can display seed, Ascension/Endless depth, death cause, build, and unlocks.
 */
export interface RichRunResultData {
  readonly chapter: number;
  readonly roomReached: number;
  readonly roomsTotal: number;
  readonly goldEarned: number;
  readonly goldTotal: number;
  readonly durationMs: number;
  readonly kills: number;
  readonly won: boolean;
  readonly unlockedChapter?: number;
  readonly seed: number;
  readonly ascension: number;
  readonly endlessLoop: number;
  readonly characterId: CharacterId;
  readonly deathCause: DeathCause;
  readonly ownedSkills: Readonly<Record<string, number>>;
  readonly unlocks: RunUnlocksSummary;
  readonly canContinueEndless: boolean;
}

export interface BuildRichRunResultArgs {
  readonly chapter: number;
  readonly roomReached: number;
  readonly roomsTotal: number;
  readonly goldEarned: number;
  readonly goldTotal: number;
  readonly durationMs: number;
  readonly kills: number;
  readonly won: boolean;
  readonly seed: number;
  readonly ascension: number;
  readonly endlessLoop: number;
  readonly characterId: CharacterId;
  readonly deathCause: DeathCause;
  readonly ownedSkills: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  readonly unlocks: RunUnlocksSummary;
}

function ownedSkillsRecord(
  skills: ReadonlyMap<string, number> | Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (skills instanceof Map) {
    for (const [id, stacks] of skills.entries()) {
      if (Number.isFinite(stacks) && stacks > 0) out[id] = Math.floor(stacks);
    }
    return out;
  }
  for (const [id, stacks] of Object.entries(skills)) {
    if (Number.isFinite(stacks) && stacks > 0) out[id] = Math.floor(stacks);
  }
  return out;
}

/**
 * Build a complete M15 `RichRunResultData` payload cleanly from run state and `commitRunEnd` output.
 */
export function buildRichRunResult(args: BuildRichRunResultArgs): RichRunResultData {
  const endlessLoop =
    Number.isFinite(args.endlessLoop) && args.endlessLoop > 0
      ? Math.floor(args.endlessLoop)
      : 0;
  const ascension = clampAscension(args.ascension);
  const canContinueEndless = args.won && (canStartEndless(args.chapter, true) || endlessLoop >= 1);

  return {
    chapter: args.chapter,
    roomReached: args.roomReached,
    roomsTotal: args.roomsTotal,
    goldEarned: args.goldEarned,
    goldTotal: args.goldTotal,
    durationMs: args.durationMs,
    kills: args.kills,
    won: args.won,
    ...(args.unlocks.unlockedChapter !== undefined
      ? { unlockedChapter: args.unlocks.unlockedChapter }
      : {}),
    seed: Math.trunc(args.seed) >>> 0,
    ascension,
    endlessLoop,
    characterId: args.characterId,
    deathCause: args.won ? { kind: 'victory' } : args.deathCause,
    ownedSkills: ownedSkillsRecord(args.ownedSkills),
    unlocks: args.unlocks,
    canContinueEndless,
  };
}

/**
 * Compute unlock delta between `before` and `after` saves plus victory chapter/Ascension flags.
 */
export function computeRunUnlocksSummary(
  before: SaveData,
  after: SaveData,
  chapter: number,
  won: boolean,
  endlessLoop = 0,
): {
  readonly unlockedChapter?: number;
  readonly unlockedAscension?: { readonly chapter: number; readonly level: number };
  readonly unlockedCharacters: readonly CharacterId[];
  readonly endlessUnlocked: boolean;
  readonly unlocks: RunUnlocksSummary;
} {
  const isEndless = Number.isFinite(endlessLoop) && endlessLoop > 0;
  const unlockedChapter =
    after.chaptersUnlocked > before.chaptersUnlocked ? after.chaptersUnlocked : undefined;
  const unlockedCharacters = CHARACTER_IDS.filter(
    (id) => !isCharacterUnlocked(id, before) && isCharacterUnlocked(id, after),
  );
  const prevAsc = unlockedAscensionForChapter(before, chapter);
  const nextAsc = unlockedAscensionForChapter(after, chapter);
  const unlockedAscension =
    won && !isEndless && nextAsc > prevAsc ? { chapter, level: nextAsc } : undefined;
  const endlessUnlocked =
    won && !isEndless && canStartEndless(chapter, true) && prevAsc === 0;

  const unlocks: RunUnlocksSummary = {
    ...(unlockedChapter !== undefined ? { unlockedChapter } : {}),
    ...(unlockedCharacters.length > 0 ? { unlockedCharacters } : {}),
    ...(unlockedAscension !== undefined ? { unlockedAscension } : {}),
    ...(endlessUnlocked ? { endlessUnlocked: true } : {}),
  };

  return {
    ...(unlockedChapter !== undefined ? { unlockedChapter } : {}),
    ...(unlockedAscension !== undefined ? { unlockedAscension } : {}),
    unlockedCharacters,
    endlessUnlocked,
    unlocks,
  };
}

/**
 * Write the run result to the save **once**: add gold (kept even on a loss), unlock the next
 * chapter, and advance unlocked Ascension tier for the chapter on a non-Endless win (M15).
 */
export function commitRunEnd(
  save: SaveData,
  repository: SaveRepository,
  args: RunEndArgs,
): RunEndCommit {
  const withGold = applyGold(save, args.goldEarned).save;
  const afterChapter = args.won ? unlockNextChapter(withGold, args.chapter) : withGold;
  const isEndless = args.endlessLoop !== undefined && Number.isFinite(args.endlessLoop) && args.endlessLoop > 0;
  const tier = clampAscension(args.ascension ?? 0);
  const next =
    args.won && !isEndless
      ? unlockChapterAscension(afterChapter, args.chapter, tier)
      : afterChapter;

  repository.save(next);
  const delta = computeRunUnlocksSummary(save, next, args.chapter, args.won, args.endlessLoop ?? 0);

  return {
    save: next,
    gold: next.gold,
    unlocked: next.chaptersUnlocked !== save.chaptersUnlocked,
    chaptersUnlocked: next.chaptersUnlocked,
    ...(delta.unlockedAscension !== undefined
      ? { unlockedAscension: delta.unlockedAscension }
      : {}),
    unlockedCharacters: delta.unlockedCharacters,
    endlessUnlocked: delta.endlessUnlocked,
    unlocks: delta.unlocks,
  };
}
