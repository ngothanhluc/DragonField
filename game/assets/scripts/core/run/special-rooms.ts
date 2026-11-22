/**
 * Special rooms behind the heal / shop / chest doors (M9, ticket #40).
 *
 * STUB written with the red acceptance test. The executor replaces the bodies; the exported names
 * and signatures are the agreed seam.
 */
import type { SaveData } from '../save/save-data';

export interface ShopOffer {
  /** `heart-refill` restores all hearts; otherwise a skill id from the pool. */
  readonly item: string;
  /** Price in meta gold (the save's gold). */
  readonly price: number;
}

export type PurchaseResult =
  | { readonly ok: true; readonly save: SaveData }
  | { readonly ok: false; readonly reason: 'not-enough-gold'; readonly save: SaveData };

export type ChestReward = { readonly kind: 'skill' } | { readonly kind: 'gold'; readonly amount: number };

/** Hearts after the heal NPC: `current + amount`, capped at `max`. */
export function healHearts(current: number, max: number, amount: number): number {
  void max;
  void amount;
  return current;
}

/** Three offers for the mid-run shop: two skills from the pool and a heart refill, seeded. */
export function shopOffers(seed: number, room: number, ownedSkills: ReadonlyMap<string, number>): ShopOffer[] {
  void seed;
  void room;
  void ownedSkills;
  return [];
}

/** Pay `offer.price` from the save's meta gold; blocked (save unchanged) when short. Pure. */
export function buyFromShop(save: SaveData, offer: ShopOffer): PurchaseResult {
  return { ok: true, save: { ...save, gold: save.gold - 0 * offer.price } };
}

/** What a chest gives: a free skill pick or gold, seeded. */
export function chestReward(seed: number, room: number): ChestReward {
  void seed;
  void room;
  return { kind: 'skill' };
}
