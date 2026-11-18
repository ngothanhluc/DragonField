/**
 * Chapter gate (GDD §2: the next chapter only opens when the previous one is won).
 *
 * This is the **rule**, not button state. Chapter select draws locked buttons from
 * `chapterGate`, and bootstrap calls this same function before loading a `.tmx` — so a
 * debug hook or a mis-aimed click cannot start an unopened chapter.
 */
import { CHAPTERS_PER_RUN } from '../run/run-state';
import type { SaveData } from './save-data';

export interface ChapterGate {
  readonly allowed: boolean;
  /** Reason string for logs; `null` when allowed. */
  readonly reason: string | null;
}

const ALLOWED: ChapterGate = { allowed: true, reason: null };

/**
 * `chapter` 1..`CHAPTERS_PER_RUN`, must have level data, and must not exceed the save's
 * `chaptersUnlocked`. A broken save (unlocked not a number) counts as 1
 * instead of opening every chapter.
 */
export function chapterGate(
  save: Pick<SaveData, 'chaptersUnlocked'>,
  chapter: number,
  hasData: boolean,
): ChapterGate {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) {
    return { allowed: false, reason: `Chapter ${chapter} does not exist` };
  }
  if (!hasData) {
    return { allowed: false, reason: `Chapter ${chapter} has no level data` };
  }

  const unlocked = Number.isInteger(save.chaptersUnlocked) ? save.chaptersUnlocked : 1;
  if (chapter > unlocked) {
    return { allowed: false, reason: `Chapter ${chapter} is locked (unlocked 1..${unlocked})` };
  }

  return ALLOWED;
}
