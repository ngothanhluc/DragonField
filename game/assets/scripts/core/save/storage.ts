/**
 * Adapter storage cho save. Core **không** đụng `localStorage` (không có DOM,
 * test được bằng Node): nó chỉ biết interface `SaveStorage`. Bản thật dùng
 * `window.localStorage` nằm ở `assets/scripts/game/`.
 */
import { createDefaultSave, migrate, serializeSave } from './save-data';
import type { SaveData } from './save-data';

export interface SaveStorage {
  /** `null` = chưa có gì trong slot. */
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

/**
 * Một slot save duy nhất (ADR-012).
 *
 * `load` không bao giờ ném: save hỏng/không đọc được thì trả save mặc định để
 * người chơi vẫn vào game được, nhưng lỗi được giữ ở `lastLoadError` để UI và
 * log báo lại — im lặng nuốt lỗi là mất tiến trình mà không ai biết.
 */
export class SaveRepository {
  private loadError: string | null = null;

  constructor(private readonly storage: SaveStorage) {}

  /** Lỗi của lần `load` gần nhất, `null` nếu sạch. */
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

  /** Xoá slot và trạng thái lỗi — dùng cho "xoá tiến trình". */
  reset(): void {
    this.storage.clear();
    this.loadError = null;
  }

  private fail(error: unknown): SaveData {
    this.loadError = error instanceof Error ? error.message : String(error);
    return createDefaultSave();
  }
}

/** Storage trong RAM: dùng cho test, và làm fallback khi trình duyệt chặn storage. */
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
