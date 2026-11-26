import { describe, expect, it } from 'vitest';
import {
  FREE_REROLLS_PER_LEVEL,
  GOLD_BONUS_PER_LEVEL,
  MAX_FREE_REROLLS_TRACK,
  MAX_GOLD_BONUS_TRACK,
  MAX_HEARTS_TRACK,
  MAX_LEVEL,
  MAX_XP_MAGNET_TRACK,
  STAT_UPGRADE_TRACKS,
  UPGRADE_COSTS,
  UPGRADE_TRACKS,
  UPGRADE_TRACK_META,
  UTILITY_UPGRADE_TRACKS,
  XP_MAGNET_PER_LEVEL,
  applyUpgrades,
  applyUtilityUpgrades,
  buy,
  buyUpgrade,
  canBuy,
  canBuyUpgrade,
  categoryFor,
  costFor,
  createDefaultUpgrades,
  maxLevelFor,
  upgradePrice,
  type UpgradeState,
  type UpgradeTrack,
} from '../../assets/scripts/core/meta/upgrades';

function stateWith(levels: Partial<Record<UpgradeTrack, number>>): UpgradeState {
  return { upgrades: { ...createDefaultUpgrades(), ...levels } };
}

describe('Meta Shop Upgrades — 6 tracks (3 stat + 3 utility, ZERO Revive)', () => {
  it('defines exactly 6 tracks partitioned into 3 stat + 3 utility with NO Revive track', () => {
    expect(UPGRADE_TRACKS).toEqual([
      'hearts',
      'damage',
      'fireRate',
      'xpMagnet',
      'goldBonus',
      'freeRerolls',
    ]);
    expect(STAT_UPGRADE_TRACKS).toEqual(['hearts', 'damage', 'fireRate']);
    expect(UTILITY_UPGRADE_TRACKS).toEqual(['xpMagnet', 'goldBonus', 'freeRerolls']);

    for (const track of UPGRADE_TRACKS) {
      expect(track.toLowerCase()).not.toContain('revive');
      expect(UPGRADE_TRACK_META[track].name.toLowerCase()).not.toContain('revive');
    }

    expect(categoryFor('hearts')).toBe('stat');
    expect(categoryFor('damage')).toBe('stat');
    expect(categoryFor('fireRate')).toBe('stat');
    expect(categoryFor('xpMagnet')).toBe('utility');
    expect(categoryFor('goldBonus')).toBe('utility');
    expect(categoryFor('freeRerolls')).toBe('utility');
  });

  it('has exact utility price ladders and max levels while preserving legacy stat prices', () => {
    expect(maxLevelFor('hearts')).toBe(MAX_HEARTS_TRACK);
    expect(maxLevelFor('damage')).toBe(MAX_LEVEL);
    expect(maxLevelFor('fireRate')).toBe(MAX_LEVEL);
    expect(maxLevelFor('xpMagnet')).toBe(MAX_XP_MAGNET_TRACK);
    expect(maxLevelFor('goldBonus')).toBe(MAX_GOLD_BONUS_TRACK);
    expect(maxLevelFor('freeRerolls')).toBe(MAX_FREE_REROLLS_TRACK);

    expect(UPGRADE_COSTS.xpMagnet).toEqual([30, 60, 100, 150, 220]);
    expect(UPGRADE_COSTS.goldBonus).toEqual([35, 70, 120, 180, 260]);
    expect(UPGRADE_COSTS.freeRerolls).toEqual([60, 140, 260]);

    // Existing stat prices unchanged.
    expect(upgradePrice('hearts', 1)).toBe(50);
    expect(upgradePrice('hearts', 5)).toBe(140);
    expect(upgradePrice('damage', 1)).toBe(40);
    expect(upgradePrice('fireRate', 10)).toBe(400);

    // Out-of-range price queries throw cleanly.
    expect(() => upgradePrice('xpMagnet', 0)).toThrow(/1\.\.5/);
    expect(() => upgradePrice('xpMagnet', 6)).toThrow(/1\.\.5/);
    expect(() => upgradePrice('freeRerolls', 4)).toThrow(/1\.\.3/);
  });

  it('buyUpgrade / canBuyUpgrade / upgradePrice work identically to buy / canBuy / costFor across all 6 tracks', () => {
    for (const track of UPGRADE_TRACKS) {
      let state = stateWith({});
      let gold = 10_000;
      const max = maxLevelFor(track);

      for (let level = 1; level <= max; level += 1) {
        const price = upgradePrice(track, level);
        expect(price).toBe(costFor(track, level));
        expect(canBuyUpgrade(state, track, price - 1)).toBe(false);
        expect(canBuyUpgrade(state, track, price)).toBe(true);
        expect(canBuy(state, track, price)).toBe(true);

        const next = buyUpgrade(state, track, gold);
        expect(next.state.upgrades[track]).toBe(level);
        expect(next.gold).toBe(gold - price);
        expect(state.upgrades[track]).toBe(level - 1); // immutable

        // Ensure other 5 tracks are untouched.
        for (const other of UPGRADE_TRACKS) {
          if (other !== track) expect(next.state.upgrades[other]).toBe(0);
        }

        state = next.state;
        gold = next.gold;
      }

      // Blocked once maxed out.
      expect(canBuyUpgrade(state, track, 999_999)).toBe(false);
      expect(() => buyUpgrade(state, track, 999_999)).toThrow(/maximum level/);
      expect(() => buy(state, track, 999_999)).toThrow(/maximum level/);
    }
  });

  it('computes utility bonuses cleanly and clamps out-of-range levels', () => {
    expect(applyUtilityUpgrades(stateWith({}))).toEqual({
      xpMagnetMult: 1,
      goldBonusMult: 1,
      freeRerolls: 0,
    });

    expect(XP_MAGNET_PER_LEVEL).toBe(0.15);
    expect(GOLD_BONUS_PER_LEVEL).toBe(0.12);
    expect(FREE_REROLLS_PER_LEVEL).toBe(1);
    expect(
      applyUtilityUpgrades(stateWith({ xpMagnet: 2, goldBonus: 3, freeRerolls: 2 })),
    ).toEqual({
      xpMagnetMult: 1.3,
      goldBonusMult: 1.36,
      freeRerolls: 2,
    });

    // Maxed utilities: +75% magnet, +60% gold, 3 free rerolls/run.
    expect(
      applyUtilityUpgrades(
        stateWith({
          xpMagnet: MAX_XP_MAGNET_TRACK,
          goldBonus: MAX_GOLD_BONUS_TRACK,
          freeRerolls: MAX_FREE_REROLLS_TRACK,
        }),
      ),
    ).toEqual({
      xpMagnetMult: 1.75,
      goldBonusMult: 1.6,
      freeRerolls: 3,
    });

    // Out-of-bounds / corrupt values clamped cleanly.
    expect(
      applyUtilityUpgrades(
        stateWith({ xpMagnet: 99, goldBonus: -5, freeRerolls: Number.NaN }),
      ),
    ).toEqual({
      xpMagnetMult: 1.75,
      goldBonusMult: 1,
      freeRerolls: 0,
    });

    // Stat bonuses remain unaffected by utility track levels.
    expect(applyUpgrades(stateWith({ xpMagnet: 5, goldBonus: 5, freeRerolls: 3 }))).toEqual({
      maxHeartsBonus: 0,
      damageMultiplier: 1,
      fireRateMultiplier: 1,
    });
  });
});
