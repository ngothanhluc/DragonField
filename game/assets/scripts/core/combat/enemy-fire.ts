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
  /** Angle offsets from the straight line to the player (one bullet per element). */
  readonly angles: readonly number[];
  /** Bullet speed, tiles/second. */
  readonly speedTilesPerSecond: number;
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

/** Roles whose released attack is a straight bullet (caster and sniper); others charge or pounce. */
export function shootsProjectiles(role: EnemyRole): boolean {
  return role === 'caster' || role === 'sniper';
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
    });
  }

  return args.angles.length;
}
