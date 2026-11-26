import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../assets/scripts/core/characters/roster';
import {
  MAX_HEARTS_TRACK,
  MAX_LEVEL,
  UPGRADE_COSTS,
  UPGRADE_TRACKS,
  applyUpgrades,
  buy,
  canBuy,
  costFor,
  createDefaultUpgrades,
  maxLevelFor,
} from '../../assets/scripts/core/meta/upgrades';
import type { UpgradeState, UpgradeTrack } from '../../assets/scripts/core/meta/upgrades';
import {
  SAVE_VERSION,
  buyCharacter,
  canBuyCharacter,
  createDefaultSave,
  migrate,
  parseSaveData,
  serializeSave,
  unlockNextChapter,
  withBest,
  withSelectedCharacter,
} from '../../assets/scripts/core/save/save-data';
import type { SaveData } from '../../assets/scripts/core/save/save-data';
import { DEFAULT_VOLUME, applySettings, clampVolume } from '../../assets/scripts/core/save/settings';
import { MemorySaveStorage, SaveRepository } from '../../assets/scripts/core/save/storage';

/** Run a function and return the error message; fail the test when nothing throws. */
function errorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the function to throw but it did not');
}

function stateWith(levels: Partial<Record<UpgradeTrack, number>>): UpgradeState {
  return { upgrades: { ...createDefaultUpgrades(), ...levels } };
}

function saveWith(patch: Partial<SaveData>): SaveData {
  return { ...createDefaultSave(), ...patch };
}

/** (previous level, next level) pairs to check the price table rises, without non-null assertions. */
function increasingPairs(costs: readonly number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let index = 1; index < costs.length; index += 1) {
    const previous = costs[index - 1];
    const current = costs[index];
    if (previous === undefined || current === undefined) {
      throw new Error(`Price table is missing element at index ${index}`);
    }
    pairs.push([previous, current]);
  }
  return pairs;
}

describe('SaveData — defaults', () => {
  it('the default v4 save is valid and round-trips through serialize/parse', () => {
    const defaults = createDefaultSave();

    expect(SAVE_VERSION).toBe(4);
    expect(defaults.version).toBe(SAVE_VERSION);
    expect(defaults.gold).toBe(0);
    expect(defaults.upgrades).toEqual({ hearts: 0, damage: 0, fireRate: 0 });
    expect(defaults.chaptersUnlocked).toBe(1);
    expect(defaults.best).toEqual({ chapter: 0, room: 0 });
    expect(defaults.settings).toEqual({
      volume: 0.8,
      fullscreen: false,
      screenShake: true,
      damageNumbers: false,
      effects: 'full',
    });
    expect(defaults.selectedCharacter).toBe('ninja');
    expect(defaults.unlockedCharacters).toEqual(['ninja']);

    expect(parseSaveData(defaults)).toEqual(defaults);
    expect(parseSaveData(JSON.parse(serializeSave(defaults)))).toEqual(defaults);
  });

  it('serialize follows canonical v4 key order without retired cultivatorEnabled', () => {
    const parsed = JSON.parse(serializeSave(createDefaultSave())) as Record<string, unknown>;
    expect(parsed).toEqual({
      version: SAVE_VERSION,
      gold: 0,
      upgrades: { hearts: 0, damage: 0, fireRate: 0 },
      chaptersUnlocked: 1,
      best: { chapter: 0, room: 0 },
      settings: {
        volume: 0.8,
        fullscreen: false,
        screenShake: true,
        damageNumbers: false,
        effects: 'full',
      },
      selectedCharacter: 'ninja',
      unlockedCharacters: ['ninja'],
    });
    expect(Object.keys(parsed)).toEqual([
      'version',
      'gold',
      'upgrades',
      'chaptersUnlocked',
      'best',
      'settings',
      'selectedCharacter',
      'unlockedCharacters',
    ]);
  });

  it('serialize rejects an invalid save instead of writing garbage', () => {
    expect(() => serializeSave(saveWith({ gold: -1 }))).toThrow(/gold/);
  });
});

describe('SaveData — migrate (v0/v1/v2/v3 → v4)', () => {
  it('an empty object becomes the default save', () => {
    expect(migrate({})).toEqual(createDefaultSave());
  });

  it('a missing or 0 version both become the default save', () => {
    expect(migrate({ version: 0 })).toEqual(createDefaultSave());
    expect(migrate({ version: undefined })).toEqual(createDefaultSave());
  });

  it('keeps valid fields of a v4 save and deduplicates unlockedCharacters', () => {
    const migrated = migrate({
      version: SAVE_VERSION,
      gold: 120,
      upgrades: { hearts: 2, damage: 1, fireRate: 3 },
      chaptersUnlocked: 2,
      best: { chapter: 1, room: 4 },
      settings: { volume: 0.5, fullscreen: true },
      selectedCharacter: 'archer',
      unlockedCharacters: ['archer', 'ninja', 'archer', 'invalid', 99],
    });

    expect(migrated).toEqual({
      version: SAVE_VERSION,
      gold: 120,
      upgrades: { hearts: 2, damage: 1, fireRate: 3 },
      chaptersUnlocked: 2,
      best: { chapter: 1, room: 4 },
      settings: {
        volume: 0.5,
        fullscreen: true,
        screenShake: true,
        damageNumbers: false,
        effects: 'full',
      },
      selectedCharacter: 'archer',
      unlockedCharacters: ['ninja', 'archer'],
    });
  });

  it('migrates v1, v2, and v3 saves forward to v4 preserving progress and dropping legacy settings.cultivatorEnabled', () => {
    const v1 = {
      version: 1,
      gold: 250,
      upgrades: { hearts: 2, damage: 4, fireRate: 1 },
      chaptersUnlocked: 3,
      best: { chapter: 3, room: 8 },
      settings: {
        volume: 0.6,
        fullscreen: true,
        screenShake: false,
        damageNumbers: true,
        effects: 'reduced',
      },
    };
    expect(migrate(v1)).toEqual({
      version: SAVE_VERSION,
      gold: 250,
      upgrades: { hearts: 2, damage: 4, fireRate: 1 },
      chaptersUnlocked: 3,
      best: { chapter: 3, room: 8 },
      settings: {
        volume: 0.6,
        fullscreen: true,
        screenShake: false,
        damageNumbers: true,
        effects: 'reduced',
      },
      selectedCharacter: 'ninja',
      unlockedCharacters: ['ninja'],
    });

    const v2 = {
      version: 2,
      gold: 980,
      upgrades: { hearts: 5, damage: 7, fireRate: 6 },
      chaptersUnlocked: 4,
      best: { chapter: 4, room: 9 },
      settings: {
        volume: 0.3,
        fullscreen: false,
        screenShake: true,
        damageNumbers: true,
        effects: 'full',
      },
    };
    expect(migrate(v2)).toEqual({
      version: SAVE_VERSION,
      gold: 980,
      upgrades: { hearts: 5, damage: 7, fireRate: 6 },
      chaptersUnlocked: 4,
      best: { chapter: 4, room: 9 },
      settings: {
        volume: 0.3,
        fullscreen: false,
        screenShake: true,
        damageNumbers: true,
        effects: 'full',
      },
      selectedCharacter: 'ninja',
      unlockedCharacters: ['ninja'],
    });

    // Legacy v3 save with `settings.cultivatorEnabled: true` (or even corrupt legacy value) drops it cleanly.
    const v3 = {
      version: 3,
      gold: 410,
      upgrades: { hearts: 3, damage: 2, fireRate: 2 },
      chaptersUnlocked: 4,
      best: { chapter: 3, room: 9 },
      settings: {
        volume: 0.7,
        fullscreen: false,
        screenShake: true,
        damageNumbers: false,
        effects: 'full',
        cultivatorEnabled: true,
      },
      selectedCharacter: 'cultivator',
    };
    const fromV3 = migrate(v3);
    expect(fromV3).toEqual({
      version: SAVE_VERSION,
      gold: 410,
      upgrades: { hearts: 3, damage: 2, fireRate: 2 },
      chaptersUnlocked: 4,
      best: { chapter: 3, room: 9 },
      settings: {
        volume: 0.7,
        fullscreen: false,
        screenShake: true,
        damageNumbers: false,
        effects: 'full',
      },
      selectedCharacter: 'cultivator',
      unlockedCharacters: ['ninja'],
    });
    expect('cultivatorEnabled' in fromV3.settings).toBe(false);
  });

  it('always keeps ninja in unlockedCharacters even when missing or corrupt during migration', () => {
    expect(migrate({ version: 4, unlockedCharacters: ['mage'] }).unlockedCharacters).toEqual([
      'ninja',
      'mage',
    ]);
    expect(migrate({ version: 4, unlockedCharacters: [] }).unlockedCharacters).toEqual(['ninja']);
    expect(migrate({ version: 4, unlockedCharacters: 'corrupt' }).unlockedCharacters).toEqual([
      'ninja',
    ]);
  });

  it('falls back cleanly to default ninja when selectedCharacter is unknown or corrupt', () => {
    for (const badId of ['samurai', 'unknown', '', null, 42, { id: 'ninja' }]) {
      const migrated = migrate({
        version: SAVE_VERSION,
        gold: 75,
        upgrades: { hearts: 1, damage: 2, fireRate: 0 },
        chaptersUnlocked: 2,
        best: { chapter: 1, room: 5 },
        settings: { volume: 0.7, fullscreen: false },
        selectedCharacter: badId,
      });

      expect(migrated.selectedCharacter).toBe('ninja');
      expect(migrated.gold).toBe(75);
      expect(migrated.upgrades).toEqual({ hearts: 1, damage: 2, fireRate: 0 });
      expect(migrated.chaptersUnlocked).toBe(2);
    }
  });

  it('patches missing fields with defaults (partial save)', () => {
    const migrated = migrate({ gold: 30, upgrades: { hearts: 1 } });

    expect(migrated.gold).toBe(30);
    expect(migrated.upgrades).toEqual({ hearts: 1, damage: 0, fireRate: 0 });
    expect(migrated.chaptersUnlocked).toBe(1);
    expect(migrated.best).toEqual({ chapter: 0, room: 0 });
    expect(migrated.settings).toEqual({
      volume: 0.8,
      fullscreen: false,
      screenShake: true,
      damageNumbers: false,
      effects: 'full',
    });
    expect(migrated.selectedCharacter).toBe('ninja');
    expect(migrated.unlockedCharacters).toEqual(['ninja']);
  });

  it('reads the old key names from the GDD §10 draft (hp, firerate)', () => {
    const migrated = migrate({ upgrades: { hp: 2, firerate: 3 } });

    expect(migrated.upgrades).toEqual({ hearts: 2, damage: 0, fireRate: 3 });
  });

  it('rejects a version newer than the game', () => {
    expect(() => migrate({ version: 999 })).toThrow(/999/);
    expect(() => migrate({ version: 999 })).toThrow(/newer/);
    expect(() => migrate({ version: SAVE_VERSION + 1 })).toThrow(new RegExp(String(SAVE_VERSION)));
  });

  it('rejects non-object data or a negative version', () => {
    expect(() => migrate('không phải save')).toThrow(/must be an object/); // i18n-allow: sample bad data
    expect(() => migrate(null)).toThrow(/must be an object/);
    expect(() => migrate({ version: -1 })).toThrow(/version/);
    expect(() => migrate({ version: '1' })).toThrow(/version/);
  });
});

describe('SaveData — validate', () => {
  it('collects several problems into a single Error', () => {
    const broken = {
      version: SAVE_VERSION,
      gold: -5,
      upgrades: { hearts: 0, damage: 0, fireRate: MAX_LEVEL + 1 },
      chaptersUnlocked: 99,
      best: { chapter: 0, room: 0 },
      settings: { volume: 2, fullscreen: 'có' }, // i18n-allow: sample bad data
      selectedCharacter: 'ninja',
      unlockedCharacters: ['ninja'],
    };

    const message = errorMessage(() => parseSaveData(broken));

    expect(message).toContain('gold');
    expect(message).toContain('chaptersUnlocked');
    expect(message).toContain('upgrades.fireRate');
    expect(message).toContain('settings.volume');
    expect(message).toContain('settings.fullscreen');
    expect(message).toMatch(/5 problem/);
  });

  it('rejects unknown selectedCharacter and invalid unlockedCharacters entries', () => {
    const message = errorMessage(() =>
      parseSaveData({
        ...createDefaultSave(),
        selectedCharacter: 'samurai',
        unlockedCharacters: ['archer', 'bogus'],
      }),
    );

    expect(message).toContain('selectedCharacter');
    expect(message).toContain('unlockedCharacters[1]');
    expect(message).toContain('must include default character "ninja"');
  });

  it('reports nested problems (upgrades + best) too', () => {
    const message = errorMessage(() =>
      parseSaveData({
        ...createDefaultSave(),
        upgrades: { hearts: 6, damage: 0, fireRate: 0 },
        best: { chapter: 7, room: 0 },
      }),
    );

    expect(message).toContain('upgrades.hearts');
    expect(message).toContain(`0..${MAX_HEARTS_TRACK}`);
    expect(message).toContain('best.chapter');
  });

  it('parseSaveData demands the exact version, old saves must go through migrate', () => {
    expect(() => parseSaveData({ ...createDefaultSave(), version: 0 })).toThrow(/version/);
    expect(() => parseSaveData({ ...createDefaultSave(), version: 3 })).toThrow(/version/);
    expect(() => parseSaveData({ ...createDefaultSave(), version: '1' })).toThrow(/version/);
  });

  it('rejects non-object data', () => {
    expect(() => parseSaveData(undefined)).toThrow(/must be an object/);
    expect(() => parseSaveData([1, 2, 3])).toThrow(/must be an object/);
  });
});

describe('SaveData — withBest', () => {
  it('records a new best on a new save, without modifying the old save', () => {
    const base = createDefaultSave();
    const next = withBest(base, 1, 3);

    expect(next.best).toEqual({ chapter: 1, room: 3 });
    expect(base.best).toEqual({ chapter: 0, room: 0 });
    expect(next.gold).toBe(base.gold);
  });

  it('never regresses a record: a further chapter wins, same chapter means the larger room wins', () => {
    const save = withBest(withBest(createDefaultSave(), 2, 3), 1, 9);

    expect(save.best).toEqual({ chapter: 2, room: 3 });
    expect(withBest(save, 2, 4).best).toEqual({ chapter: 2, room: 4 });
    expect(withBest(save, 2, 2).best).toEqual({ chapter: 2, room: 3 });
  });

  it('accepts room 10 — the room total comes from data so the save has no 9 cap', () => {
    const repository = new SaveRepository(new MemorySaveStorage());
    repository.save(withBest(createDefaultSave(), 1, 10));

    expect(repository.load().best).toEqual({ chapter: 1, room: 10 });
    expect(repository.lastLoadError).toBeNull();
  });

  it('rejects a chapter/room out of range', () => {
    expect(() => withBest(createDefaultSave(), 0, 1)).toThrow(/chapter/);
    expect(() => withBest(createDefaultSave(), 5, 1)).toThrow(/chapter/);
    expect(() => withBest(createDefaultSave(), 1, 0)).toThrow(/room/);
    expect(() => withBest(createDefaultSave(), 1, 2.5)).toThrow(/room/);
  });
});

describe('SaveData — withSelectedCharacter, canBuyCharacter & buyCharacter', () => {
  it('updates selectedCharacter on a new save without mutating the input and round-trips through storage', () => {
    const base = createDefaultSave();
    const next = withSelectedCharacter(base, 'cultivator');

    expect(next.selectedCharacter).toBe('cultivator');
    expect(base.selectedCharacter).toBe('ninja');
    expect(withSelectedCharacter(next, 'cultivator')).toEqual(next);

    const storage = new MemorySaveStorage();
    const bought = buyCharacter({ ...next, gold: 500 }, 'cultivator');
    new SaveRepository(storage).save(bought);
    const loaded = new SaveRepository(storage).load();

    expect(loaded).toEqual(bought);
    expect(loaded.selectedCharacter).toBe('cultivator');
    expect(loaded.unlockedCharacters).toEqual(['ninja', 'cultivator']);
  });

  it('rejects an unknown character id or invalid save', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately invalid id
    expect(() => withSelectedCharacter(createDefaultSave(), 'samurai' as any)).toThrow(
      /withSelectedCharacter/,
    );
    expect(() => withSelectedCharacter(saveWith({ gold: -1 }), 'cultivator')).toThrow(/gold/);
  });

  it('canBuyCharacter & buyCharacter deduct gold, append to unlockedCharacters, and block illegal buys', () => {
    const archerCost = CHARACTERS.archer.unlockGoldCost;
    const mageCost = CHARACTERS.mage.unlockGoldCost;
    const cultivatorCost = CHARACTERS.cultivator.unlockGoldCost;

    // Ninja is already unlocked by default.
    const poor = createDefaultSave();
    expect(canBuyCharacter(poor, 'ninja')).toBe(false);
    expect(() => buyCharacter(poor, 'ninja')).toThrow(/already unlocked/);

    // Short on gold -> blocked cleanly.
    const shortForArcher = saveWith({ gold: archerCost - 1 });
    expect(canBuyCharacter(shortForArcher, 'archer')).toBe(false);
    expect(() => buyCharacter(shortForArcher, 'archer')).toThrow(/Not enough gold/);

    // Exact gold -> purchase succeeds without mutating input save.
    const exactForArcher = saveWith({ gold: archerCost });
    expect(canBuyCharacter(exactForArcher, 'archer')).toBe(true);
    const boughtArcher = buyCharacter(exactForArcher, 'archer');
    expect(boughtArcher.gold).toBe(0);
    expect(boughtArcher.unlockedCharacters).toEqual(['ninja', 'archer']);
    expect(exactForArcher.gold).toBe(archerCost);
    expect(exactForArcher.unlockedCharacters).toEqual(['ninja']);

    // Already purchased -> blocked even with plenty of gold.
    const richBoughtArcher = { ...boughtArcher, gold: 999 };
    expect(canBuyCharacter(richBoughtArcher, 'archer')).toBe(false);
    expect(() => buyCharacter(richBoughtArcher, 'archer')).toThrow(/already unlocked/);

    // Already unlocked by chapter clear -> blocked from spending gold unnecessarily.
    const ch1Cleared = { ...unlockNextChapter(createDefaultSave(), 1), gold: 999 };
    expect(canBuyCharacter(ch1Cleared, 'archer')).toBe(false);
    expect(() => buyCharacter(ch1Cleared, 'archer')).toThrow(/already unlocked/);
    expect(canBuyCharacter(ch1Cleared, 'mage')).toBe(true);

    // Chained purchases of Mage and Cultivator deduct exact prices.
    const boughtMage = buyCharacter(ch1Cleared, 'mage');
    expect(boughtMage.gold).toBe(999 - mageCost);
    expect(boughtMage.unlockedCharacters).toEqual(['ninja', 'mage']);

    const boughtCultivator = buyCharacter(boughtMage, 'cultivator');
    expect(boughtCultivator.gold).toBe(999 - mageCost - cultivatorCost);
    expect(boughtCultivator.unlockedCharacters).toEqual(['ninja', 'mage', 'cultivator']);
  });
});

describe('Upgrades — price table', () => {
  it('every track has exactly 10 price steps, rising, positive integers', () => {
    for (const track of UPGRADE_TRACKS) {
      const costs = UPGRADE_COSTS[track];

      expect(costs).toHaveLength(MAX_LEVEL);
      for (const cost of costs) {
        expect(Number.isInteger(cost)).toBe(true);
        expect(cost).toBeGreaterThan(0);
      }
      for (const [previous, current] of increasingPairs(costs)) {
        expect(current).toBeGreaterThan(previous);
      }
    }
  });

  it('matches the GDD §7 price band: hearts 50 → 500, damage/fireRate 40 → 400', () => {
    expect(costFor('hearts', 1)).toBe(50);
    expect(costFor('hearts', MAX_LEVEL)).toBe(500);
    expect(costFor('damage', 1)).toBe(40);
    expect(costFor('damage', MAX_LEVEL)).toBe(400);
    expect(costFor('fireRate', 1)).toBe(40);
    expect(costFor('fireRate', MAX_LEVEL)).toBe(400);
  });

  it('rejects a level outside 1..10', () => {
    expect(() => costFor('damage', 0)).toThrow(/1\.\.10/);
    expect(() => costFor('damage', MAX_LEVEL + 1)).toThrow(/1\.\.10/);
    expect(() => costFor('damage', 1.5)).toThrow(/1\.\.10/);
  });

  it('max level: hearts capped at 5, other tracks at 10', () => {
    expect(maxLevelFor('hearts')).toBe(MAX_HEARTS_TRACK);
    expect(maxLevelFor('hearts')).toBe(5);
    expect(maxLevelFor('damage')).toBe(MAX_LEVEL);
    expect(maxLevelFor('fireRate')).toBe(MAX_LEVEL);
  });
});

describe('Upgrades — mua', () => {
  it('deducts exactly the price and raises the level, without modifying the old state', () => {
    const before = stateWith({});
    const result = buy(before, 'damage', 1000);

    expect(result.state.upgrades.damage).toBe(1);
    expect(result.gold).toBe(1000 - costFor('damage', 1));
    expect(before.upgrades.damage).toBe(0);
  });

  it('buying repeatedly charges the price of each level', () => {
    const first = buy(stateWith({}), 'fireRate', 100);
    const second = buy(first.state, 'fireRate', first.gold);

    expect(first.gold).toBe(100 - costFor('fireRate', 1));
    expect(second.state.upgrades.fireRate).toBe(2);
    expect(second.gold).toBe(100 - costFor('fireRate', 1) - costFor('fireRate', 2));
  });

  it('blocks a purchase when gold is short, state unchanged', () => {
    const before = stateWith({});

    expect(canBuy(before, 'damage', costFor('damage', 1) - 1)).toBe(false);
    expect(canBuy(before, 'damage', costFor('damage', 1))).toBe(true);
    expect(() => buy(before, 'damage', 0)).toThrow(/Not enough gold/);
    expect(before.upgrades.damage).toBe(0);
  });

  it('cannot buy past the max level of a track', () => {
    const maxedHearts = stateWith({ hearts: MAX_HEARTS_TRACK });
    const maxedDamage = stateWith({ damage: MAX_LEVEL });

    expect(canBuy(maxedHearts, 'hearts', 1_000_000)).toBe(false);
    expect(() => buy(maxedHearts, 'hearts', 1_000_000)).toThrow(/maximum/);
    expect(canBuy(maxedDamage, 'damage', 1_000_000)).toBe(false);
    expect(() => buy(maxedDamage, 'damage', 1_000_000)).toThrow(/maximum level 10/);

    expect(maxedHearts.upgrades.hearts).toBe(MAX_HEARTS_TRACK);
    expect(maxedDamage.upgrades.damage).toBe(MAX_LEVEL);
  });

  it('ignores invalid gold (NaN)', () => {
    expect(canBuy(stateWith({}), 'damage', Number.NaN)).toBe(false);
    expect(() => buy(stateWith({}), 'damage', Number.NaN)).toThrow(/Not enough gold/);
  });
});

describe('Upgrades — applyUpgrades', () => {
  it('level 0 changes nothing', () => {
    expect(applyUpgrades(stateWith({}))).toEqual({
      maxHeartsBonus: 0,
      damageMultiplier: 1,
      fireRateMultiplier: 1,
    });
  });

  it('maps levels to 3 bonuses: +1 heart, +5% damage, +3% fire rate per level', () => {
    const bonuses = applyUpgrades(stateWith({ hearts: 3, damage: 4, fireRate: 5 }));

    expect(bonuses.maxHeartsBonus).toBe(3);
    expect(bonuses.damageMultiplier).toBeCloseTo(1.2, 10);
    expect(bonuses.fireRateMultiplier).toBeCloseTo(1.15, 10);
  });

  it('max level gives the max bonus, never past the cap', () => {
    const bonuses = applyUpgrades(
      stateWith({ hearts: MAX_HEARTS_TRACK, damage: MAX_LEVEL, fireRate: MAX_LEVEL }),
    );

    expect(bonuses.maxHeartsBonus).toBe(MAX_HEARTS_TRACK);
    expect(bonuses.damageMultiplier).toBeCloseTo(1.5, 10);
    expect(bonuses.fireRateMultiplier).toBeCloseTo(1.3, 10);
  });

  it('a broken save (negative/out-of-table level) is clamped into the valid range', () => {
    const bonuses = applyUpgrades(stateWith({ hearts: 99, damage: -3, fireRate: 99 }));

    expect(bonuses.maxHeartsBonus).toBe(MAX_HEARTS_TRACK);
    expect(bonuses.damageMultiplier).toBe(1);
    expect(bonuses.fireRateMultiplier).toBeCloseTo(1 + MAX_LEVEL * 0.03, 10);
  });
});

describe('SaveRepository', () => {
  it('empty storage returns the default save with no error', () => {
    const repository = new SaveRepository(new MemorySaveStorage());

    expect(repository.load()).toEqual(createDefaultSave());
    expect(repository.lastLoadError).toBeNull();
  });

  it('broken JSON returns the default save and records the error', () => {
    const repository = new SaveRepository(new MemorySaveStorage('{ hỏng json')); // i18n-allow: sample bad data

    expect(repository.load()).toEqual(createDefaultSave());
    expect(repository.lastLoadError).not.toBeNull();
    expect(repository.lastLoadError).toMatch(/JSON|Unexpected/);
  });

  it('a schema-broken save also returns the default and records the error', () => {
    const repository = new SaveRepository(
      new MemorySaveStorage(JSON.stringify({ version: 999, gold: 'nhiều' })), // i18n-allow: sample bad data
    );

    const loaded = repository.load();

    expect(loaded).toEqual(createDefaultSave());
    expect(repository.lastLoadError).toMatch(/999|newer/);
  });

  it('save → load round-trip', () => {
    const storage = new MemorySaveStorage();
    const custom = saveWith({
      gold: 320,
      upgrades: { hearts: 2, damage: 1, fireRate: 0 },
      chaptersUnlocked: 2,
      best: { chapter: 1, room: 4 },
      unlockedCharacters: ['ninja', 'mage'],
    });

    new SaveRepository(storage).save(custom);
    const loaded = new SaveRepository(storage).load();

    expect(loaded).toEqual(custom);
    expect(storage.read()).toBe(serializeSave(custom));
    expect(new SaveRepository(storage).lastLoadError).toBeNull();
  });

  it('a load of an old save in storage is migrated without an error', () => {
    const storage = new MemorySaveStorage(JSON.stringify({ gold: 77 }));

    const loaded = new SaveRepository(storage).load();

    expect(loaded.gold).toBe(77);
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.unlockedCharacters).toEqual(['ninja']);
    expect(new SaveRepository(storage).lastLoadError).toBeNull();
  });

  it('a successful load clears the previous error', () => {
    const storage = new MemorySaveStorage('{ hỏng'); // i18n-allow: sample bad data
    const repository = new SaveRepository(storage);

    repository.load();
    expect(repository.lastLoadError).not.toBeNull();

    repository.save(createDefaultSave());
    repository.load();
    expect(repository.lastLoadError).toBeNull();
  });

  it('reset clears the slot', () => {
    const storage = new MemorySaveStorage();
    const repository = new SaveRepository(storage);

    repository.save(saveWith({ gold: 500 }));
    expect(storage.read()).not.toBeNull();

    repository.reset();

    expect(storage.read()).toBeNull();
    expect(repository.lastLoadError).toBeNull();
    expect(repository.load()).toEqual(createDefaultSave());
  });

  it('MemorySaveStorage is a pure in-RAM buffer', () => {
    const storage = new MemorySaveStorage();

    expect(storage.read()).toBeNull();
    storage.write('abc');
    expect(storage.read()).toBe('abc');
    storage.clear();
    expect(storage.read()).toBeNull();
  });
});

describe('Settings', () => {
  it('clamps volume below 0, above 1, and NaN into the valid range', () => {
    expect(clampVolume(-0.4)).toBe(0);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.35)).toBe(0.35);
    expect(clampVolume(1)).toBe(1);
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_VOLUME);
  });

  it('applySettings returns the normalised copy without modifying the input', () => {
    const input = { volume: 2, fullscreen: true };
    const applied = applySettings(input);

    expect(applied).toEqual({
      volume: 1,
      fullscreen: true,
      screenShake: true,
      damageNumbers: false,
      effects: 'full',
    });
    expect(input.volume).toBe(2);

    expect(applySettings({ volume: -1, fullscreen: false, effects: 'reduced' })).toEqual({
      volume: 0,
      fullscreen: false,
      screenShake: true,
      damageNumbers: false,
      effects: 'reduced',
    });
  });

  it('applySettings fills missing fields with defaults (5 canonical keys)', () => {
    expect(applySettings()).toEqual({
      volume: DEFAULT_VOLUME,
      fullscreen: false,
      screenShake: true,
      damageNumbers: false,
      effects: 'full',
    });
    expect(applySettings({ volume: Number.NaN })).toEqual({
      volume: DEFAULT_VOLUME,
      fullscreen: false,
      screenShake: true,
      damageNumbers: false,
      effects: 'full',
    });
    // Plain object: all 5 own keys, JSON.stringify emits every field.
    expect(Object.keys(applySettings())).toEqual([
      'volume',
      'fullscreen',
      'screenShake',
      'damageNumbers',
      'effects',
    ]);
  });
});
