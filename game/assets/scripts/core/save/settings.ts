/**
 * Một phần settings. Tách riêng vì cả save lẫn màn Settings đều dùng, và để
 * `save-data.ts` không phải tự định nghĩa lại shape.
 */
export interface Settings {
  /** Âm lượng chung 0..1. */
  readonly volume: number;
  readonly fullscreen: boolean;
}

/** GDD §10 dùng 0.8 làm mặc định. */
export const DEFAULT_VOLUME = 0.8;

/** Mỗi lần bấm trái/phải trên hàng Volume đi 10%. */
export const VOLUME_STEP = 0.1;

export const DEFAULT_SETTINGS: Settings = { volume: DEFAULT_VOLUME, fullscreen: false };

/**
 * Kẹp volume về 0..1. NaN/Infinity (dữ liệu hỏng, `parseFloat` thất bại) trả về
 * mặc định thay vì 0 — âm lượng 0 trông như game mất tiếng, khó debug hơn.
 */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * Đi `steps` bước 10% từ volume hiện tại (âm = nhỏ đi). Làm tròn 1 chữ số thập
 * phân để 0.8 → 0.9 chứ không thành 0.8999999999999999 khi hiển thị/serialize.
 */
export function stepVolume(volume: number, steps: number): number {
  const current = clampVolume(volume);
  const delta = Number.isFinite(steps) ? Math.trunc(steps) * VOLUME_STEP : 0;
  return clampVolume(Math.round((current + delta) * 10) / 10);
}

/**
 * Bản chuẩn hoá của settings: volume được kẹp, field thiếu lấy mặc định.
 * Nhận `Partial` vì dữ liệu đến từ save cũ có thể thiếu field.
 */
export function applySettings(settings: Partial<Settings> = {}): Settings {
  const volume = settings.volume === undefined ? DEFAULT_VOLUME : settings.volume;
  return {
    volume: clampVolume(volume),
    fullscreen:
      typeof settings.fullscreen === 'boolean' ? settings.fullscreen : DEFAULT_SETTINGS.fullscreen,
  };
}
