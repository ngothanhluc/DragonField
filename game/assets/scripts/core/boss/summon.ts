/**
 * Quái do boss gọi (GDD §5, phase 3 của SquidGreen: "gọi 2 GreenOctopus").
 *
 * Thuần và tất định: cùng boss + cùng role + cùng seed cho đúng cùng danh sách.
 * Vị trí lấy từ một **vòng 8 ô** quanh boss (bán kính
 * `SUMMON_RING_RADIUS_TILES`, góc 45° một ô, bắt đầu từ +x), rồi kẹp vào phòng.
 * Ô nào quá sát boss hoặc đè lên quái vừa gọi thì bỏ, đi tiếp ô kế; hết vòng mà
 * vẫn không có ô hợp lệ thì lấy ô xa boss nhất (thà chồng nhẹ còn hơn không gọi
 * được quái).
 *
 * Id tất định: `boss-<bossId>-<role>-<step>-<index>`. Có `step` để hai lần gọi
 * ở hai bước khác nhau không trùng id, và chạy lại cùng seed vẫn ra cùng id.
 */
import { ROOM_COLS, ROOM_ROWS, type EnemyRole } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import type { SeededRng } from '../rng';
import type { BossState } from './patterns';

/** Bán kính vòng gọi quái quanh boss, tile. */
export const SUMMON_RING_RADIUS_TILES = 4;

/** Số ô trên vòng — 8 hướng, đủ để 2 quái không bao giờ phải chồng nhau. */
export const SUMMON_RING_SLOTS = 8;

/** Khoảng cách tối thiểu giữa quái được gọi với boss và với nhau, tile. */
export const SUMMON_MIN_SEPARATION_TILES = 1.5;

/** Chừa 1 tile sát tường, cùng quy ước với boss (`BOSS_EDGE_MARGIN_TILES`). */
export const SUMMON_EDGE_MARGIN_TILES = 1;

const MIN_X = SUMMON_EDGE_MARGIN_TILES;
const MAX_X = ROOM_COLS - SUMMON_EDGE_MARGIN_TILES;
const MIN_Y = SUMMON_EDGE_MARGIN_TILES;
const MAX_Y = ROOM_ROWS - SUMMON_EDGE_MARGIN_TILES;

export interface SummonedEnemy {
  id: string;
  position: Vec2;
  role: EnemyRole;
}

/**
 * `count` quái quanh boss. `rng` là nguồn duy nhất của ngẫu nhiên: mỗi quái rút
 * đúng một số (`int`) để chọn ô bắt đầu, nên chuỗi RNG không phụ thuộc việc ô
 * đó có hợp lệ hay không.
 */
export function summonedEnemies(
  boss: BossState,
  role: EnemyRole,
  count: number,
  rng: SeededRng,
): SummonedEnemy[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`summonedEnemies cần count là số nguyên >= 0, nhận ${count}`);
  }

  const slots = ringSlots(boss.position);
  const used: Vec2[] = [];
  const summoned: SummonedEnemy[] = [];

  for (let index = 0; index < count; index += 1) {
    const start = rng.int(SUMMON_RING_SLOTS);
    const position = pickSlot(slots, start, boss.position, used);
    used.push(position);

    summoned.push({
      id: `boss-${boss.id}-${role}-${boss.step}-${index}`,
      position: { x: position.x, y: position.y },
      role,
    });
  }

  return summoned;
}

/** 8 điểm quanh boss, đã kẹp vào phòng. Thứ tự cố định để test đọc được. */
function ringSlots(origin: Vec2): Vec2[] {
  const slots: Vec2[] = [];
  for (let slot = 0; slot < SUMMON_RING_SLOTS; slot += 1) {
    const angle = (slot * Math.PI * 2) / SUMMON_RING_SLOTS;
    slots.push(
      clampToRoom({
        x: origin.x + Math.cos(angle) * SUMMON_RING_RADIUS_TILES,
        y: origin.y + Math.sin(angle) * SUMMON_RING_RADIUS_TILES,
      }),
    );
  }
  return slots;
}

/**
 * Ô hợp lệ đầu tiên tính từ `start`, đi vòng theo chiều tăng góc. Không có ô
 * nào hợp lệ thì trả ô xa boss nhất (hoà thì lấy ô gần `start` nhất).
 */
function pickSlot(
  slots: readonly Vec2[],
  start: number,
  boss: Vec2,
  used: readonly Vec2[],
): Vec2 {
  let fallback: Vec2 = slots[0] ?? { x: boss.x, y: boss.y };
  let fallbackGap = -1;

  for (let offset = 0; offset < slots.length; offset += 1) {
    const slot = slots[(start + offset) % slots.length];
    if (slot === undefined) continue;

    const bossGap = distance(slot, boss);
    if (bossGap > fallbackGap) {
      fallback = slot;
      fallbackGap = bossGap;
    }

    if (bossGap < SUMMON_MIN_SEPARATION_TILES) continue;
    if (used.some((taken) => distance(slot, taken) < SUMMON_MIN_SEPARATION_TILES)) continue;
    return { x: slot.x, y: slot.y };
  }

  return { x: fallback.x, y: fallback.y };
}

function clampToRoom(point: Vec2): Vec2 {
  return {
    x: Math.min(Math.max(point.x, MIN_X), MAX_X),
    y: Math.min(Math.max(point.y, MIN_Y), MAX_Y),
  };
}
