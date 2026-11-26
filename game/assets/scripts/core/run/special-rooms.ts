/**
 * Special rooms behind the heal / shop / chest doors (M9, ticket #40).
 *
 * Pure rules only: healing, the seeded shop stock, the purchase rule (run gold first, then the
 * save's gold) and the chest reward. The engine adapters (`game/special-room-view.ts`,
 * `game/shop-panel.ts`, bootstrap) draw these rooms and call `buyFromShop` once per purchase.
 */
import { SPECIAL_ROOMS_TUNING } from '../enemies/tuning';
import type { DoorReward } from './doors';
import type { LevelData } from '../level/level-data';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../level/level-data';
import type { Vec2 } from '../math/vec2';
import { SeededRng } from '../rng';
import type { SaveData } from '../save/save-data';
import { getSkill } from '../skills/pool';
import { rollChoices } from '../skills/roll';
import { MAX_GOLD } from './rewards';

export interface ShopOffer {
  /** `heart-refill` restores all hearts; otherwise a skill id from the pool. */
  readonly item: string;
  /** Price in gold: the run's gold is spent first, then the save's gold. */
  readonly price: number;
}

export type PurchaseResult =
  | { readonly ok: true; readonly save: SaveData; readonly runGold: number }
  | {
      readonly ok: false;
      readonly reason: 'not-enough-gold';
      readonly save: SaveData;
      readonly runGold: number;
    };

export type ChestReward = { readonly kind: 'skill' } | { readonly kind: 'gold'; readonly amount: number };

/** Doors that lead to a special room instead of a fight (#40). */
export const SPECIAL_DOORS = ['heal', 'shop', 'chest'] as const;
export type SpecialKind = (typeof SPECIAL_DOORS)[number];

/** Whether a door reward loads a special room. */
export function isSpecialDoor(reward: DoorReward): reward is SpecialKind {
  return (SPECIAL_DOORS as readonly DoorReward[]).includes(reward);
}

/** Seed offsets: the shop/chest draws never reuse the door draw or the combat stream. */
const SHOP_SEED_SALT = 0x27d4eb2f;
const CHEST_SEED_SALT = 0x165667b1;

/** HP after flat heal: `current + amount`, capped at `max`. */
export function healHearts(current: number, max: number, amount: number): number {
  const cap = Number.isFinite(max) ? Math.max(0, Math.trunc(max)) : 0;
  const base = Number.isFinite(current) ? Math.max(0, Math.trunc(current)) : 0;
  const add = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0;
  return Math.min(cap, base + add);
}

/** Flat HP amount corresponding to `fraction` of `maxHp` (default `specialRooms.healFraction` = 50%). */
export function specialHealAmount(
  maxHp: number,
  fraction: number = SPECIAL_ROOMS_TUNING.healFraction,
): number {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return 0;
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  return Math.max(1, Math.round(maxHp * Math.min(1, fraction)));
}

/** New total HP after a percentage-based special-room heal (NPC or mid-run shop refill). */
export function healByFraction(
  current: number,
  maxHp: number,
  fraction: number = SPECIAL_ROOMS_TUNING.healFraction,
): number {
  return healHearts(current, maxHp, specialHealAmount(maxHp, fraction));
}

/** Price of one skill in meta gold, by rarity. */
function skillPrice(skillId: string): number {
  const prices = SPECIAL_ROOMS_TUNING.shop.skillPrices;
  return prices[getSkill(skillId).rarity];
}

/** Scale a base shop price by `priceMultiplier` (Ascension 3–5 shop surcharge, M15). */
function scaledShopPrice(base: number, priceMultiplier: number): number {
  const mult = Number.isFinite(priceMultiplier) && priceMultiplier > 0 ? priceMultiplier : 1;
  return Math.max(1, Math.round(base * mult));
}

/**
 * Three offers for the mid-run shop: two skills from the pool (respecting the pick's stack
 * caps) and a heart refill, seeded by `seed + room`. When the pool has fewer than two buyable
 * skills the result is shorter; the card panel draws whatever it gets.
 */
export function shopOffers(
  seed: number,
  room: number,
  ownedSkills: ReadonlyMap<string, number>,
  priceMultiplier = 1,
): ShopOffer[] {
  const rng = new SeededRng(
    (Math.trunc(seed) >>> 0) ^
      Math.imul(Math.trunc(room), 0x9e3779b1) ^
      SHOP_SEED_SALT,
  );
  const skills = rollChoices({ rng, owned: ownedSkills, count: 2, includeEvolutions: false });

  const offers: ShopOffer[] = skills.map((skill) => ({
    item: skill.id,
    price: scaledShopPrice(skillPrice(skill.id), priceMultiplier),
  }));
  offers.push({
    item: 'heart-refill',
    price: scaledShopPrice(SPECIAL_ROOMS_TUNING.shop.heartRefill, priceMultiplier),
  });
  return offers;
}

/**
 * Gold the mid-run shop can spend: the save's meta gold plus the gold earned this run — the
 * same total the HUD shows. Non-finite/negative inputs count as 0, capped at `MAX_GOLD`.
 */
export function shopGold(save: SaveData, runGold: number): number {
  const banked = Number.isFinite(save.gold) && save.gold > 0 ? Math.trunc(save.gold) : 0;
  const earned = Number.isFinite(runGold) && runGold > 0 ? Math.trunc(runGold) : 0;
  return Math.min(MAX_GOLD, banked + earned);
}

/**
 * Pay `offer.price`: the run's gold first, the rest from the save's meta gold. Blocked (save and
 * run gold unchanged) when the total is short. Pure.
 *
 * This is the **only** place the mid-run shop changes gold: never negative, and an invalid
 * price is refused instead of minting a free purchase. The caller spends the run part from its
 * `RunRewards` ledger, so banking at the end of the run adds only what is left.
 */
export function buyFromShop(save: SaveData, runGold: number, offer: ShopOffer): PurchaseResult {
  // Only a whole, non-negative price is a real price; a broken one is refused, never clamped
  // (clamping a negative price would turn it into a free purchase).
  const price =
    Number.isInteger(offer.price) && offer.price >= 0 ? offer.price : null;
  const gold = Number.isFinite(save.gold) ? save.gold : 0;
  const earned = Number.isFinite(runGold) && runGold > 0 ? Math.trunc(runGold) : 0;
  if (price === null || shopGold(save, runGold) < price) {
    return { ok: false, reason: 'not-enough-gold', save, runGold };
  }

  const fromRun = Math.min(earned, price);
  return {
    ok: true,
    save: { ...save, gold: Math.max(0, gold - (price - fromRun)) },
    runGold: earned - fromRun,
  };
}

/** What a chest gives: a free skill pick or gold, seeded. */
export function chestReward(seed: number, room: number): ChestReward {
  const rng = new SeededRng(
    (Math.trunc(seed) >>> 0) ^
      Math.imul(Math.trunc(room), 0x85ebca6b) ^
      CHEST_SEED_SALT,
  );
  return rng.next() < 0.5
    ? { kind: 'skill' }
    : { kind: 'gold', amount: SPECIAL_ROOMS_TUNING.chestGold };
}

/**
 * Where the heal/shop NPC or the chest stands (tile units, y down): the middle of the room.
 * The player starts below it, so walking "up" reaches it.
 */
export const SPECIAL_INTERACT: Vec2 = { x: ROOM_COLS / 2, y: ROOM_ROWS / 2 };

/**
 * The room data of a special slot: a plain 32×18 screen of the chapter, no enemies, one door
 * out at the bottom and two pillars so it reads as a room rather than an empty test map.
 *
 * Built in code on purpose: a `.tmx` room must contain at least one enemy spawn (`parseTmxLevel`
 * refuses empty waves), while a special room has none by design.
 */
export function specialRoomLevel(chapter: number, kind: SpecialKind, room: number): LevelData {
  return {
    id: `special-${kind}-c${chapter}-r${room}`,
    chapter,
    room,
    isBossRoom: false,
    size: { cols: ROOM_COLS, rows: ROOM_ROWS },
    tileSizePx: TILE_SIZE_PX,
    playerStart: { x: ROOM_COLS / 2, y: ROOM_ROWS - 4.5 },
    waves: [],
    obstacles: [
      { kind: 'pillar', x: 6, y: 6, width: 1, height: 1 },
      { kind: 'pillar', x: 25, y: 11, width: 1, height: 1 },
    ],
    props: [],
    // M17: single North Portal at top-centre edge.
    doors: [{ at: { x: ROOM_COLS / 2, y: 1 }, toRoom: null }],
  };
}
