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
 *
 * Hợp đồng vòng đời một viên đạn:
 *
 * - `spawn` đưa slot vào `live` (và trả về chính object mutable đó để adapter
 *   đọc ngay frame này).
 * - Viên rời pool bằng **một trong ba** đường: hết `ttlMs` (trong `update`),
 *   bị đẩy ra khi pool đầy (`spawn`), hoặc bị thu hồi chủ động (`consume` /
 *   `consumeWhere`). Cả ba đường đều đưa slot về `recycled` để `spawn` sau
 *   dùng lại — không có `new` trong vòng lặp game.
 * - Id tăng đơn điệu và **không bao giờ sống lại**: viên đã consume không còn
 *   trong `active()`, và id của nó không thể xuất hiện trên viên khác.
 *
 * Vì vậy đừng mô phỏng "đạn trúng" bằng `bullet.ttlMs = 0` rồi chờ `update`
 * kế tiếp: viên đó vẫn nằm trong `active()` (và vẫn chiếm slot, vẫn nhìn thấy
 * được với adapter) cho tới frame sau. Dùng `consume(id)` / `consumeWhere(...)`
 * để bắn hạ ngay trong frame va chạm.
 */
import type { LevelData, Obstacle } from '../level/level-data';
import { obstacleAt } from '../level/level-data';
import { distanceSquared, type Vec2 } from '../math/vec2';

export type BulletOwner = 'player' | 'enemy';

export interface Bullet {
  id: number;
  position: Vec2;
  /** Mutable để Homing/Ricochet xoay hướng bay của chính viên đạn. */
  velocity: { x: number; y: number };
  radiusTiles: number;
  damage: number;
  owner: BulletOwner;
  ttlMs: number;
  /** Số enemy còn xuyên qua được (Piercing). 0 = dừng ở enemy đầu tiên. */
  pierceRemaining: number;
  /** Số lần còn nảy sang enemy khác (Ricochet). 0 = không nảy. */
  ricochetRemaining: number;
  /** Đạn tự bám mục tiêu (Homing). */
  homing: boolean;
  /** Bán kính nổ khi trúng, tile; 0 = không nổ (Explosive). */
  explosiveRadiusTiles: number;
  /** Damage vụ nổ, đã tính crit + ratio. */
  explosiveDamage: number;
  /** Id actor đã trúng — đạn xuyên/nảy không bao giờ trúng lại cùng một mục tiêu. */
  hitIds: string[];
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
  readonly pierceRemaining?: number;
  readonly ricochetRemaining?: number;
  readonly homing?: boolean;
  readonly explosiveRadiusTiles?: number;
  readonly explosiveDamage?: number;
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
   * Số slot đang chờ tái dùng. `size + recycledCount` **không bao giờ vượt
   * `capacity`** — test "1000 phát không rò rỉ" dựa vào bất biến này.
   */
  get recycledCount(): number {
    return this.recycled.length;
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
    bullet.pierceRemaining = Math.max(0, Math.floor(args.pierceRemaining ?? 0));
    bullet.ricochetRemaining = Math.max(0, Math.floor(args.ricochetRemaining ?? 0));
    bullet.homing = args.homing === true;
    bullet.explosiveRadiusTiles = Math.max(0, args.explosiveRadiusTiles ?? 0);
    bullet.explosiveDamage = Math.max(0, args.explosiveDamage ?? 0);
    bullet.hitIds.length = 0;

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

  /**
   * Thu hồi ngay viên đạn `id` (nếu có) và trả slot về `recycled`.
   *
   * Trả `true` khi viên đó đang sống và vừa bị bỏ, `false` khi không có id đó
   * trong pool — gọi lại lần hai trên cùng id luôn trả `false` (id không sống
   * lại). Sức chứa không đổi: thu hồi chỉ làm `size` giảm, slot được tái dùng
   * cho `spawn` kế tiếp.
   *
   * Không gọi trong lúc `update`/`consumeWhere` đang chạy — hai hàm đó tự quản
   * lý mảng. Gọi sau `update` (hoặc sau khi duyệt xong `active()`) là hợp lệ.
   */
  consume(id: number): boolean {
    for (let index = 0; index < this.live.length; index += 1) {
      const bullet = this.live[index];
      if (bullet === undefined || bullet.id !== id) continue;

      this.retireAt(index);
      return true;
    }
    return false;
  }

  /**
   * Thu hồi mọi viên thoả `predicate`, trả về **số viên** đã bỏ.
   *
   * Dùng cho collision resolution: một frame có thể có nhiều viên trúng, gom
   * lại rồi gọi một lần thay vì `consume` từng id (mỗi lần `consume` phải dò
   * và dồn mảng). Predicate chỉ được **đọc** bullet — đừng gọi `spawn` /
   * `consume` bên trong nó; muốn đổi pool thì gọi sau khi hàm này trả về.
   *
   * Thứ tự "cũ nhất trước" của `active()` được giữ nguyên cho các viên còn lại.
   */
  consumeWhere(predicate: (bullet: Readonly<Bullet>) => boolean): number {
    let writeIndex = 0;
    let removed = 0;

    for (let readIndex = 0; readIndex < this.live.length; readIndex += 1) {
      const bullet = this.live[readIndex];
      if (bullet === undefined) continue;

      if (predicate(bullet)) {
        this.recycled.push(bullet);
        removed += 1;
        continue;
      }

      this.live[writeIndex] = bullet;
      writeIndex += 1;
    }

    this.live.length = writeIndex;
    return removed;
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
      pierceRemaining: bullet.pierceRemaining,
      ricochetRemaining: bullet.ricochetRemaining,
      homing: bullet.homing,
      explosiveRadiusTiles: bullet.explosiveRadiusTiles,
      explosiveDamage: bullet.explosiveDamage,
      hitIds: bullet.hitIds.slice(),
    }));
  }

  /** Thu hồi toàn bộ đạn, ví dụ khi đổi phòng. */
  clear(): void {
    this.recycled.push(...this.live);
    this.live.length = 0;
  }

  /**
   * Bỏ phần tử `index` khỏi `live` và trả slot về `recycled`, dồn phần đuôi
   * sang trái để giữ thứ tự cũ → mới. `index` phải là index hợp lệ của `live`.
   */
  private retireAt(index: number): void {
    const bullet = this.live[index];
    if (bullet === undefined) return;

    for (let read = index + 1; read < this.live.length; read += 1) {
      const next = this.live[read];
      if (next !== undefined) this.live[read - 1] = next;
    }

    this.live.length -= 1;
    this.recycled.push(bullet);
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
      pierceRemaining: 0,
      ricochetRemaining: 0,
      homing: false,
      explosiveRadiusTiles: 0,
      explosiveDamage: 0,
      hitIds: [],
    };
  }
}
