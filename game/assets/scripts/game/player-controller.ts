/**
 * Player: reads WASD, moves, auto-fires, takes damage, drives the animation.
 *
 * Thin adapter around `core/`:
 * - movement: `normalizeMoveInput` + `velocityFromInput` (core decides the vector, this file applies it to coordinates);
 * - firing: `AutoFire` + `BulletPool` (core decides when to fire and at what);
 * - health: `HealthState` (core decides i-frames and the heart cap).
 *
 * It does not run from `update()`: bootstrap calls `step()` so the frame order is
 * deterministic (player → enemy → bullets → collisions), the same as `core/sim/run-simulation.ts`.
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
import { FEEL_TUNING } from '../core/enemies/tuning';
import { ROOM_EDGE_MARGIN_TILES } from '../core/enemies/behaviours';
import { squashScale } from '../core/feel/squash';
import { ROOM_COLS, ROOM_ROWS, type LevelData } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { normalizeMoveInput, velocityFromInput } from '../core/movement/move-intent';
import { SeededRng } from '../core/rng';
import { computeDerivedStats, type DerivedStats } from '../core/skills/derived-stats';
import {
  ELEMENT_TINTS,
  effectsLayers,
  showAura,
  strongestElement,
  type EffectsMode,
  type VfxElement,
} from '../core/vfx/weapon-vfx';
import { SpriteAnimator } from './anim/sprite-animator';
import { KeyboardMove } from './keyboard-move';
import { playSfx } from './audio/sfx';
import type { FxPool } from './fx/effect-pool';
import { ACTOR_FEET_OFFSET_TILES, tileToWorld } from './level-view';

const { ccclass } = _decorator;

/** `cc` is an any module: import names only work in value position. */
type Color = InstanceType<typeof CocosColor>;
type Sprite = InstanceType<typeof CocosSprite>;

/** Shield / hit tint (state is readable without a dedicated icon). */
const PLAYER_NO_TINT = new CocosColor(255, 255, 255, 255);
const PLAYER_SHIELD_TINT = new CocosColor(150, 225, 255, 255);
const PLAYER_HURT_TINT = new CocosColor(255, 150, 150, 255);
/** Muzzle flash colour: warm yellow, readable on every chapter background. */
const MUZZLE_TINT = new CocosColor(255, 238, 170, 255);
/** How long the hit / block tint stays on, ms. */
const PLAYER_TINT_MS = 140;

/** Player bullet radius, tiles — same convention as `run-simulation.ts`. */
const BULLET_RADIUS_TILES = 0.15;

/**
 * A bullet must live long enough to cover the auto-aim range, otherwise "8 tile range" in
 * `config/tuning.json` is only a number on paper. Same formula as the sim.
 */
const PLAYER_BULLET_TTL_MS = Math.max(
  1200,
  Math.ceil(
    (DEFAULT_COMBAT.targetingRangeTiles / DEFAULT_COMBAT.projectileSpeedTilesPerSecond) *
      1000 *
      1.5,
  ),
);

/** How long the `player.hit.*` frame stays after a hit (GDD §3: it must read as "I just got hit"). */
const HIT_ANIM_MS = 150;

/** Cached `cc.Color` per element — the aura is re-applied every frame and must not allocate. */
const AURA_COLORS: Readonly<Record<VfxElement, Color>> = {
  fire: new CocosColor(ELEMENT_TINTS.fire.r, ELEMENT_TINTS.fire.g, ELEMENT_TINTS.fire.b, 255),
  ice: new CocosColor(ELEMENT_TINTS.ice.r, ELEMENT_TINTS.ice.g, ELEMENT_TINTS.ice.b, 255),
  poison: new CocosColor(ELEMENT_TINTS.poison.r, ELEMENT_TINTS.poison.g, ELEMENT_TINTS.poison.b, 255),
  homing: new CocosColor(ELEMENT_TINTS.homing.r, ELEMENT_TINTS.homing.g, ELEMENT_TINTS.homing.b, 255),
  crit: new CocosColor(ELEMENT_TINTS.crit.r, ELEMENT_TINTS.crit.g, ELEMENT_TINTS.crit.b, 255),
};

/** Default facing while there is no input. */
const START_FACING: Direction = 'down';

export interface PlayerInitArgs {
  readonly manifest: AnimationManifest;
  /** Spawn position in `LevelData` tile space, y down. */
  readonly startAt: Vec2;
  /** Run RNG for per-bullet crit (same source as skill rolls). */
  readonly rng?: SeededRng;
  /** FX pool (shield block). */
  readonly fx?: FxPool;
}

@ccclass('PlayerController')
export class PlayerController extends Component {
  private readonly health = new HealthState(DEFAULT_COMBAT);
  private autoFire = AutoFire.fromRate(DEFAULT_COMBAT.fireRatePerSecond);
  private readonly bulletPool = new BulletPool();
  /** Current stats after skills — every calculation uses this object, never DEFAULT_COMBAT. */
  private stats: DerivedStats = computeDerivedStats(new Map<string, number>());
  private shield = new ShieldCharger(0, 0);
  private rng = SeededRng.fromSeed(1);
  private fx: FxPool | null = null;
  /** Live loadout (skill id → stacks) — drives the aura decision, cached until it changes. */
  private loadout: ReadonlyMap<string, number> = new Map();
  private effectsMode: EffectsMode = 'full';
  private auraDirty = true;
  private auraOn = false;
  private auraElement: VfxElement | null = null;
  private auraShown = false;
  /** Reused position (the aura is re-applied every frame; no object per frame). */
  private readonly auraAt = { x: 0, y: 0 };
  private sprite: Sprite | null = null;
  private tintUntilMs = 0;
  private tint: Color = PLAYER_NO_TINT;
  private readonly keyboard = new KeyboardMove();

  /** Current position in `LevelData`'s **tile** space (y down), not world space. */
  private tilePosition: Vec2 = { x: 0, y: 0 };
  private facing: Direction = START_FACING;
  private animator: SpriteAnimator | null = null;
  private animKey = '';
  private animDirection: Direction | null = null;
  private attackUntilMs = 0;
  private hitUntilMs = 0;
  private attackAnimMs = 0;
  /** Node base scale (ACTOR_SCALE) — squash always multiplies from this, so it never drifts. */
  private baseScale = 1;
  /** Squash start time and its parameters; when time is up it returns exactly to `baseScale`. */
  private squashStartMs = Number.NEGATIVE_INFINITY;
  private squashDurationMs = 0;
  private squashAmount = 0;
  /** Knockback running after a hit; `null` = not being pushed. */
  private knockback: KnockbackState | null = null;

  /** Player bullets in flight — `bullet-view` reads this pool every frame. */
  get bullets(): BulletPool {
    return this.bulletPool;
  }

  /** Position in `LevelData` tile space (y down), shared with enemies/bullets. */
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

  /** Stats after skills — CombatLoop reads them to apply crit/pierce/explosion/lifesteal/thorns. */
  get derivedStats(): DerivedStats {
    return this.stats;
  }

  get shieldCharges(): number {
    return this.shield.charges;
  }

  get shieldMaxCharges(): number {
    return this.shield.maxCharges;
  }

  /** Heal (lifesteal, Second Wind, Vitality on pickup). Returns hearts after healing. */
  heal(amount: number): number {
    return this.health.heal(amount);
  }

  /** New loadout: the aura decision (visible + colour) is recomputed once, not every frame. */
  setLoadout(owned: ReadonlyMap<string, number>): void {
    this.loadout = owned;
    this.auraDirty = true;
  }

  /** `Settings.effects` — Reduced hides the aura (impacts/telegraphs stay). */
  setEffectsMode(mode: EffectsMode): void {
    this.effectsMode = mode;
    this.auraDirty = true;
  }

  /** A skill was just acquired: one boost burst at the player's feet (off under Reduced effects). */
  playSkillBoost(): void {
    if (!effectsLayers(this.effectsMode).aura) return;
    this.fx?.spawn('fx.boost', {
      x: this.tilePosition.x,
      y: this.tilePosition.y + FEEL_TUNING.vfx.auraOffsetTiles,
    });
  }

  /**
   * Apply a new loadout (skill pickup or debug `grantSkill`).
   *
   * `healNow` is Vitality's one-shot effect. The shield is recreated at full charge when the
   * stack count changes; between pickups, `ShieldCharger` regenerates on its own every 20 s.
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

  /** Call once after `addComponent`, before the first frame. */
  init(args: PlayerInitArgs): void {
    this.animator = this.getComponent(SpriteAnimator);
    this.sprite = this.getComponent(CocosSprite);
    this.baseScale = this.node.scale.x > 0 ? this.node.scale.x : 1;
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

  /** Reset the position when entering a new room; health is untouched (it lasts the whole run). */
  teleport(at: Vec2): void {
    this.tilePosition = { x: at.x, y: at.y };
    // On a room change, the old room's knockback must not carry over.
    this.knockback = null;
    this.syncNodePosition();
  }

  /**
   * One player frame. `targets` is collected by bootstrap from living `EnemyView`s.
   * `nowMs` is the run clock (not `Date.now`) so i-frames and animation share one
   * timeline, and so tests can reproduce it.
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
    // `normalizeMoveInput` uses screen convention: up = +y. Tile data has y pointing
    // **down**, so flip the y sign exactly once, here.
    const moveIntent: Vec2 = { x: input2D.x, y: -input2D.y };
    const moving = moveIntent.x !== 0 || moveIntent.y !== 0;

    if (moving) {
      const previousFacing = this.facing;
      this.facing = directionFromVector(moveIntent, this.facing);
      // A turn gets a small "pop" so movement carries weight.
      if (this.facing !== previousFacing) {
        this.startSquash(
          nowMs,
          FEEL_TUNING.squash.playerTurnMs,
          FEEL_TUNING.squash.playerTurnAmount,
        );
      }
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
    this.updateAura();
    this.playCurrentAnimation(nowMs, moving);
    this.applyStateTint(nowMs);
    this.applySquash(nowMs);
  }

  /**
   * Take damage; `HealthState` decides i-frames and the heart cap. Returns `true` when the
   * hit really lands (for later logs/FX).
   */
  applyDamage(nowMs: number, amount: number, source: Vec2 | null = null): boolean {
    // The shield blocks before i-frames: a blocked hit costs no i-frame and no knockback.
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
      // On death `step()` stops running: a half-finished squash would freeze, so reset the base scale.
      this.node.setScale(this.baseScale, this.baseScale, 1);
      this.fx?.setAura(null, null);
      this.auraShown = false;
      this.playAnimation('player.dead');
      playSfx('game-over');
      return true;
    }

    this.startSquash(
      nowMs,
      FEEL_TUNING.squash.playerHurtMs,
      FEEL_TUNING.squash.playerHurtAmount,
    );

    if (source !== null) {
      this.knockback = startKnockback(this.tilePosition, source, {
        distanceTiles: DEFAULT_COMBAT.playerKnockbackDistanceTiles,
        durationMs: DEFAULT_COMBAT.playerKnockbackDurationMs,
      });
    }
    return true;
  }

  /** Knockback is applied after input, so holding a key cannot pin you in place when hit. */
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

    // Small muzzle flash at the barrel tip: same FX pool, no new node per shot.
    this.fx?.spawn(
      'fx.impact',
      {
        x: shot.origin.x + shot.direction.x * FEEL_TUNING.muzzle.offsetTiles,
        y: shot.origin.y + shot.direction.y * FEEL_TUNING.muzzle.offsetTiles,
      },
      {
        drawUnits: FEEL_TUNING.muzzle.drawUnits,
        lifetimeMs: FEEL_TUNING.muzzle.lifetimeMs,
        tint: MUZZLE_TINT,
      },
    );
    playSfx('shoot');
  }

  /**
   * Start one squash/stretch (multiplied from `baseScale`, never accumulated). A new hit
   * while the old one runs wins — the node never drifts more than one deformation away
   * from its base scale.
   */
  private startSquash(nowMs: number, durationMs: number, amount: number): void {
    if (!(durationMs > 0) || amount === 0) return;
    this.squashStartMs = nowMs;
    this.squashDurationMs = durationMs;
    this.squashAmount = amount;
  }

  private applySquash(nowMs: number): void {
    const squash = squashScale(
      nowMs - this.squashStartMs,
      this.squashDurationMs,
      this.squashAmount,
    );
    this.node.setScale(this.baseScale * squash.x, this.baseScale * squash.y, 1);
  }

  /**
   * State tint: red after a hit, blue while shield charges remain. This is the M4
   * "shield icon/tint" — looking at the character tells you whether the shield still holds.
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
    // The throw pose only reads when standing still; running keeps the walk cycle (ticket #3).
    if (!moving && nowMs < this.attackUntilMs) {
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

  /** Only `play` when the clip or direction changes — `play` resets time, so calling it every frame freezes. */
  private playAnimation(key: string, direction?: Direction): void {
    const sameDirection = direction === undefined || this.animDirection === direction;
    if (this.animKey === key && sameDirection) return;

    this.animKey = key;
    this.animDirection = direction ?? this.animDirection;
    this.animator?.play(key, direction);
  }

  /**
   * Aura at the feet: visible with ≥ 8 stacks or any Epic skill, tinted by the strongest
   * element, hidden entirely under Reduced effects. The **decision** is cached on
   * `setLoadout`/`setEffectsMode`; the frame only moves the ring to follow the player.
   */
  private updateAura(): void {
    const fx = this.fx;
    if (fx === null) return;

    if (this.auraDirty) {
      this.auraDirty = false;
      this.auraOn = effectsLayers(this.effectsMode).aura && showAura(this.loadout);
      this.auraElement = strongestElement(this.loadout);
    }

    if (!this.auraOn) {
      if (this.auraShown) {
        fx.setAura(null, null);
        this.auraShown = false;
      }
      return;
    }

    this.auraShown = true;
    this.auraAt.x = this.tilePosition.x;
    this.auraAt.y = this.tilePosition.y + FEEL_TUNING.vfx.auraOffsetTiles;
    fx.setAura(
      this.auraAt,
      this.auraElement === null ? null : AURA_COLORS[this.auraElement],
      FEEL_TUNING.vfx.auraDrawUnits,
    );
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
