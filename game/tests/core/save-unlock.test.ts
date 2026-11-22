import { describe, expect, it } from 'vitest';
import {
  createDefaultSave,
  unlockNextChapter,
} from '../../assets/scripts/core/save/save-data';

describe('unlockNextChapter', () => {
  it('winning chapter 1 opens chapter 2; winning 2 opens 3', () => {
    const first = unlockNextChapter(createDefaultSave(), 1);
    expect(first.chaptersUnlocked).toBe(2);

    const second = unlockNextChapter(first, 2);
    expect(second.chaptersUnlocked).toBe(3);
  });

  it('never shrinks progress and never exceeds the last chapter', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 3 };
    expect(unlockNextChapter(save, 1).chaptersUnlocked).toBe(3);
    // Clearing the last chapter caps at CHAPTERS_PER_RUN (4 since #45).
    expect(unlockNextChapter(save, 3).chaptersUnlocked).toBe(4);
    expect(unlockNextChapter({ ...save, chaptersUnlocked: 4 }, 4).chaptersUnlocked).toBe(4);

    const unlocked = unlockNextChapter({ ...createDefaultSave(), chaptersUnlocked: 2 }, 1);
    expect(unlocked.chaptersUnlocked).toBe(2);
  });

  it('does not modify the passed save; a wrong chapter throws', () => {
    const save = createDefaultSave();
    unlockNextChapter(save, 1);
    expect(save.chaptersUnlocked).toBe(1);
    expect(() => unlockNextChapter(save, 0)).toThrow();
    expect(() => unlockNextChapter(save, 5)).toThrow();
  });
});
