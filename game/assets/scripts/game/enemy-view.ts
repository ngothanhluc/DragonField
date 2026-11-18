/**
 * One node per `EnemyState`.
 *
 * The split follows `core/enemies/behaviours.ts`: core is a **pure function**
 * (`decideAction` does not mutate state), this file is the **adapter** — it writes the action
 * back into state, applies movement, picks the animation, changes tint and draws the telegraph.
 *
 * Pack monsters have only **one 4-direction walk sheet** and no attack/hurt/death
 * (GDD §4), so an attack is expressed through **silhouette (art/scale) + telegraph ring
 * + tint**:
 *
 * | Role | Silhouette | Telegraph | Elite extra |
 * |---|---|---|---|
 * | chaser | small bat, flies close | **yellow** ring (elite only) | short dash |
 * | caster | floating eye | **cyan** ring, small | 3-shot volley |
 * | tank | big slow bear | **orange** ring, large | dashes twice |
 *
 * The telegraph ring uses `resources/art/fx/telegraph-ring` (32×32 × 4 frames). Each
 * enemy has **one** ring node created at init and toggled by action — no node is created
 * per attack.
 *
 * `step()` returns `EnemyStepResult`: the combat adapter needs to know the attack just released
 * (`shot`/`charge`) and **the path travelled while dashing** so it can sweep-test the hitbox
 * instead of guessing from the end-of-frame position.
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
import { StatusEffects } from '../core/combat/status-effects';
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
import { eliteScale, spriteActorFor } from '../core/enemies/elite';
import type { EnemyRole, LevelData } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import type { DerivedStats } from '../core/skills/derived-stats';
import { squashScale } from '../core/feel/squash';
import { FEEL_TUNING } from '../core/enemies/tuning';
import { SpriteAnimator } from './anim/sprite-animator';
import { loadTexture } from './assets/texture-cache';
import type { FxPool } from './fx/effect-pool';
import { playSfx } from './audio/sfx';
import { ACTOR_FEET_OFFSET_TILES, sliceFrame, tileToWorld } from './level-view';
import type { TileRect } from './level-view';

const { ccclass } = _decorator;

/** `cc` is an any module in this repo: types must be derived from the import value (see `texture-cache.ts`). */
type Color = InstanceType<typeof CocosColor>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;

/** Roles that have a telegraph — `telegraphProgress` needs a narrow union. */
type RoleTelegraphKind = Exclude<TelegraphKind, 'boss'>;

/** Default hitbox radius, in tiles — same convention as `run-simulation.ts`. */
export const DEFAULT_ENEMY_RADIUS_TILES = 0.4;

/**
 * Telegraph ring: 128×32 px sheet = 4 frames of 32×32 (import-checklist §6.2).
 *
 * Deliberately not routed through `animations.json`: the manifest only holds actor
 * animations and has no FX schema (same reason `bullet-view.ts` declares its sheet directly).
 * TODO(fx): add FX keys to the manifest, then drop this sheet constant.
 */
export const TELEGRAPH_RING_SHEET = 'resources/art/fx/telegraph-ring/SpriteSheetWhite.png';
const RING_RECT: TileRect = { x: 0, y: 0, width: 32, height: 32 };
const RING_FRAMES = 4;

/** Frames sliced once per scene — each enemy only references them, never re-slices. */
let ringFramesPromise: Promise<SpriteFrame[]> | null = null;

/** Load the 4 telegraph ring frames, shared with the boss (`boss-view.ts`). */
export function loadTelegraphFrames(): Promise<SpriteFrame[]> {
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

/** Base colour (no tint) plus role/kind colours. */
const NO_TINT = new CocosColor(255, 255, 255, 255);
const HIT_TINT = new CocosColor(255, 250, 225, 255);
const FROZEN_TINT = new CocosColor(150, 220, 255, 255);
const POISONED_TINT = new CocosColor(170, 230, 130, 255);
const TELEGRAPH_TINT: Readonly<Record<RoleTelegraphKind, Color>> = {
  chaser: new CocosColor(255, 226, 120, 255),
  caster: new CocosColor(130, 220, 255, 255),
  tank: new CocosColor(255, 150, 80, 255),
};

/** Telegraph ring diameter by role, in tiles (distinguishable at a glance). */
const RING_DIAMETER_TILES: Readonly<Record<RoleTelegraphKind, number>> = {
  chaser: 2.4,
  caster: 2.8,
  tank: 4,
};

/** The ring sits under the feet: offset down in the parent's texture px (parent scale 1/16). */
const RING_OFFSET_Y_PX = -7;

/** Pulse amplitude during telegraph (ratio of the base scale). */
const TELEGRAPH_PULSE = 0.12;
/** Pulse speed, radians/second. */
const TELEGRAPH_PULSE_SPEED = 14;
/** Ring opacity at full progress. */
const RING_MAX_OPACITY = 220;
/** Minimum opacity so the telegraph is visible from the first frame. */
const RING_MIN_OPACITY = 90;

/** Tint flash duration after being hit, ms (GDD §4: 80 ms flash). */
const HIT_FLASH_MS = 80;
/** Small scale bump on hit so the blow reads even on bright sprites. */
const HIT_FLASH_SCALE = 1.06;

export interface EnemyViewInitArgs {
  readonly state: EnemyState;
  /** Actor name in the manifest, no hyphen: `bluebat`, `spiderred`, `eye`… */
  readonly monster: string;
  readonly level: LevelData;
  /** Node scale already derived from the frame (see `actorScale` in `level-view.ts`). */
  readonly baseScale: number;
  /** Chapter FX pool — death/status effects spawn here, no new node needed. */
  readonly fx?: FxPool;
  /** Hitbox radius, tiles. Defaults to `DEFAULT_ENEMY_RADIUS_TILES` × the role's silhouette. */
  readonly radiusTiles?: number;
  /** Contact damage range, tiles. Defaults to the chaser range × silhouette. */
  readonly contactRangeTiles?: number;
  /**
   * Silhouette factor of the role (see `visualScaleFor`). The boss passes `1` because
   * boss art is already large and `boss-defs.ts` owns its hitbox.
   */
  readonly roleScale?: number;
}

/** One enemy frame result — the combat adapter uses it to spawn bullets and sweep charges. */
export interface EnemyStepResult {
  /** Attack released in this frame. `null` when nothing new happened. */
  readonly released: 'shot' | 'charge' | null;
  /** Path travelled this frame **while dashing**, for sweep-tested hitboxes. */
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
  private animMoving = true;
  /** FX pool (death/status). */
  private fx: FxPool | null = null;
  private hitRadius = DEFAULT_ENEMY_RADIUS_TILES;
  private contactRange = CHASER_CONTACT_RANGE_TILES;
  /** Small knockback after a bullet hit; `null` = not being pushed. */
  private knockback: KnockbackState | null = null;
  /** When the hit flash ends (run ms). */
  private hitFlashUntilMs = 0;
  /** Squash start time on a bullet hit; after `feel.squash.enemyHitMs` it returns to base scale. */
  private squashStartMs = Number.NEGATIVE_INFINITY;
  /** Telegraph ring under the feet — created once, toggled by action. */
  private ring: Sprite | null = null;
  private ringFrames: SpriteFrame[] = [];
  private ringRole = '';
  private ringVisible = false;
  /** Role-scale compensation so the ring keeps an absolute diameter (no inflation on brutes). */
  private ringScaleCompensation = 1;
  /** Scratch colour for the ring (rewritten each frame, no allocation). */
  private readonly ringTint = new CocosColor(255, 255, 255, 0);
  /** Whether the current dash has dealt damage (once per dash). */
  private chargeHitDone = false;
  /** `untilMs` of the running dash — a new value means a new dash (elites dash repeatedly). */
  private chargeUntilMs = -1;
  /** Freeze/Poison from player skills; core decides timing, the view only holds state. */
  private readonly statuses = new StatusEffects();

  get id(): string {
    return this.state?.id ?? '';
  }

  /** Position in `LevelData`'s tile space (y down) — same space as player and bullets. */
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

  /** Remaining HP — the debug `killAll()` uses it to subtract exactly once through the normal damage path. */
  get health(): number {
    return this.state?.health ?? 0;
  }

  get maxHealth(): number {
    return this.state?.maxHealth ?? 0;
  }

  /** Hitbox radius, tiles (player bullets use it for hit tests). */
  get radiusTiles(): number {
    return this.hitRadius;
  }

  /** Chaser/tank deal contact damage; the caster shoots, so it has no contact damage. */
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
    // Silhouette: role factor (brute 1.75) × frame scale; elite multiplies again in applyScale.
    const roleScale = args.roleScale ?? visualScaleFor(args.state.role);
    this.baseScale = args.baseScale * roleScale;
    this.ringScaleCompensation = roleScale > 0 ? 1 / roleScale : 1;
    this.fx = args.fx ?? null;
    this.hitRadius = args.radiusTiles ?? DEFAULT_ENEMY_RADIUS_TILES * roleScale;
    this.contactRange = args.contactRangeTiles ?? CHASER_CONTACT_RANGE_TILES * roleScale;
    this.animator = this.getComponent(SpriteAnimator);
    const sprite: Sprite | null = this.getComponent(CocosSprite);
    this.sprite = sprite;

    this.syncNodePosition();
    this.applyScale(1, 0);
    this.playMotion(false, 'down', true);
    this.applyTint(NO_TINT);

    // The telegraph ring loads afterwards (its texture is preloaded at chapter start, so it is near-instant).
    void this.createRing().catch((error: unknown) => {
      warn(`[YokaiField] Could not build the telegraph ring: ${String(error)}`);
    });
  }

  /** One frame: ask core for the next action, write it back, then apply movement + visuals. */
  step(nowMs: number, deltaMs: number, player: Vec2): EnemyStepResult {
    const state = this.state;
    const level = this.level;
    const result: EnemyStepResult = { released: null, chargeSweep: null };
    if (state === null || level === null || this.dead) return result;

    const previous = state.action;
    const next = decideAction({ state, player, nowMs, level });

    // Poison ticks before the action is decided: the enemy may die this frame.
    const poison = this.statuses.poisonDamage(nowMs, deltaMs);
    if (poison > 0) {
      state.health = Math.max(0, state.health - poison);
      if (state.health <= 0) {
        this.die();
        return result;
      }
    }

    const released = attackReleased(previous, next);

    // `actionStartedMs` is the **attack cycle** anchor — see `core/enemies/attack-cycle.ts`.
    // Stagger (from constant fire) must not restart the cooldown, or the enemy would
    // never attack.
    state.actionStartedMs = nextActionStartedMs(
      previous,
      next,
      nowMs,
      state.actionStartedMs,
    );
    if (next.kind === 'charge' && next.untilMs !== this.chargeUntilMs) {
      // New dash (including the elite tank's second one, whose kind is still 'charge').
      this.chargeUntilMs = next.untilMs;
      this.chargeHitDone = false;
    }
    state.action = next;

    if (next.kind === 'dead') {
      this.die();
      return result;
    }

    const before: Vec2 = { x: state.position.x, y: state.position.y };
    this.advance(next, deltaMs, this.statuses.speedMultiplier(nowMs));
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
   * Subtract HP; at zero the enemy disappears (TODO(fx): explosion + fade, see GDD §4).
   *
   * A hit always sets the `stagger` action (`nowMs + enemyStaggerMs`) — core decides
   * the stun duration, the adapter only applies it. A caster hit mid-telegraph has its
   * attack interrupted, which is exactly what "stagger" means.
   */
  takeDamage(amount: number, source: Vec2 | null = null, nowMs = 0): void {
    const state = this.state;
    if (state === null || this.dead) return;

    state.health = Math.max(0, state.health - amount);
    this.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
    this.squashStartMs = nowMs;

    if (state.health <= 0) {
      this.die();
      return;
    }

    state.action = staggerAction(nowMs, DEFAULT_COMBAT.enemyStaggerMs);
    // Do not reset `actionStartedMs`: the cooldown must keep running through the stun, or an
    // enemy under constant fire would never reach its attack beat.

    if (source !== null) {
      this.knockback = startKnockback(state.position, source, {
        distanceTiles: DEFAULT_COMBAT.enemyKnockbackDistanceTiles,
        durationMs: DEFAULT_COMBAT.enemyKnockbackDurationMs,
      });
    }
  }

  /** Freeze/Poison when a player bullet lands. Core decides the effect; the view holds state + reports FX. */
  applyStatus(stats: DerivedStats, nowMs: number): void {
    const wasSlowed = this.statuses.isSlowed(nowMs);
    const wasPoisoned = this.statuses.isPoisoned(nowMs);
    this.statuses.apply(stats, nowMs);

    if (!wasSlowed && this.statuses.isSlowed(nowMs)) {
      this.fx?.spawn('fx.ice', this.position);
      playSfx('freeze');
    }
    if (!wasPoisoned && this.statuses.isPoisoned(nowMs)) {
      this.fx?.spawn('fx.poison', this.position);
      playSfx('poison');
    }
  }

  /** Whether the current dash already dealt damage — the battle loop asks to avoid double-hitting. */
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
    // GDD §12.3: monsters have no death frame — death is pack FX, not a sprite.
    this.fx?.spawn('fx.smoke', this.position);
    this.fx?.spawn('fx.impact', this.position, {
      tint: new CocosColor(255, 220, 160, 255),
      drawUnits: 2.2,
      lifetimeMs: 420,
    });
    playSfx('enemy-death');
    this.node.active = false;
  }

  private advance(action: EnemyAction, deltaMs: number, speedMultiplier = 1): void {
    const state = this.state;
    const level = this.level;
    if (state === null || level === null) return;

    const seconds = (deltaMs / 1000) * Math.max(0, Math.min(1, speedMultiplier));
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
        // Never overshoot the target in one frame (a long frame ≠ a teleport).
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

  /** Small knockback after a bullet hit; same rig as the player but a shorter distance. */
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
    this.playMotion(action.kind === 'walk' || action.kind === 'charge', facing);

    const hitFlash = nowMs < this.hitFlashUntilMs;

    if (action.kind === 'telegraph') {
      const kind: RoleTelegraphKind = state.role;
      const elapsedMs = Math.max(0, nowMs - action.sinceMs);
      const pulse = 1 + TELEGRAPH_PULSE * Math.sin((elapsedMs / 1000) * TELEGRAPH_PULSE_SPEED);
      this.applyScale(hitFlash ? HIT_FLASH_SCALE : pulse, nowMs);
      this.applyTint(hitFlash ? HIT_TINT : TELEGRAPH_TINT[kind]);
      this.showRing(kind, telegraphProgress(action.sinceMs, nowMs, kind));
      return;
    }

    this.applyScale(hitFlash ? HIT_FLASH_SCALE : 1, nowMs);
    this.applyTint(hitFlash ? HIT_TINT : this.stateTint(nowMs));
    this.hideRing();
  }

  /** Status tint outside telegraph: frozen > poisoned > none (elites have their own art, ADR-015). */
  private stateTint(nowMs: number): Color {
    if (this.statuses.isSlowed(nowMs)) return FROZEN_TINT;
    if (this.statuses.isPoisoned(nowMs)) return POISONED_TINT;
    return NO_TINT;
  }

  /**
   * Facing: while walking/dashing it follows movement, while idle/telegraphing it looks
   * at the player. Standing still on the player's exact spot ⇒ `directionFromVector` returns
   * the fallback, so the sprite does not flip direction.
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

  /**
   * Idle vs walk: the pack has only one walk sheet, so idle plays the same sheet slowly
   * (`<actor>.idle.*`, fps 4 in the manifest). Telegraphing while still running the 10 fps
   * walk animation looks like sliding — switching to idle is a readable cue.
   */
  private playMotion(moving: boolean, direction: Direction, force = false): void {
    const clip = moving ? 'walk' : 'idle';
    // Elites use their own generated sheet (`<monster>.elite.*`, ADR-015) instead of a tint.
    const actor = spriteActorFor(this.monster, this.isElite);
    const key = `${actor}.${clip}`;
    if (!force && this.animKey === key && this.animDirection === direction && this.animMoving === moving) {
      return;
    }

    this.animKey = key;
    this.animDirection = direction;
    this.animMoving = moving;
    this.animator?.setPlaybackScale(moving ? 1 : 1);
    this.animator?.play(`${key}.${direction}`, direction);
  }

  /**
   * Scale = base × elite × telegraph pulse × squash on hit. Squash multiplies on the
   * x/y axes separately, so elite ×1.15 and tank ×1.75 still sit on the correct base scale.
   */
  private applyScale(pulse: number, nowMs: number): void {
    const state = this.state;
    const elite = state !== null && state.elite ? eliteScale() : 1;
    const scale = this.baseScale * elite * pulse;
    const squash = squashScale(
      nowMs - this.squashStartMs,
      FEEL_TUNING.squash.enemyHitMs,
      FEEL_TUNING.squash.enemyHitAmount,
    );
    this.node.setScale(scale * squash.x, scale * squash.y, 1);
  }

  private applyTint(color: Color): void {
    const sprite = this.sprite;
    if (sprite === null) return;
    // `Sprite.color` multiplies the texture; the pack's 53-colour palette means a light
    // tint reads clearly without breaking the silhouette.
    sprite.color = color;
  }

  // -------------------------------------------------------------------------
  // Telegraph ring (one pooled node per enemy)
  // -------------------------------------------------------------------------

  private async createRing(): Promise<void> {
    const frames = await loadTelegraphFrames();
    if (!this.isValid || this.dead) return;
    this.ringFrames = frames;

    const node = new CocosNode('telegraph');
    node.parent = this.node;
    node.setPosition(0, RING_OFFSET_Y_PX, 0);

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    // `sizeMode = CUSTOM` takes its size from UITransform; without this line the node keeps
    // the default 100×100 and the ring is ~3× too big (caught in the M3 acceptance shots).
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
      // 32 px frame at parent scale 1/16 ⇒ 32/16 = 2 tiles; divide by the target diameter and
      // multiply by the role-scale compensation so the brute's ring stays 4 tiles instead of inflating 1.75×.
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
    this.node.setPosition(world.x, world.y - ACTOR_FEET_OFFSET_TILES, 0);
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
