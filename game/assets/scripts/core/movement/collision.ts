/**
 * Actor movement against obstacles and the room edge (M9, ticket #33).
 *
 * STUB written with the red acceptance test: it moves without any collision. The executor
 * replaces the body; the signature is the agreed seam.
 */
import type { LevelData } from '../level/level-data';
import type { Vec2 } from '../math/vec2';

/**
 * Move a circle actor of radius `radiusTiles` from `position` by `delta` (tiles), never ending
 * overlapping an obstacle (any kind, pits included) and keeping the centre inside
 * `[marginTiles, size - marginTiles]` of the room. Resolved per axis so a push into a wall
 * keeps the along-wall component (slides). Must not tunnel through a 1-tile obstacle however
 * long `delta` is. Pure: never mutates its inputs.
 */
export function moveWithCollision(
  position: Vec2,
  delta: Vec2,
  radiusTiles: number,
  level: LevelData,
  marginTiles: number,
): Vec2 {
  void radiusTiles;
  void level;
  void marginTiles;
  return { x: position.x + delta.x, y: position.y + delta.y };
}
