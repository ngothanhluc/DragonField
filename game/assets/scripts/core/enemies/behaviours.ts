/**
 * Enemy behaviour (GDD §4). Every function here is a **pure function** of
 * `(state, player, nowMs, level)`:
 *
 * - No `Math.random`, no `Date.now`, no reading/writing globals.
 * - Never mutates `state`; only returns the next action. The Cocos adapter assigns the action
 *   to the node and moves according to it.
 * - Calling twice with the same parameters at the same `nowMs` gives the same result.
 *
 * Numbers (health, speed, cooldown, telegraph, range band, elite multipliers, elite
 * extra attacks) **do not live in this file** — all come from `enemies/tuning.ts`,
 * i.e. `game/config/tuning.json` (emitted into `tuning.generated.ts` by `bun run gen`).
 * Functions take an optional `tuning` parameter so
 * tests can inject a different number set and prove nothing is hardcoded;
 * the default is always `ENEMY_TUNING`.
 *
 * Timing contract: `state.actionStartedMs` is the current **attack cycle** timestamp (when
 * the telegraph started or the attack was released), updated by the **caller**. Do not reset
 * it when the action changes because of a stagger: the cooldown must keep running through the stun,
 * otherwise an enemy under constant fire would never attack. A freshly spawned enemy sets
 * `action = { kind: 'idle' }` and `actionStartedMs = 0`, so it waits out one
 * cooldown before its first attack — exactly the intended "let the player breathe" at room start.
 *
 * Elites change health/damage (GDD §4) **and** gain one extra attack per role (M3):
 * elite chaser pounces, elite caster fires a 3-projectile volley, elite tank charges twice.
 * The caster's projectile attack is described by `elite.ts` (angular volley); the other two
 * are actions, so they live here.
 */
import { isTelegraphElapsed } from '../combat/telegraph';
import type { EnemyRole, LevelData } from '../level/level-data';
import { obstacleAt } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { hasLineOfSight } from './navigation';
import { ENEMY_TUNING, CHAPTER_TUNING, type EnemiesTuning, type EnemyRoleTuning } from './tuning';

export interface EnemyState {
  id: string;
  role: EnemyRole;
  elite: boolean;
  position: Vec2;
  health: number;
  maxHealth: number;
  action: EnemyAction;
  actionStartedMs: number;
}

export type EnemyAction =
  | { kind: 'idle' }
  | { kind: 'walk'; target: Vec2 }
  | { kind: 'telegraph'; sinceMs: number }
  /**
   * Charge in a straight line. `speedTilesPerSecond` travels with the action (not read from the
   * role inside the adapter) because two roles charge at different speeds: tank 7
   * tile/s, elite chaser 6 tile/s.
   *
   * `followUps` = number of charges **remaining after this one**, used by the elite tank: each
   * following charge re-locks onto the player, so dodging the first is not enough.
   */
  | {
      kind: 'charge';
      direction: Vec2;
      untilMs: number;
      speedTilesPerSecond: number;
      followUps: number;
    }
  /**
   * Hit by a projectile: stand still until `untilMs`, then decide again. A separate action instead of
   * using `idle` so a caster does not "finish" an interrupted telegraph (see `attackReleased`).
   */
  | { kind: 'stagger'; untilMs: number }
  | { kind: 'dead' };

/**
 * A stagger action starts at `nowMs` and lasts `durationMs` (ADR-008: 150 ms).
 * Pure: returns an action, never mutates state.
 */
export function staggerAction(nowMs: number, durationMs: number): EnemyAction {
  return { kind: 'stagger', untilMs: nowMs + durationMs };
}

/** The chaser deals damage on contact; inside this radius it holds still instead of jittering. */
export const CHASER_CONTACT_RANGE_TILES = ENEMY_TUNING.roles.chaser.preferredRangeMaxTiles;

/** Caster keeps its distance (GDD §4 says 4–6; the real numbers live in `config/tuning.json`). */
export const CASTER_MIN_RANGE_TILES = ENEMY_TUNING.roles.caster.preferredRangeMinTiles;
export const CASTER_MAX_RANGE_TILES = ENEMY_TUNING.roles.caster.preferredRangeMaxTiles;

/** Tank only attacks when the player is within this range; farther, it walks closer. */
export const TANK_CHARGE_RANGE_TILES = ENEMY_TUNING.roles.tank.preferredRangeMaxTiles;
/** Time charging in a straight line. */
export const TANK_CHARGE_DURATION_MS = ENEMY_TUNING.roles.tank.chargeDurationMs;
/** Charge speed — much faster than walking so the attack can be read. */
export const TANK_CHARGE_SPEED_TILES_PER_SECOND =
  ENEMY_TUNING.roles.tank.chargeSpeedTilesPerSecond;

/** Elite chaser: telegraph before the short pounce. */
export const ELITE_POUNCE_TELEGRAPH_MS = ENEMY_TUNING.elite.chaser.pounceTelegraphMs;
/** Elite chaser: pounce speed, tiles/second. */
export const ELITE_POUNCE_SPEED_TILES_PER_SECOND =
  ENEMY_TUNING.elite.chaser.pounceSpeedTilesPerSecond;
/** Elite chaser: pounce duration, ms. */
export const ELITE_POUNCE_DURATION_MS = ENEMY_TUNING.elite.chaser.pounceDurationMs;
/** Elite chaser: cooldown between two pounces, ms. */
export const ELITE_POUNCE_COOLDOWN_MS = ENEMY_TUNING.elite.chaser.pounceCooldownMs;
/** Elite chaser: only pounce when the player is within this range, tiles. */
export const ELITE_POUNCE_RANGE_TILES = ENEMY_TUNING.elite.chaser.pounceRangeTiles;
/** Elite tank: number of extra charges after the first. */
export const ELITE_EXTRA_TANK_CHARGES = ENEMY_TUNING.elite.tank.extraCharges;

/** Keep an enemy inside the room, so its centre never touches the wall edge. */
export const ROOM_EDGE_MARGIN_TILES = ENEMY_TUNING.roomEdgeMarginTiles;

/** Elite: health and damage multiplied per `config/tuning.json` (default ×2). */
export const ELITE_HEALTH_MULTIPLIER = ENEMY_TUNING.eliteHealthMultiplier;
export const ELITE_DAMAGE_MULTIPLIER = ENEMY_TUNING.eliteDamageMultiplier;

/** Cooldown before the next telegraph may start. */
export const ATTACK_COOLDOWN_MS: Readonly<Record<EnemyRole, number>> = {
  chaser: ENEMY_TUNING.roles.chaser.attackCooldownMs,
  caster: ENEMY_TUNING.roles.caster.attackCooldownMs,
  tank: ENEMY_TUNING.roles.tank.attackCooldownMs,
  sniper: ENEMY_TUNING.roles.sniper.attackCooldownMs,
  splitter: ENEMY_TUNING.roles.splitter.attackCooldownMs,
  splitling: ENEMY_TUNING.roles.splitling.attackCooldownMs,
};

/** Fallback direction when the two points coincide (no defined direction). */
const FALLBACK_DIRECTION: Vec2 = { x: 1, y: 0 };

/**
 * Tolerance when comparing a distance with the preferred band.
 *
 * The caster stops exactly at `preferredRangeMaxTiles`, so measuring the distance right
 * after can yield `6.000000000000001` (differs between JS engines). Without
 * tolerance the enemy "stands inside the band but thinks it is outside": it walks to
 * the very spot it stands on and **never attacks** — a silent bug that only shows up
 * when switching engines. This tolerance is many orders of magnitude above numeric noise.
 */
const RANGE_TOLERANCE_TILES = 1e-6;

/**
 * The sniper closes to this far **inside** its lower band edge (`preferredRangeMinTiles`).
 *
 * Why: the auto-aim range is 8 tiles and the band starts at 8, so a sniper holding exactly at
 * 8 sits on the range boundary (and float error can put it just outside) — it would be
 * untouchable and the balance sim times out. Closing a little past the near edge keeps it in
 * the player's reach while still far away.
 */
const SNIPER_APPROACH_INSET_TILES = 0.75;

/** A reposition walk counts as arrived within this distance of its target point, tiles. */
const REPOSITION_ARRIVAL_TILES = 0.3;

/** Walk speed, tiles/second. */
export function speedFor(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number {
  // Elites only change health and damage, not speed — the parameter keeps the API symmetric.
  void elite;
  return tuning.roles[role].speedTilesPerSecond;
}

/**
 * Silhouette factor of the role (1 = source frame). All 3 chapter-1 monsters use a
 * 16×16 frame, so this is the only thing that makes a brute look clearly bigger than chaser/caster.
 * The number lives in `config/tuning.json` (`enemies.roles.<role>.scale`).
 */
export function visualScaleFor(
  role: EnemyRole,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number {
  return tuning.roles[role].scale;
}

/** Damage on contact (chaser/tank) or when a caster projectile hits. */
export function contactDamageFor(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
  chapter = 1,
): number {
  const base = tuning.roles[role].contactDamage;
  const scaled = elite ? base * tuning.eliteDamageMultiplier : base;
  // Hearts are whole units: 2 × 1.25 = 2.5 must become 3, not leave the HUD showing 3.5.
  return Math.max(1, Math.round(scaled * chapterMultiplier(CHAPTER_TUNING.enemyDamageMultipliers, chapter)));
}

/** Max health, with elite and chapter scaling applied. `waves.ts` uses this to spawn. */
export function maxHealthFor(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
  chapter = 1,
): number {
  const base = tuning.roles[role].health;
  const scaled = elite ? base * tuning.eliteHealthMultiplier : base;
  return Math.max(1, Math.round(scaled * chapterMultiplier(CHAPTER_TUNING.enemyHealthMultipliers, chapter)));
}

/** Factor for `chapter` (1-based); out of range clamps to the first/last chapter. */
function chapterMultiplier(multipliers: readonly number[], chapter: number): number {
  if (!Number.isFinite(chapter)) return 1;
  const index = Math.min(Math.max(Math.floor(chapter), 1), multipliers.length) - 1;
  return multipliers[index] ?? 1;
}

/**
 * Has the attack been released? The adapter calls this after `decideAction` with the previous and next action:
 * telegraph -> idle = fire a projectile (caster), telegraph -> charge = charge (tank).
 * That makes "telegraph then fire" observable without hidden state.
 */
export function attackReleased(
  previous: EnemyAction,
  next: EnemyAction,
): 'shot' | 'charge' | null {
  if (previous.kind !== 'telegraph') return null;
  if (next.kind === 'idle') return 'shot';
  if (next.kind === 'charge') return 'charge';
  return null;
}

export interface DecideActionArgs {
  readonly state: EnemyState;
  readonly player: Vec2;
  readonly nowMs: number;
  readonly level: LevelData;
  /** Tuning set; defaults to `ENEMY_TUNING` (config/tuning.json). */
  readonly tuning?: EnemiesTuning;
}

/** Next action of the enemy at `nowMs`. Never mutates `state`. */
export function decideAction(args: DecideActionArgs): EnemyAction {
  const { state, player, nowMs, level } = args;
  const tuning = args.tuning ?? ENEMY_TUNING;

  if (state.action.kind === 'dead' || state.health <= 0) return { kind: 'dead' };

  // Staggered: hold until the time is up, no movement, no attack.
  // Return a new action (same `untilMs`) instead of reusing the state object — pure function.
  if (state.action.kind === 'stagger' && nowMs < state.action.untilMs) {
    return { kind: 'stagger', untilMs: state.action.untilMs };
  }

  const role = tuning.roles[state.role];
  const elite = tuning.elite;

  switch (state.role) {
    case 'chaser':
      return decideChaser(state, player, nowMs, level, role, elite.chaser);
    case 'caster':
      return decideCaster(state, player, nowMs, level, role);
    case 'tank':
      return decideTank(state, player, nowMs, level, role, elite.tank);
    case 'sniper':
      return decideSniper(state, player, nowMs, level, role);
    case 'splitter':
    case 'splitling':
      // Splitters and their brood are contact-only chasers: they never telegraph.
      return decideMelee(state, player, level, role);
  }
}

/**
 * Chaser: runs straight at the player and deals damage on contact (the damage part is
 * handled by the adapter through `contactDamageFor`). Inside contact range it holds still.
 *
 * The **elite** version gains a pounce when the player is in range: telegraph then a
 * short charge, with its own cooldown. A regular chaser never telegraphs, so seeing a
 * telegraph ring under a bat means it is an elite.
 */
function decideChaser(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
  elite: EnemiesTuning['elite']['chaser'],
): EnemyAction {
  const current = state.action;
  const canPounce = state.elite && elite.pounceTelegraphMs > 0;

  if (current.kind === 'charge') {
    if (nowMs < current.untilMs) {
      return { ...current, direction: { x: current.direction.x, y: current.direction.y } };
    }
    return { kind: 'idle' };
  }

  if (current.kind === 'telegraph') {
    if (
      canPounce &&
      !isTelegraphElapsed(current.sinceMs, nowMs, elite.pounceTelegraphMs)
    ) {
      return { kind: 'telegraph', sinceMs: current.sinceMs };
    }
    if (canPounce) {
      return {
        kind: 'charge',
        direction: directionBetween(state.position, player),
        untilMs: nowMs + elite.pounceDurationMs,
        speedTilesPerSecond: elite.pounceSpeedTilesPerSecond,
        followUps: 0,
      };
    }
    return { kind: 'idle' };
  }

  const gap = distance(state.position, player);
  if (gap <= tuning.preferredRangeMaxTiles) return { kind: 'idle' };

  const cooldown = elite.pounceCooldownMs;
  if (canPounce && gap <= elite.pounceRangeTiles && nowMs - state.actionStartedMs >= cooldown) {
    return { kind: 'telegraph', sinceMs: nowMs };
  }

  return { kind: 'walk', target: clampToRoom(level, player) };
}

/**
 * Caster: keeps the `preferredRange` band. Closer than the lower bound it backs off, farther
 * than the upper bound it steps in, inside the band it stands and telegraphs `telegraphMs` then fires.
 *
 * It only fires what it can see (#34): inside the band with a wall between, it walks to regain
 * sight instead of telegraphing — a shot that stops on the wall would only punish the player
 * for standing still behind cover. Pits do not block sight, so shooting across one is legal.
 *
 * Once in a telegraph it **runs to completion**, even if the player backs out of range — the attack is
 * "committed", so the player dodges by moving, not by cancelling it.
 */
function decideCaster(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
): EnemyAction {
  const current = state.action;

  if (current.kind === 'telegraph') {
    if (!isTelegraphElapsed(current.sinceMs, nowMs, tuning.telegraphMs)) {
      return { kind: 'telegraph', sinceMs: current.sinceMs };
    }
    return { kind: 'idle' };
  }

  const gap = distance(state.position, player);
  const outsideBand =
    gap < tuning.preferredRangeMinTiles - RANGE_TOLERANCE_TILES ||
    gap > tuning.preferredRangeMaxTiles + RANGE_TOLERANCE_TILES;
  if (outsideBand) {
    return { kind: 'walk', target: holdRangeTarget(state, player, level, tuning) };
  }

  // Inside the band but behind a wall: reposition until the player is in sight. The adapter
  // steers this walk through the flow field, so it goes around the wall instead of pressing it.
  if (!hasLineOfSight(level, state.position, player)) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (isCoolingDown(state, nowMs, tuning)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

/**
 * Sniper (#42): the opposite of the chaser — it wants the `preferredRange` band (8–12 tiles)
 * and a clear line. Outside the band it repositions on the flow field (like the caster); inside
 * the band **without** line of sight it walks to regain sight, so it can never telegraph a shot
 * into a wall. Inside the band with sight, off cooldown, it telegraphs `telegraphMs` then fires
 * one fast bullet (released as `shot` → `idle`).
 *
 * A telegraph runs to completion once started (the player dodges the line, not the trigger);
 * like the caster it does not cancel because the player left the band.
 */
function decideSniper(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
): EnemyAction {
  const current = state.action;

  if (current.kind === 'telegraph') {
    if (!isTelegraphElapsed(current.sinceMs, nowMs, tuning.telegraphMs)) {
      return { kind: 'telegraph', sinceMs: current.sinceMs };
    }
    return { kind: 'idle' };
  }

  // Commit to an in-flight reposition: a sniper that stops the moment it enters the far edge of
  // the band would park exactly at `preferredRangeMaxTiles`, outside the player's reach. It keeps
  // walking until the target point is reached, then re-decides there.
  if (current.kind === 'walk' && distance(state.position, current.target) > REPOSITION_ARRIVAL_TILES) {
    return { kind: 'walk', target: { x: current.target.x, y: current.target.y } };
  }

  const gap = distance(state.position, player);
  const approachRange = tuning.preferredRangeMinTiles - SNIPER_APPROACH_INSET_TILES;
  const insideBand =
    gap >= approachRange - RANGE_TOLERANCE_TILES &&
    gap <= tuning.preferredRangeMaxTiles + RANGE_TOLERANCE_TILES;

  if (!insideBand) {
    return { kind: 'walk', target: sniperHoldTarget(state, player, level, tuning) };
  }
  if (!hasLineOfSight(level, state.position, player)) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }
  // Between shots it closes to the near edge instead of standing in place at whatever distance
  // it happened to stop (see `SNIPER_APPROACH_INSET_TILES`).
  if (isCoolingDown(state, nowMs, tuning)) {
    return { kind: 'walk', target: sniperHoldTarget(state, player, level, tuning) };
  }
  return { kind: 'telegraph', sinceMs: nowMs };
}

/**
 * Splitter / splitling: contact-only chasers. They reuse the chaser's stop-at-contact rule
 * but have no elite pounce, because their extra strength is the split (see `splitter.ts`).
 */
function decideMelee(
  state: EnemyState,
  player: Vec2,
  level: LevelData,
  tuning: EnemyRoleTuning,
): EnemyAction {
  const gap = distance(state.position, player);
  if (gap <= tuning.preferredRangeMaxTiles) return { kind: 'idle' };
  return { kind: 'walk', target: clampToRoom(level, player) };
}

/**
 * Tank: walks slowly closer, telegraphs, then charges in a straight line for
 * `chargeDurationMs`. The charge direction locks when the telegraph ends, so the player dodges
 * by stepping off the charge line.
 */
function decideTank(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
  elite: EnemiesTuning['elite']['tank'],
): EnemyAction {
  const current = state.action;

  if (current.kind === 'charge') {
    if (nowMs < current.untilMs) {
      return {
        kind: 'charge',
        direction: { x: current.direction.x, y: current.direction.y },
        untilMs: current.untilMs,
        speedTilesPerSecond: current.speedTilesPerSecond,
        followUps: current.followUps,
      };
    }

    // Elite tank: the next charge locks a **new** direction onto the player, without telegraphing
    // again. Dodging the first by stepping sideways is not enough.
    if (current.followUps > 0) {
      return {
        kind: 'charge',
        direction: directionBetween(state.position, player),
        untilMs: nowMs + tuning.chargeDurationMs,
        speedTilesPerSecond: tuning.chargeSpeedTilesPerSecond,
        followUps: current.followUps - 1,
      };
    }
    return { kind: 'idle' };
  }

  if (current.kind === 'telegraph') {
    if (!isTelegraphElapsed(current.sinceMs, nowMs, tuning.telegraphMs)) {
      return { kind: 'telegraph', sinceMs: current.sinceMs };
    }
    return {
      kind: 'charge',
      direction: directionBetween(state.position, player),
      untilMs: nowMs + tuning.chargeDurationMs,
      speedTilesPerSecond: tuning.chargeSpeedTilesPerSecond,
      followUps: state.elite ? Math.max(0, elite.extraCharges) : 0,
    };
  }

  const gap = distance(state.position, player);
  if (gap > tuning.preferredRangeMaxTiles) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (isCoolingDown(state, nowMs, tuning)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

function isCoolingDown(state: EnemyState, nowMs: number, tuning: EnemyRoleTuning): boolean {
  return nowMs - state.actionStartedMs < tuning.attackCooldownMs;
}

/**
 * A point `preferredRangeMaxTiles` from the player along the direction from player to enemy:
 * too close means that is the retreat point, too far means the approach point.
 *
 * If that point falls inside an obstacle, stand still instead of charging into a wall.
 */
function holdRangeTarget(
  state: EnemyState,
  player: Vec2,
  level: LevelData,
  tuning: EnemyRoleTuning,
): Vec2 {
  const away = directionBetween(player, state.position);
  const atRange = clampToRoom(level, {
    x: player.x + away.x * tuning.preferredRangeMaxTiles,
    y: player.y + away.y * tuning.preferredRangeMaxTiles,
  });

  if (obstacleAt(level, atRange) !== null) {
    return { x: state.position.x, y: state.position.y };
  }
  return atRange;
}

/**
 * Sniper reposition point (#42): farther than the band it walks **to the near edge minus the
 * approach inset** (see `SNIPER_APPROACH_INSET_TILES`) so it ends up inside the player's
 * auto-aim range; closer than the band it backs off to the far edge.
 */
function sniperHoldTarget(
  state: EnemyState,
  player: Vec2,
  level: LevelData,
  tuning: EnemyRoleTuning,
): Vec2 {
  const gap = distance(player, state.position);
  const approachRange = tuning.preferredRangeMinTiles - SNIPER_APPROACH_INSET_TILES;
  const range = gap > approachRange ? approachRange : tuning.preferredRangeMaxTiles;
  const away = directionBetween(player, state.position);
  const atRange = clampToRoom(level, {
    x: player.x + away.x * range,
    y: player.y + away.y * range,
  });

  if (obstacleAt(level, atRange) !== null) {
    return { x: state.position.x, y: state.position.y };
  }
  return atRange;
}

function directionBetween(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return FALLBACK_DIRECTION;
  return { x: dx / length, y: dy / length };
}

function clampToRoom(level: LevelData, point: Vec2): Vec2 {
  const maxX = level.size.cols - ROOM_EDGE_MARGIN_TILES;
  const maxY = level.size.rows - ROOM_EDGE_MARGIN_TILES;
  return {
    x: Math.min(Math.max(point.x, ROOM_EDGE_MARGIN_TILES), maxX),
    y: Math.min(Math.max(point.y, ROOM_EDGE_MARGIN_TILES), maxY),
  };
}
