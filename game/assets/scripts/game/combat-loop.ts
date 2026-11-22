/**
 * Combat loop of one room: enemies + bullets + collisions + hitstop.
 *
 * Split from `bootstrap.ts` when M3 added caster bullets, brute charges, stagger and
 * hitstop: bootstrap owns run flow (chapter → room → wave → clear/loss), while this file
 * owns **one combat frame**. The frame order is unchanged and matches
 * `core/sim/run-simulation.ts`: player → enemy → bullets → collisions → contact damage.
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
import { firstHit, hitsCircle } from '../core/combat/bullets';
import { fireEnemyVolley, sniperShotPlan } from '../core/combat/enemy-fire';
import { segmentHitsCircle } from '../core/combat/hitbox';
import { HitstopClock } from '../core/combat/hitstop';
import {
  HOMING_TURN_RATE_RADIANS_PER_SECOND,
  damageAfterExecute,
  lifestealHeal,
  ricochetTarget,
  steerVelocity,
} from '../core/combat/shot-effects';
import { StatusEffects } from '../core/combat/status-effects';
import type { Targetable } from '../core/combat/targeting';
import { DEFAULT_COMBAT } from '../core/config';
import type { EnemyState } from '../core/enemies/behaviours';
import { ROOM_EDGE_MARGIN_TILES, maxHealthFor } from '../core/enemies/behaviours';
import { FEEL_TUNING, NAVIGATION_TUNING } from '../core/enemies/tuning';
import { eliteVolleyAngles } from '../core/enemies/elite';
import { splitOnDeath } from '../core/enemies/splitter';
import { RoomNavigation, separateEnemies, type SeparationBody } from '../core/enemies/navigation';
import type { ScreenShake } from '../core/feel/screen-shake';
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
import { screenViewAround } from '../core/view/view-rect';
import {
  effectsLayers,
  type EffectsMode,
} from '../core/vfx/weapon-vfx';
import { SpriteAnimator } from './anim/sprite-animator';
import { BossView } from './boss-view';
import type { BulletView } from './bullet-view';
import type { CoverBody } from './cover-view';
import { EnemyView } from './enemy-view';
import type { FxPool } from './fx/effect-pool';
import { ACTOR_FEET_OFFSET_TILES, ACTOR_SCALE } from './level-view';
import type { PlayerController } from './player-controller';
import { pointInCullRect, type CullRect } from './world-culler';
import { playSfx } from './audio/sfx';

/** `cc` is an any module: import names only work in value position. */
type Node = InstanceType<typeof CocosNodeValue>;

/** Player radius for enemy bullets / dashes, tiles — same convention as the sim. */
export const PLAYER_RADIUS_TILES = 0.25;

/** Impact colours (cached: a busy frame must not allocate a `Color` per hit). */
const HIT_TINT = new CocosColor(255, 236, 190, 255);
const CRIT_FLASH_TINT = new CocosColor(255, 255, 255, 255);
const EXECUTE_TINT = new CocosColor(255, 90, 90, 255);
const LIFESTEAL_TINT = new CocosColor(230, 60, 60, 255);
const POISON_TINT = new CocosColor(120, 240, 110, 255);
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
  private awaitingAdvance = false;
  private god = false;

  /** Debug stress: keep 24 enemies + 44 enemy bullets on screen to measure fps. */
  private stress = false;
  private stressIndex = 0;
  private debugSeq = 0;

  constructor(options: CombatLoopOptions) {
    this.player = options.player;
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
    this.awaitingAdvance = false;
    this.hitstop.reset();
    this.rewarded.clear();
    this.bossRewarded = false;
  }

  /**
   * Spawn the room's real boss. Call before `startWave` so boss telegraphs/bullets exist
   * from the room's first frame (bootstrap calls it from `enterRoom`).
   */
  spawnBoss(def: BossDef, start: Vec2): BossView {
    this.boss?.destroy();
    this.bossStatus.clear();
    this.bossRewarded = false;
    const boss = new BossView({
      def,
      start,
      actorLayer: this.actorLayer,
      bullets: this.player.bullets,
      rng: this.rng,
      onPhase: this.onBossPhase,
      onSummon: (role, count) => this.summon(role, count),
      ...(this.fx !== null ? { fx: this.fx } : {}),
    });
    this.boss = boss;
    return boss;
  }

  /** Summon adds in a ring around the boss; positions are decided by core/summon (deterministic). */
  private summon(role: EnemyRole, count: number): void {
    const boss = this.boss;
    if (boss === null) return;

    for (const enemy of summonedEnemies(boss.bossState, role, count, this.rng)) {
      const maxHealth = maxHealthFor(role, false, undefined, this.level.chapter);
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
  startWaves(seed: number, runSlot = 1): void {
    this.scheduler = null;
    this.pendingSpawns.length = 0;
    this.spawnedSequence = 0;
    this.awaitingAdvance = false;

    const level = this.level;
    if (!usesWaveScheduler(level)) {
      for (const state of level.waves.flatMap((_, wave) => spawnWave(level, wave))) {
        this.addEnemy(state);
      }
      return;
    }
    this.scheduler = new WaveScheduler(level, seed, runSlot);
  }

  /** One combat frame. `realDeltaMs` has already been capped by bootstrap. */
  update(realDeltaMs: number): CombatUpdateResult {
    const player = this.player;
    const level = this.level;

    if (this.awaitingAdvance || player.isDead) {
      return { frozen: false, playerDied: player.isDead, cleared: this.awaitingAdvance };
    }

    if (this.stress) this.topUpStress();

    const deltaMs = this.hitstop.step(realDeltaMs);
    if (deltaMs <= 0) {
      return { frozen: true, playerDied: false, cleared: false };
    }
    this.nowMs += deltaMs;

    const targets: Targetable[] = this.enemies
      .filter((enemy) => !enemy.isDead)
      .map((enemy) => ({ id: enemy.id, position: enemy.position, alive: true }));
    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      targets.push({ id: BOSS_TARGET_ID, position: boss.position, alive: true });
    }

    player.step(this.nowMs, deltaMs, targets, level);
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

    if (player.isDead) this.playerDied = true;

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
      const state = enemyStateFromSpawn(this.level, spawn, this.spawnedSequence, this.nowMs);
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

  /** Advance the boss pattern one frame + poison DoT (Freeze does not apply to bosses — see the M4 report). */
  private stepBoss(deltaMs: number, playerPosition: Vec2): void {
    const boss = this.boss;
    if (boss === null || boss.isDefeated) return;

    boss.step(this.nowMs, deltaMs, playerPosition);
    const poison = this.bossStatus.poisonDamage(this.nowMs, deltaMs);
    if (poison > 0) boss.takeDamage(poison, this.nowMs);

    // The boss body also deals damage while dashing — otherwise a Samurai charge would
    // pass through the player with nothing happening. i-frames stop multi-frame hits.
    if (
      boss.isCharging &&
      distance(boss.position, playerPosition) <= boss.hitboxRadiusTiles + PLAYER_RADIUS_TILES
    ) {
      const heartsBefore = this.player.hearts;
      this.damagePlayer(
        DEFAULT_COMBAT.contactDamage,
        boss.position,
        FEEL_TUNING.shake.bossCharge,
      );
      const thorns = this.player.derivedStats.thorns;
      if (thorns !== undefined && this.player.hearts < heartsBefore) {
        boss.takeDamage(thorns.damage, this.nowMs);
      }
    }
  }

  /**
   * Fire enemy bullets when an enemy releases an attack. Elite casters fire a 3-shot fan
   * (`eliteVolleyAngles`); a normal caster fires one straight shot.
   */
  private stepEnemies(deltaMs: number, view: ViewRect): void {
    const player = this.player;

    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;

      const step = enemy.step(this.nowMs, deltaMs, player.position, this.navigation, view);

      if (step.released === 'shot') {
        const role = enemy.role;
        if (role !== null) {
          // #42: the sniper fires a single fast, aimed bullet; everyone else keeps the volley rule.
          const plan = role === 'sniper' ? sniperShotPlan() : null;
          fireEnemyVolley({
            pool: player.bullets,
            from: enemy.position,
            to: player.position,
            damage: enemy.contactDamage,
            angles: plan !== null ? plan.angles : eliteVolleyAngles(role, enemy.isElite),
            ...(plan !== null ? { speedTilesPerSecond: plan.speedTilesPerSecond } : {}),
          });
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
        this.damagePlayer(enemy.contactDamage, sweep.to);
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
        this.damagePlayer(bullet.damage, bullet.position);
        continue;
      }

      let consumed = false;

      // Boss first (the main target in a boss room), then the mobs.
      const boss = this.boss;
      if (
        boss !== null &&
        !boss.isDefeated &&
        !bullet.hitIds.includes(BOSS_TARGET_ID) &&
        hitsCircle(area, { position: boss.position, radiusTiles: boss.hitboxRadiusTiles })
      ) {
        const damage = damageAfterExecute(
          stats,
          bullet.damage,
          boss.health / boss.maxHealth,
        );
        const crit = bullet.damage > stats.damage * 1.01;
        boss.takeDamage(damage, this.nowMs);
        this.reportDamage(damage, boss.position, crit);
        this.bossStatus.apply(stats, this.nowMs);
        playSfx('enemy-hit');
        const heartsBefore = player.hearts;
        const healed = player.heal(lifestealHeal(stats, damage)) - heartsBefore;
        bullet.hitIds.push(BOSS_TARGET_ID);
        this.spawnHitEffects({
          position: boss.position,
          crit,
          executeApplied: damage > bullet.damage + 1e-9,
          healed,
          // Bosses ignore Freeze/Poison, so their status FX never starts.
          poisonStarted: false,
        });
        this.explode(bullet, boss.position, null);
        this.hitstop.request(crit ? FEEL_TUNING.vfx.critHitstopMs : undefined);
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

        const damage = damageAfterExecute(stats, bullet.damage, victim.health / victim.maxHealth);
        const crit = bullet.damage > stats.damage * 1.01;
        victim.takeDamage(damage, bullet.position, this.nowMs);
        this.reportDamage(damage, victim.position, crit);
        const status = victim.applyStatus(stats, this.nowMs);
        playSfx('enemy-hit');
        const heartsBefore = player.hearts;
        const healed = player.heal(lifestealHeal(stats, damage)) - heartsBefore;
        bullet.hitIds.push(victim.id);
        this.spawnHitEffects({
          position: victim.position,
          crit,
          executeApplied: damage > bullet.damage + 1e-9,
          healed,
          poisonStarted: status.poisonStarted,
        });
        this.explode(bullet, victim.position, victim);
        this.hitstop.request(crit ? FEEL_TUNING.vfx.critHitstopMs : undefined);
        consumed = this.resolveBullet(bullet);
        if (consumed) break;
      }

      if (consumed) spent.add(bullet.id);
    }

    if (spent.size > 0) {
      pool.consumeWhere((bullet) => spent.has(bullet.id));
    }
  }

  /** AoE explosion around the hit point: extra damage to every other target in range. */
  private explode(
    bullet: { readonly explosiveRadiusTiles: number; readonly explosiveDamage: number; readonly hitIds: readonly string[] },
    center: Vec2,
    direct: EnemyView | null,
  ): void {
    if (bullet.explosiveRadiusTiles <= 0 || bullet.explosiveDamage <= 0) return;

    for (const enemy of this.enemies) {
      if (enemy.isDead || enemy === direct || bullet.hitIds.includes(enemy.id)) continue;
      if (distance(center, enemy.position) > bullet.explosiveRadiusTiles) continue;
      enemy.takeDamage(bullet.explosiveDamage, center, this.nowMs);
    }

    const boss = this.boss;
    if (
      boss !== null &&
      !boss.isDefeated &&
      !bullet.hitIds.includes(BOSS_TARGET_ID) &&
      distance(center, boss.position) <= bullet.explosiveRadiusTiles
    ) {
      boss.takeDamage(bullet.explosiveDamage, this.nowMs);
    }

    this.fx?.spawn('fx.explosion', center, {
      drawUnits: Math.max(1.2, bullet.explosiveRadiusTiles * 2),
      lifetimeMs: 820,
    });
    // The smoke ring belongs to the explosive impact, so it stays under Reduced like the
    // explosion itself (only the extra particles are dropped there).
    this.fx?.spawn('fx.smoke-circular', center, {
      drawUnits: Math.max(1.0, bullet.explosiveRadiusTiles * 1.6),
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
      this.damagePlayer(enemy.contactDamage, enemy.position);
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
  ): boolean {
    if (this.god) return false;
    const before = this.player.hearts;
    this.player.applyDamage(this.nowMs, amount, source);
    if (this.player.hearts >= before) return false;

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
      const role = enemy.role;
      if (role !== null) this.onKill(role, enemy.isElite, enemy.position);
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
      this.addEnemy(child);
      this.fx?.spawn('fx.smoke', child.position);
    }

    const boss = this.boss;
    if (boss !== null && boss.isDefeated && !this.bossRewarded) {
      this.bossRewarded = true;
      this.onBossKilled();
    }
  }

  /** Debug: spawn one enemy at a given position (defaults to near the room centre). */
  spawnDebug(role: EnemyRole, elite: boolean, at?: Vec2): string {
    const maxHealth = maxHealthFor(role, elite, undefined, this.level.chapter);
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
  }

  /** Clean nodes + state; called when leaving a run. */
  destroy(): void {
    this.clear();
    this.fx?.destroy();
    this.stress = false;
    this.awaitingAdvance = false;
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
