/**
 * Living menu backdrop (#8), pure side: which chapter room the title / chapter select show
 * behind the panel, and where the idle NinjaGreen stands so the panel does not hide it.
 *
 * Coordinates are `LevelData` tiles (top-left origin, y down), the same space as
 * `LevelData.playerStart` and `Obstacle`. The adapter converts with `tileToWorld`.
 */
import type { Vec2 } from '../math/vec2';

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
}

export function menuBackdropChapter(input: MenuBackdropChapterInput): number {
  void input;
  throw new Error('not implemented');
}

export function menuPlayerSpot(room: MenuRoom, keepOut: TileRect): Vec2 {
  void room;
  void keepOut;
  throw new Error('not implemented');
}
