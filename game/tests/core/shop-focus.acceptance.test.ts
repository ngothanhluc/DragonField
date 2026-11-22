/**
 * Ticket #65 acceptance: the mid-run shop's offers react to hover and keyboard focus.
 *
 * Pure rules only (`core/run/shop-focus.ts`): which offer is highlighted (one at most, shared
 * by mouse and keyboard), when the soft `ui-move` SFX plays, and whether a highlighted offer
 * shows the buy highlight or a dimmed one with its reason. The look (outline, 1.05 scale,
 * eased tint) is proven by browser screenshots, not here.
 */
import { describe, expect, it } from 'vitest';
import {
  nextShopFocus,
  shopOfferState,
  type ShopFocusStep,
} from '../../assets/scripts/core/run/shop-focus';
import type { ShopOffer } from '../../assets/scripts/core/run/special-rooms';

const step = (index: number | null, playMove: boolean): ShopFocusStep => ({ index, playMove });

describe('shop focus: one highlight shared by mouse and keyboard', () => {
  it('starts with nothing highlighted, and hovering an offer highlights it with ui-move', () => {
    expect(nextShopFocus(null, { kind: 'hover', index: 1 }, 3)).toEqual(step(1, true));
  });

  it('hovering the offer already highlighted does not replay ui-move', () => {
    expect(nextShopFocus(1, { kind: 'hover', index: 1 }, 3)).toEqual(step(1, false));
  });

  it('keyboard and mouse move the same highlight: never two offers at once', () => {
    // Keyboard put the highlight on offer 0, then the mouse enters offer 2: offer 2 only.
    expect(nextShopFocus(0, { kind: 'hover', index: 2 }, 3)).toEqual(step(2, true));
    // Mouse on offer 2, then the arrow key: the highlight moves from 2, it does not split.
    expect(nextShopFocus(2, { kind: 'move', delta: -1 }, 3)).toEqual(step(1, true));
  });

  it('the mouse leaving the highlighted offer clears it; leaving another offer does not', () => {
    expect(nextShopFocus(1, { kind: 'unhover', index: 1 }, 3)).toEqual(step(null, false));
    expect(nextShopFocus(1, { kind: 'unhover', index: 0 }, 3)).toEqual(step(1, false));
  });

  it('arrow keys start at an end and wrap around', () => {
    expect(nextShopFocus(null, { kind: 'move', delta: 1 }, 3)).toEqual(step(0, true));
    expect(nextShopFocus(null, { kind: 'move', delta: -1 }, 3)).toEqual(step(2, true));
    expect(nextShopFocus(2, { kind: 'move', delta: 1 }, 3)).toEqual(step(0, true));
    expect(nextShopFocus(0, { kind: 'move', delta: -1 }, 3)).toEqual(step(2, true));
  });

  it('hotkeys 1-3 (index 0-2) highlight that offer', () => {
    expect(nextShopFocus(null, { kind: 'hotkey', index: 2 }, 3)).toEqual(step(2, true));
    expect(nextShopFocus(2, { kind: 'hotkey', index: 2 }, 3)).toEqual(step(2, false));
  });

  it('ignores offers that do not exist (short stock, stray index)', () => {
    expect(nextShopFocus(null, { kind: 'hover', index: 3 }, 3)).toEqual(step(null, false));
    expect(nextShopFocus(1, { kind: 'hotkey', index: 2 }, 2)).toEqual(step(1, false));
    expect(nextShopFocus(null, { kind: 'move', delta: 1 }, 0)).toEqual(step(null, false));
  });
});

describe('shop offer state: buy highlight or dimmed with a reason', () => {
  const sharpen: ShopOffer = { item: 'sharpen', price: 15 }; // common, maxStacks 5
  const homing: ShopOffer = { item: 'homing', price: 25 }; // maxStacks 1
  const refill: ShopOffer = { item: 'heart-refill', price: 20 };
  const none = new Map<string, number>();

  it('an affordable offer gets the buy highlight, with no reason', () => {
    expect(shopOfferState(sharpen, 15, none)).toEqual({ kind: 'buy', reason: null });
    expect(shopOfferState(refill, 40, none)).toEqual({ kind: 'buy', reason: null });
  });

  it('an offer the player cannot afford is dimmed with NOT ENOUGH GOLD', () => {
    expect(shopOfferState(sharpen, 14, none)).toEqual({
      kind: 'not-enough-gold',
      reason: 'NOT ENOUGH GOLD',
    });
    expect(shopOfferState(refill, 0, none)).toEqual({
      kind: 'not-enough-gold',
      reason: 'NOT ENOUGH GOLD',
    });
  });

  it('a skill at its stack cap is dimmed with ALREADY MAXED, even when affordable', () => {
    const owned = new Map([['homing', 1]]);
    expect(shopOfferState(homing, 999, owned)).toEqual({ kind: 'maxed', reason: 'ALREADY MAXED' });
    // Maxed wins over gold, like the purchase check in bootstrap.
    expect(shopOfferState(homing, 0, owned)).toEqual({ kind: 'maxed', reason: 'ALREADY MAXED' });
  });

  it('a skill below its cap is not maxed', () => {
    expect(shopOfferState(sharpen, 15, new Map([['sharpen', 4]]))).toEqual({ kind: 'buy', reason: null });
  });

  it('an unknown skill id is treated as maxed, never as buyable', () => {
    expect(shopOfferState({ item: 'no-such-skill', price: 1 }, 999, none)).toEqual({
      kind: 'maxed',
      reason: 'ALREADY MAXED',
    });
  });
});
