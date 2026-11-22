/**
 * Ticket #64 acceptance: the mid-run shop shows and spends the same gold the HUD shows
 * (save gold + this run's gold), spending run gold first, then save gold, and banking the run
 * at death/win/quit adds only the run gold that is left.
 */
import { describe, expect, it } from 'vitest';
import { applyGold } from '../../assets/scripts/core/run/rewards';
import { RunRewards } from '../../assets/scripts/core/run/run-rewards';
import { buyFromShop, shopGold, type ShopOffer } from '../../assets/scripts/core/run/special-rooms';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';

const offer = (price: number): ShopOffer => ({ item: 'heart-refill', price });
const saveWith = (gold: number) => ({ ...createDefaultSave(), gold });

describe('shop total', () => {
  it('is save gold + run gold (what the HUD shows)', () => {
    expect(shopGold(saveWith(10), 30)).toBe(40);
    expect(shopGold(saveWith(0), 25)).toBe(25);
    expect(shopGold(saveWith(7), 0)).toBe(7);
  });
});

describe('buying in the mid-run shop', () => {
  it('a player with 0 save gold can spend the gold picked up this run', () => {
    const result = buyFromShop(saveWith(0), 25, offer(20));
    expect(result.ok).toBe(true);
    expect(result.runGold).toBe(5);
    expect(result.save.gold).toBe(0);
  });

  it('takes run gold first and leaves save gold alone when run gold covers the price', () => {
    const result = buyFromShop(saveWith(10), 30, offer(20));
    expect(result.ok).toBe(true);
    expect(result.runGold).toBe(10);
    expect(result.save.gold).toBe(10);
  });

  it('takes the rest from save gold once run gold runs out', () => {
    const result = buyFromShop(saveWith(10), 30, offer(35));
    expect(result.ok).toBe(true);
    expect(result.runGold).toBe(0);
    expect(result.save.gold).toBe(5);
  });

  it('is blocked when the total is short, and changes nothing', () => {
    const save = saveWith(10);
    const result = buyFromShop(save, 30, offer(41));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-enough-gold');
    expect(result.runGold).toBe(30);
    expect(result.save.gold).toBe(10);
  });

  it('never goes negative and refuses a broken price', () => {
    for (const price of [-5, 2.5, Number.NaN]) {
      const result = buyFromShop(saveWith(10), 30, offer(price));
      expect(result.ok).toBe(false);
      expect(result.runGold).toBe(30);
      expect(result.save.gold).toBe(10);
    }
    const exact = buyFromShop(saveWith(10), 30, offer(40));
    expect(exact.ok).toBe(true);
    expect(exact.runGold).toBe(0);
    expect(exact.save.gold).toBe(0);
  });
});

describe('banking the run after a purchase (death, win and quit all bank goldEarned)', () => {
  // `commitRunEnd` (death/win) and `bankRunGold` (quit/restart) both bank
  // `applyGold(save, rewards.goldEarned)`, so this covers all three exits.
  const bank = (save: ReturnType<typeof saveWith>, rewards: RunRewards) =>
    applyGold(save, rewards.goldEarned).save.gold;

  it('run gold covers the price: banked total = before-total − price', () => {
    const rewards = new RunRewards();
    rewards.awardBonus(30);
    const save = saveWith(10);
    const result = buyFromShop(save, rewards.goldEarned, offer(20));
    expect(rewards.spend(rewards.goldEarned - result.runGold)).toBe(20);
    expect(rewards.goldEarned).toBe(10);
    expect(bank(result.save, rewards)).toBe(40 - 20);
  });

  it('price spills into save gold: banked total = before-total − price, no double count', () => {
    const rewards = new RunRewards();
    rewards.awardBonus(30);
    const save = saveWith(10);
    const result = buyFromShop(save, rewards.goldEarned, offer(35));
    expect(rewards.spend(rewards.goldEarned - result.runGold)).toBe(30);
    expect(rewards.goldEarned).toBe(0);
    expect(bank(result.save, rewards)).toBe(40 - 35);
  });

  it('spend never takes more than the run holds and ignores broken amounts', () => {
    const rewards = new RunRewards();
    rewards.awardBonus(12);
    expect(rewards.spend(-3)).toBe(0);
    expect(rewards.spend(Number.NaN)).toBe(0);
    expect(rewards.goldEarned).toBe(12);
    expect(rewards.spend(50)).toBe(12);
    expect(rewards.goldEarned).toBe(0);
  });
});
