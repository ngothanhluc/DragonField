/**
 * Turn one auto-fire shot into several real bullets in the `BulletPool`.
 *
 * Shared by `game/player-controller.ts` and every simulation, so bullet count,
 * Twin Shot angles, crit, pierce/ricochet/homing/explosive cannot drift between
"actually playing" and "measuring balance".
 */
import type { SeededRng } from '../rng';
import type { DerivedStats } from '../skills/derived-stats';
import type { BulletPool } from './bullets';
import { planVolley } from './shot-effects';

export interface PlayerFireArgs {
  readonly pool: BulletPool;
  readonly stats: DerivedStats;
  readonly rng: SeededRng;
  readonly origin: { readonly x: number; readonly y: number };
  /** Unit direction toward the target. */
  readonly direction: { readonly x: number; readonly y: number };
  readonly speedTilesPerSecond: number;
  readonly radiusTiles: number;
  readonly ttlMs: number;
}

/** Spawn bullets for one shot. Returns the number spawned (>= 1). */
export function firePlayerVolley(args: PlayerFireArgs): number {
  const plans = planVolley(args.stats, args.rng);
  const baseAngle = Math.atan2(args.direction.y, args.direction.x);

  for (const plan of plans) {
    const angle = baseAngle + plan.angleOffset;
    args.pool.spawn({
      position: args.origin,
      velocity: {
        x: Math.cos(angle) * args.speedTilesPerSecond,
        y: Math.sin(angle) * args.speedTilesPerSecond,
      },
      radiusTiles: args.radiusTiles,
      damage: plan.damage,
      owner: 'player',
      ttlMs: args.ttlMs,
      pierceRemaining: plan.pierce,
      ricochetRemaining: plan.ricochet,
      homing: plan.homing,
      explosiveRadiusTiles: plan.explosiveRadiusTiles,
      explosiveDamage: plan.explosiveDamage,
    });
  }

  return plans.length;
}
