import { describe, expect, it } from 'vitest';
import { chapterGate } from '../../assets/scripts/core/save/chapter-gate';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';

describe('chapterGate', () => {
  it('chapter 1 luôn mở khi có dữ liệu', () => {
    expect(chapterGate(createDefaultSave(), 1, true).allowed).toBe(true);
  });

  it('chặn chapter chưa mở — không chỉ là nút disabled', () => {
    const save = createDefaultSave();

    const locked = chapterGate(save, 2, true);
    expect(locked.allowed).toBe(false);
    expect(locked.reason).toMatch(/khoá/);
    expect(chapterGate(save, 3, true).allowed).toBe(false);
  });

  it('mở khi save đã unlock chapter đó', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 2 };
    expect(chapterGate(save, 2, true).allowed).toBe(true);
    expect(chapterGate(save, 3, true).allowed).toBe(false);
  });

  it('chặn chapter không có dữ liệu level dù đã unlock', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 3 };
    const gate = chapterGate(save, 3, false);
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/dữ liệu/);
  });

  it('chặn chapter ngoài 1..3 / không nguyên', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 3 };
    for (const chapter of [0, 4, 1.5, Number.NaN]) {
      expect(chapterGate(save, chapter, true).allowed).toBe(false);
    }
  });

  it('save hỏng (chaptersUnlocked không phải số) chỉ mở chapter 1', () => {
    const save = { chaptersUnlocked: Number.NaN };
    expect(chapterGate(save, 1, true).allowed).toBe(true);
    expect(chapterGate(save, 2, true).allowed).toBe(false);
  });

  it('unlocked lớn hơn 3 không mở chapter 4', () => {
    const save = { ...createDefaultSave(), chaptersUnlocked: 99 };
    expect(chapterGate(save, 3, true).allowed).toBe(true);
    expect(chapterGate(save, 4, true).allowed).toBe(false);
  });
});
