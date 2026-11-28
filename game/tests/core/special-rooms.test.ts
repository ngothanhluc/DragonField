/**
 * Special rooms (#40): heal/shop/chest rules and the balance sim modelling them.
 * The frozen contract lives in `special-rooms.acceptance.test.ts`; this file covers the
 * edge rules the browser proof cannot measure.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../assets/scripts/core/enemies/tuning';
import { simulateRun } from '../../sim/run-simulation';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';
import {
  buyFromShop,
  chestReward,
  healByFraction,
  healHearts,
  isSpecialDoor,
  shopOffers,
  specialRoomLevel,
  SPECIAL_INTERACT,
} from '../../assets/scripts/core/run/special-rooms';
import { ROOM_COLS, ROOM_ROWS } from '../../assets/scripts/core/level/level-data';
import { loadChapterOne } from '../helpers/tmx-levels';

const chapterOne = loadChapterOne();
const noSkills = new Map<string, number>();

describe('healHearts', () => {
  it('never exceeds max and treats broken numbers as 0', () => {
    expect(healHearts(2, 6, 3)).toBe(5);
    expect(healHearts(6, 6, 3)).toBe(6);
    expect(healHearts(2, 6, Number.NaN)).toBe(2);
    expect(healHearts(2, 6, -4)).toBe(2);
  });
});

describe('shopOffers', () => {
  it('offers two pool skills plus one heart refill with positive prices', () => {
    const offers = shopOffers(4, 3, noSkills);
    expect(offers).toHaveLength(3);
    expect(offers.filter((offer) => offer.item === 'heart-refill')).toHaveLength(1);
    for (const offer of offers) expect(offer.price).toBeGreaterThan(0);
    expect(new Set(offers.map((offer) => offer.item)).size).toBe(3);
  });

  it('respects stack caps: a maxed skill is not offered', () => {
    const owned = new Map<string, number>([['sharpen', 5]]);
    for (const offer of shopOffers(9, 2, owned)) expect(offer.item).not.toBe('sharpen');
  });

  it('is stable per seed+room but changes with the room', () => {
    expect(shopOffers(7, 2, noSkills)).toEqual(shopOffers(7, 2, noSkills));
    const a = shopOffers(7, 2, noSkills).map((offer) => offer.item).join(',');
    const b = shopOffers(7, 4, noSkills).map((offer) => offer.item).join(',');
    expect(a).not.toBe(b);
  });
});

describe('buyFromShop', () => {
  it('is pure and exact', () => {
    const offer = { item: 'heart-refill', price: 20 };
    const save = { ...createDefaultSave(), gold: 25 };
    const result = buyFromShop(save, 0, offer);
    expect(save.gold).toBe(25);
    if (!result.ok) throw new Error('expected the purchase to succeed');
    expect(result.save.gold).toBe(5);
  });

  it('never goes negative and refuses an invalid price', () => {
    const save = { ...createDefaultSave(), gold: 10 };
    expect(buyFromShop(save, 0, { item: 'x', price: 11 })).toMatchObject({
      ok: false,
      reason: 'not-enough-gold',
      save,
    });
    expect(buyFromShop(save, 0, { item: 'x', price: Number.NaN }).ok).toBe(false);
    expect(buyFromShop(save, 0, { item: 'x', price: 10 }).save.gold).toBe(0);
  });

  it('refuses a negative or fractional price instead of clamping it', () => {
    const save = { ...createDefaultSave(), gold: 50 };
    for (const price of [-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = buyFromShop(save, 0, { item: 'x', price });
      expect(result.ok, `price ${price}`).toBe(false);
      expect(result.save, `price ${price}`).toBe(save);
      expect(result.save.gold, `price ${price}`).toBe(50);
    }
  });
});

describe('chestReward', () => {
  it('is deterministic and gold amounts come from tuning', () => {
    const chestGold = (TUNING as unknown as { specialRooms: { chestGold: number } }).specialRooms
      .chestGold;
    for (let seed = 1; seed <= 20; seed += 1) {
      const reward = chestReward(seed, 3);
      expect(chestReward(seed, 3)).toEqual(reward);
      if (reward.kind === 'gold') expect(reward.amount).toBe(chestGold);
    }
  });
});

describe('special door detection and room data', () => {
  it('only heal/shop/chest are special', () => {
    expect(isSpecialDoor('heal')).toBe(true);
    expect(isSpecialDoor('shop')).toBe(true);
    expect(isSpecialDoor('chest')).toBe(true);
    expect(isSpecialDoor('xp')).toBe(false);
    expect(isSpecialDoor('gold')).toBe(false);
    expect(isSpecialDoor('boss')).toBe(false);
  });

  it('builds a 32×18 room with no enemies and one door out', () => {
    for (const kind of ['heal', 'shop', 'chest'] as const) {
      const level = specialRoomLevel(2, kind, 101);
      expect([level.size.cols, level.size.rows]).toEqual([ROOM_COLS, ROOM_ROWS]);
      expect(level.waves).toEqual([]);
      expect(level.isBossRoom).toBe(false);
      expect(level.doors).toHaveLength(1);
      expect(level.obstacles.length).toBeGreaterThanOrEqual(2);
      // The player starts below the NPC/chest and can reach it.
      expect(level.playerStart.y).toBeGreaterThan(SPECIAL_INTERACT.y);
      expect(level.playerStart.x).toBe(SPECIAL_INTERACT.x);
    }
  });
});

describe('simulateRun models special rooms', () => {
  const preferSpecial = (offers: readonly string[]): number => {
    const index = offers.findIndex(
      (reward) => reward === 'heal' || reward === 'shop' || reward === 'chest',
    );
    return index >= 0 ? index : 0;
  };

  it('emits a special event, still clears 9 slots and keeps gold consistent', () => {
    const result = simulateRun({
      seed: 3,
      level: chapterOne,
      policy: () => ({ up: false, down: false, left: false, right: false }),
      godMode: true,
      chooseDoor: preferSpecial,
    });

    const specials = result.events.filter((event) => event.kind === 'special');
    expect(specials.length).toBeGreaterThan(0);
    expect(result.status).toBe('won');
    expect(result.roomsCleared).toBe(9);
    expect(result.events.filter((event) => event.kind === 'room-cleared')).toHaveLength(9);

    const fromEvents = result.events.reduce((sum, event) => {
      if (event.kind === 'kill' || event.kind === 'room-cleared') return sum + event.gold;
      if (event.kind === 'special') return sum + (event.gold ?? 0);
      return sum;
    }, 0);
    expect(result.goldEarned).toBe(fromEvents);
  });

  it('healByFraction restores 50% of max HP and clamps cleanly to max HP', () => {
    const fraction = (TUNING as unknown as { specialRooms: { healFraction: number } })
      .specialRooms.healFraction;
    expect(healByFraction(20, 100, fraction)).toBe(70);
    expect(healByFraction(80, 100, fraction)).toBe(100);
    expect(healByFraction(10, 120, fraction)).toBe(70);
  });
});
