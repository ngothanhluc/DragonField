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
