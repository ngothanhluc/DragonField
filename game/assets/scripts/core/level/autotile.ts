/**
 * 13-piece "blob" autotiling for the ground patches (M10, ticket #67). Pure `core/`: no `cc`.
 *
 * A patch is a boolean mask of map cells. Every cell of the patch is drawn with one of the 13
 * pieces of a terrain block in `TilesetField.png`; the piece is chosen from the eight
 * neighbours, so a patch edge always meets the base floor with the right corner/edge art instead
 * of ending in a hard square.
 *
 * Sheet layout of one terrain block (5 columns × 3 rows, ids inside the block):
 *
 * ```text
 *   1  2  3  4  5      outer: 1 NW, 2 N, 3 NE, 6 W, 7 centre, 8 E, 11 SW, 12 S, 13 SE
 *   6  7  8  .  .      inner: 4 NE diagonal missing, 5 NW missing, 9 SE missing, 10 SW missing
 *  11 12 13  9 10
 * ```
 *
 * Verified from the pixels: tile 4 is the notch whose only outside diagonal is the **NW** one,
 * 5 the NE, 9 the SW, 10 the SE (the naming in the layout above is the *hole*).
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
  /** `.tsx` file name next to the rooms, e.g. `field.tsx`. */
  readonly tileset: string;
  /** `tiles[blob - 1]` = 1-based local tile id inside `tileset`. Always 13 entries. */
  readonly tiles: readonly number[];
}

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

/** The 13 local ids of terrain block `block` (0-based) in `TilesetField.png` (15 tiles per block). */
function fieldBlock(block: number): readonly number[] {
  return Array.from({ length: 13 }, (_, index) => 15 * block + index + 1);
}

/**
 * The patch terrain of each chapter, over that chapter's base floor:
 * - ch1 the village dirt path over dark grass,
 * - ch2 the light grass clearing over dark grass,
 * - ch3 light grass growing through the ruined plaza sand,
 * - ch4 the pale sand plateau over the tan desert sand.
 *
 * `field.tsx` names the sheet block; ch3/ch4 carry their own `field.tsx` next to the rooms.
 */
export const GROUND_TERRAINS: Readonly<Record<number, GroundTerrain>> = {
  1: { tileset: 'field.tsx', tiles: fieldBlock(0) },
  2: { tileset: 'field.tsx', tiles: fieldBlock(1) },
  3: { tileset: 'field.tsx', tiles: fieldBlock(1) },
  4: { tileset: 'field.tsx', tiles: fieldBlock(3) },
};
