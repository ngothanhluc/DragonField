/**
 * The rectangle of the world the player can see this frame, in tiles (y down) — the same space as
 * `LevelData` and `core/camera/follow-camera.ts`.
 *
 * Two fairness rules of M9 (#41) are pure geometry on it, so they live here instead of inside the
 * enemy behaviour or the wave scheduler (which would make either module import the other):
 *
 * - `canAttackFrom`: an enemy may fire, charge or pounce only while it is on screen, shrunk by a
 *   one-tile inset so a shot never starts half off the edge.
 * - `insideViewRect`: whether a point (a spawn) is currently visible, which decides whether it
 *   needs a spawn telegraph.
 */
import type { ViewRect } from '../camera/follow-camera';
import { ROOM_COLS, ROOM_ROWS, type RoomSize } from '../level/level-data';
import type { Vec2 } from '../math/vec2';

/** Default inset: a whole tile inside the edge, so a shot from "the border" cannot happen. */
export const VIEW_INSET_TILES = 1;

/** Closed rectangle test: a point on the edge still counts as visible. */
export function insideViewRect(point: Vec2, view: ViewRect): boolean {
  return (
    point.x >= view.x &&
    point.x <= view.x + view.width &&
    point.y >= view.y &&
    point.y <= view.y + view.height
  );
}

/** An enemy may fire, charge or pounce only while inside the view (shrunk by `insetTiles`). */
export function canAttackFrom(
  position: Vec2,
  view: ViewRect,
  insetTiles = VIEW_INSET_TILES,
): boolean {
  const inset = Math.max(0, insetTiles);
  return (
    position.x >= view.x + inset &&
    position.x <= view.x + view.width - inset &&
    position.y >= view.y + inset &&
    position.y <= view.y + view.height - inset
  );
}

/**
 * One screen (32×18) centred on `centre` and clamped to the room: the view the player sees when no
 * camera is supplied (the balance simulation; `CombatLoop` falls back to it without a camera).
 */
export function screenViewAround(centre: Vec2, room: RoomSize): ViewRect {
  const width = Math.min(ROOM_COLS, room.cols);
  const height = Math.min(ROOM_ROWS, room.rows);
  return {
    x: Math.min(Math.max(centre.x - width / 2, 0), Math.max(0, room.cols - width)),
    y: Math.min(Math.max(centre.y - height / 2, 0), Math.max(0, room.rows - height)),
    width,
    height,
  };
}
