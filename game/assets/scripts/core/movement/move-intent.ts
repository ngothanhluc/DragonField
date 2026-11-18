import type { Vec2 } from '../math/vec2';

/** State of the 4 movement keys within one frame. */
export interface MoveInput {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
}

/** cos(45°) = sin(45°), used to normalise a diagonal vector. */
const DIAGONAL_COMPONENT = Math.SQRT1_2;

/**
 * Turn WASD keys into an 8-way vector of length at most 1.
 *
 * Opposite keys cancel each other out (A + D = 0), so no key priority handling is needed.
 * The diagonal vector is normalised so diagonal speed equals straight speed (GDD §3).
 */
export function normalizeMoveInput(input: MoveInput): Vec2 {
  const x = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const y = (input.up ? 1 : 0) - (input.down ? 1 : 0);

  if (x === 0 && y === 0) return { x: 0, y: 0 };
  if (x !== 0 && y !== 0) return { x: x * DIAGONAL_COMPONENT, y: y * DIAGONAL_COMPONENT };
  return { x, y };
}

/** Multiply a direction vector (length ≤ 1) by tile/second speed to get velocity. */
export function velocityFromInput(input: Vec2, speedTilesPerSecond: number): Vec2 {
  return { x: input.x * speedTilesPerSecond, y: input.y * speedTilesPerSecond };
}
