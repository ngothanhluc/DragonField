/**
 * 13-piece "blob" autotiling for the ground patches and the trail (M10, ticket #67). Pure `core/`:
 * no `cc`.
 *
 * A patch is a boolean mask of map cells. Every cell of the patch is drawn with one of the 13
 * pieces of a terrain block in `TilesetFloor.png`; the piece is chosen from the eight neighbours,
 * so a patch edge always meets the base floor with the right corner/edge art instead of ending in
 * a hard square.
 *
 * `TilesetFloor.png` lays every terrain out as an 11×7 block (22-column sheet), verified from the
 * pixel transparency:
 *
 * ```text
 *   NW  N  NE  .  .  iNE  iNW       outer 3×3 at columns 0-2, rows 0-2
 *    W  C   E  .  .  iSE  iSW       inner corners at (6,2) NW, (5,2) NE, (6,1) SW, (5,1) SE
 *   SW  S  SE  .  .   .    .        (the "notch" piece has the outside in that one corner)
 * ```
 *
 * Blob ids, as the acceptance test states them: `1 2 3 / 6 7 8 / 11 12 13` are the outer
 * corners/edges/centre and `4 5 / 9 10` the inner corners — `4` = outside diagonal NW, `5` = NE,
 * `9` = SW, `10` = SE. Every terrain block also has the surrounding terrain **baked in** (e.g. the
 * dirt block's fringe is the dark grass it is meant to lie on), so a room picks the block that
 * matches its base floor.
 *
 * The generator only ever writes cells that sit in a full 2×2 block (the 13-piece layout cannot
 * draw a 1-cell strip), which `normalizePatchMask` enforces.
 */

/** One patch: `cells[y * cols + x]` is `true` where the patch covers the map. Outside = outside. */
export interface PatchMask {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly boolean[];
}

/** One terrain block of a sheet: the `.tsx` next to the rooms and its 13 local tile ids. */
export interface GroundTerrain {
  /** `.tsx` file name next to the rooms, e.g. `tilefloor.tsx`. */
  readonly tileset: string;
  /** `tiles[blob - 1]` = 1-based local tile id inside `tileset`. Always 13 entries. */
  readonly tiles: readonly number[];
  /**
   * 1-based local id (same `tileset`) of the flat tile the block's fringe is baked on. The room's
   * base floor must be exactly this tile, or every patch shows the block's background as a box.
   */
  readonly plain: number;
}

/** Columns of `TilesetFloor.png` (22 × 16 px = 352 px wide, 26 rows tall). */
export const TILEFLOOR_COLUMNS = 22;

function inside(mask: PatchMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.cols || y >= mask.rows) return false;
  return mask.cells[y * mask.cols + x] === true;
}

/**
 * Blob id of the cell `(x, y)`: `0` when the cell is off the patch, else `1..13`
 * (the sheet layout above). Orthogonal outsides win over missing diagonals, so a cell with two
 * outside sides is an outer corner even when its diagonal is also outside.
 */
export function pickBlobTile(mask: PatchMask, x: number, y: number): number {
  if (!inside(mask, x, y)) return 0;

  const north = !inside(mask, x, y - 1);
  const south = !inside(mask, x, y + 1);
  const west = !inside(mask, x - 1, y);
  const east = !inside(mask, x + 1, y);

  if (north && west) return 1;
  if (north && east) return 3;
  if (south && west) return 11;
  if (south && east) return 13;
  if (north) return 2;
  if (south) return 12;
  if (west) return 6;
  if (east) return 8;

  if (!inside(mask, x - 1, y - 1)) return 4;
  if (!inside(mask, x + 1, y - 1)) return 5;
  if (!inside(mask, x - 1, y + 1)) return 9;
  if (!inside(mask, x + 1, y + 1)) return 10;
  return 7;
}

/** True when the 2×2 block with top-left `(x, y)` is fully inside the patch. */
function fullBlock(cells: readonly boolean[], cols: number, rows: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x + 1 >= cols || y + 1 >= rows) return false;
  const at = (px: number, py: number): boolean => cells[py * cols + px] === true;
  return at(x, y) && at(x + 1, y) && at(x, y + 1) && at(x + 1, y + 1);
}

/**
 * Drop every cell no fully-filled 2×2 block covers, and repeat until stable (removing a cell can
 * empty a block that covered another one). Strips, single cells and diagonal touches disappear.
 */
export function normalizePatchMask(mask: PatchMask): PatchMask {
  const { cols, rows } = mask;
  let cells = Array.from({ length: cols * rows }, (_, index) => mask.cells[index] === true);

  for (;;) {
    const next = cells.slice();
    let changed = false;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (!cells[y * cols + x]) continue;
        const covered =
          fullBlock(cells, cols, rows, x, y) ||
          fullBlock(cells, cols, rows, x - 1, y) ||
          fullBlock(cells, cols, rows, x, y - 1) ||
          fullBlock(cells, cols, rows, x - 1, y - 1);
        if (!covered) {
          next[y * cols + x] = false;
          changed = true;
        }
      }
    }
    cells = next;
    if (!changed) return { cols, rows, cells };
  }
}

/**
 * The 13 blob ids of the terrain block whose top-left tile is `(blockCol, blockRow)`, in blob
 * order 1..13. The block layout (`outer 3×3` + four inner corners) is explained in the header.
 */
export function floorBlockTiles(blockCol: number, blockRow: number): readonly number[] {
  const local = (col: number, row: number): number => (blockRow + row) * TILEFLOOR_COLUMNS + (blockCol + col) + 1;
  return [
    local(0, 0), // 1  NW corner
    local(1, 0), // 2  N edge
    local(2, 0), // 3  NE corner
    local(6, 2), // 4  inner: outside diagonal NW
    local(5, 2), // 5  inner: outside diagonal NE
    local(0, 1), // 6  W edge
    local(1, 1), // 7  centre
    local(2, 1), // 8  E edge
    local(6, 1), // 9  inner: outside diagonal SW
    local(5, 1), // 10 inner: outside diagonal SE
    local(0, 2), // 11 SW corner
    local(1, 2), // 12 S edge
    local(2, 2), // 13 SE corner
  ];
}

/**
 * The patch terrain of each chapter, chosen so its baked fringe matches that chapter's base floor
 * (R8 of the #67 review: a block drawn over the wrong floor shows its baked background as a hard
 * square box around every patch and path edge):
 * - ch1: brown dirt `9c6546` on the dark forest grass `74a334` (`tilefloor` 276),
 * - ch2: lush river-valley meadow `adbc3a` (`tilefloor` 265) matching `TilesetWater` grass banks,
 * - ch3: worn brown dirt `bd7959` on the mossy olive grass `adbc3a` (`tilefloor` 265), matching
 *   the Ninja Adventure abandoned village demo,
 * - ch4: pale sand `ffcb8d` on the warm desert sand `ffad5d` (`tilefloor` 111).
 *
 * `plain` is the block's baked background, and the generator sets the room's base floor to exactly
 * that tile, so a patch meets the floor without a seam.
 */
export const GROUND_TERRAINS: Readonly<Record<number, GroundTerrain>> = {
  1: { tileset: 'tilefloor.tsx', tiles: floorBlockTiles(11, 7), plain: 276 },
  2: { tileset: 'tilefloor.tsx', tiles: floorBlockTiles(0, 7), plain: 265 },
  3: { tileset: 'tilefloor.tsx', tiles: floorBlockTiles(0, 7), plain: 265 },
  4: { tileset: 'tilefloor.tsx', tiles: floorBlockTiles(0, 0), plain: 111 },
};
