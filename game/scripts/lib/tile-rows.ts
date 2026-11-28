/**
 * ASCII tile rows: a fast authoring format for collision/layout, and a compact
 * test input. Each character = 1 tile.
 *
 * Legend:
 *   `#` wall   → solid
 *   `.` floor  → not solid
 *   `o` pillar → solid
 *   `~` pit    → solid (cannot be entered; projectiles/effects are handled in combat)
 *
 * `solid` means it blocks movement. No whitespace: every character outside the
 * legend is an error, so a typo cannot silently become floor.
 */

export const TILE_LEGEND = {
  '#': { name: 'wall', solid: true },
  '.': { name: 'floor', solid: false },
  o: { name: 'pillar', solid: true },
  '~': { name: 'pit', solid: true },
} as const;

export type TileChar = keyof typeof TILE_LEGEND;

export interface TileRows {
  cols: number;
  rows: number;
  /** `solid[row][col]`; `true` = blocks movement. */
  solid: boolean[][];
}

function isTileChar(value: string): value is TileChar {
  return Object.prototype.hasOwnProperty.call(TILE_LEGEND, value);
}

function solidFor(char: string): boolean {
  if (!isTileChar(char)) {
    throw new Error(`parseTileRows: character not in the legend: ${JSON.stringify(char)}`);
  }
  return TILE_LEGEND[char].solid;
}

/**
 * Parse ASCII rows into a `solid` grid. Throws one `Error` listing every row of
 * the wrong length and every unknown character, instead of stopping at the first problem.
 */
export function parseTileRows(rows: string[]): TileRows {
  if (rows.length === 0) {
    throw new Error('parseTileRows: at least 1 row is required');
  }

  const first = rows[0];
  if (first === undefined) {
    throw new Error('parseTileRows: at least 1 row is required');
  }

  const cols = first.length;
  if (cols === 0) {
    throw new Error('parseTileRows: the first row is empty, cannot infer the column count');
  }

  const problems: string[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.length !== cols) {
      problems.push(
        `row ${rowIndex} has ${row.length} columns, expected ${cols} — the grid must be rectangular`,
      );
    }

    for (let col = 0; col < row.length; col += 1) {
      const char = row[col];
      if (char === undefined) continue;
      if (!isTileChar(char)) {
        problems.push(`row ${rowIndex}, column ${col}: unknown character ${JSON.stringify(char)}`);
      }
    }
  });

  if (problems.length > 0) {
    const details = problems.map((problem) => `  - ${problem}`).join('\n');
    throw new Error(`parseTileRows: invalid data (${problems.length} problem(s))\n${details}`);
  }

  const solid = rows.map((row) => Array.from(row, (char) => solidFor(char)));

  return { cols, rows: rows.length, solid };
}
