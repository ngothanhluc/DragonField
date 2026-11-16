/**
 * Player: đọc WASD, di chuyển, tự bắn, ăn sát thương, lái animation.
 *
 * Adapter mỏng quanh `core/`:
 * - di chuyển: `normalizeMoveInput` + `velocityFromInput` (core quyết vector, file này áp vào toạ độ);
 * - bắn: `AutoFire` + `BulletPool` (core quyết khi nào bắn và bắn vào đâu);
 * - máu: `HealthState` (core quyết i-frame và trần tim).
 *
 * Không tự chạy trong `update()`: bootstrap gọi `step()` để thứ tự một frame là tất
 * định (player → enemy → đạn → va chạm), giống `core/sim/run-simulation.ts`.
 */
import { _decorator, Component, Input, KeyCode, input } from 'cc';
import type { AnimationManifest, Direction } from '../core/art/manifest';
import { resolve } from '../core/art/manifest';
import { directionFromVector, loopDurationMs } from '../core/art/runtime';
import { AutoFire } from '../core/combat/auto-fire';
import { BulletPool } from '../core/combat/bullets';
import { HealthState } from '../core/combat/health';
import { startKnockback, stepKnockback, type KnockbackState } from '../core/combat/knockback';
import type { Targetable } from '../core/combat/targeting';
import { DEFAULT_COMBAT } from '../core/config';
import { ROOM_EDGE_MARGIN_TILES } from '../core/enemies/behaviours';
import { ROOM_COLS, ROOM_ROWS, type LevelData } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { normalizeMoveInput, velocityFromInput } from '../core/movement/move-intent';
import { SpriteAnimator } from './anim/sprite-animator';
import { tileToWorld } from './level-view';

const { ccclass } = _decorator;

/**
 * Hình dạng tối thiểu của event bàn phím mà file này dùng. `cc` là module any trong repo
 * (xem `types/cc.d.ts`) nên `EventKeyboard` của engine không dùng được ở vị trí type;
 * khai báo đúng phần mình đọc (`keyCode`) là đủ và không che lỗi thật.
 */
interface KeyEvent {
  readonly keyCode: number;
}

/** Bán kính đạn player, tile — cùng quy ước với `run-simulation.ts`. */
const BULLET_RADIUS_TILES = 0.15;

/**
 * Đạn phải sống đủ lâu để bay hết tầm auto-aim, nếu không "tầm bắn 8 tile" trong
 * `config/tuning.json` chỉ là số ảo trên giấy. Cùng công thức với sim.
 */
const PLAYER_BULLET_TTL_MS = Math.max(
  1200,
  Math.ceil(
    (DEFAULT_COMBAT.targetingRangeTiles / DEFAULT_COMBAT.projectileSpeedTilesPerSecond) *
      1000 *
      1.5,
  ),
);

/** Thời gian giữ frame `player.hit.*` sau khi trúng đòn (GDD §3: đọc được là mình vừa ăn đòn). */
const HIT_ANIM_MS = 150;

/** Hướng mặc định khi chưa có input nào. */
const START_FACING: Direction = 'down';

/** Trạng thái 4 phím, mutable — `MoveInput` của core là readonly nên giữ bản riêng. */
interface KeyState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface PlayerInitArgs {
  readonly manifest: AnimationManifest;
  /** Vị trí spawn trong hệ tile của `LevelData`, y hướng xuống. */
  readonly startAt: Vec2;
}

@ccclass('PlayerController')
export class PlayerController extends Component {
  private readonly health = new HealthState(DEFAULT_COMBAT);
  private readonly autoFire = AutoFire.fromRate(DEFAULT_COMBAT.fireRatePerSecond);
  private readonly bulletPool = new BulletPool();
  private readonly keys: KeyState = {
    up: false,
    down: false,
    left: false,
    right: false,
  };

  /** Vị trí hiện tại hệ **tile** của `LevelData` (y hướng xuống), không phải world. */
  private tilePosition: Vec2 = { x: 0, y: 0 };
  private facing: Direction = START_FACING;
  private animator: SpriteAnimator | null = null;
  private animKey = '';
  private animDirection: Direction | null = null;
  private attackUntilMs = 0;
  private hitUntilMs = 0;
  private attackAnimMs = 0;
  /** Cú đẩy đang chạy sau đòn trúng; `null` = không bị đẩy. */
  private knockback: KnockbackState | null = null;

  /** Đạn player đang bay — `bullet-view` đọc pool này mỗi frame. */
  get bullets(): BulletPool {
    return this.bulletPool;
  }

  /** Vị trí trong hệ tile của `LevelData` (y hướng xuống), dùng chung với enemy/đạn. */
  get position(): Vec2 {
    return this.tilePosition;
  }

  get hearts(): number {
    return this.health.current;
  }

  get maxHearts(): number {
    return this.health.max;
  }

  get isDead(): boolean {
    return this.health.isDead;
  }

  /** Gọi một lần sau khi `addComponent`, trước frame đầu tiên. */
  init(args: PlayerInitArgs): void {
    this.animator = this.getComponent(SpriteAnimator);
    this.attackAnimMs = Math.max(1, loopDurationMs(resolve(args.manifest, 'player.attack.down')));

    this.tilePosition = { x: args.startAt.x, y: args.startAt.y };
    this.facing = START_FACING;
    this.animKey = '';
    this.animDirection = null;
    this.syncNodePosition();
    this.playAnimation(`player.idle.${START_FACING}`, START_FACING);
  }

  /** Đặt lại vị trí khi sang phòng mới; không đụng máu (máu theo cả run). */
  teleport(at: Vec2): void {
    this.tilePosition = { x: at.x, y: at.y };
    // Sang phòng khác thì cú đẩy của phòng cũ không được dính theo.
    this.knockback = null;
    this.syncNodePosition();
  }

  /**
   * Một frame của player. `targets` do bootstrap gom từ các `EnemyView` còn sống.
   * `nowMs` là đồng hồ của run (không phải `Date.now`) để i-frame và animation
   * cùng một dòng thời gian, và để test/tái hiện được.
   */
  step(
    nowMs: number,
    deltaMs: number,
    targets: readonly Targetable[],
    level: LevelData,
  ): void {
    if (this.health.isDead) return;

    const input2D = normalizeMoveInput(this.keys);
    // `normalizeMoveInput` dùng quy ước màn hình: up = +y. Dữ liệu tile có y hướng
    // **xuống**, nên lật dấu y đúng một lần, ở đây.
    const moveIntent: Vec2 = { x: input2D.x, y: -input2D.y };
    const moving = moveIntent.x !== 0 || moveIntent.y !== 0;

    if (moving) {
      this.facing = directionFromVector(moveIntent, this.facing);
      const velocity = velocityFromInput(moveIntent, DEFAULT_COMBAT.moveSpeedTilesPerSecond);
      const seconds = deltaMs / 1000;
      this.tilePosition = {
        x: clamp(
          this.tilePosition.x + velocity.x * seconds,
          ROOM_EDGE_MARGIN_TILES,
          ROOM_COLS - ROOM_EDGE_MARGIN_TILES,
        ),
        y: clamp(
          this.tilePosition.y + velocity.y * seconds,
          ROOM_EDGE_MARGIN_TILES,
          ROOM_ROWS - ROOM_EDGE_MARGIN_TILES,
        ),
      };
      this.syncNodePosition();
    }

    this.applyKnockback(deltaMs, level);
    this.fireIfReady(nowMs, deltaMs, targets);
    this.playCurrentAnimation(nowMs, moving);
  }

  /**
   * Ăn sát thương; i-frame và trần máu do `HealthState` quyết. Trả về `true` khi
   * đòn thật sự vào (dùng cho log/FX sau này).
   */
  applyDamage(nowMs: number, amount: number, source: Vec2 | null = null): boolean {
    const result = this.health.tryDamage(amount, nowMs);
    if (!result.applied) return false;

    this.hitUntilMs = nowMs + HIT_ANIM_MS;
    this.playAnimation(`player.hit.${this.facing}`, this.facing);

    if (result.dead) {
      this.playAnimation('player.dead');
      return true;
    }

    if (source !== null) {
      this.knockback = startKnockback(this.tilePosition, source, {
        distanceTiles: DEFAULT_COMBAT.playerKnockbackDistanceTiles,
        durationMs: DEFAULT_COMBAT.playerKnockbackDurationMs,
      });
    }
    return true;
  }

  /** Cú đẩy đi sau input, nên không ai "giữ phím" mà đứng yên được khi trúng đòn. */
  private applyKnockback(deltaMs: number, level: LevelData): void {
    const state = this.knockback;
    if (state === null) return;

    const result = stepKnockback(
      this.tilePosition,
      state,
      deltaMs,
      level,
      ROOM_EDGE_MARGIN_TILES,
    );
    this.tilePosition = result.position;
    this.knockback = result.state;
    this.syncNodePosition();
  }

  protected onEnable(): void {
    input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
  }

  protected onDisable(): void {
    input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
    input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
  }

  private fireIfReady(nowMs: number, deltaMs: number, targets: readonly Targetable[]): void {
    const shot = this.autoFire.update({
      deltaMs,
      origin: this.tilePosition,
      targets,
      rangeTiles: DEFAULT_COMBAT.targetingRangeTiles,
    });
    if (shot === null) return;

    const speed = DEFAULT_COMBAT.projectileSpeedTilesPerSecond;
    this.bulletPool.spawn({
      position: shot.origin,
      velocity: { x: shot.direction.x * speed, y: shot.direction.y * speed },
      radiusTiles: BULLET_RADIUS_TILES,
      damage: DEFAULT_COMBAT.damage,
      owner: 'player',
      ttlMs: PLAYER_BULLET_TTL_MS,
    });

    this.attackUntilMs = nowMs + this.attackAnimMs;
  }

  private playCurrentAnimation(nowMs: number, moving: boolean): void {
    if (this.health.isDead) return;

    if (nowMs < this.hitUntilMs) {
      this.playAnimation(`player.hit.${this.facing}`, this.facing);
      return;
    }
    if (nowMs < this.attackUntilMs) {
      this.playAnimation(`player.attack.${this.facing}`, this.facing);
      return;
    }
    const clip = moving ? 'walk' : 'idle';
    this.playAnimation(`player.${clip}.${this.facing}`, this.facing);
  }

  /** Chỉ `play` khi clip hoặc hướng đổi — `play` reset thời gian nên gọi mỗi frame là đứng hình. */
  private playAnimation(key: string, direction?: Direction): void {
    const sameDirection = direction === undefined || this.animDirection === direction;
    if (this.animKey === key && sameDirection) return;

    this.animKey = key;
    this.animDirection = direction ?? this.animDirection;
    this.animator?.play(key, direction);
  }

  private syncNodePosition(): void {
    const world = tileToWorld(this.tilePosition);
    this.node.setPosition(world.x, world.y, 0);
  }

  private onKeyDown(event: KeyEvent): void {
    this.setKey(event.keyCode, true);
  }

  private onKeyUp(event: KeyEvent): void {
    this.setKey(event.keyCode, false);
  }

  private setKey(keyCode: number, pressed: boolean): void {
    switch (keyCode) {
      case KeyCode.KEY_W:
      case KeyCode.ARROW_UP:
        this.keys.up = pressed;
        break;
      case KeyCode.KEY_S:
      case KeyCode.ARROW_DOWN:
        this.keys.down = pressed;
        break;
      case KeyCode.KEY_A:
      case KeyCode.ARROW_LEFT:
        this.keys.left = pressed;
        break;
      case KeyCode.KEY_D:
      case KeyCode.ARROW_RIGHT:
        this.keys.right = pressed;
        break;
      default:
        break;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
