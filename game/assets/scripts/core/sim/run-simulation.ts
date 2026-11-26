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
import { aimDirection, casterShotPlan, sniperShotPlan } from '../combat/enemy-fire';
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
  DOORS_TUNING,
  NAVIGATION_TUNING,
  SPECIAL_ROOMS_TUNING,
} from '../enemies/tuning';
import { WaveScheduler, enemyStateFromSpawn, usesWaveScheduler } from '../enemies/wave-scheduler';
import { isWaveCleared, spawnWave } from '../enemies/waves';
import type { ChapterData, EnemyRole, LevelData } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
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
  healHearts,
  isSpecialDoor,
  type SpecialKind,
} from '../run/special-rooms';
import { computeDerivedStats } from '../skills/derived-stats';
import type { SkillDef } from '../skills/pool';
import { createSkillRollRng, rerollChoices, rollChoices } from '../skills/roll';
import { screenViewAround } from '../view/view-rect';
import { computeLevelUpKnockback, levelUpResumeIframeMs } from '../xp/level-up-wave';
import { canReroll, deductRerollCost, rerollCost } from '../xp/reroll';
import { XpTracker, xpDoorClearBonus, xpForKill } from '../xp/xp-curve';
import { XpOrbPool } from '../xp/xp-orbs';
import { BOSS_TARGET_ID, simulateBossRun, type BossRunPolicy } from './boss-run';
import type { ViewRect } from '../camera/follow-camera';

export const SIM_STEP_MS = 16;
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
  /** A full chapter; the run plays `drawRunRooms(level, seed)` (8 normal rooms + the boss). */
  readonly level: ChapterData;
  readonly policy: InputPolicy;
  /** Defaults to `SIM_DEFAULT_MAX_DURATION_MS`; when time runs out it returns `timeout`. */
  readonly maxDurationMs?: number;
  /** Test hook: the player takes no damage. */
  readonly godMode?: boolean;
  /** Test hook: start the run at this many hearts (defaults to the derived max). */
  readonly playerHearts?: number;
  /** Starting skills, `Map<skillId, stacks>` like the game's `RunState` (defaults to empty). */
  readonly skills?: ReadonlyMap<string, number>;
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
      /** Hearts after the room's effect (lets a test prove a heal's exact amount). */
      readonly hearts: number;
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

  const rng = new SeededRng(options.seed);
  /** Dedicated skill-roll RNG stream, strictly decoupled from combat RNG (ADR-021). */
  const skillRollRng = createSkillRollRng(options.seed);
  const ownedSkills = new Map<string, number>(options.skills ?? []);
  let stats = computeDerivedStats(ownedSkills);
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
  /** Status of each enemy, key = id (not stuffed into `EnemyState` to keep the shared schema). */
  const statuses = new Map<string, StatusEffects>();
  /** Active level-up radial knockback pushes per enemy id (M12, ADR-021). */
  const enemyKnockbacks = new Map<string, KnockbackState>();
  const events: SimulationEvent[] = [];
  /** Ids of bullets hit this frame; reused so each frame allocates nothing. */
  const spent = new Set<number>();
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
    buffTracker.clear();
    playerVelocity = { x: 0, y: 0 };
    spawnSeq = 0;
    enemyKnockbacks.clear();
    xpOrbs.clear();
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
  let status: SimulationStatus | null = null;

  const healPlayer = (amount: number): void => {
    if (amount > 0) health.heal(amount);
  };

  const isResumeInvulnerable = (): boolean => durationMs < levelUpInvulnerableUntilMs;

  const acquireSkill = (skill: SkillDef): void => {
    const prevMaxHearts = stats.maxHearts;
    const prevFireRate = stats.fireRatePerSecond;
    const prevShieldCharges = stats.shield?.charges ?? 0;
    const prevShieldCooldown = stats.shield?.cooldownMs ?? 0;

    const currentStacks = ownedSkills.get(skill.id) ?? 0;
    ownedSkills.set(skill.id, Math.min(skill.maxStacks, currentStacks + 1));
    stats = computeDerivedStats(ownedSkills);

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
      let offers = rollChoices({ rng: skillRollRng, owned: ownedSkills });
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
        offers = rerollChoices({ rng: skillRollRng, owned: ownedSkills, previous: offers });
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

  const damagePlayer = (amount: number): void => {
    if (options.godMode === true || isResumeInvulnerable()) return;
    if (shield.tryBlock(durationMs)) {
      events.push({ kind: 'shield-block', nowMs: durationMs, room: room.room });
      return;
    }
    const result = health.tryDamage(amount, durationMs);
    if (!result.applied) return;
    events.push({
      kind: 'player-hit',
      nowMs: durationMs,
      room: room.room,
      hearts: result.hearts,
      source: 'projectile',
    });
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

  const killEnemy = (enemy: EnemyState, atMs: number): void => {
    if (enemy.health <= 0 && enemy.action.kind === 'dead') return;
    enemy.health = 0;
    enemy.action = { kind: 'dead' };
    stuckGuard.forget(enemy.id);
    enemyKnockbacks.delete(enemy.id);
    buffTracker.forget(enemy.id);
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

    // #42: a splitter leaves 2–3 splitlings. They are appended after this frame's damage
    // loops, so the room only clears once they are dead too.
    if (enemy.role === 'splitter') {
      for (const child of splitOnDeath(enemy, room, atMs)) pendingSplits.push(child);
    }
  };

  const damageEnemy = (enemy: EnemyState, amount: number): number => {
    if (amount <= 0 || enemy.health <= 0) return 0;
    const dealt = Math.min(amount, enemy.health);
    enemy.health = Math.max(0, enemy.health - amount);
    if (enemy.health <= 0) killEnemy(enemy, durationMs);
    else enemy.action = staggerAfterHit(enemy.action, durationMs, DEFAULT_COMBAT.enemyStaggerMs);
    return dealt;
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
    });

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

    const intent = options.policy({
      nowMs: durationMs,
      room: room.room,
      wave: 0,
      player,
      hearts: health.current,
      shieldCharges: shield.charges,
      enemies,
      bullets: bullets.active(),
    });
    const prevPlayer = player;
    player = movePlayer(player, intent, stats.moveSpeedTilesPerSecond, room);
    const dtSec = SIM_STEP_MS / 1000;
    playerVelocity = {
      x: (player.x - prevPlayer.x) / dtSec,
      y: (player.y - prevPlayer.y) / dtSec,
    };

    if (pendingBlasts.length > 0) {
      const steppedBlasts = stepPendingBlasts(pendingBlasts, durationMs);
      pendingBlasts = steppedBlasts.remaining;
      for (const blast of steppedBlasts.triggered) {
        if (isInsideBomberBlast(blast.center, blast.radiusTiles, player, PLAYER_RADIUS_TILES)) {
          damagePlayer(blast.damage);
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
    const shot = autoFire.update({
      deltaMs: SIM_STEP_MS,
      origin: player,
      targets,
      rangeTiles: DEFAULT_COMBAT.targetingRangeTiles,
    });
    if (shot !== null) {
      firePlayerVolley({
        pool: bullets,
        stats,
        rng,
        origin: shot.origin,
        direction: shot.direction,
        speedTilesPerSecond: DEFAULT_COMBAT.projectileSpeedTilesPerSecond,
        radiusTiles: BULLET_RADIUS_TILES,
        ttlMs: PLAYER_BULLET_TTL_MS,
      });
    }

    // --- Enemy AI ---------------------------------------------------------
    for (const enemy of enemies) {
      if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;

      const statusEffects = statusOf(enemy);
      const slow = statusEffects.speedMultiplier(durationMs);
      const poison = statusEffects.poisonDamage(durationMs, SIM_STEP_MS);
      if (poison > 0) damageEnemy(enemy, poison);
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
      advanceEnemy(enemy, next, slow * haste, room, field, detour);

      const melee =
        enemy.role === 'chaser' ||
        enemy.role === 'tank' ||
        enemy.role === 'splitter' ||
        enemy.role === 'splitling';
      const contactRange = CONTACT_RANGE_TILES * visualScaleFor(enemy.role);
      if (melee && distance(enemy.position, player) <= contactRange) {
        if (options.godMode !== true && !isResumeInvulnerable()) {
          if (shield.tryBlock(durationMs)) {
            events.push({ kind: 'shield-block', nowMs: durationMs, room: room.room });
          } else {
            const result = health.tryDamage(
              contactDamageFor(enemy.role, enemy.elite, undefined, room.chapter),
              durationMs,
            );
            if (result.applied) {
              events.push({
                kind: 'player-hit',
                nowMs: durationMs,
                room: room.room,
                hearts: result.hearts,
                source: 'contact',
              });
              // Thorns: touching the player hurts the enemy (only when the blow really lands).
              if (stats.thorns !== undefined) {
                damageEnemy(enemy, stats.thorns.damage);
              }
            }
          }
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

        bullet.hitIds.push(enemy.id);
        const damage = damageAfterExecute(stats, bullet.damage, enemy.health / enemy.maxHealth);
        const dealt = damageEnemy(enemy, damage);
        healPlayer(lifestealHeal(stats, dealt));
        statusOf(enemy).apply(stats, durationMs);
        hitstopMs = Math.max(hitstopMs, DEFAULT_COMBAT.enemyHitstopMs);

        // Explosive: extra damage to other enemies in radius.
        if (bullet.explosiveRadiusTiles > 0 && bullet.explosiveDamage > 0) {
          for (const other of enemies) {
            if (other === enemy || other.health <= 0 || other.action.kind === 'dead') continue;
            if (distance(bullet.position, other.position) > bullet.explosiveRadiusTiles) continue;
            damageEnemy(other, bullet.explosiveDamage);
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
    if (spent.size > 0) bullets.consumeWhere((bullet) => spent.has(bullet.id));

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
      // M12 (ADR-021): full-room auto-vacuum collects every remaining XP orb on room clear.
      const vacuumStepSec = SIM_STEP_MS / 1000;
      for (let step = 0; step < 1000 && xpOrbs.size > 0; step += 1) {
        const vacuumedXp = xpOrbs.step(vacuumStepSec, player, true);
        if (vacuumedXp > 0) grantAndResolveXp(vacuumedXp);
      }
      xpOrbs.clear();

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
        Math.round(goldForRoomClear(room.isBossRoom) * stats.goldMultiplier) + goldBonus;
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
        // The special room takes slot `roomPosition + 1`: the drawn normal room there is not
        // played, and after the room the run continues to the next slot (the slot count and the
        // HUD's x/9 never change). The special slot still pays a room clear, like every slot.
        const specialSlot = roomPosition + 1;
        let bonusGold = 0;
        if (chosen === 'heal') {
          // `healHearts` returns the new TOTAL; `HealthState.heal` ADDS. Pass the difference
          // (same rule as the game's heal NPC) or the player would gain the total again.
          const healed = healHearts(
            health.current,
            stats.maxHearts,
            SPECIAL_ROOMS_TUNING.healHearts,
          );
          health.heal(healed - health.current);
        }
        if (chosen === 'chest') {
          const chest = chestReward(options.seed, specialSlot);
          if (chest.kind === 'gold') bonusGold = chest.amount;
        }
        const slotGold =
          Math.round(goldForRoomClear(false) * stats.goldMultiplier) + bonusGold;
        goldEarned += slotGold;
        roomsCleared += 1;
        events.push({
          kind: 'room-cleared',
          nowMs: durationMs,
          room: nextRoom.room,
          gold: slotGold,
        });
        events.push({
          kind: 'special',
          nowMs: durationMs,
          room: specialSlot,
          reward: chosen,
          hearts: health.current,
        });

        // One door out: the boss door when the special is the last normal slot, otherwise a
        // plain exit (its room keeps the default `xp` clear reward — there is no choice).
        const exitOffers: readonly DoorReward[] =
          specialSlot >= normalRoomCount ? ['boss'] : ['xp'];
        const exitChosen = exitOffers[0] ?? 'xp';
        events.push({
          kind: 'door',
          nowMs: durationMs,
          room: specialSlot,
          offers: exitOffers,
          chosen: exitChosen,
        });
        doorReward = exitChosen;

        // Skip the drawn room the special replaced; the next slot is the one after it.
        roomIndex += 2;
        const afterSpecial = runRooms[roomIndex];
        if (afterSpecial === undefined) {
          status = 'won';
          events.push({ kind: 'run-won', nowMs: durationMs });
          break;
        }
        room = afterSpecial;
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
    durationMs,
    events,
  };
}

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
function bossPolicyFor(policy: InputPolicy, bossRoom: LevelData): BossRunPolicy {
  return (world) =>
    policy({
      nowMs: world.nowMs,
      room: bossRoom.room,
      wave: 0,
      player: world.player,
      hearts: world.hearts,
      shieldCharges: 0,
      enemies: [
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
      ],
      bullets: world.bullets,
    });
}

/** Move the enemy by the action just decided; `slow` is the current Freeze factor. */
function advanceEnemy(
  enemy: EnemyState,
  action: EnemyAction,
  slow: number,
  level: LevelData,
  field: FlowField,
  detour: Vec2 | null,
): void {
  const seconds = SIM_STEP_MS / 1000;
  const factor = Math.max(0, Math.min(1, slow));
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
