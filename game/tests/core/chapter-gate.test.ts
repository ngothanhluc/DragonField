import { describe, expect, it } from 'vitest';
import { chapterGate } from '../../assets/scripts/core/save/chapter-gate';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';

describe('chapterGate', () => {
  it('chapter 1 is always open when there is data', () => {
    expect(chapterGate(createDefaultSave(), 1, true).allowed).toBe(true);
  });

  it('blocks an unopened chapter — not just a disabled button', () => {
    const save = createDefaultSave();

    const locked = chapterGate(save, 2, true);
    expect(locked.allowed).toBe(false);
    expect(locked.reason).toMatch(/locked/);
    expect(chapterGate(save, 3, true).allowed).toBe(false);
  });

  it('opens once the save has unlocked that chapter', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 2 };
    expect(chapterGate(save, 2, true).allowed).toBe(true);
    expect(chapterGate(save, 3, true).allowed).toBe(false);
  });

  it('blocks a chapter without level data even when unlocked', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 3 };
    const gate = chapterGate(save, 3, false);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/level data/);
  });

  it('blocks a chapter outside 1..3 / not an integer', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 3 };
    for (const chapter of [0, 4, 1.5, Number.NaN]) {
      expect(chapterGate(save, chapter, true).allowed).toBe(false);
    }
  });

  it('a broken save (chaptersUnlocked not a number) only opens chapter 1', () => {
    const save = { chaptersUnlocked: Number.NaN };
    expect(chapterGate(save, 1, true).allowed).toBe(true);
    expect(chapterGate(save, 2, true).allowed).toBe(false);
  });

  it('unlocked greater than 3 does not open chapter 4', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 99 };
    expect(chapterGate(save, 3, true).allowed).toBe(true);
    expect(chapterGate(save, 4, true).allowed).toBe(false);
  });
});
