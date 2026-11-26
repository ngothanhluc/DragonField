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
import { computePredictiveAim, predictiveLeadFactorFor } from '../combat/enemy-fire';
import { isTelegraphElapsed } from '../combat/telegraph';
import type { ViewRect } from '../camera/follow-camera';
import type { EnemyRole, LevelData } from '../level/level-data';
import { obstacleNear } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { canAttackFrom } from '../view/view-rect';
import { computeFlankTarget, flankSideFor, hasLineOfSight } from './navigation';
import { ENEMY_TUNING, CHAPTER_TUNING, WAVES_TUNING, type EnemiesTuning, type EnemyRoleTuning } from './tuning';

export { computeFlankTarget, computePredictiveAim, flankSideFor, predictiveLeadFactorFor };

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

/**
 * The action after a bullet hit. A wind-up that is already running (`telegraph`) is **delayed**,
 * not cancelled: hits push its start time back by the stun, so constant fire drags the attack out
 * but a committed telegraph still lands. Cancelling instead makes a focused caster harmless
 * (worse in a 64×36 room, where the nearest enemy is under continuous fire): the balance sim's
 * "every caster lands at least one shot before dying" failed with front-loaded hits every ~0.53 s
 * against a 0.5 s telegraph + 0.15 s stun.
 *
 * Every other action (walk, idle, charge) is replaced by the stagger, as before.
 */
export function staggerAfterHit(action: EnemyAction, nowMs: number, durationMs: number): EnemyAction {
  if (!(durationMs > 0)) return action;
  if (action.kind === 'telegraph') {
    return { kind: 'telegraph', sinceMs: action.sinceMs + durationMs };
  }
  return staggerAction(nowMs, durationMs);
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
  bomber: ENEMY_TUNING.roles.bomber.attackCooldownMs,
  buffer: ENEMY_TUNING.roles.buffer.attackCooldownMs,
  dasher: ENEMY_TUNING.roles.dasher.attackCooldownMs,
  gunner: ENEMY_TUNING.roles.gunner.attackCooldownMs,
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

/**
 * Distance inside the approach point at which a sniper stops closing in and instead backs off to
 * the far edge. Without this margin the "walk in to the near edge" and "walk out to the far edge"
 * targets overlap, so the sniper paced between ~7 and 12 tiles forever (caught by the headless
 * "no enemy keeps walking without moving" run once rooms shrank to 64×36).
 */
const SNIPER_RETREAT_MARGIN_TILES = 1;

/** A reposition walk counts as arrived within this distance of its target point, tiles. */
const REPOSITION_ARRIVAL_TILES = 0.3;
/**
 * A stand-off point this close to a wall cannot be reached by a body of enemy size (the movement
 * margin plus the hitbox). Checking it keeps casters/snipers from walking into a wall forever:
 * a target 0.2 tiles from a prop passes `obstacleAt` but the body stops ~0.9 tiles short, so the
 * committed walk never arrives (found by the M9 balance sim on 128×72 rooms with 8× enemies).
 */
const STANDOFF_CLEARANCE_TILES = 0.75;

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
  damageMult = 1,
): number {
  const base = tuning.roles[role].contactDamage;
  const scaled = elite ? base * tuning.eliteDamageMultiplier : base;
  const safeMult = Number.isFinite(damageMult) && damageMult > 0 ? damageMult : 1;
  // Hearts are whole units: 2 × 1.25 = 2.5 must become 3, not leave the HUD showing 3.5.
  return Math.max(
    1,
    Math.round(scaled * chapterMultiplier(CHAPTER_TUNING.enemyDamageMultipliers, chapter) * safeMult),
  );
}

/** Max health, with elite, chapter, and optional Ascension/Endless scaling applied. */
export function maxHealthFor(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
  chapter = 1,
  healthMult = 1,
): number {
  const base = tuning.roles[role].health;
  const scaled = elite ? base * tuning.eliteHealthMultiplier : base;
  const safeMult = Number.isFinite(healthMult) && healthMult > 0 ? healthMult : 1;
  return Math.max(
    1,
    Math.round(scaled * chapterMultiplier(CHAPTER_TUNING.enemyHealthMultipliers, chapter) * safeMult),
  );
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

/**
 * Role-aware attack release helper (M13): distinguishes `bomber` radial blast and `buffer` aura
 * cast from `caster`/`sniper` projectile shots when a telegraph finishes (`telegraph -> idle`).
 */
export function attackReleasedForRole(
  role: EnemyRole,
  previous: EnemyAction,
  next: EnemyAction,
): 'shot' | 'charge' | 'blast' | 'buff' | null {
  if (previous.kind !== 'telegraph') return null;
  if (next.kind === 'charge') return 'charge';
  if (next.kind === 'idle') {
    if (role === 'bomber') return 'blast';
    if (role === 'buffer') return 'buff';
    return 'shot';
  }
  return null;
}

export interface DecideActionArgs {
  readonly state: EnemyState;
  readonly player: Vec2;
  readonly nowMs: number;
  readonly level: LevelData;
  /** Tuning set; defaults to `ENEMY_TUNING` (config/tuning.json). */
  readonly tuning?: EnemiesTuning;
  /**
   * What the player can see this frame (tiles, y down). Given, the enemy is held to the M9
   * fairness rules (#41): it never **starts** a telegraph/charge/pounce while outside the inset
   * view and idles instead of walking from beyond `waves.aggroRadiusTiles`. Omitted (the old
   * callers and every unit test), the decision is exactly the pre-#41 one.
   */
  readonly view?: ViewRect;
  /**
   * Optional attack-cadence multiplier (Ascension 3–5 `enemyFireRateMult`, default `1`).
   * Values > 1 shorten attack cooldowns proportionally (`cooldown / fireRateMult`).
   */
  readonly fireRateMult?: number;
}

/** Next action of the enemy at `nowMs`. Never mutates `state`. */
export function decideAction(args: DecideActionArgs): EnemyAction {
  const { state, player, nowMs, level } = args;
  const tuning = args.tuning ?? ENEMY_TUNING;
  const fireRateMult =
    args.fireRateMult !== undefined &&
    Number.isFinite(args.fireRateMult) &&
    args.fireRateMult > 0
      ? args.fireRateMult
      : 1;

  if (state.action.kind === 'dead' || state.health <= 0) return { kind: 'dead' };

  // Staggered: hold until the time is up, no movement, no attack.
  // Return a new action (same `untilMs`) instead of reusing the state object — pure function.
  if (state.action.kind === 'stagger' && nowMs < state.action.untilMs) {
    return { kind: 'stagger', untilMs: state.action.untilMs };
  }

  const role = tuning.roles[state.role];
  const elite = tuning.elite;

  const decided = ((): EnemyAction => {
    switch (state.role) {
      case 'chaser':
        return decideChaser(state, player, nowMs, level, role, elite.chaser, tuning, fireRateMult);
      case 'caster':
        return decideCaster(state, player, nowMs, level, role, fireRateMult);
      case 'tank':
        return decideTank(state, player, nowMs, level, role, elite.tank, fireRateMult);
      case 'sniper':
        return decideSniper(state, player, nowMs, level, role, fireRateMult);
      case 'splitter':
      case 'splitling':
        // Splitters and their brood are contact-only chasers: they never telegraph.
        return decideMelee(state, player, level, role);
      case 'bomber':
        return decideBomber(state, player, nowMs, level, role, fireRateMult);
      case 'buffer':
        return decideBuffer(state, player, nowMs, level, role, fireRateMult);
      case 'dasher':
        return decideDasher(state, player, nowMs, level, role, elite.dasher, tuning, fireRateMult);
      case 'gunner':
        return decideGunner(state, player, nowMs, level, role, fireRateMult);
    }
  })();

  return args.view === undefined ? decided : gateToView(decided, state, player, args.view, level);
}

/**
 * Fairness gate (#41) applied to every decided action when the caller passes a view:
 *
 * - inside the view nothing changes;
 * - off screen, an attack that would **start** this frame (a telegraph, or the charge a tank /
 *   elite chaser releases from one) becomes a walk toward the player instead — the player is
 *   never shot, charged or pounced from outside the screen;
 * - off screen, the **release** of a caster/sniper telegraph (`telegraph -> idle`, i.e. the
 *   shot) becomes a walk instead of the idle that would fire it: an enemy that crosses the edge
 *   while winding up must come back into view, not shoot from beyond it;
 * - an in-flight charge keeps running (it already committed while visible);
 * - a walk from beyond the aggro radius becomes idle: enemies across a 16-screen room stay put
 *   until the player comes closer (the edge arrows / enemies-left counter point them out).
 */
function gateToView(
  next: EnemyAction,
  state: EnemyState,
  player: Vec2,
  view: ViewRect,
  level: LevelData,
): EnemyAction {
  const attacking =
    next.kind === 'telegraph' || (next.kind === 'charge' && state.action.kind !== 'charge');
  // Releasing a wind-up (telegraph -> idle) fires the shot; hold it back the same way.
  const releasingShot = state.action.kind === 'telegraph' && next.kind === 'idle';
  if (attacking || releasingShot) {
    if (canAttackFrom(state.position, view)) return next;
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (
    next.kind === 'walk' &&
    distance(state.position, player) > WAVES_TUNING.aggroRadiusTiles
  ) {
    return { kind: 'idle' };
  }

  return next;
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
  enemiesTuning: EnemiesTuning,
  fireRateMult: number,
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

  const cooldown = elite.pounceCooldownMs / fireRateMult;
  if (canPounce && gap <= elite.pounceRangeTiles && nowMs - state.actionStartedMs >= cooldown) {
    return { kind: 'telegraph', sinceMs: nowMs };
  }

  return { kind: 'walk', target: computeFlankTarget(state.position, player, state.id, level, enemiesTuning) };
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
  fireRateMult: number,
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

  if (isCoolingDown(state, nowMs, tuning, fireRateMult)) return { kind: 'idle' };
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
  fireRateMult: number,
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
  if (isCoolingDown(state, nowMs, tuning, fireRateMult)) {
    const target = sniperHoldTarget(state, player, level, tuning);
    // Already at the stand-off point: hold still. A `walk` to its own position moves it nowhere,
    // and the stuck guard then keeps detouring it sideways (it paced back and forth between the
    // near and far edges before the rooms shrank).
    if (distance(state.position, target) <= REPOSITION_ARRIVAL_TILES) return { kind: 'idle' };
    return { kind: 'walk', target };
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
  fireRateMult: number,
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

  // Within charge range but behind cover: the dash is a straight line, so a tank would grind into
  // the wall while the player's bullets stopped on the same wall — a stand-off that never resolves
  // (the room could not clear; found by the 64×36 balance sim). Walk on the flow field instead,
  // like the caster, until the player is in sight.
  if (!hasLineOfSight(level, state.position, player)) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (isCoolingDown(state, nowMs, tuning, fireRateMult)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

/**
 * Bomber (M13): approaches to mid-close range (`preferredRangeMaxTiles` ~2.6 tiles), commits to a
 * clear fuse telegraph (`telegraphMs` ~900 ms), then triggers a radial AoE blast (`telegraph ->
 * idle`, released as `'blast'` via `attackReleasedForRole`). Once the fuse starts it runs to
 * completion so Dash or fast repositioning cleanly clears the blast zone.
 */
function decideBomber(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
  fireRateMult: number,
): EnemyAction {
  const current = state.action;

  if (current.kind === 'telegraph') {
    if (!isTelegraphElapsed(current.sinceMs, nowMs, tuning.telegraphMs)) {
      return { kind: 'telegraph', sinceMs: current.sinceMs };
    }
    return { kind: 'idle' };
  }

  const gap = distance(state.position, player);
  if (gap > tuning.preferredRangeMaxTiles + RANGE_TOLERANCE_TILES) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (!hasLineOfSight(level, state.position, player)) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (isCoolingDown(state, nowMs, tuning, fireRateMult)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

/**
 * Buffer (M13): mid-range support yokai (`preferredRangeMinTiles`..`preferredRangeMaxTiles` ~5–8.5
 * tiles) that telegraphs (`telegraphMs` ~700 ms) then casts a haste/empower aura onto nearby
 * allies, or fires a slow defensive orb when solo (`telegraph -> idle`, released as `'buff'` via
 * `attackReleasedForRole`).
 */
function decideBuffer(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
  fireRateMult: number,
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

  if (!hasLineOfSight(level, state.position, player)) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (isCoolingDown(state, nowMs, tuning, fireRateMult)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

/**
 * Dasher (M18, *Ám Sát*): fast diagonal flanker (`~4.0` t/s). When within `preferredRangeMinTiles`..
 * `preferredRangeMaxTiles` (`3–6` tiles) with line of sight and off cooldown, plays a brief
 * `350 ms` telegraph then dashes at `9.5` t/s for `280 ms`. Elite chains `extraCharges` follow-up
 * dashes, re-locking onto the player each time.
 */
function decideDasher(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
  elite: EnemiesTuning['elite']['dasher'],
  enemiesTuning: EnemiesTuning,
  fireRateMult: number,
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
  const inDashBand =
    gap >= tuning.preferredRangeMinTiles - RANGE_TOLERANCE_TILES &&
    gap <= tuning.preferredRangeMaxTiles + RANGE_TOLERANCE_TILES;
  if (
    inDashBand &&
    hasLineOfSight(level, state.position, player) &&
    !isCoolingDown(state, nowMs, tuning, fireRateMult)
  ) {
    return { kind: 'telegraph', sinceMs: nowMs };
  }

  if (gap <= CHASER_CONTACT_RANGE_TILES && hasLineOfSight(level, state.position, player)) {
    return { kind: 'idle' };
  }
  return {
    kind: 'walk',
    target: computeFlankTarget(state.position, player, state.id, level, enemiesTuning),
  };
}

/**
 * Gunner (M18, *Pháo Thủ Chùm*): holds medium range (`5–8` tiles), requires line of sight, plays a
 * `550 ms` telegraph, then fires a fast 3-bullet fan spread (5-bullet in Ch3–4; Elite chains a
 * second staggered alternating volley).
 */
function decideGunner(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
  fireRateMult: number,
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

  if (!hasLineOfSight(level, state.position, player)) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (isCoolingDown(state, nowMs, tuning, fireRateMult)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

function isCoolingDown(
  state: EnemyState,
  nowMs: number,
  tuning: EnemyRoleTuning,
  fireRateMult = 1,
): boolean {
  return nowMs - state.actionStartedMs < tuning.attackCooldownMs / fireRateMult;
}

/**
 * A point `preferredRangeMaxTiles` from the player along the direction from player to enemy:
 * too close means that is the retreat point, too far means the approach point.
 *
 * If that point falls inside an obstacle (a pillar, a house, a prop), stand-off is impossible
 * there. Walk toward the player instead of returning the enemy's **own** position: a `walk`
 * whose target is where the walker already stands moves it nowhere while the stuck guard keeps
 * detouring it, forever. Closing the distance is always legal and the band check stops the walk
 * as soon as the caster is in range again.
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

  if (obstacleNear(level, atRange, STANDOFF_CLEARANCE_TILES) !== null) {
    return clampToRoom(level, player);
  }
  return atRange;
}

/**
 * Sniper reposition point (#42): farther than the band it walks **to the near edge minus the
 * approach inset** (see `SNIPER_APPROACH_INSET_TILES`) so it ends up inside the player's
 * auto-aim range; when the player is closer than that (inside the retreat margin) it backs off to
 * the far edge again.
 *
 * If that point falls inside an obstacle, walk toward the player instead of standing still: a
 * sniper frozen at `preferredRangeMaxTiles` is outside the auto-aim range and can never be hit,
 * so a room holding one would never clear (hit by the balance sim on a 128×72 room with 8×
 * enemies). Closing the distance is always legal and the band check stops the walk as soon as the
 * sniper is in range again — the same rule `holdRangeTarget` uses for the caster.
 */
function sniperHoldTarget(
  state: EnemyState,
  player: Vec2,
  level: LevelData,
  tuning: EnemyRoleTuning,
): Vec2 {
  const gap = distance(player, state.position);
  const approachRange = tuning.preferredRangeMinTiles - SNIPER_APPROACH_INSET_TILES;
  const retreat =
    gap < approachRange - SNIPER_RETREAT_MARGIN_TILES ? tuning.preferredRangeMaxTiles : approachRange;
  const away = directionBetween(player, state.position);
  const atRange = clampToRoom(level, {
    x: player.x + away.x * retreat,
    y: player.y + away.y * retreat,
  });

  if (obstacleNear(level, atRange, STANDOFF_CLEARANCE_TILES) !== null) {
    return clampToRoom(level, player);
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
