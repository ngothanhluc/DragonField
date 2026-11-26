import { afterEach, describe, expect, it } from 'vitest';
import {
  RUN_SAVE_VERSION,
  RunSaveRepository,
  migrateRunSave,
  serializeRunSave,
  type ActiveRunSave,
} from '../../assets/scripts/core/save/run-save';
import { MemorySaveStorage } from '../../assets/scripts/core/save/storage';
import {
  LEGACY_SAVE_STORAGE_KEY,
  RUN_SAVE_STORAGE_KEY,
  SAVE_BACKUP_STORAGE_KEY,
  SAVE_STORAGE_KEY,
  createRunSaveRepository,
  createSaveRepository,
} from '../../assets/scripts/game/save-storage';
import { createDefaultSave, serializeSave } from '../../assets/scripts/core/save/save-data';

function sampleRunSave(overrides: Partial<ActiveRunSave> = {}): ActiveRunSave {
  return {
    version: RUN_SAVE_VERSION,
    seed: 123456789,
    chapter: 2,
    roomIndex: 4,
    chosenDoor: 'xp',
    drawnRooms: [3, 7, 1, 12, 9, 5, 14, 2, 17],
    bossId: 'squid',
    characterId: 'archer',
    hearts: 5,
    maxHearts: 7,
    xpLevel: 6,
    xpCurrent: 45,
    xpTotal: 320,
    pendingLevelUps: 0,
    ownedSkills: {
      'twin-shot': 1,
      piercing: 2,
      'phantom-volley': 1,
    },
    rerollsUsed: 2,
    freeRerollsLeft: 1,
    goldEarned: 140,
    kills: 87,
    elapsedMs: 185_400,
    ascension: 2,
    endlessLoop: 0,
    ...overrides,
  };
}

describe('ActiveRunSave — serialize & migrate round-trip (ADR-023)', () => {
  it('round-trips a full active run save with base skills & Legendary Evolutions identically', () => {
    const run = sampleRunSave();
    const json = serializeRunSave(run);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const restored = migrateRunSave(parsed);

    expect(restored).toEqual(run);
    expect(Object.keys(parsed)).toEqual([
      'version',
      'seed',
      'chapter',
      'roomIndex',
      'chosenDoor',
      'drawnRooms',
      'bossId',
      'characterId',
      'hearts',
      'maxHearts',
      'xpLevel',
      'xpCurrent',
      'xpTotal',
      'pendingLevelUps',
      'ownedSkills',
      'rerollsUsed',
      'freeRerollsLeft',
      'goldEarned',
      'kills',
      'elapsedMs',
      'ascension',
      'endlessLoop',
    ]);
    // Canonical alphabetical ordering of ownedSkills keys.
    expect(Object.keys(parsed.ownedSkills as Record<string, unknown>)).toEqual([
      'phantom-volley',
      'piercing',
      'twin-shot',
    ]);
  });

  it('supports null chosenDoor on room 1 and endlessLoop > 0', () => {
    const run = sampleRunSave({
      chapter: 1,
      roomIndex: 1,
      chosenDoor: null,
      bossId: 'tengu',
      characterId: 'cultivator',
      ascension: 5,
      endlessLoop: 2,
    });
    expect(migrateRunSave(JSON.parse(serializeRunSave(run)))).toEqual(run);
  });

  it('clamps out-of-range numeric fields cleanly and drops unknown skill ids', () => {
    const migrated = migrateRunSave({
      ...sampleRunSave(),
      hearts: 99,
      maxHearts: 8,
      roomIndex: 99,
      xpCurrent: 500,
      xpTotal: 100, // less than xpCurrent -> raised to xpCurrent
      freeRerollsLeft: 99,
      ascension: 99,
      endlessLoop: -3,
      goldEarned: -5,
      kills: -1,
      elapsedMs: -50,
      ownedSkills: {
        'twin-shot': 99, // clamped to maxStacks
        'phantom-volley': 5, // Evolution clamped to maxStacks = 1
        'removed-legacy-skill': 2, // dropped cleanly
        'crit-eye': 0, // zero stacks omitted
      },
    });

    expect(migrated).not.toBeNull();
    expect(migrated?.hearts).toBe(8);
    expect(migrated?.roomIndex).toBe(9);
    expect(migrated?.xpTotal).toBe(500);
    expect(migrated?.freeRerollsLeft).toBe(3);
    expect(migrated?.ascension).toBe(5);
    expect(migrated?.endlessLoop).toBe(0);
    expect(migrated?.goldEarned).toBe(0);
    expect(migrated?.kills).toBe(0);
    expect(migrated?.elapsedMs).toBe(0);
    expect(migrated?.ownedSkills['phantom-volley']).toBe(1);
    expect(migrated?.ownedSkills['twin-shot']).toBeLessThan(99);
    expect(migrated?.ownedSkills['removed-legacy-skill']).toBeUndefined();
    expect(migrated?.ownedSkills['crit-eye']).toBeUndefined();
  });

  it('rejects dead runs (hearts <= 0) to enforce strict permadeath (ADR-023)', () => {
    expect(migrateRunSave(sampleRunSave({ hearts: 0 }))).toBeNull();
    expect(migrateRunSave(sampleRunSave({ hearts: -2 }))).toBeNull();
    expect(() => serializeRunSave(sampleRunSave({ hearts: 0 }))).toThrow(/Invalid ActiveRunSave/);
  });

  it('rejects structurally corrupt or unsupported-version payloads', () => {
    const base = sampleRunSave();
    const badPayloads: unknown[] = [
      null,
      undefined,
      'not-an-object',
      [],
      { ...base, version: 0 },
      { ...base, version: RUN_SAVE_VERSION + 1 },
      { ...base, seed: Number.NaN },
      { ...base, chapter: 0 },
      { ...base, chapter: 5 },
      { ...base, roomIndex: 0 },
      { ...base, drawnRooms: [] },
      { ...base, drawnRooms: [1, -2] },
      { ...base, chosenDoor: 'skill' }, // retired door name
      { ...base, bossId: 'dragon' },
      { ...base, characterId: 'samurai' },
      { ...base, maxHearts: 0 },
      { ...base, xpLevel: 0 },
      { ...base, ownedSkills: ['twin-shot'] },
      { ...base, ownedSkills: { 'twin-shot': 'two' } },
      { ...base, goldEarned: Number.POSITIVE_INFINITY },
    ];

    for (const payload of badPayloads) {
      expect(migrateRunSave(payload)).toBeNull();
    }
  });
});

describe('RunSaveRepository — save, resume, corrupt rejection, and death wipe', () => {
  it('empty storage returns null and hasRun() = false with no error', () => {
    const repo = new RunSaveRepository(new MemorySaveStorage());
    expect(repo.load()).toBeNull();
    expect(repo.hasRun()).toBe(false);
    expect(repo.lastLoadError).toBeNull();
  });

  it('saves a valid run, restores it identically, and wipes immediately on clear() (death)', () => {
    const storage = new MemorySaveStorage();
    const repo = new RunSaveRepository(storage);
    const run = sampleRunSave();

    repo.save(run);
    expect(repo.hasRun()).toBe(true);
    expect(repo.load()).toEqual(run);
    expect(repo.lastLoadError).toBeNull();

    // Death immediately wipes active run save.
    repo.clear();
    expect(repo.hasRun()).toBe(false);
    expect(repo.load()).toBeNull();
    expect(storage.read()).toBeNull();
  });

  it('rejects corrupt JSON and invalid payloads cleanly without throwing', () => {
    const corruptJson = new RunSaveRepository(new MemorySaveStorage('{ broken'));
    expect(corruptJson.hasRun()).toBe(false);
    expect(corruptJson.load()).toBeNull();
    expect(corruptJson.lastLoadError).toMatch(/JSON|Unexpected/);

    const deadPayload = new RunSaveRepository(
      new MemorySaveStorage(JSON.stringify({ ...sampleRunSave(), hearts: 0 })),
    );
    expect(deadPayload.hasRun()).toBe(false);
    expect(deadPayload.load()).toBeNull();
    expect(deadPayload.lastLoadError).toMatch(/Invalid or corrupt/);
  });

  it('throws on save() if given an invalid run, leaving storage untouched', () => {
    const storage = new MemorySaveStorage();
    const repo = new RunSaveRepository(storage);
    const valid = sampleRunSave();
    repo.save(valid);

    expect(() => repo.save(sampleRunSave({ hearts: 0 }))).toThrow(/Invalid ActiveRunSave/);
    expect(repo.load()).toEqual(valid);
  });
});

describe('save-storage.ts — split ADR-023 localStorage keys', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('wires yokai-field.save, yokai-field.save.bak, and yokai-field.run independently', () => {
    const map = new Map<string, string>();
    const fakeLocalStorage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    };
    (globalThis as { window?: unknown }).window = { localStorage: fakeLocalStorage };

    expect(SAVE_STORAGE_KEY).toBe('yokai-field.save');
    expect(SAVE_BACKUP_STORAGE_KEY).toBe('yokai-field.save.bak');
    expect(RUN_SAVE_STORAGE_KEY).toBe('yokai-field.run');

    const profileRepo = createSaveRepository();
    const runRepo = createRunSaveRepository();

    const profile = { ...createDefaultSave(), gold: 350 };
    const run = sampleRunSave({ goldEarned: 95 });

    profileRepo.save(profile);
    runRepo.save(run);

    expect(map.get('yokai-field.save')).toBe(serializeSave(profile));
    expect(map.get('yokai-field.save.bak')).toBe(serializeSave(profile));
    expect(map.get('yokai-field.run')).toBe(serializeRunSave(run));

    // Corrupting primary profile still recovers from .bak without touching active run.
    map.set('yokai-field.save', '{ corrupt');
    expect(profileRepo.load()).toEqual(profile);
    expect(profileRepo.recoveredFromBackup).toBe(true);
    expect(runRepo.load()).toEqual(run);

    // Clearing active run leaves profile & backup completely intact.
    runRepo.clear();
    expect(map.has('yokai-field.run')).toBe(false);
    expect(map.has('yokai-field.save.bak')).toBe(true);
  });

  it('reads legacy pre-M15 yokai-field-save key when yokai-field.save is absent', () => {
    const map = new Map<string, string>();
    map.set(
      LEGACY_SAVE_STORAGE_KEY,
      JSON.stringify({ version: 4, gold: 888, chaptersUnlocked: 3, selectedCharacter: 'mage' }),
    );
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
        removeItem: (key: string) => {
          map.delete(key);
        },
      },
    };

    const profileRepo = createSaveRepository();
    const loaded = profileRepo.load();
    expect(loaded.gold).toBe(888);
    expect(loaded.chaptersUnlocked).toBe(3);
    expect(loaded.selectedCharacter).toBe('mage');

    profileRepo.save(loaded);
    expect(map.has('yokai-field.save')).toBe(true);
    expect(map.has('yokai-field.save.bak')).toBe(true);
  });
});
