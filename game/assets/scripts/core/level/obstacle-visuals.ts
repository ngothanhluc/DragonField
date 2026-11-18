/**
 * How each obstacle kind is drawn, per chapter (M8).
 *
 * Pure data + lookup: no `cc` import, so vitest can pin the values without the engine
 * (the `dress-ch3` acceptance test and `obstacle-visuals.test.ts` do exactly that).
 * `level-view.ts` slices these rectangles into `SpriteFrame`s.
 *
 * Chapter 1–2 keep the original Nature boulders / Element crate; chapter 3 uses the
 * abandoned-village stone props and the TilesetHole pit frame.
 */
import type { ObstacleKind } from './level-data';

/** A pixel cell in a sheet, **top-left** origin (same convention as `manifest.frameRect`). */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ObstacleVisual {
  readonly sheet: string;
  readonly rect: TileRect;
  /** `true` = repeat the tile across the rect; `false` = stretch the frame 1:1 over the obstacle. */
  readonly tile: boolean;
}

export type ObstacleVisualKey = ObstacleKind | 'pillarSmall';

const NATURE = 'resources/art/tilesets/TilesetNature.png';
const ELEMENT = 'resources/art/tilesets/TilesetElement.png';
const VILLAGE = 'resources/art/tilesets/TilesetVillageAbandoned.png';
const HOLE = 'resources/art/tilesets/TilesetHole.png';

/** Pixel cell of a gid (1-based) in a sheet with `columns` columns. */
export function tileRectFromGid(columns: number, gid: number): TileRect {
  const index = Math.max(0, gid - 1);
  return {
    x: (index % columns) * 16,
    y: Math.floor(index / columns) * 16,
    width: 16,
    height: 16,
  };
}

export const BOUNDS = {
  boulder: { x: 240, y: 224, width: 32, height: 32 },
  smallRock: { x: 256, y: 192, width: 16, height: 16 },
  natureWall: { x: 272, y: 208, width: 16, height: 16 },
  crate: { x: 112, y: 0, width: 16, height: 16 },
  stone: tileRectFromGid(33, 22),
  stoneAlt: tileRectFromGid(33, 23),
  hole: tileRectFromGid(11, 13),
  /** VillageAbandoned col 2 row 5: base of the tall stone column. */
  villageStone: tileRectFromGid(20, 103),
  /** VillageAbandoned col 3 row 5: broken mossy stone. */
  villageBrokenStone: tileRectFromGid(20, 104),
  /** VillageAbandoned col 2 rows 4–5: the full-height stone column (1×2 pillar). */
  villageColumn: { x: 32, y: 64, width: 16, height: 32 },
  /** TilesetHole 2×2 frame that reads as a pit. */
  holePit: { x: 0, y: 16, width: 32, height: 32 },
} as const satisfies Record<string, TileRect>;

export const OBSTACLE_VISUALS: Readonly<
  Record<number, Readonly<Record<ObstacleVisualKey, ObstacleVisual>>>
> = {
  1: {
    pillar: { sheet: NATURE, rect: BOUNDS.boulder, tile: false },
    pillarSmall: { sheet: ELEMENT, rect: BOUNDS.crate, tile: true },
    wall: { sheet: NATURE, rect: BOUNDS.natureWall, tile: true },
    pit: { sheet: NATURE, rect: BOUNDS.boulder, tile: false },
  },
  2: {
    pillar: { sheet: NATURE, rect: BOUNDS.boulder, tile: false },
    pillarSmall: { sheet: ELEMENT, rect: BOUNDS.crate, tile: true },
    wall: { sheet: NATURE, rect: BOUNDS.natureWall, tile: true },
    pit: { sheet: NATURE, rect: BOUNDS.boulder, tile: false },
  },
  3: {
    pillar: { sheet: VILLAGE, rect: BOUNDS.villageColumn, tile: false },
    pillarSmall: { sheet: VILLAGE, rect: BOUNDS.villageStone, tile: true },
    wall: { sheet: VILLAGE, rect: BOUNDS.villageBrokenStone, tile: true },
    pit: { sheet: HOLE, rect: BOUNDS.holePit, tile: false },
  },
};

/** Visual for one obstacle in a chapter; unknown chapters fall back to chapter 1. */
export function obstacleVisual(chapter: number, key: ObstacleVisualKey): ObstacleVisual {
  return (OBSTACLE_VISUALS[chapter] ?? OBSTACLE_VISUALS[1]!)[key];
}

/** Every obstacle sheet that must be preloaded for a chapter. */
export function obstacleSheets(chapter: number): string[] {
  const visuals = OBSTACLE_VISUALS[chapter] ?? OBSTACLE_VISUALS[1]!;
  return Array.from(new Set(Object.values(visuals).map((visual) => visual.sheet)));
}
