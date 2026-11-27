/**
 * Headless run simulation — no engine, no DOM, no `SaveStorage`.
 *
 * Wires the `core/` modules the game uses (`waves`, `behaviours`, `AutoFire`,
 * `BulletPool`, `HealthState`, `rewards`, `skills`, `xp`, `boss`) into a 16 ms tick loop,
 * so integration tests catch balance regressions and win/lose flow without opening Cocos.
 *
 * This simulates **exactly the rules the game runs** (M4–M12, ADR-021):
 *
 * - Fire rate/damage/projectile count/crit/pierce/ricochet/homing/explosion/freeze/poison/
 *   lifesteal/shield/thorns all come from `DerivedStats` and the core helpers that
 *   `game/` uses.
 * - Hitstop and stagger are simulated: a bullet hit freezes the simulation for 70 ms and
 *   staggers the enemy for 150 ms, without resetting cooldowns.
 * - An elite caster fires a 3-bullet volley, an elite chaser pounces, an elite tank charges twice; hitbox
 *   and contact range scale with the role silhouette.
 * - M12 unified XP economy (ADR-021): enemies drop pooled XP orbs (`XpOrbPool`, `xpForKill`,
 *   `splitling` = 0 XP) with magnetic pickup and full-room auto-vacuum on room clear; `'xp'`
 *   challenge rooms spawn `xpRoomExtraElites` extra elites, apply `xpRoomXpMultiplier`, and award
 *   `xpDoorClearBonus` on clear. When `chooseSkill` is provided, each level-up rolls 1-of-3 from
 *   the dedicated `createSkillRollRng(seed)` sub-seed (decoupled from combat RNG), applies the
 *   chosen skill immediately, and triggers `computeLevelUpKnockback` + `levelUpResumeIframeMs`
 *   (leaving enemy bullets live).
 * - The boss room is **no** longer a placeholder tank: it runs `simulateBossRun`
 *   (`core/sim/boss-run.ts`), i.e. `stepBoss` + phases + summon + skills.
 *
 * - Randomness only through `SeededRng` built from `seed`; no module-level state.
 * - Movement uses the same `moveWithCollision` rule as the game: obstacles are solid for the
 *   player and enemies (they slide along them), pits included; bullets only stop on pillars and
 *   walls (`firstHit`).
 * - `godMode` is a test hook: skip damage to the player to measure room-clear time.
 */
import { pickBoss } from '../boss/boss-pool';
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  type CharacterId,
} from '../characters/roster';
import { AutoFire } from '../combat/auto-fire';
import { BulletPool, firstHit, hitsCircle, type Bullet } from '../combat/bullets';
import { HealthState } from '../combat/health';
import { stepKnockback, type KnockbackState } from '../combat/knockback';
import { firePlayerVolley } from '../combat/player-fire';
import {
  HOMING_TURN_RATE_RADIANS_PER_SECOND,
  damageAfterExecute,
  lifestealHeal,
  ricochetTarget,
  steerVelocity,
} from '../combat/shot-effects';
import { ShieldCharger } from '../combat/shield';
import { StatusEffects } from '../combat/status-effects';
import { DEFAULT_COMBAT } from '../config';
import {
  CHASER_CONTACT_RANGE_TILES,
  ROOM_EDGE_MARGIN_TILES,
  attackReleasedForRole,
  contactDamageFor,
  decideAction,
  speedFor,
  staggerAfterHit,
  visualScaleFor,
  type EnemyAction,
  type EnemyState,
} from '../enemies/behaviours';
import {
  bomberBlastSpec,
  isInsideBomberBlast,
  scheduleFollowUpBlast,
  stepPendingBlasts,
  type PendingBomberBlast,
} from '../enemies/bomber';
import { EnemyBuffTracker, resolveBufferPulse } from '../enemies/buffer';
import { nextActionStartedMs } from '../enemies/attack-cycle';
import {
  aimDirection,
  casterShotPlan,
  gunnerShotPlan,
  scheduleGunnerFollowUp,
  sniperShotPlan,
  stepPendingGunnerVolleys,
  type PendingGunnerVolley,
} from '../combat/enemy-fire';
import { splitOnDeath } from '../enemies/splitter';
import {
  RoomNavigation,
  StuckGuard,
  separateEnemies,
  walkTowards,
  type FlowField,
  type SeparationBody,
} from '../enemies/navigation';
import {
  ACTIVE_SKILL_TUNING,
  CLASS_SKILLS_TUNING,
  DASH_TUNING,
  DOORS_TUNING,
  ENEMY_TUNING,
  NAVIGATION_TUNING,
  PICKUPS_TUNING,
  SPECIAL_ROOMS_TUNING,
} from '../enemies/tuning';
import { ActionBuffer } from '../input/action-buffer';
import {
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
  type ActiveSkillState,
  type SignatureSkillId,
} from '../input/active-skill';
import {
  canStartDash,
  createDashState,
  dashVelocity,
  isDashInvulnerable,
  isDashing,
  stepDash,
  tryStartDash,
  type DashState,
} from '../input/dash';
import { WaveScheduler, enemyStateFromSpawn, usesWaveScheduler } from '../enemies/wave-scheduler';
import { isWaveCleared, spawnWave } from '../enemies/waves';
import type { ChapterData, EnemyRole, LevelData } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import {
  applyCharacterBaseStats,
  applyCharacterPassive,
  metaBaseline,
} from '../meta/run-stats';
import type { UpgradeState } from '../meta/upgrades';
import { normalizeMoveInput, velocityFromInput, type MoveInput } from '../movement/move-intent';
import { moveWithCollision } from '../movement/collision';
import { SeededRng } from '../rng';
import { drawRunRooms } from '../run/room-draw';
import {
  COMBAT_REWARDS,
  DOOR_REWARDS,
  clearRewardFor,
  doorOffers,
  type DoorReward,
} from '../run/doors';
import { goldForKill, goldForRoomClear } from '../run/rewards';
import {
  chestReward,
  healByFraction,
  isSpecialDoor,
  type SpecialKind,
} from '../run/special-rooms';
import { computeDerivedStats } from '../skills/derived-stats';
import { dispatchClassSkillEvent, hasAnyClassSkill } from '../skills/class-skills';
import type {
  ClassSkillEffect,
  ClassSkillMemory,
  ClassSkillStackSource,
  ClassSkillTarget,
} from '../skills/class-skill-hooks';
import {
  NinjaSkillRuntime,
} from '../skills/ninja-runtime';
import { CultivatorSkillRuntime } from '../skills/cultivator-runtime';
import type { SkillDef } from '../skills/pool';
import { createSkillRollRng, rerollChoices, rollChoices } from '../skills/roll';
import { screenViewAround } from '../view/view-rect';
import { computeLevelUpKnockback, levelUpResumeIframeMs } from '../xp/level-up-wave';
import { canReroll, deductRerollCost, rerollCost } from '../xp/reroll';
import { XpTracker, xpDoorClearBonus, xpForKill } from '../xp/xp-curve';
import { XpOrbPool } from '../xp/xp-orbs';
import { WorldPickupPool, shouldDropHealthPotion } from '../xp/pickups';
import {
  BOSS_TARGET_ID,
  simulateBossRun,
  type BossActivePolicy,
  type BossDashPolicy,
  type BossRunPolicy,
} from './boss-run';
import type { ViewRect } from '../camera/follow-camera';

export const SIM_STEP_MS = 16;

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

/**
 * The class-generic surface both `NinjaSkillRuntime` and `CultivatorSkillRuntime` implement, so
 * `simulateRun` wires one runtime per active class instead of a parallel copy per class (M20).
 */
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
/**
 * Simulated wall-clock cap of one `simulateRun` call. The owner accepted a **30–60 minute** run
 * for M9 (16-screen rooms, 8× the v1 enemies), and one chapter alone takes ~17 minutes at that
 * density, so the old 10-minute cap could never let a chapter finish (every call reported
 * `timeout`). 60 minutes leaves room for the slowest chapter plus a full loadout.
 */
export const SIM_DEFAULT_MAX_DURATION_MS = 3_600_000;

/** Collision radius, tiles. */
const PLAYER_RADIUS_TILES = 0.25;
const DEFAULT_ENEMY_RADIUS_TILES = 0.4;
const BULLET_RADIUS_TILES = 0.15;
/** The chaser holds exactly at this threshold, so the damage zone must equal it. */
const CONTACT_RANGE_TILES = CHASER_CONTACT_RANGE_TILES;
/**
 * Player bullets must live long enough to cross the auto-aim range, otherwise the "range"
 * in `config/tuning.json` is only a virtual number. Takes 1.2 s (wide enough for 12 tiles/s × 10 tiles)
 * or 1.5× the time to fly the full range, whichever is larger.
 */
const PLAYER_BULLET_TTL_MS = Math.max(
  1200,
  Math.ceil(
    (DEFAULT_COMBAT.targetingRangeTiles / DEFAULT_COMBAT.projectileSpeedTilesPerSecond) *
      1000 *
      1.5,
  ),
);
const ENEMY_BULLET_TTL_MS = 3000;
/** Caster bullet angle offset, radians — the only source that needs a seed. */
const ENEMY_SHOT_SPREAD_RADIANS = 0.15;

/** The world a policy reads. Read only, never modified. */
export interface PolicyWorld {
  readonly nowMs: number;
  readonly room: number;
  /** Index wave 0-based. */
  readonly wave: number;
  readonly player: Vec2;
  readonly hearts: number;
  readonly shieldCharges: number;
  readonly enemies: readonly EnemyState[];
  readonly bullets: readonly Bullet[];
}

/** Scripted input: a pure function of the world returning this frame's WASD keys. */
export type InputPolicy = (world: PolicyWorld) => MoveInput;

/** World snapshot passed to a Dash (`Space`) trigger policy (M13, ADR-022). */
export interface DashThreatWorld extends PolicyWorld {
  readonly moveDir: Vec2;
  readonly dashState: DashState;
  readonly pendingBlasts: readonly PendingBomberBlast[];
}

/** World snapshot passed to a Signature Active (`E`) policy (M13/M14, ADR-022). */
export interface ActiveSkillPolicyWorld extends PolicyWorld {
  readonly activeState: ActiveSkillState;
  readonly signatureSkillId?: SignatureSkillId;
}

/**
 * Optional Dash (`Space`) policy: return a non-zero tile-space direction vector to press Dash
 * (buffered through the 150 ms game-time `ActionBuffer`), or `null` to hold Dash.
 */
export type DashPolicy = (world: DashThreatWorld) => Vec2 | null;

/**
 * Optional Signature Active (`E`) policy: return a non-zero tile-space aim
 * vector to press Active (buffered through the 150 ms game-time `ActionBuffer`), or `null`.
 */
export type ActiveSkillPolicy = (world: ActiveSkillPolicyWorld) => Vec2 | null;

/** Read-only player vitals visible on the HUD while choosing a level-up skill. */
export interface SkillPickContext {
  readonly hearts: number;
  readonly maxHearts: number;
}

/**
 * Policy for choosing 1 of 3 skills offered on an XP level-up (M12, ADR-021).
 * Returns an index into `offers`. Omit in `SimulationOptions` for 0-skill / fixed-loadout runs.
 */
export type SkillPickPolicy = (
  offers: readonly SkillDef[],
  owned: ReadonlyMap<string, number>,
  level: number,
  context: SkillPickContext,
) => number;

/**
 * Optional policy deciding whether to spend run gold on a level-up skill reroll (`core/xp/reroll.ts`,
 * M12 ADR-021). Uses the same dedicated `createSkillRollRng` stream via `rerollChoices`.
 */
export type SkillRerollPolicy = (
  offers: readonly SkillDef[],
  owned: ReadonlyMap<string, number>,
  availableGold: number,
  nextCost: number,
  rerollsUsed: number,
) => boolean;

export interface SimulationOptions {
  readonly seed: number;
  /** Playable character class (M14, defaults to `'ninja'`). */
  readonly characterId?: CharacterId;
  /** A full chapter; the run plays `drawRunRooms(level, seed)` (8 normal rooms + the boss). */
  readonly level: ChapterData;
  readonly policy: InputPolicy;
  /**
   * Optional Dash (`Space`) policy (M13, ADR-022). Omitted = never dashes (keeps `stand-still`
   * and baseline 0-skill survival checks untouched).
   */
  readonly chooseDash?: DashPolicy;
  /**
   * Optional Signature Active (`E`) policy (M13/M14, ADR-022). Omitted = never
   * casts Active (keeps `stand-still` and baseline 0-skill survival checks untouched).
   */
  readonly chooseActive?: ActiveSkillPolicy;
  /** Defaults to `SIM_DEFAULT_MAX_DURATION_MS`; when time runs out it returns `timeout`. */
  readonly maxDurationMs?: number;
  /** Test hook: the player takes no damage. */
  readonly godMode?: boolean;
  /** Test hook: start the run at this many hearts (defaults to the derived max). */
  readonly playerHearts?: number;
  /** Starting skills, `Map<skillId, stacks>` like the game's `RunState` (defaults to empty). */
  readonly skills?: ReadonlyMap<string, number>;
  /** Optional permanent Meta Shop upgrade levels applied at run start (M18, ADR-026). */
  readonly meta?: UpgradeState;
  /**
   * Level-up skill pick policy (M12, ADR-021). When provided, each XP level-up rolls 1-of-3
   * from the dedicated `createSkillRollRng(seed)` stream, acquires the chosen skill, and emits
   * the radial knockback wave + resume i-frame. When omitted, no skills are acquired on level-up.
   */
  readonly chooseSkill?: SkillPickPolicy;
  /** Optional gold reroll policy evaluated before `chooseSkill` on each level-up. */
  readonly shouldReroll?: SkillRerollPolicy;
  /**
   * Which door to take after a normal room (#39): returns an index into `offers`.
   * Defaults to 0 (the first door).
   */
  readonly chooseDoor?: (offers: readonly DoorReward[], room: number) => number;
}

export type SimulationStatus = 'won' | 'lost' | 'timeout';

/** A scheduled spawn waiting out its on-screen telegraph (#41). */
interface SimPendingSpawn {
  readonly state: EnemyState;
  /** Sim time at which it joins the fight. */
  readonly atMs: number;
}

interface SimEventBase {
  readonly nowMs: number;
  readonly room: number;
}

export type SimulationEvent =
  | (SimEventBase & { readonly kind: 'kill'; readonly enemyId: string; readonly role: EnemyRole; readonly gold: number })
  | (SimEventBase & { readonly kind: 'player-hit'; readonly hearts: number; readonly source: 'contact' | 'projectile' })
  | (SimEventBase & { readonly kind: 'shield-block' })
  | (SimEventBase & { readonly kind: 'ward-block' })
  | (SimEventBase & { readonly kind: 'dash'; readonly direction: Vec2 })
  | (SimEventBase & {
      readonly kind: 'active-skill';
      readonly skillId: SignatureSkillId;
      readonly projectiles: number;
      readonly novaHits?: number;
      readonly hideAttachmentMs?: number;
    })
  | (SimEventBase & {
      readonly kind: 'level-up';
      readonly level: number;
      readonly offers: readonly string[];
      readonly chosen: string | null;
    })
  | (SimEventBase & {
      readonly kind: 'skill-reroll';
      readonly cost: number;
      readonly offers: readonly string[];
    })
  | (SimEventBase & { readonly kind: 'room-cleared'; readonly gold: number })
  | (SimEventBase & { readonly kind: 'boss-phase'; readonly phase: number })
  /** Doors offered after a normal room (#39); `room` is the cleared room position, 1-based. */
  | (SimEventBase & { readonly kind: 'door'; readonly offers: readonly DoorReward[]; readonly chosen: DoorReward })
  /** The clear reward of room `room`; `gold` is the door bonus paid for a `gold` reward, `xp` for an `xp` door room. */
  | (SimEventBase & { readonly kind: 'reward'; readonly reward: DoorReward; readonly gold: number; readonly xp?: number })
  /** A special room used in slot `room` (#40): heal / shop (never buys) / chest reward. */
  | (SimEventBase & {
      readonly kind: 'special';
      readonly reward: SpecialKind;
      /** Hearts / HP after the room's effect (lets a test prove a heal's exact amount). */
      readonly hearts: number;
      /** Gold earned from clearing/opening the mid-chapter Special Room (M17). */
      readonly gold?: number;
    })
  | { readonly kind: 'run-won' | 'run-lost'; readonly nowMs: number };

export interface SimulationResult {
  readonly status: SimulationStatus;
  readonly roomsCleared: number;
  readonly kills: number;
  readonly goldEarned: number;
  /** Cumulative XP collected across the run (orbs + `'xp'` room clear bonuses). */
  readonly xpEarned: number;
  /** Total XP level-ups earned during the run (`finalLevel - 1`). */
  readonly levelUps: number;
  /** Final player level at run end (starts at 1). */
  readonly finalLevel: number;
  /** Final owned skill stacks (`starting skills + XP level-up picks`). */
  readonly acquiredSkills: ReadonlyMap<string, number>;
  /** Total Dash (`Space`) activations performed across the run (M13, ADR-022). */
  readonly dashesUsed: number;
  /** Total Signature Active (*Shadow Barrage*) casts performed across the run (M13, ADR-022). */
  readonly activeSkillsUsed: number;
  /** Legendary Evolution ids acquired during the run in deterministic `EVOLUTIONS` order (M13, ADR-022). */
  readonly evolutions: readonly string[];
  /**
   * Total damage dealt per class-exclusive skill id across the run (M20, #84+). Always present;
   * empty when the run owns no class skill. Generic across classes so #85–#87 feed the same map.
   */
  readonly classSkillDamage: ReadonlyMap<string, number>;
  /**
   * Number of class-effect requests the sim applied per class skill id (M20, #84+). Always
   * present; empty for runs without class skills.
   */
  readonly classSkillProcs: ReadonlyMap<string, number>;
  readonly durationMs: number;
  readonly events: readonly SimulationEvent[];
}

/** Run a whole chapter headless. Pure: no state read/written outside the parameters. */
export function simulateRun(options: SimulationOptions): SimulationResult {
  const maxDurationMs = options.maxDurationMs ?? SIM_DEFAULT_MAX_DURATION_MS;
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new Error(`simulateRun needs a finite maxDurationMs > 0, got ${maxDurationMs}`);
  }
  // The run plays the same 9 rooms the game would (`#38`): 8 drawn from the pool by the run
  // seed, then the boss — not every room of the chapter.
  const runRooms = drawRunRooms(options.level, options.seed);
  const firstRoom = runRooms[0];
  if (firstRoom === undefined) throw new Error('simulateRun needs a chapter with at least 1 room');

  /** Normal rooms in this run = the door count that leads to the boss (#38). */
  const normalRoomCount = runRooms.filter((candidate) => !candidate.isBossRoom).length;
  /** Special doors stay off until #40 ships the rooms behind them. */
  const enabledDoors: readonly DoorReward[] = DOORS_TUNING.specialRoomsEnabled
    ? DOOR_REWARDS
    : COMBAT_REWARDS;
  /** Reward carried by the door taken after the previous room; `null` in room 1. */
  let doorReward: DoorReward | null = null;

  const characterId = options.characterId ?? DEFAULT_CHARACTER_ID;
  const characterDef = CHARACTERS[characterId];
  const signatureSkillId = characterDef.signatureSkillId;
  const activeConfig = activeSkillConfigFor(signatureSkillId);
  const withClassBase = applyCharacterBaseStats(DEFAULT_COMBAT, characterId);
  const withMeta =
    options.meta !== undefined ? metaBaseline(withClassBase, options.meta) : withClassBase;
  const characterBase = applyCharacterPassive(withMeta, characterId);

  const rng = new SeededRng(options.seed);
  /** Dedicated skill-roll RNG stream, strictly decoupled from combat RNG (ADR-021). */
  const skillRollRng = createSkillRollRng(options.seed);
  const ownedSkills = new Map<string, number>(options.skills ?? []);
  /** Read-only stack accessor for class-skill hooks (no Map copy per tick). */
  const classSkillSource: ClassSkillStackSource = (id) => ownedSkills.get(id) ?? 0;
  /** Per-run mutable scratch store for stateful class hooks (marks, momentum). */
  const classSkillMemory: ClassSkillMemory = new Map();
  /** Temporary class-skill buff (Wind Arrow); expired by the run clock. */
  let classSkillBuff: {
    fireRateMult: number;
    projectileSpeedMult: number;
    untilMs: number;
  } | null = null;
  /** 1-based auto-fire counter for on-shot class hooks (M20, ADR-027). */
  let shotsFired = 0;
  /** Ninja-only class-skill runtime (clones, venom clouds, smoke, kunai) — M20, #84. */
  const ninjaRuntime =
    characterId === 'ninja' ? new NinjaSkillRuntime(CLASS_SKILLS_TUNING.ninja) : null;
  /** Cultivator-only class-skill runtime (swords, arrays, waves, Qi gauge/shield) — M20, #87. */
  const cultivatorRuntime =
    characterId === 'cultivator'
      ? new CultivatorSkillRuntime(CLASS_SKILLS_TUNING.cultivator, classSkillSource)
      : null;
  /** The active class's runtime, if any; the sim drives one generic surface (M20). */
  const classRuntime: ClassSkillRuntime | null = ninjaRuntime ?? cultivatorRuntime;
  /** Per-class-skill totals reported by `SimulationResult` (M20, #84+). */
  const classSkillDamage = new Map<string, number>();
  const classSkillProcs = new Map<string, number>();
  let stats = computeDerivedStats(ownedSkills, characterBase);
  const bulletTtlMs = Math.max(
    PLAYER_BULLET_TTL_MS,
    stats.projectileSpeedTilesPerSecond > 0
      ? Math.ceil((stats.targetingRangeTiles / stats.projectileSpeedTilesPerSecond) * 1000 * 1.5)
      : PLAYER_BULLET_TTL_MS,
  );
  const startHearts =
    options.playerHearts !== undefined && Number.isFinite(options.playerHearts)
      ? Math.max(1, Math.min(stats.maxHearts, Math.trunc(options.playerHearts)))
      : stats.maxHearts;
  const health = new HealthState(
    {
      playerMaxHearts: stats.maxHearts,
      invulnerabilityMs: stats.invulnerabilityMs,
    },
    startHearts,
  );
  let shield = new ShieldCharger(
    stats.shield?.charges ?? 0,
    stats.shield?.cooldownMs ?? 0,
  );
  let autoFire = AutoFire.fromRate(stats.fireRatePerSecond);
  const bullets = new BulletPool();
  const xpTracker = new XpTracker(options.level.chapter);
  const xpOrbs = new XpOrbPool();
  const pickups = new WorldPickupPool(PICKUPS_TUNING);
  /** Status of each enemy, key = id (not stuffed into `EnemyState` to keep the shared schema). */
  const statuses = new Map<string, StatusEffects>();
  /** Active Burn DoT per enemy id (M13 `ignite` / `cataclysm`). */
  const burns = new Map<string, { dps: number; untilMs: number }>();
  /** Active level-up radial knockback pushes per enemy id (M12, ADR-021). */
  const enemyKnockbacks = new Map<string, KnockbackState>();
  const actionBuffer = new ActionBuffer(DASH_TUNING.bufferMs);
  let dashState = createDashState();
  let activeState = createActiveSkillState(true, activeConfig.cooldownMs);
  let bufferedDashDir: Vec2 = { x: 0, y: 1 };
  let bufferedActiveDir: Vec2 = { x: 1, y: 0 };
  let postDashFireUntilMs = Number.NEGATIVE_INFINITY;
  let dashesUsed = 0;
  let activeSkillsUsed = 0;
  const events: SimulationEvent[] = [];
  /** Ids of bullets hit this frame; reused so each frame allocates nothing. */
  const spent = new Set<number>();
  /** Ids of Signature Active projectiles so Shadow Barrage does not self-refund its own cooldown. */
  const activeBulletIds = new Set<number>();
  let hitstopMs = 0;
  /** End timestamp of the 0.6 s post-level-up resume i-frame window (M12, ADR-021). */
  let levelUpInvulnerableUntilMs = Number.NEGATIVE_INFINITY;
  /** Splitlings born this frame; appended after the damage loops so we never mutate mid-iteration. */
  const pendingSplits: EnemyState[] = [];

  let roomIndex = 0;
  let room = firstRoom;
  /** True when the current normal combat room was entered via an `'xp'` challenge door. */
  let currentRoomIsXpChallenge = false;
  /** Remaining non-elite wave spawns to promote into elites in an `'xp'` room (`doors.xpRoomExtraElites`). */
  let extraElitesToPromote = 0;
  let roomBatchIndex = 0;
  /** Number of gold rerolls spent across the run (`core/xp/reroll.ts`). */
  let rerollsUsed = 0;
  /** Shared flow field per radius class for the current room (#34). Reset on a room change. */
  let navigation = createRoomNavigation(firstRoom);
  const stuckGuard = new StuckGuard(
    NAVIGATION_TUNING.stuckWindowMs,
    NAVIGATION_TUNING.stuckDistanceTiles,
    NAVIGATION_TUNING.detourMs,
  );
  /** One closure so the per-enemy guard does not allocate a function every frame. */
  const random = (): number => rng.next();

  /**
   * #41: the room's spawn delivery. `null` in a boss room (its adds are authored).
   * The cast keeps the **declared** union: without it the flow analysis starts from `null` and
   * narrows the variable to `never` after the closure below assigns it.
   */
  let scheduler = null as WaveScheduler | null;
  /** Spawns waiting out their on-screen telegraph before they join the fight. */
  let pendingSpawns: SimPendingSpawn[] = [];
  /** Id suffix of the next scheduled spawn, unique inside the room. */
  let spawnSeq = 0;
  let enemies: EnemyState[] = [];
  const buffTracker = new EnemyBuffTracker();
  let pendingBlasts: PendingBomberBlast[] = [];
  let pendingGunnerVolleys: PendingGunnerVolley[] = [];
  let playerVelocity: Vec2 = { x: 0, y: 0 };

  /**
   * Enter a room's enemies. A normal room is empty and fills from the `WaveScheduler` over time
   * (8× the authored count under the alive cap); an `'xp'` challenge room also queues
   * `DOORS_TUNING.xpRoomExtraElites` extra elite spawns. The boss room keeps its authored list.
   */
  const enterRoomEnemies = (
    level: LevelData,
    atRoomIndex: number,
    isXpChallenge: boolean,
  ): EnemyState[] => {
    scheduler = null;
    pendingSpawns = [];
    pendingBlasts = [];
    pendingGunnerVolleys = [];
    buffTracker.clear();
    statuses.clear();
    burns.clear();
    activeBulletIds.clear();
    ninjaRuntime?.reset();
    cultivatorRuntime?.reset();
    dashState = createDashState();
    actionBuffer.clear();
    postDashFireUntilMs = Number.NEGATIVE_INFINITY;
    playerVelocity = { x: 0, y: 0 };
    spawnSeq = 0;
    enemyKnockbacks.clear();
    xpOrbs.clear();
    pickups.clear();
    currentRoomIsXpChallenge = isXpChallenge && usesWaveScheduler(level);
    extraElitesToPromote = currentRoomIsXpChallenge
      ? Math.max(0, Math.floor(DOORS_TUNING.xpRoomExtraElites))
      : 0;
    roomBatchIndex = 0;

    if (!usesWaveScheduler(level)) {
      // One-screen room (boss arena, hand-built fixture): its authored list, all of it.
      return level.waves.flatMap((_, wave) => spawnWave(level, wave));
    }
    scheduler = new WaveScheduler(level, waveSeed(level, options.seed, atRoomIndex), atRoomIndex + 1);
    return [];
  };

  /** Spawned and not dead, plus spawns still telegraphing (they occupy a slot of the cap). */
  const aliveEnemies = (): number => {
    let alive = pendingSpawns.length;
    for (const enemy of enemies) {
      if (enemy.health > 0 && enemy.action.kind !== 'dead') alive += 1;
    }
    return alive;
  };

  /** Release due spawns into the fight; called after `scheduler.step`. */
  const releaseTelegraphed = (): void => {
    if (pendingSpawns.length === 0) return;
    const waiting: SimPendingSpawn[] = [];
    for (const pending of pendingSpawns) {
      if (pending.atMs <= durationMs) enemies.push(pending.state);
      else waiting.push(pending);
    }
    pendingSpawns = waiting;
  };

  enemies = enterRoomEnemies(room, 0, false);
  let player: Vec2 = { x: room.playerStart.x, y: room.playerStart.y };
  let durationMs = 0;
  let roomsCleared = 0;
  let kills = 0;
  let goldEarned = 0;
  let roomPotionGoldBonus = 0;
  let status: SimulationStatus | null = null;

  const healPlayer = (amount: number): void => {
    if (amount > 0) health.heal(amount);
  };

  const isResumeInvulnerable = (): boolean => durationMs < levelUpInvulnerableUntilMs;
  const isActionInvulnerable = (): boolean => isResumeInvulnerable() || isDashInvulnerable(dashState);

  const applyBurn = (enemyId: string, nowMs: number): void => {
    const burn = stats.burnOnHit;
    if (burn === undefined || !(burn.dps > 0) || !(burn.durationMs > 0)) return;
    applyBurnEffect(enemyId, burn.dps, burn.durationMs, nowMs);
  };

  /** Apply an explicit burn (class skills, not the player's `burnOnHit` loadout stat). */
  const applyBurnEffect = (
    enemyId: string,
    dps: number,
    burnMs: number,
    nowMs: number,
  ): void => {
    if (!(dps > 0) || !(burnMs > 0)) return;
    const prev = burns.get(enemyId);
    if (prev === undefined) {
      burns.set(enemyId, { dps, untilMs: nowMs + burnMs });
      return;
    }
    prev.dps = Math.max(prev.dps, dps);
    prev.untilMs = Math.max(prev.untilMs, nowMs + burnMs);
  };

  const isBurning = (enemyId: string, nowMs: number): boolean => {
    const entry = burns.get(enemyId);
    return entry !== undefined && entry.dps > 0 && nowMs < entry.untilMs - 1e-6;
  };

  const burnDamageFor = (enemyId: string, nowMs: number, deltaMs: number): number => {
    const entry = burns.get(enemyId);
    if (entry === undefined || !(deltaMs > 0) || entry.dps <= 0) return 0;
    const activeMs = Math.max(0, Math.min(nowMs + deltaMs, entry.untilMs) - nowMs);
    return (entry.dps * activeMs) / 1000;
  };

  const isAfflicted = (enemy: EnemyState, nowMs: number): boolean => {
    const status = statuses.get(enemy.id);
    if (status !== undefined && (status.isSlowed(nowMs) || status.isPoisoned(nowMs))) return true;
    return isBurning(enemy.id, nowMs);
  };

  const acquireSkill = (skill: SkillDef): void => {
    const prevMaxHearts = stats.maxHearts;
    const prevFireRate = stats.fireRatePerSecond;
    const prevShieldCharges = stats.shield?.charges ?? 0;
    const prevShieldCooldown = stats.shield?.cooldownMs ?? 0;

    const currentStacks = ownedSkills.get(skill.id) ?? 0;
    ownedSkills.set(skill.id, Math.min(skill.maxStacks, currentStacks + 1));
    stats = computeDerivedStats(ownedSkills, characterBase);

    health.configure(stats.maxHearts, stats.invulnerabilityMs);
    if (stats.maxHearts > prevMaxHearts) {
      health.heal(stats.maxHearts - prevMaxHearts);
    }
    if (stats.fireRatePerSecond !== prevFireRate) {
      autoFire = AutoFire.fromRate(stats.fireRatePerSecond);
    }
    const nextShieldCharges = stats.shield?.charges ?? 0;
    const nextShieldCooldown = stats.shield?.cooldownMs ?? 0;
    if (nextShieldCharges !== prevShieldCharges || nextShieldCooldown !== prevShieldCooldown) {
      shield = new ShieldCharger(nextShieldCharges, nextShieldCooldown);
    }
  };

  const applyLevelUpResumeSafety = (): void => {
    // Radial knockback pushes nearby enemies away; enemy bullets remain live (ADR-021).
    const living = enemies.filter((enemy) => enemy.health > 0 && enemy.action.kind !== 'dead');
    for (const hit of computeLevelUpKnockback(player, living)) {
      enemyKnockbacks.set(hit.id, hit.knockback);
    }
    const iframeMs = levelUpResumeIframeMs();
    if (iframeMs > 0) {
      levelUpInvulnerableUntilMs = Math.max(levelUpInvulnerableUntilMs, durationMs + iframeMs);
    }
  };

  const grantAndResolveXp = (amount: number): void => {
    if (amount <= 0) return;
    const grant = xpTracker.grant(amount);
    if (grant.levelsGained <= 0) return;

    let resolvedLevel = xpTracker.level - xpTracker.pendingLevelUps;
    let openedModal = false;
    while (xpTracker.consumeLevelUp()) {
      resolvedLevel += 1;
      if (options.chooseSkill === undefined) {
        events.push({
          kind: 'level-up',
          nowMs: durationMs,
          room: room.room,
          level: resolvedLevel,
          offers: [],
          chosen: null,
        });
        continue;
      }

      openedModal = true;
      let offers = rollChoices({ rng: skillRollRng, owned: ownedSkills, characterId });
      // Optional M12 gold reroll (`core/xp/reroll.ts` + `rerollChoices` on `skillRollRng`).
      while (
        offers.length > 0 &&
        options.shouldReroll !== undefined &&
        canReroll(goldEarned, rerollsUsed) &&
        options.shouldReroll(
          offers,
          ownedSkills,
          goldEarned,
          rerollCost(rerollsUsed),
          rerollsUsed,
        )
      ) {
        const spentGold = deductRerollCost(goldEarned, rerollsUsed);
        if (!spentGold.ok) break;
        goldEarned = spentGold.remainingGold;
        rerollsUsed = spentGold.nextRerollsUsed;
        offers = rerollChoices({
          rng: skillRollRng,
          owned: ownedSkills,
          previous: offers,
          characterId,
        });
        events.push({
          kind: 'skill-reroll',
          nowMs: durationMs,
          room: room.room,
          cost: spentGold.cost,
          offers: offers.map((skill) => skill.id),
        });
      }
      let chosenId: string | null = null;
      if (offers.length > 0) {
        const pickedIndex = pickSkillIndex(options.chooseSkill, offers, ownedSkills, resolvedLevel, {
          hearts: health.current,
          maxHearts: health.max,
        });
        const chosen = offers[pickedIndex] ?? offers[0];
        if (chosen !== undefined) {
          chosenId = chosen.id;
          acquireSkill(chosen);
        }
      }
      events.push({
        kind: 'level-up',
        nowMs: durationMs,
        room: room.room,
        level: resolvedLevel,
        offers: offers.map((skill) => skill.id),
        chosen: chosenId,
      });
    }

    if (openedModal) {
      applyLevelUpResumeSafety();
    }
  };

  const damagePlayer = (amount: number, source: 'contact' | 'projectile' = 'projectile'): boolean => {
    if (options.godMode === true || isActionInvulnerable()) return false;
    if (health.isInvulnerable(durationMs)) return false;
    // *Hộ Tâm Linh Khí*: the Qi shield absorbs exactly the next hit (M20, #87).
    if (cultivatorRuntime !== null && cultivatorRuntime.consumeQiShield()) {
      events.push({ kind: 'shield-block', nowMs: durationMs, room: room.room });
      return false;
    }
    if (shield.tryBlock(durationMs)) {
      events.push({ kind: 'shield-block', nowMs: durationMs, room: room.room });
      return false;
    }
    if (stats.damageReductionChance > 0 && rng.next() < stats.damageReductionChance) {
      health.grantInvulnerability(durationMs, stats.invulnerabilityMs);
      events.push({ kind: 'ward-block', nowMs: durationMs, room: room.room });
      return false;
    }
    const result = health.tryDamage(amount, durationMs);
    if (!result.applied) return false;
    events.push({
      kind: 'player-hit',
      nowMs: durationMs,
      room: room.room,
      hearts: result.hearts,
      source,
    });
    return true;
  };

  const statusOf = (enemy: EnemyState): StatusEffects => {
    let entry = statuses.get(enemy.id);
    if (entry === undefined) {
      entry = new StatusEffects();
      statuses.set(enemy.id, entry);
    }
    return entry;
  };

  /**
   * Release an enemy's telegraphed attack. A sniper fires exactly one fast, aimed bullet;
   * elites use `eliteVolleyAngles` (3-bullet fan) and a regular caster fires one bullet with a
   * small random offset so two casters do not fire the same line. Same rule as
   * `game/combat-loop.ts`.
   */
  const fireCasterVolley = (enemy: EnemyState): void => {
    const damage = contactDamageFor(enemy.role, enemy.elite, undefined, room.chapter);

    if (enemy.role === 'sniper') {
      const plan = sniperShotPlan();
      const direction = aimDirection(enemy.position, player);
      const baseAngle = Math.atan2(direction.y, direction.x);
      for (const offset of plan.angles) {
        const angle = baseAngle + offset;
        bullets.spawn({
          position: enemy.position,
          velocity: {
            x: Math.cos(angle) * plan.speedTilesPerSecond,
            y: Math.sin(angle) * plan.speedTilesPerSecond,
          },
          radiusTiles: BULLET_RADIUS_TILES,
          damage,
          owner: 'enemy',
          ttlMs: ENEMY_BULLET_TTL_MS,
        });
      }
      return;
    }

    if (enemy.role === 'gunner') {
      const plan = gunnerShotPlan(enemy.elite, room.chapter);
      const direction = aimDirection(enemy.position, player);
      const baseAngle = Math.atan2(direction.y, direction.x);
      for (const offset of plan.angles) {
        const angle = baseAngle + offset;
        bullets.spawn({
          position: enemy.position,
          velocity: {
            x: Math.cos(angle) * plan.speedTilesPerSecond,
            y: Math.sin(angle) * plan.speedTilesPerSecond,
          },
          radiusTiles: BULLET_RADIUS_TILES,
          damage,
          owner: 'enemy',
          ttlMs: ENEMY_BULLET_TTL_MS,
        });
      }
      const followUp = scheduleGunnerFollowUp({
        enemyId: enemy.id,
        origin: enemy.position,
        aimTarget: player,
        damage,
        plan,
        nowMs: durationMs,
      });
      if (followUp !== null) pendingGunnerVolleys.push(followUp);
      return;
    }

    const plan = casterShotPlan({
      elite: enemy.elite,
      chapter: room.chapter,
      origin: enemy.position,
      targetPos: player,
      targetVel: playerVelocity,
    });
    const dx = plan.aimTarget.x - enemy.position.x;
    const dy = plan.aimTarget.y - enemy.position.y;
    const length = Math.hypot(dx, dy);
    const baseAngle = length === 0 ? 0 : Math.atan2(dy, dx);
    const angles =
      plan.angles.length > 1
        ? plan.angles
        : [(rng.next() * 2 - 1) * ENEMY_SHOT_SPREAD_RADIANS];

    for (const offset of angles) {
      const angle = baseAngle + offset;
      bullets.spawn({
        position: enemy.position,
        velocity: {
          x: Math.cos(angle) * plan.speedTilesPerSecond,
          y: Math.sin(angle) * plan.speedTilesPerSecond,
        },
        radiusTiles: BULLET_RADIUS_TILES,
        damage,
        owner: 'enemy',
        ttlMs: ENEMY_BULLET_TTL_MS,
      });
    }
  };

  const triggerBomberBlast = (enemy: EnemyState): void => {
    const spec = bomberBlastSpec(enemy, room.chapter);
    if (isInsideBomberBlast(spec.center, spec.radiusTiles, player, PLAYER_RADIUS_TILES)) {
      damagePlayer(spec.damage);
    }
    const followUp = scheduleFollowUpBlast(spec, durationMs);
    if (followUp !== null) pendingBlasts.push(followUp);
  };

  const triggerBufferCast = (enemy: EnemyState): void => {
    const pulse = resolveBufferPulse(enemy, enemies, durationMs);
    if (pulse.kind === 'aura') {
      buffTracker.applyHaste(pulse.affectedIds, pulse.speedMultiplier, pulse.untilMs);
      return;
    }
    const damage = contactDamageFor(enemy.role, enemy.elite, undefined, room.chapter);
    const direction = aimDirection(enemy.position, player);
    const baseAngle = Math.atan2(direction.y, direction.x);
    for (const offset of pulse.angles) {
      const angle = baseAngle + offset;
      bullets.spawn({
        position: enemy.position,
        velocity: {
          x: Math.cos(angle) * pulse.speedTilesPerSecond,
          y: Math.sin(angle) * pulse.speedTilesPerSecond,
        },
        radiusTiles: BULLET_RADIUS_TILES,
        damage,
        owner: 'enemy',
        ttlMs: ENEMY_BULLET_TTL_MS,
      });
    }
  };

  const bumpClassSkill = (map: Map<string, number>, skillId: string, amount = 1): void => {
    if (amount <= 0) return;
    map.set(skillId, (map.get(skillId) ?? 0) + amount);
  };

  const killEnemy = (enemy: EnemyState, atMs: number, killedBy?: string): void => {
    if (enemy.health <= 0 && enemy.action.kind === 'dead') return;
    enemy.health = 0;
    enemy.action = { kind: 'dead' };
    stuckGuard.forget(enemy.id);
    enemyKnockbacks.delete(enemy.id);
    buffTracker.forget(enemy.id);
    burns.delete(enemy.id);
    activeState = onActiveKill(activeState, activeConfig, 1);
    if (hasAnyClassSkill(characterId, classSkillSource)) {
      const effects = dispatchClassSkillEvent('onKill', characterId, classSkillSource, {
        position: enemy.position,
        targetPosition: enemy.position,
        targetId: enemy.id,
        elite: enemy.elite,
        ...(killedBy !== undefined ? { killedBy } : {}),
        nowMs: atMs,
        damage: stats.damage,
        enemies: classTargets(),
        rng,
        memory: classSkillMemory,
      });
      applyClassSkillEffects(effects);
    }
    const gold = Math.round(goldForKill(enemy.role, enemy.elite) * stats.goldMultiplier);
    kills += 1;
    goldEarned += gold;
    events.push({
      kind: 'kill',
      nowMs: atMs,
      room: room.room,
      enemyId: enemy.id,
      role: enemy.role,
      gold,
    });

    // M12 (ADR-021): drop a pooled XP orb (splitling = 0 XP so splitters cannot be farmed).
    const roomMultiplier = currentRoomIsXpChallenge ? DOORS_TUNING.xpRoomXpMultiplier : 1;
    const dropXp = xpForKill(enemy.role, enemy.elite, undefined, roomMultiplier);
    if (dropXp > 0) {
      xpOrbs.spawn({ position: enemy.position, value: dropXp });
    }

    // M17 (ADR-025): rare Health Potion drop (`3.5%` normal / `14%` Elite).
    if (shouldDropHealthPotion(enemy.elite, rng.next(), PICKUPS_TUNING.healthPotion)) {
      pickups.spawnHealthPotion(enemy.position);
    }

    // #42: a splitter leaves 2–3 splitlings. They are appended after this frame's damage
    // loops, so the room only clears once they are dead too.
    if (enemy.role === 'splitter') {
      for (const child of splitOnDeath(enemy, room, atMs)) pendingSplits.push(child);
    }
  };

  const damageEnemy = (enemy: EnemyState, amount: number, killedBy?: string): number => {
    if (amount <= 0 || enemy.health <= 0) return 0;
    const dealt = Math.min(amount, enemy.health);
    enemy.health = Math.max(0, enemy.health - amount);
    if (enemy.health <= 0) killEnemy(enemy, durationMs, killedBy);
    else enemy.action = staggerAfterHit(enemy.action, durationMs, DEFAULT_COMBAT.enemyStaggerMs);
    return dealt;
  };

  const isAlive = (enemy: EnemyState): boolean =>
    enemy.health > 0 && enemy.action.kind !== 'dead';

  /** Living enemies in the shape a class hook targets (positions by reference, no copy). */
  const classTargets = (): readonly ClassSkillTarget[] => {
    const targets: ClassSkillTarget[] = [];
    for (const enemy of enemies) {
      if (!isAlive(enemy)) continue;
      targets.push({
        id: enemy.id,
        position: enemy.position,
        ignited: isBurning(enemy.id, durationMs),
      });
    }
    return targets;
  };

  /** Apply one class-skill `damage` request: direct `targetId` or an AoE around `position`. */
  const applyClassDamage = (effect: ClassSkillEffect, multiplier = 1): void => {
    const amount = (effect.amount ?? 0) * Math.max(1, multiplier);
    if (!(amount > 0)) return;

    if (effect.targetId !== undefined) {
      const target = enemies.find(
        (enemy) => enemy.id === effect.targetId && isAlive(enemy),
      );
      if (target === undefined) return;
      const dealt = damageEnemy(target, amount, effect.skillId);
      if (dealt > 0) bumpClassSkill(classSkillDamage, effect.skillId, dealt);
      return;
    }

    const radius = (effect.radiusTiles ?? 0) * Math.max(1, multiplier);
    if (!(radius > 0)) return;
    for (const enemy of enemies) {
      if (!isAlive(enemy)) continue;
      const enemyRadius = DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role);
      if (distance(effect.position, enemy.position) > radius + enemyRadius) continue;
      const dealt = damageEnemy(enemy, amount, effect.skillId);
      if (dealt > 0) bumpClassSkill(classSkillDamage, effect.skillId, dealt);
    }
  };

  /** Apply one class-skill `status` request (slow and/or burn) to a target or an AoE. */
  const applyClassStatus = (effect: ClassSkillEffect): void => {
    const slowFactor = effect.slowFactor;
    const burnDps = effect.burnDps;
    const effectMs = effect.durationMs ?? 0;
    if (slowFactor === undefined && burnDps === undefined) return;

    const applyTo = (enemy: EnemyState): void => {
      if (slowFactor !== undefined && effectMs > 0) {
        statusOf(enemy).applySlow({ factor: slowFactor, durationMs: effectMs }, durationMs);
      }
      if (burnDps !== undefined) applyBurnEffect(enemy.id, burnDps, effectMs, durationMs);
    };

    if (effect.targetId !== undefined) {
      const target = enemies.find(
        (enemy) => enemy.id === effect.targetId && isAlive(enemy),
      );
      if (target !== undefined) applyTo(target);
      return;
    }

    const radius = effect.radiusTiles ?? 0;
    if (!(radius > 0)) return;
    for (const enemy of enemies) {
      if (!isAlive(enemy)) continue;
      const enemyRadius = DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role);
      if (distance(effect.position, enemy.position) > radius + enemyRadius) continue;
      applyTo(enemy);
    }
  };

  /**
   * Apply the class-skill requests one hook dispatch returned (M20, #84–#87).
   *
   * Every request counts as a proc for `SimulationResult.classSkillProcs`. Ninja (#84) and
   * Cultivator (#87) own stateful runtimes, so their effects go there and nothing is interpreted
   * twice. Every other class (Archer #85, Mage #86) uses the generic effect kinds below.
   */
  const applyClassSkillEffects = (
    effects: readonly ClassSkillEffect[],
    aimDirection?: Vec2,
  ): void => {
    if (effects.length === 0) return;
    for (const effect of effects) bumpClassSkill(classSkillProcs, effect.skillId);

    if (classRuntime !== null) {
      classRuntime.applyEffects(effects, durationMs, {
        shotDamage: stats.damage,
        critMultiplier: stats.critMultiplier,
        ...(aimDirection !== undefined ? { aimDirection } : {}),
      });
      return;
    }

    for (const effect of effects) {
      switch (effect.kind) {
        case 'damage':
          applyClassDamage(effect, stats.aoePowerMult);
          break;
        case 'status':
          applyClassStatus(effect);
          break;
        case 'spawn': {
          const direction = effect.direction;
          const amount = effect.amount ?? 0;
          if (direction === undefined || !(amount > 0)) break;
          const speed = currentProjectileSpeed();
          const shot = bullets.spawn({
            position: effect.position,
            velocity: { x: direction.x * speed, y: direction.y * speed },
            radiusTiles: BULLET_RADIUS_TILES,
            damage: amount,
            owner: 'player',
            ttlMs: Math.max(1200, Math.ceil((stats.targetingRangeTiles / speed) * 1000 * 1.5)),
            pierceRemaining: effect.pierce ?? 0,
            classSkillId: effect.skillId,
          });
          if (effect.ignoreTargetId !== undefined) shot.hitIds.push(effect.ignoreTargetId);
          break;
        }
        case 'buff':
          classSkillBuff = {
            fireRateMult: Math.max(1, effect.fireRateMult ?? 1),
            projectileSpeedMult: Math.max(1, effect.projectileSpeedMult ?? 1),
            untilMs: durationMs + (effect.durationMs ?? 0),
          };
          break;
        default:
          // `heal` is unused by the class hooks.
          break;
      }
    }
  };

  /** One class-skill damage event: normal enemy path so kills/gold/XP/onKill attribution match. */
  const applyClassSkillHit = (hit: ClassRuntimeHit): void => {
    const enemy = enemies.find(
      (candidate) =>
        candidate.id === hit.targetId &&
        candidate.health > 0 &&
        candidate.action.kind !== 'dead',
    );
    if (enemy === undefined) return;
    const dealt = damageEnemy(enemy, hit.amount, hit.skillId);
    bumpClassSkill(classSkillDamage, hit.skillId, dealt);
  };

  /** Step the active class's live state and apply its hits. */
  const stepClassSkillRuntime = (): void => {
    const runtime = classRuntime;
    if (runtime === null || runtime.isEmpty) return;
    const targets: ClassRuntimeTarget[] = [];
    for (const enemy of enemies) {
      if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
      targets.push({
        id: enemy.id,
        position: enemy.position,
        radiusTiles: DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role),
      });
    }
    const hits = runtime.step(durationMs, SIM_STEP_MS, targets, {
      shotDamage: stats.damage,
      critMultiplier: stats.critMultiplier,
    });
    for (const hit of hits) applyClassSkillHit(hit);
  };

  /** Active class-skill buff fire-rate multiplier (1 when none/expired). */
  const classSkillFireRateMult = (): number =>
    classSkillBuff !== null && durationMs < classSkillBuff.untilMs
      ? classSkillBuff.fireRateMult
      : 1;

  /** Active class-skill buff projectile-speed multiplier (1 when none/expired). */
  const classSkillProjectileSpeedMult = (): number =>
    classSkillBuff !== null && durationMs < classSkillBuff.untilMs
      ? classSkillBuff.projectileSpeedMult
      : 1;

  /** Current projectile speed including a live Wind buff (spawned arrows use it too). */
  const currentProjectileSpeed = (): number =>
    stats.projectileSpeedTilesPerSecond * classSkillProjectileSpeedMult();

  /** Unit flight direction of a bullet velocity (room tiles, y down); null for a zero vector. */
  const unitDirection = (velocity: Vec2): Vec2 | null => {
    const length = Math.hypot(velocity.x, velocity.y);
    if (!(length > 0)) return null;
    return { x: velocity.x / length, y: velocity.y / length };
  };

  /** Enter the boss room: hand over to `simulateBossRun` and end the run. */
  const runBossRoom = (
    bossRoom: LevelData,
    atRoomIndex: number,
  ): { bossDurationMs: number; won: boolean } => {
    // Same rule as the game: the run seed picks one boss from the chapter pool (#43).
    const bossId = pickBoss(bossRoom.chapter, options.seed);

    const result = simulateBossRun({
      bossId,
      seed: options.seed + atRoomIndex * 1_000 + 1,
      characterId,
      maxDurationMs: Math.max(1, maxDurationMs - durationMs),
      godMode: options.godMode,
      skills: ownedSkills,
      playerHearts: health.current,
      playerStart: bossRoom.playerStart,
      bossStart: bossRoom.bossStart,
      startNowMs: durationMs,
      // The same player plays the boss room: "dodge + typical loadout wins the chapter" is only
      // true if the boss fight dodges too. The boss room used to fall back to `approachBoss`
      // (walk into the boss), which won while the player entered with full hearts; once the
      // 64×36 normal rooms spent some (#66) that proxy lost the boss of a run it had cleared.
      policy: bossPolicyFor(options.policy, bossRoom),
      ...(options.chooseDash !== undefined
        ? { chooseDash: bossDashPolicyFor(options.chooseDash, bossRoom) }
        : {}),
      ...(options.chooseActive !== undefined
        ? {
            chooseActive: bossActivePolicyFor(options.chooseActive, bossRoom),
            initialActiveState: activeState,
          }
        : {}),
    });

    dashesUsed += result.dashesUsed;
    activeSkillsUsed += result.activeSkillsUsed;

    for (const event of result.events) {
      if (event.kind === 'boss-phase') {
        events.push({
          kind: 'boss-phase',
          nowMs: durationMs + event.nowMs,
          room: bossRoom.room,
          phase: event.phase,
        });
      } else if (event.kind === 'player-hit') {
        events.push({
          kind: 'player-hit',
          nowMs: durationMs + event.nowMs,
          room: bossRoom.room,
          hearts: event.hearts,
          source: event.source,
        });
      } else if (event.kind === 'shield-block') {
        events.push({
          kind: 'shield-block',
          nowMs: durationMs + event.nowMs,
          room: bossRoom.room,
        });
      } else if (event.kind === 'ward-block') {
        events.push({
          kind: 'ward-block',
          nowMs: durationMs + event.nowMs,
          room: bossRoom.room,
        });
      } else if (event.kind === 'dash') {
        events.push({
          kind: 'dash',
          nowMs: durationMs + event.nowMs,
          room: bossRoom.room,
          direction: event.direction,
        });
      } else if (event.kind === 'active-skill') {
        events.push({
          kind: 'active-skill',
          nowMs: durationMs + event.nowMs,
          room: bossRoom.room,
          skillId: event.skillId,
          projectiles: event.projectiles,
          ...(event.novaHits !== undefined ? { novaHits: event.novaHits } : {}),
          ...(event.hideAttachmentMs !== undefined
            ? { hideAttachmentMs: event.hideAttachmentMs }
            : {}),
        });
      }
    }
    if (result.outcome === 'won') {
      kills += 1;
      const gold = Math.round(goldForRoomClear(true) * stats.goldMultiplier);
      goldEarned += gold;
      roomsCleared += 1;
      events.push({
        kind: 'room-cleared',
        nowMs: durationMs + result.durationMs,
        room: bossRoom.room,
        gold,
      });
      events.push({ kind: 'run-won', nowMs: durationMs + result.durationMs });
    } else {
      events.push({ kind: 'run-lost', nowMs: durationMs + result.durationMs });
    }

    return { bossDurationMs: result.durationMs, won: result.outcome === 'won' };
  };

  // Chapter with only a boss room (authoring mistake/edge case): handle before entering the loop.
  if (room.isBossRoom) {
    const bossRun = runBossRoom(room, 0);
    return {
      status: bossRun.won ? 'won' : 'lost',
      roomsCleared,
      kills,
      goldEarned,
      xpEarned: xpTracker.totalXp,
      levelUps: xpTracker.level - 1,
      finalLevel: xpTracker.level,
      acquiredSkills: new Map(ownedSkills),
      dashesUsed,
      activeSkillsUsed,
      evolutions: stats.activeEvolutions,
      classSkillDamage,
      classSkillProcs,
      durationMs: bossRun.bossDurationMs,
      events,
    };
  }

  while (durationMs < maxDurationMs && status === null) {
    durationMs += SIM_STEP_MS;
    shield.update(durationMs);

    // Hitstop: real time passes but the simulation stands still (exactly `HitstopClock`).
    if (hitstopMs > 0) {
      hitstopMs -= SIM_STEP_MS;
      continue;
    }

    dashState = stepDash(dashState, SIM_STEP_MS);
    activeState = stepActiveSkill(activeState, SIM_STEP_MS);
    actionBuffer.step(SIM_STEP_MS);

    // Class-skill periodic tick (Mage meteors/orbs/shards; allocation-free when nothing is owned).
    if (hasAnyClassSkill(characterId, classSkillSource)) {
      const effects = dispatchClassSkillEvent('tick', characterId, classSkillSource, {
        nowMs: durationMs,
        dtMs: SIM_STEP_MS,
        position: player,
        damage: stats.damage,
        enemies: classTargets(),
        memory: classSkillMemory,
        rng,
      });
      applyClassSkillEffects(effects);
    }

    const worldSnapshot: PolicyWorld = {
      nowMs: durationMs,
      room: room.room,
      wave: 0,
      player,
      hearts: health.current,
      shieldCharges: shield.charges,
      enemies,
      bullets: bullets.active(),
    };
    const intent = options.policy(worldSnapshot);
    const moveDir = normalizeMoveInput(intent);

    if (options.chooseDash !== undefined) {
      const requestedDash = options.chooseDash({
        ...worldSnapshot,
        moveDir,
        dashState,
        pendingBlasts,
      });
      if (requestedDash !== null) {
        bufferedDashDir = requestedDash;
        actionBuffer.press('dash');
      }
    }
    if (actionBuffer.has('dash') && canStartDash(dashState)) {
      const started = tryStartDash(dashState, bufferedDashDir, DASH_TUNING, stats.dashCooldownMult);
      if (started.started) {
        actionBuffer.consume('dash');
        dashState = started.state;
        dashesUsed += 1;
        if (hasAnyClassSkill(characterId, classSkillSource)) {
          const effects = dispatchClassSkillEvent('onDash', characterId, classSkillSource, {
            position: player,
            nowMs: durationMs,
            memory: classSkillMemory,
            damage: stats.damage,
            enemies: classTargets(),
            rng,
          });
          applyClassSkillEffects(effects);
        }
        events.push({
          kind: 'dash',
          nowMs: durationMs,
          room: room.room,
          direction: dashState.direction,
        });
        if (stats.postDashFireRate !== undefined) {
          postDashFireUntilMs = Math.max(
            postDashFireUntilMs,
            durationMs + stats.postDashFireRate.durationMs,
          );
        }
        if (stats.dashNova !== undefined) {
          const novaRadius = stats.dashNova.radiusTiles * stats.aoePowerMult;
          const novaDamage = stats.dashNova.damage * stats.aoePowerMult;
          for (const enemy of enemies) {
            if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
            const enemyRadius = DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role);
            if (distance(player, enemy.position) > novaRadius + enemyRadius) continue;
            const dealt = damageEnemy(enemy, novaDamage);
            if (dealt > 0) {
              healPlayer(lifestealHeal(stats, dealt));
              statusOf(enemy).apply(stats, durationMs);
              applyBurn(enemy.id, durationMs);
              activeState = onActiveHit(activeState, activeConfig, 1);
            }
          }
        }
      }
    }

    const prevPlayer = player;
    const dtSec = SIM_STEP_MS / 1000;
    if (isDashing(dashState)) {
      const vel = dashVelocity(dashState, stats.dashSpeedMult);
      player = moveWithCollision(
        player,
        { x: vel.x * dtSec, y: vel.y * dtSec },
        PLAYER_RADIUS_TILES,
        room,
        ROOM_EDGE_MARGIN_TILES,
      );
    } else {
      player = movePlayer(player, intent, stats.moveSpeedTilesPerSecond, room);
    }
    playerVelocity = {
      x: (player.x - prevPlayer.x) / dtSec,
      y: (player.y - prevPlayer.y) / dtSec,
    };

    if (options.chooseActive !== undefined) {
      const requestedActive = options.chooseActive({
        ...worldSnapshot,
        player,
        activeState,
        signatureSkillId,
      });
      if (requestedActive !== null) {
        bufferedActiveDir = requestedActive;
        actionBuffer.press('active');
      }
    }
    if (actionBuffer.has('active') && isActiveSkillReady(activeState)) {
      const triggered = tryActivateSkill(
        activeState,
        activeConfig,
        stats.activeCooldownMult,
      );
      if (triggered.triggered) {
        actionBuffer.consume('active');
        activeState = triggered.state;
        activeSkillsUsed += 1;
        if (hasAnyClassSkill(characterId, classSkillSource)) {
          const effects = dispatchClassSkillEvent('onActive', characterId, classSkillSource, {
            position: player,
            nowMs: durationMs,
            memory: classSkillMemory,
            damage: stats.damage,
            enemies: classTargets(),
            rng,
          });
          applyClassSkillEffects(effects);
        }

        if (signatureSkillId === 'arcane-nova') {
          const nova = computeArcaneNovaSpec(player, stats.activePowerMult, {
            baseDamage: stats.damage,
            aoePowerMult: stats.aoePowerMult,
          });
          let novaHits = 0;
          for (const enemy of enemies) {
            if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
            const enemyRadius = DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role);
            if (distance(nova.origin, enemy.position) > nova.radiusTiles + enemyRadius) continue;
            let novaDmg = damageAfterExecute(
              stats,
              nova.damage,
              enemy.health / enemy.maxHealth,
            );
            if (stats.statusDamageBonus > 0 && isAfflicted(enemy, durationMs)) {
              novaDmg *= 1 + stats.statusDamageBonus;
            }
            const dealt = damageEnemy(enemy, novaDmg);
            if (dealt > 0) {
              healPlayer(lifestealHeal(stats, dealt));
              if (enemy.health > 0) {
                const status = statusOf(enemy);
                status.apply(stats, durationMs);
                status.applySlow(
                  { factor: nova.slowFactor, durationMs: nova.slowDurationMs },
                  durationMs,
                );
                applyBurn(enemy.id, durationMs);
              }
              novaHits += 1;
            }
          }
          for (const bolt of nova.bolts) {
            const spawned = bullets.spawn({
              position: bolt.position,
              velocity: bolt.velocity,
              radiusTiles: bolt.radiusTiles,
              damage: bolt.damage,
              owner: 'player',
              ttlMs: bolt.ttlMs,
              pierceRemaining: bolt.pierceRemaining,
              homing: bolt.homing,
            });
            activeBulletIds.add(spawned.id);
          }
          events.push({
            kind: 'active-skill',
            nowMs: durationMs,
            room: room.room,
            skillId: 'arcane-nova',
            projectiles: nova.bolts.length,
            novaHits,
          });
        } else if (signatureSkillId === 'piercing-volley') {
          const volley = computePiercingVolley(player, bufferedActiveDir, stats.activePowerMult, {
            baseDamage: stats.damage,
          });
          for (const arrow of volley) {
            const spawned = bullets.spawn({
              position: arrow.position,
              velocity: arrow.velocity,
              radiusTiles: arrow.radiusTiles,
              damage: arrow.damage,
              owner: 'player',
              ttlMs: arrow.ttlMs,
              pierceRemaining: arrow.pierceRemaining,
              homing: arrow.homing,
            });
            activeBulletIds.add(spawned.id);
          }
          events.push({
            kind: 'active-skill',
            nowMs: durationMs,
            room: room.room,
            skillId: 'piercing-volley',
            projectiles: volley.length,
          });
        } else if (signatureSkillId === 'ten-thousand-swords') {
          const cast = computeTenThousandSwordsVolley(
            player,
            bufferedActiveDir,
            stats.activePowerMult,
            {
              baseDamage: stats.damage,
            },
          );
          for (const sword of cast.projectiles) {
            const spawned = bullets.spawn({
              position: sword.position,
              velocity: sword.velocity,
              radiusTiles: sword.radiusTiles,
              damage: sword.damage,
              owner: 'player',
              ttlMs: sword.ttlMs,
              pierceRemaining: sword.pierceRemaining,
              homing: sword.homing,
            });
            activeBulletIds.add(spawned.id);
          }
          events.push({
            kind: 'active-skill',
            nowMs: durationMs,
            room: room.room,
            skillId: 'ten-thousand-swords',
            projectiles: cast.projectiles.length,
            hideAttachmentMs: cast.hideAttachmentMs,
          });
        } else {
          const volley = computeShadowBarrageVolley(
            player,
            bufferedActiveDir,
            stats.activePowerMult,
            {
              baseDamage: stats.damage,
            },
          );
          for (const blade of volley) {
            const spawned = bullets.spawn({
              position: blade.position,
              velocity: blade.velocity,
              radiusTiles: blade.radiusTiles,
              damage: blade.damage,
              owner: 'player',
              ttlMs: blade.ttlMs,
              pierceRemaining: blade.pierceRemaining,
              homing: blade.homing,
            });
            activeBulletIds.add(spawned.id);
          }
          events.push({
            kind: 'active-skill',
            nowMs: durationMs,
            room: room.room,
            skillId: 'shadow-barrage',
            projectiles: volley.length,
          });
        }
      }
    }

    if (pendingBlasts.length > 0) {
      const steppedBlasts = stepPendingBlasts(pendingBlasts, durationMs);
      pendingBlasts = steppedBlasts.remaining;
      for (const blast of steppedBlasts.triggered) {
        if (isInsideBomberBlast(blast.center, blast.radiusTiles, player, PLAYER_RADIUS_TILES)) {
          damagePlayer(blast.damage);
        }
      }
    }

    if (pendingGunnerVolleys.length > 0) {
      const steppedVolleys = stepPendingGunnerVolleys(pendingGunnerVolleys, durationMs);
      pendingGunnerVolleys = steppedVolleys.remaining;
      for (const volley of steppedVolleys.triggered) {
        const shooter = enemies.find(
          (e) => e.id === volley.enemyId && e.health > 0 && e.action.kind !== 'dead',
        );
        if (shooter === undefined) continue;
        const direction = aimDirection(shooter.position, player);
        const baseAngle = Math.atan2(direction.y, direction.x);
        for (const offset of volley.angles) {
          const angle = baseAngle + offset;
          bullets.spawn({
            position: shooter.position,
            velocity: {
              x: Math.cos(angle) * volley.speedTilesPerSecond,
              y: Math.sin(angle) * volley.speedTilesPerSecond,
            },
            radiusTiles: BULLET_RADIUS_TILES,
            damage: volley.damage,
            owner: 'enemy',
            ttlMs: ENEMY_BULLET_TTL_MS,
          });
        }
      }
    }

    // What the player can see this frame: one screen, clamped to the room (#41). Enemies are
    // held to it — they never start an attack from off screen, and far ones idle.
    const view = viewAroundPlayer(player, room);

    // Wave delivery: batches under the alive cap, on-screen spawns telegraph first.
    if (scheduler !== null) {
      const spawns = scheduler.step({
        nowMs: durationMs,
        player,
        view,
        alive: aliveEnemies(),
      });
      if (spawns.length > 0) roomBatchIndex += 1;
      for (const spawn of spawns) {
        // `'xp'` Elite challenge door room: promote up to `xpRoomExtraElites` non-elite spawns
        // cleanly inside the wave flow (from batch 2 onward, preserving opening-batch fairness).
        let promoted = spawn;
        if (
          extraElitesToPromote > 0 &&
          roomBatchIndex >= 2 &&
          !spawn.elite &&
          spawn.role !== 'splitling'
        ) {
          promoted = { ...spawn, elite: true };
          extraElitesToPromote -= 1;
        }
        pendingSpawns.push({
          state: enemyStateFromSpawn(room, promoted, spawnSeq, durationMs),
          atMs: durationMs + promoted.telegraphMs,
        });
        spawnSeq += 1;
      }
    }
    releaseTelegraphed();

    const targets = enemies.map((enemy) => ({
      id: enemy.id,
      position: enemy.position,
      alive: enemy.health > 0 && enemy.action.kind !== 'dead',
    }));
    const postDashBonus =
      stats.postDashFireRate !== undefined && durationMs < postDashFireUntilMs
        ? 1 + stats.postDashFireRate.bonus
        : 1;
    // *Bom Khói Ẩn Thân*: while the player stands in smoke, auto-fire runs faster (M20, #84).
    // *Phong Tiễn*: Wind momentum multiplies the same delta (M20, #85).
    const smokeFireBonus = ninjaRuntime?.fireRateBonusAt(player, durationMs) ?? 0;
    const fireDeltaMs =
      SIM_STEP_MS * postDashBonus * (1 + smokeFireBonus) * classSkillFireRateMult();
    const shot = autoFire.update({
      deltaMs: fireDeltaMs,
      origin: player,
      targets,
      rangeTiles: stats.targetingRangeTiles,
    });
    if (shot !== null) {
      const activeBefore = bullets.active();
      const previousNewestId = activeBefore[activeBefore.length - 1]?.id ?? 0;
      firePlayerVolley({
        pool: bullets,
        stats,
        rng,
        origin: shot.origin,
        direction: shot.direction,
        speedTilesPerSecond: currentProjectileSpeed(),
        radiusTiles: BULLET_RADIUS_TILES,
        ttlMs: bulletTtlMs,
      });
      shotsFired += 1;
      // Tag every bullet of this volley so `onHit` can read the shot that actually hit.
      for (const bullet of bullets.active()) {
        if (bullet.id > previousNewestId) bullet.shotCount = shotsFired;
      }
      if (hasAnyClassSkill(characterId, classSkillSource)) {
        const shotTarget = targets.find((target) => target.id === shot.targetId);
        const effects = dispatchClassSkillEvent('onShot', characterId, classSkillSource, {
          shotCount: shotsFired,
          position: shot.origin,
          damage: stats.damage,
          nowMs: durationMs,
          memory: classSkillMemory,
          enemies: classTargets(),
          ...(shotTarget !== undefined ? { targetPosition: shotTarget.position } : {}),
          rng,
        });
        applyClassSkillEffects(effects, shot.direction);
      }
    }

    // Live Ninja state (clones/clouds/kunai) steps before enemy AI, so its kills land this frame.
    stepClassSkillRuntime();

    // --- Enemy AI ---------------------------------------------------------
    for (const enemy of enemies) {
      if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;

      const statusEffects = statusOf(enemy);
      const slow = statusEffects.speedMultiplier(durationMs);
      const poison = statusEffects.poisonDamage(durationMs, SIM_STEP_MS);
      if (poison > 0) damageEnemy(enemy, poison);
      if (enemy.health <= 0) continue;
      const burn = burnDamageFor(enemy.id, durationMs, SIM_STEP_MS);
      if (burn > 0) damageEnemy(enemy, burn);
      if (enemy.health <= 0) continue;

      const enemyRadius = DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role);
      const activeKnockback = enemyKnockbacks.get(enemy.id);
      if (activeKnockback !== undefined) {
        const pushed = stepKnockback(
          enemy.position,
          activeKnockback,
          SIM_STEP_MS,
          room,
          ROOM_EDGE_MARGIN_TILES,
          enemyRadius,
        );
        enemy.position = pushed.position;
        if (pushed.state === null) enemyKnockbacks.delete(enemy.id);
        else enemyKnockbacks.set(enemy.id, pushed.state);
        continue;
      }

      const before = enemy.action;
      const next = decideAction({ state: enemy, player, nowMs: durationMs, level: room, view });
      // Same attack-cycle rule as the game adapter (`core/enemies/attack-cycle.ts`): a stagger or
      // ordinary transition must not restart the cooldown, or an enemy under constant fire never
      // reaches its attack beat.
      enemy.actionStartedMs = nextActionStartedMs(
        before,
        next,
        durationMs,
        enemy.actionStartedMs,
      );
      enemy.action = next;

      const released = attackReleasedForRole(enemy.role, before, next);
      if (released === 'shot') {
        fireCasterVolley(enemy);
      } else if (released === 'blast') {
        triggerBomberBlast(enemy);
      } else if (released === 'buff') {
        triggerBufferCast(enemy);
      }

      // Walk on the shared flow field toward the player: straight while in sight, around the
      // wall otherwise. The stuck guard may override the direction for a short detour.
      const field = navigation.field(enemyRadius, player, durationMs);
      const detour = stuckGuard.update(
        enemy.id,
        enemy.position,
        next.kind === 'walk',
        durationMs,
        field,
        random,
      );
      const haste = buffTracker.speedMultiplierFor(enemy.id, durationMs);
      // *Bom Khói Ẩn Thân*: enemies standing in smoke walk slower (M20, #84).
      const smokeSlow = ninjaRuntime?.enemySpeedMultiplierAt(enemy.position, durationMs) ?? 1;
      advanceEnemy(enemy, next, slow * haste * smokeSlow, room, field, detour);

      const melee =
        enemy.role === 'chaser' ||
        enemy.role === 'tank' ||
        enemy.role === 'splitter' ||
        enemy.role === 'splitling' ||
        enemy.role === 'dasher';
      const contactRange = CONTACT_RANGE_TILES * visualScaleFor(enemy.role);
      if (melee && distance(enemy.position, player) <= contactRange) {
        const hitApplied = damagePlayer(
          contactDamageFor(enemy.role, enemy.elite, undefined, room.chapter),
          'contact',
        );
        // Thorns: touching the player hurts the enemy (only when the blow really lands).
        if (hitApplied && stats.thorns !== undefined) {
          damageEnemy(enemy, stats.thorns.damage);
        }
      }
    }

    separateEnemiesForRoom(enemies, room);

    // --- Homing -----------------------------------------------------------
    for (const bullet of bullets.active()) {
      if (!bullet.homing || bullet.owner !== 'player') continue;
      const aim = nearestAlive(bullet.position, enemies);
      if (aim === null) continue;
      const turn = (HOMING_TURN_RATE_RADIANS_PER_SECOND * SIM_STEP_MS) / 1000;
      const next = steerVelocity(bullet.velocity, bullet.position, aim, turn);
      bullet.velocity.x = next.x;
      bullet.velocity.y = next.y;
    }

    bullets.update(SIM_STEP_MS);

    // Obstacles + collision. Hit bullets collect ids then `consumeWhere` **once**
    // after the loop: never retire while iterating `active()`, and a hit bullet
    // disappears in this frame instead of living one more frame with `ttlMs = 0`.
    const seconds = SIM_STEP_MS / 1000;
    spent.clear();
    /** `onHit` effects are applied after the loop: spawning into `active()` mid-iteration is unsafe. */
    const classHitEffects: ClassSkillEffect[] = [];
    for (const bullet of bullets.active()) {
      if (spent.has(bullet.id)) continue;

      const from = {
        x: bullet.position.x - bullet.velocity.x * seconds,
        y: bullet.position.y - bullet.velocity.y * seconds,
      };
      if (firstHit({ from, to: bullet.position }, room) !== null) {
        spent.add(bullet.id);
        continue;
      }
      const area = { position: bullet.position, radiusTiles: bullet.radiusTiles };

      if (bullet.owner === 'enemy') {
        if (!hitsCircle(area, { position: player, radiusTiles: PLAYER_RADIUS_TILES })) continue;
        spent.add(bullet.id);
        damagePlayer(bullet.damage);
        continue;
      }

      // Player bullet: sweep every living enemy on the path (Piercing), bounce if
      // Ricochet, then decide whether to retire.
      let consumed = false;
      for (const enemy of enemies) {
        if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
        if (bullet.hitIds.includes(enemy.id)) continue;

        const enemyRadius = DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role);
        if (!hitsCircle(area, { position: enemy.position, radiusTiles: enemyRadius })) continue;

        const firstEnemyHit = bullet.hitIds.length === 0;
        bullet.hitIds.push(enemy.id);
        let damage = damageAfterExecute(stats, bullet.damage, enemy.health / enemy.maxHealth);
        if (stats.statusDamageBonus > 0 && isAfflicted(enemy, durationMs)) {
          damage *= 1 + stats.statusDamageBonus;
        }
        const dealt = damageEnemy(enemy, damage);
        healPlayer(lifestealHeal(stats, dealt));
        statusOf(enemy).apply(stats, durationMs);
        applyBurn(enemy.id, durationMs);
        if (dealt > 0 && hasAnyClassSkill(characterId, classSkillSource)) {
          const direction = unitDirection(bullet.velocity);
          classHitEffects.push(
            ...dispatchClassSkillEvent('onHit', characterId, classSkillSource, {
              position: bullet.position,
              targetPosition: enemy.position,
              targetId: enemy.id,
              crit: bullet.crit,
              damage: dealt,
              firstHit: firstEnemyHit,
              shotCount: bullet.shotCount,
              nowMs: durationMs,
              enemies: classTargets(),
              memory: classSkillMemory,
              ...(direction !== null ? { direction } : {}),
              ...(bullet.classSkillId !== undefined
                ? { projectileSkillId: bullet.classSkillId }
                : {}),
              rng,
            }),
          );
        }
        if (!activeBulletIds.has(bullet.id)) {
          activeState = onActiveHit(activeState, activeConfig, 1);
        }
        hitstopMs = Math.max(hitstopMs, DEFAULT_COMBAT.enemyHitstopMs);

        // Chain Lightning: arc shock damage to up to `arcs` nearest living enemies within range.
        if (stats.shockOnHit !== undefined && stats.shockOnHit.arcs > 0 && stats.shockOnHit.damageRatio > 0) {
          const shock = stats.shockOnHit;
          const arcDamage = damage * shock.damageRatio;
          const shockTargets: Array<{ target: EnemyState; gap: number }> = [];
          for (const other of enemies) {
            if (other === enemy || other.health <= 0 || other.action.kind === 'dead') continue;
            const gap = distance(enemy.position, other.position);
            if (gap <= shock.rangeTiles) shockTargets.push({ target: other, gap });
          }
          shockTargets.sort((a, b) => a.gap - b.gap || a.target.id.localeCompare(b.target.id));
          for (let i = 0; i < Math.min(shock.arcs, shockTargets.length); i += 1) {
            const entry = shockTargets[i];
            if (entry === undefined) continue;
            const arcDealt = damageEnemy(entry.target, arcDamage);
            healPlayer(lifestealHeal(stats, arcDealt));
          }
        }

        // Explosive: extra damage to other enemies in radius (scaled by class `aoePowerMult`).
        if (bullet.explosiveRadiusTiles > 0 && bullet.explosiveDamage > 0) {
          const blastRadius = bullet.explosiveRadiusTiles * stats.aoePowerMult;
          const blastDamage = bullet.explosiveDamage * stats.aoePowerMult;
          for (const other of enemies) {
            if (other === enemy || other.health <= 0 || other.action.kind === 'dead') continue;
            if (distance(bullet.position, other.position) > blastRadius) continue;
            damageEnemy(other, blastDamage);
          }
        }

        // Enemy died from the main hit: the kill event was already emitted in damageEnemy.
        if (bullet.pierceRemaining > 0) {
          bullet.pierceRemaining -= 1;
          continue;
        }
        if (bullet.ricochetRemaining > 0) {
          const next = ricochetTarget(
            bullet.position,
            enemies
              .filter((candidate) => candidate.health > 0 && candidate.action.kind !== 'dead')
              .map((candidate) => ({ id: candidate.id, position: candidate.position })),
            bullet.hitIds,
          );
          if (next !== null) {
            bullet.ricochetRemaining -= 1;
            const speed = Math.hypot(bullet.velocity.x, bullet.velocity.y);
            const dx = next.position.x - bullet.position.x;
            const dy = next.position.y - bullet.position.y;
            const length = Math.hypot(dx, dy) || 1;
            bullet.velocity.x = (dx / length) * speed;
            bullet.velocity.y = (dy / length) * speed;
            continue;
          }
        }
        consumed = true;
        break;
      }

      if (consumed) spent.add(bullet.id);
    }
    if (spent.size > 0) {
      bullets.consumeWhere((bullet) => spent.has(bullet.id));
      for (const id of spent) activeBulletIds.delete(id);
    }

    if (classHitEffects.length > 0) applyClassSkillEffects(classHitEffects);

    // Splitters killed this frame leave their splitlings behind, before the clear check
    // (otherwise the room would clear with the brood still to come).
    if (pendingSplits.length > 0) {
      for (const child of pendingSplits) enemies.push(child);
      pendingSplits.length = 0;
    }

    // M12 (ADR-021): step pooled XP orbs (scatter glide + magnetic pickup -> mid-combat level-ups).
    const collectedXp = xpOrbs.step(SIM_STEP_MS / 1000, player, false);
    if (collectedXp > 0) {
      grantAndResolveXp(collectedXp);
    }

    // M17 (ADR-025): step Health Potions (magnet-pulled & healed only when hp < maxHp).
    const pickedNow = pickups.step(SIM_STEP_MS / 1000, player, {
      roomCleared: false,
      playerHp: health.current,
      playerMaxHp: health.max,
    });
    if (pickedNow.hpHealed > 0) healPlayer(pickedNow.hpHealed);
    if (pickedNow.potionGoldBonus > 0) {
      roomPotionGoldBonus += pickedNow.potionGoldBonus;
    }

    if (health.isDead) {
      status = 'lost';
      events.push({ kind: 'run-lost', nowMs: durationMs });
      break;
    }
    // #41: the room is cleared when the scheduler spawned everything and nothing is left alive.
    const cleared =
      scheduler !== null ? scheduler.isCleared(aliveEnemies()) : isWaveCleared(enemies);
    if (!cleared) continue;

    {
      // M12 + M17: full-room auto-vacuum collects every remaining XP orb & Health Potion on clear.
      const vacuumStepSec = SIM_STEP_MS / 1000;
      for (let step = 0; step < 1000 && (xpOrbs.size > 0 || pickups.size > 0); step += 1) {
        if (xpOrbs.size > 0) {
          const vacuumedXp = xpOrbs.step(vacuumStepSec, player, true);
          if (vacuumedXp > 0) grantAndResolveXp(vacuumedXp);
        }
        if (pickups.size > 0) {
          const vacuumedPickups = pickups.step(vacuumStepSec, player, {
            roomCleared: true,
            playerHp: health.current,
            playerMaxHp: health.max,
          });
          if (vacuumedPickups.hpHealed > 0) healPlayer(vacuumedPickups.hpHealed);
          if (vacuumedPickups.potionGoldBonus > 0) {
            roomPotionGoldBonus += vacuumedPickups.potionGoldBonus;
          }
        }
      }
      xpOrbs.clear();
      pickups.clear();

      // The room's clear reward comes from the door taken after the previous room (#39).
      const roomPosition = roomIndex + 1;
      const reward = clearRewardFor(roomPosition, doorReward);
      const goldBonus =
        reward === 'gold' ? Math.max(0, Math.round(DOORS_TUNING.goldBonus)) : 0;
      const xpBonus = currentRoomIsXpChallenge ? xpDoorClearBonus(room.chapter) : 0;
      if (xpBonus > 0) {
        grantAndResolveXp(xpBonus);
      }
      const roomGold =
        Math.round(goldForRoomClear(room.isBossRoom) * stats.goldMultiplier) +
        goldBonus +
        roomPotionGoldBonus;
      roomPotionGoldBonus = 0;
      goldEarned += roomGold;
      roomsCleared += 1;
      events.push({ kind: 'room-cleared', nowMs: durationMs, room: room.room, gold: roomGold });
      events.push({
        kind: 'reward',
        nowMs: durationMs,
        room: roomPosition,
        reward,
        gold: goldBonus,
        ...(xpBonus > 0 ? { xp: xpBonus } : {}),
      });
      healPlayer(stats.healPerRoom ?? 0);

      const nextRoom = runRooms[roomIndex + 1];
      if (nextRoom === undefined) {
        status = 'won';
        events.push({ kind: 'run-won', nowMs: durationMs });
        break;
      }

      // Doors for the room just cleared: two rewards before the boss, the boss door after it.
      const offers = doorOffers(options.seed, roomPosition, normalRoomCount, enabledDoors);
      const chosen = chooseDoorFrom(options.chooseDoor, offers, roomPosition);
      events.push({ kind: 'door', nowMs: durationMs, room: roomPosition, offers, chosen });
      doorReward = chosen;

      if (isSpecialDoor(chosen)) {
        // M17 cadence (ADR-025): the mid-chapter Special Room after Room 4 is a dedicated stop
        // between Room 4 and Room 5 — it does NOT skip combat Room 5, preserving all 8 combat
        // rooms + Room 9 Boss (`roomsCleared === 9`).
        let bonusGold = 0;
        if (chosen === 'heal') {
          const healed = healByFraction(
            health.current,
            stats.maxHearts,
            SPECIAL_ROOMS_TUNING.healFraction,
          );
          health.heal(healed - health.current);
        }
        if (chosen === 'chest') {
          const chest = chestReward(options.seed, roomPosition);
          if (chest.kind === 'gold') {
            bonusGold = chest.amount;
          } else if (options.chooseSkill !== undefined) {
            const chestOffers = rollChoices({
              rng: skillRollRng,
              owned: ownedSkills,
              characterId,
            });
            if (chestOffers.length > 0) {
              const pickedIndex = pickSkillIndex(
                options.chooseSkill,
                chestOffers,
                ownedSkills,
                xpTracker.level,
                { hearts: health.current, maxHearts: health.max },
              );
              const chestSkill = chestOffers[pickedIndex] ?? chestOffers[0];
              if (chestSkill !== undefined) acquireSkill(chestSkill);
            }
          }
        }
        const slotGold =
          Math.round(goldForRoomClear(false) * stats.goldMultiplier) + bonusGold;
        goldEarned += slotGold;
        events.push({
          kind: 'special',
          nowMs: durationMs,
          room: roomPosition,
          reward: chosen,
          hearts: health.current,
          gold: slotGold,
        });

        // Single North Portal out of the mid-chapter Special Room leads directly into Room 5.
        const exitOffers: readonly DoorReward[] =
          roomPosition >= normalRoomCount ? ['boss'] : ['xp'];
        const exitChosen = exitOffers[0] ?? 'xp';
        events.push({
          kind: 'door',
          nowMs: durationMs,
          room: roomPosition,
          offers: exitOffers,
          chosen: exitChosen,
        });
        doorReward = exitChosen;

        roomIndex += 1;
        room = nextRoom;
        navigation = createRoomNavigation(room);
        stuckGuard.clear();

        if (room.isBossRoom) {
          const bossRun = runBossRoom(room, roomIndex);
          durationMs += bossRun.bossDurationMs;
          status = bossRun.won ? 'won' : 'lost';
          break;
        }

        player = { x: room.playerStart.x, y: room.playerStart.y };
        enemies = enterRoomEnemies(room, roomIndex, doorReward === 'xp');
        bullets.clear();
        continue;
      }

      roomIndex += 1;
      room = nextRoom;
      navigation = createRoomNavigation(room);
      stuckGuard.clear();

      if (room.isBossRoom) {
        const bossRun = runBossRoom(room, roomIndex);
        durationMs += bossRun.bossDurationMs;
        status = bossRun.won ? 'won' : 'lost';
        break;
      }

      player = { x: room.playerStart.x, y: room.playerStart.y };
    }

    enemies = enterRoomEnemies(room, roomIndex, doorReward === 'xp');
    bullets.clear();
  }

  return {
    status: status ?? 'timeout',
    roomsCleared,
    kills,
    goldEarned,
    xpEarned: xpTracker.totalXp,
    levelUps: xpTracker.level - 1,
    finalLevel: xpTracker.level,
    acquiredSkills: new Map(ownedSkills),
    dashesUsed,
    activeSkillsUsed,
    evolutions: stats.activeEvolutions,
    classSkillDamage,
    classSkillProcs,
    durationMs,
    events,
  };
}

function unitVec(dx: number, dy: number): Vec2 | null {
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 1e-6) return null;
  return { x: dx / len, y: dy / len };
}

function chooseSide(
  perpA: Vec2,
  perpB: Vec2,
  moveDir: Vec2,
  fallbackAway: Vec2 | null,
): Vec2 {
  const moveLen = Math.hypot(moveDir.x, moveDir.y);
  if (moveLen > 1e-6) {
    const dotA = perpA.x * moveDir.x + perpA.y * moveDir.y;
    const dotB = perpB.x * moveDir.x + perpB.y * moveDir.y;
    return dotA >= dotB ? perpA : perpB;
  }
  if (fallbackAway !== null) {
    const dotA = perpA.x * fallbackAway.x + perpA.y * fallbackAway.y;
    const dotB = perpB.x * fallbackAway.x + perpB.y * fallbackAway.y;
    return dotA >= dotB ? perpA : perpB;
  }
  return perpA;
}

/**
 * Competent-player Dash (`Space`) policy (M13, ADR-022).
 *
 * Triggers Dash when ready (or inside the 150 ms `ActionBuffer` window) to evade imminent
 * close-range threats:
 * 1. Pending elite bomber follow-up blasts or armed bomber fuse telegraphs within blast radius.
 * 2. Incoming enemy projectiles (predictive caster bursts, sniper shots, boss sweeps/zones)
 *    intersecting the player within the next ~0.3 s.
 * 3. Charging tanks, pouncing elite chasers, or close melee crowds closing inside contact range.
 */
export const smartDashPolicy: DashPolicy = (world: DashThreatWorld): Vec2 | null => {
  if (
    world.dashState.activeRemainingMs > 0 ||
    world.dashState.cooldownRemainingMs > DASH_TUNING.bufferMs
  ) {
    return null;
  }

  const { player, moveDir } = world;

  // 1. Imminent bomber follow-up blast or active bomber fuse telegraph.
  for (const blast of world.pendingBlasts) {
    if (distance(player, blast.center) <= blast.radiusTiles + 0.9) {
      return unitVec(player.x - blast.center.x, player.y - blast.center.y) ?? { x: 1, y: 0 };
    }
  }
  const baseBomberRadius = ENEMY_TUNING.roles.bomber.blastRadiusTiles ?? 2.4;
  for (const enemy of world.enemies) {
    if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
    if (enemy.role === 'bomber' && enemy.action.kind === 'telegraph') {
      const blastRadius = enemy.elite
        ? baseBomberRadius * ENEMY_TUNING.elite.bomber.blastRadiusMultiplier
        : baseBomberRadius;
      if (distance(player, enemy.position) <= blastRadius + 0.9) {
        return unitVec(player.x - enemy.position.x, player.y - enemy.position.y) ?? { x: 1, y: 0 };
      }
    }
  }

  // 2. Incoming enemy projectile (boss sweep / zone / elite volley / caster shot) about to intercept.
  let urgentBullet: Bullet | null = null;
  let urgentGap = Number.POSITIVE_INFINITY;
  for (const bullet of world.bullets) {
    if (bullet.owner !== 'enemy') continue;
    const rx = player.x - bullet.position.x;
    const ry = player.y - bullet.position.y;
    const dist = Math.hypot(rx, ry);
    if (dist > 4.8) continue;
    const speedSq = bullet.velocity.x * bullet.velocity.x + bullet.velocity.y * bullet.velocity.y;
    if (speedSq < 1e-6) continue;
    const tClosest = (rx * bullet.velocity.x + ry * bullet.velocity.y) / speedSq;
    if (tClosest < 0 || tClosest > 0.52) continue;
    const cx = bullet.position.x + bullet.velocity.x * tClosest;
    const cy = bullet.position.y + bullet.velocity.y * tClosest;
    const missGap = Math.hypot(player.x - cx, player.y - cy);
    if (missGap <= bullet.radiusTiles + PLAYER_RADIUS_TILES + 0.7 && dist < urgentGap) {
      urgentGap = dist;
      urgentBullet = bullet;
    }
  }
  if (urgentBullet !== null) {
    const bulletDir = unitVec(urgentBullet.velocity.x, urgentBullet.velocity.y);
    if (bulletDir !== null) {
      const perpA = { x: -bulletDir.y, y: bulletDir.x };
      const perpB = { x: bulletDir.y, y: -bulletDir.x };
      const away = unitVec(player.x - urgentBullet.position.x, player.y - urgentBullet.position.y);
      return chooseSide(perpA, perpB, moveDir, away);
    }
  }

  // 3. Charging enemy, tight melee pressure, or close enemy surround.
  let closestMelee: EnemyState | null = null;
  let closestMeleeGap = Number.POSITIVE_INFINITY;
  let closeCrowdCount = 0;
  let crowdSumX = 0;
  let crowdSumY = 0;
  for (const enemy of world.enemies) {
    if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
    const gap = distance(player, enemy.position);
    if (enemy.action.kind === 'charge' && gap <= 5.2) {
      const chargeDir = unitVec(enemy.action.direction.x, enemy.action.direction.y);
      if (chargeDir !== null) {
        const dot =
          (player.x - enemy.position.x) * chargeDir.x +
          (player.y - enemy.position.y) * chargeDir.y;
        if (dot > 0) {
          const perpA = { x: -chargeDir.y, y: chargeDir.x };
          const perpB = { x: chargeDir.y, y: -chargeDir.x };
          const away = unitVec(player.x - enemy.position.x, player.y - enemy.position.y);
          return chooseSide(perpA, perpB, moveDir, away);
        }
      }
    }
    if (gap <= 3.5) {
      closeCrowdCount += 1;
      crowdSumX += enemy.position.x;
      crowdSumY += enemy.position.y;
    }
    const meleeRole =
      enemy.id === BOSS_TARGET_ID ||
      enemy.role === 'chaser' ||
      enemy.role === 'tank' ||
      enemy.role === 'splitter' ||
      enemy.role === 'splitling' ||
      enemy.role === 'dasher';
    const panicRange = enemy.id === BOSS_TARGET_ID ? 3.1 : 2.4 * visualScaleFor(enemy.role);
    if (meleeRole && gap <= panicRange && gap < closestMeleeGap) {
      closestMeleeGap = gap;
      closestMelee = enemy;
    }
  }
  if (closestMelee !== null) {
    const away = unitVec(player.x - closestMelee.position.x, player.y - closestMelee.position.y);
    if (away !== null) return away;
    return unitVec(moveDir.x, moveDir.y) ?? { x: 1, y: 0 };
  }
  if (closeCrowdCount >= 2) {
    const awayCrowd = unitVec(
      player.x - crowdSumX / closeCrowdCount,
      player.y - crowdSumY / closeCrowdCount,
    );
    if (awayCrowd !== null) return awayCrowd;
  }

  return null;
};

/**
 * Competent-player Signature Active (`E`) policy (M13/M14, ADR-022).
 *
 * Fires whenever off cooldown (or inside the 150 ms `ActionBuffer` window) and a boss, elite,
 * special Tier-2 threat (`bomber`/`buffer`/`tank`), pack of ≥ 2 enemies, or last surviving enemy
 * sits within effective range for the character's Signature Active:
 * - *Shadow Barrage* / *Ten Thousand Swords*: mid-to-long fan range (`9.5–13` tiles).
 * - *Piercing Volley* (Archer): extended range (`11.5–14` tiles) matching fast long-range arrows.
 * - *Arcane Nova* (Mage): prefers targets inside the ~6-tile freezing AoE ring + outward bolts.
 */
export const smartActiveSkillPolicy: ActiveSkillPolicy = (
  world: ActiveSkillPolicyWorld,
): Vec2 | null => {
  if (world.activeState.cooldownRemainingMs > ACTIVE_SKILL_TUNING.bufferMs) {
    return null;
  }

  const living = world.enemies.filter((enemy) => enemy.health > 0 && enemy.action.kind !== 'dead');
  if (living.length === 0) return null;

  if (world.signatureSkillId === 'arcane-nova') {
    let bossInNova: EnemyState | null = null;
    let bossInBoltRange: EnemyState | null = null;
    let novaEnemy: EnemyState | null = null;
    let novaGap = Number.POSITIVE_INFINITY;
    let closePackCount = 0;
    let nearestTarget: EnemyState | null = null;
    let nearestGap = Number.POSITIVE_INFINITY;

    for (const enemy of living) {
      const gap = distance(world.player, enemy.position);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearestTarget = enemy;
      }
      if (enemy.id === BOSS_TARGET_ID) {
        if (gap <= 7.4) bossInNova = enemy;
        if (gap <= 11.5) bossInBoltRange = enemy;
      }
      if (gap <= 6.3 && gap < novaGap) {
        novaGap = gap;
        novaEnemy = enemy;
      }
      if (gap <= 7.5) {
        closePackCount += 1;
      }
    }

    const chosen =
      bossInNova ??
      novaEnemy ??
      bossInBoltRange ??
      (closePackCount >= 2 || (living.length === 1 && nearestGap <= 9.5) ? nearestTarget : null);
    if (chosen === null) return null;

    return unitVec(chosen.position.x - world.player.x, chosen.position.y - world.player.y);
  }

  const isPiercingVolley = world.signatureSkillId === 'piercing-volley';
  const bossRange = isPiercingVolley ? 14 : 13;
  const nearbyRange = isPiercingVolley ? 12.5 : 10.5;
  const priorityRange = isPiercingVolley ? 11.5 : 9.5;

  let bossTarget: EnemyState | null = null;
  let priorityTarget: EnemyState | null = null;
  let priorityGap = Number.POSITIVE_INFINITY;
  let nearestTarget: EnemyState | null = null;
  let nearestGap = Number.POSITIVE_INFINITY;
  let nearbyCount = 0;

  for (const enemy of living) {
    const gap = distance(world.player, enemy.position);
    if (enemy.id === BOSS_TARGET_ID && gap <= bossRange) {
      bossTarget = enemy;
    }
    if (gap <= nearbyRange) {
      nearbyCount += 1;
      if (gap < nearestGap) {
        nearestGap = gap;
        nearestTarget = enemy;
      }
      const highPriority =
        enemy.elite ||
        enemy.role === 'bomber' ||
        enemy.role === 'buffer' ||
        enemy.role === 'tank';
      if (highPriority && gap <= priorityRange && gap < priorityGap) {
        priorityGap = gap;
        priorityTarget = enemy;
      }
    }
  }

  const chosen =
    bossTarget ??
    priorityTarget ??
    (nearbyCount >= 2 || (living.length === 1 && nearestGap <= priorityRange)
      ? nearestTarget
      : null);
  if (chosen === null) return null;

  return unitVec(chosen.position.x - world.player.x, chosen.position.y - world.player.y);
};

/** Pick a valid index from `chooseSkill`, falling back to 0 on out-of-range indices. */
function pickSkillIndex(
  choose: SkillPickPolicy,
  offers: readonly SkillDef[],
  owned: ReadonlyMap<string, number>,
  level: number,
  context: SkillPickContext,
): number {
  if (offers.length <= 1) return 0;
  const index = choose(offers, owned, level, context);
  if (!Number.isInteger(index) || index < 0 || index >= offers.length) return 0;
  return index;
}

/** One screen of view centred on `centre`, clamped to the room — what the sim's player sees. */
function viewAroundPlayer(centre: Vec2, level: LevelData): ViewRect {
  return screenViewAround(centre, level.size);
}

/** The door the run takes; an out-of-range index or a missing policy falls back to the first. */
function chooseDoorFrom(
  choose: SimulationOptions['chooseDoor'],
  offers: readonly DoorReward[],
  room: number,
): DoorReward {
  const fallback = offers[0] ?? 'xp';
  if (offers.length <= 1) return fallback;
  const index = choose?.(offers, room) ?? 0;
  if (!Number.isInteger(index) || index < 0 || index >= offers.length) return fallback;
  return offers[index] ?? fallback;
}

/** Deterministic seed of one room's scheduler: the run seed mixed with chapter, room and index. */
function waveSeed(level: LevelData, seed: number, atRoomIndex: number): number {
  return (
    (Math.imul(seed | 0, 0x9e3779b1) ^
      Math.imul(level.chapter, 0x85ebca6b) ^
      Math.imul(level.room, 0xc2b2ae35) ^
      Math.imul(atRoomIndex + 7, 0x27d4eb2d)) >>>
    0
  );
}

/** One room's navigation, built at the configured rebuild throttle (`navigation.rebuildMinMs`). */
function createRoomNavigation(level: LevelData): RoomNavigation {
  return new RoomNavigation(level, ROOM_EDGE_MARGIN_TILES, NAVIGATION_TUNING.rebuildMinMs);
}

/** Push overlapping living enemies apart; writes the new positions back in place. */
function separateEnemiesForRoom(enemies: EnemyState[], level: LevelData): void {
  const bodies: SeparationBody[] = [];
  for (const enemy of enemies) {
    if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
    bodies.push({
      id: enemy.id,
      position: enemy.position,
      radiusTiles: DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role),
    });
  }

  const moved = separateEnemies(bodies, level, ROOM_EDGE_MARGIN_TILES);
  if (moved.size === 0) return;

  for (const enemy of enemies) {
    const position = moved.get(enemy.id);
    if (position !== undefined) enemy.position = position;
  }
}

function nearestAlive(from: Vec2, enemies: readonly EnemyState[]): Vec2 | null {
  let best: Vec2 | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
    const gap = distance(from, enemy.position);
    if (gap < bestGap) {
      best = enemy.position;
      bestGap = gap;
    }
  }
  return best;
}

function movePlayer(player: Vec2, input: MoveInput, speed: number, room: LevelData): Vec2 {
  const velocity = velocityFromInput(normalizeMoveInput(input), speed);
  const seconds = SIM_STEP_MS / 1000;
  return moveWithCollision(
    player,
    { x: velocity.x * seconds, y: velocity.y * seconds },
    PLAYER_RADIUS_TILES,
    room,
    ROOM_EDGE_MARGIN_TILES,
  );
}

/**
 * Adapt a run policy to the boss room (`PolicyWorld` → `BossRunWorld`).
 *
 * The boss room has no `EnemyState` list, so the boss and its summons are exposed in the same
 * shape a normal room exposes its enemies: position + health are real, `action` is `idle` (the
 * policy reads position/health). Everything else (`nowMs`, player, hearts, bullets) is the boss
 * room's own state, so a dodging policy dodges there too.
 */
function bossEnemiesView(world: {
  readonly nowMs: number;
  readonly boss: Vec2;
  readonly bossHealth: number;
  readonly summoned: readonly {
    readonly id: string;
    readonly role: EnemyRole;
    readonly position: Vec2;
    readonly health: number;
    readonly maxHealth: number;
  }[];
}): EnemyState[] {
  return [
    {
      id: BOSS_TARGET_ID,
      role: 'chaser',
      elite: false,
      position: world.boss,
      health: world.bossHealth,
      maxHealth: 1,
      action: { kind: 'idle' },
      actionStartedMs: world.nowMs,
    },
    ...world.summoned.map((summon) => ({
      id: summon.id,
      role: summon.role,
      elite: false,
      position: summon.position,
      health: summon.health,
      maxHealth: summon.maxHealth,
      action: { kind: 'idle' as const },
      actionStartedMs: world.nowMs,
    })),
  ];
}

function bossPolicyFor(policy: InputPolicy, bossRoom: LevelData): BossRunPolicy {
  return (world) =>
    policy({
      nowMs: world.nowMs,
      room: bossRoom.room,
      wave: 0,
      player: world.player,
      hearts: world.hearts,
      shieldCharges: 0,
      enemies: bossEnemiesView(world),
      bullets: world.bullets,
    });
}

function bossDashPolicyFor(policy: DashPolicy, bossRoom: LevelData): BossDashPolicy {
  return (world) =>
    policy({
      nowMs: world.nowMs,
      room: bossRoom.room,
      wave: 0,
      player: world.player,
      hearts: world.hearts,
      shieldCharges: 0,
      enemies: bossEnemiesView(world),
      bullets: world.bullets,
      moveDir: world.moveDir,
      dashState: world.dashState,
      pendingBlasts: [],
    });
}

function bossActivePolicyFor(policy: ActiveSkillPolicy, bossRoom: LevelData): BossActivePolicy {
  return (world) =>
    policy({
      nowMs: world.nowMs,
      room: bossRoom.room,
      wave: 0,
      player: world.player,
      hearts: world.hearts,
      shieldCharges: 0,
      enemies: bossEnemiesView(world),
      bullets: world.bullets,
      activeState: world.activeState,
      ...(world.signatureSkillId !== undefined ? { signatureSkillId: world.signatureSkillId } : {}),
    });
}

/** Move the enemy by the action just decided; `speedFactor` combines Freeze slow and Buffer haste. */
function advanceEnemy(
  enemy: EnemyState,
  action: EnemyAction,
  speedFactor: number,
  level: LevelData,
  field: FlowField,
  detour: Vec2 | null,
): void {
  const seconds = SIM_STEP_MS / 1000;
  const factor = Number.isFinite(speedFactor) ? Math.max(0, speedFactor) : 1;
  const radius = DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role);

  if (action.kind === 'charge') {
    const step = action.speedTilesPerSecond * factor * seconds;
    enemy.position = moveWithCollision(
      enemy.position,
      { x: action.direction.x * step, y: action.direction.y * step },
      radius,
      level,
      ROOM_EDGE_MARGIN_TILES,
    );
    return;
  }
  if (action.kind !== 'walk') return;

  // Same rule as the game adapter (`EnemyView.advance`): straight while the target is in
  // sight, the shared flow field around a wall, a stuck-guard detour when it wedges anyway.
  enemy.position = walkTowards({
    position: enemy.position,
    target: action.target,
    field,
    maxDistanceTiles: speedFor(enemy.role, enemy.elite) * factor * seconds,
    radiusTiles: radius,
    level,
    marginTiles: ROOM_EDGE_MARGIN_TILES,
    detour,
  });
}
