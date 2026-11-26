/**
 * Build-time 1 px dark silhouette outline helper for 16×16 monster sprite sheets (GDD §4.3).
 *
 * Pure RGBA buffer arithmetic (no `cc`, no I/O) so it can be unit-tested in vitest and
 * invoked by `scripts/outline-monsters.ts` via `sharp`.
 *
 * Rules:
 * - Outline colour is `#141b1b` (palette index 46 from the 53-colour Ninja Adventure palette).
 * - Binary alpha: pixels with alpha >= 128 are opaque (forced to 255), others are transparent (0).
 * - A transparent pixel becomes `#141b1b` (alpha 255) iff at least one 4-connected neighbour
 *   within the **same** `cellWidth × cellHeight` cell is opaque and NOT already `#141b1b`.
 * - Skipping pixels already `#141b1b` keeps existing pack outlines 1 px thick and makes the
 *   pass 100% idempotent on reruns.
 */

export const OUTLINE_RGB = { r: 0x14, g: 0x1b, b: 0x1b } as const;

const CARDINAL_OFFSETS: readonly [number, number][] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

function isOpaque(data: Buffer, offset: number): boolean {
  return data[offset + 3]! >= 128;
}

function isOutlineColor(data: Buffer, offset: number): boolean {
  return (
    data[offset] === OUTLINE_RGB.r &&
    data[offset + 1] === OUTLINE_RGB.g &&
    data[offset + 2] === OUTLINE_RGB.b
  );
}

/**
 * Return a new RGBA buffer with a 1 px `#141b1b` outline around non-outline opaque pixels,
 * strictly clamped within each `cellWidth × cellHeight` frame.
 */
export function outlineSpriteSheet(
  data: Buffer,
  width: number,
  height: number,
  cellWidth = 16,
  cellHeight = 16,
): Buffer {
  if (width <= 0 || height <= 0) {
    throw new Error(`outlineSpriteSheet: invalid dimensions ${width}×${height}`);
  }
  if (cellWidth <= 0 || cellHeight <= 0) {
    throw new Error(`outlineSpriteSheet: invalid cell size ${cellWidth}×${cellHeight}`);
  }
  const expected = width * height * 4;
  if (data.length !== expected) {
    throw new Error(`outlineSpriteSheet: expected ${expected} bytes, got ${data.length}`);
  }

  const out = Buffer.from(data);

  for (let y = 0; y < height; y += 1) {
    const cellY0 = Math.floor(y / cellHeight) * cellHeight;
    const cellY1 = Math.min(height, cellY0 + cellHeight);

    for (let x = 0; x < width; x += 1) {
      const cellX0 = Math.floor(x / cellWidth) * cellWidth;
      const cellX1 = Math.min(width, cellX0 + cellWidth);
      const idx = (y * width + x) * 4;

      if (isOpaque(data, idx)) {
        out[idx + 3] = 255;
        continue;
      }

      // Normalize transparent pixels to clean binary alpha (0).
      out[idx + 3] = 0;

      let needsOutline = false;
      for (const [dx, dy] of CARDINAL_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < cellX0 || nx >= cellX1 || ny < cellY0 || ny >= cellY1) continue;
        const nIdx = (ny * width + nx) * 4;
        if (isOpaque(data, nIdx) && !isOutlineColor(data, nIdx)) {
          needsOutline = true;
          break;
        }
      }

      if (needsOutline) {
        out[idx] = OUTLINE_RGB.r;
        out[idx + 1] = OUTLINE_RGB.g;
        out[idx + 2] = OUTLINE_RGB.b;
        out[idx + 3] = 255;
      }
    }
  }

  return out;
}
