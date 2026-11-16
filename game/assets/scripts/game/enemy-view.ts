/**
 * Một node cho một `EnemyState`.
 *
 * Chia việc đúng như `core/enemies/behaviours.ts` yêu cầu: core là **hàm thuần**
 * (`decideAction` không sửa state), file này là **adapter** — ghi action trở lại
 * state, áp chuyển động, chọn animation, đổi tint. Nhờ vậy toàn bộ AI vẫn test được
 * bằng vitest mà không cần engine.
 *
 * Monster của pack chỉ có **một sheet walk 4 hướng**, không có attack/hurt/death
 * (GDD §4) nên biểu đạt đòn đánh nằm ở scale pulse + tint; FX nổ khi chết để sau.
 */
import { _decorator, Color as CocosColor, Component, Sprite as CocosSprite } from 'cc';
import type { Direction } from '../core/art/manifest';
import { directionFromVector } from '../core/art/runtime';
import { startKnockback, stepKnockback, type KnockbackState } from '../core/combat/knockback';
import { DEFAULT_COMBAT } from '../core/config';
import {
  CHASER_CONTACT_RANGE_TILES,
  ROOM_EDGE_MARGIN_TILES,
  TANK_CHARGE_SPEED_TILES_PER_SECOND,
  contactDamageFor,
  decideAction,
  speedFor,
} from '../core/enemies/behaviours';
import type { EnemyAction, EnemyState } from '../core/enemies/behaviours';
import type { LevelData } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { SpriteAnimator } from './anim/sprite-animator';
import { tileToWorld } from './level-view';

const { ccclass } = _decorator;

/** `cc` là module any trong repo: type phải suy ra từ import value (xem `texture-cache.ts`). */
type Color = InstanceType<typeof CocosColor>;
type Sprite = InstanceType<typeof CocosSprite>;

/** Màu gốc của sprite (không tint); đặt lại sau mỗi lần telegraph. */
const NO_TINT = new CocosColor(255, 255, 255, 255);
/** Tint lúc telegraph — đọc được "con này sắp ra đòn" mà không cần art riêng. */
const TELEGRAPH_TINT = new CocosColor(255, 120, 120, 255);

/** Biên độ pulse lúc telegraph (tỉ lệ so với scale gốc). */
const TELEGRAPH_PULSE = 0.12;
/** Tốc độ pulse, radian/giây. */
const TELEGRAPH_PULSE_SPEED = 14;

export interface EnemyViewInitArgs {
  readonly state: EnemyState;
  /** Tên actor trong manifest, không có gạch nối: `bluebat`, `spiderred`, `eye`… */
  readonly monster: string;
  readonly level: LevelData;
  /** Scale node đã tính từ frame (xem `actorScale` trong `level-view.ts`). */
  readonly baseScale: number;
}

@ccclass('EnemyView')
export class EnemyView extends Component {
  private state: EnemyState | null = null;
  private monster = '';
  private level: LevelData | null = null;
  private animator: SpriteAnimator | null = null;
  private sprite: Sprite | null = null;
  private baseScale = 1;
  private dead = false;
  private animKey = '';
  private animDirection: Direction = 'down';
  /** Cú đẩy nhỏ sau khi trúng đạn; `null` = không bị đẩy. */
  private knockback: KnockbackState | null = null;

  get id(): string {
    return this.state?.id ?? '';
  }

  /** Vị trí hệ tile của `LevelData` (y hướng xuống) — cùng hệ với player và đạn. */
  get position(): Vec2 {
    return this.state?.position ?? { x: 0, y: 0 };
  }

  get isDead(): boolean {
    return this.dead;
  }

  /** Chaser/tank gây sát thương khi chạm; caster bắn đạn nên không tính contact. */
  get melee(): boolean {
    const state = this.state;
    return state !== null && (state.role === 'chaser' || state.role === 'tank');
  }

  get contactDamage(): number {
    const state = this.state;
    return state === null ? 0 : contactDamageFor(state.role, state.elite);
  }

  get contactRangeTiles(): number {
    return CHASER_CONTACT_RANGE_TILES;
  }

  init(args: EnemyViewInitArgs): void {
    this.state = args.state;
    this.monster = args.monster;
    this.level = args.level;
    this.baseScale = args.baseScale;
    this.animator = this.getComponent(SpriteAnimator);
    const sprite: Sprite | null = this.getComponent(CocosSprite);
    this.sprite = sprite;

    this.syncNodePosition();
    this.applyScale(1);
    this.playWalk('down', true);
  }

  /** Một frame: hỏi core action kế tiếp, ghi lại, rồi áp chuyển động + hình. */
  step(nowMs: number, deltaMs: number, player: Vec2): void {
    const state = this.state;
    const level = this.level;
    if (state === null || level === null || this.dead) return;

    const previous = state.action;
    const next = decideAction({ state, player, nowMs, level });

    if (next.kind !== previous.kind) {
      state.actionStartedMs = nowMs;
    }
    state.action = next;

    if (next.kind === 'dead') {
      this.die();
      return;
    }

    this.advance(next, deltaMs);
    this.applyKnockback(deltaMs);
    this.syncNodePosition();
    this.applyVisual(next, nowMs, player);
  }

  /** Trừ máu; hết máu thì biến mất (TODO(fx): explosion + fade, xem GDD §4). */
  takeDamage(amount: number, source: Vec2 | null = null): void {
    const state = this.state;
    if (state === null || this.dead) return;

    state.health = Math.max(0, state.health - amount);
    if (state.health <= 0) {
      this.die();
      return;
    }

    if (source !== null) {
      this.knockback = startKnockback(state.position, source, {
        distanceTiles: DEFAULT_COMBAT.enemyKnockbackDistanceTiles,
        durationMs: DEFAULT_COMBAT.enemyKnockbackDurationMs,
      });
    }
  }

  private die(): void {
    const state = this.state;
    if (state !== null) {
      state.health = 0;
      state.action = { kind: 'dead' };
    }
    this.dead = true;
    this.animator?.stop();
    // TODO(fx): thay `active = false` bằng FX explosion + fade out (art đã stage ở
    // `resources/art/fx/explosion`). Chết "biến mất" là tạm để không chặn milestone.
    this.node.active = false;
  }

  private advance(action: EnemyAction, deltaMs: number): void {
    const state = this.state;
    const level = this.level;
    if (state === null || level === null) return;

    const seconds = deltaMs / 1000;
    let next: Vec2 = state.position;

    if (action.kind === 'charge') {
      const step = TANK_CHARGE_SPEED_TILES_PER_SECOND * seconds;
      next = {
        x: state.position.x + action.direction.x * step,
        y: state.position.y + action.direction.y * step,
      };
    } else if (action.kind === 'walk') {
      const dx = action.target.x - state.position.x;
      const dy = action.target.y - state.position.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        // Không vượt quá target trong một frame (frame dài ≠ teleport).
        const factor = Math.min(1, (speedFor(state.role, state.elite) * seconds) / length);
        next = {
          x: state.position.x + dx * factor,
          y: state.position.y + dy * factor,
        };
      }
    }

    state.position = {
      x: clamp(next.x, ROOM_EDGE_MARGIN_TILES, ROOM_COLS - ROOM_EDGE_MARGIN_TILES),
      y: clamp(next.y, ROOM_EDGE_MARGIN_TILES, ROOM_ROWS - ROOM_EDGE_MARGIN_TILES),
    };
  }

  /** Cú đẩy nhỏ sau đòn đạn; cùng bộ dựng với player nhưng quãng ngắn hơn. */
  private applyKnockback(deltaMs: number): void {
    const state = this.state;
    const level = this.level;
    if (state === null || level === null || this.knockback === null) return;

    const result = stepKnockback(
      state.position,
      this.knockback,
      deltaMs,
      level,
      ROOM_EDGE_MARGIN_TILES,
    );
    state.position = result.position;
    this.knockback = result.state;
  }

  private applyVisual(action: EnemyAction, nowMs: number, player: Vec2): void {
    const state = this.state;
    if (state === null) return;

    const facing = directionFromVector(this.facingVector(action, player), this.animDirection);
    this.playWalk(facing);

    if (action.kind === 'telegraph') {
      const elapsedMs = Math.max(0, nowMs - action.sinceMs);
      const pulse = 1 + TELEGRAPH_PULSE * Math.sin((elapsedMs / 1000) * TELEGRAPH_PULSE_SPEED);
      this.applyScale(pulse);
      this.applyTint(TELEGRAPH_TINT);
      return;
    }

    this.applyScale(1);
    this.applyTint(NO_TINT);
  }

  /**
   * Hướng nhìn: lúc đi/lao thì theo hướng di chuyển, lúc đứng/telegraph thì nhìn
   * về player. Đứng yên và trùng vị trí player ⇒ `directionFromVector` trả fallback,
   * nên sprite không nhảy hướng.
   */
  private facingVector(action: EnemyAction, player: Vec2): Vec2 {
    const position = this.position;

    if (action.kind === 'charge') return action.direction;
    if (action.kind === 'walk') {
      return {
        x: action.target.x - position.x,
        y: action.target.y - position.y,
      };
    }
    return { x: player.x - position.x, y: player.y - position.y };
  }

  private playWalk(direction: Direction, force = false): void {
    if (!force && this.animKey === `${this.monster}.walk` && this.animDirection === direction) {
      return;
    }
    this.animKey = `${this.monster}.walk`;
    this.animDirection = direction;
    this.animator?.play(`${this.monster}.walk.${direction}`, direction);
  }

  private applyScale(pulse: number): void {
    const scale = this.baseScale * pulse;
    this.node.setScale(scale, scale, 1);
  }

  private applyTint(color: Color): void {
    const sprite = this.sprite;
    if (sprite === null) return;
    // `Sprite.color` là màu nhân vào texture; pack dùng 53 màu palette nên tint nhẹ
    // tay là đủ đọc, không phá silhouette.
    sprite.color = color;
  }

  private syncNodePosition(): void {
    const world = tileToWorld(this.position);
    this.node.setPosition(world.x, world.y, 0);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
