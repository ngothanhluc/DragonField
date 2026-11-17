import { describe, expect, it } from 'vitest';
import {
  createDefaultSave,
  unlockNextChapter,
} from '../../assets/scripts/core/save/save-data';

describe('unlockNextChapter', () => {
  it('thắng chapter 1 mở chapter 2; thắng 2 mở 3', () => {
    const first = unlockNextChapter(createDefaultSave(), 1);
    expect(first.chaptersUnlocked).toBe(2);

    const second = unlockNextChapter(first, 2);
    expect(second.chaptersUnlocked).toBe(3);
  });

  it('không thu hẹp tiến trình và không vượt quá chapter cuối', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 3 };
    expect(unlockNextChapter(save, 1).chaptersUnlocked).toBe(3);
    expect(unlockNextChapter(save, 3).chaptersUnlocked).toBe(3);

    const unlocked = unlockNextChapter({ ...createDefaultSave(), chaptersUnlocked: 2 }, 1);
    expect(unlocked.chaptersUnlocked).toBe(2);
  });

  it('không sửa save truyền vào; chapter sai thì ném', () => {
    const save = createDefaultSave();
    unlockNextChapter(save, 1);
    expect(save.chaptersUnlocked).toBe(1);
    expect(() => unlockNextChapter(save, 0)).toThrow();
    expect(() => unlockNextChapter(save, 4)).toThrow();
  });
});
