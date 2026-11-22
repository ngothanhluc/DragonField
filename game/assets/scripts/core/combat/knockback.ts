/**
 * Knockback: push an actor away from the damage source over a short time.
 *
 * Pure functions, tile-unit coordinates (y pointing down), same system as `LevelData`. No
 * `cc` import, no clock reads — the caller passes `deltaMs` and keeps the state.
 *
 * Two separate steps so the adapter controls the lifecycle:
 *
 * 1. `startKnockback()` locks the **direction** at the moment of the hit. A source at the same
 *    position as the actor (no defined direction) returns `null` instead of dividing by 0.
 * 2. `stepKnockback()` each frame: move along that direction, stop just before an obstacle and
 *    never leave the room. Returns the next state, `null` when the time is up
 *    or it is blocked.
 *
 * Why sample along the path instead of only checking the end point: one knockback frame
 * can be longer than the thinnest obstacle (1 tile), and "stop at the last valid end point" would
 * teleport through a pillar. The sample step `KNOCKBACK_SAMPLE_STEP_TILES` is many times
 * smaller than that thickness.
 */
import type { LevelData } from '../level/level-data';
import { obstacleAt } from '../level/level-data';
import type { Vec2 } from '../math/vec2';
import { circleOverlapsObstacle } from '../movement/collision';

/** Distance + duration of one push. */
export interface KnockbackConfig {
  /** Total distance, tiles. */
  readonly distanceTiles: number;
  /** Time to cover the distance, ms. */
  readonly durationMs: number;
}

/** The running push. `direction` is a unit vector, constant for the whole push. */
export interface KnockbackState {
  readonly direction: Vec2;
  /** Constant speed, tiles/second. */
  readonly speedTilesPerSecond: number;
  /** Remaining time, ms; always > 0 while the state is alive. */
  readonly remainingMs: number;
}

export interface KnockbackStepResult {
  readonly position: Vec2;
  /** `null` when the push finished or was just blocked by an obstacle/wall. */
  readonly state: KnockbackState | null;
}

/** Sampling step when sweeping the push path, tiles. Less than 1 tile so it cannot pass a pillar. */
export const KNOCKBACK_SAMPLE_STEP_TILES = 0.05;

/** Below this threshold the two points count as coincident (no direction). */
const MIN_SOURCE_DISTANCE_TILES = 1e-9;

/**
 * Start a push from `source` toward `position` (pushing **away** from the source).
 *
 * Returns `null` when the config is invalid (distance/duration <= 0) or the source
 * coincides with the actor — none of those has a defined push direction.
 */
export function startKnockback(
  position: Vec2,
  source: Vec2,
  config: KnockbackConfig,
): KnockbackState | null {
  if (!(config.distanceTiles > 0) || !(config.durationMs > 0)) return null;

  const dx = position.x - source.x;
  const dy = position.y - source.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < MIN_SOURCE_DISTANCE_TILES) return null;

  return {
    direction: { x: dx / length, y: dy / length },
    speedTilesPerSecond: config.distanceTiles / (config.durationMs / 1000),
    remainingMs: config.durationMs,
  };
}

/**
 * One frame of the push. Never mutates `position` or the input `state`.
 *
 * `marginTiles` is the wall margin the actor centre must keep (player/enemy use
 * `ROOM_EDGE_MARGIN_TILES`); default 0 = only needs to stay inside the room.
 *
 * `radiusTiles` is the actor's collision radius: the **whole circle** must stay out of an
 * obstacle, not just its centre (ticket #33). Default 0 = the centre is the circle, which is
 * what the pre-collision behaviour did.
 */
export function stepKnockback(
  position: Vec2,
  state: KnockbackState,
  deltaMs: number,
  level: LevelData,
  marginTiles = 0,
  radiusTiles = 0,
): KnockbackStepResult {
  if (!(deltaMs > 0)) return { position, state };

  const radius = Math.max(0, radiusTiles);
  const elapsedMs = Math.min(deltaMs, state.remainingMs);
  const distance = state.speedTilesPerSecond * (elapsedMs / 1000);
  const steps = Math.max(1, Math.ceil(distance / KNOCKBACK_SAMPLE_STEP_TILES));

  const minX = Math.max(0, marginTiles);
  const maxX = Math.max(minX, level.size.cols - minX);
  const minY = Math.max(0, marginTiles);
  const maxY = Math.max(minY, level.size.rows - minY);

  let current: Vec2 = { x: position.x, y: position.y };

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const next: Vec2 = {
      x: position.x + state.direction.x * distance * progress,
      y: position.y + state.direction.y * distance * progress,
    };

    if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY) {
      // Hit a wall: place flush against the edge (if the edge is free) and stop.
      const edge: Vec2 = {
        x: clamp(next.x, minX, maxX),
        y: clamp(next.y, minY, maxY),
      };
      if (isFree(level, edge, radius)) current = edge;
      return { position: current, state: null };
    }

    if (!isFree(level, next, radius)) {
      // Keep the last valid point, do not pass through an obstacle.
      return { position: current, state: null };
    }

    current = next;
  }

  const remainingMs = state.remainingMs - elapsedMs;
  return {
    position: current,
    state: remainingMs > 0 ? { ...state, remainingMs } : null,
  };
}

/** No obstacle centre-inside and no overlap with the actor's circle. */
function isFree(level: LevelData, point: Vec2, radiusTiles: number): boolean {
  if (obstacleAt(level, point) !== null) return false;
  return level.obstacles.every(
    (obstacle) => !circleOverlapsObstacle(point, radiusTiles, obstacle),
  );
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
