/**
 * Profile Save v5 schema (GDD §10, §15.4, §15.5, ADR-023).
 *
 * Persists permanent profile progression only: gold, 6 Meta Shop upgrade tracks
 * (3 stat + 3 utility, NO Revive), unlocked chapters, per-chapter Ascension unlocks (0..5),
 * best depth, settings (including independent `musicVolume` and `sfxVolume`), selected
 * character, and purchased character unlocks. Active mid-run state lives in `run-save.ts`.
 *
 * Three entry points:
 * - `parseSaveData` — strict validation, collecting **every** problem into one `Error`.
 * - `migrate` — upgrades an old save (v0/v1/v2/v3/v4) / missing `version` to `SAVE_VERSION`.
 * - `serializeSave` — canonical JSON, fixed key order so diffs are readable.
 */
import {
  CHARACTERS,
  CHARACTER_IDS,
  DEFAULT_CHARACTER_ID,
  isCharacterId,
  isCharacterUnlocked,
} from '../characters/roster';
import type { CharacterId } from '../characters/roster';
import { isLocale, type Locale } from '../i18n/types';
import { UPGRADE_TRACKS, createDefaultUpgrades, maxLevelFor } from '../meta/upgrades';
import type { UpgradeTrack } from '../meta/upgrades';
import { CHAPTERS_PER_RUN } from '../run/run-state';
import { DEFAULT_SETTINGS, applySettings } from './settings';
import type { Settings } from './settings';

/**
 * v2 (#45): chapter 4 exists.
 * v3 (M10): added `selectedCharacter` and temporary `settings.cultivatorEnabled`.
 * v4 (M14): adds `unlockedCharacters: readonly CharacterId[]` (default `['ninja']`) for early Meta
 * gold character purchases and retires legacy `settings.cultivatorEnabled`.
 * v5 (M15): adds 3 Utility meta tracks (`xpMagnet`, `goldBonus`, `freeRerolls`), per-chapter
 * `ascensionUnlocked` tuple (`[0..5, 0..5, 0..5, 0..5]`), and split `settings.musicVolume` /
 * `settings.sfxVolume` migrated from legacy `settings.volume`.
 * v6 (M16): adds `settings.locale: 'vi' | 'en'` (default `'vi'`, ADR-024).
 */
export const SAVE_VERSION = 6;

/** Highest Ascension tier unlockable per chapter (GDD §15.5, M15). */
export const MAX_ASCENSION_TIER = 5;

/** Per-chapter highest unlocked Ascension tier `0..5` for Chapters 1–4. */
export type AscensionProgress = readonly [number, number, number, number];

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
  /** Highest unlocked Ascension tier (0..5) for Chapters 1–4 (M15). */
  readonly ascensionUnlocked: AscensionProgress;
  readonly best: BestProgress;
  readonly settings: Settings;
  /** Active playable character selected for new runs (M10/M14). */
  readonly selectedCharacter: CharacterId;
  /** Characters permanently unlocked via default start or early Meta gold purchase (M14). */
  readonly unlockedCharacters: readonly CharacterId[];
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

/**
 * Read the optional `settings.locale`: absent → `undefined` (defaults to `'vi'` via
 * `applySettings`), anything other than `'vi'`/`'en'` → a `settings.locale` error.
 */
function readLocale(
  source: Record<string, unknown>,
  problems: ProblemList,
): Locale | undefined {
  const value = source['locale'];
  if (value === undefined) return undefined;
  if (isLocale(value)) return value;
  problems.add(`settings.locale`, `must be "vi" or "en", got ${describeValue(value)}`);
  return undefined;
}

function readVolume01(
  source: Record<string, unknown>,
  field: 'volume' | 'musicVolume' | 'sfxVolume',
  problems: ProblemList,
): number | undefined {
  const value = source[field];
  if (isFiniteNumber(value) && value >= 0 && value <= 1) return value;
  problems.add(`settings.${field}`, `must be a number in 0..1, got ${describeValue(value)}`);
  return undefined;
}

function normalizeUnlockedList(ids: readonly CharacterId[]): CharacterId[] {
  const unique = new Set<CharacterId>([DEFAULT_CHARACTER_ID]);
  for (const id of ids) unique.add(id);
  return Array.from(unique);
}

export function createDefaultAscensionProgress(): AscensionProgress {
  return [0, 0, 0, 0];
}

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    gold: 0,
    upgrades: createDefaultUpgrades(),
    chaptersUnlocked: 1,
    ascensionUnlocked: createDefaultAscensionProgress(),
    best: { chapter: 0, room: 0 },
    settings: { ...DEFAULT_SETTINGS },
    selectedCharacter: DEFAULT_CHARACTER_ID,
    unlockedCharacters: [DEFAULT_CHARACTER_ID],
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

  let ascensionUnlocked: AscensionProgress = createDefaultAscensionProgress();
  const rawAscension = raw.ascensionUnlocked;
  if (!Array.isArray(rawAscension) || rawAscension.length !== CHAPTERS_PER_RUN) {
    problems.add(
      'ascensionUnlocked',
      `must be an array of ${CHAPTERS_PER_RUN} integers in 0..${MAX_ASCENSION_TIER}, got ${describeValue(rawAscension)}`,
    );
  } else {
    const a0 = readInteger(rawAscension[0], 'ascensionUnlocked[0]', 0, MAX_ASCENSION_TIER, 0, problems);
    const a1 = readInteger(rawAscension[1], 'ascensionUnlocked[1]', 0, MAX_ASCENSION_TIER, 0, problems);
    const a2 = readInteger(rawAscension[2], 'ascensionUnlocked[2]', 0, MAX_ASCENSION_TIER, 0, problems);
    const a3 = readInteger(rawAscension[3], 'ascensionUnlocked[3]', 0, MAX_ASCENSION_TIER, 0, problems);
    ascensionUnlocked = [a0, a1, a2, a3];
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
      `must be an object { volume, musicVolume, sfxVolume, fullscreen, screenShake, damageNumbers, effects }, got ${describeValue(rawSettings)}`,
    );
  } else {
    const volume = readVolume01(rawSettings, 'volume', problems);
    const musicVolume = readVolume01(rawSettings, 'musicVolume', problems);
    const sfxVolume = readVolume01(rawSettings, 'sfxVolume', problems);

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
    const locale = readLocale(rawSettings, problems);

    // Only use the read value when the field is valid; otherwise keep the default.
    settings = applySettings({
      ...(volume !== undefined ? { volume } : {}),
      ...(musicVolume !== undefined ? { musicVolume } : {}),
      ...(sfxVolume !== undefined ? { sfxVolume } : {}),
      ...(typeof fullscreen === 'boolean' ? { fullscreen } : {}),
      ...(screenShake !== undefined ? { screenShake } : {}),
      ...(damageNumbers !== undefined ? { damageNumbers } : {}),
      ...(effects !== undefined ? { effects } : {}),
      ...(locale !== undefined ? { locale } : {}),
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

  let unlockedCharacters: CharacterId[] = [DEFAULT_CHARACTER_ID];
  const rawUnlocked = raw.unlockedCharacters;
  if (!Array.isArray(rawUnlocked)) {
    problems.add(
      'unlockedCharacters',
      `must be an array of character ids (${CHARACTER_IDS.join('/')}), got ${describeValue(rawUnlocked)}`,
    );
  } else {
    const validIds: CharacterId[] = [];
    for (let index = 0; index < rawUnlocked.length; index += 1) {
      const entry = rawUnlocked[index];
      if (!isCharacterId(entry)) {
        problems.add(
          `unlockedCharacters[${index}]`,
          `must be one of ${CHARACTER_IDS.join('/')}, got ${describeValue(entry)}`,
        );
      } else {
        validIds.push(entry);
      }
    }
    if (!validIds.includes(DEFAULT_CHARACTER_ID)) {
      problems.add(
        'unlockedCharacters',
        `must include default character ${JSON.stringify(DEFAULT_CHARACTER_ID)}`,
      );
    }
    unlockedCharacters = normalizeUnlockedList(validIds);
  }

  problems.throwIfAny('Invalid SaveData');

  return {
    version: SAVE_VERSION,
    gold,
    upgrades,
    chaptersUnlocked,
    ascensionUnlocked,
    best: { chapter: bestChapter, room: bestRoom },
    settings,
    selectedCharacter,
    unlockedCharacters,
  };
}

/**
 * Canonical JSON: fixed key order per GDD §10 & §15.5, containing only validated fields.
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
      xpMagnet: valid.upgrades.xpMagnet,
      goldBonus: valid.upgrades.goldBonus,
      freeRerolls: valid.upgrades.freeRerolls,
    },
    chaptersUnlocked: valid.chaptersUnlocked,
    ascensionUnlocked: [
      valid.ascensionUnlocked[0],
      valid.ascensionUnlocked[1],
      valid.ascensionUnlocked[2],
      valid.ascensionUnlocked[3],
    ],
    best: { chapter: valid.best.chapter, room: valid.best.room },
    settings: {
      volume: valid.settings.volume,
      musicVolume: valid.settings.musicVolume,
      sfxVolume: valid.settings.sfxVolume,
      fullscreen: valid.settings.fullscreen,
      screenShake: valid.settings.screenShake,
      damageNumbers: valid.settings.damageNumbers,
      effects: valid.settings.effects,
      locale: valid.settings.locale,
    },
    selectedCharacter: valid.selectedCharacter,
    unlockedCharacters: [...valid.unlockedCharacters],
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
 * Read the highest unlocked Ascension tier (0..5) for `chapter` (1..4).
 * Returns `0` for out-of-range chapters. Never throws.
 */
export function unlockedAscensionForChapter(save: SaveData, chapter: number): number {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) return 0;
  return save.ascensionUnlocked[chapter - 1] ?? 0;
}

/**
 * Unlock the next Ascension tier for `chapter` (1..4) after clearing `clearedAscension` (0..5).
 * Clearing Ascension 0 (Normal) unlocks Ascension 1; clearing tier `k` unlocks `min(5, k + 1)`.
 * Never shrinks previously unlocked Ascension tiers. Returns a **new** save without mutating input.
 */
export function unlockChapterAscension(
  save: SaveData,
  chapter: number,
  clearedAscension: number,
): SaveData {
  const valid = parseSaveData(save);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) {
    throw new Error(
      `unlockChapterAscension: chapter must be an integer 1..${CHAPTERS_PER_RUN}, got ${chapter}`,
    );
  }
  if (
    !Number.isInteger(clearedAscension) ||
    clearedAscension < 0 ||
    clearedAscension > MAX_ASCENSION_TIER
  ) {
    throw new Error(
      `unlockChapterAscension: clearedAscension must be an integer 0..${MAX_ASCENSION_TIER}, got ${clearedAscension}`,
    );
  }

  const idx = chapter - 1;
  const current = valid.ascensionUnlocked[idx] ?? 0;
  const unlocked = Math.min(MAX_ASCENSION_TIER, Math.max(current, clearedAscension + 1));
  if (unlocked === current) return valid;

  const next: [number, number, number, number] = [
    valid.ascensionUnlocked[0],
    valid.ascensionUnlocked[1],
    valid.ascensionUnlocked[2],
    valid.ascensionUnlocked[3],
  ];
  next[idx] = unlocked;
  return { ...valid, ascensionUnlocked: next };
}

/**
 * Return a new save with `selectedCharacter` set to `characterId` (M10/M14).
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
 * Whether `id` can be purchased early with Meta gold under `save`.
 * Returns `false` when unknown, already unlocked (by default, chapter clear, or prior purchase),
 * or when `save.gold < unlockGoldCost`. Never throws.
 */
export function canBuyCharacter(save: SaveData, id: CharacterId): boolean {
  if (!isCharacterId(id)) return false;
  if (isCharacterUnlocked(id, save)) return false;
  const cost = CHARACTERS[id].unlockGoldCost;
  if (!Number.isFinite(save.gold) || save.gold < cost) return false;
  return true;
}

/**
 * Purchase early unlock for playable character `id` using Meta gold (M14).
 *
 * Deducts `CHARACTERS[id].unlockGoldCost`, appends `id` to `unlockedCharacters`, and returns
 * a **new** `SaveData` without mutating the input. Throws when the save is invalid, `id` is
 * unknown, the character is already unlocked, or gold is short.
 */
export function buyCharacter(save: SaveData, id: CharacterId): SaveData {
  const valid = parseSaveData(save);
  if (!isCharacterId(id)) {
    throw new Error(
      `buyCharacter: id must be one of ${CHARACTER_IDS.join('/')}, got ${describeValue(id)}`,
    );
  }
  if (isCharacterUnlocked(id, valid)) {
    throw new Error(`buyCharacter: character '${id}' is already unlocked`);
  }
  const cost = CHARACTERS[id].unlockGoldCost;
  if (valid.gold < cost) {
    throw new Error(
      `Not enough gold to buy character '${id}': need ${cost}, have ${valid.gold}`,
    );
  }

  return {
    ...valid,
    gold: valid.gold - cost,
    unlockedCharacters: normalizeUnlockedList([...valid.unlockedCharacters, id]),
  };
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
    xpMagnet: fallback.xpMagnet,
    goldBonus: fallback.goldBonus,
    freeRerolls: fallback.freeRerolls,
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

function migrateAscensionUnlocked(raw: unknown, fallback: AscensionProgress): unknown {
  if (raw === undefined) return fallback;
  if (!Array.isArray(raw)) return raw;
  if (raw.length !== CHAPTERS_PER_RUN) return raw;
  return [
    raw[0] === undefined ? fallback[0] : raw[0],
    raw[1] === undefined ? fallback[1] : raw[1],
    raw[2] === undefined ? fallback[2] : raw[2],
    raw[3] === undefined ? fallback[3] : raw[3],
  ];
}

function migrateBest(raw: unknown, fallback: BestProgress): unknown {
  if (raw === undefined) return fallback;
  if (!isRecord(raw)) return raw;

  return {
    chapter: pick(raw, 'chapter', fallback.chapter),
    room: pick(raw, 'room', fallback.room),
  };
}

/**
 * Migrate settings forward to v5:
 * - Drops legacy `settings.cultivatorEnabled` cleanly (retired in M14).
 * - Migrates legacy `settings.volume` into both `settings.musicVolume` and `settings.sfxVolume`
 *   when those channel keys are absent.
 */
function migrateSettings(raw: unknown, fallback: Settings): unknown {
  if (raw === undefined) return fallback;
  if (!isRecord(raw)) return raw;

  const hasLegacyVolume = raw.volume !== undefined;
  const musicVolume =
    raw.musicVolume !== undefined
      ? raw.musicVolume
      : hasLegacyVolume
        ? raw.volume
        : fallback.musicVolume;
  const sfxVolume =
    raw.sfxVolume !== undefined
      ? raw.sfxVolume
      : hasLegacyVolume
        ? raw.volume
        : fallback.sfxVolume;

  let volume: unknown;
  if (hasLegacyVolume) {
    volume = raw.volume;
  } else if (isFiniteNumber(musicVolume) && isFiniteNumber(sfxVolume)) {
    volume = Math.max(musicVolume, sfxVolume);
  } else {
    volume = fallback.volume;
  }

  return {
    volume,
    musicVolume,
    sfxVolume,
    fullscreen: pick(raw, 'fullscreen', fallback.fullscreen),
    screenShake: pick(raw, 'screenShake', fallback.screenShake),
    damageNumbers: pick(raw, 'damageNumbers', fallback.damageNumbers),
    effects: pick(raw, 'effects', fallback.effects),
    locale: pick(raw, 'locale', fallback.locale),
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
 * Migrate `unlockedCharacters`: keep valid character ids, deduplicate, drop invalid entries,
 * and always guarantee `DEFAULT_CHARACTER_ID` (`'ninja'`) is present.
 */
function migrateUnlockedCharacters(raw: unknown): CharacterId[] {
  const validIds: CharacterId[] = [DEFAULT_CHARACTER_ID];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (isCharacterId(entry)) validIds.push(entry);
    }
  }
  return normalizeUnlockedList(validIds);
}

/**
 * Upgrade an old save (v0/v1/v2/v3/v4) to `SAVE_VERSION` (v5).
 *
 * - missing `version` → treated as 0 (a save from before versioning).
 * - missing field → default; wrong type → left for `parseSaveData` to report
 *   (except `selectedCharacter` and `unlockedCharacters`, where unknown/corrupt entries are
 *   sanitized so an outdated roster id never wipes the rest of the player's save).
 * - legacy `settings.cultivatorEnabled` (v3) is dropped gracefully without error.
 * - legacy `settings.volume` (v0–v4) migrates into both `musicVolume` and `sfxVolume`.
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

  // v1 → v2 (#45): chapter 4 exists; `chaptersUnlocked` stays unchanged.
  // v2 → v3 (M10): added `selectedCharacter` and temporary `settings.cultivatorEnabled`.
  // v3 → v4 (M14): adds `unlockedCharacters` (deduplicated, always keeping `'ninja'`) and
  // retires `settings.cultivatorEnabled` cleanly.
  // v4 → v5 (M15): adds Utility meta tracks (`xpMagnet`, `goldBonus`, `freeRerolls`),
  // per-chapter `ascensionUnlocked`, and split `settings.musicVolume` / `settings.sfxVolume`.
  const migrated = {
    version: SAVE_VERSION,
    gold: pick(raw, 'gold', defaults.gold),
    upgrades: migrateUpgrades(raw.upgrades, defaults.upgrades),
    chaptersUnlocked: pick(raw, 'chaptersUnlocked', defaults.chaptersUnlocked),
    ascensionUnlocked: migrateAscensionUnlocked(raw.ascensionUnlocked, defaults.ascensionUnlocked),
    best: migrateBest(raw.best, defaults.best),
    settings: migrateSettings(raw.settings, defaults.settings),
    selectedCharacter: migrateSelectedCharacter(
      raw.selectedCharacter,
      defaults.selectedCharacter,
    ),
    unlockedCharacters: migrateUnlockedCharacters(raw.unlockedCharacters),
  };

  return parseSaveData(migrated);
}
