/**
 * Enemy bullets: direction locked at fire time, flying slowly enough to dodge (GDD §4).
 *
 * One code path for every enemy bullet source in the game (regular caster, elite
 * caster fan volley, bosses later): pick an angle → rotate the unit vector → spawn into
 * `BulletPool`. That makes "a volley of N bullets" a parameter of this function instead of
 * a separate loop in the adapter — the place easiest to drift between sim and game.
 *
 * Enemy bullets use the **same pool** as player bullets: the pool has hard capacity and reuses
 * slots, so firing 40 or 400 bullets allocates no nodes/objects inside the
 * game loop.
 */
import type { Vec2 } from '../math/vec2';
import { ENEMY_TUNING, type EnemiesTuning } from '../enemies/tuning';
import type { EnemyRole } from '../level/level-data';
import type { DeathCause } from '../run/run-summary';
import type { BulletPool } from './bullets';

/** Enemy bullet radius, tiles — same convention as player bullets (0.15). */
export const ENEMY_BULLET_RADIUS_TILES = 0.15;

/** Enemy bullet speed, tiles/second. Much slower than player bullets (12) so they can be dodged. */
export const ENEMY_BULLET_SPEED_TILES_PER_SECOND = 4;

/** Enemy bullets live long enough to cross the room (32 tiles / 4 = 8 s). */
export const ENEMY_BULLET_TTL_MS = 8000;

/** Direction from `from` to `to`; coincident points default to flying right. */
export function aimDirection(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/** Rotate a unit vector around the origin by `angle` radians (positive = clockwise on screen). */
export function rotateDirection(direction: Vec2, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: direction.x * cos - direction.y * sin,
    y: direction.x * sin + direction.y * cos,
  };
}

/** What a role fires when its telegraph is released. */
export interface EnemyShotPlan {
  /** Angle offsets from the aim line (one bullet per element). */
  readonly angles: readonly number[];
  /** Bullet speed, tiles/second. */
  readonly speedTilesPerSecond: number;
}

/** Full shot plan including resolved aim target (straight or predictive lead). */
export interface ResolvedEnemyShotPlan extends EnemyShotPlan {
  /** World-space point the volley aims toward (equals `targetPos` when lead is 0). */
  readonly aimTarget: Vec2;
}

/**
 * Predictive lead aim (M13, GDD §15.3): projects where a moving player will be when a bullet
 * travelling at `bulletSpeed` arrives, scaled by `leadFactor` (0..1) and capped to `maxLeadTiles`
 * so dodging perpendicularly or using Dash beats it cleanly.
 *
 * Pure function — never returns NaN/Infinity; when `targetVel` is zero or `leadFactor <= 0`,
 * returns `targetPos` unchanged.
 */
export function computePredictiveAim(
  origin: Vec2,
  targetPos: Vec2,
  targetVel: Vec2,
  bulletSpeed: number,
  leadFactor: number,
  maxLeadTiles: number = ENEMY_TUNING.ai.predictiveMaxLeadTiles,
): Vec2 {
  if (
    !Number.isFinite(bulletSpeed) ||
    bulletSpeed <= 0 ||
    !Number.isFinite(leadFactor) ||
    leadFactor <= 0
  ) {
    return { x: targetPos.x, y: targetPos.y };
  }

  const vx = Number.isFinite(targetVel.x) ? targetVel.x : 0;
  const vy = Number.isFinite(targetVel.y) ? targetVel.y : 0;
  const targetSpeedSq = vx * vx + vy * vy;
  if (targetSpeedSq < 1e-9) {
    return { x: targetPos.x, y: targetPos.y };
  }

  const px = targetPos.x - origin.x;
  const py = targetPos.y - origin.y;
  const distSq = px * px + py * py;
  if (distSq < 1e-9) {
    return { x: targetPos.x, y: targetPos.y };
  }

  // Exact intercept quadratic: (v·v - s²)t² + 2(p·v)t + p·p = 0.
  const a = targetSpeedSq - bulletSpeed * bulletSpeed;
  const b = 2 * (px * vx + py * vy);
  const c = distSq;

  let interceptSec = Math.sqrt(distSq) / bulletSpeed;
  if (Math.abs(a) < 1e-6) {
    if (b < -1e-6) interceptSec = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const t1 = (-b - root) / (2 * a);
      const t2 = (-b + root) / (2 * a);
      const positive = [t1, t2].filter((t) => t > 0);
      if (positive.length > 0) {
        interceptSec = Math.min(...positive);
      }
    }
  }

  const clampedLead = Math.min(Math.max(leadFactor, 0), 1);
  let leadX = vx * interceptSec * clampedLead;
  let leadY = vy * interceptSec * clampedLead;

  const cap = Number.isFinite(maxLeadTiles) && maxLeadTiles >= 0 ? maxLeadTiles : 0;
  const leadLen = Math.hypot(leadX, leadY);
  if (cap > 0 && leadLen > cap) {
    const scale = cap / leadLen;
    leadX *= scale;
    leadY *= scale;
  } else if (cap === 0) {
    leadX = 0;
    leadY = 0;
  }

  return { x: targetPos.x + leadX, y: targetPos.y + leadY };
}

/**
 * Predictive lead factor (0..1) for an enemy role in `chapter`.
 * Ch3–Ch4 casters and elite casters lead moving players; Ch1–Ch2 regular casters aim straight.
 */
export function predictiveLeadFactorFor(
  role: EnemyRole,
  elite: boolean,
  chapter = 1,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number {
  if (role !== 'caster') return 0;
  if (elite) return tuning.ai.elitePredictiveLeadFactor;
  if (chapter >= tuning.ai.predictiveMinChapter) return tuning.ai.predictiveLeadFactor;
  return 0;
}

/** Build symmetric fan/burst angle offsets around 0, radians. */
function symmetricAngles(shots: number, spreadRadians: number): number[] {
  const count = Math.max(1, Math.floor(shots));
  const half = (count - 1) / 2;
  const angles: number[] = [];
  for (let index = 0; index < count; index += 1) {
    angles.push((index - half) * spreadRadians);
  }
  return angles;
}

/**
 * Buffer defensive shot (M13): when a `buffer` has no nearby allies to haste, it fires a slow
 * defensive orb (or a 3-orb spread when elite) so it is never inert when left solo.
 */
export function bufferShotPlan(
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
): EnemyShotPlan {
  const speedTilesPerSecond =
    tuning.roles.buffer.projectileSpeedTilesPerSecond ?? ENEMY_BULLET_SPEED_TILES_PER_SECOND;
  if (!elite) {
    return { angles: [0], speedTilesPerSecond };
  }
  return {
    angles: symmetricAngles(tuning.elite.buffer.volleyShots, tuning.elite.buffer.volleySpreadRadians),
    speedTilesPerSecond,
  };
}

export interface CasterShotPlanArgs {
  readonly elite: boolean;
  readonly chapter?: number;
  readonly origin: Vec2;
  readonly targetPos: Vec2;
  readonly targetVel?: Vec2;
  readonly tuning?: EnemiesTuning;
}

/**
 * Tier-2 caster shot plan (M13):
 * - Ch1–Ch2 regular: 1 straight shot; Ch1–Ch2 elite: 3-shot fan with predictive lead.
 * - Ch3–Ch4 regular: 2-shot burst with predictive lead; Ch3–Ch4 elite: 4-shot fan with predictive lead.
 */
export function casterShotPlan(args: CasterShotPlanArgs): ResolvedEnemyShotPlan {
  const tuning = args.tuning ?? ENEMY_TUNING;
  const chapter = args.chapter ?? 1;
  const speed =
    tuning.roles.caster.projectileSpeedTilesPerSecond ?? ENEMY_BULLET_SPEED_TILES_PER_SECOND;
  const lead = predictiveLeadFactorFor('caster', args.elite, chapter, tuning);
  const vel = args.targetVel ?? { x: 0, y: 0 };
  const aimTarget = computePredictiveAim(
    args.origin,
    args.targetPos,
    vel,
    speed,
    lead,
    tuning.ai.predictiveMaxLeadTiles,
  );

  let angles: number[];
  if (args.elite) {
    const shots =
      chapter >= tuning.ai.eliteCasterLateMinChapter
        ? tuning.ai.eliteCasterLateVolleyShots
        : tuning.elite.caster.volleyShots;
    angles = symmetricAngles(shots, tuning.elite.caster.volleySpreadRadians);
  } else if (chapter >= tuning.ai.casterBurstMinChapter) {
    angles = symmetricAngles(tuning.ai.casterBurstShots, tuning.ai.casterBurstSpreadRadians);
  } else {
    angles = [0];
  }

  return { angles, speedTilesPerSecond: speed, aimTarget };
}

/**
 * Sniper shot (#42): exactly **one** bullet, aimed straight at the player, much faster than
 * the caster's 4 tile/s ball. Both the game adapter and the balance sim call this, so the two
 * can never drift apart on "how fast is the sniper's shot".
 */
export function sniperShotPlan(tuning: EnemiesTuning = ENEMY_TUNING): EnemyShotPlan {
  return {
    angles: [0],
    speedTilesPerSecond:
      tuning.roles.sniper.projectileSpeedTilesPerSecond ??
      ENEMY_BULLET_SPEED_TILES_PER_SECOND,
  };
}

/** Gunner shot plan (M18): 3-bullet fan in Ch1–2, 5-bullet fan in Ch3–4; Elite schedules a staggered alternating follow-up volley. */
export interface GunnerShotPlan extends EnemyShotPlan {
  /** Delay before the Elite gunner's staggered alternating second volley, or `null` for regular gunners. */
  readonly followUpDelayMs: number | null;
  /** Angle offsets for the staggered alternating second volley (empty when not elite). */
  readonly followUpAngles: readonly number[];
}

export interface PendingGunnerVolley {
  readonly enemyId: string;
  readonly origin: Vec2;
  readonly aimTarget: Vec2;
  readonly damage: number;
  readonly angles: readonly number[];
  readonly speedTilesPerSecond: number;
  readonly triggerAtMs: number;
}

export function gunnerShotPlan(
  elite: boolean,
  chapter = 1,
  tuning: EnemiesTuning = ENEMY_TUNING,
): GunnerShotPlan {
  const speedTilesPerSecond =
    tuning.roles.gunner.projectileSpeedTilesPerSecond ?? ENEMY_BULLET_SPEED_TILES_PER_SECOND;
  const shots =
    chapter >= tuning.ai.gunnerLateMinChapter
      ? tuning.ai.gunnerLateVolleyShots
      : tuning.ai.gunnerVolleyShots;
  const spread = tuning.ai.gunnerSpreadRadians;
  const angles = symmetricAngles(shots, spread);

  if (!elite || tuning.elite.gunner.staggerDelayMs <= 0) {
    return { angles, speedTilesPerSecond, followUpDelayMs: null, followUpAngles: [] };
  }

  const offset = spread * tuning.elite.gunner.staggerAngleOffsetFactor;
  // Alternating volley shifts each lane by half a spread step so the player must weave between volleys.
  const followUpAngles = angles.map((angle) => angle + offset);
  return {
    angles,
    speedTilesPerSecond,
    followUpDelayMs: tuning.elite.gunner.staggerDelayMs,
    followUpAngles,
  };
}

/** Schedule an Elite gunner's staggered follow-up volley if the plan specifies one. */
export function scheduleGunnerFollowUp(args: {
  readonly enemyId: string;
  readonly origin: Vec2;
  readonly aimTarget: Vec2;
  readonly damage: number;
  readonly plan: GunnerShotPlan;
  readonly nowMs: number;
}): PendingGunnerVolley | null {
  if (args.plan.followUpDelayMs === null || args.plan.followUpAngles.length === 0) return null;
  return {
    enemyId: args.enemyId,
    origin: { x: args.origin.x, y: args.origin.y },
    aimTarget: { x: args.aimTarget.x, y: args.aimTarget.y },
    damage: args.damage,
    angles: args.plan.followUpAngles,
    speedTilesPerSecond: args.plan.speedTilesPerSecond,
    triggerAtMs: args.nowMs + args.plan.followUpDelayMs,
  };
}

/** Split pending Elite gunner follow-up volleys into due (at `nowMs`) and remaining. Pure. */
export function stepPendingGunnerVolleys(
  pending: readonly PendingGunnerVolley[],
  nowMs: number,
): {
  readonly triggered: PendingGunnerVolley[];
  readonly remaining: PendingGunnerVolley[];
} {
  const triggered: PendingGunnerVolley[] = [];
  const remaining: PendingGunnerVolley[] = [];
  for (const volley of pending) {
    if (nowMs >= volley.triggerAtMs) triggered.push(volley);
    else remaining.push(volley);
  }
  return { triggered, remaining };
}

/** Roles whose released attack is a straight bullet (caster, sniper, gunner); others charge or pounce. */
export function shootsProjectiles(role: EnemyRole): boolean {
  return role === 'caster' || role === 'sniper' || role === 'gunner';
}

export interface EnemyVolleyArgs {
  readonly pool: BulletPool;
  /** Where the bullet starts (enemy centre). */
  readonly from: Vec2;
  /** Player position at fire time — the bullet does **not** track afterwards. */
  readonly to: Vec2;
  readonly damage: number;
  /** Angle offset from the straight line to the player, radians. One element per bullet. */
  readonly angles: readonly number[];
  readonly speedTilesPerSecond?: number;
  readonly ttlMs?: number;
  readonly radiusTiles?: number;
  /** Optional killer attribution attached to each spawned enemy bullet (M15). */
  readonly source?: DeathCause;
}

/**
 * Fire a volley toward `to`. Returns the **number** of bullets spawned (0 when `angles`
 * is empty). Every bullet in the volley gets exactly the `damage` parameter, never split.
 */
export function fireEnemyVolley(args: EnemyVolleyArgs): number {
  const speed = args.speedTilesPerSecond ?? ENEMY_BULLET_SPEED_TILES_PER_SECOND;
  const ttlMs = args.ttlMs ?? ENEMY_BULLET_TTL_MS;
  const radiusTiles = args.radiusTiles ?? ENEMY_BULLET_RADIUS_TILES;
  const base = aimDirection(args.from, args.to);

  for (const angle of args.angles) {
    const direction = angle === 0 ? base : rotateDirection(base, angle);
    args.pool.spawn({
      position: args.from,
      velocity: { x: direction.x * speed, y: direction.y * speed },
      radiusTiles,
      damage: args.damage,
      owner: 'enemy',
      ttlMs,
      ...(args.source !== undefined ? { source: args.source } : {}),
    });
  }

  return args.angles.length;
}
