/**
 * Living menu backdrop (#8, refined in M11 T5), pure side:
 * - which chapter room the Title / Chapter Select screens show behind the panel,
 * - which 32×18 interior window (`menuBackdropFrame`) frames the chapter's upgraded 64×36 room
 *   cleanly without outer wall/door-gap crops or visual clutter behind the menu column,
 * - where the idle character stands (`menuPlayerSpot` / `menuFramedPlayerSpot`) so the panel and
 *   obstacles never hide or clip it.
 *
 * Coordinates are `LevelData` tiles (top-left origin, y down), the same space as
 * `LevelData.playerStart` and `Obstacle`. The adapter converts with `tileToWorld` / frame offsets.
 */
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../level/level-data';
import { propDef } from '../level/props';
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

/** Optional obstacle/prop metadata `menuBackdropFrame` uses when framing a multi-screen room. */
export interface MenuObstacle extends TileRect {
  readonly kind?: string;
}

export interface MenuPlacedProp {
  readonly key: string;
  readonly x: number;
  readonly y: number;
}

/** What `menuPlayerSpot` and `menuBackdropFrame` read from a room. */
export interface MenuRoom {
  readonly chapter?: number;
  readonly playerStart: Vec2;
  readonly obstacles: readonly MenuObstacle[];
  readonly props?: readonly MenuPlacedProp[];
  /** Room size in tiles (a normal room may be several screens, ADR-018); defaults to one screen. */
  readonly size?: { readonly cols: number; readonly rows: number };
}

export interface MenuBackdropFrameOptions {
  /** Water rectangles of the room (e.g. Ch2 river/waterfall), in tile units. */
  readonly waterAreas?: readonly TileRect[];
  /**
   * Conservative width of the centred menu column in room tiles. Defaults to `20` (matching the
   * 252 px UI column at `worldScale = 0.8` on 1920×1080 and 1280×720) so scored landmarks stay
   * visible on both flanks at every supported resolution.
   */
  readonly columnWidthTiles?: number;
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

interface PropFootprint {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly weight: number;
  readonly large: boolean;
}

function describeProp(chapter: number, prop: MenuPlacedProp): PropFootprint {
  const def = propDef(chapter, prop.key);
  const width = def === undefined ? 1 : def.rect.width / TILE_SIZE_PX;
  const height = def === undefined ? 1 : def.rect.height / TILE_SIZE_PX;
  const large =
    width >= 2.5 || height >= 2.5 || /house|tower|cluster|tent|mill/.test(prop.key);
  const weight = /house|tower|tent|statue|campfire|mill/.test(prop.key)
    ? 3.2
    : /tree|palm/.test(prop.key)
      ? 2.4
      : 1.1;

  return {
    left: prop.x,
    right: prop.x + width,
    top: prop.y,
    bottom: prop.y + height,
    weight,
    large,
  };
}

/**
 * Pick a clean, integer-tile `32×18` camera window inside `room` for the living menu backdrop.
 *
 * - Single-screen rooms (`≤ 32×18`) keep `{ x: 0, y: 0, width: cols, height: rows }`.
 * - Multi-screen rooms (e.g. `64×36`, M9/M11) inset away from the 2-tile outer wall/door-cutout
 *   border, reward uncropped chapter landmarks (trees, ruins, palms, rivers, oasis pits) in both
 *   visible flanks beside the centred menu column, and penalize large structures poking out from
 *   behind the menu column or getting sliced at the viewport edge.
 */
export function menuBackdropFrame(
  room: MenuRoom,
  options: MenuBackdropFrameOptions = {},
): TileRect {
  const cols = room.size?.cols ?? ROOM_COLS;
  const rows = room.size?.rows ?? ROOM_ROWS;
  if (cols <= ROOM_COLS && rows <= ROOM_ROWS) {
    return { x: 0, y: 0, width: cols, height: rows };
  }

  const viewCols = Math.min(ROOM_COLS, cols);
  const viewRows = Math.min(ROOM_ROWS, rows);
  const borderX = cols >= ROOM_COLS + 6 ? 3 : Math.max(0, Math.floor((cols - viewCols) / 2));
  const borderY = rows >= ROOM_ROWS + 6 ? 3 : Math.max(0, Math.floor((rows - viewRows) / 2));
  const minX = borderX;
  const maxX = Math.max(minX, cols - viewCols - borderX);
  const minY = borderY;
  const maxY = Math.max(minY, rows - viewRows - borderY);

  const colWidth = Math.min(
    viewCols - 6,
    Math.max(8, Math.ceil(options.columnWidthTiles ?? 20)),
  );
  const flankWidth = (viewCols - colWidth) / 2;
  const chapter = room.chapter ?? 1;
  const props = (room.props ?? []).map((prop) => describeProp(chapter, prop));
  const waterAreas = options.waterAreas ?? [];
  const pits = room.obstacles.filter((obstacle) => obstacle.kind === 'pit');

  const centreX = cols / 2;
  const centreY = rows / 2;
  let bestX = Math.round((minX + maxX) / 2);
  let bestY = Math.round((minY + maxY) / 2);
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let fy = minY; fy <= maxY; fy += 1) {
    for (let fx = minX; fx <= maxX; fx += 1) {
      let leftScore = 0;
      let rightScore = 0;
      let penalty = 0;
      const colLeft = fx + flankWidth;
      const colRight = fx + viewCols - flankWidth;

      for (const prop of props) {
        if (
          prop.right <= fx ||
          prop.left >= fx + viewCols ||
          prop.bottom <= fy ||
          prop.top >= fy + viewRows
        ) {
          continue;
        }
        // Penalize props sliced in half by the outer viewport border.
        if (
          prop.left < fx + 0.25 ||
          prop.right > fx + viewCols - 0.25 ||
          prop.top < fy + 0.25 ||
          prop.bottom > fy + viewRows - 0.25
        ) {
          penalty += prop.large ? 2.2 : 0.65;
          continue;
        }

        const cx = (prop.left + prop.right) / 2;
        if (prop.right <= colLeft + 0.5) {
          leftScore += prop.weight;
        } else if (prop.left >= colRight - 0.5) {
          rightScore += prop.weight;
        } else if (prop.left < colLeft && prop.right > colLeft) {
          // Straddling the left edge of the menu column: small bush is fine, large roof/cluster is visual clutter.
          if (prop.large) penalty += 2.4;
          else leftScore += prop.weight * 0.35;
        } else if (prop.left < colRight && prop.right > colRight) {
          if (prop.large) penalty += 2.4;
          else rightScore += prop.weight * 0.35;
        } else if (prop.large) {
          penalty += 1.0;
        } else if (cx < fx + viewCols / 2) {
          leftScore += prop.weight * 0.15;
        } else {
          rightScore += prop.weight * 0.15;
        }
      }

      for (const water of waterAreas) {
        const ox1 = Math.max(fx + 0.5, water.x);
        const ox2 = Math.min(fx + viewCols - 0.5, water.x + water.width);
        const oy1 = Math.max(fy + 1, water.y);
        const oy2 = Math.min(fy + viewRows - 1, water.y + water.height);
        if (ox2 > ox1 && oy2 > oy1) {
          const leftTiles = Math.max(0, Math.min(colLeft, ox2) - ox1) * (oy2 - oy1);
          const rightTiles = Math.max(0, ox2 - Math.max(colRight, ox1)) * (oy2 - oy1);
          leftScore += Math.min(8, leftTiles * 0.9);
          rightScore += Math.min(8, rightTiles * 0.9);
        }
      }

      for (const pit of pits) {
        if (
          pit.x >= fx + 0.5 &&
          pit.x + pit.width <= fx + viewCols - 0.5 &&
          pit.y >= fy + 1 &&
          pit.y + pit.height <= fy + viewRows - 1
        ) {
          const cx = pit.x + pit.width / 2;
          if (cx <= colLeft) leftScore += 3.5;
          else if (cx >= colRight) rightScore += 3.5;
        }
      }

      const balanceBonus = Math.min(leftScore, rightScore) * 1.6;
      const distFromCentre = Math.hypot(fx + viewCols / 2 - centreX, fy + viewRows / 2 - centreY);
      const score = leftScore + rightScore + balanceBonus - penalty - distFromCentre * 0.12;

      if (score > bestScore) {
        bestScore = score;
        bestX = fx;
        bestY = fy;
      }
    }
  }

  return { x: bestX, y: bestY, width: viewCols, height: viewRows };
}

/**
 * Pick where the idle character stands in `room` when viewing `frame`, keeping it strictly inside
 * the visible flanks of `frame` (clear of `localKeepOut`, obstacles, and water areas).
 */
export function menuFramedPlayerSpot(
  room: MenuRoom,
  frame: TileRect,
  localKeepOut: TileRect,
  waterAreas: readonly TileRect[] = [],
): Vec2 {
  const keepOutInRoom: TileRect = {
    x: frame.x + localKeepOut.x,
    y: frame.y + localKeepOut.y,
    width: localKeepOut.width,
    height: localKeepOut.height,
  };

  const minX = Math.ceil(frame.x + 2);
  const maxX = Math.floor(frame.x + frame.width - 2);
  const minY = Math.ceil(frame.y + 3);
  const maxY = Math.floor(frame.y + frame.height - 2);

  // Anchor search near the lower-middle foreground beside the menu column so the character stands naturally in view.
  const anchor: Vec2 = {
    x: frame.x + frame.width / 2,
    y: frame.y + Math.round(frame.height * 0.62),
  };

  const start = room.playerStart;
  if (
    start.x >= minX &&
    start.x <= maxX &&
    start.y >= minY &&
    start.y <= maxY &&
    isClearOf(start, keepOutInRoom, 1) &&
    room.obstacles.every((obstacle) => isClearOf(start, obstacle, 1)) &&
    waterAreas.every((water) => isClearOf(start, water, 1))
  ) {
    return start;
  }

  let best: Vec2 | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const spot: Vec2 = { x, y };
      if (!isClearOf(spot, keepOutInRoom, 1)) continue;
      if (!room.obstacles.every((obstacle) => isClearOf(spot, obstacle, 1))) continue;
      if (!waterAreas.every((water) => isClearOf(spot, water, 1))) continue;

      const distance = distanceSquared(spot, anchor);
      if (distance < bestDistance) {
        best = spot;
        bestDistance = distance;
      }
    }
  }

  if (best !== null) return best;

  // Fallback inside frame ignoring water if an entire flank is flooded, then general menuPlayerSpot.
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const spot: Vec2 = { x, y };
      if (!isClearOf(spot, keepOutInRoom, 1)) continue;
      if (!room.obstacles.every((obstacle) => isClearOf(spot, obstacle, 1))) continue;
      return spot;
    }
  }

  return menuPlayerSpot(room, keepOutInRoom);
}
