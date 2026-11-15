import { describe, expect, it } from 'vitest';
import { NORMAL_ROOMS_PER_CHAPTER, ROOMS_PER_CHAPTER } from '../../assets/scripts/core/run/run-state';
import {
  GOLD,
  MAX_GOLD,
  applyGold,
  goldForKill,
  goldForRoomClear,
  summariseRun,
} from '../../assets/scripts/core/run/rewards';
import { createDefaultSave, parseSaveData } from '../../assets/scripts/core/save/save-data';

describe('GOLD — bảng thưởng', () => {
  it('khớp số GDD: chaser/caster 1, tank 3, elite ×3, phòng 5, boss 50', () => {
    expect(GOLD).toEqual({
      chaser: 1,
      caster: 1,
      tank: 3,
      eliteMultiplier: 3,
      roomClear: 5,
      boss: 50,
    });
  });

  it('goldForKill trả đúng theo vai trò', () => {
    expect(goldForKill('chaser', false)).toBe(1);
    expect(goldForKill('caster', false)).toBe(1);
    expect(goldForKill('tank', false)).toBe(3);
  });

  it('elite nhân 3 và luôn lớn hơn bản thường', () => {
    for (const role of ['chaser', 'caster', 'tank'] as const) {
      expect(goldForKill(role, true)).toBe(goldForKill(role, false) * GOLD.eliteMultiplier);
      expect(goldForKill(role, true)).toBeGreaterThan(goldForKill(role, false));
    }

    expect(goldForKill('tank', true)).toBe(9);
  });

  it('goldForRoomClear: phòng thường 5, boss 50', () => {
    expect(goldForRoomClear(false)).toBe(GOLD.roomClear);
    expect(goldForRoomClear(true)).toBe(GOLD.boss);
  });
});

describe('applyGold — cộng và kẹp', () => {
  it('cộng vào vàng hiện có và trả cùng giá trị', () => {
    const save = { ...createDefaultSave(), gold: 40 };

    const { save: next, gold } = applyGold(save, 12);

    expect(gold).toBe(52);
    expect(next.gold).toBe(52);
  });

  it('không sửa save truyền vào, chỉ trả bản mới', () => {
    const save = { ...createDefaultSave(), gold: 40 };

    applyGold(save, 12);

    expect(save.gold).toBe(40);
  });

  it('giữ nguyên các field khác của save', () => {
    const save = {
      ...createDefaultSave(),
      gold: 7,
      chaptersUnlocked: 2,
      best: { chapter: 1, room: NORMAL_ROOMS_PER_CHAPTER },
    };

    const { save: next } = applyGold(save, 5);

    expect(next.chaptersUnlocked).toBe(2);
    expect(next.best).toEqual(save.best);
    expect(next.upgrades).toEqual(save.upgrades);
    expect(next.settings).toEqual(save.settings);
    expect(next.version).toBe(save.version);
  });

  it('kẹp số âm về 0, không âm vàng', () => {
    expect(applyGold(createDefaultSave(), -10).gold).toBe(0);
    expect(applyGold({ ...createDefaultSave(), gold: 10 }, -50).gold).toBe(0);
  });

  it('kẹp số cực lớn về MAX_GOLD và vẫn hữu hạn', () => {
    const huge = applyGold(createDefaultSave(), Number.MAX_VALUE);
    expect(huge.gold).toBe(MAX_GOLD);
    expect(Number.isFinite(huge.gold)).toBe(true);

    const nearlyFull = applyGold({ ...createDefaultSave(), gold: MAX_GOLD }, 1_000);
    expect(nearlyFull.gold).toBe(MAX_GOLD);
  });

  it('NaN/±Infinity không tạo ra vàng', () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const { gold } = applyGold({ ...createDefaultSave(), gold: 15 }, amount);
      expect(gold).toBe(15);
    }
  });

  it('làm tròn xuống số nguyên và save kết quả parse được', () => {
    const { save, gold } = applyGold(createDefaultSave(), 2.9);

    expect(gold).toBe(2);
    expect(Number.isInteger(save.gold)).toBe(true);
    expect(parseSaveData(save).gold).toBe(2);
  });

  it('save hỏng (vàng NaN) được làm sạch về 0 khi cộng', () => {
    const { gold } = applyGold({ ...createDefaultSave(), gold: Number.NaN }, 3);
    expect(gold).toBe(3);
  });
});

describe('summariseRun — shape cho màn hình kết quả', () => {
  it('run thắng: đúng field, đúng giá trị dẫn xuất', () => {
    const summary = summariseRun({
      roomsCleared: ROOMS_PER_CHAPTER,
      kills: 31,
      goldEarned: 123,
      durationMs: 60_800,
      status: 'won',
    });

    expect(summary).toEqual({
      status: 'won',
      roomsCleared: ROOMS_PER_CHAPTER,
      kills: 31,
      goldEarned: 123,
      durationMs: 60_800,
      durationSeconds: 60.8,
      won: true,
      roomLabel: `${ROOMS_PER_CHAPTER}/${ROOMS_PER_CHAPTER}`,
    });
  });

  it('run thua: won = false, vẫn giữ tiến trình đã đạt', () => {
    const summary = summariseRun({
      roomsCleared: 3,
      kills: 9,
      goldEarned: 20,
      durationMs: 12_345,
      status: 'lost',
    });

    expect(summary.won).toBe(false);
    expect(summary.roomLabel).toBe(`3/${ROOMS_PER_CHAPTER}`);
    expect(summary.durationSeconds).toBe(12.3);
  });

  it('làm sạch số liệu âm/NaN/tràn', () => {
    const summary = summariseRun({
      roomsCleared: -2,
      kills: Number.NaN,
      goldEarned: -50,
      durationMs: Number.POSITIVE_INFINITY,
      status: 'lost',
    });

    expect(summary.roomsCleared).toBe(0);
    expect(summary.kills).toBe(0);
    expect(summary.goldEarned).toBe(0);
    expect(summary.durationMs).toBe(0);
    expect(summary.durationSeconds).toBe(0);
    expect(summary.roomLabel).toBe(`0/${ROOMS_PER_CHAPTER}`);
  });

  it('roomsCleared vượt số phòng bị kẹp về 9', () => {
    const summary = summariseRun({
      roomsCleared: 27,
      kills: 0,
      goldEarned: 0,
      durationMs: 0,
      status: 'won',
    });

    expect(summary.roomsCleared).toBe(ROOMS_PER_CHAPTER);
  });
});
