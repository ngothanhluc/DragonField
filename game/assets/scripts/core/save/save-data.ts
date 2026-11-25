/**
 * 1-slot save schema (GDD §10, ADR-012). **Meta only**: gold, upgrades, unlocked
 * chapters, best, settings. The current run is never saved — closing the tab loses the run.
 *
 * Three entry points:
 * - `parseSaveData` — strict validation, collecting **every** problem into one `Error`.
 * - `migrate` — upgrades an old save / missing `version` to `SAVE_VERSION`.
 * - `serializeSave` — canonical JSON, fixed key order so diffs are readable.
 */
import {
  CHARACTER_IDS,
  DEFAULT_CHARACTER_ID,
  isCharacterId,
} from '../characters/roster';
import type { CharacterId } from '../characters/roster';
import { UPGRADE_TRACKS, createDefaultUpgrades, maxLevelFor } from '../meta/upgrades';
import type { UpgradeTrack } from '../meta/upgrades';
import { CHAPTERS_PER_RUN } from '../run/run-state';
import { DEFAULT_SETTINGS, applySettings } from './settings';
import type { Settings } from './settings';

/**
 * v2 (#45): chapter 4 exists. The schema itself is unchanged — v1 already held every field —
 * but a v1 save cannot record that chapter 3's boss was beaten (the old cap was 3 unlocked
 * chapters), so migration keeps `chaptersUnlocked` as it was: ch4 opens when ch3 is cleared again.
 *
 * v3 (M10): adds `selectedCharacter` (default `'ninja'`) and `settings.cultivatorEnabled`
 * (default `false`). v1 and v2 saves migrate forward cleanly while keeping all existing progress;
 * unknown or corrupt `selectedCharacter` values fall back to `'ninja'` during migration.
 */
export const SAVE_VERSION = 3;

/** Furthest record reached. `chapter`/`room` = 0 means never played. */
export interface BestProgress {
  readonly chapter: number;
  readonly room: number;
}

export interface SaveData {
  readonly version: number;
  readonly gold: number;
  /** Current meta level of each track, 0..`maxLevelFor(track)`. */
  readonly upgrades: Record<UpgradeTrack, number>;
  /** Number of unlocked chapters, 1..`CHAPTERS_PER_RUN`. */
  readonly chaptersUnlocked: number;
  readonly best: BestProgress;
  readonly settings: Settings;
  /** Active playable character selected for new runs (M10). */
  readonly selectedCharacter: CharacterId;
}

/** Collect every problem then throw a single `Error`, instead of stopping at the first one. */
class ProblemList {
  private readonly items: string[] = [];

  add(path: string, message: string): void {
    this.items.push(path === '' ? message : `${path}: ${message}`);
  }

  throwIfAny(header: string): void {
    if (this.items.length === 0) return;

    const details = this.items.map((item) => `  - ${item}`).join('\n');
    throw new Error(`${header} (${this.items.length} problem(s))\n${details}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Read an integer within the closed range [min, max]; on error record it and return `fallback`. */
function readInteger(
  value: unknown,
  path: string,
  min: number,
  max: number,
  fallback: number,
  problems: ProblemList,
): number {
  if (!isInteger(value)) {
    problems.add(path, `must be an integer, got ${describeValue(value)}`);
    return fallback;
  }
  if (value < min || value > max) {
    problems.add(path, `must be within ${min}..${max}, got ${value}`);
    return fallback;
  }
  return value;
}

/**
 * Read an optional settings boolean flag: absent → `undefined` (`applySettings` supplies
 * the default), wrong type → record a `settings.<field>` error.
 */
function readFlag(
  source: Record<string, unknown>,
  field: string,
  problems: ProblemList,
): boolean | undefined {
  const value = source[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    problems.add(`settings.${field}`, `must be a boolean, got ${describeValue(value)}`);
    return undefined;
  }
  return value;
}

/**
 * Read the optional `settings.effects` mode: absent → `undefined` (defaults to `full` via
 * `applySettings`), anything other than `full`/`reduced` → a `settings.effects` error.
 */
function readEffects(
  source: Record<string, unknown>,
  problems: ProblemList,
): Settings['effects'] | undefined {
  const value = source['effects'];
  if (value === undefined) return undefined;
  if (value === 'full' || value === 'reduced') return value;
  problems.add(`settings.effects`, `must be "full" or "reduced", got ${describeValue(value)}`);
  return undefined;
}

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    gold: 0,
    upgrades: createDefaultUpgrades(),
    chaptersUnlocked: 1,
    best: { chapter: 0, room: 0 },
    settings: { ...DEFAULT_SETTINGS },
    selectedCharacter: DEFAULT_CHARACTER_ID,
  };
}

/**
 * Validate a save **already at `SAVE_VERSION`**. Use `migrate` for old saves.
 *
 * Every problem is collected: a broken save usually breaks in several places at once, and whoever
 * fixes it needs to see them all in one run instead of one field at a time.
 */
export function parseSaveData(raw: unknown): SaveData {
  if (!isRecord(raw)) {
    throw new Error(`Invalid SaveData: must be an object, got ${describeValue(raw)}`);
  }

  const problems = new ProblemList();

  if (raw.version !== SAVE_VERSION) {
    problems.add(
      'version',
      `must equal ${SAVE_VERSION}, got ${describeValue(raw.version)}; an old save must go through migrate()`,
    );
  }

  const gold = readInteger(raw.gold, 'gold', 0, Number.MAX_SAFE_INTEGER, 0, problems);
  const chaptersUnlocked = readInteger(
    raw.chaptersUnlocked,
    'chaptersUnlocked',
    1,
    CHAPTERS_PER_RUN,
    1,
    problems,
  );

  const upgrades = createDefaultUpgrades();
  const rawUpgrades = raw.upgrades;
  if (!isRecord(rawUpgrades)) {
    problems.add(
      'upgrades',
      `must be an object { ${UPGRADE_TRACKS.join(', ')} }, got ${describeValue(rawUpgrades)}`,
    );
  } else {
    for (const track of UPGRADE_TRACKS) {
      upgrades[track] = readInteger(
        rawUpgrades[track],
        `upgrades.${track}`,
        0,
        maxLevelFor(track),
        upgrades[track],
        problems,
      );
    }
  }

  let bestChapter = 0;
  let bestRoom = 0;
  const rawBest = raw.best;
  if (!isRecord(rawBest)) {
    problems.add('best', `must be an object { chapter, room }, got ${describeValue(rawBest)}`);
  } else {
    bestChapter = readInteger(rawBest.chapter, 'best.chapter', 0, CHAPTERS_PER_RUN, 0, problems);
    // The room count per chapter is data (`roomsInChapter` from the number of `.tmx` files), so
    // no upper bound is enforced from an old constant — a save from a 10-room chapter must still load.
    bestRoom = readInteger(
      rawBest.room,
      'best.room',
      0,
      Number.MAX_SAFE_INTEGER,
      0,
      problems,
    );
  }

  let settings: Settings = { ...DEFAULT_SETTINGS };
  const rawSettings = raw.settings;
  if (!isRecord(rawSettings)) {
    problems.add(
      'settings',
      `must be an object { volume, fullscreen, screenShake, damageNumbers, effects, cultivatorEnabled }, got ${describeValue(rawSettings)}`,
    );
  } else {
    const volume = rawSettings.volume;
    const volumeOk = isFiniteNumber(volume) && volume >= 0 && volume <= 1;
    if (!volumeOk) {
      problems.add('settings.volume', `must be a number in 0..1, got ${describeValue(volume)}`);
    }

    const fullscreen = rawSettings.fullscreen;
    if (typeof fullscreen !== 'boolean') {
      problems.add(
        'settings.fullscreen',
        `must be a boolean, got ${describeValue(fullscreen)}`,
      );
    }

    // Optional flags added across milestones: absent → default via `applySettings`, wrong type → error.
    const screenShake = readFlag(rawSettings, 'screenShake', problems);
    const damageNumbers = readFlag(rawSettings, 'damageNumbers', problems);
    const effects = readEffects(rawSettings, problems);
    const cultivatorEnabled = readFlag(rawSettings, 'cultivatorEnabled', problems);

    // Only use the read value when the field is valid; otherwise keep the default.
    settings = applySettings({
      ...(volumeOk ? { volume } : {}),
      ...(typeof fullscreen === 'boolean' ? { fullscreen } : {}),
      ...(screenShake !== undefined ? { screenShake } : {}),
      ...(damageNumbers !== undefined ? { damageNumbers } : {}),
      ...(effects !== undefined ? { effects } : {}),
      ...(cultivatorEnabled !== undefined ? { cultivatorEnabled } : {}),
    });
  }

  let selectedCharacter: CharacterId = DEFAULT_CHARACTER_ID;
  if (isCharacterId(raw.selectedCharacter)) {
    selectedCharacter = raw.selectedCharacter;
  } else {
    problems.add(
      'selectedCharacter',
      `must be one of ${CHARACTER_IDS.join('/')}, got ${describeValue(raw.selectedCharacter)}`,
    );
  }

  problems.throwIfAny('Invalid SaveData');

  return {
    version: SAVE_VERSION,
    gold,
    upgrades,
    chaptersUnlocked,
    best: { chapter: bestChapter, room: bestRoom },
    settings,
    selectedCharacter,
  };
}

/**
 * Canonical JSON: fixed key order per GDD §10 (extended in M10 with `selectedCharacter`),
 * containing only validated fields.
 * Throws when `data` is invalid — better to lose one save than write garbage into the slot.
 */
export function serializeSave(data: SaveData): string {
  const valid = parseSaveData(data);

  return JSON.stringify({
    version: SAVE_VERSION,
    gold: valid.gold,
    upgrades: {
      hearts: valid.upgrades.hearts,
      damage: valid.upgrades.damage,
      fireRate: valid.upgrades.fireRate,
    },
    chaptersUnlocked: valid.chaptersUnlocked,
    best: { chapter: valid.best.chapter, room: valid.best.room },
    settings: {
      volume: valid.settings.volume,
      fullscreen: valid.settings.fullscreen,
      screenShake: valid.settings.screenShake,
      damageNumbers: valid.settings.damageNumbers,
      effects: valid.settings.effects,
      cultivatorEnabled: valid.settings.cultivatorEnabled,
    },
    selectedCharacter: valid.selectedCharacter,
  });
}

/** Read `migrated[key]` when not `undefined`, otherwise take the default. */
function pick(raw: Record<string, unknown>, key: string, fallback: unknown): unknown {
  const value = raw[key];
  return value === undefined ? fallback : value;
}

/**
 * Return a new save with `best` = the further of the old record and `(chapter, room)`.
 *
 * Compares chapter first, then room — "room 5 of chapter 1" cannot override
 * "room 2 of chapter 2". Used by bootstrap on every room entry and on the run
 * result screen; an invalid save throws (never write garbage into the slot).
 */
export function withBest(save: SaveData, chapter: number, room: number): SaveData {
  const valid = parseSaveData(save);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) {
    throw new Error(`withBest: chapter must be an integer 1..${CHAPTERS_PER_RUN}, got ${chapter}`);
  }
  if (!Number.isInteger(room) || room < 1) {
    throw new Error(`withBest: room must be an integer >= 1, got ${room}`);
  }

  const previous = valid.best;
  const further =
    chapter > previous.chapter || (chapter === previous.chapter && room > previous.room);
  if (!further) return valid;

  return { ...valid, best: { chapter, room } };
}

/**
 * Unlock the next chapter after clearing the boss of `clearedChapter` (GDD §2: "the next
 * chapter opens when the previous one is won"). Never shrinks progress already unlocked.
 *
 * Returns a **new** save; the input save is not modified. A broken save throws like `withBest`.
 */
export function unlockNextChapter(save: SaveData, clearedChapter: number): SaveData {
  const valid = parseSaveData(save);
  if (!Number.isInteger(clearedChapter) || clearedChapter < 1 || clearedChapter > CHAPTERS_PER_RUN) {
    throw new Error(
      `unlockNextChapter: chapter must be an integer 1..${CHAPTERS_PER_RUN}, got ${clearedChapter}`,
    );
  }

  const unlocked = Math.min(CHAPTERS_PER_RUN, Math.max(valid.chaptersUnlocked, clearedChapter + 1));
  if (unlocked === valid.chaptersUnlocked) return valid;
  return { ...valid, chaptersUnlocked: unlocked };
}

/**
 * Return a new save with `selectedCharacter` set to `characterId` (M10).
 *
 * Returns a **new** save without modifying the input; throws on an invalid save or unknown
 * character id (never write garbage into the slot).
 */
export function withSelectedCharacter(save: SaveData, characterId: CharacterId): SaveData {
  const valid = parseSaveData(save);
  if (!isCharacterId(characterId)) {
    throw new Error(
      `withSelectedCharacter: characterId must be one of ${CHARACTER_IDS.join('/')}, got ${describeValue(characterId)}`,
    );
  }
  if (valid.selectedCharacter === characterId) return valid;
  return { ...valid, selectedCharacter: characterId };
}

/**
 * The health/fire-rate track names were `hp`/`firerate` in the GDD §10 draft; they now use the
 * `UpgradeTrack` keys. Old names are still read during migration so progress is not lost.
 */
const LEGACY_UPGRADE_KEYS: Readonly<Partial<Record<UpgradeTrack, string>>> = {
  hearts: 'hp',
  fireRate: 'firerate',
};

function migrateUpgrades(raw: unknown, fallback: Record<UpgradeTrack, number>): unknown {
  if (raw === undefined) return fallback;
  // Return the broken value as-is so `parseSaveData` reports it instead of silently skipping.
  if (!isRecord(raw)) return raw;

  const levels: Record<UpgradeTrack, unknown> = {
    hearts: fallback.hearts,
    damage: fallback.damage,
    fireRate: fallback.fireRate,
  };

  for (const track of UPGRADE_TRACKS) {
    const legacyKey = LEGACY_UPGRADE_KEYS[track];
    const own = raw[track];
    const legacy = legacyKey === undefined ? undefined : raw[legacyKey];
    const value = own === undefined ? legacy : own;
    if (value !== undefined) levels[track] = value;
  }

  return levels;
}

function migrateBest(raw: unknown, fallback: BestProgress): unknown {
  if (raw === undefined) return fallback;
  if (!isRecord(raw)) return raw;

  return {
    chapter: pick(raw, 'chapter', fallback.chapter),
    room: pick(raw, 'room', fallback.room),
  };
}

function migrateSettings(raw: unknown, fallback: Settings): unknown {
  if (raw === undefined) return fallback;
  if (!isRecord(raw)) return raw;

  return {
    volume: pick(raw, 'volume', fallback.volume),
    fullscreen: pick(raw, 'fullscreen', fallback.fullscreen),
    screenShake: pick(raw, 'screenShake', fallback.screenShake),
    damageNumbers: pick(raw, 'damageNumbers', fallback.damageNumbers),
    effects: pick(raw, 'effects', fallback.effects),
    cultivatorEnabled: pick(raw, 'cultivatorEnabled', fallback.cultivatorEnabled),
  };
}

/**
 * Keep a valid character id; fall back cleanly to `DEFAULT_CHARACTER_ID` when absent, unknown,
 * or corrupt so an outdated/tampered character id never wipes the rest of the player's save.
 */
function migrateSelectedCharacter(raw: unknown, fallback: CharacterId): CharacterId {
  return isCharacterId(raw) ? raw : fallback;
}

/**
 * Upgrade an old save to `SAVE_VERSION`.
 *
 * - missing `version` → treated as 0 (a save from before versioning).
 * - missing field → default; wrong type → left for `parseSaveData` to report
 *   (except `selectedCharacter`, where unknown/corrupt values fall back cleanly to default `'ninja'`).
 * - `version` newer than the game → throw a clear error, **never** guess and overwrite the
 *   save of a newer game version (that would lose data).
 */
export function migrate(raw: unknown): SaveData {
  if (!isRecord(raw)) {
    throw new Error(`Save cannot be migrated: must be an object, got ${describeValue(raw)}`);
  }

  const version = raw.version === undefined ? 0 : raw.version;
  if (!isInteger(version) || version < 0) {
    throw new Error(
      `Save cannot be migrated: version must be an integer >= 0, got ${describeValue(raw.version)}`,
    );
  }
  if (version > SAVE_VERSION) {
    throw new Error(
      `Save version ${version} is newer than this game supports (${SAVE_VERSION}); update the game`,
    );
  }

  const defaults = createDefaultSave();

  // v1 → v2 (#45): chapter 4 exists; `chaptersUnlocked` stays unchanged so ch4 opens after ch3 clear.
  // v2 → v3 (M10): adds `selectedCharacter` (defaults to `'ninja'`, unknown/corrupt values fall back)
  // and `settings.cultivatorEnabled` (defaults to `false`). `parseSaveData` stays the single validator.
  const migrated = {
    version: SAVE_VERSION,
    gold: pick(raw, 'gold', defaults.gold),
    upgrades: migrateUpgrades(raw.upgrades, defaults.upgrades),
    chaptersUnlocked: pick(raw, 'chaptersUnlocked', defaults.chaptersUnlocked),
    best: migrateBest(raw.best, defaults.best),
    settings: migrateSettings(raw.settings, defaults.settings),
    selectedCharacter: migrateSelectedCharacter(
      raw.selectedCharacter,
      defaults.selectedCharacter,
    ),
  };

  return parseSaveData(migrated);
}
