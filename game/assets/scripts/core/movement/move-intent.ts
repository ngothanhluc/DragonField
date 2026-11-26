import { DEFAULT_COMBAT } from '../config';
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

/**
 * Effective player movement speed with M17 out-of-combat room-clear boost (`×1.45` from
 * `config/tuning.json`). Strictly `baseSpeed` during combat / Boss fights (`boostActive === false`).
 */
export function effectiveMoveSpeed(
  baseSpeedTilesPerSecond: number,
  boostActive: boolean,
  multiplier: number = DEFAULT_COMBAT.roomClearSpeedMultiplier,
): number {
  const safeBase = Number.isFinite(baseSpeedTilesPerSecond) ? Math.max(0, baseSpeedTilesPerSecond) : 0;
  if (!boostActive) return safeBase;
  const safeMult = Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : 1;
  return safeBase * safeMult;
}

/**
 * Pure state machine for the M17 room-clear movement speed boost (+45% out-of-combat).
 *
 * Activates on combat room clear (`onCombatRoomCleared`) and resets immediately on entering the
 * next room (`onEnterRoom`) so the boost never leaks into combat or Boss fights.
 */
export class RoomClearSpeedBoost {
  private boostActive = false;

  constructor(private readonly boostMultiplier: number = DEFAULT_COMBAT.roomClearSpeedMultiplier) {}

  get active(): boolean {
    return this.boostActive;
  }

  get multiplier(): number {
    return this.boostActive ? this.boostMultiplier : 1;
  }

  /** Activate boost when a combat room clears (all waves spawned and 0 enemies remaining). */
  onCombatRoomCleared(): void {
    this.boostActive = true;
  }

  /** Reset boost immediately on entering any next room (combat, special, or boss). */
  onEnterRoom(): void {
    this.boostActive = false;
  }

  /** Apply boost (if active) to `baseSpeedTilesPerSecond`. */
  apply(baseSpeedTilesPerSecond: number): number {
    return effectiveMoveSpeed(baseSpeedTilesPerSecond, this.boostActive, this.boostMultiplier);
  }
}
