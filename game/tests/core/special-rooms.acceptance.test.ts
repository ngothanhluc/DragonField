/**
 * Ticket #40 acceptance: heal, mid-run shop (spends meta gold, blocks when short, survives the run)
 * and chest rooms, and the doors now offer them.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../assets/scripts/core/enemies/tuning';
import { doorOffers, type DoorReward } from '../../assets/scripts/core/run/doors';
import {
  buyFromShop,
  chestReward,
  healByFraction,
  healHearts,
  shopOffers,
  specialHealAmount,
} from '../../assets/scripts/core/run/special-rooms';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';
import { MemorySaveStorage, SaveRepository } from '../../assets/scripts/core/save/storage';

const tuning = TUNING as unknown as {
  doors: { specialRoomsEnabled: boolean };
  specialRooms?: { healFraction: number };
};

describe('heal', () => {
  it('restores the tuned fraction of max HP (50%), capped at max', () => {
    const fraction = tuning.specialRooms?.healFraction ?? 0;
    expect(fraction).toBeCloseTo(0.5, 6);
    expect(specialHealAmount(100, fraction)).toBe(50);
    expect(healByFraction(20, 100, fraction)).toBe(70);
    expect(healByFraction(80, 100, fraction)).toBe(100);
    expect(healHearts(20, 100, 50)).toBe(70);
  });
});

describe('shop', () => {
  const owned = new Map<string, number>();

  it('offers two skills and a heart refill, priced in meta gold, seeded', () => {
    const offers = shopOffers(4, 3, owned);
    expect(offers).toHaveLength(3);
    expect(offers.filter((offer) => offer.item === 'heart-refill')).toHaveLength(1);
    for (const offer of offers) expect(offer.price).toBeGreaterThan(0);
    expect(shopOffers(4, 3, owned)).toEqual(offers);
  });

  it('buying deducts exactly the price from the save, and the purchase survives a save round-trip', () => {
    const offer = shopOffers(4, 3, owned)[0];
    if (offer === undefined) throw new Error('no offer');
    const save = { ...createDefaultSave(), gold: offer.price + 7 };
    const result = buyFromShop(save, 0, offer);
    expect(result.ok).toBe(true);
    expect(result.save.gold).toBe(7);
    const repo = new SaveRepository(new MemorySaveStorage());
    repo.save(result.save);
    expect(repo.load().gold).toBe(7);
  });

  it('is blocked when gold is short, and never goes negative', () => {
    const offer = shopOffers(4, 3, owned)[0];
    if (offer === undefined) throw new Error('no offer');
    const save = { ...createDefaultSave(), gold: offer.price - 1 };
    const result = buyFromShop(save, 0, offer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-enough-gold');
    expect(result.save.gold).toBe(offer.price - 1);
  });
});

describe('chest', () => {
  it('is deterministic per seed and gives both kinds across seeds', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const reward = chestReward(seed, 2);
      expect(chestReward(seed, 2)).toEqual(reward);
      kinds.add(reward.kind);
      if (reward.kind === 'gold') expect(reward.amount).toBeGreaterThan(0);
    }
    expect([...kinds].sort()).toEqual(['gold', 'skill']);
  });
});

describe('doors offer the mid-chapter special room now', () => {
  it('the flag is on and mid-chapter Room 4 opens seeded shop/chest portals', () => {
    expect(tuning.doors.specialRoomsEnabled).toBe(true);
    const enabled: DoorReward[] = ['xp', 'gold', 'heal', 'shop', 'chest'];
    const seen = new Set<DoorReward>();
    for (let seed = 1; seed <= 100; seed += 1) {
      for (const r of doorOffers(seed, 4, 8, enabled)) seen.add(r);
    }
    for (const special of ['shop', 'chest'] as const) expect(seen.has(special)).toBe(true);
  });
});
