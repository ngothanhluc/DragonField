/**
 * Living decor (#6): where animals/animated props stand in a room, and how an animal moves.
 * Pure TS: must not import 'cc'.
 *
 * Coordinates: tile units, top-left origin, y down (same as `LevelData`). A decor item's
 * footprint is the 1×1 tile square centred on `at`. Decor has **no collider** and never
 * interacts with combat; it only has to stay off obstacles, spawns and doors.
 *
 * Placement and movement are seeded (`SeededRng`, never `Math.random`) so a room looks the
 * same every time it is entered in a run.
 */
import { type LevelData, type Obstacle } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { SeededRng } from '../rng';
import type { AnimalTuning, DecorSpec } from './atmosphere';

/** Minimum distance (tiles) between a decor item and a spawn / playerStart / bossStart / door. */
export const DECOR_SPAWN_CLEARANCE_TILES = 2;

/** Largest wander leg: an animal stays close to where it was placed (does not drift across the room). */
export const ANIMAL_WANDER_RADIUS_TILES = 2;

/** Idle/wander phase length bounds, ms. */
const IDLE_MIN_MS = 600;
const IDLE_MAX_MS = 1800;
const WANDER_MIN_MS = 800;
const WANDER_MAX_MS = 2000;

/** Wander starts this often; otherwise the animal just idles (a room full of moving animals looks busy). */
const WANDER_CHANCE = 0.55;

/** Max distance per collision sub-step: far below one tile, so a fast animal cannot tunnel a wall. */
const MAX_SUBSTEP_TILES = 0.25;

const EPSILON = 1e-6;

export interface DecorItem {
  readonly kind: 'animal' | 'prop';
  /** Manifest key (`animal.*` or `decor.*`). */
  readonly sprite: string;
  /** Centre of the 1×1 footprint, tile units. */
  readonly at: Vec2;
}

/** 1×1 footprint centred on `at` overlaps the obstacle rectangle by a positive area. */
function footprintHits(at: Vec2, obstacle: Obstacle): boolean {
  return (
    at.x + 0.5 > obstacle.x + EPSILON &&
    at.x - 0.5 < obstacle.x + obstacle.width - EPSILON &&
    at.y + 0.5 > obstacle.y + EPSILON &&
    at.y - 0.5 < obstacle.y + obstacle.height - EPSILON
  );
}

function insideRoom(at: Vec2, level: LevelData): boolean {
  return (
    at.x >= 0.5 - EPSILON &&
    at.x <= level.size.cols - 0.5 + EPSILON &&
    at.y >= 0.5 - EPSILON &&
    at.y <= level.size.rows - 0.5 + EPSILON
  );
}

/** Free floor for a decor footprint: inside the room and off every obstacle. */
function isFree(at: Vec2, level: LevelData): boolean {
  if (!insideRoom(at, level)) return false;
  for (const obstacle of level.obstacles) {
    if (footprintHits(at, obstacle)) return false;
  }
  return true;
}

/**
 * Free floor **and** inside the optional home leash / outside the optional keep-out circle.
 * Combat rooms pass neither, so their animal behaviour is unchanged.
 */
function isValidAt(at: Vec2, context: AnimalContext): boolean {
  if (!isFree(at, context.level)) return false;
  const leash = context.leash;
  if (leash !== undefined && distance(at, leash.center) > leash.radiusTiles + EPSILON) {
    return false;
  }
  const keepOut = context.keepOut;
  if (keepOut !== undefined && distance(at, keepOut.center) < keepOut.radiusTiles) {
    return false;
  }
  return true;
}

/** Spawns, player start, boss start and doors: decor never sits on (or right next to) them. */
function reservedPoints(level: LevelData): Vec2[] {
  const points: Vec2[] = [level.playerStart];
  for (const wave of level.waves) {
    for (const enemy of wave.enemies) points.push(enemy.at);
  }
  for (const door of level.doors) points.push(door.at);
  if (level.bossStart !== undefined) points.push(level.bossStart);
  return points;
}

/** Deterministic in-place Fisher–Yates. */
function shuffle<T>(items: T[], rng: SeededRng): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapWith = rng.int(index + 1);
    const value = items[index]!;
    items[index] = items[swapWith]!;
    items[swapWith] = value;
  }
}

/**
 * Deterministic placement for one room: exactly `spec.animalsPerRoom` animals and
 * `spec.propsPerRoom` props, inside the room, footprint off every obstacle, at least
 * `DECOR_SPAWN_CLEARANCE_TILES` from every enemy spawn (all waves), playerStart, bossStart
 * and door, and footprints not overlapping each other. Same (level, spec, seed) → same result.
 */
export function placeDecor(level: LevelData, spec: DecorSpec, seed: number): DecorItem[] {
  const rng = new SeededRng(seed);
  const reserved = reservedPoints(level);

  // Every tile centre of the room that is free and far enough from a reserved point.
  // Distinct tiles are ≥ 1 apart on an axis, so two picked candidates never overlap.
  const candidates: Vec2[] = [];
  for (let tileY = 0; tileY < level.size.rows; tileY += 1) {
    for (let tileX = 0; tileX < level.size.cols; tileX += 1) {
      const at = { x: tileX + 0.5, y: tileY + 0.5 };
      if (!isFree(at, level)) continue;
      if (reserved.some((point) => distance(at, point) < DECOR_SPAWN_CLEARANCE_TILES)) continue;
      candidates.push(at);
    }
  }

  shuffle(candidates, rng);

  const wanted = spec.animalsPerRoom + spec.propsPerRoom;
  if (candidates.length < wanted) {
    throw new Error(
      `placeDecor: room ${level.id} has ${candidates.length} free tile(s) but the chapter asks ` +
        `for ${wanted} decor item(s) (${spec.animalsPerRoom} animals + ${spec.propsPerRoom} props)`,
    );
  }

  const items: DecorItem[] = [];
  for (let index = 0; index < spec.animalsPerRoom; index += 1) {
    items.push({
      kind: 'animal',
      sprite: rng.pick(spec.animals),
      at: candidates[index]!,
    });
  }
  for (let index = 0; index < spec.propsPerRoom; index += 1) {
    items.push({
      kind: 'prop',
      sprite: rng.pick(spec.props),
      at: candidates[spec.animalsPerRoom + index]!,
    });
  }
  return items;
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

/** A circular area the animal stays inside (e.g. its yard) or outside (e.g. the plaza). */
export interface AnimalBoundary {
  readonly center: Vec2;
  /** Radius in tiles. */
  readonly radiusTiles: number;
}

export interface AnimalContext {
  /** Player position (tile units), or `null` when there is no player (menus). */
  readonly player: Vec2 | null;
  readonly dtMs: number;
  /** Obstacles and room bounds come from here; the footprint never enters an obstacle or leaves the room. */
  readonly level: LevelData;
  readonly tuning: AnimalTuning;
  readonly rng: SeededRng;
  /** Optional home leash: the animal never goes farther than `radiusTiles` from `center`. */
  readonly leash?: AnimalBoundary;
  /** Optional keep-out circle (e.g. the village plaza): the animal never enters it. */
  readonly keepOut?: AnimalBoundary;
}

/** A fresh animal standing idle at `at`. */
export function createAnimal(at: Vec2): AnimalState {
  return { at, mode: 'idle', facing: 1, target: null, timerMs: 0 };
}

/** Facing after a move: only a real horizontal step flips the sprite. */
function facingAfter(from: Vec2, to: Vec2, facing: -1 | 1): -1 | 1 {
  const dx = to.x - from.x;
  if (dx < -EPSILON) return -1;
  if (dx > EPSILON) return 1;
  return facing;
}

/**
 * Move `from` by (dx, dy), cutting the move short on each axis when the new footprint would be
 * invalid (wall slide). Sub-stepped so a large `dtMs` cannot tunnel through an obstacle.
 */
function move(from: Vec2, dx: number, dy: number, valid: (at: Vec2) => boolean): Vec2 {
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return from;

  const steps = Math.max(1, Math.ceil(length / MAX_SUBSTEP_TILES));
  const stepX = dx / steps;
  const stepY = dy / steps;

  let current = from;
  for (let step = 0; step < steps; step += 1) {
    const full = { x: current.x + stepX, y: current.y + stepY };
    if (valid(full)) {
      current = full;
      continue;
    }
    const alongX = { x: current.x + stepX, y: current.y };
    const alongY = { x: current.x, y: current.y + stepY };
    const xOk = stepX !== 0 && valid(alongX);
    const yOk = stepY !== 0 && valid(alongY);
    // Taking **both** single-axis moves composes back into the diagonal that just failed, which
    // is how an animal used to end up inside a corner or a thin (half-tile) prop collider.
    // When both axes are free on their own, slide along X and keep the rest of the step for
    // the next sub-step instead of jumping into the blocked corner.
    if (xOk) current = alongX;
    else if (yOk) current = alongY;
    else break;
  }
  return current;
}

function idleDuration(rng: SeededRng): number {
  return IDLE_MIN_MS + rng.int(IDLE_MAX_MS - IDLE_MIN_MS + 1);
}

function wanderDuration(rng: SeededRng): number {
  return WANDER_MIN_MS + rng.int(WANDER_MAX_MS - WANDER_MIN_MS + 1);
}

/**
 * A wander target close to the animal, never inside the flee radius (so an animal the player
 * has not reached yet never wanders into panic). `null` = stay idle this phase.
 */
function pickWanderTarget(
  at: Vec2,
  context: AnimalContext,
): Vec2 | null {
  const tuning = context.tuning;
  const player = context.player;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const angle = context.rng.next() * Math.PI * 2;
    const radius = ANIMAL_WANDER_RADIUS_TILES * (0.35 + 0.65 * context.rng.next());
    const target = { x: at.x + Math.cos(angle) * radius, y: at.y + Math.sin(angle) * radius };
    if (!isValidAt(target, context)) continue;
    if (player !== null && distance(target, player) <= tuning.fleeRadiusTiles) continue;
    return target;
  }
  return null;
}

/**
 * One pure step. Player within `fleeRadiusTiles` → `flee` straight away from the player at
 * `fleeSpeedTilesPerSec`; otherwise idle/wander at `wanderSpeedTilesPerSec`. A move that
 * would put the footprint inside an obstacle or outside the room is cut short or slid along it.
 */
export function stepAnimal(state: AnimalState, context: AnimalContext): AnimalState {
  const dtMs = Number.isFinite(context.dtMs) ? Math.max(0, context.dtMs) : 0;
  const dtSec = dtMs / 1000;
  const player = context.player;

  // --- Flee: the player is inside the radius. ---------------------------------
  if (player !== null && distance(state.at, player) <= context.tuning.fleeRadiusTiles) {
    const awayX = state.at.x - player.x;
    const awayY = state.at.y - player.y;
    const awayLength = Math.hypot(awayX, awayY);
    // Player exactly on the animal: pick a stable direction instead of dividing by 0.
    const dirX = awayLength > 0 ? awayX / awayLength : 1;
    const dirY = awayLength > 0 ? awayY / awayLength : 0;
    const step = context.tuning.fleeSpeedTilesPerSec * dtSec;
    const next = move(state.at, dirX * step, dirY * step, (at) => isValidAt(at, context));
    return {
      at: next,
      mode: 'flee',
      facing: facingAfter(state.at, next, state.facing),
      target: null,
      timerMs: 0,
    };
  }

  // --- Wander: walk toward the target, re-validating every sub-step against the player ---
  if (state.mode === 'wander' && state.target !== null && state.timerMs > 0) {
    const dx = state.target.x - state.at.x;
    const dy = state.target.y - state.at.y;
    const remaining = Math.hypot(dx, dy);
    const step = Math.min(remaining, context.tuning.wanderSpeedTilesPerSec * dtSec);

    const keptAwayFromPlayer = (at: Vec2): boolean =>
      isValidAt(at, context) &&
      (player === null || distance(at, player) > context.tuning.fleeRadiusTiles);

    const next =
      remaining <= EPSILON
        ? state.at
        : move(state.at, (dx / remaining) * step, (dy / remaining) * step, keptAwayFromPlayer);

    const arrived = distance(next, state.target) <= EPSILON;
    const timerMs = Math.max(0, state.timerMs - dtMs);
    if (arrived || timerMs <= 0) {
      return {
        at: next,
        mode: 'idle',
        facing: facingAfter(state.at, next, state.facing),
        target: null,
        timerMs: idleDuration(context.rng),
      };
    }
    return {
      at: next,
      mode: 'wander',
      facing: facingAfter(state.at, next, state.facing),
      target: state.target,
      timerMs,
    };
  }

  // --- Idle: wait out the timer, then maybe start a short wander. --------------
  const timerMs = Math.max(0, state.timerMs - dtMs);
  if (timerMs > 0) {
    return { at: state.at, mode: 'idle', facing: state.facing, target: null, timerMs };
  }

  if (context.rng.next() >= WANDER_CHANCE) {
    return { at: state.at, mode: 'idle', facing: state.facing, target: null, timerMs: idleDuration(context.rng) };
  }

  const target = pickWanderTarget(state.at, context);
  if (target === null) {
    return { at: state.at, mode: 'idle', facing: state.facing, target: null, timerMs: idleDuration(context.rng) };
  }
  return {
    at: state.at,
    mode: 'wander',
    facing: state.facing,
    target,
    timerMs: wanderDuration(context.rng),
  };
}
