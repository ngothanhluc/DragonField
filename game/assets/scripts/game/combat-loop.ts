/**
 * Combat loop of one room: enemies + bullets + collisions + hitstop.
 *
 * Split from `bootstrap.ts` when M3 added caster bullets, brute charges, stagger and
 * hitstop: bootstrap owns run flow (chapter → room → wave → clear/loss), while this file
 * owns **one combat frame**. The frame order is unchanged and matches
 * `sim/run-simulation.ts`: player → enemy → bullets → collisions → contact damage.
 *
 * Three things belong to core; this file only applies them:
 *
 * - **Time**: `HitstopClock` consumes real time and returns simulated time;
 *   `nowMs` only advances by the simulated part, so telegraph/i-frames/cooldowns/bullet TTL
 *   all stand still during the 70 ms hitstop (no desync).
 * - **Enemy decisions**: `EnemyView.step` calls `decideAction`; here we only read the
 *   result (`released`, `chargeSweep`).
 * - **Geometry**: `segmentHitsCircle` for dashes, `hitsCircle` for bullets, `firstHit`
 *   for obstacles.
 *
 * Debug (`?debug=1`) uses the `spawnDebug` / `startStress` / `godMode` methods;
 * nothing calls them in normal play.
 */
import { Color as CocosColor, Node as CocosNodeValue, Sprite as CocosSprite } from 'cc';
import type { AnimationManifest } from '../core/art/manifest';
import type { BossDef, BossPhase } from '../core/boss/boss-defs';
import { BOSS_FEET_OFFSET_TILES } from '../core/boss/boss-defs';
import { summonedEnemies } from '../core/boss/summon';
import type { CharacterId } from '../core/characters/roster';
import { dispatchClassSkillEvent, hasAnyClassSkill } from '../core/skills/class-skills';
import type {
  ClassSkillEffect,
  ClassSkillEventContext,
  ClassSkillEventName,
  ClassSkillMemory,
  ClassSkillStackSource,
  ClassSkillTarget,
} from '../core/skills/class-skill-hooks';
import { NO_CLASS_SKILL_EFFECTS } from '../core/skills/class-skill-hooks';
import { MAGE_SKILL_FX, MAGE_SKILL_SFX, frostOrbPositions } from '../core/skills/classes/mage';
import {
  NinjaSkillRuntime,
} from '../core/skills/ninja-runtime';
import { CultivatorSkillRuntime } from '../core/skills/cultivator-runtime';
import { firstHit, hitsCircle } from '../core/combat/bullets';
import {
  fireEnemyVolley,
  casterShotPlan,
  gunnerShotPlan,
  scheduleGunnerFollowUp,
  sniperShotPlan,
  stepPendingGunnerVolleys,
  type PendingGunnerVolley,
} from '../core/combat/enemy-fire';
import { segmentHitsCircle } from '../core/combat/hitbox';
import { accumulateDamage } from '../core/combat/integer-damage';
import { HitstopClock } from '../core/combat/hitstop';
import { PlayerHitHitstop, isRealCrit } from '../core/combat/hit-hitstop';
import type { KnockbackState } from '../core/combat/knockback';
import {
  HOMING_TURN_RATE_RADIANS_PER_SECOND,
  damageAfterExecute,
  damageWithStatusBonus,
  lifestealHeal,
  ricochetTarget,
  shockArcTargets,
  steerVelocity,
  type RicochetCandidate,
  type RicochetTarget,
} from '../core/combat/shot-effects';
import { StatusEffects } from '../core/combat/status-effects';
import type { Targetable } from '../core/combat/targeting';
import { DEFAULT_COMBAT } from '../core/config';
import type { EnemyState } from '../core/enemies/behaviours';
import { ROOM_EDGE_MARGIN_TILES, maxHealthFor } from '../core/enemies/behaviours';
import {
  bomberBlastSpec,
  isInsideBomberBlast,
  scheduleFollowUpBlast,
  stepPendingBlasts,
  type BomberBlastSpec,
  type PendingBomberBlast,
} from '../core/enemies/bomber';
import { EnemyBuffTracker, resolveBufferPulse, type BufferPulseResult } from '../core/enemies/buffer';
import {
  DASH_TUNING,
  FEEL_TUNING,
  NAVIGATION_TUNING,
  CLASS_SKILLS_TUNING,
  XP_TUNING,
} from '../core/enemies/tuning';
import { eliteVolleyAngles } from '../core/enemies/elite';
import { splitOnDeath } from '../core/enemies/splitter';
import { RoomNavigation, separateEnemies, type SeparationBody } from '../core/enemies/navigation';
import type { ScreenShake } from '../core/feel/screen-shake';
import { ActionBuffer, type ActionKind } from '../core/input/action-buffer';
import {
  activeCooldownSeconds,
  activeReadyRatio,
  activeSkillConfigFor,
  computeArcaneNovaSpec,
  computePiercingVolley,
  computeShadowBarrageVolley,
  computeTenThousandSwordsVolley,
  createActiveSkillState,
  isActiveSkillReady,
  onActiveHit,
  onActiveKill,
  stepActiveSkill,
  tryActivateSkill,
  type ActiveSkillConfig,
  type ActiveSkillState,
  type SignatureProjectile,
  type SignatureSkillId,
} from '../core/input/active-skill';
import {
  canStartDash,
  createDashState,
  dashCooldownSeconds,
  dashReadyRatio,
  isDashing,
  resolveDashDirection,
  stepDash,
  tryStartDash,
  type DashConfig,
  type DashState,
} from '../core/input/dash';
import { spawnWave } from '../core/enemies/waves';
import {
  WaveScheduler,
  enemyStateFromSpawn,
  usesWaveScheduler,
  type ScheduledSpawn,
} from '../core/enemies/wave-scheduler';
import type { ViewRect } from '../core/camera/follow-camera';
import type { EnemyRole, LevelData } from '../core/level/level-data';
import { distance, type Vec2 } from '../core/math/vec2';
import type { SeededRng } from '../core/rng';
import {
  combinedDifficultyModifiers,
  type RunDifficultyModifiers,
} from '../core/run/endless';
import type { DeathCause } from '../core/run/run-summary';
import type { DerivedStats } from '../core/skills/derived-stats';
import type { HudActionsSnapshot } from '../core/view/hud-layout';
import { screenViewAround } from '../core/view/view-rect';
import {
  effectsLayers,
  type EffectsMode,
} from '../core/vfx/weapon-vfx';
import {
  computeLevelUpKnockback,
  levelUpResumeIframeMs,
  type KnockbackTarget,
} from '../core/xp/level-up-wave';
import { SpriteAnimator } from './anim/sprite-animator';
import { BossView } from './boss-view';
import type { BulletView } from './bullet-view';
import type { CoverBody } from './cover-view';
import { EnemyView } from './enemy-view';
import { spawnLevelUpBurst, type FxKey, type FxPool } from './fx/effect-pool';
import { ACTOR_FEET_OFFSET_TILES, ACTOR_SCALE } from './level-view';
import { NinjaSkillView } from './ninja-skill-view';
import { CultivatorSkillView } from './cultivator-skill-view';
import type { PlayerController } from './player-controller';
import type { DebugClassSkillSnapshot } from './debug-api';
import { pointInCullRect, type CullRect } from './world-culler';
import {
  playActiveSkillSfx,
  playBomberBlastSfx,
  playBufferPulseSfx,
  playDashNovaSfx,
  playNinjaCloneSfx,
  playNinjaKunaiSfx,
  playNinjaSmokeSfx,
  playNinjaVenomSfx,
  playCultivatorArraySfx,
  playCultivatorBarrierSfx,
  playCultivatorEvolutionSfx,
  playCultivatorOrbitSfx,
  playCultivatorQiSfx,
  playSfx,
  playShockSfx,
} from './audio/sfx';

/** `cc` is an any module: import names only work in value position. */
type Node = InstanceType<typeof CocosNodeValue>;

/** One living enemy/boss a class-skill runtime can hit (M20). */
interface ClassRuntimeTarget {
  readonly id: string;
  readonly position: Vec2;
  readonly radiusTiles: number;
}

/** One damage a class-skill runtime asks the caller to apply (M20). */
interface ClassRuntimeHit {
  readonly skillId: string;
  readonly targetId: string;
  readonly position: Vec2;
  readonly amount: number;
  readonly crit: boolean;
}

/** Values a class-skill runtime needs from the player at trigger time (M20). */
interface ClassRuntimeContext {
  readonly shotDamage: number;
  readonly critMultiplier: number;
  readonly aimDirection?: Vec2;
}

/** Where a Signature Active projectile came from: skill + one cast id (#108). */
interface SignatureBulletOrigin {
  readonly skillId: SignatureSkillId;
  readonly castId: number;
}

/** Class-generic runtime surface: Ninja (#84) and Cultivator (#87) both implement it. */
interface ClassSkillRuntime {
  readonly isEmpty: boolean;
  applyEffects(
    effects: readonly ClassSkillEffect[],
    nowMs: number,
    context: ClassRuntimeContext,
  ): void;
  step(
    nowMs: number,
    deltaMs: number,
    targets: readonly ClassRuntimeTarget[],
    context: ClassRuntimeContext,
  ): readonly ClassRuntimeHit[];
  reset(): void;
}

/** Player radius for enemy bullets / dashes, tiles — same convention as the sim. */
export const PLAYER_RADIUS_TILES = 0.25;

/** Impact colours (cached: a busy frame must not allocate a `Color` per hit). */
const HIT_TINT = new CocosColor(255, 236, 190, 255);
const CRIT_FLASH_TINT = new CocosColor(255, 255, 255, 255);
const EXECUTE_TINT = new CocosColor(255, 90, 90, 255);
const LIFESTEAL_TINT = new CocosColor(230, 60, 60, 255);
const POISON_TINT = new CocosColor(120, 240, 110, 255);
const BURN_TINT = new CocosColor(255, 145, 65, 255);
const SHOCK_ARC_TINT = new CocosColor(135, 235, 255, 255);
const DASH_NOVA_TINT = new CocosColor(140, 245, 255, 255);
const SHADOW_BARRAGE_TINT = new CocosColor(195, 130, 255, 255);
const PIERCING_VOLLEY_TINT = new CocosColor(255, 235, 130, 255);
const ARCANE_NOVA_CYAN_TINT = new CocosColor(110, 235, 255, 255);
const TEN_THOUSAND_SWORDS_TINT = new CocosColor(125, 250, 225, 255);
const BOMBER_BLAST_TINT = new CocosColor(255, 110, 55, 255);
const BOMBER_FOLLOWUP_TINT = new CocosColor(255, 180, 90, 255);
const BUFFER_AURA_TINT = new CocosColor(145, 255, 160, 255);
const RICOCHET_TINT = new CocosColor(255, 245, 170, 255);
/** Spawn telegraph (#41): warm red, so "an enemy is arriving here" never reads as an attack tell. */
const SPAWN_TELEGRAPH_TINT = new CocosColor(255, 150, 120, 255);

/** Number of enemies and enemy bullets `stress()` keeps alive. */
export const STRESS_ENEMY_COUNT = 24;
/** Boss id in collision/auto-aim — matches `boss-run.ts` so debug can read it. */
export const BOSS_TARGET_ID = 'boss';
/**
 * The milestone target is "24 enemies + 40 bullets" (M9 alive cap). Keep 44 so that after a few bullets hit
 * the player/obstacles within the frame, the measured number is still **>= 40**.
 */
export const STRESS_ENEMY_BULLETS = 44;
/** Fake HP for stress enemies so they do not die while fps is measured. */
const STRESS_ENEMY_HEALTH = 999_999;
const STRESS_BULLET_SPEED = 3;
const STRESS_BULLET_TTL_MS = 6000;
/** Spawn ring radius for stress (around the player), tiles — the inner of three rings. */
const STRESS_RING_RADIUS = 4;

export interface CombatLoopOptions {
  readonly player: PlayerController;
  readonly bulletView: BulletView | null;
  readonly manifest: AnimationManifest;
  readonly actorLayer: Node;
  readonly level: LevelData;
  /** Manifest actor name for a role in the current chapter. */
  readonly monsterFor: (role: EnemyRole) => string;
  /** Run RNG: boss pattern + summons + bullet crit already live in PlayerController. */
  readonly rng: SeededRng;
  /** Callback when the boss changes phase (bootstrap shows the banner). */
  readonly onBossPhase?: (phase: BossPhase) => void;
  /**
   * One enemy just died — bootstrap credits gold + flies a coin (M5/#2). Called exactly
   * **once** per enemy, including when `killAll()`/debug kills in bulk.
   * `position` is the death spot (tiles) so the coin can fly to the HUD from there.
   */
  readonly onKill?: (role: EnemyRole, elite: boolean, position: Vec2) => void;
  /** The boss just died (the boss-room reward is decided by bootstrap in `awardRoomClear`). */
  readonly onBossKilled?: () => void;
  /** Explosion flash pool; when absent the game still runs, just without visuals. */
  readonly fx?: FxPool;
  /** World camera shake (ticket #2); when absent the game still runs, just without shake. */
  readonly shake?: ScreenShake;
  /**
   * What the player can see this frame, in room tiles (#41) — the follow camera's view. Without
   * it the loop falls back to one screen centred on the player, clamped to the room.
   */
  readonly view?: () => ViewRect | null;
  /**
   * One hit on an enemy/boss — bootstrap draws the damage number if the setting is on.
   * `crit` is derived from the bullet's damage versus base damage (crit is multiplied at fire time).
   */
  readonly onDamage?: (info: DamagePopupInfo) => void;
  /** Unified Ascension + Endless difficulty modifiers (M15; defaults to Ascension 0 / Loop 0). */
  readonly difficulty?: RunDifficultyModifiers;
  /**
   * Active character + class-skill stacks for the no-op class hooks (M20, ADR-027). Omitted in
   * tests/tools that do not run a class; the whole seam then costs one null check per event.
   */
  readonly classSkills?: ClassSkillHookSource;
}

/** The active character and a stack accessor for its class-exclusive hooks. */
export interface ClassSkillHookSource {
  readonly characterId: CharacterId;
  readonly stacks: ClassSkillStackSource;
}

/** Newest live bullet id (0 for an empty pool); used to count auto-fire shots without a callback. */
function newestBulletId(bullets: readonly { readonly id: number }[]): number {
  const last = bullets[bullets.length - 1];
  return last === undefined ? 0 : last.id;
}

/** Unit flight direction of a bullet velocity (room tiles, y down); null for a zero vector. */
function unitDirection(velocity: Vec2): Vec2 | null {
  const length = Math.hypot(velocity.x, velocity.y);
  if (!(length > 0)) return null;
  return { x: velocity.x / length, y: velocity.y / length };
}

/** One enemy/boss hit, enough to show a floating number. */
export interface DamagePopupInfo {
  readonly amount: number;
  readonly position: Vec2;
  readonly crit: boolean;
}

export interface CombatUpdateResult {
  /** The frame was fully eaten by hitstop — the sim did not run this frame. */
  readonly frozen: boolean;
  readonly playerDied: boolean;
  /** Every enemy in the room is dead (bootstrap decides the next wave/room). */
  readonly cleared: boolean;
}

export interface EnemySnapshot {
  readonly id: string;
  readonly role: EnemyRole | null;
  readonly elite: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly action: string;
  readonly x: number;
  readonly y: number;
}

export interface ActionsSnapshot {
  readonly dashReadyRatio: number;
  readonly dashCooldownSec: number;
  readonly isDashing: boolean;
  readonly dashIframeMs: number;
  readonly dashBuffered: boolean;
  readonly dashesUsed: number;
  readonly activeReadyRatio: number;
  readonly activeCooldownSec: number;
  readonly activeBuffered: boolean;
  readonly activeSkillsUsed: number;
}

/** One spawn waiting out its on-screen telegraph (#41). It already holds a slot of the alive cap. */
interface PendingSpawn {
  readonly state: EnemyState;
  /** Sim time at which the enemy becomes active. */
  readonly atMs: number;
}

export class CombatLoop {
  private readonly player: PlayerController;
  private readonly bulletView: BulletView | null;
  private readonly manifest: AnimationManifest;
  private readonly actorLayer: Node;
  private readonly monsterFor: (role: EnemyRole) => string;
  private readonly rng: SeededRng;
  private readonly onBossPhase: (phase: BossPhase) => void;
  private readonly onKill: (role: EnemyRole, elite: boolean, position: Vec2) => void;
  private readonly onBossKilled: () => void;
  private readonly fx: FxPool | null;
  private readonly shake: ScreenShake | null;
  private readonly onDamage: (info: DamagePopupInfo) => void;
  private readonly viewProvider: () => ViewRect | null;
  private readonly hitstop = new HitstopClock(DEFAULT_COMBAT.enemyHitstopMs);
  /** `Settings.effects` — Reduced keeps impacts/telegraphs but drops secondary particles. */
  private effectsMode: EffectsMode = 'full';
  /** Cached layer flag: `effectsLayers()` allocates, and a busy frame spawns FX many times. */
  private secondaryParticles = true;
  private readonly enemies: EnemyView[] = [];
  private boss: BossView | null = null;
  /** Enemy/boss already rewarded — stops double gold when update scans again. */
  private readonly rewarded = new Set<string>();
  private bossRewarded = false;
  private readonly bossStatus = new StatusEffects();
  private readonly actionBuffer = new ActionBuffer(DASH_TUNING.bufferMs);
  private dashState: DashState = createDashState();
  private signatureSkillId: SignatureSkillId;
  private activeConfig: ActiveSkillConfig;
  private activeSkillState: ActiveSkillState;
  private dashesUsed = 0;
  private activeSkillsUsed = 0;
  private readonly signatureBullets = new Map<number, SignatureBulletOrigin>();
  /** Monotonic id per `castSignature` call so a volley stops the game once, not per blade (#108). */
  private signatureCastCount = 0;
  private readonly playerHitHitstop = new PlayerHitHitstop({
    normalMs: DEFAULT_COMBAT.enemyHitstopMs,
    critMs: FEEL_TUNING.vfx.critHitstopMs,
  });
  private activeAttachmentHideToken: string | null = null;
  private activeAttachmentHideRemainingMs = 0;
  private readonly enemyBuffs = new EnemyBuffTracker();
  private pendingBlasts: PendingBomberBlast[] = [];
  private pendingGunnerVolleys: PendingGunnerVolley[] = [];
  private readonly livingEnemyStates: EnemyState[] = [];
  private readonly shockCandidates: RicochetCandidate[] = [];
  private readonly shockTargetsOut: RicochetTarget[] = [];
  private readonly dashConfig: DashConfig = {
    cooldownMs: DASH_TUNING.cooldownMs,
    durationMs: DASH_TUNING.durationMs,
    speedTilesPerSecond: DASH_TUNING.speedTilesPerSecond,
    invulnerabilityMs: DASH_TUNING.invulnerabilityMs,
  };
  /**
   * Shared enemy navigation for the current room: one flow field per radius class, rebuilt only
   * when the player changes tile and at most every `navigation.rebuildMinMs` (#34).
   */
  private navigation: RoomNavigation;
  private level: LevelData;
  /**
   * Wave delivery of the current room (#41). `null` in a boss room, whose adds are authored and
   * whose boss is spawned by `spawnBoss`.
   */
  private scheduler: WaveScheduler | null = null;
  /** Spawns that landed inside the view: they show a telegraph before they become active. */
  private readonly pendingSpawns: Array<PendingSpawn> = [];
  /** Id suffix of the next scheduled spawn (unique within the room). */
  private spawnedSequence = 0;
  private nowMs = 0;
  private playerDied = false;
  private lastDeathCause: DeathCause | null = null;
  private difficulty: RunDifficultyModifiers;
  private awaitingAdvance = false;
  private god = false;
  /** No-op class hooks (M20, ADR-027): active character + class-skill stack accessor. */
  private readonly classSkills: ClassSkillHookSource | null;
  /** 1-based auto-fire shot counter for on-shot class hooks. */
  private shotsFired = 0;
  /** Ninja class-skill runtime + view (M20, #84); `null` for every other class. */
  private readonly ninja: NinjaSkillRuntime | null;
  private readonly ninjaView: NinjaSkillView | null;
  /** Cultivator class-skill runtime + view (M20, #87); `null` for every other class. */
  private readonly cultivator: CultivatorSkillRuntime | null;
  private readonly cultivatorView: CultivatorSkillView | null;
  /** The active class's runtime, if any; one generic surface for step/apply (M20). */
  private readonly classRuntime: ClassSkillRuntime | null;
  /** Orbit-slash SFX throttle: 4 swords must not stack 4 cues on one cadence. */
  private orbitSfxAtMs = Number.NEGATIVE_INFINITY;
  /** Class skill that last damaged an enemy/boss this frame, for `onKill.killedBy`. */
  private readonly classSkillKilledBy = new Map<string, string>();
  /** Per-run scratch store for stateful class hooks (marks, wind momentum); reset with the run. */
  private readonly classSkillMemory: ClassSkillMemory = new Map();
  /** Reused `onHit` effect queue: spawning into `active()` mid-iteration is unsafe. */
  private readonly classSkillEffectBuffer: ClassSkillEffect[] = [];
  /** Fractional class-skill damage per victim, so popups only ever show whole numbers (M20). */
  private readonly classDamageCarry = new Map<string, number>();

  /** Debug stress: keep 24 enemies + 44 enemy bullets on screen to measure fps. */
  private stress = false;
  private stressIndex = 0;
  private debugSeq = 0;

  constructor(options: CombatLoopOptions) {
    this.player = options.player;
    this.signatureSkillId = options.player.characterDef.signatureSkillId;
    this.activeConfig = activeSkillConfigFor(this.signatureSkillId);
    this.activeSkillState = createActiveSkillState(true, this.activeConfig.cooldownMs);
    this.bulletView = options.bulletView;
    this.manifest = options.manifest;
    this.actorLayer = options.actorLayer;
    this.level = options.level;
    this.navigation = new RoomNavigation(
      options.level,
      ROOM_EDGE_MARGIN_TILES,
      NAVIGATION_TUNING.rebuildMinMs,
    );
    this.monsterFor = options.monsterFor;
    this.rng = options.rng;
    this.onBossPhase = options.onBossPhase ?? (() => undefined);
    this.onKill = options.onKill ?? (() => undefined);
    this.onBossKilled = options.onBossKilled ?? (() => undefined);
    this.fx = options.fx ?? null;
    this.shake = options.shake ?? null;
    this.onDamage = options.onDamage ?? (() => undefined);
    this.viewProvider = options.view ?? (() => null);
    this.difficulty = options.difficulty ?? combinedDifficultyModifiers(0, 0);
    this.classSkills = options.classSkills ?? null;
    if (options.classSkills?.characterId === 'ninja') {
      this.ninja = new NinjaSkillRuntime(CLASS_SKILLS_TUNING.ninja);
      this.ninjaView =
        options.fx !== undefined
          ? new NinjaSkillView(options.actorLayer, options.player.node, options.fx)
          : null;
    } else {
      this.ninja = null;
      this.ninjaView = null;
    }
    if (options.classSkills?.characterId === 'cultivator') {
      this.cultivator = new CultivatorSkillRuntime(
        CLASS_SKILLS_TUNING.cultivator,
        options.classSkills.stacks,
      );
      this.cultivatorView =
        options.fx !== undefined
          ? new CultivatorSkillView(options.actorLayer, options.fx)
          : null;
    } else {
      this.cultivator = null;
      this.cultivatorView = null;
    }
    this.classRuntime = this.ninja ?? this.cultivator;
  }

  /** Live Ascension + Endless difficulty modifiers applied to enemies and bosses (M15). */
  get difficultyModifiers(): RunDifficultyModifiers {
    return this.difficulty;
  }

  /** Update active difficulty modifiers (used by run setup / debug `setAscension`). */
  setDifficulty(difficulty: RunDifficultyModifiers): void {
    this.difficulty = difficulty;
  }

  /** Exact attributed cause of death recorded on the lethal player hit (M15). */
  get deathCause(): DeathCause | null {
    return this.lastDeathCause;
  }

  /**
   * Debug helper (`__yokai.triggerDeath`): bypasses god mode, records `cause`, and kills the
   * player cleanly so permadeath & rich result summary can be verified deterministically.
   */
  triggerDebugDeath(cause?: DeathCause): boolean {
    if (this.player.isDead) return false;
    this.god = false;
    this.lastDeathCause = cause ?? { kind: 'unknown' };
    this.player.forceKill();
    this.playerDied = true;
    this.clearSkillAttachmentHide();
    return true;
  }

  get currentLevel(): LevelData {
    return this.level;
  }

  get clockMs(): number {
    return this.nowMs;
  }

  get frozenMs(): number {
    return this.hitstop.remaining;
  }

  get isGodMode(): boolean {
    return this.god;
  }

  /** Number of living enemies — bootstrap uses it for debug. Telegraphing spawns count. */
  get aliveCount(): number {
    return this.liveEnemyCount();
  }

  /** Enemies still to kill: alive (telegraphing included) plus the ones not spawned yet. */
  get enemiesLeft(): number | null {
    const scheduler = this.scheduler;
    if (scheduler === null) return null;
    return this.liveEnemyCount() + Math.max(0, scheduler.total - scheduler.spawned);
  }

  /** Every enemy spawned and none alive (#41); a boss room also needs its boss down. */
  get roomCleared(): boolean {
    const scheduler = this.scheduler;
    if (scheduler !== null) return scheduler.isCleared(this.liveEnemyCount());
    return this.enemies.every((enemy) => enemy.isDead) && (this.boss === null || this.boss.isDefeated);
  }

  get hasBoss(): boolean {
    return this.boss !== null && !this.boss.isDefeated;
  }

  /** Boss snapshot for the debug `boss()`; `null` in a normal room. */
  bossSnapshot(): {
    readonly id: string;
    readonly name: string;
    readonly health: number;
    readonly maxHealth: number;
    readonly phase: BossPhase;
  } | null {
    const boss = this.boss;
    if (boss === null) return null;
    return {
      id: boss.id,
      name: boss.displayName,
      health: boss.health,
      maxHealth: boss.maxHealth,
      phase: boss.phase,
    };
  }

  /** Debug `setBossHp`: subtract HP through the real `takeDamage` path so phases change naturally. */
  setBossHealthFraction(fraction: number): boolean {
    const boss = this.boss;
    if (boss === null || boss.isDefeated) return false;
    const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    const target = Math.round(boss.maxHealth * clamped);
    const damage = boss.health - target;
    if (damage > 0) boss.takeDamage(damage, this.nowMs);
    this.reportDeaths();
    return true;
  }

  setGodMode(on: boolean): void {
    this.god = on;
  }

  /** Record a discrete gameplay press (`'dash'` / `'active'`) in the 150 ms game-time buffer. */
  bufferAction(kind: ActionKind): void {
    this.actionBuffer.press(kind);
  }

  /** Drop buffered presses when pausing, opening modals, or transitioning rooms. */
  clearActionBuffer(): void {
    this.actionBuffer.clear();
  }

  /** True when `bulletId` was fired by Ninja's Signature Active (*Shadow Barrage*). */
  isShadowBullet(bulletId: number): boolean {
    return this.signatureBullets.get(bulletId)?.skillId === 'shadow-barrage';
  }

  /** Signature Active skill that spawned `bulletId`, or `null` for auto-fire / enemy bullets. */
  signatureSkillForBullet(bulletId: number): SignatureSkillId | null {
    return this.signatureBullets.get(bulletId)?.skillId ?? null;
  }

  /** Switch the active class Signature Skill mid-run (used by `?debug=1` `__yokai.selectCharacter`). */
  setSignatureSkill(skillId: SignatureSkillId): void {
    this.clearSkillAttachmentHide();
    this.signatureSkillId = skillId;
    this.activeConfig = activeSkillConfigFor(skillId);
    this.activeSkillState = {
      cooldownRemainingMs: 0,
      cooldownTotalMs: this.activeConfig.cooldownMs,
      activations: this.activeSkillState.activations,
    };
  }

  /**
   * Advance the Cultivator `sword-back` hide countdown on simulated game-time `deltaMs`.
   * Also called during room-clear / door phases so a blade storm at room end restores cleanly.
   */
  stepAttachmentHideTimer(deltaMs: number): void {
    if (this.activeAttachmentHideToken === null || !(deltaMs > 0)) return;
    this.activeAttachmentHideRemainingMs -= deltaMs;
    if (this.activeAttachmentHideRemainingMs <= 0) {
      this.clearSkillAttachmentHide();
    }
  }

  private clearSkillAttachmentHide(): void {
    if (this.activeAttachmentHideToken !== null) {
      this.player.showAttachmentForSkill(this.activeAttachmentHideToken);
      this.activeAttachmentHideToken = null;
    }
    this.activeAttachmentHideRemainingMs = 0;
  }

  /** Debug / immediate trigger for Dash (`__yokai.dash()`). */
  triggerDash(): boolean {
    if (this.awaitingAdvance || this.player.isDead) return false;
    return this.tryConsumeOrStartDash(false);
  }

  /** Debug / immediate trigger for Signature Active (*Shadow Barrage*, `__yokai.activeSkill()`). */
  triggerActiveSkill(): boolean {
    if (this.awaitingAdvance || this.player.isDead) return false;
    return this.tryConsumeOrStartActive(false);
  }

  /** Populate a pre-allocated HUD actions snapshot without allocating per frame. */
  actionsHudSnapshot(out: {
    dashReadyRatio: number;
    dashCooldownSec: number;
    activeReadyRatio: number;
    activeCooldownSec: number;
  }): HudActionsSnapshot {
    out.dashReadyRatio = dashReadyRatio(this.dashState);
    out.dashCooldownSec = dashCooldownSeconds(this.dashState);
    out.activeReadyRatio = activeReadyRatio(this.activeSkillState);
    out.activeCooldownSec = activeCooldownSeconds(this.activeSkillState);
    return out;
  }

  /** Snapshot for `__yokai.actions()`. */
  actionsSnapshot(): ActionsSnapshot {
    return {
      dashReadyRatio: dashReadyRatio(this.dashState),
      dashCooldownSec: dashCooldownSeconds(this.dashState),
      isDashing: isDashing(this.dashState),
      dashIframeMs: Math.round(this.dashState.invulnerableRemainingMs),
      dashBuffered: this.actionBuffer.has('dash'),
      dashesUsed: this.dashesUsed,
      activeReadyRatio: activeReadyRatio(this.activeSkillState),
      activeCooldownSec: activeCooldownSeconds(this.activeSkillState),
      activeBuffered: this.actionBuffer.has('active'),
      activeSkillsUsed: this.activeSkillsUsed,
    };
  }

  /** Debug proof (`?debug=1`): class-hook memory, live class projectiles and the temporary buff. */
  classSkillSnapshot(): DebugClassSkillSnapshot {
    const memory: Array<readonly [string, number]> = [];
    for (const entry of this.classSkillMemory.entries()) memory.push(entry);
    let classBullets = 0;
    const classBulletsById: Record<string, number> = {};
    for (const bullet of this.player.bullets.active()) {
      const id = bullet.classSkillId;
      if (id === undefined) continue;
      classBullets += 1;
      classBulletsById[id] = (classBulletsById[id] ?? 0) + 1;
    }
    return {
      shotsFired: this.shotsFired,
      memory,
      classBullets,
      classBulletsById,
      buff: this.player.classSkillBuffSnapshot(this.nowMs),
    };
  }

  /** Room change: clear enemies/bullets, take the new level. The sim clock keeps running (i-frames carry across rooms). */
  enterRoom(level: LevelData): void {
    this.clear();
    this.level = level;
    this.navigation = new RoomNavigation(
      level,
      ROOM_EDGE_MARGIN_TILES,
      NAVIGATION_TUNING.rebuildMinMs,
    );
    this.scheduler = null;
    this.pendingSpawns.length = 0;
    this.spawnedSequence = 0;
    this.playerDied = false;
    this.lastDeathCause = null;
    this.awaitingAdvance = false;
    this.hitstop.reset();
    this.rewarded.clear();
    this.bossRewarded = false;
    this.actionBuffer.clear();
    this.dashState = createDashState();
    this.activeSkillState = {
      cooldownRemainingMs: 0,
      cooldownTotalMs: this.activeConfig.cooldownMs,
      activations: this.activeSkillState.activations,
    };
    this.clearSkillAttachmentHide();
    this.enemyBuffs.clear();
    this.pendingBlasts = [];
    this.pendingGunnerVolleys = [];
    this.signatureBullets.clear();
    this.playerHitHitstop.reset();
    this.classDamageCarry.clear();
  }

  /**
   * Spawn the room's real boss. Call before `startWave` so boss telegraphs/bullets exist
   * from the room's first frame (bootstrap calls it from `enterRoom`). Passes `nowMs` so the
   * boss honours the accumulated simulation clock and its entrance grace window.
   */
  spawnBoss(def: BossDef, start: Vec2, nowMs: number = this.nowMs): BossView {
    this.boss?.destroy();
    this.bossStatus.clear();
    this.bossRewarded = false;
    const boss = new BossView({
      def,
      start,
      nowMs,
      actorLayer: this.actorLayer,
      bullets: this.player.bullets,
      rng: this.rng,
      onPhase: this.onBossPhase,
      onSummon: (role, count) => this.summon(role, count),
      healthMult: this.difficulty.bossHealthMult,
      damageMult: this.difficulty.enemyDamageMult,
      attackSpeedMult: this.difficulty.enemyFireRateMult,
      ...(this.fx !== null ? { fx: this.fx } : {}),
      ...(this.shake !== null ? { shake: this.shake } : {}),
    });
    this.boss = boss;
    return boss;
  }

  /** Summon adds in a ring around the boss; positions are decided by core/summon (deterministic). */
  private summon(role: EnemyRole, count: number): void {
    const boss = this.boss;
    if (boss === null) return;

    for (const enemy of summonedEnemies(boss.bossState, role, count, this.rng)) {
      const maxHealth = maxHealthFor(
        role,
        false,
        undefined,
        this.level.chapter,
        this.difficulty.enemyHealthMult,
      );
      const state: EnemyState = {
        id: enemy.id,
        role: enemy.role,
        elite: false,
        position: { x: enemy.position.x, y: enemy.position.y },
        health: maxHealth,
        maxHealth,
        action: { kind: 'idle' },
        actionStartedMs: this.nowMs,
      };
      this.addEnemy(state);
    }
  }

  /**
   * Fill the room (#41). A multi-screen normal room starts empty and receives its 8× total from
   * the `WaveScheduler` over time (under the run-slot alive cap, with spawn telegraphs); a
   * one-screen room (boss arena, dev room) keeps its authored list, exactly as before. Call after
   * `enterRoom` (and after the boss is spawned). `runSlot` is the room's 1-based position in the
   * run — room 1 opens with the smallest crowd (see `aliveCapForSlot`).
   */
  startWaves(seed: number, runSlot = 1, extraElites = 0): void {
    this.scheduler = null;
    this.pendingSpawns.length = 0;
    this.spawnedSequence = 0;
    this.awaitingAdvance = false;

    const level = this.level;
    if (!usesWaveScheduler(level)) {
      const states = level.waves.flatMap((_, wave) => spawnWave(level, wave));
      let remainingExtra = Number.isFinite(extraElites) ? Math.max(0, Math.floor(extraElites)) : 0;
      for (const state of states) {
        if (remainingExtra > 0 && !state.elite && state.role !== 'splitling') {
          state.elite = true;
          remainingExtra -= 1;
        }
        const scaledHp = maxHealthFor(
          state.role,
          state.elite,
          undefined,
          level.chapter,
          this.difficulty.enemyHealthMult,
        );
        state.maxHealth = scaledHp;
        state.health = scaledHp;
        this.addEnemy(state);
      }
      return;
    }
    this.scheduler = new WaveScheduler(level, seed, runSlot, extraElites);
  }

  /**
   * Apply ADR-021 mid-combat level-up resume safety:
   * push nearby live enemies radially away from the player, grant 0.6 s player i-frame,
   * leave all enemy bullets intact, and emit the radial burst FX.
   */
  applyLevelUpResumeWave(): number {
    const targets: KnockbackTarget[] = [];
    for (const enemy of this.enemies) {
      if (!enemy.isDead) {
        targets.push({ id: enemy.id, position: enemy.position });
      }
    }
    const hits = computeLevelUpKnockback(this.player.position, targets);
    if (hits.length > 0) {
      const byId = new Map<string, KnockbackState>();
      for (const hit of hits) byId.set(hit.id, hit.knockback);
      for (const enemy of this.enemies) {
        const kb = byId.get(enemy.id);
        if (kb !== undefined) enemy.applyKnockbackState(kb);
      }
    }
    this.player.grantInvulnerability(this.nowMs, levelUpResumeIframeMs());
    spawnLevelUpBurst(this.fx, this.player.position, this.effectsMode, {
      radiusTiles: XP_TUNING.levelUpWave.knockbackRadiusTiles,
    });
    return hits.length;
  }

  /** Drop active bullets immediately (used on room clear before vacuuming orbs to doors). */
  clearBullets(): void {
    this.player.bullets.clear();
    this.signatureBullets.clear();
    this.playerHitHitstop.reset();
    this.fx?.setFrostOrbs(null, 0);
    this.bulletView?.sync();
  }

  /** True when the active character owns at least one class skill/Evolution (cheap, alloc-free). */
  private hasClassSkills(): boolean {
    const source = this.classSkills;
    return source !== null && hasAnyClassSkill(source.characterId, source.stacks);
  }

  /** Forward one event to the active character's class hooks and return their effect requests. */
  private dispatchClassSkill(
    event: ClassSkillEventName,
    context: Omit<ClassSkillEventContext, 'characterId' | 'owned' | 'rng' | 'memory'>,
  ): readonly ClassSkillEffect[] {
    const source = this.classSkills;
    if (source === null) return NO_CLASS_SKILL_EFFECTS;
    return dispatchClassSkillEvent(event, source.characterId, source.stacks, {
      ...context,
      nowMs: context.nowMs ?? this.nowMs,
      damage: context.damage ?? this.player.derivedStats.damage,
      enemies: context.enemies ?? this.classSkillTargets(),
      rng: this.rng,
      memory: this.classSkillMemory,
    });
  }

  /** Feed one dispatch's effect requests to the Ninja runtime and play one cue per skill. */
  private applyNinjaClassSkillEffects(effects: readonly ClassSkillEffect[]): void {
    const runtime = this.ninja;
    if (runtime === null) return;

    const origin = this.player.position;
    const aim = this.nearestTarget(origin);
    const aimDirection =
      aim === null ? undefined : { x: aim.x - origin.x, y: aim.y - origin.y };
    const stats = this.player.derivedStats;
    runtime.applyEffects(effects, this.nowMs, {
      shotDamage: stats.damage,
      critMultiplier: stats.critMultiplier,
      ...(aimDirection !== undefined ? { aimDirection } : {}),
    });

    let clone = false;
    let venom = false;
    let kunai = false;
    let smoke = false;
    for (const effect of effects) {
      switch (effect.skillId) {
        case 'ninja-shadow-clone':
          clone = true;
          break;
        case 'ninja-venom-shuriken':
          venom = true;
          break;
        case 'ninja-kunai-burst':
          kunai = true;
          break;
        case 'ninja-smoke-bomb':
          smoke = true;
          break;
        default:
          break;
      }
    }
    // One cue per skill per dispatch, not one per kunai.
    if (clone) playNinjaCloneSfx();
    if (venom) playNinjaVenomSfx();
    if (kunai) playNinjaKunaiSfx();
    if (smoke) playNinjaSmokeSfx();
  }

  /** Feed one dispatch's effect requests to the Cultivator runtime and play one cue per skill. */
  private applyCultivatorClassSkillEffects(effects: readonly ClassSkillEffect[]): void {
    const runtime = this.cultivator;
    if (runtime === null || effects.length === 0) return;

    const origin = this.player.position;
    const aim = this.nearestTarget(origin);
    const aimDirection =
      aim === null ? undefined : { x: aim.x - origin.x, y: aim.y - origin.y };
    const stats = this.player.derivedStats;
    runtime.applyEffects(effects, this.nowMs, {
      shotDamage: stats.damage,
      critMultiplier: stats.critMultiplier,
      ...(aimDirection !== undefined ? { aimDirection } : {}),
    });

    let orbit = false;
    let array = false;
    let qi = false;
    let barrier = false;
    let evolution = false;
    for (const effect of effects) {
      switch (effect.skillId) {
        case 'cultivator-orbit-swords':
          orbit = true;
          break;
        case 'cultivator-sword-array':
          array = true;
          break;
        case 'cultivator-sword-qi':
          qi = true;
          break;
        case 'cultivator-qi-barrier':
          barrier = true;
          break;
        case 'cultivator-myriad-swords':
          evolution = true;
          break;
        default:
          break;
      }
    }
    // One cue per skill per dispatch, not one per sword/wave; the orbit cadence is throttled.
    if (orbit && this.nowMs - this.orbitSfxAtMs >= 400) {
      this.orbitSfxAtMs = this.nowMs;
      playCultivatorOrbitSfx();
    }
    if (array) playCultivatorArraySfx();
    if (qi) playCultivatorQiSfx();
    if (barrier) playCultivatorBarrierSfx();
    if (evolution) playCultivatorEvolutionSfx();
  }

  /** One class-skill hit through the real damage path (kills, gold, floating numbers). */
  private applyClassSkillHit(hit: ClassRuntimeHit): void {
    for (const enemy of this.enemies) {
      if (enemy.isDead || enemy.id !== hit.targetId) continue;
      enemy.takeDamage(hit.amount, null, this.nowMs);
      this.classSkillKilledBy.set(enemy.id, hit.skillId);
      this.reportDamage(hit.amount, enemy.position, hit.crit);
      return;
    }
    const boss = this.boss;
    if (boss !== null && !boss.isDefeated && boss.id === hit.targetId) {
      boss.takeDamage(hit.amount, this.nowMs);
      this.classSkillKilledBy.set(boss.id, hit.skillId);
      this.reportDamage(hit.amount, boss.position, hit.crit);
    }
  }

  /** Step the active class's live state and apply its hits (M20, #84/#87). */
  private stepClassSkills(deltaMs: number): void {
    const runtime = this.classRuntime;
    if (runtime === null) return;
    if (runtime.isEmpty) {
      // Still sync so clones/zones/arrays/waves that just expired disappear.
      this.syncClassSkillViews();
      return;
    }
    const targets: ClassRuntimeTarget[] = [];
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      targets.push({
        id: enemy.id,
        position: enemy.position,
        radiusTiles: enemy.radiusTiles,
      });
    }
    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      targets.push({
        id: boss.id,
        position: boss.position,
        radiusTiles: boss.hitboxRadiusTiles,
      });
    }
    const stats = this.player.derivedStats;
    const hits = runtime.step(this.nowMs, deltaMs, targets, {
      shotDamage: stats.damage,
      critMultiplier: stats.critMultiplier,
    });
    for (const hit of hits) this.applyClassSkillHit(hit);
    this.syncClassSkillViews();
  }

  /** Mirror the active class runtime into its Cocos view (one call per frame). */
  private syncClassSkillViews(): void {
    if (this.ninja !== null) this.ninjaView?.sync(this.ninja);
    if (this.cultivator !== null) {
      this.cultivatorView?.sync(this.cultivator, this.player.position, this.nowMs);
    }
  }

  /**
   * Apply the effects a class hook requested (M20; shared by every class).
   *
   * `damage` goes through the normal damage path so kills/XP/gold/`onKill` are credited;
   * `spawn` fires player bullets from the existing pool; `status` marks the target (pooled FX +
   * tint, no node or FX-per-frame); `buff` is a temporary player multiplier.
   */
  private applyClassSkillEffects(effects: readonly ClassSkillEffect[]): void {
    if (effects.length === 0) return;

    // Ninja and Cultivator own stateful runtimes: their effects are all their own ids, so the
    // generic kinds below must not also interpret them. Every other class uses the generic path.
    if (this.ninja !== null) {
      this.applyNinjaClassSkillEffects(effects);
      return;
    }
    if (this.cultivator !== null) {
      this.applyCultivatorClassSkillEffects(effects);
      return;
    }

    let spawned = false;
    for (const effect of effects) {
      switch (effect.kind) {
        case 'damage':
          if (effect.targetId !== undefined) this.applyClassDamage(effect);
          else this.damageAreaFromClassSkill(effect);
          break;
        case 'spawn':
          if (this.spawnClassSkillArrow(effect)) spawned = true;
          break;
        case 'status':
          if (effect.slowFactor !== undefined || effect.burnDps !== undefined) {
            this.applyClassStatus(effect);
          } else {
            this.markClassSkillTarget(effect);
          }
          break;
        case 'buff':
          this.player.applyClassSkillBuff(
            effect.fireRateMult ?? 1,
            effect.projectileSpeedMult ?? 1,
            effect.durationMs ?? 0,
            this.nowMs,
          );
          break;
        default:
          break;
      }
    }
    if (spawned) playSfx('shoot');
    this.presentClassSkillEffects(effects);
  }

  /** AoE damage at the effect point, through the same path as Dash Nova and Explosive. */
  private damageAreaFromClassSkill(effect: ClassSkillEffect): void {
    const baseDamage = effect.amount ?? 0;
    const radius = effect.radiusTiles ?? 0;
    if (!(baseDamage > 0)) return;

    const aoeMult = Math.max(1, this.player.derivedStats.aoePowerMult);
    const damage = baseDamage * aoeMult;
    const reach = radius * aoeMult;

    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      if (distance(effect.position, enemy.position) > reach + enemy.radiusTiles) continue;
      this.classSkillKilledBy.set(enemy.id, effect.skillId);
      enemy.takeDamage(damage, effect.position, this.nowMs);
      this.reportDamage(damage, enemy.position, false);
    }

    const boss = this.boss;
    if (
      boss !== null &&
      !boss.isDefeated &&
      distance(effect.position, boss.position) <= reach + boss.hitboxRadiusTiles
    ) {
      this.classSkillKilledBy.set(BOSS_TARGET_ID, effect.skillId);
      boss.takeDamage(damage, this.nowMs);
      this.reportDamage(damage, boss.position, false);
    }

    if (effect.fx !== undefined) {
      this.fx?.spawn(effect.fx as FxKey, effect.position, {
        drawUnits: Math.max(1.2, reach * 2),
      });
    }
    playSfx(effect.fx !== undefined ? 'explosion' : 'enemy-hit');
  }

  /** Spawn one class-skill projectile from the player pool; returns false when it cannot fly. */
  private spawnClassSkillArrow(effect: ClassSkillEffect): boolean {
    const direction = effect.direction;
    const damage = effect.amount ?? 0;
    if (direction === undefined || !(damage > 0)) return false;

    const stats = this.player.derivedStats;
    const rangeTiles =
      stats.targetingRangeTiles > 0 ? stats.targetingRangeTiles : DEFAULT_COMBAT.targetingRangeTiles;
    const speedTilesPerSecond =
      stats.projectileSpeedTilesPerSecond > 0
        ? stats.projectileSpeedTilesPerSecond
        : DEFAULT_COMBAT.projectileSpeedTilesPerSecond;
    this.player.spawnClassSkillArrow({
      position: effect.position,
      direction,
      damage,
      speedTilesPerSecond,
      ttlMs: Math.max(1200, Math.ceil((rangeTiles / speedTilesPerSecond) * 1000 * 1.5)),
      pierce: effect.pierce ?? 0,
      classSkillId: effect.skillId,
      ...(effect.ignoreTargetId !== undefined ? { ignoreTargetId: effect.ignoreTargetId } : {}),
    });
    return true;
  }

  /** Visible mark: tint the enemy until the status expires plus a small pooled spark. */
  private markClassSkillTarget(effect: ClassSkillEffect): void {
    const targetId = effect.targetId;
    const durationMs = effect.durationMs ?? 0;
    if (targetId === undefined || !(durationMs > 0)) return;

    if (targetId === BOSS_TARGET_ID) {
      this.fx?.spawn('fx.spark', effect.position, { drawUnits: 1.4, lifetimeMs: 500 });
      return;
    }
    for (const enemy of this.enemies) {
      if (enemy.id !== targetId || enemy.isDead) continue;
      enemy.applyClassSkillMark(this.nowMs + durationMs);
      this.fx?.spawn('fx.spark', enemy.position, { drawUnits: 1.1, lifetimeMs: 380 });
      return;
    }
  }

  /** Living enemies + the boss in the shape a class hook targets (M20). */
  private classSkillTargets(): readonly ClassSkillTarget[] {
    const targets: ClassSkillTarget[] = [];
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      targets.push({
        id: enemy.id,
        position: enemy.position,
        ignited: enemy.isBurning(this.nowMs),
      });
    }
    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      targets.push({
        id: BOSS_TARGET_ID,
        position: boss.position,
        ignited: this.bossStatus.isBurned(this.nowMs),
      });
    }
    return targets;
  }

  /** Whole part of a fractional class-skill hit; the remainder waits for the next tick (M20). */
  private classDamageWhole(id: string, amount: number): number {
    const step = accumulateDamage(this.classDamageCarry.get(id) ?? 0, amount);
    this.classDamageCarry.set(id, step.carry);
    return step.whole;
  }

  /** One class-skill `damage` request: direct `targetId` or an AoE around `position`. */
  private applyClassDamage(effect: ClassSkillEffect): void {
    const amount = effect.amount ?? 0;
    if (!(amount > 0)) return;

    if (effect.targetId !== undefined) {
      if (effect.targetId === BOSS_TARGET_ID) {
        this.damageBossWithClassSkill(amount);
        return;
      }
      const victim = this.enemies.find(
        (enemy) => enemy.id === effect.targetId && !enemy.isDead,
      );
      if (victim === undefined) return;
      const whole = this.classDamageWhole(victim.id, amount);
      if (whole <= 0) return;
      this.classSkillKilledBy.set(victim.id, effect.skillId);
      victim.takeDamage(whole, effect.position, this.nowMs);
      this.reportDamage(whole, victim.position, false);
      return;
    }

    const radius = effect.radiusTiles ?? 0;
    if (!(radius > 0)) return;
    for (const victim of this.enemies) {
      if (victim.isDead) continue;
      if (distance(effect.position, victim.position) > radius + victim.radiusTiles) continue;
      const whole = this.classDamageWhole(victim.id, amount);
      if (whole <= 0) continue;
      this.classSkillKilledBy.set(victim.id, effect.skillId);
      victim.takeDamage(whole, effect.position, this.nowMs);
      this.reportDamage(whole, victim.position, false);
    }
    const boss = this.boss;
    if (
      boss !== null &&
      !boss.isDefeated &&
      distance(effect.position, boss.position) <= radius + boss.hitboxRadiusTiles
    ) {
      this.damageBossWithClassSkill(amount);
    }
  }

  private damageBossWithClassSkill(amount: number): void {
    const boss = this.boss;
    if (boss === null || boss.isDefeated) return;
    const whole = this.classDamageWhole(BOSS_TARGET_ID, amount);
    if (whole <= 0) return;
    this.classSkillKilledBy.set(BOSS_TARGET_ID, 'mage-class-skill');
    boss.takeDamage(whole, this.nowMs);
    this.reportDamage(whole, boss.position, false);
  }

  /** One class-skill `status` request (slow and/or burn) on a target or an AoE. */
  private applyClassStatus(effect: ClassSkillEffect): void {
    const slowFactor = effect.slowFactor;
    const burnDps = effect.burnDps;
    const effectMs = effect.durationMs ?? 0;
    if (slowFactor === undefined && burnDps === undefined) return;

    const applyToEnemy = (enemy: EnemyView): void => {
      if (slowFactor !== undefined && effectMs > 0) {
        enemy.applyClassSlow({ factor: slowFactor, durationMs: effectMs }, this.nowMs);
      }
      if (burnDps !== undefined && effectMs > 0) {
        enemy.applyClassBurn({ dps: burnDps, durationMs: effectMs }, this.nowMs);
      }
    };
    const applyToBoss = (): void => {
      const boss = this.boss;
      if (boss === null || boss.isDefeated) return;
      if (slowFactor !== undefined && effectMs > 0) {
        this.bossStatus.applySlow({ factor: slowFactor, durationMs: effectMs }, this.nowMs);
      }
      if (burnDps !== undefined && effectMs > 0) {
        this.bossStatus.applyBurn({ dps: burnDps, durationMs: effectMs }, this.nowMs);
      }
    };

    if (effect.targetId !== undefined) {
      if (effect.targetId === BOSS_TARGET_ID) {
        applyToBoss();
        return;
      }
      const victim = this.enemies.find(
        (enemy) => enemy.id === effect.targetId && !enemy.isDead,
      );
      if (victim !== undefined) applyToEnemy(victim);
      return;
    }

    const radius = effect.radiusTiles ?? 0;
    if (!(radius > 0)) return;
    for (const victim of this.enemies) {
      if (victim.isDead) continue;
      if (distance(effect.position, victim.position) > radius + victim.radiusTiles) continue;
      applyToEnemy(victim);
    }
    const boss = this.boss;
    if (
      boss !== null &&
      !boss.isDefeated &&
      distance(effect.position, boss.position) <= radius + boss.hitboxRadiusTiles
    ) {
      applyToBoss();
    }
  }

  /**
   * Spawn the FX/SFX for a class skill's effects (M20). The per-skill tables live in
   * `core/skills/classes/<id>.ts`; Frost Orb contact is skipped because the orbiting sprites
   * themselves are the visual (`FxPool.setFrostOrbs`).
   */
  private presentClassSkillEffects(effects: readonly ClassSkillEffect[]): void {
    const source = this.classSkills;
    if (source === null || source.characterId !== 'mage') return;

    const playedSfx = new Set<string>();
    const presented = new Set<string>();
    for (const effect of effects) {
      if (effect.skillId === 'mage-frost-orbs') continue;
      if (!presented.has(effect.skillId)) {
        presented.add(effect.skillId);
        const fxKey = MAGE_SKILL_FX[effect.skillId];
        if (fxKey !== undefined) this.fx?.spawn(fxKey as FxKey, effect.position);
      }
      const sfx = MAGE_SKILL_SFX[effect.skillId];
      if (sfx !== undefined && !playedSfx.has(sfx)) {
        playedSfx.add(sfx);
        playSfx(sfx);
      }
    }
  }

  /** Draw the Mage's orbiting Frost Orbs every frame from the pure `frostOrbPositions` (M20). */
  private updateMageOrbs(deltaMs: number): void {
    const source = this.classSkills;
    if (this.fx === null || source === null || source.characterId !== 'mage') return;

    const raw = source.stacks('mage-frost-orbs');
    const stacks = Number.isFinite(raw) ? Math.min(3, Math.max(0, Math.floor(raw))) : 0;
    if (stacks <= 0) {
      this.fx.setFrostOrbs(null, deltaMs);
      return;
    }
    const evolved = source.stacks('mage-elemental-cataclysm') > 0;
    this.fx.setFrostOrbs(
      frostOrbPositions(stacks, evolved, this.nowMs, this.player.position),
      deltaMs,
    );
  }

  /** One combat frame. `realDeltaMs` has already been capped by bootstrap. */
  update(realDeltaMs: number): CombatUpdateResult {
    const player = this.player;
    const level = this.level;

    if (this.awaitingAdvance || player.isDead) {
      // Hide the orbiting Frost Orbs when the room is over (the loop stops advancing).
      this.fx?.setFrostOrbs(null, 0);
      return { frozen: false, playerDied: player.isDead, cleared: this.awaitingAdvance };
    }

    if (this.stress) this.topUpStress();

    const deltaMs = this.hitstop.step(realDeltaMs);
    if (deltaMs <= 0) {
      return { frozen: true, playerDied: false, cleared: false };
    }
    this.nowMs += deltaMs;

    // Advance action buffer, Dash, Signature Active, and skill attachment hide strictly on game-time `deltaMs`.
    this.actionBuffer.step(deltaMs);
    this.dashState = stepDash(this.dashState, deltaMs);
    this.activeSkillState = stepActiveSkill(this.activeSkillState, deltaMs);
    this.stepAttachmentHideTimer(deltaMs);

    this.tryConsumeOrStartDash(true);
    this.tryConsumeOrStartActive(true);

    // Class-skill periodic tick + Mage Frost Orb view (M20; allocation-free when nothing is owned).
    if (this.hasClassSkills()) {
      this.applyClassSkillEffects(
        this.dispatchClassSkill('tick', { dtMs: deltaMs, position: player.position }),
      );
    }
    this.updateMageOrbs(deltaMs);

    const targets: Targetable[] = this.enemies
      .filter((enemy) => !enemy.isDead)
      .map((enemy) => ({ id: enemy.id, position: enemy.position, alive: true }));
    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      targets.push({ id: BOSS_TARGET_ID, position: boss.position, alive: true });
    }

    const shotIdBefore = newestBulletId(player.bullets.active());
    player.step(
      this.nowMs,
      deltaMs,
      targets,
      level,
      this.dashState,
      this.ninja?.fireRateBonusAt(player.position, this.nowMs) ?? 0,
    );
    const shotIdAfter = newestBulletId(player.bullets.active());
    if (shotIdAfter !== shotIdBefore) {
      this.shotsFired += 1;
      // Tag this volley so `onHit` reads the shot that actually hit (Arcane Pulse every 4th shot).
      for (const bullet of player.bullets.active()) {
        if (bullet.id > shotIdBefore) bullet.shotCount = this.shotsFired;
      }
      if (this.hasClassSkills()) {
        const targetId = player.lastShotTargetId;
        const shotTarget =
          targetId === null ? undefined : targets.find((target) => target.id === targetId);
        this.applyClassSkillEffects(
          this.dispatchClassSkill('onShot', {
            shotCount: this.shotsFired,
            position: player.position,
            damage: player.derivedStats.damage,
            ...(shotTarget !== undefined ? { targetPosition: shotTarget.position } : {}),
          }),
        );
      }
    }
    // Live Ninja state (clones/clouds/kunai) before enemy AI, so its kills land this frame.
    this.stepClassSkills(deltaMs);
    // What the player can see this frame (#41): the camera's view, or one screen around the player.
    const view = this.viewNow();
    this.stepSpawns(view);
    this.stepBoss(deltaMs, player.position);
    this.stepEnemies(deltaMs, view);
    this.stepBullets(deltaMs, level);
    this.applyContactDamage();
    this.fx?.update(deltaMs);
    this.reportDeaths();

    this.bulletView?.sync();
    if (this.stress) this.topUpStress();

    if (player.isDead) {
      this.playerDied = true;
      this.clearSkillAttachmentHide();
    }

    const cleared = this.roomCleared;
    if (cleared) this.awaitingAdvance = true;

    return { frozen: false, playerDied: this.playerDied, cleared };
  }

  /** The visible rectangle in room tiles, y down — the camera's view or a screen around the player. */
  private viewNow(): ViewRect {
    const provided = this.viewProvider();
    if (provided !== null) return provided;
    return screenViewAround(this.player.position, this.level.size);
  }

  /**
   * Release scheduled spawns (#41): batched under the alive cap, never close to the player and
   * never unannounced inside the view. A spawn that lands on screen waits out its
   * `telegraphMs` (with the spawn FX) before it joins the fight; an off-screen one appears at
   * once — the player cannot see it yet, and the edge arrows point at it.
   */
  private stepSpawns(view: ViewRect): void {
    const scheduler = this.scheduler;
    if (scheduler === null) {
      this.releaseTelegraphed();
      return;
    }

    const player = this.player.position;
    const spawns = scheduler.step({
      nowMs: this.nowMs,
      player,
      view,
      alive: this.liveEnemyCount(),
    });
    for (const spawn of spawns) {
      const state = enemyStateFromSpawn(
        this.level,
        spawn,
        this.spawnedSequence,
        this.nowMs,
        this.difficulty.enemyHealthMult,
      );
      this.spawnedSequence += 1;
      if (spawn.telegraphMs > 0) {
        this.pendingSpawns.push({ state, atMs: this.nowMs + spawn.telegraphMs });
        this.showSpawnTelegraph(spawn);
      } else {
        this.addEnemy(state);
      }
    }
    this.releaseTelegraphed();
  }

  /** Make due spawns active, oldest first. */
  private releaseTelegraphed(): void {
    if (this.pendingSpawns.length === 0) return;
    const stillWaiting: PendingSpawn[] = [];
    for (const pending of this.pendingSpawns) {
      if (pending.atMs <= this.nowMs) this.addEnemy(pending.state);
      else stillWaiting.push(pending);
    }
    this.pendingSpawns.length = 0;
    for (const pending of stillWaiting) this.pendingSpawns.push(pending);
  }

  /** The "something is about to appear here" cue: a red ring of smoke for the telegraph time. */
  private showSpawnTelegraph(spawn: ScheduledSpawn): void {
    const fx = this.fx;
    if (fx === null) return;
    fx.spawn('fx.smoke-circular', spawn.at, {
      tint: SPAWN_TELEGRAPH_TINT,
      drawUnits: 1.8,
      lifetimeMs: Math.max(120, spawn.telegraphMs),
    });
    fx.spawn('fx.spark', spawn.at, {
      tint: SPAWN_TELEGRAPH_TINT,
      drawUnits: 0.9,
      lifetimeMs: Math.max(120, spawn.telegraphMs),
    });
  }

  /** Spawned and not dead, plus the spawns still telegraphing (they hold a cap slot). */
  private liveEnemyCount(): number {
    let alive = this.pendingSpawns.length;
    for (const enemy of this.enemies) {
      if (!enemy.isDead) alive += 1;
    }
    return alive;
  }

  /** Advance the boss pattern one frame + poison/burn DoT (Freeze does not apply to bosses). */
  private stepBoss(deltaMs: number, playerPosition: Vec2): void {
    const boss = this.boss;
    if (boss === null || boss.isDefeated) return;

    boss.step(this.nowMs, deltaMs, playerPosition);
    const dot =
      this.bossStatus.poisonDamage(this.nowMs, deltaMs) +
      this.bossStatus.burnDamage(this.nowMs, deltaMs);
    if (dot > 0) boss.takeDamage(dot, this.nowMs);

    // The boss body also deals damage while dashing — otherwise a Samurai charge would
    // pass through the player with nothing happening. i-frames stop multi-frame hits.
    if (
      !boss.isInIntro(this.nowMs) &&
      boss.isCharging &&
      distance(boss.position, playerPosition) <= boss.hitboxRadiusTiles + PLAYER_RADIUS_TILES
    ) {
      const heartsBefore = this.player.hearts;
      const bossContactDmg = Math.max(
        1,
        Math.round(DEFAULT_COMBAT.contactDamage * this.difficulty.enemyDamageMult),
      );
      this.damagePlayer(
        bossContactDmg,
        boss.position,
        FEEL_TUNING.shake.bossCharge,
        { kind: 'boss', bossId: boss.bossId, phase: boss.phase },
      );
      const thorns = this.player.derivedStats.thorns;
      if (thorns !== undefined && this.player.hearts < heartsBefore) {
        boss.takeDamage(thorns.damage, this.nowMs);
      }
    }
  }

  /**
   * Step enemies and trigger released attacks: predictive/burst caster shots, sniper shots,
   * bomber radial AoE blasts (+ elite follow-up pulse), buffer haste auras / solo orbs, and
   * tank/elite-chaser charge sweeps.
   */
  private stepEnemies(deltaMs: number, view: ViewRect): void {
    const player = this.player;
    this.enemyBuffs.prune(this.nowMs);
    this.livingEnemyStates.length = 0;
    for (const enemy of this.enemies) {
      if (!enemy.isDead && enemy.enemyState !== null) {
        this.livingEnemyStates.push(enemy.enemyState);
      }
    }

    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;

      const hasteMult = this.enemyBuffs.speedMultiplierFor(enemy.id, this.nowMs);
      // *Bom Khói Ẩn Thân* (#84): enemies inside a smoke zone walk slower.
      const smokeMult = this.ninja?.enemySpeedMultiplierAt(enemy.position, this.nowMs) ?? 1;
      const step = enemy.step(
        this.nowMs,
        deltaMs,
        player.position,
        this.navigation,
        view,
        hasteMult * smokeMult,
      );

      if (step.released === 'shot') {
        const role = enemy.role;
        if (role === 'caster') {
          const plan = casterShotPlan({
            elite: enemy.isElite,
            chapter: this.level.chapter,
            origin: enemy.position,
            targetPos: player.position,
            targetVel: player.velocity,
          });
          fireEnemyVolley({
            pool: player.bullets,
            from: enemy.position,
            to: plan.aimTarget,
            damage: enemy.contactDamage,
            angles: plan.angles,
            speedTilesPerSecond: plan.speedTilesPerSecond,
            source: { kind: 'enemy-bullet', role: 'caster' },
          });
        } else if (role === 'sniper') {
          const plan = sniperShotPlan();
          fireEnemyVolley({
            pool: player.bullets,
            from: enemy.position,
            to: player.position,
            damage: enemy.contactDamage,
            angles: plan.angles,
            speedTilesPerSecond: plan.speedTilesPerSecond,
            source: { kind: 'enemy-bullet', role: 'sniper' },
          });
        } else if (role === 'gunner') {
          const plan = gunnerShotPlan(enemy.isElite, this.level.chapter);
          fireEnemyVolley({
            pool: player.bullets,
            from: enemy.position,
            to: player.position,
            damage: enemy.contactDamage,
            angles: plan.angles,
            speedTilesPerSecond: plan.speedTilesPerSecond,
            source: { kind: 'enemy-bullet', role: 'gunner' },
          });
          const followUp = scheduleGunnerFollowUp({
            enemyId: enemy.id,
            origin: enemy.position,
            aimTarget: player.position,
            damage: enemy.contactDamage,
            plan,
            nowMs: this.nowMs,
          });
          if (followUp !== null) this.pendingGunnerVolleys.push(followUp);
        } else if (role !== null) {
          fireEnemyVolley({
            pool: player.bullets,
            from: enemy.position,
            to: player.position,
            damage: enemy.contactDamage,
            angles: eliteVolleyAngles(role, enemy.isElite),
            source: { kind: 'enemy-bullet', role },
          });
        }
      } else if (step.released === 'blast') {
        const state = enemy.enemyState;
        if (state !== null) {
          const spec = bomberBlastSpec(
            state,
            this.level.chapter,
            undefined,
            this.difficulty.enemyDamageMult,
          );
          this.triggerBomberBlast(spec);
          const followUp = scheduleFollowUpBlast(spec, this.nowMs);
          if (followUp !== null) this.pendingBlasts.push(followUp);
        }
      } else if (step.released === 'buff') {
        const state = enemy.enemyState;
        if (state !== null) {
          const pulse = resolveBufferPulse(state, this.livingEnemyStates, this.nowMs);
          if (pulse.kind === 'aura') {
            this.enemyBuffs.applyHaste(pulse.affectedIds, pulse.speedMultiplier, pulse.untilMs);
            this.spawnBufferAuraEffects(pulse);
          } else {
            fireEnemyVolley({
              pool: player.bullets,
              from: pulse.center,
              to: player.position,
              damage: enemy.contactDamage,
              angles: pulse.angles,
              speedTilesPerSecond: pulse.speedTilesPerSecond,
              source: { kind: 'enemy-bullet', role: 'buffer' },
            });
          }
        }
      }

      // Dash hits the player: sweep the whole path, each dash costs HP only once.
      const sweep = step.chargeSweep;
      if (
        sweep !== null &&
        !enemy.chargeHitApplied &&
        segmentHitsCircle(sweep.from, sweep.to, player.position, PLAYER_RADIUS_TILES, enemy.radiusTiles)
      ) {
        enemy.markChargeHit();
        const role = enemy.role;
        this.damagePlayer(
          enemy.contactDamage,
          sweep.to,
          FEEL_TUNING.shake.playerHurt,
          role !== null ? { kind: 'enemy', role, elite: enemy.isElite } : { kind: 'unknown' },
        );
      }
    }

    if (this.pendingBlasts.length > 0) {
      const { triggered, remaining } = stepPendingBlasts(this.pendingBlasts, this.nowMs);
      this.pendingBlasts = remaining;
      for (const blast of triggered) {
        this.triggerBomberBlast(blast);
      }
    }

    if (this.pendingGunnerVolleys.length > 0) {
      const { triggered, remaining } = stepPendingGunnerVolleys(
        this.pendingGunnerVolleys,
        this.nowMs,
      );
      this.pendingGunnerVolleys = remaining;
      for (const volley of triggered) {
        const shooter = this.enemies.find((e) => e.id === volley.enemyId && !e.isDead);
        if (shooter === undefined) continue;
        fireEnemyVolley({
          pool: player.bullets,
          from: shooter.position,
          to: player.position,
          damage: volley.damage,
          angles: volley.angles,
          speedTilesPerSecond: volley.speedTilesPerSecond,
          source: { kind: 'enemy-bullet', role: 'gunner' },
        });
      }
    }

    this.separateEnemyBodies();
  }

  /**
   * Push overlapping bodies apart (spatial hash in core, cell ≈ 1 tile, so not O(n²)).
   * Same rule as the balance sim; the push goes through `moveWithCollision`, so it never
   * ends inside an obstacle.
   */
  private separateEnemyBodies(): void {
    const bodies: SeparationBody[] = [];
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      bodies.push({ id: enemy.id, position: enemy.position, radiusTiles: enemy.radiusTiles });
    }
    if (bodies.length < 2) return;

    const moved = separateEnemies(bodies, this.level, ROOM_EDGE_MARGIN_TILES);
    if (moved.size === 0) return;

    for (const enemy of this.enemies) {
      const position = moved.get(enemy.id);
      if (position !== undefined) enemy.moveTo(position);
    }
  }

  /**
   * Bullet travel + collisions. Enemy bullets cost the player HP (the `HealthState`
   * i-frame blocks two hits within 0.8 s); player bullets apply every skill (crit/execute/pierce/
   * ricochet/homing/explosion/freeze/poison/lifesteal) and **request hitstop** on hit.
   */
  private stepBullets(deltaMs: number, level: LevelData): void {
    const player = this.player;
    const stats = player.derivedStats;
    const pool = player.bullets;

    // Homing steers before moving, using the start-of-frame position.
    for (const bullet of pool.active()) {
      if (!bullet.homing || bullet.owner !== 'player') continue;
      const aim = this.nearestTarget(bullet.position);
      if (aim === null) continue;
      const turn = (HOMING_TURN_RATE_RADIANS_PER_SECOND * deltaMs) / 1000;
      const next = steerVelocity(bullet.velocity, bullet.position, aim, turn);
      bullet.velocity.x = next.x;
      bullet.velocity.y = next.y;
    }

    pool.update(deltaMs);
    pool.consumeWhere((bullet) => !isInsideRoom(level, bullet.position));

    const seconds = deltaMs / 1000;
    const spent = new Set<number>();
    /** `onHit` effects are applied after the loop: spawning into `active()` mid-iteration is unsafe. */
    const classSkillEffects = this.classSkillEffectBuffer;
    classSkillEffects.length = 0;

    for (const bullet of pool.active()) {
      // Obstacles block bullets — sweep along the path so a fast bullet cannot tunnel a 1-tile pillar.
      const from = {
        x: bullet.position.x - bullet.velocity.x * seconds,
        y: bullet.position.y - bullet.velocity.y * seconds,
      };
      if (firstHit({ from, to: bullet.position }, level) !== null) {
        spent.add(bullet.id);
        continue;
      }

      const area = { position: bullet.position, radiusTiles: bullet.radiusTiles };

      if (bullet.owner === 'enemy') {
        if (!hitsCircle(area, { position: player.position, radiusTiles: PLAYER_RADIUS_TILES })) {
          continue;
        }
        spent.add(bullet.id);
        this.damagePlayer(
          bullet.damage,
          bullet.position,
          FEEL_TUNING.shake.playerHurt,
          bullet.source ?? { kind: 'enemy-bullet' },
        );
        continue;
      }

      let consumed = false;

      // `#108`: a Signature volley rolls no crit, so its own damage is its base; an auto-fire
      // bullet compares against the player's shot damage (crit was multiplied in at fire time).
      const signature = this.signatureBullets.get(bullet.id);
      const baseDamage = signature === undefined ? stats.damage : bullet.damage;

      // Boss first (the main target in a boss room), then the mobs.
      const boss = this.boss;
      if (
        boss !== null &&
        !boss.isDefeated &&
        !bullet.hitIds.includes(BOSS_TARGET_ID) &&
        hitsCircle(area, { position: boss.position, radiusTiles: boss.hitboxRadiusTiles })
      ) {
        this.bossStatus.apply(stats, this.nowMs);
        const afflicted = this.bossStatus.hasAnyStatus(this.nowMs);
        const executed = damageAfterExecute(
          stats,
          bullet.damage,
          boss.health / boss.maxHealth,
        );
        const damage = damageWithStatusBonus(stats, executed, afflicted);
        const crit = isRealCrit(bullet.damage, baseDamage);
        boss.takeDamage(damage, this.nowMs);
        this.reportDamage(damage, boss.position, crit);
        if (this.hasClassSkills()) {
          const direction = unitDirection(bullet.velocity);
          classSkillEffects.push(
            ...this.dispatchClassSkill('onHit', {
              position: bullet.position,
              targetPosition: boss.position,
              targetId: BOSS_TARGET_ID,
              crit: bullet.crit,
              damage,
              firstHit: bullet.hitIds.length === 0,
              shotCount: bullet.shotCount,
              ...(direction !== null ? { direction } : {}),
              ...(bullet.classSkillId !== undefined
                ? { projectileSkillId: bullet.classSkillId }
                : {}),
            }),
          );
        }
        this.activeSkillState = onActiveHit(this.activeSkillState, this.activeConfig, 1);
        playSfx('enemy-hit');
        const heartsBefore = player.hearts;
        const healed = player.heal(lifestealHeal(stats, damage)) - heartsBefore;
        bullet.hitIds.push(BOSS_TARGET_ID);
        this.spawnHitEffects({
          position: boss.position,
          crit,
          executeApplied: executed > bullet.damage + 1e-9,
          healed,
          // Bosses ignore Freeze/Poison/Burn FX procs so status visuals stay readable on mobs.
          poisonStarted: false,
          burnStarted: false,
        });
        this.applyShockArcs(BOSS_TARGET_ID, boss.position, bullet.damage, stats);
        this.explode(bullet, boss.position, null);
        this.requestPlayerHitHitstop(bullet.damage, baseDamage, signature?.castId ?? null);
        consumed = this.resolveBullet(bullet);
        if (consumed) {
          spent.add(bullet.id);
          continue;
        }
      }

      for (const victim of this.enemies) {
        if (victim.isDead || bullet.hitIds.includes(victim.id)) continue;
        if (!hitsCircle(area, { position: victim.position, radiusTiles: victim.radiusTiles })) {
          continue;
        }

        const status = victim.applyStatus(stats, this.nowMs);
        const afflicted = victim.hasAnyStatus(this.nowMs);
        const executed = damageAfterExecute(stats, bullet.damage, victim.health / victim.maxHealth);
        const damage = damageWithStatusBonus(stats, executed, afflicted);
        const crit = isRealCrit(bullet.damage, baseDamage);
        victim.takeDamage(damage, bullet.position, this.nowMs);
        this.reportDamage(damage, victim.position, crit);
        if (this.hasClassSkills()) {
          const direction = unitDirection(bullet.velocity);
          classSkillEffects.push(
            ...this.dispatchClassSkill('onHit', {
              position: bullet.position,
              targetPosition: victim.position,
              targetId: victim.id,
              crit: bullet.crit,
              damage,
              firstHit: bullet.hitIds.length === 0,
              shotCount: bullet.shotCount,
              ...(direction !== null ? { direction } : {}),
              ...(bullet.classSkillId !== undefined
                ? { projectileSkillId: bullet.classSkillId }
                : {}),
            }),
          );
        }
        this.activeSkillState = onActiveHit(this.activeSkillState, this.activeConfig, 1);
        playSfx('enemy-hit');
        const heartsBefore = player.hearts;
        const healed = player.heal(lifestealHeal(stats, damage)) - heartsBefore;
        bullet.hitIds.push(victim.id);
        this.spawnHitEffects({
          position: victim.position,
          crit,
          executeApplied: executed > bullet.damage + 1e-9,
          healed,
          poisonStarted: status.poisonStarted,
          burnStarted: status.burnStarted,
        });
        this.applyShockArcs(victim.id, victim.position, bullet.damage, stats);
        this.explode(bullet, victim.position, victim);
        this.requestPlayerHitHitstop(bullet.damage, baseDamage, signature?.castId ?? null);
        consumed = this.resolveBullet(bullet);
        if (consumed) break;
      }

      if (consumed) spent.add(bullet.id);
    }

    if (spent.size > 0) {
      for (const id of spent) this.signatureBullets.delete(id);
      pool.consumeWhere((bullet) => spent.has(bullet.id));
    }

    if (classSkillEffects.length > 0) {
      this.applyClassSkillEffects(classSkillEffects);
      classSkillEffects.length = 0;
    }
  }

  /**
   * Request the hitstop beat for a player bullet hit (#108).
   *
   * Normal shots freeze on every hit (70 ms, 110 ms on a real crit). A Signature volley freezes
   * once per cast — the first blade that lands — instead of once per blade, which used to stack
   * a chain of crit-length freezes and stutter the game.
   */
  private requestPlayerHitHitstop(
    damage: number,
    baseDamage: number,
    signatureCastId: number | null,
  ): void {
    const ms = this.playerHitHitstop.hitstopFor({ damage, baseDamage, signatureCastId });
    if (ms > 0) this.hitstop.request(ms);
  }

  /** AoE explosion around the hit point: extra damage to every other target in range. */
  private explode(
    bullet: { readonly explosiveRadiusTiles: number; readonly explosiveDamage: number; readonly hitIds: readonly string[] },
    center: Vec2,
    direct: EnemyView | null,
  ): void {
    const aoeMult = Math.max(1, this.player.derivedStats.aoePowerMult);
    const radiusTiles = bullet.explosiveRadiusTiles * aoeMult;
    const damage = bullet.explosiveDamage * aoeMult;
    if (radiusTiles <= 0 || damage <= 0) return;

    for (const enemy of this.enemies) {
      if (enemy.isDead || enemy === direct || bullet.hitIds.includes(enemy.id)) continue;
      if (distance(center, enemy.position) > radiusTiles) continue;
      enemy.takeDamage(damage, center, this.nowMs);
    }

    const boss = this.boss;
    if (
      boss !== null &&
      !boss.isDefeated &&
      !bullet.hitIds.includes(BOSS_TARGET_ID) &&
      distance(center, boss.position) <= radiusTiles
    ) {
      boss.takeDamage(damage, this.nowMs);
    }

    this.fx?.spawn('fx.explosion', center, {
      drawUnits: Math.max(1.2, radiusTiles * 2),
      lifetimeMs: 820,
    });
    // The smoke ring belongs to the explosive impact, so it stays under Reduced like the
    // explosion itself (only the extra particles are dropped there).
    this.fx?.spawn('fx.smoke-circular', center, {
      drawUnits: Math.max(1.0, radiusTiles * 1.6),
      lifetimeMs: 900,
    });
    this.shake?.addTrauma(FEEL_TUNING.shake.explosion);
    playSfx('explosion');
  }

  /**
   * After a hit: Piercing keeps the bullet, Ricochet redirects it, everything else is
   * recalled. Returns `true` when the bullet must be dropped.
   */
  private resolveBullet(bullet: {
    pierceRemaining: number;
    ricochetRemaining: number;
    velocity: { x: number; y: number };
    position: Vec2;
    hitIds: string[];
  }): boolean {
    if (bullet.pierceRemaining > 0) {
      bullet.pierceRemaining -= 1;
      // The bullet went through: a small cut at the entry point reads as "it kept going".
      this.fx?.spawn('fx.cut', bullet.position, { drawUnits: 0.8, lifetimeMs: 220 });
      return false;
    }

    if (bullet.ricochetRemaining > 0) {
      const candidates: Array<{ id: string; position: Vec2 }> = this.enemies
        .filter((enemy) => !enemy.isDead)
        .map((enemy) => ({ id: enemy.id, position: enemy.position }));
      const boss = this.boss;
      if (boss !== null && !boss.isDefeated) {
        candidates.push({ id: BOSS_TARGET_ID, position: boss.position });
      }

      const next = ricochetTarget(bullet.position, candidates, bullet.hitIds);
      if (next !== null) {
        bullet.ricochetRemaining -= 1;
        const speed = Math.hypot(bullet.velocity.x, bullet.velocity.y);
        const dx = next.position.x - bullet.position.x;
        const dy = next.position.y - bullet.position.y;
        const length = Math.hypot(dx, dy) || 1;
        bullet.velocity.x = (dx / length) * speed;
        bullet.velocity.y = (dy / length) * speed;
        // Spark at the bounce point + a short tracer to the new target (Ricochet).
        this.fx?.spawn('fx.spark', bullet.position);
        this.fx?.line(bullet.position, next.position, RICOCHET_TINT);
        return false;
      }
    }

    return true;
  }

  /** Nearest target for Homing: the boss or a living enemy. */
  private nearestTarget(from: Vec2): Vec2 | null {
    let best: Vec2 | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      best = boss.position;
      bestGap = distance(from, boss.position);
    }
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      const gap = distance(from, enemy.position);
      if (gap < bestGap) {
        best = enemy.position;
        bestGap = gap;
      }
    }
    return best;
  }

  /** Chaser/tank contact damage (i-frames handle "no two hearts lost in a row"). */
  private applyContactDamage(): void {
    const player = this.player;
    const thorns = player.derivedStats.thorns;

    for (const enemy of this.enemies) {
      if (enemy.isDead || !enemy.melee) continue;
      if (distance(enemy.position, player.position) > enemy.contactRangeTiles) continue;

      const heartsBefore = player.hearts;
      const role = enemy.role;
      this.damagePlayer(
        enemy.contactDamage,
        enemy.position,
        FEEL_TUNING.shake.playerHurt,
        role !== null ? { kind: 'enemy', role, elite: enemy.isElite } : { kind: 'unknown' },
      );
      // Thorns only fires when the blow **actually** reaches a heart, not when a shield/i-frame blocks it.
      if (thorns !== undefined && player.hearts < heartsBefore) {
        enemy.takeDamage(thorns.damage, player.position, this.nowMs);
      }
    }
  }

  /**
   * Dedicated hit impact (ticket #3): every hit gets the base spark; crit/freeze/poison/execute
   * add their own effect. Secondary particles (bubbles, lifesteal orbs) obey `Settings.effects`.
   * Purely visual — damage, hitbox and hitstop default are untouched.
   */
  private spawnHitEffects(args: {
    readonly position: Vec2;
    readonly crit: boolean;
    readonly executeApplied: boolean;
    readonly healed: number;
    /** The poison status started on this hit — its FX lives here so it fires once, not per hit. */
    readonly poisonStarted: boolean;
    readonly burnStarted: boolean;
  }): void {
    const fx = this.fx;
    if (fx === null) return;

    const vfx = FEEL_TUNING.vfx;
    const secondary = this.secondaryParticles;

    fx.spawn('fx.impact', args.position, {
      tint: HIT_TINT,
      drawUnits: args.crit ? vfx.critImpactDrawUnits : vfx.impactDrawUnits,
    });
    if (args.crit) {
      // A short pure-white flash on top of the larger spark.
      fx.spawn('fx.impact', args.position, {
        tint: CRIT_FLASH_TINT,
        drawUnits: vfx.critImpactDrawUnits + 0.6,
        lifetimeMs: 110,
      });
    }

    // Freeze/Poison sprites are spawned by `EnemyView.applyStatus` on the first application only;
    // repeating them on every hit of a rapid-fire volley is the same picture several times.
    if (args.poisonStarted && secondary) {
      for (let index = 0; index < 2; index += 1) {
        const angle = (index / 2) * Math.PI * 2;
        fx.spawn(
          'fx.bubble',
          { x: args.position.x + Math.cos(angle) * 0.3, y: args.position.y + Math.sin(angle) * 0.3 },
          { tint: POISON_TINT, drawUnits: 0.35, lifetimeMs: 500 },
        );
      }
    }

    if (args.burnStarted && secondary) {
      for (let index = 0; index < 2; index += 1) {
        const angle = (index / 2) * Math.PI * 2 + 0.5;
        fx.spawn(
          'fx.spark',
          { x: args.position.x + Math.cos(angle) * 0.25, y: args.position.y + Math.sin(angle) * 0.25 },
          { tint: BURN_TINT, drawUnits: 0.75, lifetimeMs: 360 },
        );
      }
    }

    if (args.executeApplied) {
      fx.spawn('fx.slash-arc', args.position);
      fx.spawn('fx.impact', args.position, {
        tint: EXECUTE_TINT,
        drawUnits: vfx.impactDrawUnits + 0.4,
        lifetimeMs: 120,
      });
    }

    if (args.healed > 0 && secondary) {
      // A few red orbs flying from the victim back to the player.
      for (let index = 0; index < 3; index += 1) {
        const angle = (index / 3) * Math.PI * 2;
        fx.spawn(
          'fx.spark',
          { x: args.position.x + Math.cos(angle) * 0.25, y: args.position.y + Math.sin(angle) * 0.25 },
          {
            tint: LIFESTEAL_TINT,
            to: this.player.position,
            travelMs: 240,
            lifetimeMs: 260,
          },
        );
      }
    }
  }

  /** `Settings.effects`: Reduced drops the extra particles (impacts/telegraphs stay). */
  setEffectsMode(mode: EffectsMode): void {
    this.effectsMode = mode;
    this.secondaryParticles = effectsLayers(mode).secondaryParticles;
  }

  /**
   * Returns `true` when hearts actually drop (so Thorns does not trigger on shield/i-frame).
   * A real hit adds camera-shake trauma (a boss charge passes a larger number).
   */
  private damagePlayer(
    amount: number,
    source: Vec2 | null,
    trauma: number = FEEL_TUNING.shake.playerHurt,
    cause: DeathCause = { kind: 'unknown' },
  ): boolean {
    if (this.god) return false;
    // *Hộ Tâm Linh Khí*: the Qi shield absorbs exactly the next hit (M20, #87). Respect i-frames
    // first, exactly like the sim's `damagePlayer`, so a dash never wastes the shield.
    if (
      this.cultivator !== null &&
      !this.player.isInvulnerable(this.nowMs) &&
      this.cultivator.consumeQiShield()
    ) {
      this.fx?.spawnShockwave(this.player.position, {
        startRadiusTiles: 0.4,
        endRadiusTiles: 1.8,
        durationMs: 320,
        tint: new CocosColor(150, 246, 220, 220),
      });
      playCultivatorBarrierSfx();
      return false;
    }
    const before = this.player.hearts;
    this.player.applyDamage(this.nowMs, amount, source);
    if (this.player.hearts >= before) return false;

    if (this.player.isDead) {
      this.lastDeathCause = cause;
    }
    this.shake?.addTrauma(trauma);
    return true;
  }

  /** Floating damage number at the hit point (the HUD adapter decides whether to draw it). */
  private reportDamage(amount: number, position: Vec2, crit: boolean): void {
    if (!(amount > 0)) return;
    this.onDamage({ amount, position, crit });
  }

  /** Spawn one enemy and attach its node. Boss/debug share this path. */
  addEnemy(
    state: EnemyState,
    options: {
      readonly monster?: string;
      readonly radiusTiles?: number;
      readonly contactRangeTiles?: number;
      readonly roleScale?: number;
    } = {},
  ): EnemyView | null {
    const monster = options.monster ?? this.monsterFor(state.role);

    const node = new CocosNodeValue(`${monster}-${state.id}`);
    node.parent = this.actorLayer;

    const sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.TRIMMED;
    sprite.trim = false;

    // 1 texture px = 1/16 unit (see `ACTOR_SCALE` in level-view).
    const scale = ACTOR_SCALE;
    node.setScale(scale, scale, 1);

    node.addComponent(SpriteAnimator);
    const enemyView = node.addComponent(EnemyView) as EnemyView;
    enemyView.init({
      state,
      monster,
      level: this.level,
      baseScale: scale,
      radiusTiles: options.radiusTiles,
      contactRangeTiles: options.contactRangeTiles,
      roleScale: options.roleScale,
      random: () => this.rng.next(),
      damageMult: this.difficulty.enemyDamageMult,
      speedMult: this.difficulty.enemySpeedMult,
      fireRateMult: this.difficulty.enemyFireRateMult,
      ...(this.fx !== null ? { fx: this.fx } : {}),
    });

    this.enemies.push(enemyView);
    return enemyView;
  }

  /** Kill every living enemy through the normal damage path (wave/room clear runs like real play). */
  killAll(): number {
    let killed = 0;
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      enemy.takeDamage(enemy.health, null, this.nowMs);
      killed += 1;
    }
    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      boss.takeDamage(boss.health, this.nowMs);
      killed += 1;
    }
    // #41: a debug/acceptance "clear this room" must not be refilled by the scheduler, and the
    // telegraphs still waiting must not spawn behind the cleared check.
    this.scheduler = null;
    this.pendingSpawns.length = 0;
    // Bulk debug kills must still pay gold exactly like real play (M5).
    this.reportDeaths();
    return killed;
  }

  /**
   * Report each enemy/boss death exactly once. Called after every damage path (update,
   * `killAll`, `setBossHealthFraction`) so bootstrap credits gold in that same frame.
   */
  private reportDeaths(): void {
    /** Splitlings left by splitters that died this frame (#42), spawned after the loop. */
    const splits: EnemyState[] = [];

    for (const enemy of this.enemies) {
      if (!enemy.isDead || this.rewarded.has(enemy.id)) continue;
      this.rewarded.add(enemy.id);
      this.enemyBuffs.forget(enemy.id);
      this.activeSkillState = onActiveKill(this.activeSkillState, this.activeConfig, 1);
      const role = enemy.role;
      if (role !== null) this.onKill(role, enemy.isElite, enemy.position);
      if (this.hasClassSkills()) {
        const killedBy = this.classSkillKilledBy.get(enemy.id);
        this.applyClassSkillEffects(
          this.dispatchClassSkill('onKill', {
            position: enemy.position,
            targetPosition: enemy.position,
            targetId: enemy.id,
            elite: enemy.isElite,
            ...(killedBy !== undefined ? { killedBy } : {}),
          }),
        );
      }
      // Gold sparkle at the death spot (there are no pickups in a run).
      this.fx?.spawn('fx.impact', enemy.position, {
        tint: new CocosColor(255, 214, 90, 255),
        drawUnits: 0.9,
        lifetimeMs: 320,
      });
      playSfx('gold');

      const state = enemy.enemyState;
      if (state !== null && state.role === 'splitter') {
        splits.push(...splitOnDeath(state, this.level, this.nowMs));
      }
    }

    // Spawn after iterating: `addEnemy` pushes into `this.enemies`.
    for (const child of splits) {
      if (this.difficulty.enemyHealthMult !== 1) {
        const scaledHp = Math.max(
          1,
          Math.round(child.maxHealth * this.difficulty.enemyHealthMult),
        );
        child.maxHealth = scaledHp;
        child.health = scaledHp;
      }
      this.addEnemy(child);
      this.fx?.spawn('fx.smoke', child.position);
    }

    const boss = this.boss;
    if (boss !== null && boss.isDefeated && !this.bossRewarded) {
      this.bossRewarded = true;
      this.activeSkillState = onActiveKill(this.activeSkillState, this.activeConfig, 1);
      this.onBossKilled();
      if (this.hasClassSkills()) {
        const killedBy = this.classSkillKilledBy.get(boss.id);
        this.applyClassSkillEffects(
          this.dispatchClassSkill('onKill', {
            position: boss.position,
            targetPosition: boss.position,
            targetId: BOSS_TARGET_ID,
            elite: false,
            ...(killedBy !== undefined ? { killedBy } : {}),
          }),
        );
      }
    }

    // Attribution only matters for the frame the killing blow landed.
    this.classSkillKilledBy.clear();
  }

  /** Try consuming buffered `'dash'` (or start directly in debug) and execute Dash + Dash Nova. */
  private tryConsumeOrStartDash(fromBuffer: boolean): boolean {
    if (!canStartDash(this.dashState)) return false;
    if (fromBuffer && !this.actionBuffer.has('dash')) return false;

    const stats = this.player.derivedStats;
    const dir = resolveDashDirection(
      this.player.moveDirectionTile(),
      this.player.facingVectorTile(),
    );
    const result = tryStartDash(this.dashState, dir, this.dashConfig, stats.dashCooldownMult);
    if (!result.started) return false;

    if (fromBuffer) this.actionBuffer.consume('dash');
    else this.actionBuffer.clear('dash');

    this.dashState = result.state;
    this.dashesUsed += 1;
    this.player.startDash(this.nowMs, result.state);
    if (this.hasClassSkills()) {
      this.applyClassSkillEffects(
        this.dispatchClassSkill('onDash', { position: this.player.position }),
      );
    }
    this.triggerDashNova(stats);
    return true;
  }

  /** Radial AoE burst emitted at Dash start when `Dash Nova` / `Shadowstep` is owned. */
  private triggerDashNova(stats: DerivedStats): void {
    const nova = stats.dashNova;
    if (nova === undefined || !(nova.radiusTiles > 0) || !(nova.damage > 0)) return;

    const aoeMult = Math.max(1, stats.aoePowerMult);
    const radiusTiles = nova.radiusTiles * aoeMult;
    const damage = nova.damage * aoeMult;

    const origin = this.player.position;
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      if (distance(origin, enemy.position) > radiusTiles + enemy.radiusTiles) continue;
      enemy.takeDamage(damage, origin, this.nowMs);
      this.reportDamage(damage, enemy.position, false);
    }

    const boss = this.boss;
    if (
      boss !== null &&
      !boss.isDefeated &&
      distance(origin, boss.position) <= radiusTiles + boss.hitboxRadiusTiles
    ) {
      boss.takeDamage(damage, this.nowMs);
      this.reportDamage(damage, boss.position, false);
    }

    this.fx?.spawnShockwave(origin, {
      startRadiusTiles: 0.4,
      endRadiusTiles: radiusTiles,
      durationMs: 280,
      lineWidth: 0.11,
      tint: DASH_NOVA_TINT,
    });
    this.fx?.spawn('fx.boost', origin, {
      drawUnits: radiusTiles * 1.4,
      tint: DASH_NOVA_TINT,
      lifetimeMs: 360,
    });
    this.shake?.addTrauma(0.18);
    playDashNovaSfx();
  }

  /** Try consuming buffered `'active'` (or trigger directly in debug) to fire the class's Signature Active. */
  private tryConsumeOrStartActive(fromBuffer: boolean): boolean {
    if (!isActiveSkillReady(this.activeSkillState)) return false;
    if (fromBuffer && !this.actionBuffer.has('active')) return false;

    const stats = this.player.derivedStats;
    const triggered = tryActivateSkill(
      this.activeSkillState,
      this.activeConfig,
      stats.activeCooldownMult,
    );
    if (!triggered.triggered) return false;

    if (fromBuffer) this.actionBuffer.consume('active');
    else this.actionBuffer.clear('active');

    this.activeSkillState = triggered.state;
    this.activeSkillsUsed += 1;

    const origin = this.player.position;
    const nearest = this.nearestTarget(origin);
    const aimDir =
      nearest !== null
        ? { x: nearest.x - origin.x, y: nearest.y - origin.y }
        : this.player.facingVectorTile();

    switch (this.signatureSkillId) {
      case 'shadow-barrage':
        this.castShadowBarrage(origin, aimDir, stats);
        break;
      case 'piercing-volley':
        this.castPiercingVolley(origin, aimDir, stats);
        break;
      case 'arcane-nova':
        this.castArcaneNova(origin, stats);
        break;
      case 'ten-thousand-swords':
        this.castTenThousandSwords(origin, aimDir, stats);
        break;
    }

    if (this.hasClassSkills()) {
      this.applyClassSkillEffects(this.dispatchClassSkill('onActive', { position: origin }));
    }

    return true;
  }

  private spawnSignatureVolley(
    volley: readonly SignatureProjectile[],
    skillId: SignatureSkillId,
  ): void {
    // Bound map size when older TTL-expired bullet IDs are no longer active.
    if (this.signatureBullets.size > 256) {
      for (const id of this.signatureBullets.keys()) {
        this.signatureBullets.delete(id);
        if (this.signatureBullets.size <= 192) break;
      }
    }

    this.signatureCastCount += 1;
    const castId = this.signatureCastCount;
    for (const blade of volley) {
      const spawned = this.player.bullets.spawn({
        position: blade.position,
        velocity: blade.velocity,
        radiusTiles: blade.radiusTiles,
        damage: blade.damage,
        owner: 'player',
        ttlMs: blade.ttlMs,
        pierceRemaining: blade.pierceRemaining,
        homing: blade.homing,
      });
      this.signatureBullets.set(spawned.id, { skillId, castId });
    }
  }

  private castShadowBarrage(origin: Vec2, aimDir: Vec2, stats: DerivedStats): void {
    const volley = computeShadowBarrageVolley(origin, aimDir, stats.activePowerMult, {
      baseDamage: stats.damage,
    });
    this.spawnSignatureVolley(volley, 'shadow-barrage');

    this.fx?.spawnShockwave(origin, {
      startRadiusTiles: 0.35,
      endRadiusTiles: 2.2,
      durationMs: 260,
      lineWidth: 0.1,
      tint: SHADOW_BARRAGE_TINT,
    });
    this.fx?.spawn('fx.slash-arc', origin, {
      drawUnits: 2.4,
      tint: SHADOW_BARRAGE_TINT,
      lifetimeMs: 300,
    });
    playActiveSkillSfx('shadow-barrage');
  }

  private castPiercingVolley(origin: Vec2, aimDir: Vec2, stats: DerivedStats): void {
    const volley = computePiercingVolley(origin, aimDir, stats.activePowerMult, {
      baseDamage: stats.damage,
    });
    this.spawnSignatureVolley(volley, 'piercing-volley');

    const len = Math.hypot(aimDir.x, aimDir.y);
    const nx = len > 1e-6 ? aimDir.x / len : 1;
    const ny = len > 1e-6 ? aimDir.y / len : 0;
    this.fx?.spawnShockwave(origin, {
      startRadiusTiles: 0.3,
      endRadiusTiles: 1.9,
      durationMs: 220,
      lineWidth: 0.08,
      tint: PIERCING_VOLLEY_TINT,
    });
    this.fx?.spawn(
      'fx.spark',
      { x: origin.x + nx * 0.45, y: origin.y + ny * 0.45 },
      { drawUnits: 1.4, tint: PIERCING_VOLLEY_TINT, lifetimeMs: 220 },
    );
    playActiveSkillSfx('piercing-volley');
  }

  private castArcaneNova(origin: Vec2, stats: DerivedStats): void {
    const nova = computeArcaneNovaSpec(origin, stats.activePowerMult, {
      baseDamage: stats.damage,
      aoePowerMult: stats.aoePowerMult,
    });
    const novaStatusStats: DerivedStats = {
      ...stats,
      slowOnHit: { factor: nova.slowFactor, durationMs: nova.slowDurationMs },
      poisonOnHit: undefined,
      burnOnHit: undefined,
    };

    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      if (distance(origin, enemy.position) > nova.radiusTiles + enemy.radiusTiles) continue;
      enemy.applyStatus(novaStatusStats, this.nowMs);
      const afflicted = enemy.hasAnyStatus(this.nowMs);
      const executed = damageAfterExecute(stats, nova.damage, enemy.health / enemy.maxHealth);
      const damage = damageWithStatusBonus(stats, executed, afflicted);
      enemy.takeDamage(damage, origin, this.nowMs);
      this.reportDamage(damage, enemy.position, false);
      this.activeSkillState = onActiveHit(this.activeSkillState, this.activeConfig, 1);
      this.fx?.spawn('fx.impact', enemy.position, {
        tint: ARCANE_NOVA_CYAN_TINT,
        drawUnits: 1.3,
        lifetimeMs: 260,
      });
    }

    const boss = this.boss;
    if (
      boss !== null &&
      !boss.isDefeated &&
      distance(origin, boss.position) <= nova.radiusTiles + boss.hitboxRadiusTiles
    ) {
      this.bossStatus.applySlow(
        { factor: nova.slowFactor, durationMs: nova.slowDurationMs },
        this.nowMs,
      );
      const afflicted = this.bossStatus.hasAnyStatus(this.nowMs);
      const executed = damageAfterExecute(stats, nova.damage, boss.health / boss.maxHealth);
      const damage = damageWithStatusBonus(stats, executed, afflicted);
      boss.takeDamage(damage, this.nowMs);
      this.reportDamage(damage, boss.position, false);
      this.activeSkillState = onActiveHit(this.activeSkillState, this.activeConfig, 1);
      this.fx?.spawn('fx.impact', boss.position, {
        tint: ARCANE_NOVA_CYAN_TINT,
        drawUnits: 1.6,
        lifetimeMs: 280,
      });
    }

    this.spawnSignatureVolley(nova.bolts, 'arcane-nova');

    this.fx?.spawnShockwave(origin, {
      startRadiusTiles: 0.4,
      endRadiusTiles: nova.radiusTiles,
      durationMs: 340,
      lineWidth: 0.14,
      tint: ARCANE_NOVA_CYAN_TINT,
    });
    this.fx?.spawnShockwave(origin, {
      startRadiusTiles: 0.25,
      endRadiusTiles: nova.radiusTiles * 0.72,
      durationMs: 260,
      lineWidth: 0.1,
      tint: SHADOW_BARRAGE_TINT,
    });
    this.fx?.spawn('fx.boost', origin, {
      drawUnits: Math.max(2.4, nova.radiusTiles * 1.1),
      tint: ARCANE_NOVA_CYAN_TINT,
      lifetimeMs: 420,
    });
    this.shake?.addTrauma(0.22);
    playActiveSkillSfx('arcane-nova');
  }

  private castTenThousandSwords(origin: Vec2, aimDir: Vec2, stats: DerivedStats): void {
    const cast = computeTenThousandSwordsVolley(origin, aimDir, stats.activePowerMult, {
      baseDamage: stats.damage,
    });
    this.spawnSignatureVolley(cast.projectiles, 'ten-thousand-swords');

    if (cast.hideAttachmentMs > 0) {
      this.player.hideAttachmentForSkill(cast.attachmentSkillId);
      this.activeAttachmentHideToken = cast.attachmentSkillId;
      this.activeAttachmentHideRemainingMs = cast.hideAttachmentMs;
    }

    this.fx?.spawnShockwave(origin, {
      startRadiusTiles: 0.35,
      endRadiusTiles: 2.4,
      durationMs: 280,
      lineWidth: 0.11,
      tint: TEN_THOUSAND_SWORDS_TINT,
    });
    this.fx?.spawn('fx.slash-arc', origin, {
      drawUnits: 2.6,
      tint: TEN_THOUSAND_SWORDS_TINT,
      lifetimeMs: 320,
    });
    playActiveSkillSfx('ten-thousand-swords');
  }

  /** Chain Lightning (`shockOnHit`): hop lightning arcs across nearby unvisited targets. */
  private applyShockArcs(
    originId: string,
    originPos: Vec2,
    baseDamage: number,
    stats: DerivedStats,
  ): void {
    const shock = stats.shockOnHit;
    if (shock === undefined || shock.arcs <= 0 || !(shock.damageRatio > 0)) return;

    const candidates = this.shockCandidates;
    candidates.length = 0;
    for (const enemy of this.enemies) {
      if (!enemy.isDead) {
        candidates.push({ id: enemy.id, position: enemy.position });
      }
    }
    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      candidates.push({ id: BOSS_TARGET_ID, position: boss.position });
    }

    const targets = shockArcTargets(
      originId,
      originPos,
      shock,
      candidates,
      this.shockTargetsOut,
    );
    if (targets.length === 0) return;

    const arcDamage = baseDamage * shock.damageRatio;
    let prevPos = originPos;
    for (const target of targets) {
      if (target.id === BOSS_TARGET_ID) {
        if (boss !== null && !boss.isDefeated) {
          boss.takeDamage(arcDamage, this.nowMs);
          this.reportDamage(arcDamage, boss.position, false);
        }
      } else {
        const hitEnemy = this.enemies.find((candidate) => candidate.id === target.id);
        if (hitEnemy !== undefined && !hitEnemy.isDead) {
          hitEnemy.takeDamage(arcDamage, prevPos, this.nowMs);
          this.reportDamage(arcDamage, hitEnemy.position, false);
        }
      }

      this.fx?.line(prevPos, target.position, SHOCK_ARC_TINT, 190);
      this.fx?.spawn('fx.spark', target.position, {
        tint: SHOCK_ARC_TINT,
        drawUnits: 0.9,
        lifetimeMs: 240,
      });
      prevPos = target.position;
    }
    playShockSfx();
  }

  /** Bomber radial AoE blast + visual explosion/shockwave. */
  private triggerBomberBlast(spec: BomberBlastSpec): void {
    if (
      isInsideBomberBlast(
        spec.center,
        spec.radiusTiles,
        this.player.position,
        PLAYER_RADIUS_TILES,
      )
    ) {
      this.damagePlayer(spec.damage, spec.center, FEEL_TUNING.shake.explosion, {
        kind: 'bomber-blast',
        elite: spec.elite === true,
      });
    }

    const tint = spec.isFollowUp ? BOMBER_FOLLOWUP_TINT : BOMBER_BLAST_TINT;
    this.fx?.spawn('fx.explosion', spec.center, {
      drawUnits: Math.max(1.6, spec.radiusTiles * 2),
      lifetimeMs: 800,
      ...(spec.isFollowUp ? { tint } : {}),
    });
    this.fx?.spawn('fx.smoke-circular', spec.center, {
      drawUnits: Math.max(1.4, spec.radiusTiles * 1.8),
      lifetimeMs: 850,
    });
    this.fx?.spawnShockwave(spec.center, {
      startRadiusTiles: 0.35,
      endRadiusTiles: spec.radiusTiles,
      durationMs: 280,
      lineWidth: 0.11,
      tint,
    });
    this.shake?.addTrauma(FEEL_TUNING.shake.explosion);
    playBomberBlastSfx();
  }

  /** Buffer haste aura visual pulse around the caster and hasted allies. */
  private spawnBufferAuraEffects(pulse: Extract<BufferPulseResult, { kind: 'aura' }>): void {
    this.fx?.spawnShockwave(pulse.center, {
      startRadiusTiles: 0.4,
      endRadiusTiles: pulse.radiusTiles,
      durationMs: 360,
      lineWidth: 0.09,
      tint: BUFFER_AURA_TINT,
    });
    this.fx?.spawn('fx.boost', pulse.center, {
      drawUnits: 2.0,
      tint: BUFFER_AURA_TINT,
      lifetimeMs: 460,
    });
    if (this.secondaryParticles) {
      const cap = Math.min(6, pulse.affectedIds.length);
      for (let index = 0; index < cap; index += 1) {
        const id = pulse.affectedIds[index];
        const ally = this.enemies.find((candidate) => candidate.id === id);
        if (ally !== undefined && !ally.isDead) {
          this.fx?.spawn('fx.spark', ally.position, {
            tint: BUFFER_AURA_TINT,
            drawUnits: 0.85,
            lifetimeMs: 340,
          });
        }
      }
    }
    playBufferPulseSfx();
  }

  /** Debug: spawn one enemy at a given position (defaults to near the room centre). */
  spawnDebug(role: EnemyRole, elite: boolean, at?: Vec2): string {
    const maxHealth = maxHealthFor(
      role,
      elite,
      undefined,
      this.level.chapter,
      this.difficulty.enemyHealthMult,
    );
    const position = at ?? this.defaultSpawnPoint(role);
    const state: EnemyState = {
      id: `debug-${this.debugSeq + 1}`,
      role,
      elite,
      position: { x: position.x, y: position.y },
      health: maxHealth,
      maxHealth,
      action: { kind: 'idle' },
      actionStartedMs: 0,
    };
    this.debugSeq += 1;
    this.addEnemy(state);
    return state.id;
  }

  /**
   * Debug: 24 enemies (the M9 alive cap) with unlimited HP + keep >= 40 enemy bullets on screen.
   * The player still counts as hit but `godMode` blocks damage, so fps is measured under the worst
   * case: a full wave, its bullets, Effects Full and a moving camera.
   */
  startStress(): void {
    this.stress = true;
    this.god = true;
    this.topUpStress();
  }

  stopStress(): void {
    this.stress = false;
  }

  /**
   * Append the living enemy/boss bodies for the depth sort and cover fade (#36). Visual only:
   * the player is added by the caller. `out` is reused, so no array is allocated per frame.
   */
  collectEnemyBodies(out: CoverBody[]): void {
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      out.push({
        node: enemy.node,
        position: enemy.position,
        radiusTiles: enemy.radiusTiles,
        footY: enemy.position.y + ACTOR_FEET_OFFSET_TILES,
      });
    }

    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      out.push({
        node: boss.spriteNode,
        position: boss.position,
        radiusTiles: boss.hitboxRadiusTiles,
        footY: boss.position.y + BOSS_FEET_OFFSET_TILES,
      });
    }
  }

  /** Enemy snapshot for the debug hook (never exposes internal objects). */
  snapshotEnemies(): EnemySnapshot[] {    return this.enemies.map((enemy) => ({
      id: enemy.id,
      role: enemy.role,
      elite: enemy.isElite,
      health: enemy.health,
      maxHealth: enemy.maxHealth,
      action: enemy.actionKind,
      x: enemy.position.x,
      y: enemy.position.y,
    }));
  }

  /** Number of live enemy bullets — debug/acceptance uses it to check "stress holds 40". */
  enemyBulletCount(): number {
    return this.player.bullets.active().filter((bullet) => bullet.owner === 'enemy').length;
  }

  /**
   * Living enemy positions in room tiles, for the HUD edge arrows (#41). The caller owns `out`
   * and reuses it, so a per-frame HUD sync allocates nothing.
   */
  collectAlivePositions(out: Vec2[]): Vec2[] {
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      out.push({ x: enemy.position.x, y: enemy.position.y });
    }
    return out;
  }

  /**
   * Cull enemy sprites by the camera view (#41): a multi-screen room with 24 enemies + their nodes is
   * cheap only if the off-screen ones do not draw. Only `Sprite.enabled` changes — the node stays
   * active because gameplay reads enemies every frame (unlike the FX pool, where `active` is the
   * lifetime flag).
   */
  cullToView(view: CullRect): number {
    const rows = this.level.size.rows;
    let hidden = 0;
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      const position = enemy.position;
      const visible = pointInCullRect(position.x, rows - position.y, view);
      enemy.setCulled(!visible);
      if (!visible) hidden += 1;
    }
    return hidden;
  }

  /** Remove every enemy from the scene + clear bullets. */
  clear(): void {
    for (const enemy of this.enemies) {
      if (enemy.node.isValid) enemy.node.destroy();
    }
    this.enemies.length = 0;
    this.pendingSpawns.length = 0;
    this.scheduler = null;
    this.spawnedSequence = 0;
    this.boss?.destroy();
    this.boss = null;
    this.bossStatus.clear();
    this.rewarded.clear();
    this.bossRewarded = false;
    this.player.bullets.clear();
    this.signatureBullets.clear();
    this.playerHitHitstop.reset();
    this.clearSkillAttachmentHide();
    this.actionBuffer.clear();
    this.enemyBuffs.clear();
    this.pendingBlasts = [];
  }

  /** Clean nodes + state; called when leaving a run. */
  destroy(): void {
    this.clear();
    this.fx?.destroy();
    this.stress = false;
    this.awaitingAdvance = false;
    this.lastDeathCause = null;
    this.nowMs = 0;
  }

  private topUpStress(): void {
    const player = this.player;

    // Keep `STRESS_ENEMY_COUNT` (24, the M9 alive cap) enemies, each with unlimited HP so
    // auto-fire cannot kill them mid-measurement. Called at both the start and the end of a
    // frame: a wave enemy that dies mid-frame is replaced immediately, so the count between
    // frames is always the cap.
    let alive = this.aliveCount;
    while (alive < STRESS_ENEMY_COUNT) {
      const role = STRESS_ROLES[this.stressIndex % STRESS_ROLES.length] ?? 'chaser';
      this.stressIndex += 1;
      const angle = (this.stressIndex / STRESS_ENEMY_COUNT) * Math.PI * 2;
      // Three rings (4/6/8 tiles): 24 bodies in one ring would stack on each other, and the rings
      // stay mostly inside the 32×18 view, so the measurement is "24 enemies actually drawn".
      const ring = STRESS_RING_RADIUS + (this.stressIndex % 3) * 2;
      const state: EnemyState = {
        id: `stress-${this.debugSeq}`,
        role,
        elite: this.stressIndex % 4 === 0,
        position: {
          x: clamp(player.position.x + Math.cos(angle) * ring, 1, this.level.size.cols - 1),
          y: clamp(player.position.y + Math.sin(angle) * ring, 1, this.level.size.rows - 1),
        },
        health: STRESS_ENEMY_HEALTH,
        maxHealth: STRESS_ENEMY_HEALTH,
        action: { kind: 'idle' },
        actionStartedMs: 0,
      };
      this.debugSeq += 1;
      this.addEnemy(state);
      alive += 1;
    }

    // Keep >= 40 enemy bullets: fire from an outer ring at the player, long TTL so the screen stays full.
    const pool = player.bullets;
    let live = this.enemyBulletCount();
    const angleStep = (Math.PI * 2) / STRESS_ENEMY_BULLETS;
    while (live < STRESS_ENEMY_BULLETS) {
      const angle = this.stressIndex * angleStep;
      this.stressIndex += 1;
      const from = {
        x: player.position.x + Math.cos(angle) * 9,
        y: player.position.y + Math.sin(angle) * 6,
      };
      const dx = player.position.x - from.x;
      const dy = player.position.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      pool.spawn({
        position: from,
        velocity: {
          x: (dx / length) * STRESS_BULLET_SPEED,
          y: (dy / length) * STRESS_BULLET_SPEED,
        },
        radiusTiles: 0.15,
        damage: 1,
        owner: 'enemy',
        ttlMs: STRESS_BULLET_TTL_MS,
      });
      live += 1;
    }
  }

  private defaultSpawnPoint(role: EnemyRole): Vec2 {
    const offset = role === 'tank' ? 5 : 4;
    return {
      x: clamp(this.player.position.x + offset, 1, this.level.size.cols - 1),
      y: clamp(this.player.position.y - offset, 1, this.level.size.rows - 1),
    };
  }
}

const STRESS_ROLES: readonly EnemyRole[] = ['chaser', 'caster', 'tank'];

function isInsideRoom(level: LevelData, point: Vec2): boolean {
  return point.x >= 0 && point.x <= level.size.cols && point.y >= 0 && point.y <= level.size.rows;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
