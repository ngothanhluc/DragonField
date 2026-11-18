/**
 * Living decor (#6): where animals/animated props stand in a room, and how an animal moves.
 * STUB written by the orchestrator with the agreed signatures only; the executor implements it.
 * Pure TS: must not import 'cc'.
 *
 * Coordinates: tile units, top-left origin, y down (same as `LevelData`). A decor item's
 * footprint is the 1×1 tile square centred on `at`. Decor has **no collider** and never
 * interacts with combat; it only has to stay off obstacles, spawns and doors.
 */
import type { LevelData } from '../level/level-data';
import type { Vec2 } from '../math/vec2';
import type { SeededRng } from '../rng';
import type { AnimalTuning, DecorSpec } from './atmosphere';

/** Minimum distance (tiles) between a decor item and a spawn / playerStart / bossStart / door. */
export const DECOR_SPAWN_CLEARANCE_TILES = 2;

export interface DecorItem {
  readonly kind: 'animal' | 'prop';
  /** Manifest key (`animal.*` or `decor.*`). */
  readonly sprite: string;
  /** Centre of the 1×1 footprint, tile units. */
  readonly at: Vec2;
}

/**
 * Deterministic placement for one room: exactly `spec.animalsPerRoom` animals and
 * `spec.propsPerRoom` props, inside the room, footprint off every obstacle, at least
 * `DECOR_SPAWN_CLEARANCE_TILES` from every enemy spawn (all waves), playerStart, bossStart
 * and door, and footprints not overlapping each other. Same (level, spec, seed) → same result.
 */
export function placeDecor(_level: LevelData, _spec: DecorSpec, _seed: number): DecorItem[] {
  throw new Error('not implemented');
}

export type AnimalMode = 'idle' | 'wander' | 'flee';

export interface AnimalState {
  readonly at: Vec2;
  readonly mode: AnimalMode;
  /** Facing for the sprite flip: -1 left, 1 right. */
  readonly facing: -1 | 1;
  /** Current wander target, if any. */
  readonly target: Vec2 | null;
  /** Time left in the current idle/wander phase, ms. */
  readonly timerMs: number;
}

export interface AnimalContext {
  /** Player position (tile units), or `null` when there is no player (menus). */
  readonly player: Vec2 | null;
  readonly dtMs: number;
  /** Obstacles and room bounds come from here; the footprint never enters an obstacle or leaves the room. */
  readonly level: LevelData;
  readonly tuning: AnimalTuning;
  readonly rng: SeededRng;
}

/** A fresh animal standing idle at `at`. */
export function createAnimal(_at: Vec2): AnimalState {
  throw new Error('not implemented');
}

/**
 * One pure step. Player within `fleeRadiusTiles` → `flee` straight away from the player at
 * `fleeSpeedTilesPerSec`; otherwise idle/wander at `wanderSpeedTilesPerSec`. A move that
 * would put the footprint inside an obstacle or outside the room is cut short or slid along it.
 */
export function stepAnimal(_state: AnimalState, _context: AnimalContext): AnimalState {
  throw new Error('not implemented');
}
