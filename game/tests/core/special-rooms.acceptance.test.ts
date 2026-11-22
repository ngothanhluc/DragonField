/**
 * Ticket #40 acceptance: heal, mid-run shop (spends meta gold, blocks when short, survives the run)
 * and chest rooms, and the doors now offer them.
 */
import { describe, expect, it } from 'vitest';
import { TUNING } from '../../assets/scripts/core/enemies/tuning';
import { doorOffers, type DoorReward } from '../../assets/scripts/core/run/doors';
import { buyFromShop, chestReward, healHearts, shopOffers } from '../../assets/scripts/core/run/special-rooms';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';
import { MemorySaveStorage, SaveRepository } from '../../assets/scripts/core/save/storage';

const tuning = TUNING as unknown as {
  doors: { specialRoomsEnabled: boolean };
  specialRooms?: { healHearts: number };
};

describe('heal', () => {
  it('restores the tuned hearts, capped at max', () => {
    const amount = tuning.specialRooms?.healHearts ?? 0;
    expect(amount).toBeGreaterThan(0);
    expect(healHearts(2, 6, amount)).toBe(Math.min(6, 2 + amount));
    expect(healHearts(5, 6, 99)).toBe(6);
    expect(healHearts(6, 6, amount)).toBe(6);
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
    const result = buyFromShop(save, offer);
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
    const result = buyFromShop(save, offer);
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

describe('doors offer the special rooms now', () => {
  it('the flag is on and heal/shop/chest doors come up', () => {
    expect(tuning.doors.specialRoomsEnabled).toBe(true);
    const enabled: DoorReward[] = ['skill', 'gold', 'heal', 'shop', 'chest'];
    const seen = new Set<DoorReward>();
    for (let seed = 1; seed <= 100; seed += 1) for (let room = 1; room <= 7; room += 1) for (const r of doorOffers(seed, room, 8, enabled)) seen.add(r);
    for (const special of ['heal', 'shop', 'chest'] as const) expect(seen.has(special)).toBe(true);
  });
});
