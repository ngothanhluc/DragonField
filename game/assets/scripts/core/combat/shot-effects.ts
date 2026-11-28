/**
 * Skill effects on **one shot** and **one hit**.
 *
 * Split from the adapter because this is where game and simulation drift most easily:
 * projectile count, spread angle, crit, execute, lifesteal, ricochet, explosion. Both `game/player-controller.ts`
 * and `sim/*` (headless balance sim) call exactly these functions; they are pure arithmetic + `SeededRng`.
 *
 * Damage convention: a bullet's damage already includes crit (rolled at fire time). Execute is a
 * factor **applied on hit** because it depends on the target's health at that moment.
 */
import type { SeededRng } from '../rng';
import type { DerivedStats, ShockOnHit } from '../skills/derived-stats';

/** Total spread of Twin Shot (GDD §6: ±12°). */
export const TWIN_SPREAD_RADIANS = (12 * Math.PI) / 180;

/** Bounce radius to another target, tiles. Anything farther counts as no target. */
export const RICOCHET_RANGE_TILES = 8;

/** Maximum turn rate of a homing bullet, radians/second. Fast enough to look like "tracking". */
export const HOMING_TURN_RATE_RADIANS_PER_SECOND = (720 * Math.PI) / 180;

/** One bullet in a volley, with damage/flags settled so the adapter only has to spawn it. */
export interface ProjectilePlan {
  /** Offset from the aim direction, radians. */
  readonly angleOffset: number;
  readonly damage: number;
  readonly crit: boolean;
  /** Enemies it can still pass through. */
  readonly pierce: number;
  /** Remaining bounces. */
  readonly ricochet: number;
  readonly homing: boolean;
  readonly explosiveRadiusTiles: number;
  /** Explosion damage, crit + ratio already applied. 0 = no explosion. */
  readonly explosiveDamage: number;
}

/**
 * Split one shot into `stats.projectiles` bullets.
 *
 * **One bullet always flies straight** (angle 0): if every bullet were offset ±12°, at long
 * range the two bullets of a 1-stack Twin Shot would both miss a 0.8-tile enemy and DPS would drop to 0 — a bug
 * that shows up in the simulation when stacking Twin Shot + Rapid Fire. Extra bullets are offset
 * +12° / −12° in turn (GDD §6 "fires at ±12°"), so additional stacks stay a bonus at close
 * range instead of losing the middle bullet.
 *
 * Crit is rolled **once per bullet** (explosions/crits are independent); RNG is only spent when
 * `critChance > 0` so a loadout without crit does not shift the skill-roll RNG sequence.
 */
export function planVolley(stats: DerivedStats, rng: SeededRng): ProjectilePlan[] {
  const count = Math.max(1, Math.round(stats.projectiles));
  const plans: ProjectilePlan[] = [];

  for (let index = 0; index < count; index += 1) {
    // index 0 = middle bullet; 1 = +12°, 2 = −12°, 3 = +12°, …
    const angleOffset =
      index === 0
        ? 0
        : (index % 2 === 1 ? 1 : -1) * TWIN_SPREAD_RADIANS;
    const crit = stats.critChance > 0 && rng.next() < stats.critChance;
    const damage = stats.damage * (crit ? Math.max(1, stats.critMultiplier) : 1);
    const explosive = stats.explosive;

    plans.push({
      angleOffset,
      damage,
      crit,
      pierce: Math.max(0, Math.floor(stats.pierce)),
      ricochet: Math.max(0, Math.floor(stats.ricochetBounces ?? 0)),
      homing: stats.homing === true,
      explosiveRadiusTiles: explosive === undefined ? 0 : Math.max(0, explosive.radiusTiles),
      explosiveDamage:
        explosive === undefined ? 0 : damage * Math.max(0, explosive.damageRatio),
    });
  }

  return plans;
}

/**
 * Final damage on a target that still has `healthFraction` health (0..1).
 *
 * Executioner: adds `executeBonus` (per stack) when health is below the threshold. With 2 stacks
 * the bonus is 1.0, i.e. ×2 damage; not applied to explosions (an explosion is already extra damage).
 */
export function damageAfterExecute(
  stats: Pick<DerivedStats, 'executeThreshold' | 'executeBonus'>,
  damage: number,
  healthFraction: number,
): number {
  if (stats.executeThreshold <= 0 || stats.executeBonus <= 0) return damage;
  const fraction = Number.isFinite(healthFraction) ? Math.max(0, Math.min(1, healthFraction)) : 1;
  if (fraction >= stats.executeThreshold) return damage;
  return damage * (1 + stats.executeBonus);
}

/**
 * Health restored from damage just dealt. GDD §6 says "round down": 5% of 3 damage = 0,
 * so 1-stack lifesteal restores nothing with 1-damage bullets — exactly the wording of the table.
 */
export function lifestealHeal(
  stats: Pick<DerivedStats, 'lifestealPercent'>,
  damageDealt: number,
): number {
  if (stats.lifestealPercent <= 0 || !(damageDealt > 0)) return 0;
  return Math.max(0, Math.floor(damageDealt * stats.lifestealPercent));
}

export interface RicochetCandidate {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
}

export interface RicochetTarget {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
}

/**
 * Next target for a ricocheting bullet: nearest within `RICOCHET_RANGE_TILES`, skipping
 * the target just hit and any the bullet already touched (`alreadyHit`).
 * Returns `null` when nobody is left — the bullet is retired as usual.
 */
export function ricochetTarget(
  from: { readonly x: number; readonly y: number },
  candidates: readonly RicochetCandidate[],
  alreadyHit: readonly string[],
): RicochetTarget | null {
  let best: RicochetTarget | null = null;
  let bestDistance = RICOCHET_RANGE_TILES;

  for (const candidate of candidates) {
    if (alreadyHit.includes(candidate.id)) continue;
    const dx = candidate.position.x - from.x;
    const dy = candidate.position.y - from.y;
    const gap = Math.hypot(dx, dy);
    if (gap > bestDistance) continue;
    bestDistance = gap;
    best = { id: candidate.id, position: { x: candidate.position.x, y: candidate.position.y } };
  }

  return best;
}

/**
 * Rotate the velocity toward `to` by at most `maxTurnRadians`, keeping speed.
 * Used by Homing: called once per frame, a bullet never "teleports" its heading.
 */
export function steerVelocity(
  velocity: { readonly x: number; readonly y: number },
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  maxTurnRadians: number,
): { x: number; y: number } {
  const speed = Math.hypot(velocity.x, velocity.y);
  if (!(speed > 0) || !(maxTurnRadians >= 0)) {
    return { x: velocity.x, y: velocity.y };
  }

  const currentAngle = Math.atan2(velocity.y, velocity.x);
  const desiredAngle = Math.atan2(to.y - from.y, to.x - from.x);
  let delta = desiredAngle - currentAngle;
  // Normalise to (-π, π]: take the shortest turn instead of spinning almost all the way around.
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  const turn = Math.max(-maxTurnRadians, Math.min(maxTurnRadians, delta));
  const angle = currentAngle + turn;

  return { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed };
}

/**
 * Apply `Corrosive` / `Blightfrost` bonus damage against targets afflicted by Freeze, Poison,
 * or Burn (`statusDamageBonus`). Pure arithmetic — returns `damage` unchanged when unafflicted.
 */
export function damageWithStatusBonus(
  stats: Pick<DerivedStats, 'statusDamageBonus'>,
  damage: number,
  afflicted: boolean,
): number {
  if (!afflicted || !(stats.statusDamageBonus > 0) || !(damage > 0)) return damage;
  return damage * (1 + stats.statusDamageBonus);
}

/**
 * Compute Chain Lightning (`shockOnHit`) arc targets hopping from `originPos` through nearby
 * unvisited targets within `shock.rangeTiles`, up to `shock.arcs` hops.
 *
 * Accepts an optional `out` array so hot combat loops reuse one buffer without allocating.
 */
export function shockArcTargets(
  originId: string,
  originPos: { readonly x: number; readonly y: number },
  shock: ShockOnHit,
  candidates: readonly RicochetCandidate[],
  out: RicochetTarget[] = [],
): RicochetTarget[] {
  out.length = 0;
  const maxArcs = Math.max(0, Math.floor(shock.arcs));
  if (maxArcs === 0 || !(shock.rangeTiles > 0) || !(shock.damageRatio > 0)) {
    return out;
  }

  const visited = new Set<string>([originId]);
  let currentX = originPos.x;
  let currentY = originPos.y;
  const rangeSq = shock.rangeTiles * shock.rangeTiles;

  for (let hop = 0; hop < maxArcs; hop += 1) {
    let best: RicochetCandidate | null = null;
    let bestDistSq = rangeSq;

    for (const candidate of candidates) {
      if (visited.has(candidate.id)) continue;
      const dx = candidate.position.x - currentX;
      const dy = candidate.position.y - currentY;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        best = candidate;
      }
    }

    if (best === null) break;
    visited.add(best.id);
    out.push({
      id: best.id,
      position: { x: best.position.x, y: best.position.y },
    });
    currentX = best.position.x;
    currentY = best.position.y;
  }

  return out;
}
