/**
 * Simulate **one boss room** headless (GDD §5) — no engine, no DOM.
 *
 * The driver wires `core/boss/*` (`boss-defs`, `patterns.stepBoss`, `summon`) to
 * exactly the combat modules the game uses (`AutoFire`, `HealthState`,
 * `BulletPool`), so integration tests can prove: the boss runs its patterns, changes
 * phase at the right thresholds, summons enemies inside the room, and the same seed gives the same
 * result. **Regular room** balance is still measured by `run-simulation.ts`; this file only
 * handles the boss arena so the two do not have to share one file.
 *
 * Simulation contract:
 *
 * - **The boss is the only damage source.** Summoned enemies stand still
 *   (still auto-aim targets, still die when hit): their AI is
 *   `core/enemies/behaviours.ts` + the adapter, not wired into this driver yet — here we only
 *   need to prove the `summon` path runs and positions are valid.
 * - **No obstacles or walls.** The arena is an open field; bullets leaving the room
 *   are retired immediately. Arena pillars are a scene concern, not a boss balance
 *   test concern.
 * - **No module-level state, no `Math.random`, no `Date.now`.** Randomness only
 *   through `SeededRng` built from `seed`; `stepBoss` and `summonedEnemies`
 *   share that instance so the RNG stream is a single line.
 * - **Every boss event has a place in the log**: `shoot` spawns real bullets, `summon`
 *   spawns real enemies, while `move` / `telegraph` / `play-animation` are only recorded
 *   (the Cocos adapter is what plays animations and FX).
 * - `godMode` is a test hook: the player takes no damage.
 */
import { BOSSES, phaseFor, type BossId, type BossPhase } from '../boss/boss-defs';
import {
  bulletVelocity,
  initialBossState,
  isBossInIntro,
  stepBoss,
  type BossState,
  type BulletVerb,
} from '../boss/patterns';
import { summonedEnemies } from '../boss/summon';
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  type CharacterId,
} from '../characters/roster';
import { AutoFire } from '../combat/auto-fire';
import { BulletPool, hitsCircle, type Bullet } from '../combat/bullets';
import { PlayerHitHitstop } from '../combat/hit-hitstop';
import { HealthState } from '../combat/health';
import { accumulateDamage } from '../combat/integer-damage';
import { firePlayerVolley } from '../combat/player-fire';
import { ShieldCharger } from '../combat/shield';
import {
  HOMING_TURN_RATE_RADIANS_PER_SECOND,
  damageAfterExecute,
  lifestealHeal,
  ricochetTarget,
  steerVelocity,
} from '../combat/shot-effects';
import { StatusEffects } from '../combat/status-effects';
import type { Targetable } from '../combat/targeting';
import { DEFAULT_COMBAT } from '../config';
import { maxHealthFor } from '../enemies/behaviours';
import { DASH_TUNING, FEEL_TUNING } from '../enemies/tuning';
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
import { ROOM_COLS, ROOM_ROWS, type EnemyRole } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { applyCharacterBaseStats, applyCharacterPassive } from '../meta/run-stats';
import { normalizeMoveInput, velocityFromInput, type MoveInput } from '../movement/move-intent';
import { SeededRng } from '../rng';
import { computeDerivedStats, type DerivedStats } from '../skills/derived-stats';

/** Simulation step, ms. Matches `SIM_STEP_MS` of the run simulation so measurements compare. */
export const BOSS_RUN_STEP_MS = 16;

/** 3 minutes — far longer than a real boss fight, only to catch hangs. */
export const BOSS_RUN_DEFAULT_MAX_DURATION_MS = 180_000;

/** Id of the boss as auto-aim sees it; summoned enemies use their own ids from `summon.ts`. */
export const BOSS_TARGET_ID = 'boss';

/** Player collision radius, tiles — same convention as `run-simulation.ts`. */
const PLAYER_RADIUS_TILES = 0.25;
/** Player bullet radius, tiles. */
const PLAYER_BULLET_RADIUS_TILES = 0.15;
/**
 * Player bullets live 1.2 s = 14.4 tiles, longer than the auto-aim range
 * (`DEFAULT_COMBAT.targetingRangeTiles`) so a fired bullet does not expire mid-flight.
 */
const PLAYER_BULLET_TTL_MS = 1200;
/**
 * Boss bullets live 10 s: enough to cross the arena diagonal (≈37 tiles) at the slowest
 * pattern speed (4 tiles/s). Expiry retires them from the pool, no walls needed.
 */
const BOSS_BULLET_TTL_MS = 10_000;
/** Radius of a summoned enemy, tiles — same convention as `run-simulation.ts`. */
const SUMMONED_RADIUS_TILES = 0.4;
/** Keep half a tile off the wall, like enemies, so the player never sticks to the room edge. */
const PLAYER_EDGE_MARGIN_TILES = 0.5;
/**
 * Distance the player tries to keep from the boss in the default policy, tiles: inside the 2-tile
 * auto-aim range so the boss does not fall out of range while retreating and firing.
 */
export const BOSS_COMFORT_RANGE_TILES = Math.max(1, DEFAULT_COMBAT.targetingRangeTiles - 2);

/** Player stands at bottom centre; the boss at top centre (11 tiles apart). */
export const DEFAULT_PLAYER_START: Vec2 = { x: ROOM_COLS / 2, y: ROOM_ROWS - 2 };
export const DEFAULT_BOSS_START: Vec2 = { x: ROOM_COLS / 2, y: 5 };

/**
 * Boss **hitbox** radius from `BossDef.hitboxRadiusTiles` (single source,
 * with a table derived from sprite size). Read once per run.
 */

export type BossRunOutcome = 'won' | 'lost' | 'timeout';

/** Enemies summoned by the boss, in the form the policy sees (read only). */
export interface BossSummonView {
  readonly id: string;
  readonly role: EnemyRole;
  readonly position: Vec2;
  readonly health: number;
  readonly maxHealth: number;
}

/** The world a policy reads. Read only, never modified. */
export interface BossRunWorld {
  readonly nowMs: number;
  readonly player: Vec2;
  readonly boss: Vec2;
  readonly bossHealth: number;
  readonly hearts: number;
  readonly bullets: readonly Bullet[];
  readonly summoned: readonly BossSummonView[];
}

/** Scripted input: a pure function of the world returning this frame's WASD keys. */
export type BossRunPolicy = (world: BossRunWorld) => MoveInput;

/** Boss arena world snapshot passed to an optional Dash policy (M13, ADR-022). */
export interface BossDashWorld extends BossRunWorld {
  readonly moveDir: Vec2;
  readonly dashState: DashState;
}

/** Boss arena world snapshot passed to an optional Signature Active policy (M13/M14, ADR-022). */
export interface BossActiveWorld extends BossRunWorld {
  readonly activeState: ActiveSkillState;
  readonly signatureSkillId?: SignatureSkillId;
}

/** Optional Dash (`Space`) policy for boss arenas: return a direction to press Dash, or `null`. */
export type BossDashPolicy = (world: BossDashWorld) => Vec2 | null;

/** Optional Signature Active (`E`) policy for boss arenas: return an aim vector to cast, or `null`. */
export type BossActivePolicy = (world: BossActiveWorld) => Vec2 | null;

/**
 * Event log of one boss room. Every `BossEvent` from `stepBoss` appears
 * here; `shoot`/`summon` add the real result (bullet count, enemies spawned) so tests
 * can cross-check without re-running the pattern themselves.
 */
export type BossRunEvent =
  | { readonly kind: 'boss-shoot'; readonly nowMs: number; readonly bullets: number }
  | {
      readonly kind: 'boss-summon';
      readonly nowMs: number;
      readonly phase: BossPhase;
      readonly enemyId: string;
      readonly role: EnemyRole;
      readonly at: Vec2;
    }
  | { readonly kind: 'boss-summoned-killed'; readonly nowMs: number; readonly enemyId: string }
  | {
      readonly kind: 'boss-move';
      readonly nowMs: number;
      readonly to: Vec2;
      readonly speedTilesPerSecond: number;
    }
  | {
      readonly kind: 'boss-telegraph';
      readonly nowMs: number;
      readonly durationMs: number;
      readonly at: Vec2;
    }
  | { readonly kind: 'boss-animation'; readonly nowMs: number; readonly animation: string }
  | { readonly kind: 'boss-phase'; readonly nowMs: number; readonly phase: BossPhase }
  | { readonly kind: 'boss-hit'; readonly nowMs: number; readonly health: number }
  | { readonly kind: 'boss-defeated'; readonly nowMs: number }
  | { readonly kind: 'player-shot'; readonly nowMs: number; readonly damage: number }
  | {
      readonly kind: 'player-hit';
      readonly nowMs: number;
      readonly hearts: number;
      readonly source: 'projectile' | 'contact';
    }
  | { readonly kind: 'shield-block'; readonly nowMs: number }
  | { readonly kind: 'ward-block'; readonly nowMs: number }
  | { readonly kind: 'dash'; readonly nowMs: number; readonly direction: Vec2 }
  | {
      readonly kind: 'active-skill';
      readonly nowMs: number;
      readonly skillId: SignatureSkillId;
      readonly projectiles: number;
      readonly novaHits?: number;
      readonly hideAttachmentMs?: number;
    }
  | { readonly kind: 'player-dead'; readonly nowMs: number };

export interface BossRunOptions {
  readonly bossId: BossId;
  readonly seed: number;
  /** Playable character class (M14, defaults to `'ninja'`). */
  readonly characterId?: CharacterId;
  /** Defaults to `BOSS_RUN_DEFAULT_MAX_DURATION_MS`; when time runs out it returns `timeout`. */
  readonly maxDurationMs?: number;
  /** Test hook: the player takes no damage. */
  readonly godMode?: boolean;
  /**
   * Damage per player bullet. `0` = zero-DPS (used to measure boss pressure without
   * killing it). Defaults to the character's derived shot damage.
   */
  readonly playerDamagePerShot?: number;
  /** Run skills (`Map<id, stacks>`) — the sim must mirror the game. */
  readonly skills?: ReadonlyMap<string, number>;
  /** Start in a phase (the "every phase forces movement" test). 1 = full health. */
  readonly bossHealthFraction?: number;
  /** Test hook: player health above 6 to measure several phases in one run. */
  readonly playerMaxHearts?: number;
  /** Incoming health (the chapter sim chains the boss room); defaults to full health. */
  readonly playerHearts?: number;
  /** Defaults to `approachBoss`: stay on the boss to keep auto-aim range. */
  readonly policy?: BossRunPolicy;
  /** Optional Dash policy (M13, ADR-022). Omitted = never dashes. */
  readonly chooseDash?: BossDashPolicy;
  /** Optional Signature Active policy (M13/M14, ADR-022). Omitted = never casts. */
  readonly chooseActive?: BossActivePolicy;
  /** Optional carry-over Signature Active state from previous rooms. */
  readonly initialActiveState?: ActiveSkillState;
  readonly playerStart?: Vec2;
  readonly bossStart?: Vec2;
  /**
   * Simulation clock when entering the boss room (default 0). `simulateRun` passes the
   * accumulated chapter duration (~300 s) so the real non-zero `nowMs` entry path is exercised.
   */
  readonly startNowMs?: number;
  /** Override boss intro grace window (defaults to `BOSS_TUNING.introGraceMs`). */
  readonly introGraceMs?: number;
}

export interface BossRunResult {
  readonly outcome: BossRunOutcome;
  readonly bossHealth: number;
  readonly playerHearts: number;
  /** Phases entered, in order — `[2, 3]` means all 3 phases were seen. */
  readonly phaseChanges: readonly BossPhase[];
  readonly events: readonly BossRunEvent[];
  readonly durationMs: number;
  /** Total Dash activations performed in the boss room (M13, ADR-022). */
  readonly dashesUsed: number;
  /** Total Signature Active (*Shadow Barrage*) casts performed in the boss room (M13, ADR-022). */
  readonly activeSkillsUsed: number;
}

const NO_INPUT: MoveInput = { up: false, down: false, left: false, right: false };

/** "Stand still" policy: used when a test needs the player to get hit instead of dodging. */
export const holdPosition: BossRunPolicy = () => NO_INPUT;

/**
 * Default policy: walk toward the boss when farther than `BOSS_COMFORT_RANGE_TILES`,
 * stay still when close enough. That keeps the boss inside auto-aim range even after a
 * teleport, without needing to know how to dodge — dodging is for a policy passed by the test.
 */
export const approachBoss: BossRunPolicy = (world) => {
  if (distance(world.player, world.boss) <= BOSS_COMFORT_RANGE_TILES) return NO_INPUT;

  const dx = world.boss.x - world.player.x;
  const dy = world.boss.y - world.player.y;
  return moveInputToward(dx, dy);
};

/**
 * Turn a direction vector (tile units) into WASD keys.
 *
 * Sign convention taken from `normalizeMoveInput`: `right` = +x, **`up` = +y** — i.e.
 * inverted from the tile data's y-pointing-down axis, and the Cocos adapter handles the
 * flip. So to go "up" in tile data (decreasing y) you must press `down`.
 */
function moveInputToward(dx: number, dy: number): MoveInput {
  return { up: dy > 0, down: dy < 0, left: dx < 0, right: dx > 0 };
}

/** Internal state of a summoned enemy: position + health only, no AI. */
interface SummonedState {
  readonly id: string;
  readonly role: EnemyRole;
  readonly position: Vec2;
  health: number;
  readonly maxHealth: number;
}

/** Run one boss room headless. Pure: no state read/written outside the parameters. */
export function simulateBossRun(options: BossRunOptions): BossRunResult {
  const maxDurationMs = options.maxDurationMs ?? BOSS_RUN_DEFAULT_MAX_DURATION_MS;
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new Error(`simulateBossRun needs a finite maxDurationMs > 0, got ${maxDurationMs}`);
  }

  const characterId = options.characterId ?? DEFAULT_CHARACTER_ID;
  const characterDef = CHARACTERS[characterId];
  const signatureSkillId = characterDef.signatureSkillId;
  const activeConfig = activeSkillConfigFor(signatureSkillId);
  const characterBase = applyCharacterPassive(
    applyCharacterBaseStats(DEFAULT_COMBAT, characterId),
    characterId,
  );
  const baseStats = computeDerivedStats(options.skills ?? new Map<string, number>(), characterBase);
  const damagePerShot = options.playerDamagePerShot ?? baseStats.damage;
  if (!Number.isFinite(damagePerShot) || damagePerShot < 0) {
    throw new Error(
      `simulateBossRun needs a finite playerDamagePerShot >= 0, got ${damagePerShot}`,
    );
  }
  const stats: DerivedStats = { ...baseStats, damage: damagePerShot };
  const bulletTtlMs = Math.max(
    PLAYER_BULLET_TTL_MS,
    stats.projectileSpeedTilesPerSecond > 0
      ? Math.ceil((stats.targetingRangeTiles / stats.projectileSpeedTilesPerSecond) * 1000 * 1.5)
      : PLAYER_BULLET_TTL_MS,
  );
  const maxHearts = Math.max(baseStats.maxHearts, options.playerMaxHearts ?? 0);

  const rng = new SeededRng(options.seed);
  const health = new HealthState(
    {
      playerMaxHearts: maxHearts,
      invulnerabilityMs: baseStats.invulnerabilityMs,
    },
    Math.min(options.playerHearts ?? maxHearts, maxHearts),
  );
  const autoFire = AutoFire.fromRate(stats.fireRatePerSecond);
  const shield = new ShieldCharger(stats.shield?.charges ?? 0, stats.shield?.cooldownMs ?? 0);
  const actionBuffer = new ActionBuffer(DASH_TUNING.bufferMs);
  let dashState = createDashState();
  let activeState =
    options.initialActiveState ?? createActiveSkillState(true, activeConfig.cooldownMs);
  let bufferedDashDir: Vec2 = { x: 0, y: 1 };
  let bufferedActiveDir: Vec2 = { x: 1, y: 0 };
  let postDashFireUntilMs = Number.NEGATIVE_INFINITY;
  let dashesUsed = 0;
  let activeSkillsUsed = 0;
  const bullets = new BulletPool();
  const bossStatus = new StatusEffects();
  let bossBurnDps = 0;
  let bossBurnUntilMs = Number.NEGATIVE_INFINITY;
  const summonStatuses = new Map<string, StatusEffects>();
  const summonBurns = new Map<string, { dps: number; untilMs: number }>();
  const events: BossRunEvent[] = [];
  const phaseChanges: BossPhase[] = [];
  /** Ids of bullets hit this frame; reused so each frame allocates nothing. */
  const spent = new Set<number>();
  /** Ids of Signature Active projectiles so Shadow Barrage does not self-refund its own cooldown. */
  const activeBulletIds = new Set<number>();
  /** Cast id + base damage of each Signature projectile, so a volley stops once (#108). */
  const activeBulletSignature = new Map<number, { castId: number; baseDamage: number }>();
  const hitstopGate = new PlayerHitHitstop({
    normalMs: DEFAULT_COMBAT.enemyHitstopMs,
    critMs: FEEL_TUNING.vfx.critHitstopMs,
  });
  let signatureCastCount = 0;
  /** Hitstop a player hit asks for: one beat per Signature cast, every hit for auto-fire (#108). */
  const punchHitstop = (bullet: Bullet): number => {
    const signature = activeBulletSignature.get(bullet.id);
    return hitstopGate.hitstopFor({
      damage: bullet.damage,
      baseDamage: signature?.baseDamage ?? stats.damage,
      signatureCastId: signature?.castId ?? null,
    });
  };
  let hitstopMs = 0;

  const hitboxRadius = BOSSES[options.bossId].hitboxRadiusTiles;
  const policy = options.policy ?? approachBoss;
  const fraction = Math.min(1, Math.max(0, options.bossHealthFraction ?? 1));

  const startNowMs = options.startNowMs ?? 0;
  let boss: BossState = initialBossState(
    options.bossId,
    options.bossStart ?? DEFAULT_BOSS_START,
    startNowMs,
    options.introGraceMs,
  );
  if (fraction < 1) {
    boss = {
      ...boss,
      health: Math.round(BOSSES[options.bossId].maxHealth * fraction),
      phase: phaseFor(options.bossId, fraction),
    };
  }
  let bossDamageCarry = 0;
  let player: Vec2 = { ...(options.playerStart ?? DEFAULT_PLAYER_START) };
  const summoned: SummonedState[] = [];
  let durationMs = 0;
  let outcome: BossRunOutcome | null = null;

  const applyBossBurn = (atMs: number): void => {
    const burn = stats.burnOnHit;
    if (burn === undefined || !(burn.dps > 0) || !(burn.durationMs > 0)) return;
    bossBurnDps = Math.max(bossBurnDps, burn.dps);
    bossBurnUntilMs = Math.max(bossBurnUntilMs, atMs + burn.durationMs);
  };

  const isBossBurning = (atMs: number): boolean => bossBurnDps > 0 && atMs < bossBurnUntilMs - 1e-6;

  const bossBurnDamage = (atMs: number, deltaMs: number): number => {
    if (!(deltaMs > 0) || bossBurnDps <= 0) return 0;
    const activeMs = Math.max(0, Math.min(atMs + deltaMs, bossBurnUntilMs) - atMs);
    return (bossBurnDps * activeMs) / 1000;
  };

  const isBossAfflicted = (atMs: number): boolean =>
    bossStatus.isSlowed(atMs) || bossStatus.isPoisoned(atMs) || isBossBurning(atMs);

  const summonStatusOf = (id: string): StatusEffects => {
    let entry = summonStatuses.get(id);
    if (entry === undefined) {
      entry = new StatusEffects();
      summonStatuses.set(id, entry);
    }
    return entry;
  };

  const applySummonBurn = (id: string, atMs: number): void => {
    const burn = stats.burnOnHit;
    if (burn === undefined || !(burn.dps > 0) || !(burn.durationMs > 0)) return;
    const prev = summonBurns.get(id);
    if (prev === undefined) {
      summonBurns.set(id, { dps: burn.dps, untilMs: atMs + burn.durationMs });
      return;
    }
    prev.dps = Math.max(prev.dps, burn.dps);
    prev.untilMs = Math.max(prev.untilMs, atMs + burn.durationMs);
  };

  const isSummonAfflicted = (id: string, atMs: number): boolean => {
    const status = summonStatuses.get(id);
    if (status !== undefined && (status.isSlowed(atMs) || status.isPoisoned(atMs))) return true;
    const burn = summonBurns.get(id);
    return burn !== undefined && burn.dps > 0 && atMs < burn.untilMs - 1e-6;
  };

  const damageBoss = (amount: number): void => {
    if (amount <= 0 || boss.health <= 0) return;
    // Boss health stays integral: fractional poison/crit/execute accumulates through `carry`.
    const step = accumulateDamage(bossDamageCarry, amount);
    bossDamageCarry = step.carry;
    if (step.whole <= 0) return;

    boss = { ...boss, health: Math.max(0, boss.health - step.whole) };
    events.push({ kind: 'boss-hit', nowMs: durationMs, health: boss.health });
  };

  const damageSummon = (victim: SummonedState, amount: number): number => {
    if (amount <= 0 || victim.health <= 0) return 0;
    const dealt = Math.min(amount, victim.health);
    victim.health = Math.max(0, victim.health - amount);
    if (victim.health <= 0) {
      summonStatuses.delete(victim.id);
      summonBurns.delete(victim.id);
      activeState = onActiveKill(activeState, activeConfig, 1);
      events.push({ kind: 'boss-summoned-killed', nowMs: durationMs, enemyId: victim.id });
    }
    return dealt;
  };

  const applyShockArcs = (sourceId: string, sourcePos: Vec2, baseDamage: number): void => {
    const shock = stats.shockOnHit;
    if (shock === undefined || shock.arcs <= 0 || !(shock.damageRatio > 0) || !(baseDamage > 0)) {
      return;
    }
    const arcDamage = baseDamage * shock.damageRatio;
    const candidates: Array<{ id: string; gap: number; summon?: SummonedState }> = [];
    if (sourceId !== BOSS_TARGET_ID && boss.health > 0) {
      const gap = distance(sourcePos, boss.position);
      if (gap <= shock.rangeTiles) candidates.push({ id: BOSS_TARGET_ID, gap });
    }
    for (const enemy of summoned) {
      if (enemy.health <= 0 || enemy.id === sourceId) continue;
      const gap = distance(sourcePos, enemy.position);
      if (gap <= shock.rangeTiles) candidates.push({ id: enemy.id, gap, summon: enemy });
    }
    candidates.sort((a, b) => a.gap - b.gap || a.id.localeCompare(b.id));
    for (let i = 0; i < Math.min(shock.arcs, candidates.length); i += 1) {
      const target = candidates[i];
      if (target === undefined) continue;
      if (target.summon === undefined) {
        const before = boss.health;
        damageBoss(arcDamage);
        healPlayer(lifestealHeal(stats, Math.min(arcDamage, before)));
      } else {
        const dealt = damageSummon(target.summon, arcDamage);
        healPlayer(lifestealHeal(stats, dealt));
      }
    }
  };

  const damagePlayer = (
    amount: number,
    nowMs: number,
    source: 'projectile' | 'contact' = 'projectile',
  ): void => {
    if (options.godMode === true || isDashInvulnerable(dashState)) return;
    if (health.isInvulnerable(nowMs)) return;
    if (shield.tryBlock(nowMs)) {
      events.push({ kind: 'shield-block', nowMs: durationMs });
      return;
    }
    if (stats.damageReductionChance > 0 && rng.next() < stats.damageReductionChance) {
      health.grantInvulnerability(nowMs, stats.invulnerabilityMs);
      events.push({ kind: 'ward-block', nowMs: durationMs });
      return;
    }
    const result = health.tryDamage(amount, nowMs);
    if (!result.applied) return;
    events.push({
      kind: 'player-hit',
      nowMs: durationMs,
      hearts: result.hearts,
      source,
    });
    if (source === 'contact' && stats.thorns !== undefined && boss.health > 0) {
      damageBoss(stats.thorns.damage);
    }
  };

  const healPlayer = (amount: number): void => {
    if (amount > 0) health.heal(amount);
  };

  while (durationMs < maxDurationMs && outcome === null) {
    durationMs += BOSS_RUN_STEP_MS;
    const nowMs = startNowMs + durationMs;
    shield.update(nowMs);

    // Hitstop: real time passes but the simulation stands still, exactly like the game's `HitstopClock`.
    if (hitstopMs > 0) {
      hitstopMs -= BOSS_RUN_STEP_MS;
      continue;
    }

    dashState = stepDash(dashState, BOSS_RUN_STEP_MS);
    activeState = stepActiveSkill(activeState, BOSS_RUN_STEP_MS);
    actionBuffer.step(BOSS_RUN_STEP_MS);

    // --- Player: move / dash by policy, then Signature Active + auto-fire ---
    const worldSnapshot: BossRunWorld = {
      nowMs,
      player,
      boss: boss.position,
      bossHealth: boss.health,
      hearts: health.current,
      bullets: bullets.active(),
      summoned,
    };
    const moveIntent = policy(worldSnapshot);
    const moveDir = normalizeMoveInput(moveIntent);

    if (options.chooseDash !== undefined) {
      const requestedDash = options.chooseDash({ ...worldSnapshot, moveDir, dashState });
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
        events.push({ kind: 'dash', nowMs: durationMs, direction: dashState.direction });
        if (stats.postDashFireRate !== undefined) {
          postDashFireUntilMs = Math.max(
            postDashFireUntilMs,
            nowMs + stats.postDashFireRate.durationMs,
          );
        }
        if (stats.dashNova !== undefined) {
          const novaRadius = stats.dashNova.radiusTiles * stats.aoePowerMult;
          const novaDamage = stats.dashNova.damage * stats.aoePowerMult;
          if (boss.health > 0 && distance(player, boss.position) <= novaRadius + hitboxRadius) {
            const before = boss.health;
            damageBoss(novaDamage);
            bossStatus.apply(stats, nowMs);
            applyBossBurn(nowMs);
            healPlayer(lifestealHeal(stats, Math.min(novaDamage, before)));
            activeState = onActiveHit(activeState, activeConfig, 1);
          }
          for (const enemy of summoned) {
            if (enemy.health <= 0) continue;
            if (distance(player, enemy.position) <= novaRadius + SUMMONED_RADIUS_TILES) {
              const dealt = damageSummon(enemy, novaDamage);
              summonStatusOf(enemy.id).apply(stats, nowMs);
              applySummonBurn(enemy.id, nowMs);
              healPlayer(lifestealHeal(stats, dealt));
              activeState = onActiveHit(activeState, activeConfig, 1);
            }
          }
        }
      }
    }

    if (isDashing(dashState)) {
      const vel = dashVelocity(dashState, stats.dashSpeedMult);
      const seconds = BOSS_RUN_STEP_MS / 1000;
      const maxX = ROOM_COLS - PLAYER_EDGE_MARGIN_TILES;
      const maxY = ROOM_ROWS - PLAYER_EDGE_MARGIN_TILES;
      player = {
        x: clamp(player.x + vel.x * seconds, PLAYER_EDGE_MARGIN_TILES, maxX),
        y: clamp(player.y + vel.y * seconds, PLAYER_EDGE_MARGIN_TILES, maxY),
      };
    } else {
      player = movePlayer(player, moveIntent, stats.moveSpeedTilesPerSecond);
    }

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
        signatureCastCount += 1;

        if (signatureSkillId === 'arcane-nova') {
          const nova = computeArcaneNovaSpec(player, stats.activePowerMult, {
            baseDamage: stats.damage,
            aoePowerMult: stats.aoePowerMult,
          });
          let novaHits = 0;
          if (boss.health > 0 && distance(nova.origin, boss.position) <= nova.radiusTiles + hitboxRadius) {
            const before = boss.health;
            let novaDmg = damageAfterExecute(
              stats,
              nova.damage,
              before / BOSSES[options.bossId].maxHealth,
            );
            if (stats.statusDamageBonus > 0 && isBossAfflicted(nowMs)) {
              novaDmg *= 1 + stats.statusDamageBonus;
            }
            damageBoss(novaDmg);
            bossStatus.apply(stats, nowMs);
            bossStatus.applySlow(
              { factor: nova.slowFactor, durationMs: nova.slowDurationMs },
              nowMs,
            );
            applyBossBurn(nowMs);
            healPlayer(lifestealHeal(stats, Math.min(novaDmg, before)));
            novaHits += 1;
          }
          for (const enemy of summoned) {
            if (enemy.health <= 0) continue;
            if (distance(nova.origin, enemy.position) <= nova.radiusTiles + SUMMONED_RADIUS_TILES) {
              let novaDmg = damageAfterExecute(
                stats,
                nova.damage,
                enemy.health / enemy.maxHealth,
              );
              if (stats.statusDamageBonus > 0 && isSummonAfflicted(enemy.id, nowMs)) {
                novaDmg *= 1 + stats.statusDamageBonus;
              }
              const dealt = damageSummon(enemy, novaDmg);
              if (enemy.health > 0) {
                const status = summonStatusOf(enemy.id);
                status.apply(stats, nowMs);
                status.applySlow(
                  { factor: nova.slowFactor, durationMs: nova.slowDurationMs },
                  nowMs,
                );
                applySummonBurn(enemy.id, nowMs);
              }
              healPlayer(lifestealHeal(stats, dealt));
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
            activeBulletSignature.set(spawned.id, {
              castId: signatureCastCount,
              baseDamage: spawned.damage,
            });
          }
          events.push({
            kind: 'active-skill',
            nowMs: durationMs,
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
            activeBulletSignature.set(spawned.id, {
              castId: signatureCastCount,
              baseDamage: spawned.damage,
            });
          }
          events.push({
            kind: 'active-skill',
            nowMs: durationMs,
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
            activeBulletSignature.set(spawned.id, {
              castId: signatureCastCount,
              baseDamage: spawned.damage,
            });
          }
          events.push({
            kind: 'active-skill',
            nowMs: durationMs,
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
            activeBulletSignature.set(spawned.id, {
              castId: signatureCastCount,
              baseDamage: spawned.damage,
            });
          }
          events.push({
            kind: 'active-skill',
            nowMs: durationMs,
            skillId: 'shadow-barrage',
            projectiles: volley.length,
          });
        }
      }
    }

    const targets: Targetable[] = [
      { id: BOSS_TARGET_ID, position: boss.position, alive: boss.health > 0 },
    ];
    for (const enemy of summoned) {
      if (enemy.health <= 0) continue;
      targets.push({ id: enemy.id, position: enemy.position, alive: true });
    }

    const fireDeltaMs =
      stats.postDashFireRate !== undefined && nowMs < postDashFireUntilMs
        ? BOSS_RUN_STEP_MS * (1 + stats.postDashFireRate.bonus)
        : BOSS_RUN_STEP_MS;
    const shot = autoFire.update({
      deltaMs: fireDeltaMs,
      origin: player,
      targets,
      rangeTiles: stats.targetingRangeTiles,
    });
    if (shot !== null) {
      firePlayerVolley({
        pool: bullets,
        stats,
        rng,
        origin: shot.origin,
        direction: shot.direction,
        speedTilesPerSecond: stats.projectileSpeedTilesPerSecond,
        radiusTiles: PLAYER_BULLET_RADIUS_TILES,
        ttlMs: bulletTtlMs,
      });
      events.push({ kind: 'player-shot', nowMs: durationMs, damage: stats.damage });
    }

    // --- Boss: pattern ---------------------------------------------------
    const stepped = stepBoss({
      state: boss,
      nowMs,
      deltaMs: BOSS_RUN_STEP_MS,
      player,
      rng,
    });
    boss = stepped.state;

    // The boss body deals contact damage while charging (see `combat-loop.ts`).
    if (
      !isBossInIntro(boss, nowMs) &&
      boss.chargeDirection !== null &&
      boss.health > 0 &&
      distance(boss.position, player) <= hitboxRadius + PLAYER_RADIUS_TILES
    ) {
      damagePlayer(DEFAULT_COMBAT.contactDamage, nowMs, 'contact');
    }

    for (const event of stepped.events) {
      switch (event.kind) {
        case 'shoot':
          for (const verb of event.bullets) spawnBossBullet(bullets, verb);
          events.push({ kind: 'boss-shoot', nowMs: durationMs, bullets: event.bullets.length });
          break;

        case 'summon': {
          // `summonedEnemies` is the only deterministic source of enemy positions: same
          // seed + same state gives exactly the same list.
          for (const enemy of summonedEnemies(boss, event.role, event.count, rng)) {
            const enemyMaxHealth = maxHealthFor(enemy.role, false, undefined, BOSSES[options.bossId].chapter);
            summoned.push({
              id: enemy.id,
              role: enemy.role,
              position: enemy.position,
              health: enemyMaxHealth,
              maxHealth: enemyMaxHealth,
            });
            events.push({
              kind: 'boss-summon',
              nowMs: durationMs,
              phase: boss.phase,
              enemyId: enemy.id,
              role: enemy.role,
              at: enemy.position,
            });
          }
          break;
        }

        case 'move':
          events.push({
            kind: 'boss-move',
            nowMs: durationMs,
            to: event.to,
            speedTilesPerSecond: event.speedTilesPerSecond,
          });
          break;

        case 'telegraph':
          events.push({
            kind: 'boss-telegraph',
            nowMs: durationMs,
            durationMs: event.durationMs,
            at: event.at,
          });
          break;

        case 'play-animation':
          events.push({ kind: 'boss-animation', nowMs: durationMs, animation: event.animation });
          break;

        case 'phase-change':
          phaseChanges.push(event.phase);
          events.push({ kind: 'boss-phase', nowMs: durationMs, phase: event.phase });
          break;
      }
    }

    // --- Poison & Burn DoT on the boss and summons ----------------------
    const poison = bossStatus.poisonDamage(nowMs, BOSS_RUN_STEP_MS);
    if (poison > 0 && boss.health > 0) damageBoss(poison);
    const burn = bossBurnDamage(nowMs, BOSS_RUN_STEP_MS);
    if (burn > 0 && boss.health > 0) damageBoss(burn);
    for (const enemy of summoned) {
      if (enemy.health <= 0) continue;
      const sStatus = summonStatuses.get(enemy.id);
      if (sStatus !== undefined) {
        const sPoison = sStatus.poisonDamage(nowMs, BOSS_RUN_STEP_MS);
        if (sPoison > 0) damageSummon(enemy, sPoison);
      }
      if (enemy.health <= 0) continue;
      const sBurn = summonBurns.get(enemy.id);
      if (sBurn !== undefined && sBurn.dps > 0) {
        const activeMs = Math.max(0, Math.min(nowMs + BOSS_RUN_STEP_MS, sBurn.untilMs) - nowMs);
        if (activeMs > 0) damageSummon(enemy, (sBurn.dps * activeMs) / 1000);
      }
    }

    // --- Homing: rotate velocity toward the nearest target ---------------
    for (const bullet of bullets.active()) {
      if (!bullet.homing || bullet.owner !== 'player') continue;
      const aim = nearestTarget(bullet.position, boss, summoned);
      if (aim === null) continue;
      const turn = (HOMING_TURN_RATE_RADIANS_PER_SECOND * BOSS_RUN_STEP_MS) / 1000;
      const next = steerVelocity(bullet.velocity, bullet.position, aim, turn);
      bullet.velocity.x = next.x;
      bullet.velocity.y = next.y;
    }

    // --- Bullets: fly, drop those leaving the room, then resolve collisions
    bullets.update(BOSS_RUN_STEP_MS);
    bullets.consumeWhere((bullet) => !isInsideArena(bullet.position));

    spent.clear();
    for (const bullet of bullets.active()) {
      if (spent.has(bullet.id)) continue;
      const area = { position: bullet.position, radiusTiles: bullet.radiusTiles };

      if (bullet.owner === 'enemy') {
        if (!hitsCircle(area, { position: player, radiusTiles: PLAYER_RADIUS_TILES })) continue;
        spent.add(bullet.id);
        damagePlayer(bullet.damage, nowMs);
        continue;
      }

      let consumed = false;

      // The boss is the main target; the hitbox is the radius proxy documented at the top of the file.
      if (
        boss.health > 0 &&
        !bullet.hitIds.includes(BOSS_TARGET_ID) &&
        hitsCircle(area, { position: boss.position, radiusTiles: hitboxRadius })
      ) {
        const healthBefore = boss.health;
        let damage = damageAfterExecute(
          stats,
          bullet.damage,
          healthBefore / BOSSES[options.bossId].maxHealth,
        );
        if (stats.statusDamageBonus > 0 && isBossAfflicted(nowMs)) {
          damage *= 1 + stats.statusDamageBonus;
        }
        damageBoss(damage);
        bossStatus.apply(stats, nowMs);
        applyBossBurn(nowMs);
        healPlayer(lifestealHeal(stats, Math.min(damage, healthBefore)));
        if (!activeBulletIds.has(bullet.id)) {
          activeState = onActiveHit(activeState, activeConfig, 1);
        }
        applyShockArcs(BOSS_TARGET_ID, boss.position, damage);
        bullet.hitIds.push(BOSS_TARGET_ID);
        hitstopMs = Math.max(hitstopMs, punchHitstop(bullet));
        splashDamage(stats, bullet, boss.position, summoned, (target) => {
          damageSummon(target, bullet.explosiveDamage * stats.aoePowerMult);
        });
        consumed = resolveBulletAfterHit(bullet, boss.position, summoned);
        if (consumed) {
          spent.add(bullet.id);
          continue;
        }
      }

      for (const victim of summoned) {
        if (victim.health <= 0) continue;
        if (bullet.hitIds.includes(victim.id)) continue;
        if (!hitsCircle(area, { position: victim.position, radiusTiles: SUMMONED_RADIUS_TILES })) {
          continue;
        }

        let damage = damageAfterExecute(stats, bullet.damage, victim.health / victim.maxHealth);
        if (stats.statusDamageBonus > 0 && isSummonAfflicted(victim.id, nowMs)) {
          damage *= 1 + stats.statusDamageBonus;
        }
        const dealt = damageSummon(victim, damage);
        summonStatusOf(victim.id).apply(stats, nowMs);
        applySummonBurn(victim.id, nowMs);
        healPlayer(lifestealHeal(stats, dealt));
        if (!activeBulletIds.has(bullet.id)) {
          activeState = onActiveHit(activeState, activeConfig, 1);
        }
        applyShockArcs(victim.id, victim.position, damage);
        bullet.hitIds.push(victim.id);
        hitstopMs = Math.max(hitstopMs, punchHitstop(bullet));
        consumed = resolveBulletAfterHit(bullet, victim.position, summoned);
        if (consumed) break;
      }

      if (consumed) spent.add(bullet.id);
    }
    if (spent.size > 0) {
      bullets.consumeWhere((bullet) => spent.has(bullet.id));
      for (const id of spent) {
        activeBulletIds.delete(id);
        activeBulletSignature.delete(id);
      }
    }

    // --- End -----------------------------------------------------------
    if (boss.health <= 0) {
      outcome = 'won';
      events.push({ kind: 'boss-defeated', nowMs: durationMs });
      break;
    }
    if (health.isDead) {
      outcome = 'lost';
      events.push({ kind: 'player-dead', nowMs: durationMs });
      break;
    }
  }

  return {
    outcome: outcome ?? 'timeout',
    bossHealth: Math.max(0, boss.health),
    playerHearts: health.current,
    phaseChanges,
    events,
    durationMs,
    dashesUsed,
    activeSkillsUsed,
  };
}

/** Nearest target for Homing: the boss when alive, then summoned enemies. */
function nearestTarget(
  from: Vec2,
  boss: BossState,
  summoned: readonly SummonedState[],
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestGap = Number.POSITIVE_INFINITY;

  if (boss.health > 0) {
    best = boss.position;
    bestGap = distance(from, boss.position);
  }
  for (const enemy of summoned) {
    if (enemy.health <= 0) continue;
    const gap = distance(from, enemy.position);
    if (gap < bestGap) {
      best = enemy.position;
      bestGap = gap;
    }
  }
  return best;
}

/** AoE explosion around the hit point: every other target in radius takes extra damage. */
function splashDamage(
  stats: DerivedStats,
  bullet: Bullet,
  center: Vec2,
  summoned: readonly SummonedState[],
  apply: (target: SummonedState) => void,
): void {
  if (bullet.explosiveRadiusTiles <= 0 || stats.explosive === undefined) return;
  const radius = bullet.explosiveRadiusTiles * stats.aoePowerMult;
  for (const enemy of summoned) {
    if (enemy.health <= 0 || bullet.hitIds.includes(enemy.id)) continue;
    if (distance(center, enemy.position) > radius) continue;
    apply(enemy);
  }
}

/**
 * After hitting a target: keep the bullet if it has pierce left, bounce to another target
 * if bounces remain, otherwise retire. Returns `true` when the bullet must be dropped.
 */
function resolveBulletAfterHit(
  bullet: Bullet,
  from: Vec2,
  summoned: readonly SummonedState[],
): boolean {
  if (bullet.pierceRemaining > 0) {
    bullet.pierceRemaining -= 1;
    return false;
  }
  if (bullet.ricochetRemaining > 0) {
    const next = ricochetTarget(
      from,
      summoned
        .filter((enemy) => enemy.health > 0)
        .map((enemy) => ({ id: enemy.id, position: enemy.position })),
      bullet.hitIds,
    );
    if (next !== null) {
      bullet.ricochetRemaining -= 1;
      const speed = Math.hypot(bullet.velocity.x, bullet.velocity.y);
      const dx = next.position.x - from.x;
      const dy = next.position.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      bullet.velocity.x = (dx / length) * speed;
      bullet.velocity.y = (dy / length) * speed;
      return false;
    }
  }
  return true;
}

/** Move the player by this frame's keys, clamped inside the room. */
function movePlayer(player: Vec2, input: MoveInput, speedTilesPerSecond: number): Vec2 {
  const velocity = velocityFromInput(normalizeMoveInput(input), speedTilesPerSecond);
  const seconds = BOSS_RUN_STEP_MS / 1000;
  const maxX = ROOM_COLS - PLAYER_EDGE_MARGIN_TILES;
  const maxY = ROOM_ROWS - PLAYER_EDGE_MARGIN_TILES;

  return {
    x: clamp(player.x + velocity.x * seconds, PLAYER_EDGE_MARGIN_TILES, maxX),
    y: clamp(player.y + velocity.y * seconds, PLAYER_EDGE_MARGIN_TILES, maxY),
  };
}

/**
 * Turn a `BulletVerb` into a real bullet.
 *
 * Angle contract taken verbatim from `patterns.BulletVerb`: with `toward !== null` it flies
 * toward `toward` then adds `angleOffset`; with `toward === null`, `angleOffset`
 * is the absolute angle, 0 = +x, `Math.PI / 2` = +y (down).
 */
function spawnBossBullet(bullets: BulletPool, verb: BulletVerb): void {
  const velocity = bulletVelocity(verb);
  bullets.spawn({
    position: verb.from,
    velocity,
    radiusTiles: verb.radiusTiles,
    damage: verb.damage,
    owner: 'enemy',
    ttlMs: BOSS_BULLET_TTL_MS,
  });
}

/** Closed rectangle — a point exactly on the boundary still counts as inside the room. */
function isInsideArena(point: Vec2): boolean {
  return point.x >= 0 && point.x <= ROOM_COLS && point.y >= 0 && point.y <= ROOM_ROWS;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
