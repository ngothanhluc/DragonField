/**
 * Living menu backdrop (#8), pure side: which chapter room the title / chapter select show
 * behind the panel, and where the idle NinjaGreen stands so the panel does not hide it.
 *
 * Coordinates are `LevelData` tiles (top-left origin, y down), the same space as
 * `LevelData.playerStart` and `Obstacle`. The adapter converts with `tileToWorld`.
 */
import { ROOM_COLS, ROOM_ROWS } from '../level/level-data';
import { distanceSquared, type Vec2 } from '../math/vec2';

/** The room of a chapter drawn behind the menus. */
export const MENU_BACKDROP_ROOM = 1;

export type MenuBackdropScreen = 'title' | 'chapter-select';

export interface MenuBackdropChapterInput {
  readonly screen: MenuBackdropScreen;
  /** Chapter of the focused chapter button; `null` when focus is on a non-chapter button (Back). */
  readonly focusedChapter: number | null;
  /** Chapter currently drawn behind the menu; `null` when nothing is drawn yet. */
  readonly current: number | null;
  /** Whether the chapter has level data in this build. */
  readonly hasData: (chapter: number) => boolean;
}

/** Axis-aligned rectangle in `LevelData` tiles (top-left corner + size), like `Obstacle`. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What `menuPlayerSpot` needs from a room. */
export interface MenuRoom {
  readonly playerStart: Vec2;
  readonly obstacles: readonly TileRect[];
  /** Room size in tiles (a normal room may be several screens, ADR-018); defaults to one screen. */
  readonly size?: { readonly cols: number; readonly rows: number };
}

/** A point is clear of a rectangle when it is at least `margin` tiles away on some side. */
function isClearOf(point: Vec2, rect: TileRect, margin: number): boolean {
  return (
    point.x <= rect.x - margin ||
    point.x >= rect.x + rect.width + margin ||
    point.y <= rect.y - margin ||
    point.y >= rect.y + rect.height + margin
  );
}

export function menuBackdropChapter(input: MenuBackdropChapterInput): number {
  if (input.screen === 'title') return MENU_BACKDROP_ROOM;

  const focused = input.focusedChapter;
  if (focused !== null && input.hasData(focused)) return focused;

  const current = input.current;
  if (current !== null && input.hasData(current)) return current;

  return MENU_BACKDROP_ROOM;
}

/** Whole tiles the ninja's feet may occupy: room for the sprite inside one screen. */
const MIN_FEET_X = 1;
const MIN_FEET_Y = 2;

/**
 * Where the idle ninja stands so the panel does not hide it. Keeps `playerStart` when that spot
 * is already 1 tile clear of the panel; otherwise the closest whole tile that is 1 tile clear of
 * the panel and of every obstacle (ties broken by smaller y, then smaller x → deterministic).
 * Falls back to `playerStart` when the room has no free tile at all.
 */
export function menuPlayerSpot(room: MenuRoom, keepOut: TileRect): Vec2 {
  const start = room.playerStart;
  if (isClearOf(start, keepOut, 1)) return start;

  const maxFeetX = (room.size?.cols ?? ROOM_COLS) - 1;
  const maxFeetY = (room.size?.rows ?? ROOM_ROWS) - 1;
  let best: Vec2 | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let y = MIN_FEET_Y; y <= maxFeetY; y += 1) {
    for (let x = MIN_FEET_X; x <= maxFeetX; x += 1) {
      const spot: Vec2 = { x, y };
      if (!isClearOf(spot, keepOut, 1)) continue;
      if (!room.obstacles.every((obstacle) => isClearOf(spot, obstacle, 1))) continue;

      const distance = distanceSquared(spot, start);
      // Iteration order is y then x, so a strict comparison keeps the first on a tie.
      if (distance < bestDistance) {
        best = spot;
        bestDistance = distance;
      }
    }
  }

  return best ?? start;
}
