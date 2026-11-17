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
import { _decorator, Color as CocosColor, Component, Sprite as CocosSprite } from 'cc';
import type { AnimationManifest, Direction } from '../core/art/manifest';
import { resolve } from '../core/art/manifest';
import { directionFromVector, loopDurationMs } from '../core/art/runtime';
import { AutoFire } from '../core/combat/auto-fire';
import { BulletPool } from '../core/combat/bullets';
import { HealthState } from '../core/combat/health';
import { firePlayerVolley } from '../core/combat/player-fire';
import { ShieldCharger } from '../core/combat/shield';
import { startKnockback, stepKnockback, type KnockbackState } from '../core/combat/knockback';
import type { Targetable } from '../core/combat/targeting';
import { DEFAULT_COMBAT } from '../core/config';
import { ROOM_EDGE_MARGIN_TILES } from '../core/enemies/behaviours';
import { ROOM_COLS, ROOM_ROWS, type LevelData } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { normalizeMoveInput, velocityFromInput } from '../core/movement/move-intent';
import { SeededRng } from '../core/rng';
import { computeDerivedStats, type DerivedStats } from '../core/skills/derived-stats';
import { SpriteAnimator } from './anim/sprite-animator';
import { KeyboardMove } from './keyboard-move';
import { playSfx } from './audio/sfx';
import type { FxPool } from './fx/effect-pool';
import { ACTOR_FEET_OFFSET_TILES, tileToWorld } from './level-view';

const { ccclass } = _decorator;

/** `cc` là module any: tên import chỉ dùng được ở vị trí value. */
type Color = InstanceType<typeof CocosColor>;
type Sprite = InstanceType<typeof CocosSprite>;

/** Tint khiên / lúc trúng đòn (đọc được trạng thái mà không cần icon riêng). */
const PLAYER_NO_TINT = new CocosColor(255, 255, 255, 255);
const PLAYER_SHIELD_TINT = new CocosColor(150, 225, 255, 255);
const PLAYER_HURT_TINT = new CocosColor(255, 150, 150, 255);
/** Thời gian giữ tint trúng đòn / chặn đòn, ms. */
const PLAYER_TINT_MS = 140;

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

export interface PlayerInitArgs {
  readonly manifest: AnimationManifest;
  /** Vị trí spawn trong hệ tile của `LevelData`, y hướng xuống. */
  readonly startAt: Vec2;
  /** RNG của run cho crit từng viên đạn (cùng nguồn với roll skill). */
  readonly rng?: SeededRng;
  /** Pool FX (khiên chặn). */
  readonly fx?: FxPool;
}

@ccclass('PlayerController')
export class PlayerController extends Component {
  private readonly health = new HealthState(DEFAULT_COMBAT);
  private autoFire = AutoFire.fromRate(DEFAULT_COMBAT.fireRatePerSecond);
  private readonly bulletPool = new BulletPool();
  /** Chỉ số hiện tại sau skill — mọi phép tính dùng object này, không đọc DEFAULT_COMBAT. */
  private stats: DerivedStats = computeDerivedStats(new Map<string, number>());
  private shield = new ShieldCharger(0, 0);
  private rng = SeededRng.fromSeed(1);
  private fx: FxPool | null = null;
  private sprite: Sprite | null = null;
  private tintUntilMs = 0;
  private tint: Color = PLAYER_NO_TINT;
  private readonly keyboard = new KeyboardMove();

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

  /** Chỉ số sau skill — CombatLoop đọc để áp crit/pierce/nổ/lifesteal/thorns. */
  get derivedStats(): DerivedStats {
    return this.stats;
  }

  get shieldCharges(): number {
    return this.shield.charges;
  }

  get shieldMaxCharges(): number {
    return this.shield.maxCharges;
  }

  /** Hồi máu (lifesteal, Second Wind, Vitality lúc nhặt). Trả số tim sau khi hồi. */
  heal(amount: number): number {
    return this.health.heal(amount);
  }

  /**
   * Áp loadout mới (nhặt skill hoặc debug `grantSkill`).
   *
   * `healNow` là hiệu ứng một lần của Vitality. Khiên được tạo lại đầy charge khi
   * số stack đổi; giữa các lần nhặt, `ShieldCharger` tự hồi theo 20 s.
   */
  applyStats(stats: DerivedStats, healNow = 0): void {
    this.stats = stats;
    this.health.configure(stats.maxHearts, stats.invulnerabilityMs);
    if (healNow > 0) this.health.heal(healNow);

    this.autoFire = AutoFire.fromRate(stats.fireRatePerSecond);
    const shield = stats.shield;
    if (shield === undefined) {
      this.shield = new ShieldCharger(0, 0);
    } else if (
      this.shield.maxCharges !== shield.charges ||
      this.shield.cooldownMs !== shield.cooldownMs
    ) {
      this.shield = new ShieldCharger(shield.charges, shield.cooldownMs);
    }
  }

  /** Gọi một lần sau khi `addComponent`, trước frame đầu tiên. */
  init(args: PlayerInitArgs): void {
    this.animator = this.getComponent(SpriteAnimator);
    this.sprite = this.getComponent(CocosSprite);
    if (args.rng !== undefined) this.rng = args.rng;
    this.fx = args.fx ?? null;
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

    this.shield.update(nowMs);

    const input2D = normalizeMoveInput(this.keyboard.keys);
    // `normalizeMoveInput` dùng quy ước màn hình: up = +y. Dữ liệu tile có y hướng
    // **xuống**, nên lật dấu y đúng một lần, ở đây.
    const moveIntent: Vec2 = { x: input2D.x, y: -input2D.y };
    const moving = moveIntent.x !== 0 || moveIntent.y !== 0;

    if (moving) {
      this.facing = directionFromVector(moveIntent, this.facing);
      const velocity = velocityFromInput(moveIntent, this.stats.moveSpeedTilesPerSecond);
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
    this.applyStateTint(nowMs);
  }

  /**
   * Ăn sát thương; i-frame và trần máu do `HealthState` quyết. Trả về `true` khi
   * đòn thật sự vào (dùng cho log/FX sau này).
   */
  applyDamage(nowMs: number, amount: number, source: Vec2 | null = null): boolean {
    // Khiên chặn trước i-frame: đòn bị chặn không tiêu i-frame và không knockback.
    if (this.shield.tryBlock(nowMs)) {
      this.tintUntilMs = nowMs + PLAYER_TINT_MS;
      this.tint = PLAYER_SHIELD_TINT;
      this.fx?.spawn('fx.shield', this.tilePosition, { lifetimeMs: 450 });
      playSfx('shield');
      return true;
    }

    const result = this.health.tryDamage(amount, nowMs);
    if (!result.applied) return false;

    this.hitUntilMs = nowMs + HIT_ANIM_MS;
    this.tintUntilMs = nowMs + PLAYER_TINT_MS;
    this.tint = PLAYER_HURT_TINT;
    this.playAnimation(`player.hit.${this.facing}`, this.facing);
    playSfx('player-hurt');

    if (result.dead) {
      this.playAnimation('player.dead');
      playSfx('game-over');
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
    this.keyboard.attach();
  }

  protected onDisable(): void {
    this.keyboard.detach();
  }

  private fireIfReady(nowMs: number, deltaMs: number, targets: readonly Targetable[]): void {
    const shot = this.autoFire.update({
      deltaMs,
      origin: this.tilePosition,
      targets,
      rangeTiles: DEFAULT_COMBAT.targetingRangeTiles,
    });
    if (shot === null) return;

    firePlayerVolley({
      pool: this.bulletPool,
      stats: this.stats,
      rng: this.rng,
      origin: shot.origin,
      direction: shot.direction,
      speedTilesPerSecond: DEFAULT_COMBAT.projectileSpeedTilesPerSecond,
      radiusTiles: BULLET_RADIUS_TILES,
      ttlMs: PLAYER_BULLET_TTL_MS,
    });

    this.attackUntilMs = nowMs + this.attackAnimMs;
    playSfx('shoot');
  }

  /**
   * Tint trạng thái: đỏ khi vừa trúng đòn, xanh khi còn charge khiên. Đây là
   * "shield icon/tint" của M4 — nhìn nhân vật biết khiên còn hay đã vỡ.
   */
  private applyStateTint(nowMs: number): void {
    const sprite = this.sprite;
    if (sprite === null) return;

    if (nowMs < this.tintUntilMs) {
      sprite.color = this.tint;
      return;
    }
    sprite.color = this.shield.charges > 0 ? PLAYER_SHIELD_TINT : PLAYER_NO_TINT;
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
    this.animator?.setPlaybackScale(
      moving
        ? this.stats.moveSpeedTilesPerSecond / DEFAULT_COMBAT.moveSpeedTilesPerSecond
        : 1,
    );
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
    this.node.setPosition(world.x, world.y - ACTOR_FEET_OFFSET_TILES, 0);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
