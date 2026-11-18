/**
 * Palette remap for generated elite sheets (ADR-015). Pure arithmetic, no `cc`, no I/O:
 * `scripts/gen-elites.ts` reads the PNGs and the JSON, this module decides the colours.
 *
 * Rules (from the ticket):
 * - alpha 0 → the pixel is copied untouched (RGB included);
 * - opaque pixel → its palette index (exact match, else the nearest colour by squared RGB
 *   distance) → `table[index]` (a missing entry means "maps to itself") → that palette colour,
 *   with the original alpha.
 *
 * All source sheets have binary alpha, but alpha is preserved verbatim anyway so the rule
 * stays true if a semi-transparent pixel ever appears.
 */

/** One palette colour, 0–255 per channel. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

/** `["#d78b4a", …]` → RGB entries. Throws on anything that is not `#rrggbb`. */
export function paletteFromHex(hexes: readonly string[]): Rgb[] {
  return hexes.map((hex) => {
    const value = hex.toLowerCase();
    if (!HEX_PATTERN.test(value)) {
      throw new Error(`palette colour must look like #rrggbb, got ${JSON.stringify(hex)}`);
    }
    return {
      r: Number.parseInt(value.slice(1, 3), 16),
      g: Number.parseInt(value.slice(3, 5), 16),
      b: Number.parseInt(value.slice(5, 7), 16),
    };
  });
}

/** RGB → lowercase `#rrggbb` (the form `config/elite-palette.json` stores). */
export function rgbToHex(rgb: Rgb): string {
  return `#${[rgb.r, rgb.g, rgb.b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Index of the closest palette colour by squared RGB distance (0 when the colour is exact). */
export function nearestPaletteIndex(rgb: Rgb, palette: readonly Rgb[]): number {
  if (palette.length === 0) throw new Error('nearestPaletteIndex: palette is empty');

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const candidate = palette[index]!;
    const dr = rgb.r - candidate.r;
    const dg = rgb.g - candidate.g;
    const db = rgb.b - candidate.b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/**
 * Turn the committed `remap` object (`{ "12": 40, … }`, only the non-identity entries) into a
 * dense index array. Missing entries map to themselves.
 */
export function remapTable(
  record: Readonly<Record<string, number>>,
  size: number,
): number[] {
  const table = Array.from({ length: size }, (_, index) => index);
  for (const [key, target] of Object.entries(record)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= size) {
      throw new Error(`remap index ${JSON.stringify(key)} is outside the palette (0..${size - 1})`);
    }
    if (!Number.isInteger(target) || target < 0 || target >= size) {
      throw new Error(`remap target ${target} for index ${index} is outside the palette (0..${size - 1})`);
    }
    table[index] = target;
  }
  return table;
}

/**
 * Remap every opaque pixel of an RGBA buffer. Returns a **new** buffer; the source is unchanged.
 * `table` must be dense and as long as `palette`.
 */
export function remapPixels(
  data: Buffer,
  palette: readonly Rgb[],
  table: readonly number[],
): Buffer {
  if (data.length % 4 !== 0) {
    throw new Error(`remapPixels: RGBA data length must be a multiple of 4, got ${data.length}`);
  }
  if (table.length !== palette.length) {
    throw new Error(`remapPixels: table has ${table.length} entries but the palette has ${palette.length}`);
  }

  const out = Buffer.from(data);
  const lookup = new Map<number, number>();

  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3]!;
    if (alpha === 0) continue;

    const r = data[offset]!;
    const g = data[offset + 1]!;
    const b = data[offset + 2]!;
    const packed = (r << 16) | (g << 8) | b;

    let index = lookup.get(packed);
    if (index === undefined) {
      index = nearestPaletteIndex({ r, g, b }, palette);
      lookup.set(packed, index);
    }

    const colour = palette[table[index]!]!;
    out[offset] = colour.r;
    out[offset + 1] = colour.g;
    out[offset + 2] = colour.b;
  }

  return out;
}
