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
import {
  _decorator,
  Color as CocosColor,
  Component,
  Node as CocosNode,
  Sprite as CocosSprite,
} from 'cc';
import type { AttachmentsData } from '../core/art/attachments';
import type { AnimationManifest, Direction } from '../core/art/manifest';
import { resolve } from '../core/art/manifest';
import { directionFromVector, loopDurationMs } from '../core/art/runtime';
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  characterAnimationKeys,
  type CharacterAnimKind,
  type CharacterDef,
  type CharacterId,
} from '../core/characters/roster';
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
import type { LevelData } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { dashVelocity, isDashing, type DashState } from '../core/input/dash';
import { moveWithCollision } from '../core/movement/collision';
import {
  RoomClearSpeedBoost,
  normalizeMoveInput,
  velocityFromInput,
} from '../core/movement/move-intent';
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
import { PLAYER_RADIUS_TILES } from './combat-loop';
import { KeyboardMove, type KeyboardMoveCallbacks } from './keyboard-move';
import { playDashSfx, playSfx } from './audio/sfx';
import type { FxPool } from './fx/effect-pool';
import { ACTOR_FEET_OFFSET_TILES, tileToWorld } from './level-view';
import {
  PLAYER_BODY_NODE_NAME,
  PlayerAttachmentView,
  type PlayerAttachmentSnapshot,
} from './player-attachment-view';

const { ccclass } = _decorator;

/** `cc` is an any module: import names only work in value position. */
type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
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

/** Visual child node bundle created by `setupPlayerVisualNodes`. */
export interface PlayerVisualNodes {
  /** Child node (`player-body`) holding the player's `Sprite` and `SpriteAnimator`. */
  readonly bodyNode: Node;
  readonly bodySprite: Sprite;
  readonly animator: SpriteAnimator;
}

/**
 * Create (or reuse) the `player-body` child node under the `player` container node.
 *
 * Cocos 3.8 Batcher2D always renders a parent's own `Sprite` before its children regardless of
 * sibling index. Keeping `player` sprite-free and placing `player-body` and `player-attachment`
 * as sibling children lets `setSiblingIndex(behind ? 0 : 1)` genuinely draw back/hand items
 * behind or in front of the body.
 */
export function setupPlayerVisualNodes(playerNode: Node): PlayerVisualNodes {
  let bodyNode = playerNode.getChildByName(PLAYER_BODY_NODE_NAME);
  if (bodyNode === null) {
    bodyNode = new CocosNode(PLAYER_BODY_NODE_NAME);
    bodyNode.parent = playerNode;
  }

  let bodySprite = bodyNode.getComponent(CocosSprite);
  if (bodySprite === null) {
    bodySprite = bodyNode.addComponent(CocosSprite);
    bodySprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    bodySprite.trim = false;
  }

  let animator = bodyNode.getComponent(SpriteAnimator);
  if (animator === null) {
    animator = bodyNode.addComponent(SpriteAnimator);
  }

  return { bodyNode, bodySprite, animator };
}

export interface PlayerInitArgs {
  readonly manifest: AnimationManifest;
  /** Spawn position in `LevelData` tile space, y down. */
  readonly startAt: Vec2;
  /** Run RNG for per-bullet crit (same source as skill rolls). */
  readonly rng?: SeededRng;
  /** FX pool (shield block). */
  readonly fx?: FxPool;
  /** Playable character definition (defaults to `CHARACTERS[DEFAULT_CHARACTER_ID]`). */
  readonly character?: CharacterDef;
  /** Validated `attachments.json` rig data, or `null` when unavailable. */
  readonly attachments?: AttachmentsData | null;
  /**
   * Sibling body node (`player-body`) holding `CocosSprite` + `SpriteAnimator`.
   * When omitted, `init()` reuses an existing `player-body` child, falls back to a legacy
   * single-node `player` with `Sprite`/`SpriteAnimator`, or creates `player-body` via
   * `setupPlayerVisualNodes(this.node)`.
   */
  readonly bodyNode?: Node;
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
  private manifest: AnimationManifest | null = null;
  private character: CharacterDef = CHARACTERS[DEFAULT_CHARACTER_ID];
  /** Live loadout (skill id → stacks) — drives the aura decision, cached until it changes. */
  private loadout: ReadonlyMap<string, number> = new Map();
  private effectsMode: EffectsMode = 'full';
  private auraDirty = true;
  private auraOn = false;
  private auraElement: VfxElement | null = null;
  private auraShown = false;
  /** Reused position (the aura is re-applied every frame; no object per frame). */
  private readonly auraAt = { x: 0, y: 0 };
  private bodyNode: Node | null = null;
  private sprite: Sprite | null = null;
  private attachmentView: PlayerAttachmentView | null = null;
  private tintUntilMs = 0;
  private tint: Color = PLAYER_NO_TINT;
  private readonly keyboard = new KeyboardMove();

  /** Current position in `LevelData`'s **tile** space (y down), not world space. */
  private tilePosition: Vec2 = { x: 0, y: 0 };
  private facing: Direction = START_FACING;
  private animator: SpriteAnimator | null = null;
  private animKey = '';
  private animDirection: Direction | null = null;
  private attachmentAnimName = 'idle';
  private lastAttachmentAnim = '';
  private lastAttachmentDir: Direction | null = null;
  private lastAttachmentFrame = -1;
  private attackUntilMs = 0;
  private hitUntilMs = 0;
  private attackAnimMs = 0;
  private postDashFireUntilMs = Number.NEGATIVE_INFINITY;
  private readonly currentVelocity: { x: number; y: number } = { x: 0, y: 0 };
  /** Node base scale (ACTOR_SCALE) — squash always multiplies from this, so it never drifts. */
  private baseScale = 1;
  /** Squash start time and its parameters; when time is up it returns exactly to `baseScale`. */
  private squashStartMs = Number.NEGATIVE_INFINITY;
  private squashDurationMs = 0;
  private squashAmount = 0;
  /** Knockback running after a hit; `null` = not being pushed. */
  private knockback: KnockbackState | null = null;
  /** M17 room-clear +45% movement speed boost (resets immediately on next room entry). */
  private readonly roomClearBoost = new RoomClearSpeedBoost(DEFAULT_COMBAT.roomClearSpeedMultiplier);
  private footDustCooldownMs = 0;

  /** Active playable character id for this run. */
  get characterId(): CharacterId {
    return this.character.id;
  }

  /** Active playable character definition for this run. */
  get characterDef(): CharacterDef {
    return this.character;
  }

  /** Hide the worn/held attachment while `skillId` is active (e.g. `'ten-thousand-swords'`). */
  hideAttachmentForSkill(skillId: string): void {
    this.attachmentView?.hideForSkill(skillId);
  }

  /** End a skill's attachment hide request for `skillId`. */
  showAttachmentForSkill(skillId: string): void {
    this.attachmentView?.showForSkill(skillId);
  }

  /** Imperatively hide or unhide the player's attachment sprite. */
  setAttachmentHidden(hidden: boolean): void {
    this.attachmentView?.setHidden(hidden);
  }

  /** Current attachment state snapshot for debug/acceptance hooks (`window.__yokai`). */
  getAttachmentSnapshot(): PlayerAttachmentSnapshot | null {
    return this.attachmentView?.getSnapshot() ?? null;
  }

  /** Current facing cardinal direction. */
  get facingDirection(): Direction {
    return this.facing;
  }

  /**
   * Switch the active playable character mid-run (used by `?debug=1` `__yokai.selectCharacter`).
   * Rebinds animation keys and rebuilds `PlayerAttachmentView` cleanly without moving the player.
   */
  switchCharacter(character: CharacterDef, attachments: AttachmentsData | null): void {
    const manifest = this.manifest;
    if (manifest === null) return;

    this.attachmentView?.destroy();
    this.attachmentView = null;

    this.character = character;
    const attackKeys = characterAnimationKeys(this.character, 'attack', this.facing);
    this.attackAnimMs = Math.max(
      1,
      loopDurationMs(resolve(manifest, attackKeys.key, attackKeys.fallback)),
    );

    this.animKey = '';
    this.animDirection = null;
    this.attachmentAnimName = 'idle';
    this.lastAttachmentAnim = '';
    this.lastAttachmentDir = null;
    this.lastAttachmentFrame = -1;
    this.playCharacterAnimation('idle', this.facing);

    this.attachmentView = new PlayerAttachmentView({
      parent: this.node,
      bodyNode: this.bodyNode ?? this.node,
      manifest,
      attachments,
      character: this.character,
      initialPose: {
        animation: this.attachmentAnimName,
        direction: this.facing,
        frame: this.animator?.frameIndex ?? 0,
      },
    });
    this.syncAttachmentPose(true);
  }

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

  /** 100-scale HP aliases (identical to `hearts` / `maxHearts`). */
  get hp(): number {
    return this.health.current;
  }

  get maxHp(): number {
    return this.health.max;
  }

  /** Toggle M17 room-clear +45% speed boost (always reset on room entry). */
  setRoomClearSpeedBoost(active: boolean): void {
    if (active) {
      this.roomClearBoost.onCombatRoomCleared();
    } else {
      this.roomClearBoost.onEnterRoom();
      this.footDustCooldownMs = 0;
    }
  }

  get isRoomClearSpeedBoostActive(): boolean {
    return this.roomClearBoost.active;
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

  /**
   * Restore exact hearts when resuming an `ActiveRunSave` or continuing Endless (M15)
   * without triggering hurt animation, SFX, or i-frames.
   */
  restoreHearts(hearts: number): number {
    const clamped = Math.max(1, Math.min(this.health.max, Math.floor(hearts)));
    return this.health.setHearts(clamped);
  }

  /**
   * Immediately kill the player bypassing i-frames, shield, and Iron Skin (used by `?debug=1`
   * `__yokai.triggerDeath`). Plays the standard death animation and SFX.
   */
  forceKill(): void {
    if (this.health.isDead) return;
    this.health.setHearts(0);
    this.node.setScale(this.baseScale, this.baseScale, 1);
    this.fx?.setAura(null, null);
    this.auraShown = false;
    this.attachmentView?.clearHidden();
    this.playCharacterAnimation('dead');
    this.syncAttachmentPose(true);
    playSfx('game-over');
  }

  /** Grant `durationMs` of i-frames at `nowMs` without dealing damage (M12 level-up resume). */
  grantInvulnerability(nowMs: number, durationMs: number): void {
    this.health.grantInvulnerability(nowMs, durationMs);
  }

  /** Remaining player i-frames at `nowMs` in milliseconds (`0` when vulnerable). */
  remainingInvulnerabilityMs(nowMs: number): number {
    return this.health.remainingInvulnerabilityMs(nowMs);
  }

  isInvulnerable(nowMs: number): boolean {
    return this.health.isInvulnerable(nowMs);
  }

  /** Current movement velocity in tile units/second (y down) for Tier-2 predictive enemy aim. */
  get velocity(): Vec2 {
    return this.currentVelocity;
  }

  /** Current WASD move intent in tile space (y down), or `{ x: 0, y: 0 }` when idle. */
  moveDirectionTile(): Vec2 {
    const input2D = normalizeMoveInput(this.keyboard.keys);
    return { x: input2D.x, y: -input2D.y };
  }

  /** Current facing unit vector in tile space (y down) for Dash / Signature Active fallback aim. */
  facingVectorTile(): Vec2 {
    switch (this.facing) {
      case 'up':
        return { x: 0, y: -1 };
      case 'down':
        return { x: 0, y: 1 };
      case 'left':
        return { x: -1, y: 0 };
      case 'right':
        return { x: 1, y: 0 };
    }
  }

  /** Bind Dash (`Space`) and Signature Active (`KeyE`/Right-Click) input callbacks. */
  setActionHandlers(callbacks: KeyboardMoveCallbacks): void {
    this.keyboard.onDash = callbacks.onDash ?? null;
    this.keyboard.onActive = callbacks.onActive ?? null;
    this.keyboard.isGameplayActive = callbacks.isGameplayActive ?? null;
  }

  /** Clear held movement keys when pausing or opening a modal so keys never stick on resume. */
  resetInput(): void {
    this.keyboard.keys.reset();
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
    this.attachmentView?.destroy();
    this.attachmentView = null;

    this.manifest = args.manifest;
    this.character = args.character ?? CHARACTERS[DEFAULT_CHARACTER_ID];
    this.bindVisualNodes(args.bodyNode);

    this.baseScale = this.node.scale.x > 0 ? this.node.scale.x : 1;
    if (args.rng !== undefined) this.rng = args.rng;
    this.fx = args.fx ?? null;

    const attackKeys = characterAnimationKeys(this.character, 'attack', START_FACING);
    this.attackAnimMs = Math.max(
      1,
      loopDurationMs(resolve(args.manifest, attackKeys.key, attackKeys.fallback)),
    );

    this.tilePosition = { x: args.startAt.x, y: args.startAt.y };
    this.facing = START_FACING;
    this.animKey = '';
    this.animDirection = null;
    this.attachmentAnimName = 'idle';
    this.lastAttachmentAnim = '';
    this.lastAttachmentDir = null;
    this.lastAttachmentFrame = -1;
    this.syncNodePosition();
    this.playCharacterAnimation('idle', START_FACING);

    this.attachmentView = new PlayerAttachmentView({
      parent: this.node,
      bodyNode: this.bodyNode ?? this.node,
      manifest: args.manifest,
      attachments: args.attachments ?? null,
      character: this.character,
      initialPose: {
        animation: this.attachmentAnimName,
        direction: this.facing,
        frame: this.animator?.frameIndex ?? 0,
      },
    });
    this.syncAttachmentPose(true);
  }

  /** Reset the position when entering a new room; health is untouched (it lasts the whole run). */
  teleport(at: Vec2): void {
    this.tilePosition = { x: at.x, y: at.y };
    // On a room change, the old room's knockback, post-dash buff, speed boost, and skill-hidden attachment must reset.
    this.knockback = null;
    this.postDashFireUntilMs = Number.NEGATIVE_INFINITY;
    this.roomClearBoost.onEnterRoom();
    this.footDustCooldownMs = 0;
    this.currentVelocity.x = 0;
    this.currentVelocity.y = 0;
    this.attachmentView?.clearHidden();
    this.syncNodePosition();
  }

  /** Begin a Dash: grant dodge i-frames (no hurt flash), trigger Roll anim, and activate Afterimage. */
  startDash(nowMs: number, dashState: DashState): void {
    if (this.health.isDead) return;

    if (dashState.invulnerableRemainingMs > 0) {
      this.health.grantInvulnerability(nowMs, dashState.invulnerableRemainingMs);
    }
    if (this.stats.postDashFireRate !== undefined && this.stats.postDashFireRate.durationMs > 0) {
      this.postDashFireUntilMs = Math.max(
        this.postDashFireUntilMs,
        nowMs + this.stats.postDashFireRate.durationMs,
      );
    }

    this.facing = directionFromVector(
      { x: dashState.direction.x, y: -dashState.direction.y },
      this.facing,
    );
    this.animator?.setPlaybackScale(1);
    this.playCharacterAnimation('dash', this.facing);
    this.syncAttachmentPose();
    this.startSquash(nowMs, 110, 0.14);

    if (effectsLayers(this.effectsMode).secondaryParticles) {
      this.fx?.spawn('fx.smoke', this.tilePosition, { drawUnits: 1.3, lifetimeMs: 260 });
    }
    playDashSfx();
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
    dashState: DashState | null = null,
    fireRateBonus = 0,
  ): void {
    if (this.health.isDead) return;

    this.shield.update(nowMs);

    const dashing = dashState !== null && isDashing(dashState);
    const input2D = normalizeMoveInput(this.keyboard.keys);
    // `normalizeMoveInput` uses screen convention: up = +y. Tile data has y pointing
    // **down**, so flip the y sign exactly once, here.
    const moveIntent: Vec2 = { x: input2D.x, y: -input2D.y };
    const moving = dashing || moveIntent.x !== 0 || moveIntent.y !== 0;
    const seconds = deltaMs / 1000;

    if (dashing && dashState !== null) {
      const velocity = dashVelocity(dashState, this.stats.dashSpeedMult);
      this.currentVelocity.x = velocity.x;
      this.currentVelocity.y = velocity.y;
      this.facing = directionFromVector(
        { x: dashState.direction.x, y: -dashState.direction.y },
        this.facing,
      );
      this.tilePosition = moveWithCollision(
        this.tilePosition,
        { x: velocity.x * seconds, y: velocity.y * seconds },
        PLAYER_RADIUS_TILES,
        level,
        ROOM_EDGE_MARGIN_TILES,
      );
      this.syncNodePosition();
    } else if (moving) {
      const previousFacing = this.facing;
      // `directionFromVector` uses screen-space y-up (`+y` = `'up'`), matching `input2D` rather
      // than tile-space y-down `moveIntent`.
      this.facing = directionFromVector(input2D, this.facing);
      // A turn gets a small "pop" so movement carries weight.
      if (this.facing !== previousFacing) {
        this.startSquash(
          nowMs,
          FEEL_TUNING.squash.playerTurnMs,
          FEEL_TUNING.squash.playerTurnAmount,
        );
      }
      const effectiveSpeed = this.roomClearBoost.apply(this.stats.moveSpeedTilesPerSecond);
      const velocity = velocityFromInput(moveIntent, effectiveSpeed);
      this.currentVelocity.x = velocity.x;
      this.currentVelocity.y = velocity.y;
      // Obstacles and the room edge are solid: same rule as the enemies and the balance sim.
      this.tilePosition = moveWithCollision(
        this.tilePosition,
        { x: velocity.x * seconds, y: velocity.y * seconds },
        PLAYER_RADIUS_TILES,
        level,
        ROOM_EDGE_MARGIN_TILES,
      );
      this.syncNodePosition();

      // Subtle foot-wind/dust streak VFX while room-clear +45% speed boost is active.
      if (this.roomClearBoost.active && effectsLayers(this.effectsMode).secondaryParticles) {
        this.footDustCooldownMs -= deltaMs;
        if (this.footDustCooldownMs <= 0) {
          this.footDustCooldownMs = 120;
          this.fx?.spawn(
            'fx.smoke',
            { x: this.tilePosition.x, y: this.tilePosition.y + 0.35 },
            { drawUnits: 0.7, lifetimeMs: 210 },
          );
        }
      }
    } else {
      this.currentVelocity.x = 0;
      this.currentVelocity.y = 0;
    }

    if (!dashing) {
      this.applyKnockback(deltaMs, level);
    }
    const postDash = this.stats.postDashFireRate;
    const postDashDeltaMs =
      postDash !== undefined && nowMs < this.postDashFireUntilMs
        ? deltaMs * (1 + Math.max(0, postDash.bonus))
        : deltaMs;
    // M20 Ninja *Bom Khói Ẩn Thân* (#84): fire faster while standing in a smoke zone.
    const fireDeltaMs = postDashDeltaMs * (1 + Math.max(0, fireRateBonus));
    this.fireIfReady(nowMs, fireDeltaMs, targets);
    this.updateAura();
    this.playCurrentAnimation(nowMs, moving, dashing);
    this.syncAttachmentPose();
    this.applyStateTint(nowMs);
    this.applySquash(nowMs);
  }

  /**
   * Take damage; `HealthState` decides i-frames and the heart cap. Returns `true` when the
   * hit really lands (for later logs/FX).
   */
  applyDamage(nowMs: number, amount: number, source: Vec2 | null = null): boolean {
    // Respect Dash, hit, and level-up i-frames before consuming a Shield charge or rolling Iron Skin.
    if (this.health.isDead || this.health.isInvulnerable(nowMs)) {
      return false;
    }

    // The shield blocks before heart damage: a blocked hit costs no hit i-frame and no knockback.
    if (this.shield.tryBlock(nowMs)) {
      this.tintUntilMs = nowMs + PLAYER_TINT_MS;
      this.tint = PLAYER_SHIELD_TINT;
      this.fx?.spawn('fx.shield', this.tilePosition, { lifetimeMs: 450 });
      playSfx('shield');
      return true;
    }

    // Iron Skin: chance to ward off incoming hit damage completely.
    if (this.stats.damageReductionChance > 0 && this.rng.next() < this.stats.damageReductionChance) {
      this.health.grantInvulnerability(nowMs, Math.min(350, this.stats.invulnerabilityMs));
      this.tintUntilMs = nowMs + PLAYER_TINT_MS;
      this.tint = PLAYER_SHIELD_TINT;
      this.fx?.spawn('fx.spark', this.tilePosition, { tint: PLAYER_SHIELD_TINT, drawUnits: 1.2 });
      playSfx('shield');
      return false;
    }

    const result = this.health.tryDamage(amount, nowMs);
    if (!result.applied) return false;

    this.hitUntilMs = nowMs + HIT_ANIM_MS;
    this.tintUntilMs = nowMs + PLAYER_TINT_MS;
    this.tint = PLAYER_HURT_TINT;
    this.playCharacterAnimation('hit', this.facing);
    this.syncAttachmentPose();
    playSfx('player-hurt');

    if (result.dead) {
      // On death `step()` stops running: a half-finished squash would freeze, so reset the base scale.
      this.node.setScale(this.baseScale, this.baseScale, 1);
      this.fx?.setAura(null, null);
      this.auraShown = false;
      this.attachmentView?.clearHidden();
      this.playCharacterAnimation('dead');
      this.syncAttachmentPose(true);
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
      PLAYER_RADIUS_TILES,
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

  protected onDestroy(): void {
    this.attachmentView?.destroy();
    this.attachmentView = null;
  }

  protected lateUpdate(): void {
    if (!this.health.isDead) {
      this.syncAttachmentPose();
    }
  }

  private fireIfReady(nowMs: number, deltaMs: number, targets: readonly Targetable[]): void {
    const rangeTiles =
      this.stats.targetingRangeTiles > 0
        ? this.stats.targetingRangeTiles
        : DEFAULT_COMBAT.targetingRangeTiles;
    const speedTilesPerSecond =
      this.stats.projectileSpeedTilesPerSecond > 0
        ? this.stats.projectileSpeedTilesPerSecond
        : DEFAULT_COMBAT.projectileSpeedTilesPerSecond;

    const shot = this.autoFire.update({
      deltaMs,
      origin: this.tilePosition,
      targets,
      rangeTiles,
    });
    if (shot === null) return;

    const ttlMs = Math.max(1200, Math.ceil((rangeTiles / speedTilesPerSecond) * 1000 * 1.5));

    firePlayerVolley({
      pool: this.bulletPool,
      stats: this.stats,
      rng: this.rng,
      origin: shot.origin,
      direction: shot.direction,
      speedTilesPerSecond,
      radiusTiles: BULLET_RADIUS_TILES,
      ttlMs,
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
    const color =
      nowMs < this.tintUntilMs
        ? this.tint
        : this.shield.charges > 0
          ? PLAYER_SHIELD_TINT
          : PLAYER_NO_TINT;

    if (this.sprite !== null) {
      this.sprite.color = color;
    }
    const attachmentSprite = this.attachmentView?.sprite ?? null;
    if (attachmentSprite !== null) {
      attachmentSprite.color = color;
    }
  }

  private playCurrentAnimation(nowMs: number, moving: boolean, dashing = false): void {
    if (this.health.isDead) return;

    if (dashing) {
      this.animator?.setPlaybackScale(1);
      this.playCharacterAnimation('dash', this.facing);
      return;
    }
    if (nowMs < this.hitUntilMs) {
      this.playCharacterAnimation('hit', this.facing);
      return;
    }
    // The throw pose only reads when standing still; running keeps the walk cycle (ticket #3).
    if (!moving && nowMs < this.attackUntilMs) {
      this.playCharacterAnimation('attack', this.facing);
      return;
    }
    const clip: CharacterAnimKind = moving ? 'walk' : 'idle';
    this.animator?.setPlaybackScale(
      moving
        ? this.stats.moveSpeedTilesPerSecond / DEFAULT_COMBAT.moveSpeedTilesPerSecond
        : 1,
    );
    this.playCharacterAnimation(clip, this.facing);
  }

  /**
   * Resolve character animation keys + fallback and only `play` when the effective clip or
   * direction changes — `play` resets time, so calling it every frame freezes.
   */
  private playCharacterAnimation(kind: CharacterAnimKind, direction?: Direction): void {
    const dir = direction ?? this.facing;
    const { key, fallback } = characterAnimationKeys(this.character, kind, dir);
    const resolvedKey =
      this.manifest !== null && this.manifest.sprites[key] === undefined ? fallback : key;
    const sameDirection = direction === undefined || this.animDirection === direction;
    if (this.animKey === resolvedKey && sameDirection) return;

    this.animKey = resolvedKey;
    this.animDirection = direction ?? this.animDirection;
    this.attachmentAnimName = resolvedKey.split('.')[1] ?? kind;
    this.animator?.play(key, direction, fallback);
  }

  private bindVisualNodes(bodyNodeArg?: Node): void {
    if (bodyNodeArg !== undefined) {
      this.bodyNode = bodyNodeArg;
      let bodySprite = bodyNodeArg.getComponent(CocosSprite);
      if (bodySprite === null) {
        bodySprite = bodyNodeArg.addComponent(CocosSprite);
        bodySprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
        bodySprite.trim = false;
      }
      this.sprite = bodySprite;
      this.animator =
        bodyNodeArg.getComponent(SpriteAnimator) ?? bodyNodeArg.addComponent(SpriteAnimator);
      return;
    }

    const existingBody = this.node.getChildByName(PLAYER_BODY_NODE_NAME);
    if (existingBody !== null) {
      const visual = setupPlayerVisualNodes(this.node);
      this.bodyNode = visual.bodyNode;
      this.sprite = visual.bodySprite;
      this.animator = visual.animator;
      return;
    }

    const ownSprite = this.getComponent(CocosSprite);
    const ownAnimator = this.getComponent(SpriteAnimator);
    if (ownSprite !== null || ownAnimator !== null) {
      // Backwards compatibility for legacy callers that still attach Sprite/SpriteAnimator on `player`.
      this.bodyNode = this.node;
      this.sprite = ownSprite;
      this.animator = ownAnimator;
      return;
    }

    const visual = setupPlayerVisualNodes(this.node);
    this.bodyNode = visual.bodyNode;
    this.sprite = visual.bodySprite;
    this.animator = visual.animator;
  }

  private syncAttachmentPose(force = false): void {
    const view = this.attachmentView;
    if (view === null) return;

    const animation = this.attachmentAnimName;
    const direction = this.facing;
    const frame = this.animator?.frameIndex ?? 0;

    if (
      !force &&
      this.lastAttachmentAnim === animation &&
      this.lastAttachmentDir === direction &&
      this.lastAttachmentFrame === frame
    ) {
      return;
    }

    this.lastAttachmentAnim = animation;
    this.lastAttachmentDir = direction;
    this.lastAttachmentFrame = frame;
    view.updatePose({ animation, direction, frame });
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
