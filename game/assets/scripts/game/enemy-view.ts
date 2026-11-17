/**
 * Một node cho một `EnemyState`.
 *
 * Chia việc đúng như `core/enemies/behaviours.ts` yêu cầu: core là **hàm thuần**
 * (`decideAction` không sửa state), file này là **adapter** — ghi action trở lại
 * state, áp chuyển động, chọn animation, đổi tint, vẽ telegraph.
 *
 * Monster của pack chỉ có **một sheet walk 4 hướng**, không có attack/hurt/death
 * (GDD §4) nên biểu đạt đòn đánh nằm ở **silhouette (art/scale) + vòng telegraph
 * + tint**:
 *
 * | Vai trò | Silhouette | Telegraph | Elite thêm |
 * |---|---|---|---|
 * | chaser | dơi nhỏ, bay sát | vòng **vàng** (chỉ elite mới có) | lao ngắn |
 * | caster | mắt bay lơ lửng | vòng **cyan**, nhỏ | loạt 3 viên |
 * | tank | gấu to, chậm | vòng **cam**, to | lao 2 lần |
 *
 * Vòng telegraph dùng `resources/art/fx/telegraph-ring` (32×32 × 4 frame). Mỗi
 * enemy có **một** node vòng tạo lúc init và bật/tắt theo action — không tạo node
 * mỗi lần ra đòn.
 *
 * `step()` trả về `EnemyStepResult`: adapter chiến đấu cần biết đòn vừa ra
 * (`shot`/`charge`) và **đoạn đường đi khi lao** để xét hitbox bằng quét, thay vì
 * đoán qua vị trí cuối frame.
 */
import {
  _decorator,
  Color as CocosColor,
  Component,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  warn,
} from 'cc';
import type { Direction } from '../core/art/manifest';
import { directionFromVector } from '../core/art/runtime';
import { startKnockback, stepKnockback, type KnockbackState } from '../core/combat/knockback';
import { telegraphProgress, type TelegraphKind } from '../core/combat/telegraph';
import { DEFAULT_COMBAT } from '../core/config';
import {
  CHASER_CONTACT_RANGE_TILES,
  ROOM_EDGE_MARGIN_TILES,
  attackReleased,
  contactDamageFor,
  decideAction,
  speedFor,
  staggerAction,
  visualScaleFor,
} from '../core/enemies/behaviours';
import type { EnemyAction, EnemyState } from '../core/enemies/behaviours';
import { nextActionStartedMs } from '../core/enemies/attack-cycle';
import { eliteScale } from '../core/enemies/elite';
import type { EnemyRole, LevelData } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { SpriteAnimator } from './anim/sprite-animator';
import { loadTexture } from './assets/texture-cache';
import { sliceFrame, tileToWorld } from './level-view';
import type { TileRect } from './level-view';

const { ccclass } = _decorator;

/** `cc` là module any trong repo: type phải suy ra từ import value (xem `texture-cache.ts`). */
type Color = InstanceType<typeof CocosColor>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;

/** Vai trò nào có telegraph — `telegraphProgress` cần union hẹp. */
type RoleTelegraphKind = Exclude<TelegraphKind, 'boss'>;

/** Bán kính hitbox mặc định, tile — cùng quy ước với `run-simulation.ts`. */
export const DEFAULT_ENEMY_RADIUS_TILES = 0.4;

/**
 * Vòng telegraph: sheet 128×32 px = 4 frame 32×32 (import-checklist §6.2).
 *
 * Không đi qua `animations.json`: manifest chỉ chứa animation actor, chưa có
 * schema cho FX (cùng lý do `bullet-view.ts` khai báo sheet trực tiếp).
 * TODO(fx): thêm key FX vào manifest rồi bỏ hằng sheet này.
 */
export const TELEGRAPH_RING_SHEET = 'resources/art/fx/telegraph-ring/SpriteSheetWhite.png';
const RING_RECT: TileRect = { x: 0, y: 0, width: 32, height: 32 };
const RING_FRAMES = 4;

/** Frame cắt một lần cho cả scene — mỗi enemy chỉ tham chiếu, không tự cắt lại. */
let ringFramesPromise: Promise<SpriteFrame[]> | null = null;

function loadRingFrames(): Promise<SpriteFrame[]> {
  if (ringFramesPromise !== null) return ringFramesPromise;

  const task = loadTexture(TELEGRAPH_RING_SHEET).then((texture) =>
    Array.from({ length: RING_FRAMES }, (_, index) =>
      sliceFrame(texture, { ...RING_RECT, x: index * RING_RECT.width }),
    ),
  );
  ringFramesPromise = task;
  task.catch(() => {
    if (ringFramesPromise === task) ringFramesPromise = null;
  });
  return task;
}

/** Màu gốc (không tint) và màu theo vai trò/thể loại. */
const NO_TINT = new CocosColor(255, 255, 255, 255);
const HIT_TINT = new CocosColor(255, 250, 225, 255);
const ELITE_TINT = new CocosColor(206, 174, 255, 255);
const TELEGRAPH_TINT: Readonly<Record<RoleTelegraphKind, Color>> = {
  chaser: new CocosColor(255, 226, 120, 255),
  caster: new CocosColor(130, 220, 255, 255),
  tank: new CocosColor(255, 150, 80, 255),
};

/** Đường kính vòng telegraph theo vai trò, tile (nhìn là phân biệt được). */
const RING_DIAMETER_TILES: Readonly<Record<RoleTelegraphKind, number>> = {
  chaser: 2.4,
  caster: 2.8,
  tank: 4,
};

/** Ring nằm dưới chân: lệch xuống theo texture px của parent (parent scale 1/16). */
const RING_OFFSET_Y_PX = -7;

/** Biên độ pulse lúc telegraph (tỉ lệ so với scale gốc). */
const TELEGRAPH_PULSE = 0.12;
/** Tốc độ pulse, radian/giây. */
const TELEGRAPH_PULSE_SPEED = 14;
/** Độ đậm vòng telegraph khi đã chạy hết. */
const RING_MAX_OPACITY = 220;
/** Độ đậm tối thiểu để telegraph thấy được ngay từ frame đầu. */
const RING_MIN_OPACITY = 90;

/** Thời gian flash tint sau khi trúng đạn, ms (GDD §4: flash 80 ms). */
const HIT_FLASH_MS = 80;
/** Bump scale nhỏ lúc trúng để đọc được đòn kể cả khi sprite sáng màu. */
const HIT_FLASH_SCALE = 1.06;

export interface EnemyViewInitArgs {
  readonly state: EnemyState;
  /** Tên actor trong manifest, không có gạch nối: `bluebat`, `spiderred`, `eye`… */
  readonly monster: string;
  readonly level: LevelData;
  /** Scale node đã tính từ frame (xem `actorScale` trong `level-view.ts`). */
  readonly baseScale: number;
  /**
   * Key animation đi bộ **không hướng** (sheet `strip` của boss, vd `tengu.walk`).
   * Bỏ trống thì dùng `<monster>.walk.<direction>` như monster thường.
   */
  readonly walkKey?: string;
  /** Bán kính hitbox, tile. Mặc định bằng `DEFAULT_ENEMY_RADIUS_TILES` × silhouette của vai trò. */
  readonly radiusTiles?: number;
  /** Tầm gây sát thương khi chạm, tile. Mặc định bằng tầm của chaser × silhouette. */
  readonly contactRangeTiles?: number;
  /**
   * Hệ số silhouette của vai trò (xem `visualScaleFor`). Boss truyền `1` vì
   * art boss đã to sẵn và hitbox do `boss-defs.ts` quyết.
   */
  readonly roleScale?: number;
}

/** Kết quả một frame của enemy — adapter chiến đấu dùng để sinh đạn/xét lao. */
export interface EnemyStepResult {
  /** Đòn vừa được thả trong frame này. `null` khi không có gì mới. */
  readonly released: 'shot' | 'charge' | null;
  /** Đoạn đường đã đi trong frame này **khi đang lao**, để xét hitbox bằng quét. */
  readonly chargeSweep: { readonly from: Vec2; readonly to: Vec2 } | null;
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
  /** Key đi bộ không hướng (boss); rỗng = dùng `<monster>.walk.<direction>`. */
  private walkKey = '';
  private hitRadius = DEFAULT_ENEMY_RADIUS_TILES;
  private contactRange = CHASER_CONTACT_RANGE_TILES;
  /** Cú đẩy nhỏ sau khi trúng đạn; `null` = không bị đẩy. */
  private knockback: KnockbackState | null = null;
  /** Thời điểm hết flash trúng đòn (ms của run). */
  private hitFlashUntilMs = 0;
  /** Vòng telegraph dưới chân — tạo một lần, bật/tắt theo action. */
  private ring: Sprite | null = null;
  private ringFrames: SpriteFrame[] = [];
  private ringRole = '';
  private ringVisible = false;
  /** Bù scale vai trò để vòng telegraph giữ đường kính tuyệt đối (không phình theo brute). */
  private ringScaleCompensation = 1;
  /** Màu tạm cho vòng (ghi lại mỗi frame, không cấp phát). */
  private readonly ringTint = new CocosColor(255, 255, 255, 0);
  /** Cú lao hiện tại đã gây sát thương chưa (mỗi cú chỉ một lần). */
  private chargeHitDone = false;
  /** `untilMs` của cú lao đang chạy — đổi giá trị = cú mới (elite lao liên tiếp). */
  private chargeUntilMs = -1;

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

  get role(): EnemyRole | null {
    return this.state?.role ?? null;
  }

  get isElite(): boolean {
    return this.state?.elite ?? false;
  }

  get actionKind(): EnemyAction['kind'] | 'none' {
    return this.state?.action.kind ?? 'none';
  }

  /** Máu còn lại — `killAll()` debug dùng để trừ đúng một lần qua đường damage chuẩn. */
  get health(): number {
    return this.state?.health ?? 0;
  }

  get maxHealth(): number {
    return this.state?.maxHealth ?? 0;
  }

  /** Bán kính hitbox, tile (đạn player dùng để xét trúng). */
  get radiusTiles(): number {
    return this.hitRadius;
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
    return this.contactRange;
  }

  init(args: EnemyViewInitArgs): void {
    this.state = args.state;
    this.monster = args.monster;
    this.level = args.level;
    // Silhouette: hệ số vai trò (brute 1.75) × frame scale; elite nhân thêm lúc applyScale.
    const roleScale = args.roleScale ?? visualScaleFor(args.state.role);
    this.baseScale = args.baseScale * roleScale;
    this.ringScaleCompensation = roleScale > 0 ? 1 / roleScale : 1;
    this.walkKey = args.walkKey ?? '';
    this.hitRadius = args.radiusTiles ?? DEFAULT_ENEMY_RADIUS_TILES * roleScale;
    this.contactRange = args.contactRangeTiles ?? CHASER_CONTACT_RANGE_TILES * roleScale;
    this.animator = this.getComponent(SpriteAnimator);
    const sprite: Sprite | null = this.getComponent(CocosSprite);
    this.sprite = sprite;

    this.syncNodePosition();
    this.applyScale(1);
    this.playWalk('down', true);
    this.applyTint(this.idleTint());

    // Vòng telegraph load sau (texture đã preload ở đầu chapter nên gần như tức thì).
    void this.createRing().catch((error: unknown) => {
      warn(`[YokaiField] Không dựng được vòng telegraph: ${String(error)}`);
    });
  }

  /** Một frame: hỏi core action kế tiếp, ghi lại, rồi áp chuyển động + hình. */
  step(nowMs: number, deltaMs: number, player: Vec2): EnemyStepResult {
    const state = this.state;
    const level = this.level;
    const result: EnemyStepResult = { released: null, chargeSweep: null };
    if (state === null || level === null || this.dead) return result;

    const previous = state.action;
    const next = decideAction({ state, player, nowMs, level });
    const released = attackReleased(previous, next);

    // `actionStartedMs` là mốc của **chu kỳ đòn** — xem `core/enemies/attack-cycle.ts`.
    // Stagger (bị bắn liên tục) không được restart cooldown, nếu không enemy không
    // bao giờ ra đòn.
    state.actionStartedMs = nextActionStartedMs(
      previous,
      next,
      nowMs,
      state.actionStartedMs,
    );
    if (next.kind === 'charge' && next.untilMs !== this.chargeUntilMs) {
      // Cú lao mới (kể cả cú thứ hai của elite tank, kind vẫn là 'charge').
      this.chargeUntilMs = next.untilMs;
      this.chargeHitDone = false;
    }
    state.action = next;

    if (next.kind === 'dead') {
      this.die();
      return result;
    }

    const before: Vec2 = { x: state.position.x, y: state.position.y };
    this.advance(next, deltaMs);
    this.applyKnockback(deltaMs);
    this.syncNodePosition();

    const chargeSweep =
      next.kind === 'charge'
        ? { from: before, to: { x: state.position.x, y: state.position.y } }
        : null;

    this.applyVisual(next, nowMs, player);

    return { released, chargeSweep };
  }

  /**
   * Trừ máu; hết máu thì biến mất (TODO(fx): explosion + fade, xem GDD §4).
   *
   * Trúng đòn đặt luôn action `stagger` (`nowMs + enemyStaggerMs`) — core quyết
   * thời gian choáng, adapter chỉ áp. Caster đang telegraph mà bị trúng thì đòn
   * bị ngắt, đúng ý nghĩa "stagger".
   */
  takeDamage(amount: number, source: Vec2 | null = null, nowMs = 0): void {
    const state = this.state;
    if (state === null || this.dead) return;

    state.health = Math.max(0, state.health - amount);
    this.hitFlashUntilMs = nowMs + HIT_FLASH_MS;

    if (state.health <= 0) {
      this.die();
      return;
    }

    state.action = staggerAction(nowMs, DEFAULT_COMBAT.enemyStaggerMs);
    // Không reset `actionStartedMs`: cooldown phải chạy tiếp qua cú choáng, nếu không
    // enemy bị bắn liên tục sẽ không bao giờ tới nhịp ra đòn.

    if (source !== null) {
      this.knockback = startKnockback(state.position, source, {
        distanceTiles: DEFAULT_COMBAT.enemyKnockbackDistanceTiles,
        durationMs: DEFAULT_COMBAT.enemyKnockbackDurationMs,
      });
    }
  }

  /** Cú lao hiện tại đã gây sát thương chưa — battle loop gọi để tránh trừ máu 2 lần. */
  get chargeHitApplied(): boolean {
    return this.chargeHitDone;
  }

  markChargeHit(): void {
    this.chargeHitDone = true;
  }

  private die(): void {
    const state = this.state;
    if (state !== null) {
      state.health = 0;
      state.action = { kind: 'dead' };
    }
    this.dead = true;
    this.animator?.stop();
    this.hideRing();
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
      const step = action.speedTilesPerSecond * seconds;
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

    const hitFlash = nowMs < this.hitFlashUntilMs;

    if (action.kind === 'telegraph') {
      const kind: RoleTelegraphKind = state.role;
      const elapsedMs = Math.max(0, nowMs - action.sinceMs);
      const pulse = 1 + TELEGRAPH_PULSE * Math.sin((elapsedMs / 1000) * TELEGRAPH_PULSE_SPEED);
      this.applyScale(hitFlash ? HIT_FLASH_SCALE : pulse);
      this.applyTint(hitFlash ? HIT_TINT : TELEGRAPH_TINT[kind]);
      this.showRing(kind, telegraphProgress(action.sinceMs, nowMs, kind));
      return;
    }

    this.applyScale(hitFlash ? HIT_FLASH_SCALE : 1);
    this.applyTint(hitFlash ? HIT_TINT : this.idleTint());
    this.hideRing();
  }

  /** Elite giữ tint tím nhạt cả lúc đứng yên — cách đọc "con này mạnh hơn" không cần chữ. */
  private idleTint(): Color {
    return this.isElite ? ELITE_TINT : NO_TINT;
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
    if (this.walkKey !== '') {
      if (!force && this.animKey === this.walkKey) return;
      this.animKey = this.walkKey;
      this.animDirection = direction;
      // Boss dùng sheet một hàng (không cột hướng) — truyền key không hướng.
      this.animator?.play(this.walkKey);
      return;
    }

    if (!force && this.animKey === `${this.monster}.walk` && this.animDirection === direction) {
      return;
    }
    this.animKey = `${this.monster}.walk`;
    this.animDirection = direction;
    this.animator?.play(`${this.monster}.walk.${direction}`, direction);
  }

  private applyScale(pulse: number): void {
    const state = this.state;
    const elite = state !== null && state.elite ? eliteScale() : 1;
    const scale = this.baseScale * elite * pulse;
    this.node.setScale(scale, scale, 1);
  }

  private applyTint(color: Color): void {
    const sprite = this.sprite;
    if (sprite === null) return;
    // `Sprite.color` là màu nhân vào texture; pack dùng 53 màu palette nên tint nhẹ
    // tay là đủ đọc, không phá silhouette.
    sprite.color = color;
  }

  // -------------------------------------------------------------------------
  // Vòng telegraph (pool một node / enemy)
  // -------------------------------------------------------------------------

  private async createRing(): Promise<void> {
    const frames = await loadRingFrames();
    if (!this.isValid || this.dead) return;
    this.ringFrames = frames;

    const node = new CocosNode('telegraph');
    node.parent = this.node;
    node.setPosition(0, RING_OFFSET_Y_PX, 0);

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    // `sizeMode = CUSTOM` lấy kích thước từ UITransform; thiếu dòng này node giữ
    // 100×100 mặc định và vòng telegraph to gấp ~3 lần (lộ ở ảnh nghiệm thu M3).
    const transform = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(RING_RECT.width, RING_RECT.height);
    node.active = false;

    this.ring = sprite;
  }

  private showRing(kind: RoleTelegraphKind, progress: number): void {
    const ring = this.ring;
    if (ring === null) return;

    if (this.ringRole !== kind) {
      this.ringRole = kind;
      const diameter = RING_DIAMETER_TILES[kind];
      // Frame 32 px, parent scale 1/16 ⇒ 32/16 = 2 tile; chia cho đường kính mong muốn,
      // nhân bù scale vai trò để vòng của brute vẫn đúng 4 tile chứ không phình 1.75×.
      const scale = (diameter / 2) * this.ringScaleCompensation;
      ring.node.setScale(scale, scale, 1);
    }

    const frame = this.ringFrames[Math.min(RING_FRAMES - 1, Math.floor(progress * RING_FRAMES))];
    if (frame !== undefined && ring.spriteFrame !== frame) ring.spriteFrame = frame;

    const color = TELEGRAPH_TINT[kind];
    const alpha = Math.round(RING_MIN_OPACITY + (RING_MAX_OPACITY - RING_MIN_OPACITY) * progress);
    this.ringTint.r = color.r;
    this.ringTint.g = color.g;
    this.ringTint.b = color.b;
    this.ringTint.a = alpha;
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
