/**
 * Mid-run shop focus rules (#65): which offer is highlighted and how. Pure, no `cc`.
 *
 * Mouse hover, the arrow keys and the 1/2/3 hotkeys all drive the same highlight (one offer at
 * most), so the panel only renders the step returned here. `shopOfferState` picks the look —
 * the buy highlight, or a dimmed card with the reason — from the shop's *current* gold, so a
 * refused purchase dims the card on the same frame.
 */
import { getSkill } from '../skills/pool';
import type { ShopOffer } from './special-rooms';

/** What moves the shop highlight. `index` is the 0-based offer index (hotkey 1 → 0). */
export type ShopFocusInput =
  | { readonly kind: 'hover'; readonly index: number }
  | { readonly kind: 'unhover'; readonly index: number }
  | { readonly kind: 'move'; readonly delta: -1 | 1 }
  | { readonly kind: 'hotkey'; readonly index: number };

/** The highlight after one input; `playMove` = play the soft `ui-move` SFX. */
export interface ShopFocusStep {
  readonly index: number | null;
  readonly playMove: boolean;
}

export type ShopOfferKind = 'buy' | 'not-enough-gold' | 'maxed';

/** How a highlighted offer looks: the buy highlight, or dimmed with a reason. */
export interface ShopOfferState {
  readonly kind: ShopOfferKind;
  readonly reason: string | null;
}

/** Same strings `buyShopOffer` refuses with, so the card and the message never disagree. */
const MAXED_REASON = 'ALREADY MAXED';
const GOLD_REASON = 'NOT ENOUGH GOLD';

export function nextShopFocus(
  current: number | null,
  input: ShopFocusInput,
  count: number,
): ShopFocusStep {
  switch (input.kind) {
    case 'hover':
    case 'hotkey':
      return inRange(input.index, count) ? focusOn(current, input.index) : keep(current);
    case 'unhover':
      // Only the highlighted offer clears the highlight; leaving a neighbour changes nothing.
      return current !== null && input.index === current
        ? { index: null, playMove: false }
        : keep(current);
    case 'move': {
      if (count <= 0) return { index: null, playMove: false };
      // With no highlight (or a stale one) the first arrow press lands on an end.
      const from =
        current !== null && inRange(current, count)
          ? current
          : input.delta === 1
            ? count - 1
            : 0;
      const index = (from + input.delta + count) % count;
      return { index, playMove: index !== current };
    }
  }
}

export function shopOfferState(
  offer: ShopOffer,
  gold: number,
  owned: ReadonlyMap<string, number>,
): ShopOfferState {
  // Maxed wins over gold, like the purchase check in bootstrap.
  if (offer.item !== 'heart-refill' && skillMaxed(offer.item, owned)) {
    return { kind: 'maxed', reason: MAXED_REASON };
  }
  if (!validPrice(offer.price) || gold < offer.price) {
    return { kind: 'not-enough-gold', reason: GOLD_REASON };
  }
  return { kind: 'buy', reason: null };
}

function inRange(index: number, count: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < count;
}

function focusOn(current: number | null, index: number): ShopFocusStep {
  return { index, playMove: index !== current };
}

function keep(current: number | null): ShopFocusStep {
  return { index: current, playMove: false };
}

/** A broken price (negative or fractional) is refused, never treated as free (`buyFromShop`). */
function validPrice(price: number): boolean {
  return Number.isInteger(price) && price >= 0;
}

/** An unknown skill id throws in `getSkill`; a stale offer must read as unbuyable, not crash. */
function skillMaxed(id: string, owned: ReadonlyMap<string, number>): boolean {
  let maxStacks: number;
  try {
    maxStacks = getSkill(id).maxStacks;
  } catch {
    return true;
  }
  return (owned.get(id) ?? 0) >= maxStacks;
}
