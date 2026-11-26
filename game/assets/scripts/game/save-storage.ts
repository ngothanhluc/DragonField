/**
 * `localStorage` adapters for Profile Save (with `.bak` backup) and Active Run Save (ADR-023).
 *
 * `core/save/` never touches the DOM; this file is the only place that knows about
 * `window.localStorage`. If the browser blocks storage (private mode, iframe sandbox) it falls
 * back to `MemorySaveStorage` so the game still plays, losing progress only on reload — with a
 * console warning.
 */
import { RunSaveRepository } from '../core/save/run-save';
import { MemorySaveStorage, SaveRepository } from '../core/save/storage';
import type { SaveStorage } from '../core/save/storage';

/** Primary permanent Profile Save key (ADR-023). */
export const SAVE_STORAGE_KEY = 'yokai-field.save';
/** Backup permanent Profile Save key for corruption recovery (ADR-023). */
export const SAVE_BACKUP_STORAGE_KEY = 'yokai-field.save.bak';
/** Active in-progress Run Save key (ADR-023; wiped immediately on death). */
export const RUN_SAVE_STORAGE_KEY = 'yokai-field.run';
/** Pre-M15 profile key read as a one-way fallback so existing players keep their progress. */
export const LEGACY_SAVE_STORAGE_KEY = 'yokai-field-save';

class LocalStorageKey implements SaveStorage {
  constructor(
    private readonly key: string,
    private readonly legacyReadKey?: string,
  ) {}

  read(): string | null {
    const current = window.localStorage.getItem(this.key);
    if (current !== null) return current;
    if (this.legacyReadKey !== undefined) {
      return window.localStorage.getItem(this.legacyReadKey);
    }
    return null;
  }

  write(value: string): void {
    window.localStorage.setItem(this.key, value);
  }

  clear(): void {
    window.localStorage.removeItem(this.key);
    if (this.legacyReadKey !== undefined) {
      window.localStorage.removeItem(this.legacyReadKey);
    }
  }
}

function canUseLocalStorage(probePrefix: string): boolean {
  try {
    // Probe both read and write: some browsers allow reads but throw on writes (quota/sandbox).
    const probe = `${probePrefix}:probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[YokaiField] localStorage unavailable (${message}); the save lives in RAM only.`,
    );
    return false;
  }
}

/** Permanent Profile Save repository with `.bak` backup fallback; RAM fallback when blocked. */
export function createSaveRepository(): SaveRepository {
  if (canUseLocalStorage(SAVE_STORAGE_KEY)) {
    return new SaveRepository(
      new LocalStorageKey(SAVE_STORAGE_KEY, LEGACY_SAVE_STORAGE_KEY),
      new LocalStorageKey(SAVE_BACKUP_STORAGE_KEY),
    );
  }
  return new SaveRepository(new MemorySaveStorage(), new MemorySaveStorage());
}

/** Active Run Save repository (`yokai-field.run`); RAM fallback when storage is blocked. */
export function createRunSaveRepository(): RunSaveRepository {
  if (canUseLocalStorage(RUN_SAVE_STORAGE_KEY)) {
    return new RunSaveRepository(new LocalStorageKey(RUN_SAVE_STORAGE_KEY));
  }
  return new RunSaveRepository(new MemorySaveStorage());
}
