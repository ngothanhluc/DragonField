/**
 * The real boss (GDD §5): pack art + the `core/boss/patterns.ts` state machine.
 *
 * The adapter does only 4 things:
 *
 * 1. Call `stepBoss` every frame with **flat** state (position is the source of truth,
 *    read straight from state rather than interpolating `move` events).
 * 2. Turn events into visuals: play animations, telegraph rings, real bullets in the same
 *    enemy `BulletPool`, summons through a callback.
 * 3. Draw the phase cue: sprite tint + telegraph ring colour + banner callback.
 *    Each phase has its own colour/brightness so the player can read a phase change
 *    even while dodging.
 * 4. Take damage from `CombatLoop` (player bullets) and report death via `isDefeated`.
 *
 * No bespoke AI, no hardcoded patterns: every step lives in core and already has
 * tests forcing a telegraph before every attack.
 */
import {
  Color as CocosColor,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import { animationFor, type BossDef, type BossId, type BossPhase } from '../core/boss/boss-defs';
import {
  bulletVelocity,
  initialBossState,
  isBossDefeated,
  isBossInIntro,
  stepBoss,
  TELEPORT_SNAP_SPEED_TILES_PER_SECOND,
  type BossEvent,
  type BossState,
} from '../core/boss/patterns';
import type { BulletPool } from '../core/combat/bullets';
import { accumulateDamage } from '../core/combat/integer-damage';
import { telegraphProgress } from '../core/combat/telegraph';
import { FEEL_TUNING } from '../core/enemies/tuning';
import type { ScreenShake } from '../core/feel/screen-shake';
import { squashScale } from '../core/feel/squash';
import type { EnemyRole } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import type { SeededRng } from '../core/rng';
import { SpriteAnimator } from './anim/sprite-animator';
import { playSfx } from './audio/sfx';
import { loadTelegraphFrames } from './enemy-view';
import type { FxPool } from './fx/effect-pool';
import { ACTOR_SCALE, BOSS_FEET_OFFSET_TILES, tileToWorld } from './level-view';

/** `cc` is an any module: types must be derived from the import value. */
type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = Awaited<ReturnType<typeof loadTelegraphFrames>>[number];

/** Boss bullets live 10 s — enough to cross the arena diagonal at the slowest speed. */
const BOSS_BULLET_TTL_MS = 10_000;
const RING_RECT_SIZE = 32;
const RING_FRAMES = 4;
const RING_MAX_OPACITY = 220;
const RING_MIN_OPACITY = 80;
/** Hit flash duration, ms. */
const HIT_FLASH_MS = 80;

/** Tint colour by phase — the first cue (clear even from the silhouette alone). */
const PHASE_TINT: Readonly<Record<BossPhase, Color>> = {
  1: new CocosColor(255, 255, 255, 255),
  2: new CocosColor(170, 220, 255, 255),
  3: new CocosColor(255, 160, 150, 255),
};
/** Telegraph ring colour by phase — the second cue, independent of the body tint. */
const PHASE_RING: Readonly<Record<BossPhase, Color>> = {
  1: new CocosColor(255, 226, 120, 255),
  2: new CocosColor(120, 220, 255, 255),
  3: new CocosColor(255, 120, 90, 255),
};
const HIT_TINT = new CocosColor(255, 250, 225, 255);

export interface BossViewOptions {
  readonly def: BossDef;
  /** Initial standing spot, tile units (usually from `LevelData.bossStart`). */
  readonly start: Vec2;
  /** Live simulation clock when entering the boss room, ms (prevents frame-1 step skip). */
  readonly nowMs: number;
  readonly actorLayer: Node;
  readonly bullets: BulletPool;
  readonly rng: SeededRng;
  /** FX pool (boss death, sweep/zone telegraphs). */
  readonly fx?: FxPool;
  /** Optional camera shake for heavy slam zone bursts. */
  readonly shake?: ScreenShake;
  /** Called when the boss changes phase (bootstrap shows the banner). */
  readonly onPhase?: (phase: BossPhase) => void;
  /** Called when the pattern requests adds; CombatLoop spawns the EnemyView itself. */
  readonly onSummon?: (role: EnemyRole, count: number) => void;
  /** Ascension / Endless boss HP multiplier (M15, default `1`). */
  readonly healthMult?: number;
  /** Ascension / Endless boss damage multiplier (M15, default `1`). */
  readonly damageMult?: number;
  /** Ascension boss attack-speed multiplier (M15, default `1`). */
  readonly attackSpeedMult?: number;
}

export class BossView {
  private readonly def: BossDef;
  private readonly bullets: BulletPool;
  private readonly rng: SeededRng;
  private readonly onPhase: (phase: BossPhase) => void;
  private readonly onSummon: (role: EnemyRole, count: number) => void;
  private readonly fx: FxPool | null;
  private readonly shake: ScreenShake | null;
  private readonly scaledMaxHealth: number;
  private readonly damageMult: number;
  private readonly attackSpeedMult: number;
  private bossClockMs: number;
  private readonly node: Node;
  private readonly animator: SpriteAnimator;
  private readonly sprite: Sprite;
  private state: BossState;
  private defeated = false;
  /** Fractional damage that has not reached 1 HP yet (poison/crit/execute) — see `integer-damage.ts`. */
  private damageCarry = 0;

  private hitFlashUntilMs = Number.NEGATIVE_INFINITY;
  /** Squash start time on a bullet hit (multiplied from `ACTOR_SCALE`, never drifts). */
  private squashStartMs = Number.NEGATIVE_INFINITY;
  private ring: Sprite | null = null;
  private readonly ringFrames: SpriteFrame[] = [];
  private readonly ringTint = new CocosColor(255, 255, 255, 0);
  private ringVisible = false;
  private telegraphStartedMs = Number.NEGATIVE_INFINITY;
  private telegraphDurationMs = 0;
  /** Whether a charge is running (looping its animation) or just ended, to return to idle. */
  private charging = false;
  private lastAnimKey = '';

  constructor(options: BossViewOptions) {
    this.def = options.def;
    this.bullets = options.bullets;
    this.rng = options.rng;
    this.onPhase = options.onPhase ?? (() => undefined);
    this.onSummon = options.onSummon ?? (() => undefined);
    this.fx = options.fx ?? null;
    this.shake = options.shake ?? null;
    const healthMult =
      options.healthMult !== undefined &&
      Number.isFinite(options.healthMult) &&
      options.healthMult > 0
        ? options.healthMult
        : 1;
    this.scaledMaxHealth = Math.max(1, Math.round(options.def.maxHealth * healthMult));
    this.damageMult =
      options.damageMult !== undefined &&
      Number.isFinite(options.damageMult) &&
      options.damageMult > 0
        ? options.damageMult
        : 1;
    this.attackSpeedMult =
      options.attackSpeedMult !== undefined &&
      Number.isFinite(options.attackSpeedMult) &&
      options.attackSpeedMult > 0
        ? options.attackSpeedMult
        : 1;
    this.bossClockMs = options.nowMs;
    this.state = initialBossState(
      options.def.id,
      options.start,
      options.nowMs,
      undefined,
      healthMult !== 1 ? this.scaledMaxHealth : undefined,
    );

    const node = new CocosNode(`boss-${options.def.id}`);
    node.parent = options.actorLayer;

    const sprite: Sprite = node.addComponent(CocosSprite);
    // CUSTOM: the animator sets contentSize/anchor per frame (samurai 96×48 ↔ 96×96).
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
      // The boss still runs if FX fail — the telegraph just loses its ring.
    });
  }

  get id(): string {
    return this.def.id;
  }

  get bossId(): BossId {
    return this.def.id;
  }

  get position(): Vec2 {
    return this.state.position;
  }

  /** Current flat state — `summon.ts` needs it to place adds around the boss. */
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
    return this.scaledMaxHealth;
  }

  get phase(): BossPhase {
    return this.state.phase;
  }

  get hitboxRadiusTiles(): number {
    return this.def.hitboxRadiusTiles;
  }

  /** Sprite node in the actors layer — depth sorting/cover read it (#36, visual only). */
  get spriteNode(): Node {
    return this.node;
  }

  get isDefeated(): boolean {
    return isBossDefeated(this.state) || this.defeated;
  }

  /** Dashing sideways (Samurai charge). Used to apply body contact damage. */
  get isCharging(): boolean {
    return this.state.chargeDirection !== null;
  }

  /** Whether the boss is still inside its entrance grace window at `nowMs`. */
  isInIntro(nowMs: number): boolean {
    return isBossInIntro(this.state, Math.max(nowMs, this.bossClockMs));
  }

  /** One pattern frame. Returns events for CombatLoop to handle summons (bullets are spawned here). */
  step(nowMs: number, deltaMs: number, player: Vec2): readonly BossEvent[] {
    if (this.isDefeated) return [];

    // Keep entrance grace at real simulation speed; scale active combat pattern cadence by Ascension.
    const inIntro = isBossInIntro(this.state, this.bossClockMs);
    const stepDeltaMs = inIntro ? deltaMs : deltaMs * this.attackSpeedMult;
    this.bossClockMs += stepDeltaMs;

    const result = stepBoss({
      state: this.state,
      nowMs: this.bossClockMs,
      deltaMs: stepDeltaMs,
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
          this.telegraphStartedMs = this.bossClockMs;
          this.telegraphDurationMs = event.durationMs;
          break;
        case 'shoot':
          for (const verb of event.bullets) {
            this.bullets.spawn({
              position: verb.from,
              velocity: bulletVelocity(verb),
              radiusTiles: verb.radiusTiles,
              damage: Math.max(1, Math.round(verb.damage * this.damageMult)),
              owner: 'enemy',
              ttlMs: BOSS_BULLET_TTL_MS,
              source: { kind: 'boss', bossId: this.def.id, phase: this.state.phase },
            });
          }
          this.spawnVolleyCue(event.bullets);
          break;
        case 'summon':
          this.onSummon(event.role, event.count);
          break;
        case 'phase-change':
          this.applyPhase(event.phase);
          this.onPhase(event.phase);
          break;
        case 'move':
          // The real position lives in `state.position`; the event only drives debug/animation.
          if (event.speedTilesPerSecond >= TELEPORT_SNAP_SPEED_TILES_PER_SECOND) {
            this.playAnimation(animationFor(this.def.id, 'teleport', this.state.facing));
          } else {
            this.playAnimation(animationFor(this.def.id, 'walk', this.state.facing));
          }
          break;
      }
    }

    this.syncPosition();
    this.applySquash(nowMs);
    this.applyTint(nowMs);
    this.updateRing(this.bossClockMs);

    if (this.state.chargeDirection !== null) {
      this.charging = true;
    } else if (this.charging) {
      this.charging = false;
      this.playAnimation(animationFor(this.def.id, 'idle', this.state.facing));
    }
    return result.events;
  }

  /** Subtract HP through the normal path. No boss knockback; a short flash + hit animation. */
  takeDamage(amount: number, nowMs: number): void {
    if (this.isDefeated || !(amount > 0)) return;

    // Boss HP is always whole: fractional damage (poison, crit, execute) carries to the next frame.
    const step = accumulateDamage(this.damageCarry, amount);
    this.damageCarry = step.carry;
    if (step.whole <= 0) return;

    this.state = {
      ...this.state,
      health: Math.max(0, this.state.health - step.whole),
    };
    this.hitFlashUntilMs = nowMs + HIT_FLASH_MS;
    this.squashStartMs = nowMs;
    playSfx('enemy-hit');

    if (this.state.health <= 0) {
      this.defeated = true;
      this.damageCarry = 0;
      this.playAnimation(animationFor(this.def.id, 'hit', this.state.facing));
      this.animator.stop();
      this.hideRing();
      // Boss death = big explosion + smoke (GDD: death is FX, there is no death frame).
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
  // Visuals
  // -------------------------------------------------------------------------

  private applyPhase(phase: BossPhase): void {
    this.applyTint(Number.POSITIVE_INFINITY, phase);
    this.hideRing();
    this.telegraphStartedMs = Number.NEGATIVE_INFINITY;
    // A new phase starts with a banner; let the boss stand idle for one readable beat.
    this.playAnimation(animationFor(this.def.id, 'idle', this.state.facing));
  }

  private applyTint(nowMs: number, phaseOverride?: BossPhase): void {
    const phase = phaseOverride ?? this.state.phase;
    const flashing = nowMs < this.hitFlashUntilMs;
    this.sprite.color = flashing ? HIT_TINT : PHASE_TINT[phase];
  }

  private playAnimation(key: string): void {
    // Do not restart the same clip while it is still playing (boss step emits `move` every frame).
    if (key === this.lastAnimKey && !this.animator.isFinished) return;
    this.lastAnimKey = key;
    // Samurai splits its L/R sheets; `animationFor` already appends the suffix, so `play` needs no direction.
    this.animator.play(key);
  }

  /** Squash on a bullet hit; returns exactly to `ACTOR_SCALE` after `feel.squash.bossHitMs`. */
  private applySquash(nowMs: number): void {
    const squash = squashScale(
      nowMs - this.squashStartMs,
      FEEL_TUNING.squash.bossHitMs,
      FEEL_TUNING.squash.bossHitAmount,
    );
    this.node.setScale(ACTOR_SCALE * squash.x, ACTOR_SCALE * squash.y, 1);
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

    // A 32 px ring under parent scale 1/16 = 2 tiles; target diameter ~2.6× the hitbox.
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

  /**
   * M13 Dash-pressuring `'zone'` slam shockwave & `'sweep'` wide curtain FX cues.
   * Uses pre-pooled `FxPool` slots + `PHASE_RING` tints without allocating nodes.
   */
  private spawnVolleyCue(bullets: readonly { readonly toward: Vec2 | null }[]): void {
    if (bullets.length === 0) return;
    const tint = PHASE_RING[this.state.phase];
    const first = bullets[0];
    if (first === undefined) return;

    if (bullets.length >= 12 && first.toward === null) {
      // M13 radial slam `zone` volley: expanding ring + impact flash + camera bump.
      this.fx?.spawnShockwave(this.state.position, {
        startRadiusTiles: 0.6,
        endRadiusTiles: 5.5,
        durationMs: 360,
        lineWidth: 0.12,
        tint,
      });
      this.fx?.spawn('fx.impact', this.state.position, {
        drawUnits: 3.0,
        tint,
        lifetimeMs: 360,
      });
      this.shake?.addTrauma(0.35);
      playSfx('explosion');
      return;
    }

    if (bullets.length >= 9 && first.toward !== null) {
      // M13 wide curtain `sweep` volley: broad slash-arc cue at boss launch.
      this.fx?.spawn('fx.slash-arc', this.state.position, {
        drawUnits: 3.2,
        tint,
        lifetimeMs: 340,
      });
      playSfx('shoot');
    }
  }
}
