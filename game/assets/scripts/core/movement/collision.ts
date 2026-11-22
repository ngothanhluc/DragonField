/**
 * Actor movement against obstacles and the room edge (M9, ticket #33).
 *
 * One rule for the player, every enemy and the balance sim: a circle actor walks up to an
 * obstacle and slides along it instead of sticking or passing through.
 *
 * Technique (see the `physics-tuning` skill, "stop tunnelling"):
 *
 * - The move is split into sub-steps shorter than the thinnest obstacle (1 tile), so a long
 *   frame can never jump across a pillar.
 * - After each sub-step every overlapping circle/rect pair is resolved along the shortest
 *   exit (minimum translation), which keeps the component along the wall and rounds corners.
 * - Contact (`gap == radius`) is **not** an overlap, so an actor touching a wall can keep
 *   sliding along it.
 * - The centre is clamped to `[marginTiles, size - marginTiles]` of the room.
 */
import type { LevelData, Obstacle } from '../level/level-data';
import type { Vec2 } from '../math/vec2';

/**
 * Longest distance one sub-step may cover, tiles. Smaller than the thinnest obstacle + the
 * actor diameter, so a circle can never jump across a rect in one sub-step (no tunnelling).
 */
const MAX_SUBSTEP_TILES = 0.25;

/**
 * A requested step that delivers less than this fraction of its length *toward the target*
 * counts as a head-on press (the walker routes around the blocker). Anything above it still
 * slides along the face, which keeps diagonal contacts smooth.
 */
const BLOCKED_STEP_RATIO = 0.5;

/** Below this a step counts as "did not move" (pressed into a face). */
const MOVE_EPSILON_TILES = 1e-9;

/**
 * Move a circle actor of radius `radiusTiles` from `position` by `delta` (tiles), never ending
 * overlapping an obstacle (any kind, pits included) and keeping the centre inside
 * `[marginTiles, size - marginTiles]` of the room. Each sub-step exits an overlap along the
 * shortest path, so a push into a wall keeps its along-wall component (slides) and corners
 * round off. Must not tunnel through a 1-tile obstacle however long `delta` is. Pure: never
 * mutates its inputs.
 */
export function moveWithCollision(
  position: Vec2,
  delta: Vec2,
  radiusTiles: number,
  level: LevelData,
  marginTiles: number,
): Vec2 {
  const radius = Math.max(0, radiusTiles);
  const margin = Math.max(0, marginTiles);
  const minX = margin;
  const maxX = Math.max(minX, level.size.cols - margin);
  const minY = margin;
  const maxY = Math.max(minY, level.size.rows - margin);

  const distance = Math.hypot(delta.x, delta.y);
  const steps = Math.max(1, Math.ceil(distance / MAX_SUBSTEP_TILES));
  const stepX = delta.x / steps;
  const stepY = delta.y / steps;

  let x = clamp(position.x, minX, maxX);
  let y = clamp(position.y, minY, maxY);

  for (let step = 0; step < steps; step += 1) {
    x = clamp(x + stepX, minX, maxX);
    y = clamp(y + stepY, minY, maxY);

    for (const obstacle of level.obstacles) {
      const resolved = pushOut({ x, y }, radius, obstacle);
      x = clamp(resolved.x, minX, maxX);
      y = clamp(resolved.y, minY, maxY);
    }
  }

  return { x, y };
}

/**
 * Walk toward `target` by at most `maxDistance` tiles, going around a blocker.
 *
 * `moveWithCollision` alone wedges a walker that meets a face head-on: the step has no
 * along-wall component, so it presses there forever and never reaches its target (a room
 * behind such a wall can then never clear, because bullets stop on the same wall). A diagonal
 * contact still slides, as before. A head-on contact follows a coarse tile route (breadth-first
 * over free tiles) so the walker goes around the blocker. Full enemy navigation is a later
 * ticket; this is the smallest thing that keeps a room clearable.
 *
 * Never overshoots the target, never mutates its inputs, and the result obeys the same
 * no-overlap rule as `moveWithCollision`.
 */
export function moveTowardsWithCollision(
  position: Vec2,
  target: Vec2,
  maxDistance: number,
  radiusTiles: number,
  level: LevelData,
  marginTiles: number,
): Vec2 {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const gap = Math.hypot(dx, dy);
  if (!(gap > 0) || !(maxDistance > 0)) return { x: position.x, y: position.y };

  const speed = Math.min(maxDistance, gap);
  const unitX = dx / gap;
  const unitY = dy / gap;
  const straight = moveWithCollision(
    position,
    { x: unitX * speed, y: unitY * speed },
    radiusTiles,
    level,
    marginTiles,
  );

  // How much of the requested step the straight move actually delivered *toward the target*.
  const progress = (straight.x - position.x) * unitX + (straight.y - position.y) * unitY;
  if (progress >= BLOCKED_STEP_RATIO * speed) return straight;

  const waypoint = nextWaypoint(position, target, radiusTiles, level, marginTiles);
  if (waypoint === null) return straight;

  const toWaypointX = waypoint.x - position.x;
  const toWaypointY = waypoint.y - position.y;
  const toWaypoint = Math.hypot(toWaypointX, toWaypointY);
  if (!(toWaypoint > 0)) return straight;

  const step = Math.min(speed, toWaypoint);
  const around = moveWithCollision(
    position,
    { x: (toWaypointX / toWaypoint) * step, y: (toWaypointY / toWaypoint) * step },
    radiusTiles,
    level,
    marginTiles,
  );
  if (movedFrom(position, around)) return around;

  // Cornered: keep whatever little the straight step managed.
  return straight;
}

/** The four tile neighbours, cardinal only so a route never cuts a corner. */
const TILE_STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Scratch space for `nextWaypoint`. The grid is a fixed 32×18, so after the first blocked
 * frame the route search allocates nothing (the game loop must not churn the GC).
 */
let routeNext = new Int32Array(0);
const routeQueue: number[] = [];

/**
 * Centre of the first tile on a breadth-first route from the walker's tile to the target's
 * tile, or `null` when they share a tile / the target tile is blocked.
 *
 * A room is 32×18 tiles and obstacles are sparse, so a full BFS is cheap and it cannot wedge
 * (unlike a local slide rule) — which is what keeps the balance sim's rooms clearable.
 */
function nextWaypoint(
  position: Vec2,
  target: Vec2,
  radiusTiles: number,
  level: LevelData,
  marginTiles: number,
): Vec2 | null {
  const cols = level.size.cols;
  const rows = level.size.rows;
  const startCol = clamp(Math.floor(position.x), 0, cols - 1);
  const startRow = clamp(Math.floor(position.y), 0, rows - 1);
  const goalCol = clamp(Math.floor(target.x), 0, cols - 1);
  const goalRow = clamp(Math.floor(target.y), 0, rows - 1);
  const startIndex = startRow * cols + startCol;
  const goalIndex = goalRow * cols + goalCol;
  if (startIndex === goalIndex) return null;
  if (!tileIsFree(goalCol, goalRow, radiusTiles, level, marginTiles)) return null;

  const count = cols * rows;
  if (routeNext.length < count) routeNext = new Int32Array(count);
  /** Tile to move to from each visited tile, or -1. */
  const next = routeNext;
  next.fill(-1, 0, count);

  const queue = routeQueue;
  queue.length = 0;
  queue.push(goalIndex);

  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head] as number;
    if (index === startIndex) break;
    const col = index % cols;
    const row = (index - col) / cols;

    for (const [stepCol, stepRow] of TILE_STEPS) {
      const neighbourCol = col + stepCol;
      const neighbourRow = row + stepRow;
      if (neighbourCol < 0 || neighbourCol >= cols) continue;
      if (neighbourRow < 0 || neighbourRow >= rows) continue;

      const neighbour = neighbourRow * cols + neighbourCol;
      if ((next[neighbour] ?? -1) >= 0 || neighbour === goalIndex) continue;
      if (!tileIsFree(neighbourCol, neighbourRow, radiusTiles, level, marginTiles)) continue;

      next[neighbour] = index;
      queue.push(neighbour);
    }
  }

  const first = next[startIndex] ?? -1;
  if (first < 0) return null;
  const firstCol = first % cols;
  const firstRow = (first - firstCol) / cols;
  return { x: firstCol + 0.5, y: firstRow + 0.5 };
}

/** Can the centre of tile `(col, row)` hold a circle of `radiusTiles`? */
function tileIsFree(
  col: number,
  row: number,
  radiusTiles: number,
  level: LevelData,
  marginTiles: number,
): boolean {
  const margin = Math.max(0, marginTiles);
  const point = { x: col + 0.5, y: row + 0.5 };
  if (point.x < margin || point.x > level.size.cols - margin) return false;
  if (point.y < margin || point.y > level.size.rows - margin) return false;

  return level.obstacles.every(
    (obstacle) => !circleOverlapsObstacle(point, radiusTiles, obstacle),
  );
}

/** Did the actor move at all? A step pressed into a face returns the same point. */
function movedFrom(from: Vec2, to: Vec2): boolean {
  return Math.abs(to.x - from.x) > MOVE_EPSILON_TILES || Math.abs(to.y - from.y) > MOVE_EPSILON_TILES;
}

/**
 * Shortest way out of `obstacle` for a circle of `radius` centred on `point`.
 *
 * The nearest point of the rectangle is the contact point; when the centre is farther than
 * `radius` away there is no overlap (contact included) and the point is returned untouched.
 * Exiting along that normal is what makes an actor slide along a face while its tangential
 * component is kept.
 */
function pushOut(point: Vec2, radius: number, obstacle: Obstacle): Vec2 {
  const right = obstacle.x + obstacle.width;
  const bottom = obstacle.y + obstacle.height;
  const nearest = nearestPointOn(point, obstacle);
  const nearestX = nearest.x;
  const nearestY = nearest.y;
  const dx = point.x - nearestX;
  const dy = point.y - nearestY;
  const gap = Math.hypot(dx, dy);

  if (gap >= radius) return point;

  if (gap > 0) {
    const scale = radius / gap;
    return { x: nearestX + dx * scale, y: nearestY + dy * scale };
  }

  // Centre inside the rectangle (authored spawn on an obstacle): leave by the nearest face.
  const toLeft = point.x - obstacle.x;
  const toRight = right - point.x;
  const toTop = point.y - obstacle.y;
  const toBottom = bottom - point.y;
  const nearestSide = Math.min(toLeft, toRight, toTop, toBottom);

  if (nearestSide === toLeft) return { x: obstacle.x - radius, y: point.y };
  if (nearestSide === toRight) return { x: right + radius, y: point.y };
  if (nearestSide === toTop) return { x: point.x, y: obstacle.y - radius };
  return { x: point.x, y: bottom + radius };
}

/** Nearest point of the (closed) rectangle to `point`; the point itself when it is inside. */
function nearestPointOn(point: Vec2, obstacle: Obstacle): Vec2 {
  return {
    x: clamp(point.x, obstacle.x, obstacle.x + obstacle.width),
    y: clamp(point.y, obstacle.y, obstacle.y + obstacle.height),
  };
}

/**
 * Does the circle of `radiusTiles` around `point` overlap `obstacle`? Contact (gap exactly
 * `radiusTiles`) is **not** an overlap, so an actor touching a wall may stay there.
 */
export function circleOverlapsObstacle(
  point: Vec2,
  radiusTiles: number,
  obstacle: Obstacle,
): boolean {
  const radius = Math.max(0, radiusTiles);
  const nearest = nearestPointOn(point, obstacle);
  return Math.hypot(point.x - nearest.x, point.y - nearest.y) < radius;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
