/**
 * Storage adapter for saves. Core never touches `localStorage` (no DOM,
 * testable under Node): it only knows the `SaveStorage` interface. The real implementation using
 * `window.localStorage` lives in `assets/scripts/game/`.
 */
import { createDefaultSave, migrate, serializeSave } from './save-data';
import type { SaveData } from './save-data';

export interface SaveStorage {
  /** `null` = nothing in the slot yet. */
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Permanent Profile Save repository with optional `.bak` backup fallback (ADR-023).
 *
 * - `save(data)` validates & serializes first (throwing on invalid data before touching either
 *   storage), writes primary, then mirrors the exact valid JSON to `backupStorage` if provided.
 * - `load()` never throws: if primary is missing, unreadable, or corrupt JSON/schema, it
 *   automatically tries `backupStorage` and flags `recoveredFromBackup = true`. If both fail,
 *   returns `createDefaultSave()` and records the error in `lastLoadError`.
 * - `reset()` clears both primary and backup slots.
 */
export class SaveRepository {
  private loadError: string | null = null;
  private recoveredBackup = false;

  constructor(
    private readonly storage: SaveStorage,
    private readonly backupStorage?: SaveStorage,
  ) {}

  /** Error from the latest `load`, `null` when clean. */
  get lastLoadError(): string | null {
    return this.loadError;
  }

  /** True when the latest `load()` fell back to `backupStorage` and succeeded. */
  get recoveredFromBackup(): boolean {
    return this.recoveredBackup;
  }

  load(): SaveData {
    this.loadError = null;
    this.recoveredBackup = false;

    const primary = this.tryReadAndMigrate(this.storage);
    if (primary.status === 'ok') {
      return primary.data;
    }

    const primaryError = primary.status === 'error' ? primary.error : null;

    if (this.backupStorage !== undefined) {
      const backup = this.tryReadAndMigrate(this.backupStorage);
      if (backup.status === 'ok') {
        this.recoveredBackup = true;
        this.loadError = primaryError;
        return backup.data;
      }
      if (primaryError !== null) {
        this.loadError = primaryError;
      } else if (backup.status === 'error') {
        this.loadError = backup.error;
      }
      return createDefaultSave();
    }

    if (primaryError !== null) {
      this.loadError = primaryError;
    }
    return createDefaultSave();
  }

  save(data: SaveData): void {
    const serialized = serializeSave(data);
    this.storage.write(serialized);
    this.backupStorage?.write(serialized);
  }

  /** Clear primary and backup slots plus error state — used by "delete progress". */
  reset(): void {
    this.storage.clear();
    this.backupStorage?.clear();
    this.loadError = null;
    this.recoveredBackup = false;
  }

  private tryReadAndMigrate(
    slot: SaveStorage,
  ):
    | { readonly status: 'ok'; readonly data: SaveData }
    | { readonly status: 'empty' }
    | { readonly status: 'error'; readonly error: string } {
    let raw: string | null;
    try {
      raw = slot.read();
    } catch (error) {
      return { status: 'error', error: errorMessage(error) };
    }

    if (raw === null) return { status: 'empty' };

    try {
      return { status: 'ok', data: migrate(JSON.parse(raw)) };
    } catch (error) {
      return { status: 'error', error: errorMessage(error) };
    }
  }
}

/** In-memory storage: used by tests, and as a fallback when the browser blocks storage. */
export class MemorySaveStorage implements SaveStorage {
  private value: string | null;

  constructor(initial: string | null = null) {
    this.value = initial;
  }

  read(): string | null {
    return this.value;
  }

  write(value: string): void {
    this.value = value;
  }

  clear(): void {
    this.value = null;
  }
}
