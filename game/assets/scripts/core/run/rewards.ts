/**
 * Vàng của một run (GDD §2, §7, §9). Ba cửa vào:
 *
 * - `goldForKill` — thưởng theo vai trò địch, elite nhân 3.
 * - `goldForRoomClear` — thưởng dọn phòng, boss 50 thay vì 5.
 * - `applyGold` — cộng vào save, **luôn** trả vàng hữu hạn và >= 0.
 *
 * Không biết gì về engine/localStorage: mọi hàm thuần, không đọc giờ hệ thống.
 * `summariseRun` đóng gói số liệu cho màn hình kết quả với shape cố định để UI
 * và test không phải đoán field nào có mặt.
 */
import type { EnemyRole } from '../level/level-data';
import type { SaveData } from '../save/save-data';
import { ROOMS_PER_CHAPTER, type RunStatus } from './run-state';

export const GOLD = {
  chaser: 1,
  caster: 1,
  tank: 3,
  /** Elite nhân 3 so với bản thường (GDD §4: elite chỉ đổi máu/sát thương). */
  eliteMultiplier: 3,
  roomClear: 5,
  boss: 50,
} as const;

/**
 * Trần vàng: `SaveData.gold` là số nguyên trong `0..Number.MAX_SAFE_INTEGER`
 * (`save-data.ts`), nên mọi phép cộng phải kẹp về đây trước khi serialize.
 */
export const MAX_GOLD = Number.MAX_SAFE_INTEGER;

/** Vàng nhặt được khi giết một enemy. Elite nhân `GOLD.eliteMultiplier`. */
export function goldForKill(role: EnemyRole, elite: boolean): number {
  const base = GOLD[role];
  return elite ? base * GOLD.eliteMultiplier : base;
}

/** Vàng khi dọn sạch phòng. Phòng boss thưởng lớn hơn hẳn. */
export function goldForRoomClear(isBossRoom: boolean): number {
  return isBossRoom ? GOLD.boss : GOLD.roomClear;
}

export interface GoldResult {
  /** Save mới; save truyền vào không bị sửa. */
  readonly save: SaveData;
  /** Tổng vàng sau khi cộng, đã kẹp vào `0..MAX_GOLD`. */
  readonly gold: number;
}

/**
 * Cộng vàng vào save.
 *
 * - `amount` không hữu hạn (NaN/±Infinity) coi như 0: một phần thưởng hỏng
 *   **không** được phép đẻ ra vàng.
 * - Kết quả làm tròn xuống số nguyên vì schema save chỉ nhận số nguyên.
 * - Kẹp `0..MAX_GOLD` để save luôn qua được `parseSaveData`.
 */
export function applyGold(save: SaveData, amount: number): GoldResult {
  const delta = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  // Save hỏng (vàng NaN) không được nuốt luôn phần thưởng vừa kiếm.
  const current = Number.isFinite(save.gold) ? save.gold : 0;
  const gold = clampGold(current + delta);
  return { save: { ...save, gold }, gold };
}

export interface RunSummaryArgs {
  readonly roomsCleared: number;
  readonly kills: number;
  readonly goldEarned: number;
  readonly durationMs: number;
  readonly status: RunStatus;
}

/** Shape cố định cho màn hình kết quả (GDD §9: phòng đạt, vàng, thời gian). */
export interface RunSummary {
  readonly status: RunStatus;
  /** Số phòng đã dọn, kẹp `0..ROOMS_PER_CHAPTER`. */
  readonly roomsCleared: number;
  readonly kills: number;
  readonly goldEarned: number;
  readonly durationMs: number;
  /** Thời gian dạng giây, làm tròn 1 chữ số thập phân — dùng để hiển thị. */
  readonly durationSeconds: number;
  readonly won: boolean;
  /** Nhãn HUD/kết quả, ví dụ `3/9`. */
  readonly roomLabel: string;
}

/**
 * Gói kết quả run cho màn hình kết quả. Mọi số vào đều được làm sạch: số âm,
 * NaN hay Infinity từ một run hỏng không được lọt ra UI.
 */
export function summariseRun(args: RunSummaryArgs): RunSummary {
  const roomsCleared = clampCount(args.roomsCleared, ROOMS_PER_CHAPTER);
  const durationMs = clampDuration(args.durationMs);

  return {
    status: args.status,
    roomsCleared,
    kills: clampCount(args.kills, MAX_GOLD),
    goldEarned: clampGold(args.goldEarned),
    durationMs,
    durationSeconds: Math.round(durationMs / 100) / 10,
    won: args.status === 'won',
    roomLabel: `${roomsCleared}/${ROOMS_PER_CHAPTER}`,
  };
}

function clampGold(value: number): number {
  // NaN không mang thông tin gì → 0. +Infinity là tràn số khi cộng dồn → trần.
  if (Number.isNaN(value)) return 0;
  if (!Number.isFinite(value)) return value > 0 ? MAX_GOLD : 0;
  return Math.min(MAX_GOLD, Math.max(0, Math.trunc(value)));
}

function clampCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.trunc(value)));
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
