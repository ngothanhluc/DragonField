/**
 * Knockback: đẩy actor ra xa nguồn sát thương trong một khoảng thời gian ngắn.
 *
 * Hàm thuần, toạ độ tile unit (y hướng xuống), cùng hệ với `LevelData`. Không
 * import `cc`, không đọc thời gian — caller truyền `deltaMs` và giữ state.
 *
 * Hai bước tách rời để adapter kiểm soát vòng đời:
 *
 * 1. `startKnockback()` chốt **hướng** tại thời điểm trúng đòn. Nguồn trùng vị
 *    trí actor (không có hướng xác định) trả `null` thay vì chia cho 0.
 * 2. `stepKnockback()` mỗi frame: đi theo hướng đó, dừng ngay trước vật cản và
 *    không bao giờ ra ngoài phòng. Trả state kế tiếp, `null` khi đã hết thời gian
 *    hoặc bị chặn.
 *
 * Vì sao quét theo mẫu nhỏ thay vì chỉ kiểm tra điểm cuối: knockback một frame
 * có thể dài hơn vật cản mỏng nhất (1 tile), và "dừng ở điểm cuối hợp lệ" sẽ
 * teleport xuyên qua cột. Bước mẫu `KNOCKBACK_SAMPLE_STEP_TILES` nhỏ hơn nhiều
 * lần chiều dày đó.
 */
import type { LevelData } from '../level/level-data';
import { obstacleAt } from '../level/level-data';
import type { Vec2 } from '../math/vec2';

/** Khoảng cách + thời gian của một cú đẩy. */
export interface KnockbackConfig {
  /** Tổng quãng đường, tile. */
  readonly distanceTiles: number;
  /** Thời gian đi hết quãng đường, ms. */
  readonly durationMs: number;
}

/** Cú đẩy đang chạy. `direction` là vector đơn vị, bất biến suốt cú đẩy. */
export interface KnockbackState {
  readonly direction: Vec2;
  /** Tốc độ không đổi, tile/giây. */
  readonly speedTilesPerSecond: number;
  /** Thời gian còn lại, ms; luôn > 0 với state còn sống. */
  readonly remainingMs: number;
}

export interface KnockbackStepResult {
  readonly position: Vec2;
  /** `null` khi cú đẩy đã xong hoặc vừa bị vật cản/chạm tường chặn. */
  readonly state: KnockbackState | null;
}

/** Bước lấy mẫu khi quét đường đẩy, tile. Nhỏ hơn 1 tile để không xuyên cột. */
export const KNOCKBACK_SAMPLE_STEP_TILES = 0.05;

/** Dưới ngưỡng này coi như hai điểm trùng nhau (không có hướng). */
const MIN_SOURCE_DISTANCE_TILES = 1e-9;

/**
 * Bắt đầu cú đẩy từ `source` tới `position` (đẩy **ra xa** nguồn).
 *
 * Trả `null` khi cấu hình không hợp lệ (khoảng cách/thời gian <= 0) hoặc nguồn
 * trùng vị trí actor — mọi trường hợp đó đều không có hướng đẩy xác định.
 */
export function startKnockback(
  position: Vec2,
  source: Vec2,
  config: KnockbackConfig,
): KnockbackState | null {
  if (!(config.distanceTiles > 0) || !(config.durationMs > 0)) return null;

  const dx = position.x - source.x;
  const dy = position.y - source.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < MIN_SOURCE_DISTANCE_TILES) return null;

  return {
    direction: { x: dx / length, y: dy / length },
    speedTilesPerSecond: config.distanceTiles / (config.durationMs / 1000),
    remainingMs: config.durationMs,
  };
}

/**
 * Một frame của cú đẩy. Không sửa `position` hay `state` đầu vào.
 *
 * `marginTiles` là lề tường mà tâm actor phải giữ (player/enemy dùng
 * `ROOM_EDGE_MARGIN_TILES`); mặc định 0 = chỉ cần nằm trong phòng.
 */
export function stepKnockback(
  position: Vec2,
  state: KnockbackState,
  deltaMs: number,
  level: LevelData,
  marginTiles = 0,
): KnockbackStepResult {
  if (!(deltaMs > 0)) return { position, state };

  const elapsedMs = Math.min(deltaMs, state.remainingMs);
  const distance = state.speedTilesPerSecond * (elapsedMs / 1000);
  const steps = Math.max(1, Math.ceil(distance / KNOCKBACK_SAMPLE_STEP_TILES));

  const minX = Math.max(0, marginTiles);
  const maxX = Math.max(minX, level.size.cols - minX);
  const minY = Math.max(0, marginTiles);
  const maxY = Math.max(minY, level.size.rows - minY);

  let current: Vec2 = { x: position.x, y: position.y };

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const next: Vec2 = {
      x: position.x + state.direction.x * distance * progress,
      y: position.y + state.direction.y * distance * progress,
    };

    if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY) {
      // Chạm tường: đặt sát mép (nếu mép không nằm trong vật cản) rồi dừng.
      const edge: Vec2 = {
        x: clamp(next.x, minX, maxX),
        y: clamp(next.y, minY, maxY),
      };
      if (obstacleAt(level, edge) === null) current = edge;
      return { position: current, state: null };
    }

    if (obstacleAt(level, next) !== null) {
      // Giữ điểm hợp lệ cuối cùng, không xuyên vật cản.
      return { position: current, state: null };
    }

    current = next;
  }

  const remainingMs = state.remainingMs - elapsedMs;
  return {
    position: current,
    state: remainingMs > 0 ? { ...state, remainingMs } : null,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
