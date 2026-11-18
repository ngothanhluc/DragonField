/**
 * `localStorage` adapter for `SaveRepository` (ADR-012: one slot, meta only).
 *
 * `core/save/storage.ts` never touches the DOM; this file is the only place that knows about
 * `window.localStorage`. If the browser blocks storage (private mode, iframe sandbox) it falls
 * back to `MemorySaveStorage` so the game still plays, losing progress only on reload — with a
 * console warning.
 */
import { MemorySaveStorage, SaveRepository } from '../core/save/storage';
import type { SaveStorage } from '../core/save/storage';

/** The slot's single key (GDD §10). */
export const SAVE_STORAGE_KEY = 'yokai-field-save';

class LocalStorageSave implements SaveStorage {
  read(): string | null {
    return window.localStorage.getItem(SAVE_STORAGE_KEY);
  }

  write(value: string): void {
    window.localStorage.setItem(SAVE_STORAGE_KEY, value);
  }

  clear(): void {
    window.localStorage.removeItem(SAVE_STORAGE_KEY);
  }
}

/** The game's real repository; RAM fallback when storage is blocked. */
export function createSaveRepository(): SaveRepository {
  try {
    // Probe both read and write: some browsers allow reads but throw on writes (quota/sandbox).
    const probe = `${SAVE_STORAGE_KEY}:probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return new SaveRepository(new LocalStorageSave());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[YokaiField] localStorage unavailable (${message}); the save lives in RAM only.`,
    );
    return new SaveRepository(new MemorySaveStorage());
  }
}
