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

/**
 * A single save slot (ADR-012).
 *
 * `load` never throws: a broken/unreadable save returns the default save so the
 * player can still enter the game, but the error is kept in `lastLoadError` for the UI and
 * logs to report — silently swallowing it loses progress with nobody noticing.
 */
export class SaveRepository {
  private loadError: string | null = null;

  constructor(private readonly storage: SaveStorage) {}

  /** Error from the latest `load`, `null` when clean. */
  get lastLoadError(): string | null {
    return this.loadError;
  }

  load(): SaveData {
    this.loadError = null;

    let raw: string | null;
    try {
      raw = this.storage.read();
    } catch (error) {
      return this.fail(error);
    }

    if (raw === null) return createDefaultSave();

    try {
      return migrate(JSON.parse(raw));
    } catch (error) {
      return this.fail(error);
    }
  }

  save(data: SaveData): void {
    this.storage.write(serializeSave(data));
  }

  /** Clear the slot and the error state — used by "delete progress". */
  reset(): void {
    this.storage.clear();
    this.loadError = null;
  }

  private fail(error: unknown): SaveData {
    this.loadError = error instanceof Error ? error.message : String(error);
    return createDefaultSave();
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
