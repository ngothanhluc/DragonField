/**
 * Mid-run shop focus rules (#65): which offer is highlighted and how. Pure, no `cc`.
 *
 * STUB written with the red acceptance test (`tests/core/shop-focus.acceptance.test.ts`);
 * the executor replaces the bodies.
 */
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

export function nextShopFocus(
  current: number | null,
  _input: ShopFocusInput,
  _count: number,
): ShopFocusStep {
  return { index: current, playMove: false };
}

export function shopOfferState(
  _offer: ShopOffer,
  _gold: number,
  _owned: ReadonlyMap<string, number>,
): ShopOfferState {
  return { kind: 'buy', reason: null };
}
