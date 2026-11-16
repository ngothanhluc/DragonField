import { describe, expect, it } from 'vitest';
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
  createDefaultSave,
  migrate,
  parseSaveData,
  serializeSave,
  withBest,
} from '../../assets/scripts/core/save/save-data';
import type { SaveData } from '../../assets/scripts/core/save/save-data';
import { DEFAULT_VOLUME, applySettings, clampVolume } from '../../assets/scripts/core/save/settings';
import { MemorySaveStorage, SaveRepository } from '../../assets/scripts/core/save/storage';

/** Chạy hàm và trả message của lỗi; fail test nếu không ném. */
function errorMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Mong đợi hàm ném lỗi nhưng không ném');
}

function stateWith(levels: Partial<Record<UpgradeTrack, number>>): UpgradeState {
  return { upgrades: { ...createDefaultUpgrades(), ...levels } };
}

function saveWith(patch: Partial<SaveData>): SaveData {
  return { ...createDefaultSave(), ...patch };
}

/** Cặp (cấp trước, cấp sau) để kiểm tra bảng giá tăng dần mà không cần non-null assertion. */
function increasingPairs(costs: readonly number[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let index = 1; index < costs.length; index += 1) {
    const previous = costs[index - 1];
    const current = costs[index];
    if (previous === undefined || current === undefined) {
      throw new Error(`Bảng giá thiếu phần tử ở index ${index}`);
    }
    pairs.push([previous, current]);
  }
  return pairs;
}

describe('SaveData — mặc định', () => {
  it('save mặc định tự hợp lệ và round-trip qua serialize/parse', () => {
    const defaults = createDefaultSave();

    expect(defaults.version).toBe(SAVE_VERSION);
    expect(defaults.gold).toBe(0);
    expect(defaults.upgrades).toEqual({ hearts: 0, damage: 0, fireRate: 0 });
    expect(defaults.chaptersUnlocked).toBe(1);
    expect(defaults.best).toEqual({ chapter: 0, room: 0 });
    expect(defaults.settings).toEqual({ volume: 0.8, fullscreen: false });

    expect(parseSaveData(defaults)).toEqual(defaults);
    expect(parseSaveData(JSON.parse(serializeSave(defaults)))).toEqual(defaults);
  });

  it('serialize theo đúng thứ tự key của GDD §10', () => {
    expect(JSON.parse(serializeSave(createDefaultSave()))).toEqual({
      version: SAVE_VERSION,
      gold: 0,
      upgrades: { hearts: 0, damage: 0, fireRate: 0 },
      chaptersUnlocked: 1,
      best: { chapter: 0, room: 0 },
      settings: { volume: 0.8, fullscreen: false },
    });
  });

  it('serialize từ chối save không hợp lệ thay vì ghi rác', () => {
    expect(() => serializeSave(saveWith({ gold: -1 }))).toThrow(/gold/);
  });
});

describe('SaveData — migrate', () => {
  it('object rỗng thành save mặc định', () => {
    expect(migrate({})).toEqual(createDefaultSave());
  });

  it('version thiếu hoặc version 0 đều thành save mặc định', () => {
    expect(migrate({ version: 0 })).toEqual(createDefaultSave());
    expect(migrate({ version: undefined })).toEqual(createDefaultSave());
  });

  it('giữ nguyên field hợp lệ của save cùng version', () => {
    const migrated = migrate({
      version: SAVE_VERSION,
      gold: 120,
      upgrades: { hearts: 2, damage: 1, fireRate: 3 },
      chaptersUnlocked: 2,
      best: { chapter: 1, room: 4 },
      settings: { volume: 0.5, fullscreen: true },
    });

    expect(migrated).toEqual({
      version: SAVE_VERSION,
      gold: 120,
      upgrades: { hearts: 2, damage: 1, fireRate: 3 },
      chaptersUnlocked: 2,
      best: { chapter: 1, room: 4 },
      settings: { volume: 0.5, fullscreen: true },
    });
  });

  it('vá field thiếu bằng mặc định (save một phần)', () => {
    const migrated = migrate({ gold: 30, upgrades: { hearts: 1 } });

    expect(migrated.gold).toBe(30);
    expect(migrated.upgrades).toEqual({ hearts: 1, damage: 0, fireRate: 0 });
    expect(migrated.chaptersUnlocked).toBe(1);
    expect(migrated.best).toEqual({ chapter: 0, room: 0 });
    expect(migrated.settings).toEqual({ volume: 0.8, fullscreen: false });
  });

  it('đọc tên key cũ của bản nháp GDD §10 (hp, firerate)', () => {
    const migrated = migrate({ upgrades: { hp: 2, firerate: 3 } });

    expect(migrated.upgrades).toEqual({ hearts: 2, damage: 0, fireRate: 3 });
  });

  it('từ chối version mới hơn game', () => {
    expect(() => migrate({ version: 999 })).toThrow(/999/);
    expect(() => migrate({ version: 999 })).toThrow(/mới hơn/);
    expect(() => migrate({ version: SAVE_VERSION + 1 })).toThrow(new RegExp(String(SAVE_VERSION)));
  });

  it('từ chối dữ liệu không phải object hoặc version âm', () => {
    expect(() => migrate('không phải save')).toThrow(/phải là object/);
    expect(() => migrate(null)).toThrow(/phải là object/);
    expect(() => migrate({ version: -1 })).toThrow(/version/);
    expect(() => migrate({ version: '1' })).toThrow(/version/);
  });
});

describe('SaveData — validate', () => {
  it('gom nhiều lỗi vào một Error duy nhất', () => {
    const broken = {
      version: SAVE_VERSION,
      gold: -5,
      upgrades: { hearts: 0, damage: 0, fireRate: MAX_LEVEL + 1 },
      chaptersUnlocked: 99,
      best: { chapter: 0, room: 0 },
      settings: { volume: 2, fullscreen: 'có' },
    };

    const message = errorMessage(() => parseSaveData(broken));

    expect(message).toContain('gold');
    expect(message).toContain('chaptersUnlocked');
    expect(message).toContain('upgrades.fireRate');
    expect(message).toContain('settings.volume');
    expect(message).toContain('settings.fullscreen');
    expect(message).toMatch(/5 lỗi/);
  });

  it('báo cả lỗi lồng nhau (upgrades + best)', () => {
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

  it('parseSaveData đòi đúng version, save cũ phải qua migrate', () => {
    expect(() => parseSaveData({ ...createDefaultSave(), version: 0 })).toThrow(/version/);
    expect(() => parseSaveData({ ...createDefaultSave(), version: '1' })).toThrow(/version/);
  });

  it('từ chối dữ liệu không phải object', () => {
    expect(() => parseSaveData(undefined)).toThrow(/phải là object/);
    expect(() => parseSaveData([1, 2, 3])).toThrow(/phải là object/);
  });
});

describe('SaveData — withBest', () => {
  it('ghi kỷ lục mới trên save mới, không sửa save cũ', () => {
    const base = createDefaultSave();
    const next = withBest(base, 1, 3);

    expect(next.best).toEqual({ chapter: 1, room: 3 });
    expect(base.best).toEqual({ chapter: 0, room: 0 });
    expect(next.gold).toBe(base.gold);
  });

  it('không lùi kỷ lục: chapter xa hơn thắng, cùng chapter thì room lớn hơn thắng', () => {
    const save = withBest(withBest(createDefaultSave(), 2, 3), 1, 9);

    expect(save.best).toEqual({ chapter: 2, room: 3 });
    expect(withBest(save, 2, 4).best).toEqual({ chapter: 2, room: 4 });
    expect(withBest(save, 2, 2).best).toEqual({ chapter: 2, room: 3 });
  });

  it('nhận room 10 — tổng phòng theo dữ liệu nên save không chặn trần 9', () => {
    const repository = new SaveRepository(new MemorySaveStorage());
    repository.save(withBest(createDefaultSave(), 1, 10));

    expect(repository.load().best).toEqual({ chapter: 1, room: 10 });
    expect(repository.lastLoadError).toBeNull();
  });

  it('từ chối chapter/room ngoài miền', () => {
    expect(() => withBest(createDefaultSave(), 0, 1)).toThrow(/chapter/);
    expect(() => withBest(createDefaultSave(), 4, 1)).toThrow(/chapter/);
    expect(() => withBest(createDefaultSave(), 1, 0)).toThrow(/room/);
    expect(() => withBest(createDefaultSave(), 1, 2.5)).toThrow(/room/);
  });
});

describe('Upgrades — bảng giá', () => {
  it('mỗi track có đúng 10 mốc giá, tăng dần, là số nguyên dương', () => {
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

  it('khớp khoảng giá GDD §7: hearts 50 → 500, damage/fireRate 40 → 400', () => {
    expect(costFor('hearts', 1)).toBe(50);
    expect(costFor('hearts', MAX_LEVEL)).toBe(500);
    expect(costFor('damage', 1)).toBe(40);
    expect(costFor('damage', MAX_LEVEL)).toBe(400);
    expect(costFor('fireRate', 1)).toBe(40);
    expect(costFor('fireRate', MAX_LEVEL)).toBe(400);
  });

  it('từ chối cấp ngoài 1..10', () => {
    expect(() => costFor('damage', 0)).toThrow(/1\.\.10/);
    expect(() => costFor('damage', MAX_LEVEL + 1)).toThrow(/1\.\.10/);
    expect(() => costFor('damage', 1.5)).toThrow(/1\.\.10/);
  });

  it('max level: hearts bị chặn ở 5, các track khác 10', () => {
    expect(maxLevelFor('hearts')).toBe(MAX_HEARTS_TRACK);
    expect(maxLevelFor('hearts')).toBe(5);
    expect(maxLevelFor('damage')).toBe(MAX_LEVEL);
    expect(maxLevelFor('fireRate')).toBe(MAX_LEVEL);
  });
});

describe('Upgrades — mua', () => {
  it('trừ đúng giá và tăng cấp, không sửa state cũ', () => {
    const before = stateWith({});
    const result = buy(before, 'damage', 1000);

    expect(result.state.upgrades.damage).toBe(1);
    expect(result.gold).toBe(1000 - costFor('damage', 1));
    expect(before.upgrades.damage).toBe(0);
  });

  it('mua liên tiếp trả đúng giá từng cấp', () => {
    const first = buy(stateWith({}), 'fireRate', 100);
    const second = buy(first.state, 'fireRate', first.gold);

    expect(first.gold).toBe(100 - costFor('fireRate', 1));
    expect(second.state.upgrades.fireRate).toBe(2);
    expect(second.gold).toBe(100 - costFor('fireRate', 1) - costFor('fireRate', 2));
  });

  it('chặn mua khi thiếu vàng, state không đổi', () => {
    const before = stateWith({});

    expect(canBuy(before, 'damage', costFor('damage', 1) - 1)).toBe(false);
    expect(canBuy(before, 'damage', costFor('damage', 1))).toBe(true);
    expect(() => buy(before, 'damage', 0)).toThrow(/Không đủ vàng/);
    expect(before.upgrades.damage).toBe(0);
  });

  it('không mua quá cấp tối đa của từng track', () => {
    const maxedHearts = stateWith({ hearts: MAX_HEARTS_TRACK });
    const maxedDamage = stateWith({ damage: MAX_LEVEL });

    expect(canBuy(maxedHearts, 'hearts', 1_000_000)).toBe(false);
    expect(() => buy(maxedHearts, 'hearts', 1_000_000)).toThrow(/tối đa/);
    expect(canBuy(maxedDamage, 'damage', 1_000_000)).toBe(false);
    expect(() => buy(maxedDamage, 'damage', 1_000_000)).toThrow(/tối đa 10/);

    expect(maxedHearts.upgrades.hearts).toBe(MAX_HEARTS_TRACK);
    expect(maxedDamage.upgrades.damage).toBe(MAX_LEVEL);
  });

  it('bỏ qua vàng không hợp lệ (NaN)', () => {
    expect(canBuy(stateWith({}), 'damage', Number.NaN)).toBe(false);
    expect(() => buy(stateWith({}), 'damage', Number.NaN)).toThrow(/Không đủ vàng/);
  });
});

describe('Upgrades — applyUpgrades', () => {
  it('cấp 0 không đổi gì', () => {
    expect(applyUpgrades(stateWith({}))).toEqual({
      maxHeartsBonus: 0,
      damageMultiplier: 1,
      fireRateMultiplier: 1,
    });
  });

  it('map cấp sang 3 bonus: +1 tim, +5% damage, +3% nhịp bắn mỗi cấp', () => {
    const bonuses = applyUpgrades(stateWith({ hearts: 3, damage: 4, fireRate: 5 }));

    expect(bonuses.maxHeartsBonus).toBe(3);
    expect(bonuses.damageMultiplier).toBeCloseTo(1.2, 10);
    expect(bonuses.fireRateMultiplier).toBeCloseTo(1.15, 10);
  });

  it('cấp tối đa cho bonus tối đa, không vượt cap', () => {
    const bonuses = applyUpgrades(
      stateWith({ hearts: MAX_HEARTS_TRACK, damage: MAX_LEVEL, fireRate: MAX_LEVEL }),
    );

    expect(bonuses.maxHeartsBonus).toBe(MAX_HEARTS_TRACK);
    expect(bonuses.damageMultiplier).toBeCloseTo(1.5, 10);
    expect(bonuses.fireRateMultiplier).toBeCloseTo(1.3, 10);
  });

  it('save hỏng (cấp âm/ngoài bảng) bị kẹp về khoảng hợp lệ', () => {
    const bonuses = applyUpgrades(stateWith({ hearts: 99, damage: -3, fireRate: 99 }));

    expect(bonuses.maxHeartsBonus).toBe(MAX_HEARTS_TRACK);
    expect(bonuses.damageMultiplier).toBe(1);
    expect(bonuses.fireRateMultiplier).toBeCloseTo(1 + MAX_LEVEL * 0.03, 10);
  });
});

describe('SaveRepository', () => {
  it('storage rỗng trả save mặc định, không có lỗi', () => {
    const repository = new SaveRepository(new MemorySaveStorage());

    expect(repository.load()).toEqual(createDefaultSave());
    expect(repository.lastLoadError).toBeNull();
  });

  it('JSON hỏng trả save mặc định và ghi lại lỗi', () => {
    const repository = new SaveRepository(new MemorySaveStorage('{ hỏng json'));

    expect(repository.load()).toEqual(createDefaultSave());
    expect(repository.lastLoadError).not.toBeNull();
    expect(repository.lastLoadError).toMatch(/JSON|Unexpected/);
  });

  it('save hỏng schema cũng trả mặc định và ghi lỗi', () => {
    const repository = new SaveRepository(
      new MemorySaveStorage(JSON.stringify({ version: 999, gold: 'nhiều' })),
    );

    const loaded = repository.load();

    expect(loaded).toEqual(createDefaultSave());
    expect(repository.lastLoadError).toMatch(/999|mới hơn/);
  });

  it('save → load round-trip', () => {
    const storage = new MemorySaveStorage();
    const custom = saveWith({
      gold: 320,
      upgrades: { hearts: 2, damage: 1, fireRate: 0 },
      chaptersUnlocked: 2,
      best: { chapter: 1, room: 4 },
    });

    new SaveRepository(storage).save(custom);
    const loaded = new SaveRepository(storage).load();

    expect(loaded).toEqual(custom);
    expect(storage.read()).toBe(serializeSave(custom));
    expect(new SaveRepository(storage).lastLoadError).toBeNull();
  });

  it('load save cũ trong storage được migrate, không báo lỗi', () => {
    const storage = new MemorySaveStorage(JSON.stringify({ gold: 77 }));

    const loaded = new SaveRepository(storage).load();

    expect(loaded.gold).toBe(77);
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(new SaveRepository(storage).lastLoadError).toBeNull();
  });

  it('load thành công xoá lỗi của lần trước', () => {
    const storage = new MemorySaveStorage('{ hỏng');
    const repository = new SaveRepository(storage);

    repository.load();
    expect(repository.lastLoadError).not.toBeNull();

    repository.save(createDefaultSave());
    repository.load();
    expect(repository.lastLoadError).toBeNull();
  });

  it('reset xoá slot', () => {
    const storage = new MemorySaveStorage();
    const repository = new SaveRepository(storage);

    repository.save(saveWith({ gold: 500 }));
    expect(storage.read()).not.toBeNull();

    repository.reset();

    expect(storage.read()).toBeNull();
    expect(repository.lastLoadError).toBeNull();
    expect(repository.load()).toEqual(createDefaultSave());
  });

  it('MemorySaveStorage là buffer thuần trong RAM', () => {
    const storage = new MemorySaveStorage();

    expect(storage.read()).toBeNull();
    storage.write('abc');
    expect(storage.read()).toBe('abc');
    storage.clear();
    expect(storage.read()).toBeNull();
  });
});

describe('Settings', () => {
  it('kẹp volume dưới 0, trên 1, NaN về khoảng hợp lệ', () => {
    expect(clampVolume(-0.4)).toBe(0);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.35)).toBe(0.35);
    expect(clampVolume(1)).toBe(1);
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(DEFAULT_VOLUME);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_VOLUME);
  });

  it('applySettings trả bản chuẩn hoá, không sửa input', () => {
    const input = { volume: 2, fullscreen: true };
    const applied = applySettings(input);

    expect(applied).toEqual({ volume: 1, fullscreen: true });
    expect(input.volume).toBe(2);

    expect(applySettings({ volume: -1, fullscreen: false })).toEqual({
      volume: 0,
      fullscreen: false,
    });
  });

  it('applySettings lấp field thiếu bằng mặc định', () => {
    expect(applySettings()).toEqual({ volume: DEFAULT_VOLUME, fullscreen: false });
    expect(applySettings({ volume: Number.NaN })).toEqual({
      volume: DEFAULT_VOLUME,
      fullscreen: false,
    });
  });
});
