/**
 * Edge cases for the shop focus rules (#65) that the acceptance test leaves open: a one-offer
 * shop, unhover with nothing highlighted, a stale index, and offers whose price is broken.
 */
import { describe, expect, it } from 'vitest';
import {
  nextShopFocus,
  shopOfferState,
} from '../../assets/scripts/core/run/shop-focus';

describe('shop focus: edge cases', () => {
  it('a one-offer shop wraps onto itself without replaying ui-move', () => {
    expect(nextShopFocus(0, { kind: 'move', delta: 1 }, 1)).toEqual({ index: 0, playMove: false });
    expect(nextShopFocus(0, { kind: 'move', delta: -1 }, 1)).toEqual({ index: 0, playMove: false });
    expect(nextShopFocus(null, { kind: 'move', delta: 1 }, 1)).toEqual({
      index: 0,
      playMove: true,
    });
  });

  it('unhovering with nothing highlighted changes nothing', () => {
    expect(nextShopFocus(null, { kind: 'unhover', index: 0 }, 3)).toEqual({
      index: null,
      playMove: false,
    });
  });

  it('an arrow press from a stale index lands on an end', () => {
    expect(nextShopFocus(5, { kind: 'move', delta: 1 }, 3)).toEqual({ index: 0, playMove: true });
    expect(nextShopFocus(5, { kind: 'move', delta: -1 }, 3)).toEqual({
      index: 2,
      playMove: true,
    });
  });

  it('a broken index (fractional, negative) is ignored', () => {
    expect(nextShopFocus(1, { kind: 'hover', index: 1.5 }, 3)).toEqual({
      index: 1,
      playMove: false,
    });
    expect(nextShopFocus(1, { kind: 'hotkey', index: -1 }, 3)).toEqual({
      index: 1,
      playMove: false,
    });
  });
});

describe('shop offer state: edge cases', () => {
  it('a heart refill is never maxed, however many stacks the map claims', () => {
    const owned = new Map([['heart-refill', 99]]);
    expect(shopOfferState({ item: 'heart-refill', price: 20 }, 20, owned)).toEqual({
      kind: 'buy',
      reason: null,
    });
  });

  it('a broken price is refused like an unaffordable one', () => {
    const none = new Map<string, number>();
    expect(shopOfferState({ item: 'heart-refill', price: -5 }, 999, none)).toEqual({
      kind: 'not-enough-gold',
      reason: 'KHÔNG ĐỦ VÀNG',
    });
    expect(shopOfferState({ item: 'heart-refill', price: 2.5 }, 999, none, 'en')).toEqual({
      kind: 'not-enough-gold',
      reason: 'NOT ENOUGH GOLD',
    });
  });
});
