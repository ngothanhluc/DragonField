/**
 * Active Run Save schema & repository (M15, GDD §15.5, ADR-023).
 *
 * Stores plain JSON data only — ZERO engine node references, ZERO `cc` imports.
 * Autosaved exclusively at safe boundaries (room entry / after door choice) so reloading
 * mid-room restores the player at the start of that room. Death clears the slot immediately
 * (strict permadeath).
 */
import { BOSS_IDS } from '../boss/boss-defs';
import type { BossId } from '../boss/boss-defs';
import { isCharacterId } from '../characters/roster';
import type { CharacterId } from '../characters/roster';
import { MAX_FREE_REROLLS_TRACK } from '../meta/upgrades';
import { CHAPTERS_PER_RUN } from '../run/run-state';
import type { DoorReward } from '../run/doors';
import { findSkillOrEvolution } from '../skills/evolutions';
import { clampSkillStacks } from '../skills/pool';
import { MAX_ASCENSION_TIER } from './save-data';
import type { SaveStorage } from './storage';

/**
 * v1 (M15): initial ADR-023 run save with legacy 6-heart health scale (`hearts`/`maxHearts`).
 * v2 (M17): RPG 100 HP scale (`ADR-025`). Legacy v1 heart values (`maxHearts <= 20`) migrate
 * automatically via `×20` (`hearts * 20`, `maxHearts * 20`); field keys `hearts` and `maxHearts`
 * remain on the schema for clean compatibility across runtime/debug callers while storing HP.
 */
export const RUN_SAVE_VERSION = 2;

/** Conversion factor from legacy heart units to M17 RPG HP units (1 heart = 20 HP). */
export const LEGACY_HEART_TO_HP_SCALE = 20;
/** Legacy v1 saves with `maxHearts <= 20` are treated as heart-scale and multiplied by 20. */
export const LEGACY_HEART_MAX_THRESHOLD = 20;

const VALID_DOORS: ReadonlySet<string> = new Set<DoorReward>([
  'xp',
  'gold',
  'heal',
  'shop',
  'chest',
  'boss',
]);

const VALID_BOSS_IDS: ReadonlySet<string> = new Set<string>(BOSS_IDS);

/**
 * Plain JSON snapshot of an active run at a safe room boundary (ADR-023).
 * Zero engine node references or mid-frame combat entities.
 */
export interface ActiveRunSave {
  readonly version: number;
  /** Deterministic 32-bit unsigned run seed. */
  readonly seed: number;
  /** Current chapter 1..CHAPTERS_PER_RUN (1..4). */
  readonly chapter: number;
  /** 1-based room index within the chapter (1..drawnRooms.length). */
  readonly roomIndex: number;
  /** Door reward chosen to enter the current room (`null` on room 1 / before choice). */
  readonly chosenDoor: DoorReward | null;
  /** Ordered room numbers drawn for the current chapter (e.g. `[3, 7, ..., 17]`). */
  readonly drawnRooms: readonly number[];
  /** Chapter boss id selected by seed for the chapter's boss arena. */
  readonly bossId: BossId;
  /** Playable character locked for this run. */
  readonly characterId: CharacterId;
  /** Current player HP (`1..maxHearts`; a 0-HP dead run cannot be resumed). */
  readonly hearts: number;
  /** Current max HP (`>= 1`). */
  readonly maxHearts: number;
  /** Current XP level (`>= 1`). */
  readonly xpLevel: number;
  /** XP progress toward next level (`>= 0`). */
  readonly xpCurrent: number;
  /** Cumulative XP collected during the run (`>= xpCurrent`). */
  readonly xpTotal: number;
  /** Pending unspent level-up skill picks (`>= 0`). */
  readonly pendingLevelUps: number;
  /** Owned base skills & Legendary Evolutions mapped by id → stack count. */
  readonly ownedSkills: Readonly<Record<string, number>>;
  /** Skill-pick rerolls consumed so far in this run (`>= 0`). */
  readonly rerollsUsed: number;
  /** Remaining free Meta Utility rerolls for this run (`0..MAX_FREE_REROLLS_TRACK`). */
  readonly freeRerollsLeft: number;
  /** Unbanked gold accumulated during the run (`>= 0`). */
  readonly goldEarned: number;
  /** Total enemies slain during the run (`>= 0`). */
  readonly kills: number;
  /** Elapsed active run duration in milliseconds (`>= 0`). */
  readonly elapsedMs: number;
  /** Active Ascension tier (`0..MAX_ASCENSION_TIER`). */
  readonly ascension: number;
  /** Endless loop counter (`0` = normal run, `>= 1` = endless loop). */
  readonly endlessLoop: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isDoorReward(value: unknown): value is DoorReward {
  return typeof value === 'string' && VALID_DOORS.has(value);
}

function isBossId(value: unknown): value is BossId {
  return typeof value === 'string' && VALID_BOSS_IDS.has(value);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validate, migrate, and clamp a raw active-run payload to `RUN_SAVE_VERSION`.
 * Returns `null` on structurally invalid, unsupported-version, or corrupt/dead run data.
 */
export function migrateRunSave(raw: unknown): ActiveRunSave | null {
  if (!isRecord(raw)) return null;

  const version = raw.version;
  if (!isFiniteNumber(version) || !Number.isInteger(version) || version < 1 || version > RUN_SAVE_VERSION) {
    return null;
  }

  if (!isFiniteNumber(raw.seed)) return null;
  const seed = Math.trunc(raw.seed) >>> 0;

  if (!isFiniteNumber(raw.chapter) || !Number.isInteger(raw.chapter)) return null;
  if (raw.chapter < 1 || raw.chapter > CHAPTERS_PER_RUN) return null;
  const chapter = raw.chapter;

  if (!Array.isArray(raw.drawnRooms) || raw.drawnRooms.length === 0) return null;
  const drawnRooms: number[] = [];
  for (const roomNum of raw.drawnRooms) {
    if (!isFiniteNumber(roomNum) || !Number.isInteger(roomNum) || roomNum < 1) return null;
    drawnRooms.push(roomNum);
  }

  if (!isFiniteNumber(raw.roomIndex) || !Number.isInteger(raw.roomIndex) || raw.roomIndex < 1) {
    return null;
  }
  const roomIndex = clampInt(raw.roomIndex, 1, drawnRooms.length);

  let chosenDoor: DoorReward | null;
  if (raw.chosenDoor === null || raw.chosenDoor === undefined) {
    chosenDoor = null;
  } else if (isDoorReward(raw.chosenDoor)) {
    chosenDoor = raw.chosenDoor;
  } else {
    return null;
  }

  if (!isBossId(raw.bossId)) return null;
  const bossId = raw.bossId;

  if (!isCharacterId(raw.characterId)) return null;
  const characterId = raw.characterId;

  const rawMax = raw.maxHp ?? raw.maxHearts;
  const rawCurrent = raw.hp ?? raw.hearts;

  if (!isFiniteNumber(rawMax) || rawMax < 1) return null;
  let maxHearts = clampInt(rawMax, 1, Number.MAX_SAFE_INTEGER);

  // Strict permadeath (ADR-023): a dead run (hp <= 0) must never be resumed.
  if (!isFiniteNumber(rawCurrent) || rawCurrent <= 0) return null;
  let hearts = clampInt(rawCurrent, 1, maxHearts);

  // M17 migration (v1 → v2): convert legacy 6-heart saves (`maxHearts <= 20`) to 100 HP scale.
  if (version === 1 && maxHearts <= LEGACY_HEART_MAX_THRESHOLD) {
    maxHearts *= LEGACY_HEART_TO_HP_SCALE;
    hearts = Math.min(maxHearts, hearts * LEGACY_HEART_TO_HP_SCALE);
  }

  if (!isFiniteNumber(raw.xpLevel) || raw.xpLevel < 1) return null;
  const xpLevel = clampInt(raw.xpLevel, 1, Number.MAX_SAFE_INTEGER);

  if (!isFiniteNumber(raw.xpCurrent)) return null;
  const xpCurrent = clampInt(raw.xpCurrent, 0, Number.MAX_SAFE_INTEGER);

  if (!isFiniteNumber(raw.xpTotal)) return null;
  const xpTotal = Math.max(xpCurrent, clampInt(raw.xpTotal, 0, Number.MAX_SAFE_INTEGER));

  if (!isFiniteNumber(raw.pendingLevelUps)) return null;
  const pendingLevelUps = clampInt(raw.pendingLevelUps, 0, Number.MAX_SAFE_INTEGER);

  if (!isRecord(raw.ownedSkills)) return null;
  const ownedSkills: Record<string, number> = {};
  const sortedIds = Object.keys(raw.ownedSkills).sort();
  for (const id of sortedIds) {
    const rawStacks = raw.ownedSkills[id];
    if (!isFiniteNumber(rawStacks)) return null;
    const def = findSkillOrEvolution(id);
    if (def === undefined) continue;
    const stacks = clampSkillStacks(rawStacks, def.maxStacks);
    if (stacks > 0) ownedSkills[id] = stacks;
  }

  if (!isFiniteNumber(raw.rerollsUsed)) return null;
  const rerollsUsed = clampInt(raw.rerollsUsed, 0, Number.MAX_SAFE_INTEGER);

  if (!isFiniteNumber(raw.freeRerollsLeft)) return null;
  const freeRerollsLeft = clampInt(raw.freeRerollsLeft, 0, MAX_FREE_REROLLS_TRACK);

  if (!isFiniteNumber(raw.goldEarned)) return null;
  const goldEarned = clampInt(raw.goldEarned, 0, Number.MAX_SAFE_INTEGER);

  if (!isFiniteNumber(raw.kills)) return null;
  const kills = clampInt(raw.kills, 0, Number.MAX_SAFE_INTEGER);

  if (!isFiniteNumber(raw.elapsedMs)) return null;
  const elapsedMs = clampInt(raw.elapsedMs, 0, Number.MAX_SAFE_INTEGER);

  if (!isFiniteNumber(raw.ascension)) return null;
  const ascension = clampInt(raw.ascension, 0, MAX_ASCENSION_TIER);

  if (!isFiniteNumber(raw.endlessLoop)) return null;
  const endlessLoop = clampInt(raw.endlessLoop, 0, Number.MAX_SAFE_INTEGER);

  return {
    version: RUN_SAVE_VERSION,
    seed,
    chapter,
    roomIndex,
    chosenDoor,
    drawnRooms,
    bossId,
    characterId,
    hearts,
    maxHearts,
    xpLevel,
    xpCurrent,
    xpTotal,
    pendingLevelUps,
    ownedSkills,
    rerollsUsed,
    freeRerollsLeft,
    goldEarned,
    kills,
    elapsedMs,
    ascension,
    endlessLoop,
  };
}

/**
 * Canonical JSON serialization for an active run save.
 * Throws if `run` fails validation so corrupt run state is never persisted.
 */
export function serializeRunSave(run: ActiveRunSave): string {
  const valid = migrateRunSave(run);
  if (valid === null) {
    throw new Error('Invalid ActiveRunSave: cannot serialize corrupt run data');
  }

  const orderedSkills: Record<string, number> = {};
  for (const id of Object.keys(valid.ownedSkills).sort()) {
    const stacks = valid.ownedSkills[id];
    if (stacks !== undefined) orderedSkills[id] = stacks;
  }

  return JSON.stringify({
    version: RUN_SAVE_VERSION,
    seed: valid.seed,
    chapter: valid.chapter,
    roomIndex: valid.roomIndex,
    chosenDoor: valid.chosenDoor,
    drawnRooms: [...valid.drawnRooms],
    bossId: valid.bossId,
    characterId: valid.characterId,
    hearts: valid.hearts,
    maxHearts: valid.maxHearts,
    xpLevel: valid.xpLevel,
    xpCurrent: valid.xpCurrent,
    xpTotal: valid.xpTotal,
    pendingLevelUps: valid.pendingLevelUps,
    ownedSkills: orderedSkills,
    rerollsUsed: valid.rerollsUsed,
    freeRerollsLeft: valid.freeRerollsLeft,
    goldEarned: valid.goldEarned,
    kills: valid.kills,
    elapsedMs: valid.elapsedMs,
    ascension: valid.ascension,
    endlessLoop: valid.endlessLoop,
  });
}

/**
 * Storage repository for the single active-run slot (`yokai-field.run`, ADR-023).
 *
 * - `load()` returns `null` when empty or corrupt (never throws).
 * - `hasRun()` returns `true` only when a valid resumable run exists.
 * - `save(run)` validates & serializes before writing.
 * - `clear()` deletes the run immediately (called on death / completion / abandon).
 */
export class RunSaveRepository {
  private loadError: string | null = null;

  constructor(private readonly storage: SaveStorage) {}

  /** Error from the latest `load`, `null` when empty or clean. */
  get lastLoadError(): string | null {
    return this.loadError;
  }

  load(): ActiveRunSave | null {
    this.loadError = null;

    let raw: string | null;
    try {
      raw = this.storage.read();
    } catch (error) {
      this.loadError = errorMessage(error);
      return null;
    }

    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.loadError = errorMessage(error);
      return null;
    }

    const migrated = migrateRunSave(parsed);
    if (migrated === null) {
      this.loadError = 'Invalid or corrupt ActiveRunSave payload';
      return null;
    }
    return migrated;
  }

  hasRun(): boolean {
    return this.load() !== null;
  }

  save(run: ActiveRunSave): void {
    this.storage.write(serializeRunSave(run));
  }

  /** Immediately wipe the active run slot (strict permadeath on death / run completion). */
  clear(): void {
    this.storage.clear();
    this.loadError = null;
  }
}
