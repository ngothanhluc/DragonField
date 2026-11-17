/**
 * Biến một phát auto-fire thành nhiều viên đạn thật trong `BulletPool`.
 *
 * Dùng chung cho `game/player-controller.ts` và mọi simulation, nên số viên,
 * góc Twin Shot, crit, pierce/ricochet/homing/explosive không thể lệch giữa
 * "chơi thật" và "đo balance".
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
  /** Hướng đơn vị tới mục tiêu. */
  readonly direction: { readonly x: number; readonly y: number };
  readonly speedTilesPerSecond: number;
  readonly radiusTiles: number;
  readonly ttlMs: number;
}

/** Sinh đạn cho một phát. Trả số viên vừa spawn (>= 1). */
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
