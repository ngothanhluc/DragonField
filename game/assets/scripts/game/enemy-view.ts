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
  Graphics as CocosGraphics,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  warn,
} from 'cc';
import type { Direction } from '../core/art/manifest';
import type { ViewRect } from '../core/camera/follow-camera';
import { directionFromVector } from '../core/art/runtime';
import { startKnockback, stepKnockback, type KnockbackState } from '../core/combat/knockback';
import { StatusEffects } from '../core/combat/status-effects';
import { telegraphProgress, type TelegraphKind } from '../core/combat/telegraph';
import { DEFAULT_COMBAT } from '../core/config';
import {
  CHASER_CONTACT_RANGE_TILES,
  ROOM_EDGE_MARGIN_TILES,
  attackReleasedForRole,
  contactDamageFor,
  decideAction,
  speedFor,
  staggerAfterHit,
  visualScaleFor,
} from '../core/enemies/behaviours';
import type { EnemyAction, EnemyState } from '../core/enemies/behaviours';
import { bomberBlastSpec } from '../core/enemies/bomber';
import { nextActionStartedMs } from '../core/enemies/attack-cycle';
import { eliteScale, spriteActorForRole } from '../core/enemies/elite';
import { telegraphLine } from '../core/enemies/telegraph-line';
import type { EnemyRole, LevelData } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { moveWithCollision } from '../core/movement/collision';
import {
  StuckGuard,
  walkTowards,
  type FlowField,
  type RoomNavigation,
} from '../core/enemies/navigation';
import type { DerivedStats } from '../core/skills/derived-stats';
import { squashScale } from '../core/feel/squash';
import { FEEL_TUNING, NAVIGATION_TUNING } from '../core/enemies/tuning';
import { SpriteAnimator } from './anim/sprite-animator';
import { loadTexture } from './assets/texture-cache';
import type { FxPool } from './fx/effect-pool';
import { playBurnSfx, playSfx } from './audio/sfx';
import { ACTOR_FEET_OFFSET_TILES, sliceFrame, tileToWorld } from './level-view';
import type { TileRect } from './level-view';

const { ccclass } = _decorator;

/** `cc` is an any module in this repo: types must be derived from the import value (see `texture-cache.ts`). */
type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;
/** `cc` is an any module: `Node` must be a derived type, not the imported value. */
type Node = InstanceType<typeof CocosNode>;

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
const BURNED_TINT = new CocosColor(255, 165, 105, 255);
const POISONED_TINT = new CocosColor(170, 230, 130, 255);
const HASTED_TINT = new CocosColor(180, 255, 170, 255);
const TELEGRAPH_TINT: Readonly<Record<RoleTelegraphKind, Color>> = {
  chaser: new CocosColor(255, 226, 120, 255),
  caster: new CocosColor(130, 220, 255, 255),
  tank: new CocosColor(255, 150, 80, 255),
  sniper: new CocosColor(255, 120, 120, 255),
  bomber: new CocosColor(255, 110, 60, 255),
  buffer: new CocosColor(150, 255, 170, 255),
};

/** Telegraph ring diameter by role, in tiles (distinguishable at a glance). */
const RING_DIAMETER_TILES: Readonly<Record<RoleTelegraphKind, number>> = {
  chaser: 2.4,
  caster: 2.8,
  tank: 4,
  sniper: 2.8,
  bomber: 5,
  buffer: 3.4,
};

/**
 * Enemy role → telegraph kind. Splitter and splitling have no telegraph, so this is the single
 * place that narrows the role union before `telegraphProgress`/the colour tables are indexed.
 */
function telegraphKindFor(role: EnemyRole): RoleTelegraphKind | null {
  switch (role) {
    case 'chaser':
    case 'caster':
    case 'tank':
    case 'sniper':
    case 'bomber':
    case 'buffer':
      return role;
    case 'splitter':
    case 'splitling':
      return null;
  }
}

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
  /**
   * Random source for the stuck-guard detour (the run's `SeededRng`). Optional so a test can
   * pass a fixed value; the guard is a safety net, its choice does not matter beyond variety.
   */
  readonly random?: () => number;
}

/** One enemy frame result — the combat adapter uses it to spawn bullets, sweep charges, and trigger blasts/buffs. */
export interface EnemyStepResult {
  /** Attack released in this frame. `null` when nothing new happened. */
  readonly released: 'shot' | 'charge' | 'blast' | 'buff' | null;
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
  private ringDiameterTiles = 0;
  private ringVisible = false;
  private hasted = false;
  private hasteScale = 1;
  /** Role-scale compensation so the ring keeps an absolute diameter (no inflation on brutes). */
  private ringScaleCompensation = 1;
  /** Scratch colour for the ring (rewritten each frame, no allocation). */
  private readonly ringTint = new CocosColor(255, 255, 255, 0);
  /**
   * Sniper line telegraph (#42): a `Graphics` sibling in world space (the enemy node is scaled
   * 1/16, so drawing inside it would need compensating every frame).
   */
  private lineNode: Node | null = null;
  private lineGraphics: Graphics | null = null;
  private lineVisible = false;
  /** Whether the current dash has dealt damage (once per dash). */
  private chargeHitDone = false;
  /** `untilMs` of the running dash — a new value means a new dash (elites dash repeatedly). */
  private chargeUntilMs = -1;
  /** Freeze/Poison from player skills; core decides timing, the view only holds state. */
  private readonly statuses = new StatusEffects();
  /** Stuck guard for this enemy (one window): walking 2 s without progress ⇒ 1 s detour. */
  private readonly stuckGuard = new StuckGuard(
    NAVIGATION_TUNING.stuckWindowMs,
    NAVIGATION_TUNING.stuckDistanceTiles,
    NAVIGATION_TUNING.detourMs,
  );
  /** Random source for the detour direction — the run's seeded RNG, from `init`. */
  private random: () => number = () => 0.5;

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

  /** Read-only state, for adapters that need the pure `EnemyState` (e.g. `splitOnDeath`). */
  get enemyState(): EnemyState | null {
    return this.state;
  }

  /** Hitbox radius, tiles (player bullets use it for hit tests). */
  get radiusTiles(): number {
    return this.hitRadius;
  }

  /** Chaser/tank/splitter deal contact damage; the caster and sniper shoot instead. */
  get melee(): boolean {
    const state = this.state;
    return (
      state !== null &&
      (state.role === 'chaser' ||
        state.role === 'tank' ||
        state.role === 'splitter' ||
        state.role === 'splitling')
    );
  }

  get contactDamage(): number {
    const state = this.state;
    return state === null
      ? 0
      : contactDamageFor(state.role, state.elite, undefined, this.level?.chapter ?? 1);
  }

  hasAnyStatus(nowMs: number): boolean {
    return this.statuses.hasAnyStatus(nowMs);
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
    this.random = args.random ?? this.random;
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
    this.createTelegraphLine();
  }

  /**
   * One frame: ask core for the next action, write it back, then apply movement + visuals.
   *
   * `navigation` is the room's shared flow field (one per radius class, owned by `CombatLoop`),
   * used exactly like the balance sim: straight while the target is in sight, around the wall
   * otherwise, with the stuck guard as the last resort. `view` is what the player can see (#41):
   * core refuses to start an attack from outside it.
   */
  step(
    nowMs: number,
    deltaMs: number,
    player: Vec2,
    navigation: RoomNavigation,
    view?: ViewRect,
    hasteMultiplier = 1,
  ): EnemyStepResult {
    const state = this.state;
    const level = this.level;
    const result: EnemyStepResult = { released: null, chargeSweep: null };
    if (state === null || level === null || this.dead) return result;

    const previous = state.action;
    const next =
      view === undefined
        ? decideAction({ state, player, nowMs, level })
        : decideAction({ state, player, nowMs, level, view });

    // Poison and Burn tick before the action is decided: the enemy may die this frame.
    const dot =
      this.statuses.poisonDamage(nowMs, deltaMs) + this.statuses.burnDamage(nowMs, deltaMs);
    if (dot > 0) {
      state.health = Math.max(0, state.health - dot);
      if (state.health <= 0) {
        this.die();
        return result;
      }
    }

    const released = attackReleasedForRole(state.role, previous, next);

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

    this.hasteScale = Number.isFinite(hasteMultiplier) && hasteMultiplier > 1 ? hasteMultiplier : 1;
    this.hasted = this.hasteScale > 1;

    const before: Vec2 = { x: state.position.x, y: state.position.y };
    const field = navigation.field(this.hitRadius, player, nowMs);
    const detour = this.stuckGuard.update(
      state.id,
      state.position,
      next.kind === 'walk',
      nowMs,
      field,
      this.random,
    );
    this.advance(
      next,
      deltaMs,
      this.statuses.speedMultiplier(nowMs) * this.hasteScale,
      field,
      detour,
    );
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

    state.action = staggerAfterHit(state.action, nowMs, DEFAULT_COMBAT.enemyStaggerMs);
    // Do not reset `actionStartedMs`: the cooldown must keep running through the stun, or an
    // enemy under constant fire would never reach its attack beat.

    if (source !== null) {
      this.knockback = startKnockback(state.position, source, {
        distanceTiles: DEFAULT_COMBAT.enemyKnockbackDistanceTiles,
        durationMs: DEFAULT_COMBAT.enemyKnockbackDurationMs,
      });
    }
  }

  /** Freeze/Poison/Burn when a player bullet lands. Core decides the effect; the view holds state + reports FX. */
  applyStatus(
    stats: DerivedStats,
    nowMs: number,
  ): { readonly slowStarted: boolean; readonly poisonStarted: boolean; readonly burnStarted: boolean } {
    const wasSlowed = this.statuses.isSlowed(nowMs);
    const wasPoisoned = this.statuses.isPoisoned(nowMs);
    const wasBurned = this.statuses.isBurned(nowMs);
    this.statuses.apply(stats, nowMs);

    // The status FX belongs to the **first application** of the status, not to every hit:
    // a rapid-fire loadout hits the same enemy many times per second.
    const slowStarted = !wasSlowed && this.statuses.isSlowed(nowMs);
    const poisonStarted = !wasPoisoned && this.statuses.isPoisoned(nowMs);
    const burnStarted = !wasBurned && this.statuses.isBurned(nowMs);

    if (slowStarted) {
      this.fx?.spawn('fx.ice', this.position);
      playSfx('freeze');
    }
    if (poisonStarted) {
      this.fx?.spawn('fx.poison', this.position);
      playSfx('poison');
    }
    if (burnStarted) {
      this.fx?.spawn('fx.impact', this.position, {
        tint: BURNED_TINT,
        drawUnits: 1.5,
        lifetimeMs: 360,
      });
      playBurnSfx();
    }

    return { slowStarted, poisonStarted, burnStarted };
  }

  /**
   * Cull the drawn sprite while the enemy is off screen (#41). **Never** `node.active`: the combat
   * loop and the cover/depth pass read the node and its state every frame, so only the renderer's
   * `Sprite.enabled` flag may change here.
   */
  setCulled(culled: boolean): void {
    const sprite = this.sprite;
    if (sprite === null) return;
    if (sprite.enabled !== !culled) sprite.enabled = !culled;
    // The telegraph ring and sniper line are separate nodes; they only show while attacking, and
    // an attack cannot start off screen (#41), so they need no culling of their own.
  }

  /** Whether the current dash already dealt damage — the battle loop asks to avoid double-hitting. */
  get chargeHitApplied(): boolean {
    return this.chargeHitDone;
  }

  markChargeHit(): void {
    this.chargeHitDone = true;
  }

  /**
   * Move the body without a decision — used by the room's separation pass (core computes the
   * non-overlapping position, the view writes it back and re-syncs the node).
   */
  moveTo(position: Vec2): void {
    const state = this.state;
    if (state === null) return;
    state.position = position;
    this.syncNodePosition();
  }

  /**
   * Apply a pre-computed radial knockback (e.g. M12 mid-combat level-up resume wave).
   * Clones the `KnockbackState` so `stepKnockback` never mutates caller state, and preserves
   * obstacle/wall safety through `applyKnockback`.
   */
  applyKnockbackState(knockback: KnockbackState): void {
    if (this.dead || this.state === null) return;
    this.knockback = {
      direction: { x: knockback.direction.x, y: knockback.direction.y },
      speedTilesPerSecond: knockback.speedTilesPerSecond,
      remainingMs: knockback.remainingMs,
    };
  }

  private die(): void {
    const state = this.state;
    if (state !== null) {
      state.health = 0;
      state.action = { kind: 'dead' };
      this.stuckGuard.forget(state.id);
    }
    this.dead = true;
    this.animator?.stop();
    this.hideRing();
    this.hideLine();
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

  private advance(
    action: EnemyAction,
    deltaMs: number,
    speedMultiplier: number,
    field: FlowField,
    detour: Vec2 | null,
  ): void {
    const state = this.state;
    const level = this.level;
    if (state === null || level === null) return;

    const seconds = (deltaMs / 1000) * Math.max(0, speedMultiplier);

    // Obstacles are solid (all kinds, pits included): same rule as the player and the sim.
    if (action.kind === 'charge') {
      const step = action.speedTilesPerSecond * seconds;
      state.position = moveWithCollision(
        state.position,
        { x: action.direction.x * step, y: action.direction.y * step },
        this.hitRadius,
        level,
        ROOM_EDGE_MARGIN_TILES,
      );
      return;
    }
    if (action.kind !== 'walk') return;

    // Straight while the target is in sight, the shared flow field around a wall, a short
    // detour when the stuck guard fires — the same rule as `run-simulation.ts`.
    state.position = walkTowards({
      position: state.position,
      target: action.target,
      field,
      maxDistanceTiles: speedFor(state.role, state.elite) * seconds,
      radiusTiles: this.hitRadius,
      level,
      marginTiles: ROOM_EDGE_MARGIN_TILES,
      detour,
    });
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
      this.hitRadius,
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
      const kind = telegraphKindFor(state.role);
      if (kind === null) {
        this.applyScale(hitFlash ? HIT_FLASH_SCALE : 1, nowMs);
        this.applyTint(hitFlash ? HIT_TINT : this.stateTint(nowMs));
        this.hideRing();
        this.hideLine();
        return;
      }

      const elapsedMs = Math.max(0, nowMs - action.sinceMs);
      const pulse = 1 + TELEGRAPH_PULSE * Math.sin((elapsedMs / 1000) * TELEGRAPH_PULSE_SPEED);
      this.applyScale(hitFlash ? HIT_FLASH_SCALE : pulse, nowMs);
      this.applyTint(hitFlash ? HIT_TINT : TELEGRAPH_TINT[kind]);

      // The sniper shows a line to the player instead of the caster's ring (#42).
      if (kind === 'sniper' && this.level !== null) {
        const line = telegraphLine(this.level, state.position, player);
        this.showLine(tileToWorld(line.from), tileToWorld(line.to), TELEGRAPH_TINT.sniper);
        this.hideRing();
      } else {
        this.hideLine();
        this.showRing(kind, telegraphProgress(action.sinceMs, nowMs, kind));
      }
      return;
    }

    this.applyScale(hitFlash ? HIT_FLASH_SCALE : 1, nowMs);
    this.applyTint(hitFlash ? HIT_TINT : this.stateTint(nowMs));
    this.hideRing();
    this.hideLine();
  }

  /** Status & buffer haste tint outside telegraph: frozen > burned > poisoned > hasted > none. */
  private stateTint(nowMs: number): Color {
    if (this.statuses.isSlowed(nowMs)) return FROZEN_TINT;
    if (this.statuses.isBurned(nowMs)) return BURNED_TINT;
    if (this.statuses.isPoisoned(nowMs)) return POISONED_TINT;
    if (this.hasted) return HASTED_TINT;
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
    // Elites use their own generated sheet (`<monster>.elite.*`, ADR-015); splitlings use the
    // palette-remapped `<monster>.splitling.*` variant (#42).
    const role = this.state?.role ?? 'chaser';
    const actor = spriteActorForRole(this.monster, role, this.isElite);
    const key = `${actor}.${clip}`;
    if (!force && this.animKey === key && this.animDirection === direction && this.animMoving === moving) {
      return;
    }

    this.animKey = key;
    this.animDirection = direction;
    this.animMoving = moving;
    this.animator?.setPlaybackScale(moving && this.hasted ? Math.min(1.8, this.hasteScale) : 1);
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

    const diameter =
      kind === 'bomber' && this.state !== null
        ? bomberBlastSpec(this.state, this.level?.chapter ?? 1).radiusTiles * 2
        : RING_DIAMETER_TILES[kind];

    if (this.ringRole !== kind || this.ringDiameterTiles !== diameter) {
      this.ringRole = kind;
      this.ringDiameterTiles = diameter;
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

  // -------------------------------------------------------------------------
  // Sniper line telegraph (#42): one Graphics sibling in world units
  // -------------------------------------------------------------------------

  private createTelegraphLine(): void {
    // Only the sniper shows a line; every other role keeps the ring and no extra node.
    if (this.state?.role !== 'sniper') return;
    const parent = this.node.parent;
    if (parent === null) return;

    const node = new CocosNode('sniper-line');
    node.layer = this.node.layer;
    node.parent = parent;
    const graphics: Graphics = node.addComponent(CocosGraphics);
    node.active = false;

    this.lineNode = node;
    this.lineGraphics = graphics;
  }

  /** Draw the line from `from` to `to` (world units), pulsing the alpha with telegraph progress. */
  private showLine(from: Vec2, to: Vec2, color: Color): void {
    const node = this.lineNode;
    const graphics = this.lineGraphics;
    if (node === null || graphics === null) return;

    node.setPosition(from.x, from.y, 0);
    graphics.clear();
    graphics.lineWidth = 0.07;
    graphics.strokeColor = color;
    graphics.moveTo(0, 0);
    graphics.lineTo(to.x - from.x, to.y - from.y);
    graphics.stroke();

    if (!this.lineVisible) {
      node.active = true;
      this.lineVisible = true;
    }
  }

  private hideLine(): void {
    if (!this.lineVisible) return;
    const node = this.lineNode;
    if (node !== null) node.active = false;
    this.lineVisible = false;
  }

  private syncNodePosition(): void {
    const world = tileToWorld(this.position);
    this.node.setPosition(world.x, world.y - ACTOR_FEET_OFFSET_TILES, 0);
  }

  protected onDestroy(): void {
    // The line is a sibling in world space, not a child: destroying the enemy must take it too.
    const line = this.lineNode;
    if (line !== null && line.isValid) line.destroy();
    this.lineNode = null;
    this.lineGraphics = null;
  }
}
