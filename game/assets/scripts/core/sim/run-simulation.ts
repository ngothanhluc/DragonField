/**
 * Headless run simulation — no engine, no DOM, no `SaveStorage`.
 *
 * Wires the `core/` modules the game uses (`waves`, `behaviours`, `AutoFire`,
 * `BulletPool`, `HealthState`, `rewards`, `skills`, `boss`) into a 16 ms tick loop,
 * so integration tests catch balance regressions and win/lose flow without opening Cocos.
 *
 * This simulates **exactly the rules the game runs** (M4):
 *
 * - Fire rate/damage/projectile count/crit/pierce/ricochet/homing/explosion/freeze/poison/
 *   lifesteal/shield/thorns all come from `DerivedStats` and the core helpers that
 *   `game/` uses.
 * - Hitstop and stagger are simulated: a bullet hit freezes the simulation for 70 ms and
 *   staggers the enemy for 150 ms, without resetting cooldowns.
 * - An elite caster fires a 3-bullet volley, an elite chaser pounces, an elite tank charges twice; hitbox
 *   and contact range scale with the role silhouette.
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
  attackReleased,
  contactDamageFor,
  decideAction,
  speedFor,
  staggerAction,
  visualScaleFor,
  type EnemyAction,
  type EnemyState,
} from '../enemies/behaviours';
import { eliteVolleyAngles } from '../enemies/elite';
import { aimDirection, sniperShotPlan } from '../combat/enemy-fire';
import { splitOnDeath } from '../enemies/splitter';
import {
  RoomNavigation,
  StuckGuard,
  separateEnemies,
  walkTowards,
  type FlowField,
  type SeparationBody,
} from '../enemies/navigation';
import { DOORS_TUNING, NAVIGATION_TUNING, SPECIAL_ROOMS_TUNING } from '../enemies/tuning';
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
import { screenViewAround } from '../view/view-rect';
import { simulateBossRun } from './boss-run';
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
/** Enemy bullets are slow enough to dodge (GDD §4). */
const ENEMY_BULLET_SPEED_TILES_PER_SECOND = 4;
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
  /** Owned skills, `Map<skillId, stacks>` like the game's `RunState`. */
  readonly skills?: ReadonlyMap<string, number>;
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
  | (SimEventBase & { readonly kind: 'room-cleared'; readonly gold: number })
  | (SimEventBase & { readonly kind: 'boss-phase'; readonly phase: number })
  /** Doors offered after a normal room (#39); `room` is the cleared room position, 1-based. */
  | (SimEventBase & { readonly kind: 'door'; readonly offers: readonly DoorReward[]; readonly chosen: DoorReward })
  /** The clear reward of room `room`; `gold` is the door bonus paid for a `gold` reward, else 0. */
  | (SimEventBase & { readonly kind: 'reward'; readonly reward: DoorReward; readonly gold: number })
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
  const stats = computeDerivedStats(options.skills ?? new Map<string, number>());
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
  const shield = new ShieldCharger(
    stats.shield?.charges ?? 0,
    stats.shield?.cooldownMs ?? 0,
  );
  const autoFire = AutoFire.fromRate(stats.fireRatePerSecond);
  const bullets = new BulletPool();
  /** Status of each enemy, key = id (not stuffed into `EnemyState` to keep the shared schema). */
  const statuses = new Map<string, StatusEffects>();
  const events: SimulationEvent[] = [];
  /** Ids of bullets hit this frame; reused so each frame allocates nothing. */
  const spent = new Set<number>();
  let hitstopMs = 0;
  /** Splitlings born this frame; appended after the damage loops so we never mutate mid-iteration. */
  const pendingSplits: EnemyState[] = [];

  let roomIndex = 0;
  let room = firstRoom;
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

  /**
   * Enter a room's enemies. A normal room is empty and fills from the `WaveScheduler` over time
   * (8× the authored count under the alive cap); the boss room keeps its authored add list.
   */
  const enterRoomEnemies = (level: LevelData, atRoomIndex: number): EnemyState[] => {
    scheduler = null;
    pendingSpawns = [];
    spawnSeq = 0;
    if (!usesWaveScheduler(level)) {
      // One-screen room (boss arena, hand-built fixture): its authored list, all of it.
      return level.waves.flatMap((_, wave) => spawnWave(level, wave));
    }
    scheduler = new WaveScheduler(level, waveSeed(level, options.seed, atRoomIndex));
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

  enemies = enterRoomEnemies(room, 0);
  let player: Vec2 = { x: room.playerStart.x, y: room.playerStart.y };
  let durationMs = 0;
  let roomsCleared = 0;
  let kills = 0;
  let goldEarned = 0;
  let status: SimulationStatus | null = null;

  const healPlayer = (amount: number): void => {
    if (amount > 0) health.heal(amount);
  };

  const damagePlayer = (amount: number): void => {
    if (options.godMode === true) return;
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

    const dx = player.x - enemy.position.x;
    const dy = player.y - enemy.position.y;
    const length = Math.hypot(dx, dy);
    const baseAngle = length === 0 ? 0 : Math.atan2(dy, dx);
    const eliteAngles = eliteVolleyAngles(enemy.role, enemy.elite);
    const angles =
      enemy.elite && eliteAngles.length > 0
        ? eliteAngles
        : [(rng.next() * 2 - 1) * ENEMY_SHOT_SPREAD_RADIANS];

    for (const offset of angles) {
      const angle = baseAngle + offset;
      bullets.spawn({
        position: enemy.position,
        velocity: {
          x: Math.cos(angle) * ENEMY_BULLET_SPEED_TILES_PER_SECOND,
          y: Math.sin(angle) * ENEMY_BULLET_SPEED_TILES_PER_SECOND,
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
    else enemy.action = staggerAction(durationMs, DEFAULT_COMBAT.enemyStaggerMs);
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
      skills: options.skills,
      playerHearts: health.current,
      playerStart: bossRoom.playerStart,
      bossStart: bossRoom.bossStart,
    });

    for (const event of result.events) {
      if (event.kind === 'boss-phase') {
        events.push({
          kind: 'boss-phase',
          nowMs: durationMs + event.nowMs,
          room: bossRoom.room,
          phase: event.phase,
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
    player = movePlayer(player, intent, stats.moveSpeedTilesPerSecond, room);

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
      for (const spawn of spawns) {
        pendingSpawns.push({
          state: enemyStateFromSpawn(room, spawn, spawnSeq, durationMs),
          atMs: durationMs + spawn.telegraphMs,
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

      const before = enemy.action;
      const next = decideAction({ state: enemy, player, nowMs: durationMs, level: room, view });
      if (next.kind !== before.kind) enemy.actionStartedMs = durationMs;
      enemy.action = next;

      if (attackReleased(before, next) === 'shot') {
        fireCasterVolley(enemy);
      }

      // Walk on the shared flow field toward the player: straight while in sight, around the
      // wall otherwise. The stuck guard may override the direction for a short detour.
      const enemyRadius = DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role);
      const field = navigation.field(enemyRadius, player, durationMs);
      const detour = stuckGuard.update(
        enemy.id,
        enemy.position,
        next.kind === 'walk',
        durationMs,
        field,
        random,
      );
      advanceEnemy(enemy, next, slow, room, field, detour);

      const melee =
        enemy.role === 'chaser' ||
        enemy.role === 'tank' ||
        enemy.role === 'splitter' ||
        enemy.role === 'splitling';
      const contactRange = CONTACT_RANGE_TILES * visualScaleFor(enemy.role);
      if (melee && distance(enemy.position, player) <= contactRange) {
        if (options.godMode !== true) {
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
      // The room's clear reward comes from the door taken after the previous room (#39).
      const roomPosition = roomIndex + 1;
      const reward = clearRewardFor(roomPosition, doorReward);
      const goldBonus =
        reward === 'gold' ? Math.max(0, Math.round(DOORS_TUNING.goldBonus)) : 0;
      const roomGold =
        Math.round(goldForRoomClear(room.isBossRoom) * stats.goldMultiplier) + goldBonus;
      goldEarned += roomGold;
      roomsCleared += 1;
      events.push({ kind: 'room-cleared', nowMs: durationMs, room: room.room, gold: roomGold });
      events.push({ kind: 'reward', nowMs: durationMs, room: roomPosition, reward, gold: goldBonus });
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
        // plain exit (its room keeps the default `skill` clear reward — there is no choice).
        const exitOffers: readonly DoorReward[] =
          specialSlot >= normalRoomCount ? ['boss'] : ['skill'];
        const exitChosen = exitOffers[0] ?? 'skill';
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
        enemies = enterRoomEnemies(room, roomIndex);
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

    enemies = enterRoomEnemies(room, roomIndex);
    bullets.clear();
  }

  return { status: status ?? 'timeout', roomsCleared, kills, goldEarned, durationMs, events };
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
  const fallback = offers[0] ?? 'skill';
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
