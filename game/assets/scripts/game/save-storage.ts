/**
 * Adapter `localStorage` cho `SaveRepository` (ADR-012: một slot, chỉ meta).
 *
 * `core/save/storage.ts` không đụng DOM; file này là chỗ duy nhất biết
 * `window.localStorage`. Trình duyệt chặn storage (private mode, iframe sandbox)
 * thì lùi về `MemorySaveStorage` để game vẫn chơi được, chỉ mất tiến trình khi
 * reload — kèm cảnh báo console.
 */
import { MemorySaveStorage, SaveRepository } from '../core/save/storage';
import type { SaveStorage } from '../core/save/storage';

/** Key duy nhất của slot (GDD §10). */
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

/** Repository thật của game; fallback RAM nếu storage bị chặn. */
export function createSaveRepository(): SaveRepository {
  try {
    // Probe cả đọc lẫn ghi: có trình duyệt cho đọc nhưng ném khi ghi (quota/sandbox).
    const probe = `${SAVE_STORAGE_KEY}:probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return new SaveRepository(new LocalStorageSave());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[YokaiField] localStorage không dùng được (${message}); save chỉ sống trong RAM.`,
    );
    return new SaveRepository(new MemorySaveStorage());
  }
}
