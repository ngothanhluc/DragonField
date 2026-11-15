/**
 * Đạn và object pool (ADR-008, M3: "không `new` mỗi phát").
 *
 * Toạ độ tile unit, cùng hệ với `LevelData`. Đạn là hình tròn; va chạm là
 * chồng lấn hai hình tròn, biên tính là trúng.
 *
 * Pool có **sức chứa cứng**: khi đầy, viên **cũ nhất** bị thu hồi và dùng lại
 * cho phát mới thay vì để mảng phình ra. Nhờ vậy 8 enemy + 40 viên đạn vẫn
 * chạy 60 fps mà không có frame nào cấp phát vượt kiểm soát. Hệ quả: đừng giữ
 * tham chiếu `Bullet` qua nhiều lần `spawn` — slot có thể đã thuộc về viên
 * khác. So sánh `id` nếu cần nhận diện.
 */
import type { LevelData, Obstacle } from '../level/level-data';
import { obstacleAt } from '../level/level-data';
import { distanceSquared, type Vec2 } from '../math/vec2';

export type BulletOwner = 'player' | 'enemy';

export interface Bullet {
  id: number;
  position: Vec2;
  velocity: Vec2;
  radiusTiles: number;
  damage: number;
  owner: BulletOwner;
  ttlMs: number;
}

export interface CircleArea {
  readonly position: Vec2;
  readonly radiusTiles: number;
}

export interface BulletSpawnArgs {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly radiusTiles: number;
  readonly damage: number;
  readonly owner: BulletOwner;
  readonly ttlMs: number;
}

/** Sức chứa mặc định: hơn 5× số đạn tối đa trên màn của mục tiêu M3 (40). */
export const DEFAULT_BULLET_CAPACITY = 256;

/** Bước lấy mẫu khi quét đường đi của đạn qua vật cản, tile. */
export const HIT_SAMPLE_STEP_TILES = 0.25;

/**
 * Bản nội bộ dùng `{ x, y }` mutable để mỗi frame không phải cấp phát object
 * toạ độ mới. Nó vẫn gán được cho `Bullet` vì `Vec2` chỉ `readonly` ở mức type.
 */
interface MutableBullet extends Bullet {
  position: { x: number; y: number };
}

/** Va chạm hai hình tròn; chạm đúng một điểm vẫn tính là trúng. */
export function hitsCircle(a: CircleArea, b: CircleArea): boolean {
  const reach = a.radiusTiles + b.radiusTiles;
  return distanceSquared(a.position, b.position) <= reach * reach;
}

export interface SweepArea {
  readonly from: Vec2;
  readonly to: Vec2;
}

export interface ObstacleHit {
  readonly obstacle: Obstacle;
  readonly point: Vec2;
  /** 0..1 dọc theo đoạn `from` -> `to`. */
  readonly progress: number;
}

/**
 * Vật cản đầu tiên trên đường đạn đi từ `from` tới `to`.
 *
 * Lấy mẫu dọc đoạn với bước `HIT_SAMPLE_STEP_TILES` rồi hỏi `obstacleAt`, nên
 * không thể xuyên qua cột mỏng nhất (1 tile) dù frame dài. Chỉ đọc
 * `level.obstacles`; các trường khác của `LevelData` không được dùng.
 */
export function firstHit(area: SweepArea, level: LevelData): ObstacleHit | null {
  const dx = area.to.x - area.from.x;
  const dy = area.to.y - area.from.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(length / HIT_SAMPLE_STEP_TILES));

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const point = {
      x: area.from.x + dx * progress,
      y: area.from.y + dy * progress,
    };
    const obstacle = obstacleAt(level, point);
    if (obstacle !== null) return { obstacle, point, progress };
  }

  return null;
}

export class BulletPool {
  private readonly live: MutableBullet[] = [];
  private readonly recycled: MutableBullet[] = [];
  private nextId = 1;

  constructor(readonly capacity: number = DEFAULT_BULLET_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`BulletPool cần capacity là số nguyên >= 1, nhận ${capacity}`);
    }
  }

  get size(): number {
    return this.live.length;
  }

  /**
   * Sinh một viên đạn. Khi pool đầy, viên **cũ nhất** bị thu hồi để lấy slot —
   * pool không bao giờ vượt `capacity`.
   */
  spawn(args: BulletSpawnArgs): Bullet {
    if (!(args.ttlMs > 0)) {
      throw new Error(`Đạn cần ttlMs > 0, nhận ${args.ttlMs}`);
    }

    const bullet = this.takeSlot();
    bullet.id = this.nextId;
    this.nextId += 1;
    bullet.position = { x: args.position.x, y: args.position.y };
    bullet.velocity = { x: args.velocity.x, y: args.velocity.y };
    bullet.radiusTiles = args.radiusTiles;
    bullet.damage = args.damage;
    bullet.owner = args.owner;
    bullet.ttlMs = args.ttlMs;

    this.live.push(bullet);
    return bullet;
  }

  /**
   * Bay theo vận tốc, trừ ttl, thu hồi viên hết hạn. Viên hết hạn trong frame
   * này bị bỏ luôn, không bay thêm — nó đã "sống" đủ thời gian của mình.
   */
  update(deltaMs: number): void {
    if (!(deltaMs >= 0)) {
      throw new Error(`BulletPool.update cần deltaMs >= 0, nhận ${deltaMs}`);
    }

    const seconds = deltaMs / 1000;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < this.live.length; readIndex += 1) {
      const bullet = this.live[readIndex];
      if (bullet === undefined) continue;

      bullet.ttlMs -= deltaMs;
      if (bullet.ttlMs <= 0) {
        this.recycled.push(bullet);
        continue;
      }

      bullet.position.x += bullet.velocity.x * seconds;
      bullet.position.y += bullet.velocity.y * seconds;

      this.live[writeIndex] = bullet;
      writeIndex += 1;
    }

    this.live.length = writeIndex;
  }

  /** Đạn đang sống, cũ nhất trước. Chỉ đọc — đừng sửa phần tử. */
  active(): readonly Bullet[] {
    return this.live;
  }

  /** Bản sao sâu, dùng cho test và debug. */
  snapshot(): Bullet[] {
    return this.live.map((bullet) => ({
      id: bullet.id,
      position: { x: bullet.position.x, y: bullet.position.y },
      velocity: { x: bullet.velocity.x, y: bullet.velocity.y },
      radiusTiles: bullet.radiusTiles,
      damage: bullet.damage,
      owner: bullet.owner,
      ttlMs: bullet.ttlMs,
    }));
  }

  /** Thu hồi toàn bộ đạn, ví dụ khi đổi phòng. */
  clear(): void {
    this.recycled.push(...this.live);
    this.live.length = 0;
  }

  private takeSlot(): MutableBullet {
    if (this.live.length >= this.capacity) {
      const oldest = this.live.shift();
      if (oldest !== undefined) return oldest;
    }

    const reused = this.recycled.pop();
    if (reused !== undefined) return reused;

    return {
      id: 0,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      radiusTiles: 0,
      damage: 0,
      owner: 'enemy',
      ttlMs: 0,
    };
  }
}
