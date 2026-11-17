/**
 * Đạn của enemy: chốt hướng tại lúc bắn, bay chậm để né được (GDD §4).
 *
 * Cùng một đường code cho mọi nguồn đạn enemy trong game (caster thường, caster
 * elite toả quạt, boss sau này): chọn góc → xoay vector đơn vị → spawn vào
 * `BulletPool`. Nhờ vậy "một loạt mấy viên" là tham số của hàm này, không phải
 * một vòng lặp riêng ở adapter — chỗ dễ lệch giữa sim và game.
 *
 * Đạn enemy dùng **cùng pool** với đạn player: pool có sức chứa cứng và tái dùng
 * slot, nên bắn 40 viên hay 400 viên cũng không cấp phát node/đối tượng trong
 * vòng lặp game.
 */
import type { Vec2 } from '../math/vec2';
import type { BulletPool } from './bullets';

/** Bán kính đạn enemy, tile — cùng quy ước với đạn player (0.15). */
export const ENEMY_BULLET_RADIUS_TILES = 0.15;

/** Tốc độ đạn enemy, tile/giây. Chậm hơn đạn player (12) nhiều để né được. */
export const ENEMY_BULLET_SPEED_TILES_PER_SECOND = 4;

/** Đạn enemy sống đủ lâu để bay hết phòng (32 tile / 4 = 8 s). */
export const ENEMY_BULLET_TTL_MS = 8000;

/** Hướng từ `from` tới `to`; hai điểm trùng nhau thì mặc định bay sang phải. */
export function aimDirection(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/** Xoay vector đơn vị quanh gốc `angle` radian (dương = kim đồng hồ trên màn hình). */
export function rotateDirection(direction: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: direction.x * cos - direction.y * sin,
    y: direction.x * sin + direction.y * cos,
  };
}

export interface EnemyVolleyArgs {
  readonly pool: BulletPool;
  /** Chỗ đạn xuất phát (tâm enemy). */
  readonly from: Vec2;
  /** Vị trí player tại lúc bắn — đạn **không** bám theo sau đó. */
  readonly to: Vec2;
  readonly damage: number;
  /** Góc lệch so với hướng thẳng tới player, radian. Mỗi phần tử là một viên. */
  readonly angles: readonly number[];
  readonly speedTilesPerSecond?: number;
  readonly ttlMs?: number;
  readonly radiusTiles?: number;
}

/**
 * Bắn một loạt đạn về phía `to`. Trả về **số viên** vừa spawn (0 khi `angles`
 * rỗng). Mọi viên trong loạt chia đúng `damage` của tham số, không chia nhỏ.
 */
export function fireEnemyVolley(args: EnemyVolleyArgs): number {
  const speed = args.speedTilesPerSecond ?? ENEMY_BULLET_SPEED_TILES_PER_SECOND;
  const ttlMs = args.ttlMs ?? ENEMY_BULLET_TTL_MS;
  const radiusTiles = args.radiusTiles ?? ENEMY_BULLET_RADIUS_TILES;
  const base = aimDirection(args.from, args.to);

  for (const angle of args.angles) {
    const direction = angle === 0 ? base : rotateDirection(base, angle);
    args.pool.spawn({
      position: args.from,
      velocity: { x: direction.x * speed, y: direction.y * speed },
      radiusTiles,
      damage: args.damage,
      owner: 'enemy',
      ttlMs,
    });
  }

  return args.angles.length;
}
