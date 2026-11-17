/**
 * Ghi kết quả run vào save **một lần** (M5). Xem `commitRunEnd` bên dưới.
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
  /** Vàng kiếm trong run (đã tính Greed). */
  readonly goldEarned: number;
  readonly won: boolean;
}

export interface RunEndCommit extends ChapterUnlock {
  /** Tổng vàng trong save sau khi cộng. */
  readonly gold: number;
}

/**
 * Ghi kết quả run vào save **một lần**: cộng vàng (giữ cả khi thua) và mở
 * chapter kế nếu thắng. Vàng vào save ở đây, không phải mỗi lần giết quái.
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
