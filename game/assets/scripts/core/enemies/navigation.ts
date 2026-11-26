/**
 * Enemy navigation (M9, ticket #34): nav grid, shared flow field toward the player, line of sight.
 *
 * Why one flow field and not one A* per enemy: every enemy in a room walks toward the same
 * target (the player), so a single Dijkstra run *from* the goal labels every cell with its path
 * distance in one pass. Each enemy only reads `directionAt(position)` — the unit vector toward
 * the cheapest free neighbour — which is the cheapest and least jittery steering signal for a
 * grid this small (32×18).
 *
 * Layers (see the `game-ai` skill):
 * - **path**: `buildNavGrid` (walkable cells for a radius) + `buildFlowField` (distances + direction).
 * - **steer**: `walkTowards` (straight when it can see the target, the field otherwise) and
 *   `separateEnemies` (spatial-hash push apart, never into an obstacle).
 * - **guard**: `StuckGuard` (2 s without progress ⇒ a short 1 s detour).
 *
 * The field is rebuilt only when the player changes tile and at most every
 * `navigation.rebuildMinMs` (config/tuning.json) — `FlowFieldCache` owns that rule, and
 * `RoomNavigation` keeps one grid + cache per enemy radius class for a room.
 *
 * Pure `core/`: no `cc`, no `Math.random` (the sim passes its `SeededRng` through), no clock.
 */
import { firstHit } from '../combat/bullets';
import { obstacleNear, type LevelData } from '../level/level-data';
import type { Vec2 } from '../math/vec2';
import { circleOverlapsObstacle, moveWithCollision } from '../movement/collision';
import { ENEMY_TUNING, type EnemiesTuning } from './tuning';

/** Tile grid; a cell is blocked when a circle of the grid's radius at its centre overlaps an obstacle. */
export interface NavGrid {
  readonly cols: number;
  readonly rows: number;
  isBlocked(col: number, row: number): boolean;
}

/** Shortest-path distances (tiles) from every cell to the goal cell, 8-way, no corner cutting. */
export interface FlowField {
  readonly grid: NavGrid;
  /** Path distance in tiles from the cell to the goal; `Infinity` when unreachable or blocked. */
  distanceAt(col: number, row: number): number;
  /** Unit direction to walk from `position` toward the goal; `null` at the goal or when unreachable. */
  directionAt(position: Vec2): Vec2 | null;
}

/** Cardinal and diagonal steps; diagonal cost is √2 (octile), the order matters only for ties. */
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const DIAGONAL_COST = Math.SQRT2;

/**
 * A straight step that delivers less than this fraction of its length *toward the target*
 * counts as pressed into a face, so the walker follows the flow field instead.
 */
const BLOCKED_STEP_RATIO = 0.5;

/** Spatial-hash cell for separation, tiles (one bucket ≈ one tile, neighbours ≈ one radius). */
const SEPARATION_CELL_TILES = 1;
/** Fraction of the overlap resolved per frame: full resolution would make the pack vibrate. */
const SEPARATION_STRENGTH = 0.5;

/** A tile grid validated once, so `isBlocked` is a single array read. */
class Grid implements NavGrid {
  constructor(
    readonly cols: number,
    readonly rows: number,
    private readonly blocked: Uint8Array,
    readonly radiusTiles: number,
    readonly marginTiles: number,
  ) {}

  isBlocked(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return true;
    return this.blocked[row * this.cols + col] === 1;
  }
}

export function buildNavGrid(level: LevelData, radiusTiles: number, marginTiles: number): NavGrid {
  const cols = level.size.cols;
  const rows = level.size.rows;
  const radius = Math.max(0, radiusTiles);
  const margin = Math.max(0, marginTiles);
  const blocked = new Uint8Array(cols * rows);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const point = { x: col + 0.5, y: row + 0.5 };
      const outsideMargin =
        point.x < margin ||
        point.y < margin ||
        point.x > cols - margin ||
        point.y > rows - margin;
      if (outsideMargin) {
        blocked[row * cols + col] = 1;
        continue;
      }
      for (const obstacle of level.obstacles) {
        if (circleOverlapsObstacle(point, radius, obstacle)) {
          blocked[row * cols + col] = 1;
          break;
        }
      }
    }
  }

  return new Grid(cols, rows, blocked, radius, margin);
}

/** Binary min-heap over cell indices keyed by path cost (no allocation per node). */
class CostHeap {
  private readonly indexes: Int32Array;
  private readonly costs: Float64Array;
  private size = 0;

  constructor(capacity: number) {
    this.indexes = new Int32Array(capacity);
    this.costs = new Float64Array(capacity);
  }

  get isEmpty(): boolean {
    return this.size === 0;
  }

  push(index: number, cost: number): void {
    if (this.size >= this.indexes.length) return;
    let child = this.size;
    this.size += 1;

    while (child > 0) {
      const parent = (child - 1) >> 1;
      if ((this.costs[parent] ?? Infinity) <= cost) break;
      this.indexes[child] = this.indexes[parent] ?? 0;
      this.costs[child] = this.costs[parent] ?? 0;
      child = parent;
    }
    this.indexes[child] = index;
    this.costs[child] = cost;
  }

  /** Cheapest cell index, or -1 when empty. */
  pop(): number {
    if (this.size === 0) return -1;
    const top = this.indexes[0] ?? -1;

    this.size -= 1;
    if (this.size === 0) return top;

    const lastIndex = this.indexes[this.size] ?? 0;
    const lastCost = this.costs[this.size] ?? 0;
    let parent = 0;

    for (;;) {
      let child = parent * 2 + 1;
      if (child >= this.size) break;
      const right = child + 1;
      if (right < this.size && (this.costs[right] ?? Infinity) < (this.costs[child] ?? Infinity)) {
        child = right;
      }
      if ((this.costs[child] ?? Infinity) >= lastCost) break;
      this.indexes[parent] = this.indexes[child] ?? 0;
      this.costs[parent] = this.costs[child] ?? 0;
      parent = child;
    }

    this.indexes[parent] = lastIndex;
    this.costs[parent] = lastCost;
    return top;
  }
}

class Field implements FlowField {
  constructor(
    readonly grid: NavGrid,
    private readonly goalCol: number,
    private readonly goalRow: number,
    private readonly goal: Vec2,
    private readonly distances: Float64Array,
  ) {}

  distanceAt(col: number, row: number): number {
    const { cols, rows } = this.grid;
    if (col < 0 || row < 0 || col >= cols || row >= rows) return Infinity;
    if (this.grid.isBlocked(col, row)) return Infinity;
    return this.distances[row * cols + col] ?? Infinity;
  }

  directionAt(position: Vec2): Vec2 | null {
    const { cols } = this.grid;
    const col = Math.floor(position.x);
    const row = Math.floor(position.y);

    // In the goal cell (and not on the goal): head straight for the player. A blocked start cell
    // (body hugging a wall inside an inflated cell) still routes out through its free neighbours.
    if (col === this.goalCol && row === this.goalRow) {
      const dx = this.goal.x - position.x;
      const dy = this.goal.y - position.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) return null;
      return { x: dx / length, y: dy / length };
    }

    let bestIndex = -1;
    let bestDistance = Infinity;
    let bestCol = 0;
    let bestRow = 0;

    for (const [dc, dr] of STEPS) {
      const nextCol = col + dc;
      const nextRow = row + dr;
      if (this.grid.isBlocked(nextCol, nextRow)) continue;
      if (dc !== 0 && dr !== 0) {
        // No corner cutting: a diagonal step needs both orthogonal neighbours free.
        if (this.grid.isBlocked(col + dc, row) || this.grid.isBlocked(col, row + dr)) continue;
      }
      const index = nextRow * cols + nextCol;
      const distance = this.distances[index] ?? Infinity;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
        bestCol = nextCol;
        bestRow = nextRow;
      }
    }

    if (bestIndex < 0 || !Number.isFinite(bestDistance)) return null;

    const targetX = bestCol + 0.5;
    const targetY = bestRow + 0.5;
    const dx = targetX - position.x;
    const dy = targetY - position.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) {
      // Exactly on the neighbour centroid (rare): aim along the cell-to-cell axis instead.
      const fallbackX = bestCol - col;
      const fallbackY = bestRow - row;
      const fallbackLength = Math.hypot(fallbackX, fallbackY) || 1;
      return { x: fallbackX / fallbackLength, y: fallbackY / fallbackLength };
    }
    return { x: dx / length, y: dy / length };
  }
}

/** Octile Dijkstra from the goal cell; `distanceAt` is the path length, not the straight line. */
export function buildFlowField(grid: NavGrid, goal: Vec2): FlowField {
  const { cols, rows } = grid;
  const count = cols * rows;
  const distances = new Float64Array(count).fill(Infinity);
  const settled = new Uint8Array(count);

  const goalCol = clamp(Math.floor(goal.x), 0, cols - 1);
  const goalRow = clamp(Math.floor(goal.y), 0, rows - 1);
  const goalIndex = goalRow * cols + goalCol;

  // The goal cell may be blocked for the enemy radius (the player hugs a wall, radius 0.25 vs
  // a grid built at 0.4+). It is still the seed, so enemies converge on the player's tile.
  distances[goalIndex] = 0;
  const heap = new CostHeap(count * 8 + 8);
  heap.push(goalIndex, 0);

  while (!heap.isEmpty) {
    const index = heap.pop();
    if (index < 0) break;
    if (settled[index] === 1) continue;
    settled[index] = 1;

    const col = index % cols;
    const row = (index - col) / cols;
    const base = distances[index] ?? Infinity;

    for (const [dc, dr] of STEPS) {
      const nextCol = col + dc;
      const nextRow = row + dr;
      if (grid.isBlocked(nextCol, nextRow)) continue;
      if (dc !== 0 && dr !== 0) {
        if (grid.isBlocked(col + dc, row) || grid.isBlocked(col, row + dr)) continue;
      }

      const nextIndex = nextRow * cols + nextCol;
      if (settled[nextIndex] === 1) continue;

      const cost = base + (dc !== 0 && dr !== 0 ? DIAGONAL_COST : 1);
      if (cost < (distances[nextIndex] ?? Infinity)) {
        distances[nextIndex] = cost;
        heap.push(nextIndex, cost);
      }
    }
  }

  return new Field(grid, goalCol, goalRow, goal, distances);
}

/** True when the straight segment from `from` to `to` crosses no pillar or wall (pits do not block sight). */
export function hasLineOfSight(level: LevelData, from: Vec2, to: Vec2): boolean {
  return firstHit({ from, to }, level) === null;
}

/**
 * Minimum pit span (tiles) that forces walkers onto the flow field immediately instead of trying
 * to slide around it on a straight line. Small pits (2×2 holes, 3×3 ponds) are easily rounded via
 * collision sliding, whereas a wide river/chasm barrier (`>= 4` tiles) requires routing over a
 * bridge so walkers on the far bank never oscillate against the shoreline.
 */
const WIDE_PIT_SPAN_TILES = 4;

/**
 * True when the straight segment from `from` to `to` crosses no solid wall/pillar AND no wide
 * `pit` barrier (`>= 4` tiles). Keeps small-obstacle steering unchanged while ensuring walkers
 * across a Chapter 2 river immediately follow the flow field over a bridge.
 */
function hasWalkLineOfSight(level: LevelData, from: Vec2, to: Vec2): boolean {
  if (!hasLineOfSight(level, from, to)) return false;

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  for (const obstacle of level.obstacles) {
    if (obstacle.kind !== 'pit') continue;
    if (Math.max(obstacle.width, obstacle.height) < WIDE_PIT_SPAN_TILES) continue;

    let enter = 0;
    let exit = 1;
    const minX = obstacle.x;
    const maxX = obstacle.x + obstacle.width;
    const minY = obstacle.y;
    const maxY = obstacle.y + obstacle.height;

    if (Math.abs(dx) < 1e-12) {
      if (from.x < minX || from.x > maxX) continue;
    } else {
      const t1 = (minX - from.x) / dx;
      const t2 = (maxX - from.x) / dx;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) continue;
    }

    if (Math.abs(dy) < 1e-12) {
      if (from.y < minY || from.y > maxY) continue;
    } else {
      const t1 = (minY - from.y) / dy;
      const t2 = (maxY - from.y) / dy;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) continue;
    }

    return false;
  }
  return true;
}

/**
 * Keeps one flow field toward the player and rebuilds it only when the player changes tile and at
 * least `minRebuildMs` has passed since the last rebuild.
 */
export class FlowFieldCache {
  private builds = 0;
  private current: FlowField | null = null;
  private lastBuildMs = 0;
  private lastCol = 0;
  private lastRow = 0;

  constructor(
    private readonly grid: NavGrid,
    private readonly minRebuildMs: number,
  ) {}

  /** Returns the current field, rebuilding it when the rule above allows. */
  update(player: Vec2, nowMs: number): FlowField {
    const col = Math.floor(player.x);
    const row = Math.floor(player.y);
    const first = this.current === null;
    const tileChanged = col !== this.lastCol || row !== this.lastRow;
    const throttlePassed = nowMs - this.lastBuildMs >= Math.max(0, this.minRebuildMs);

    if (first || (tileChanged && throttlePassed)) {
      this.current = buildFlowField(this.grid, player);
      this.builds += 1;
      this.lastBuildMs = nowMs;
      this.lastCol = col;
      this.lastRow = row;
    }

    // `first` guarantees a field; assertion keeps the return type honest without an optional.
    return this.current as FlowField;
  }

  /** How many times the field has been built (tests and the debug overlay read it). */
  get rebuildCount(): number {
    return this.builds;
  }
}

/**
 * One room's navigation: a grid + flow-field cache per enemy radius class.
 *
 * The grid is inflated by the walker's radius, so a chaser (0.4) can slip through a gap a brute
 * (0.4 × 1.75) cannot; building the grid at the largest radius for everyone would wall off cells
 * the small enemies can use. Both callers (the balance sim and `EnemyView`) get their field from
 * here, so they steer identically.
 */
export class RoomNavigation {
  private readonly caches = new Map<number, FlowFieldCache>();

  constructor(
    private readonly level: LevelData,
    private readonly marginTiles: number,
    private readonly minRebuildMs: number,
  ) {}

  /** Current field for a walker of `radiusTiles`; rebuilds at most once per throttle window. */
  field(radiusTiles: number, player: Vec2, nowMs: number): FlowField {
    const key = Math.round(Math.max(0, radiusTiles) * 100) / 100;
    let cache = this.caches.get(key);
    if (cache === undefined) {
      const grid = buildNavGrid(this.level, key, this.marginTiles);
      cache = new FlowFieldCache(grid, this.minRebuildMs);
      this.caches.set(key, cache);
    }
    return cache.update(player, nowMs);
  }
}

export interface WalkStepArgs {
  readonly position: Vec2;
  readonly target: Vec2;
  /** Field toward the player (from `RoomNavigation.field`). */
  readonly field: FlowField;
  /** Walk distance this frame, tiles (speed × dt, already scaled by Freeze). */
  readonly maxDistanceTiles: number;
  readonly radiusTiles: number;
  readonly level: LevelData;
  readonly marginTiles: number;
  /** Active stuck-guard detour; overrides the field for its 1 s. */
  readonly detour?: Vec2 | null;
}

/**
 * Walk toward `target` by at most `maxDistanceTiles`: straight while the target is in sight and
 * the step is not pressed into a face, otherwise along the flow field. Never ends inside an
 * obstacle (both paths go through `moveWithCollision`), never overshoots the target.
 */
export function walkTowards(args: WalkStepArgs): Vec2 {
  const { position, target, field, radiusTiles, level, marginTiles } = args;
  const speed = Math.max(0, args.maxDistanceTiles);
  const detour = args.detour ?? null;
  if (!(speed > 0)) return { x: position.x, y: position.y };

  if (detour !== null) {
    return moveWithCollision(
      position,
      { x: detour.x * speed, y: detour.y * speed },
      radiusTiles,
      level,
      marginTiles,
    );
  }

  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const gap = Math.hypot(dx, dy);
  if (!(gap > 0)) return { x: position.x, y: position.y };

  const step = Math.min(speed, gap);
  const unitX = dx / gap;
  const unitY = dy / gap;
  const straight = moveWithCollision(
    position,
    { x: unitX * step, y: unitY * step },
    radiusTiles,
    level,
    marginTiles,
  );

  const progress = (straight.x - position.x) * unitX + (straight.y - position.y) * unitY;
  if (
    hasWalkLineOfSight(level, position, target) &&
    progress >= BLOCKED_STEP_RATIO * step
  ) {
    return straight;
  }

  const direction = field.directionAt(position);
  if (direction === null) return straight;

  return moveWithCollision(
    position,
    { x: direction.x * step, y: direction.y * step },
    radiusTiles,
    level,
    marginTiles,
  );
}

/** One body taking part in separation. */
export interface SeparationBody {
  readonly id: string;
  readonly position: Vec2;
  readonly radiusTiles: number;
}

/**
 * Spatial-hash bucket id for a tile cell. Numeric so the per-frame separation pass does not
 * allocate a string per body (`rows` is 18, so 1024 is far above the column count).
 */
function bucketKey(col: number, row: number): number {
  return col * 1024 + row;
}

/** Deterministic unit vector for two bodies sharing one point (no `Math.random` in core). */
function fallbackNormal(first: string, second: string): Vec2 {
  const angle = ((hashString(first) * 31 + hashString(second)) % 360) * (Math.PI / 180);
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Deterministic per-enemy flank side (`-1` left / `+1` right) so approaching chasers spread
 * around the player instead of stacking in a single-file line (M13, GDD §15.3).
 */
export function flankSideFor(enemyId: string): -1 | 1 {
  return hashString(enemyId) % 2 === 0 ? -1 : 1;
}

/** Clearance checked around a candidate flank point so chasers never aim into a wall/pillar. */
const FLANK_CLEARANCE_TILES = 0.75;

/**
 * Mid-range flanking walk target for a chaser (M13):
 * - Inside `flankMinDistanceTiles`: collapses straight onto `player` to finish the strike.
 * - Outside `flankMaxDistanceTiles`: heads straight toward `player` (flow-field approach).
 * - In between: offsets laterally on the enemy's deterministic flank side (`-1` / `+1`),
 *   peaking smoothly at mid-range and staying closer to the player than `position` so chasers
 *   arc in from both sides without ever orbiting indefinitely.
 * - If the primary flank point is blocked by an obstacle/wall, tries the opposite side, then
 *   falls back cleanly to `player`.
 */
export function computeFlankTarget(
  position: Vec2,
  player: Vec2,
  enemyId: string,
  level: LevelData,
  tuning: EnemiesTuning = ENEMY_TUNING,
): Vec2 {
  const margin = tuning.roomEdgeMarginTiles;
  const clampedPlayer = clampPoint(level, player, margin);

  const dx = clampedPlayer.x - position.x;
  const dy = clampedPlayer.y - position.y;
  const gap = Math.hypot(dx, dy);

  const { flankMinDistanceTiles, flankMaxDistanceTiles, flankAngleRadians, flankOffsetTiles } =
    tuning.ai;
  if (
    gap <= flankMinDistanceTiles ||
    gap >= flankMaxDistanceTiles ||
    flankMaxDistanceTiles <= flankMinDistanceTiles ||
    flankOffsetTiles <= 0 ||
    flankAngleRadians <= 0 ||
    !hasWalkLineOfSight(level, position, clampedPlayer)
  ) {
    return clampedPlayer;
  }

  // Smooth arch peaking at the middle of the mid-range band and tapering to 0 at both edges.
  const t = (gap - flankMinDistanceTiles) / (flankMaxDistanceTiles - flankMinDistanceTiles);
  const arch = Math.sin(Math.PI * t);
  const lateral = Math.min(flankOffsetTiles, gap * Math.sin(flankAngleRadians)) * arch;
  if (lateral < 1e-4) return clampedPlayer;

  const unitX = dx / gap;
  const unitY = dy / gap;
  const ahead = Math.max(0.5, gap * 0.65);
  const primarySide = flankSideFor(enemyId);

  for (const side of [primarySide, (primarySide * -1) as -1 | 1]) {
    const perpX = -unitY * side;
    const perpY = unitX * side;
    const candidate = clampPoint(
      level,
      {
        x: position.x + unitX * ahead + perpX * lateral,
        y: position.y + unitY * ahead + perpY * lateral,
      },
      margin,
    );
    if (
      obstacleNear(level, candidate, FLANK_CLEARANCE_TILES) === null &&
      hasWalkLineOfSight(level, position, candidate)
    ) {
      return candidate;
    }
  }

  return clampedPlayer;
}

function clampPoint(level: LevelData, point: Vec2, margin: number): Vec2 {
  const maxX = Math.max(margin, level.size.cols - margin);
  const maxY = Math.max(margin, level.size.rows - margin);
  return {
    x: clamp(point.x, margin, maxX),
    y: clamp(point.y, margin, maxY),
  };
}

/**
 * Push apart bodies closer than the sum of their radii (spatial hash, cell ≈ 1 tile, so it is
 * not O(n²) over the whole room). The push of each body goes through `moveWithCollision`, so a
 * body never ends up inside an obstacle or outside the room margin.
 *
 * Returns the new position of every body that moved, keyed by id; the caller writes them back.
 */
export function separateEnemies(
  bodies: readonly SeparationBody[],
  level: LevelData,
  marginTiles: number,
): Map<string, Vec2> {
  const moved = new Map<string, Vec2>();
  if (bodies.length < 2) return moved;

  const buckets = new Map<number, number[]>();
  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    if (body === undefined) continue;
    const key = bucketKey(
      Math.floor(body.position.x / SEPARATION_CELL_TILES),
      Math.floor(body.position.y / SEPARATION_CELL_TILES),
    );
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [index]);
    else bucket.push(index);
  }

  const pushX = new Float64Array(bodies.length);
  const pushY = new Float64Array(bodies.length);

  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    if (body === undefined) continue;
    const col = Math.floor(body.position.x / SEPARATION_CELL_TILES);
    const row = Math.floor(body.position.y / SEPARATION_CELL_TILES);

    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        const bucket = buckets.get(bucketKey(col + dc, row + dr));
        if (bucket === undefined) continue;

        for (const otherIndex of bucket) {
          // Each pair once: the smaller index owns it.
          if (otherIndex <= index) continue;
          const other = bodies[otherIndex];
          if (other === undefined) continue;

          const dx = other.position.x - body.position.x;
          const dy = other.position.y - body.position.y;
          const gap = Math.hypot(dx, dy);
          const minimum = body.radiusTiles + other.radiusTiles;
          if (gap >= minimum) continue;

          const overlap = (minimum - gap) * SEPARATION_STRENGTH;
          const normal =
            gap > 1e-6
              ? { x: dx / gap, y: dy / gap }
              : fallbackNormal(body.id, other.id);

          pushX[index] = (pushX[index] ?? 0) - normal.x * overlap * 0.5;
          pushY[index] = (pushY[index] ?? 0) - normal.y * overlap * 0.5;
          pushX[otherIndex] = (pushX[otherIndex] ?? 0) + normal.x * overlap * 0.5;
          pushY[otherIndex] = (pushY[otherIndex] ?? 0) + normal.y * overlap * 0.5;
        }
      }
    }
  }

  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    if (body === undefined) continue;
    const dx = pushX[index] ?? 0;
    const dy = pushY[index] ?? 0;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;

    moved.set(
      body.id,
      moveWithCollision(body.position, { x: dx, y: dy }, body.radiusTiles, level, marginTiles),
    );
  }

  return moved;
}

/** A random free neighbour cell of `position` as a unit direction, or `null` when boxed in. */
export function randomDetourDirection(
  field: FlowField,
  position: Vec2,
  random: () => number,
): Vec2 | null {
  const grid = field.grid;
  const col = Math.floor(position.x);
  const row = Math.floor(position.y);
  const choices: Vec2[] = [];

  for (const [dc, dr] of STEPS) {
    const nextCol = col + dc;
    const nextRow = row + dr;
    if (grid.isBlocked(nextCol, nextRow)) continue;
    if (dc !== 0 && dr !== 0) {
      if (grid.isBlocked(col + dc, row) || grid.isBlocked(col, row + dr)) continue;
    }
    if (!Number.isFinite(field.distanceAt(nextCol, nextRow))) continue;
    choices.push({ x: nextCol + 0.5, y: nextRow + 0.5 });
  }

  if (choices.length === 0) return null;
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
  const target = choices[index];
  if (target === undefined) return null;

  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  return { x: dx / length, y: dy / length };
}

interface StuckWindow {
  sinceMs: number;
  fromX: number;
  fromY: number;
  detour: Vec2 | null;
  detourUntilMs: number;
}

/**
 * Per-enemy stuck guard: while walking, if the body covers less than `minMoveTiles` in
 * `stuckMs`, switch to a random-free-neighbour detour for `detourMs` instead of pressing on.
 *
 * The field already routes around walls; this is the safety net for the cases a grid cannot see
 * (bodies packed in a doorway, an inflated grid that closes a gap the real body fits through).
 */
export class StuckGuard {
  private readonly windows = new Map<string, StuckWindow>();

  constructor(
    private readonly stuckMs: number,
    private readonly minMoveTiles: number,
    private readonly detourMs: number,
  ) {}

  /** Forget one enemy (death) or the whole room (call `clear()`). */
  forget(id: string): void {
    this.windows.delete(id);
  }

  clear(): void {
    this.windows.clear();
  }

  /**
   * Active detour direction for this frame, or `null` to follow the field.
   * `walking` false (idle/telegraph/charge) resets the measuring window.
   */
  update(
    id: string,
    position: Vec2,
    walking: boolean,
    nowMs: number,
    field: FlowField,
    random: () => number,
  ): Vec2 | null {
    if (!walking) {
      this.windows.delete(id);
      return null;
    }

    const entry = this.windows.get(id);
    if (entry === undefined) {
      this.windows.set(id, {
        sinceMs: nowMs,
        fromX: position.x,
        fromY: position.y,
        detour: null,
        detourUntilMs: 0,
      });
      return null;
    }

    if (entry.detour !== null && nowMs < entry.detourUntilMs) return entry.detour;

    entry.detour = null;

    if (nowMs - entry.sinceMs < this.stuckMs) return null;

    const travelled = Math.hypot(position.x - entry.fromX, position.y - entry.fromY);
    if (travelled < this.minMoveTiles) {
      entry.detour = randomDetourDirection(field, position, random);
      entry.detourUntilMs = nowMs + this.detourMs;
    }

    entry.sinceMs = nowMs;
    entry.fromX = position.x;
    entry.fromY = position.y;

    return entry.detour;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
