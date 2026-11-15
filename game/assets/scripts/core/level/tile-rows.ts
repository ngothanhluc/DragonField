/**
 * Tile rows dạng ASCII: định dạng author nhanh cho collision/layout, và là
 * đầu vào gọn để test. Mỗi ký tự = 1 tile.
 *
 * Legend:
 *   `#` tường  → solid
 *   `.` sàn    → không solid
 *   `o` cột    → solid
 *   `~` hố     → solid (không đi vào được; đạn/hiệu ứng xử lý riêng ở combat)
 *
 * `solid` nghĩa là chặn di chuyển. Không dùng khoảng trắng: mọi ký tự ngoài
 * legend đều là lỗi, để typo không âm thầm thành sàn.
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
  /** `solid[row][col]`; `true` = chặn di chuyển. */
  solid: boolean[][];
}

function isTileChar(value: string): value is TileChar {
  return Object.prototype.hasOwnProperty.call(TILE_LEGEND, value);
}

function solidFor(char: string): boolean {
  if (!isTileChar(char)) {
    throw new Error(`parseTileRows: ký tự không có trong legend: ${JSON.stringify(char)}`);
  }
  return TILE_LEGEND[char].solid;
}

/**
 * Parse các hàng ASCII thành lưới `solid`. Ném một `Error` liệt kê mọi hàng
 * lệch độ dài và mọi ký tự không rõ, thay vì dừng ở lỗi đầu tiên.
 */
export function parseTileRows(rows: string[]): TileRows {
  if (rows.length === 0) {
    throw new Error('parseTileRows: cần ít nhất 1 hàng');
  }

  const first = rows[0];
  if (first === undefined) {
    throw new Error('parseTileRows: cần ít nhất 1 hàng');
  }

  const cols = first.length;
  if (cols === 0) {
    throw new Error('parseTileRows: hàng đầu tiên rỗng, không suy ra được số cột');
  }

  const problems: string[] = [];
  rows.forEach((row, rowIndex) => {
    if (row.length !== cols) {
      problems.push(
        `hàng ${rowIndex} có ${row.length} cột, cần ${cols} — lưới phải là hình chữ nhật`,
      );
    }

    for (let col = 0; col < row.length; col += 1) {
      const char = row[col];
      if (char === undefined) continue;
      if (!isTileChar(char)) {
        problems.push(`hàng ${rowIndex}, cột ${col}: ký tự không rõ ${JSON.stringify(char)}`);
      }
    }
  });

  if (problems.length > 0) {
    const details = problems.map((problem) => `  - ${problem}`).join('\n');
    throw new Error(`parseTileRows: dữ liệu không hợp lệ (${problems.length} lỗi)\n${details}`);
  }

  const solid = rows.map((row) => Array.from(row, (char) => solidFor(char)));

  return { cols, rows: rows.length, solid };
}
