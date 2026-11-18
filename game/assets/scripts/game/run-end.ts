/**
 * Write the run result to the save **once** (M5). See `commitRunEnd` below.
 */
import { applyGold } from '../core/run/rewards';
import { unlockNextChapter } from '../core/save/save-data';
import type { SaveData } from '../core/save/save-data';
import type { SaveRepository } from '../core/save/storage';

export interface ChapterUnlock {
  readonly save: SaveData;
  readonly unlocked: boolean;
  readonly chaptersUnlocked: number;
}

export interface RunEndArgs {
  readonly chapter: number;
  /** Gold earned in the run (Greed already applied). */
  readonly goldEarned: number;
  readonly won: boolean;
}

export interface RunEndCommit extends ChapterUnlock {
  /** Total gold in the save after adding. */
  readonly gold: number;
}

/**
 * Write the run result to the save **once**: add gold (kept even on a loss) and unlock the
 * next chapter on a win. Gold reaches the save here, not on every kill.
 */
export function commitRunEnd(
  save: SaveData,
  repository: SaveRepository,
  args: RunEndArgs,
): RunEndCommit {
  const withGold = applyGold(save, args.goldEarned).save;
  const next = args.won ? unlockNextChapter(withGold, args.chapter) : withGold;
  repository.save(next);
  return {
    save: next,
    gold: next.gold,
    unlocked: next.chaptersUnlocked !== save.chaptersUnlocked,
    chaptersUnlocked: next.chaptersUnlocked,
  };
}
