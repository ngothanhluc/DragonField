/**
 * Boss thật (GDD §5): art pack + máy trạng thái `core/boss/patterns.ts`.
 *
 * Adapter chỉ làm 4 việc:
 *
 * 1. Gọi `stepBoss` mỗi frame với state **phẳng** (vị trí là nguồn sự thật,
 *    đọc thẳng từ state chứ không nội suy event `move`).
 * 2. Đổi event thành hình: play animation, vòng telegraph, đạn thật trong cùng
 *    `BulletPool` của enemy, summon quái qua callback.
 * 3. Vẽ dấu hiệu phase: tint sprite + màu vòng telegraph + callback banner.
 *    Mỗi phase một màu/độ sáng khác nhau, để người chơi đọc được boss vừa đổi
 *    phase kể cả khi đang né.
 * 4. Nhận damage từ `CombatLoop` (đạn player) và báo chết qua `isDefeated`.
 *
 * Không có AI riêng, không hardcode pattern: mọi bước nằm trong core và đã có
 * test bắt buộc telegraph trước đòn.
 */
import {
  Color as CocosColor,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import { animationFor, type BossDef, type BossPhase } from '../core/boss/boss-defs';
import {
  bulletVelocity,
  initialBossState,
  isBossDefeated,
  stepBoss,
  TELEPORT_SNAP_SPEED_TILES_PER_SECOND,
  type BossEvent,
  type BossState,
} from '../core/boss/patterns';
import type { BulletPool } from '../core/combat/bullets';
import { accumulateDamage } from '../core/combat/integer-damage';
import { telegraphProgress } from '../core/combat/telegraph';
import type { EnemyRole } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import type { SeededRng } from '../core/rng';
import { SpriteAnimator } from './anim/sprite-animator';
import { playSfx } from './audio/sfx';
import { loadTelegraphFrames } from './enemy-view';
import type { FxPool } from './fx/effect-pool';
import { ACTOR_SCALE, BOSS_FEET_OFFSET_TILES, tileToWorld } from './level-view';

/** `cc` là module any: type phải suy ra từ import value. */
type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = Awaited<ReturnType<typeof loadTelegraphFrames>>[number];

/** Đạn boss sống 10 s — đủ bay hết đường chéo arena ở tốc độ chậm nhất. */
const BOSS_BULLET_TTL_MS = 10_000;
const RING_RECT_SIZE = 32;
const RING_FRAMES = 4;
const RING_MAX_OPACITY = 220;
const RING_MIN_OPACITY = 80;
/** Thời gian flash khi trúng đạn, ms. */
const HIT_FLASH_MS = 80;

/** Màu tint theo phase — dấu hiệu thứ nhất (rõ kể cả khi nhìn silhouette). */
const PHASE_TINT: Readonly<Record<BossPhase, Color>> = {
  1: new CocosColor(255, 255, 255, 255),
  2: new CocosColor(170, 220, 255, 255),
  3: new CocosColor(255, 160, 150, 255),
};
/** Màu vòng telegraph theo phase — dấu hiệu thứ hai, độc lập với tint thân. */
const PHASE_RING: Readonly<Record<BossPhase, Color>> = {
  1: new CocosColor(255, 226, 120, 255),
  2: new CocosColor(120, 220, 255, 255),
  3: new CocosColor(255, 120, 90, 255),
};
const HIT_TINT = new CocosColor(255, 250, 225, 255);

export interface BossViewOptions {
  readonly def: BossDef;
  /** Chỗ đứng đầu tiên, tile unit (thường từ `LevelData.bossStart`). */
  readonly start: Vec2;
  readonly actorLayer: Node;
  readonly bullets: BulletPool;
  readonly rng: SeededRng;
  /** Pool FX (chết boss). */
  readonly fx?: FxPool;
  /** Gọi khi boss đổi phase (bootstrap hiện banner). */
  readonly onPhase?: (phase: BossPhase) => void;
  /** Gọi khi pattern yêu cầu gọi quái; CombatLoop tự spawn EnemyView. */
  readonly onSummon?: (role: EnemyRole, count: number) => void;
}

export class BossView {
  private readonly def: BossDef;
  private readonly bullets: BulletPool;
  private readonly rng: SeededRng;
  private readonly onPhase: (phase: BossPhase) => void;
  private readonly onSummon: (role: EnemyRole, count: number) => void;
  private readonly fx: FxPool | null;
  private readonly node: Node;
  private readonly animator: SpriteAnimator;
  private readonly sprite: Sprite;
  private state: BossState;
  private defeated = false;
  /** Phần lẻ damage chưa đủ 1 máu (poison/crit/execute) — xem `integer-damage.ts`. */
  private damageCarry = 0;

  private hitFlashUntilMs = 0;
  private ring: Sprite | null = null;
  private readonly ringFrames: SpriteFrame[] = [];
  private readonly ringTint = new CocosColor(255, 255, 255, 0);
  private ringVisible = false;
  private telegraphStartedMs = Number.NEGATIVE_INFINITY;
  private telegraphDurationMs = 0;
  /** Đang trong cú charge (animation loop) hay vừa kết thúc để về idle. */
  private charging = false;
  private lastAnimKey = '';

  constructor(options: BossViewOptions) {
    this.def = options.def;
    this.bullets = options.bullets;
    this.rng = options.rng;
    this.onPhase = options.onPhase ?? (() => undefined);
    this.onSummon = options.onSummon ?? (() => undefined);
    this.fx = options.fx ?? null;
    this.state = initialBossState(options.def.id, options.start);

    const node = new CocosNode(`boss-${options.def.id}`);
    node.parent = options.actorLayer;

    const sprite: Sprite = node.addComponent(CocosSprite);
    // CUSTOM: animator đặt contentSize/anchor theo frame (samurai 96×48 ↔ 96×96).
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);
    sprite.color = PHASE_TINT[1];

    node.addComponent(SpriteAnimator);
    this.node = node;
    this.sprite = sprite;
    this.animator = node.getComponent(SpriteAnimator) as SpriteAnimator;
    this.animator.onFinished = () => {
      if (!this.isDefeated) this.playAnimation(animationFor(this.def.id, 'idle', this.state.facing));
    };
    this.syncPosition();
    this.playAnimation(animationFor(this.def.id, 'idle', this.state.facing));

    void this.createRing().catch(() => {
      // Boss vẫn chạy nếu FX lỗi — telegraph sẽ chỉ thiếu vòng.
    });
  }

  get id(): string {
    return this.def.id;
  }

  get position(): Vec2 {
    return this.state.position;
  }

  /** State phẳng hiện tại — `summon.ts` cần để đặt quái quanh boss. */
  get bossState(): BossState {
    return this.state;
  }

  get health(): number {
    return this.state.health;
  }

  get displayName(): string {
    return this.def.displayName;
  }

  get maxHealth(): number {
    return this.def.maxHealth;
  }

  get phase(): BossPhase {
    return this.state.phase;
  }

  get hitboxRadiusTiles(): number {
    return this.def.hitboxRadiusTiles;
  }

  get isDefeated(): boolean {
    return isBossDefeated(this.state) || this.defeated;
  }

  /** Đang lao ngang (Samurai charge). Dùng để áp sát thương thân boss. */
  get isCharging(): boolean {
    return this.state.chargeDirection !== null;
  }

  /** Một frame pattern. Trả event cho CombatLoop xử lý summon/đạn (đạn đã spawn ở đây). */
  step(nowMs: number, deltaMs: number, player: Vec2): readonly BossEvent[] {
    if (this.isDefeated) return [];

    const result = stepBoss({
      state: this.state,
      nowMs,
      deltaMs,
      player,
      rng: this.rng,
    });
    this.state = result.state;

    for (const event of result.events) {
      switch (event.kind) {
        case 'play-animation':
          this.playAnimation(event.animation);
          break;
        case 'telegraph':
          this.telegraphStartedMs = nowMs;
          this.telegraphDurationMs = event.durationMs;
          break;
        case 'shoot':
          for (const verb of event.bullets) {
            this.bullets.spawn({
              position: verb.from,
              velocity: bulletVelocity(verb),
              radiusTiles: verb.radiusTiles,
              damage: verb.damage,
              owner: 'enemy',
              ttlMs: BOSS_BULLET_TTL_MS,
            });
          }
          break;
        case 'summon':
          this.onSummon(event.role, event.count);
          break;
        case 'phase-change':
          this.applyPhase(event.phase);
          this.onPhase(event.phase);
          break;
        case 'move':
          // Vị trí thật nằm trong `state.position`; event chỉ để debug/animation.
          if (event.speedTilesPerSecond >= TELEPORT_SNAP_SPEED_TILES_PER_SECOND) {
            this.playAnimation(animationFor(this.def.id, 'teleport', this.state.facing));
          } else {
            this.playAnimation(animationFor(this.def.id, 'walk', this.state.facing));
          }
          break;
      }
    }

    this.syncPosition();
    this.applyTint(nowMs);
    this.updateRing(nowMs);

    if (this.state.chargeDirection !== null) {
      this.charging = true;
    } else if (this.charging) {
      this.charging = false;
      this.playAnimation(animationFor(this.def.id, 'idle', this.state.facing));
    }
    return result.events;
  }

  /** Trừ máu qua đường chuẩn. Không knockback boss; flash + hit animation ngắn. */
  takeDamage(amount: number, nowMs: number): void {
    if (this.isDefeated || !(amount > 0)) return;

    // Máu boss luôn nguyên: damage lẻ (poison, crit, execute) dồn sang frame sau.
    const step = accumulateDamage(this.damageCarry, amount);
    this.damageCarry = step.carry;
    if (step.whole <= 0) return;

    this.state = {
      ...this.state,
      health: Math.max(0, this.state.health - step.whole),
    };
    this.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
    playSfx('enemy-hit');

    if (this.state.health <= 0) {
      this.defeated = true;
      this.damageCarry = 0;
      this.playAnimation(animationFor(this.def.id, 'hit', this.state.facing));
      this.animator.stop();
      this.hideRing();
      // Boss chết = explosion lớn + smoke (GDD: chết là FX, không có frame chết).
      this.fx?.spawn('fx.explosion', this.state.position, { drawUnits: 5, lifetimeMs: 1200 });
      this.fx?.spawn('fx.smoke', this.state.position, { drawUnits: 4, lifetimeMs: 1100 });
      playSfx('explosion');
      playSfx('enemy-death');
      this.node.active = false;
    }
  }

  destroy(): void {
    this.hideRing();
    if (this.node.isValid) this.node.destroy();
  }

  // -------------------------------------------------------------------------
  // Hình
  // -------------------------------------------------------------------------

  private applyPhase(phase: BossPhase): void {
    this.applyTint(Number.POSITIVE_INFINITY, phase);
    this.hideRing();
    this.telegraphStartedMs = Number.NEGATIVE_INFINITY;
    // Phase mới bắt đầu bằng banner; cho boss đứng idle một nhịp đọc được.
    this.playAnimation(animationFor(this.def.id, 'idle', this.state.facing));
  }

  private applyTint(nowMs: number, phaseOverride?: BossPhase): void {
    const phase = phaseOverride ?? this.state.phase;
    const flashing = nowMs < this.hitFlashUntilMs;
    this.sprite.color = flashing ? HIT_TINT : PHASE_TINT[phase];
  }

  private playAnimation(key: string): void {
    // Cùng clip mà chưa chạy xong thì không restart (step boss phát `move` mỗi frame).
    if (key === this.lastAnimKey && !this.animator.isFinished) return;
    this.lastAnimKey = key;
    // Samurai tách sheet L/R; `animationFor` đã ghép hậu tố, `play` không cần direction.
    this.animator.play(key);
  }

  private syncPosition(): void {
    const world = tileToWorld(this.state.position);
    this.node.setPosition(world.x, world.y - BOSS_FEET_OFFSET_TILES, 0);
  }

  private async createRing(): Promise<void> {
    const frames = await loadTelegraphFrames();
    if (!this.node.isValid) return;
    this.ringFrames.push(...frames);

    const node = new CocosNode('boss-telegraph');
    node.parent = this.node;
    node.setPosition(0, -8, 0);

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    const transform = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(RING_RECT_SIZE, RING_RECT_SIZE);

    // Vòng 32 px dưới parent scale 1/16 = 2 tile; muốn đường kính ~2.6× hitbox.
    const diameterTiles = this.def.hitboxRadiusTiles * 2.6;
    const scale = diameterTiles / 2;
    node.setScale(scale, scale, 1);
    node.active = false;
    this.ring = sprite;
  }

  private updateRing(nowMs: number): void {
    const ring = this.ring;
    if (ring === null) return;
    if (this.telegraphStartedMs === Number.NEGATIVE_INFINITY) {
      this.hideRing();
      return;
    }

    const elapsed = nowMs - this.telegraphStartedMs;
    if (elapsed > this.telegraphDurationMs) {
      this.hideRing();
      return;
    }

    const progress = telegraphProgress(
      this.telegraphStartedMs,
      nowMs,
      'boss',
    );
    const frame =
      this.ringFrames[Math.min(RING_FRAMES - 1, Math.floor(progress * RING_FRAMES))];
    if (frame !== undefined && ring.spriteFrame !== frame) ring.spriteFrame = frame;

    const color = PHASE_RING[this.state.phase];
    this.ringTint.r = color.r;
    this.ringTint.g = color.g;
    this.ringTint.b = color.b;
    this.ringTint.a = Math.round(RING_MIN_OPACITY + (RING_MAX_OPACITY - RING_MIN_OPACITY) * progress);
    ring.color = this.ringTint;

    if (!this.ringVisible) {
      ring.node.active = true;
      this.ringVisible = true;
    }
  }

  private hideRing(): void {
    if (!this.ringVisible) return;
    const ring = this.ring;
    if (ring !== null) ring.node.active = false;
    this.ringVisible = false;
  }
}
