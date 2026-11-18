import type { Vec2 } from '../math/vec2';
import { FireControl } from './fire-control';
import { findNearestTarget, type Targetable } from './targeting';

/** The bullet the engine needs to spawn this frame. */
export interface ShotIntent {
  readonly targetId: string;
  /** Unit vector from `origin` to the target. */
  readonly direction: Vec2;
  readonly origin: Vec2;
}

export interface AutoFireUpdateArgs {
  readonly deltaMs: number;
  readonly origin: Vec2;
  readonly targets: readonly Targetable[];
  /** Auto-aim range, in tiles (see `CombatConfig.targetingRangeTiles`). */
  readonly rangeTiles: number;
}

/** Default direction when the player stands on the target (no defined direction). */
const FALLBACK_DIRECTION: Vec2 = { x: 1, y: 0 };

function directionTo(origin: Vec2, target: Vec2): Vec2 {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return FALLBACK_DIRECTION;
  return { x: dx / length, y: dy / length };
}

/**
 * Auto-fire at the nearest enemy in range (GDD §3).
 *
 * The order of checks matters: find the target **before** ticking the cooldown.
 * If the cooldown ticked first, every frame without an enemy would still drain it, so the first
 * shot would be delayed by up to a second after an enemy appears. Checking first makes the
 * shot land on the very first frame a target exists.
 */
export class AutoFire {
  private readonly fireControl: FireControl;

  constructor(fireControl: FireControl | number) {
    this.fireControl =
      typeof fireControl === 'number' ? FireControl.fromRate(fireControl) : fireControl;
  }

  static fromRate(fireRatePerSecond: number): AutoFire {
    return new AutoFire(FireControl.fromRate(fireRatePerSecond));
  }

  update(args: AutoFireUpdateArgs): ShotIntent | null {
    const target = findNearestTarget(args.origin, args.targets, args.rangeTiles);
    if (target === null) return null;

    if (!this.fireControl.tick(args.deltaMs)) return null;

    return {
      targetId: target.id,
      direction: directionTo(args.origin, target.position),
      origin: args.origin,
    };
  }
}
