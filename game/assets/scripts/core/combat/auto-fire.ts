import type { Vec2 } from '../math/vec2';
import { FireControl } from './fire-control';
import { findNearestTarget, type Targetable } from './targeting';

/** Viên đạn mà engine cần sinh ra ở frame này. */
export interface ShotIntent {
  readonly targetId: string;
  /** Vector đơn vị từ `origin` tới mục tiêu. */
  readonly direction: Vec2;
  readonly origin: Vec2;
}

export interface AutoFireUpdateArgs {
  readonly deltaMs: number;
  readonly origin: Vec2;
  readonly targets: readonly Targetable[];
  /** Tầm auto-aim, tính theo tile (xem `CombatConfig.targetingRangeTiles`). */
  readonly rangeTiles: number;
}

/** Hướng mặc định khi player đứng trùng vị trí mục tiêu (không có hướng xác định). */
const FALLBACK_DIRECTION: Vec2 = { x: 1, y: 0 };

function directionTo(origin: Vec2, target: Vec2): Vec2 {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return FALLBACK_DIRECTION;
  return { x: dx / length, y: dy / length };
}

/**
 * Bắn tự động vào enemy gần nhất trong tầm (GDD §3).
 *
 * Thứ tự kiểm tra quan trọng: tìm mục tiêu **trước** rồi mới tick cooldown.
 * Nếu tick trước, mỗi frame không có enemy vẫn bị trừ cooldown, nên phát bắn
 * đầu tiên sẽ trễ tới cả giây sau khi enemy xuất hiện. Kiểm tra trước thì
 * phát bắn rơi đúng frame đầu tiên có mục tiêu.
 */
export class AutoFire {
  private readonly fireControl: FireControl;

  constructor(fireControl: FireControl | number) {
    this.fireControl =
      typeof fireControl === 'number' ? FireControl.fromRate(fireControl) : fireControl;
  }

  static fromRate(fireRatePerSecond: number): AutoFire {
    return new AutoFire(FireControl.fromRate(fireRatePerSecond));
  }

  update(args: AutoFireUpdateArgs): ShotIntent | null {
    const target = findNearestTarget(args.origin, args.targets, args.rangeTiles);
    if (target === null) return null;

    if (!this.fireControl.tick(args.deltaMs)) return null;

    return {
      targetId: target.id,
      direction: directionTo(args.origin, target.position),
      origin: args.origin,
    };
  }
}
