/**
 * Pure transforms and spec validation for generated pixel art. Kept free of filesystem
 * access so the palette mapping and downscale rules can be tested like any other core logic.
 */
import type { PngImage } from './png';

export type AssetRole = 'actor' | 'monster' | 'boss';

export interface AssetSpec {
  readonly key: string;
  readonly source: string;
  readonly sheet: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly layout: 'grid' | 'strip';
  readonly directions: readonly string[];
  readonly frames: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly anchor: 'feet' | 'center';
  readonly role?: AssetRole;
  /** Chroma-key colour to drop from the raw download: `#rrggbb` or `auto` (top-left pixel). */
  readonly background?: Rgb | 'auto';
  /** `cell` (default) crops each direction to its opaque bbox and fills the frames. */
  readonly fit?: 'cell' | 'none';
  /** Most colours the whole sheet may use after palette mapping (accents are kept). Default 10. */
  readonly maxColors?: number;
  /** Build a direction column by flipping another one, e.g. `{ "right": "left" }`. */
  readonly mirror?: Readonly<Record<string, string>>;
}

export interface ArtSpec {
  readonly assets: readonly AssetSpec[];
}

export type Rgb = readonly [number, number, number];

const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const DIRECTIONS: ReadonlySet<string> = new Set(['down', 'up', 'left', 'right']);
const ROLES: ReadonlySet<string> = new Set(['actor', 'monster', 'boss']);
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

/** `#rrggbb` → RGB triple. */
export function hexToRgb(value: string): Rgb {
  if (!HEX_COLOUR.test(value)) throw new Error(`colour must be #rrggbb, got ${value}`);
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function parseAsset(value: unknown, index: number): AssetSpec {
  if (!isRecord(value)) throw new Error(`assets[${index}] must be an object`);
  const field = (name: string): unknown => value[name];
  const key = field('key');
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new Error(`assets[${index}].key must be a logical key like actor.idle.down`);
  }
  for (const name of ['source', 'sheet'] as const) {
    const text = field(name);
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error(`${key}.${name} must be a non-empty string`);
    }
  }
  const sheet = field('sheet') as string;
  if (!sheet.endsWith('.png') || sheet.includes('..') || sheet.startsWith('/') || sheet.includes('\\')) {
    throw new Error(`${key}.sheet must be a relative .png path under assets/resources/art`);
  }
  const layout = field('layout');
  if (layout !== 'grid' && layout !== 'strip') throw new Error(`${key}.layout must be grid or strip`);
  const directions = field('directions');
  if (!Array.isArray(directions) || directions.some((d) => typeof d !== 'string' || !DIRECTIONS.has(d))) {
    throw new Error(`${key}.directions must contain only down/up/left/right`);
  }
  const fps = field('fps');
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    throw new Error(`${key}.fps must be a positive number`);
  }
  const anchor = field('anchor');
  if (anchor !== 'feet' && anchor !== 'center') throw new Error(`${key}.anchor must be feet or center`);
  const role = field('role');
  if (role !== undefined && (typeof role !== 'string' || !ROLES.has(role))) {
    throw new Error(`${key}.role must be actor, monster or boss`);
  }
  const backgroundRaw = field('background');
  let background: Rgb | 'auto' | undefined;
  if (backgroundRaw !== undefined) {
    if (backgroundRaw === 'auto') background = 'auto';
    else if (typeof backgroundRaw === 'string' && HEX_COLOUR.test(backgroundRaw)) {
      background = hexToRgb(backgroundRaw);
    } else {
      throw new Error(`${key}.background must be "#rrggbb" or "auto"`);
    }
  }
  const keyDirection = DIRECTIONS.has(key.split('.').pop() ?? '');
  if (keyDirection && directions.length > 1) {
    throw new Error(`${key}.key ends with a direction, so directions must hold at most one entry`);
  }
  const fit = field('fit');
  if (fit !== undefined && fit !== 'cell' && fit !== 'none') {
    throw new Error(`${key}.fit must be "cell" or "none"`);
  }
  const maxColors = field('maxColors');
  if (maxColors !== undefined) integer(maxColors, `${key}.maxColors`);
  const mirror = field('mirror');
  if (mirror !== undefined) {
    if (!isRecord(mirror)) throw new Error(`${key}.mirror must map a target direction to a source direction`);
    for (const [target, from] of Object.entries(mirror)) {
      if (!directions.includes(target) || typeof from !== 'string' || !directions.includes(from) || from === target) {
        throw new Error(`${key}.mirror ${target}→${String(from)} must name two different directions of this asset`);
      }
      if (from in mirror) throw new Error(`${key}.mirror source ${from} is itself mirrored`);
    }
  }
  return {
    key,
    source: field('source') as string,
    sheet,
    frameWidth: integer(field('frameWidth'), `${key}.frameWidth`),
    frameHeight: integer(field('frameHeight'), `${key}.frameHeight`),
    layout,
    directions: directions as readonly string[],
    frames: integer(field('frames'), `${key}.frames`),
    fps,
    loop: field('loop') === true,
    anchor,
    ...(role === undefined ? {} : { role: role as AssetRole }),
    ...(background === undefined ? {} : { background }),
    ...(fit === undefined ? {} : { fit: fit as 'cell' | 'none' }),
    ...(maxColors === undefined ? {} : { maxColors: maxColors as number }),
    ...(mirror === undefined ? {} : { mirror: mirror as Record<string, string> }),
  };
}

/** Parse an untrusted spec file into a validated art spec, or throw with a useful message. */
export function parseSpec(value: unknown): ArtSpec {
  if (!isRecord(value) || !Array.isArray(value['assets']) || value['assets'].length === 0) {
    throw new Error('spec must be an object with a non-empty assets array');
  }
  return { assets: value['assets'].map(parseAsset) };
}

/** Full sheet size in pixels, following the manifest's frame geometry. */
export function sheetSize(asset: AssetSpec): { readonly width: number; readonly height: number } {
  if (asset.layout === 'strip') {
    return { width: asset.frameWidth * asset.frames, height: asset.frameHeight };
  }
  return {
    width: asset.frameWidth * Math.max(1, asset.directions.length),
    height: asset.frameHeight * asset.frames,
  };
}

/** Nearest-neighbour resample; pixel art must never be bilinearly blended. */
export function nearestResize(image: PngImage, width: number, height: number): PngImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid target size ${width}×${height}`);
  }
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      data[to] = image.data[from]!;
      data[to + 1] = image.data[from + 1]!;
      data[to + 2] = image.data[from + 2]!;
      data[to + 3] = image.data[from + 3]!;
    }
  }
  return { width, height, data };
}

/** Colour of the top-left pixel: the default chroma key for `background: "auto"`. */
export function cornerColor(image: PngImage): Rgb {
  return [image.data[0] ?? 0, image.data[1] ?? 0, image.data[2] ?? 0];
}

/**
 * Chroma-key the flat background Gemini drew behind the sheet.
 *
 * Every pixel within `tolerance` (RGB euclidean distance) of `key` becomes fully
 * transparent, so a magenta key wipes the backdrop without touching palette colours.
 * Blended edge pixels are then peeled: an opaque pixel within `fringe` of the key that
 * touches a transparent neighbour also becomes transparent, which removes the pale halo
 * that would otherwise quantize to a wrong palette colour. The flood is bounded by the
 * silhouette, so interior colours survive.
 *
 * Run it at full download resolution, before any downscale.
 */
export function chromaKey(image: PngImage, key: Rgb, tolerance = 96, fringe = 160): PngImage {
  if (tolerance <= 0) throw new Error('tolerance must be positive');
  if (fringe < tolerance) throw new Error('fringe must be at least the tolerance');
  const limit = tolerance * tolerance;
  const fringeLimit = fringe * fringe;
  const { width, height } = image;
  const data = Buffer.from(image.data);
  const queue: number[] = [];

  const distance = (pixel: number): number => {
    const dr = data[pixel]! - key[0];
    const dg = data[pixel + 1]! - key[1];
    const db = data[pixel + 2]! - key[2];
    return dr * dr + dg * dg + db * db;
  };
  const clear = (pixel: number): void => {
    data[pixel] = 0;
    data[pixel + 1] = 0;
    data[pixel + 2] = 0;
    data[pixel + 3] = 0;
    queue.push(pixel);
  };

  for (let pixel = 0; pixel < data.length; pixel += 4) {
    if (data[pixel + 3]! === 0) {
      queue.push(pixel);
      continue;
    }
    if (distance(pixel) <= limit) clear(pixel);
  }

  // Peel the blended rim: only pixels touching transparent ones and close to the key.
  while (queue.length > 0) {
    const pixel = queue.pop()!;
    const x = (pixel / 4) % width;
    const y = Math.floor(pixel / 4 / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = (ny * width + nx) * 4;
        if (data[next + 3]! === 0) continue;
        if (distance(next) <= fringeLimit) clear(next);
      }
    }
  }

  return { width, height, data };
}

/** Manifest key for one direction of a multi-direction sheet. */
export function directionKey(key: string, direction: string): string {
  return `${key}.${direction}`;
}

/** Integer nearest-neighbour factor that brings the long side to at least `min`. */
export function upscaleFactor(width: number, height: number, min: number): number {
  if (!Number.isInteger(min) || min <= 0) throw new Error('min must be a positive integer');
  const longest = Math.max(width, height);
  if (longest <= 0) throw new Error('image has no pixels');
  return Math.max(1, Math.ceil(min / longest));
}

/**
 * Resample pixel art for a target grid.
 *
 * Shrinking uses the **dominant colour** of each source block instead of a single
 * nearest sample: `nearestResize` throws away 90% of a 512→16 block and keeps whatever
 * pixel happens to land on the grid, which turns anti-aliased edges into noise. Growing
 * uses nearest so no blending is introduced. `weights` (see `salienceWeights`) multiplies
 * each colour's vote so a small detail like an eye is not always outvoted by the cloak.
 */
export function resamplePixelArt(
  image: PngImage,
  width: number,
  height: number,
  weights?: ReadonlyMap<number, number>,
): PngImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`invalid target size ${width}×${height}`);
  }
  if (width > image.width || height > image.height) return nearestResize(image, width, height);

  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * image.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * image.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / width));
      const counts = new Map<number, number>();
      let opaque = 0;
      let total = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const from = (sy * image.width + sx) * 4;
          total += 1;
          if (image.data[from + 3]! < 128) continue;
          opaque += 1;
          const color = (image.data[from]! << 16) | (image.data[from + 1]! << 8) | image.data[from + 2]!;
          counts.set(color, (counts.get(color) ?? 0) + (weights?.get(color) ?? 1));
        }
      }
      const to = (y * width + x) * 4;
      if (opaque * 2 <= total) continue;
      let best = 0;
      let bestCount = -1;
      for (const [color, count] of counts) {
        if (count > bestCount) {
          best = color;
          bestCount = count;
        }
      }
      data[to] = (best >> 16) & 0xff;
      data[to + 1] = (best >> 8) & 0xff;
      data[to + 2] = best & 0xff;
      data[to + 3] = 255;
    }
  }
  return { width, height, data };
}

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function opaqueBox(image: PngImage, box: Box): Box | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = -1;
  let y1 = -1;
  for (let y = box.y0; y < box.y1; y += 1) {
    for (let x = box.x0; x < box.x1; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3]! < 128) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function unionBox(a: Box | null, b: Box | null): Box | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function crop(image: PngImage, box: Box): PngImage {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((box.y0 + y) * image.width + box.x0) * 4;
    data.set(image.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data };
}

/**
 * Normalise each direction column to fill its frame cells.
 *
 * Gemini draws the character smaller than the cell it was given, so a direct downscale
 * lands at 8–10 px inside a 16 px frame. For each direction the opaque bbox (union over
 * that column's frames, so the scale stays constant) is cropped and resampled to the
 * frame height, then pasted bottom-centred with one pixel of headroom. Feet stay on the
 * cell floor, which is what the manifest anchor expects.
 */
export function fitColumnsToCells(
  image: PngImage,
  columns: number,
  frames: number,
  frameWidth: number,
  frameHeight: number,
  weights?: ReadonlyMap<number, number>,
): PngImage {
  const cellWidth = image.width / columns;
  const cellHeight = image.height / frames;
  if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) {
    throw new Error(`source ${image.width}×${image.height} does not split into ${columns}×${frames} cells`);
  }
  const data = Buffer.alloc(frameWidth * columns * frameHeight * frames * 4);
  const outWidth = frameWidth * columns;

  for (let column = 0; column < columns; column += 1) {
    const boxes: Array<Box | null> = [];
    let region: Box | null = null;
    for (let row = 0; row < frames; row += 1) {
      const cell: Box = {
        x0: column * cellWidth,
        y0: row * cellHeight,
        x1: (column + 1) * cellWidth,
        y1: (row + 1) * cellHeight,
      };
      const found = opaqueBox(image, cell);
      // Union in cell-local coordinates: every frame shares the same crop window.
      const local =
        found === null
          ? null
          : {
              x0: found.x0 - cell.x0,
              y0: found.y0 - cell.y0,
              x1: found.x1 - cell.x0,
              y1: found.y1 - cell.y0,
            };
      boxes.push(local);
      region = unionBox(region, local);
    }
    if (region === null) continue;

    const boxWidth = region.x1 - region.x0;
    const boxHeight = region.y1 - region.y0;
    const scale = Math.min((frameWidth - 1) / boxWidth, (frameHeight - 1) / boxHeight);
    const fitWidth = Math.max(1, Math.round(boxWidth * scale));
    const fitHeight = Math.max(1, Math.round(boxHeight * scale));

    for (let row = 0; row < frames; row += 1) {
      const local = boxes[row];
      if (local === null || local === undefined) continue;
      const cell: Box = {
        x0: column * cellWidth,
        y0: row * cellHeight,
        x1: (column + 1) * cellWidth,
        y1: (row + 1) * cellHeight,
      };
      const window: Box = {
        x0: cell.x0 + region.x0,
        y0: cell.y0 + region.y0,
        x1: cell.x0 + region.x1,
        y1: cell.y0 + region.y1,
      };
      const piece = resamplePixelArt(crop(image, window), fitWidth, fitHeight, weights);
      const left = column * frameWidth + Math.floor((frameWidth - fitWidth) / 2);
      // Put this frame's own feet on the cell floor, whatever y Gemini drew them at.
      const foot = Math.round((local.y1 - region.y0) * scale);
      const top = row * frameHeight + Math.max(0, frameHeight - foot);
      for (let y = 0; y < fitHeight; y += 1) {
        for (let x = 0; x < fitWidth; x += 1) {
          const from = (y * fitWidth + x) * 4;
          if (piece.data[from + 3]! < 128) continue;
          const to = ((top + y) * outWidth + left + x) * 4;
          data[to] = piece.data[from]!;
          data[to + 1] = piece.data[from + 1]!;
          data[to + 2] = piece.data[from + 2]!;
          data[to + 3] = 255;
        }
      }
    }
  }
  return { width: outWidth, height: frameHeight * frames, data };
}

/** Unique opaque colours of a palette sheet, as RGB triples. */
export function paletteColors(image: PngImage): Rgb[] {
  const colors = new Map<string, Rgb>();
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3]! < 128) continue;
    const rgb: Rgb = [image.data[index]!, image.data[index + 1]!, image.data[index + 2]!];
    colors.set(rgb.join(','), rgb);
  }
  return Array.from(colors.values());
}

/** Snap alpha to binary and move every opaque pixel onto the nearest palette colour. */
export function quantize(image: PngImage, palette: readonly Rgb[]): PngImage {
  if (palette.length === 0) throw new Error('palette is empty');
  const data = Buffer.alloc(image.width * image.height * 4);
  // A 2048² download has ~4M pixels but only a few thousand distinct colours.
  const cache = new Map<number, Rgb>();
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3]! < 128) continue;
    const packed = (image.data[index]! << 16) | (image.data[index + 1]! << 8) | image.data[index + 2]!;
    const cached = cache.get(packed);
    if (cached !== undefined) {
      data[index] = cached[0];
      data[index + 1] = cached[1];
      data[index + 2] = cached[2];
      data[index + 3] = 255;
      continue;
    }
    let best = palette[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const color of palette) {
      const dr = color[0] - image.data[index]!;
      const dg = color[1] - image.data[index + 1]!;
      const db = color[2] - image.data[index + 2]!;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        best = color;
        bestDistance = distance;
      }
    }
    cache.set(packed, best);
    data[index] = best[0];
    data[index + 1] = best[1];
    data[index + 2] = best[2];
    data[index + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

function colorCounts(image: PngImage): Map<number, number> {
  const counts = new Map<number, number>();
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3]! < 128) continue;
    const packed = (image.data[index]! << 16) | (image.data[index + 1]! << 8) | image.data[index + 2]!;
    counts.set(packed, (counts.get(packed) ?? 0) + 1);
  }
  return counts;
}

const unpack = (packed: number): Rgb => [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff];

function distanceSq(a: Rgb, b: Rgb): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/**
 * Restrict a palette-mapped sheet to its `max` most-used colours, so every frame shares
 * one small colour set (Gemini's in-between shades otherwise flip between two palette
 * entries from frame to frame). A rare colour far from every kept one — an eye, a gem —
 * is an accent and survives: it covers at least `accentShare` of the opaque pixels and
 * sits more than `accentDistance` (RGB euclidean) from the kept set.
 */
export function limitColors(image: PngImage, max: number, accentShare = 0.0005, accentDistance = 80): PngImage {
  if (!Number.isInteger(max) || max <= 0) throw new Error('max must be a positive integer');
  const counts = colorCounts(image);
  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const opaque = ranked.reduce((sum, [, count]) => sum + count, 0);
  const kept = ranked.slice(0, max).map(([packed]) => unpack(packed));
  for (const [packed, count] of ranked.slice(max)) {
    const rgb = unpack(packed);
    const nearest = Math.min(...kept.map((color) => distanceSq(color, rgb)));
    if (count >= opaque * accentShare && nearest > accentDistance * accentDistance) kept.push(rgb);
  }
  return quantize(image, kept);
}

/** Drop opaque pixels with no opaque orthogonal neighbour (stray specks left by the downscale). */
export function despeckle(image: PngImage): PngImage {
  const { width, height } = image;
  const data = Buffer.from(image.data);
  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && image.data[(y * width + x) * 4 + 3]! >= 128;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!opaque(x, y)) continue;
      if (opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1)) continue;
      data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
    }
  }
  return { width, height, data };
}

/** Overwrite column `to` with column `from` flipped horizontally, frame by frame. */
export function mirrorColumn(image: PngImage, frameWidth: number, from: number, to: number): PngImage {
  const data = Buffer.from(image.data);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const source = (y * image.width + from * frameWidth + (frameWidth - 1 - x)) * 4;
      const target = (y * image.width + to * frameWidth + x) * 4;
      image.data.copy(data, target, source, source + 4);
    }
  }
  return { width: image.width, height: image.height, data };
}

export interface SheetIssue {
  readonly kind: 'edge' | 'drift' | 'empty';
  readonly column: number;
  readonly row: number;
  readonly detail: string;
}

/**
 * Quality gate on the palette-mapped full-size download, before it is fitted.
 *
 * - `empty`: a cell has nothing opaque left after the chroma key.
 * - `edge`: opaque pixels within `margin` of a cell's left, right or top edge — the
 *   sprite (often a weapon) crosses into its neighbour and would be cut. The bottom edge
 *   is the floor the feet stand on, so it is allowed.
 * - `drift`: a frame's colour histogram differs from the column's medoid frame by more
 *   than `maxDrift` (total variation, 0–1). Gemini sometimes recolours a whole row; a
 *   clean sheet measures ~0.02–0.07, a recoloured row ~0.3. Using the medoid means two
 *   rows recoloured alike are still caught.
 */
export function inspectCells(
  image: PngImage,
  columns: number,
  frames: number,
  options: { readonly margin?: number; readonly maxDrift?: number; readonly skipColumns?: readonly number[] } = {},
): SheetIssue[] {
  const margin = options.margin ?? 4;
  const maxDrift = options.maxDrift ?? 0.2;
  const cellWidth = Math.floor(image.width / columns);
  const cellHeight = Math.floor(image.height / frames);
  const issues: SheetIssue[] = [];
  for (let column = 0; column < columns; column += 1) {
    if (options.skipColumns?.includes(column)) continue;
    const histograms: Array<Map<number, number>> = [];
    for (let row = 0; row < frames; row += 1) {
      const histogram = new Map<number, number>();
      let opaque = 0;
      let edge = 0;
      for (let ly = 0; ly < cellHeight; ly += 1) {
        for (let lx = 0; lx < cellWidth; lx += 1) {
          const index = ((row * cellHeight + ly) * image.width + column * cellWidth + lx) * 4;
          if (image.data[index + 3]! < 128) continue;
          opaque += 1;
          if (lx < margin || lx >= cellWidth - margin || ly < margin) edge += 1;
          const packed = (image.data[index]! << 16) | (image.data[index + 1]! << 8) | image.data[index + 2]!;
          histogram.set(packed, (histogram.get(packed) ?? 0) + 1);
        }
      }
      if (opaque === 0) issues.push({ kind: 'empty', column, row, detail: 'no opaque pixels' });
      if (edge > 0) {
        issues.push({ kind: 'edge', column, row, detail: `${edge} px touch the left/right/top cell edge` });
      }
      for (const [color, count] of histogram) histogram.set(color, count / Math.max(1, opaque));
      histograms.push(histogram);
    }
    const variation = (a: Map<number, number>, b: Map<number, number>): number => {
      let sum = 0;
      for (const color of new Set([...Array.from(a.keys()), ...Array.from(b.keys())])) {
        sum += Math.abs((a.get(color) ?? 0) - (b.get(color) ?? 0));
      }
      return sum / 2;
    };
    // Compare every frame with the column's medoid, so two rows recoloured the same way
    // still stand out against the rest.
    const live = histograms.map((histogram, row) => ({ histogram, row })).filter((entry) => entry.histogram.size > 0);
    if (live.length < 2) continue;
    const medoid = live.reduce((best, entry) => {
      const total = (candidate: Map<number, number>): number =>
        live.reduce((sum, other) => sum + variation(candidate, other.histogram), 0);
      return total(entry.histogram) < total(best.histogram) ? entry : best;
    });
    for (const { histogram, row } of live) {
      const drift = variation(histogram, medoid.histogram);
      if (drift > maxDrift) {
        issues.push({ kind: 'drift', column, row, detail: `colours differ from the column by ${drift.toFixed(2)}` });
      }
    }
  }
  return issues;
}

/**
 * Per cell, clear 8-connected opaque blobs smaller than `minShare` of that cell's largest
 * blob. Gemini's grid is not exact: feet spill a pixel row into the cell below and stray
 * flecks float around the sprite. Left in, they stretch the fit box (shrinking the
 * sprite) and trip the edge gate. Pixels of a sprite all touch, so the sprite survives.
 */
export function dropStrayBlobs(image: PngImage, columns: number, frames: number, minShare = 0.02): PngImage {
  const { width, height } = image;
  const cellWidth = Math.floor(width / columns);
  const cellHeight = Math.floor(height / frames);
  const data = Buffer.from(image.data);
  const seen = new Uint8Array(width * height);
  for (let row = 0; row < frames; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = column * cellWidth;
      const y0 = row * cellHeight;
      const blobs: number[][] = [];
      for (let y = y0; y < y0 + cellHeight; y += 1) {
        for (let x = x0; x < x0 + cellWidth; x += 1) {
          const start = y * width + x;
          if (seen[start] === 1 || image.data[start * 4 + 3]! < 128) continue;
          const blob: number[] = [];
          const stack = [start];
          seen[start] = 1;
          while (stack.length > 0) {
            const pixel = stack.pop()!;
            blob.push(pixel);
            const px = pixel % width;
            const py = Math.floor(pixel / width);
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dx = -1; dx <= 1; dx += 1) {
                const nx = px + dx;
                const ny = py + dy;
                if (nx < x0 || ny < y0 || nx >= x0 + cellWidth || ny >= y0 + cellHeight) continue;
                const next = ny * width + nx;
                if (seen[next] === 1 || image.data[next * 4 + 3]! < 128) continue;
                seen[next] = 1;
                stack.push(next);
              }
            }
          }
          blobs.push(blob);
        }
      }
      const largest = Math.max(0, ...blobs.map((blob) => blob.length));
      for (const blob of blobs) {
        if (blob.length >= largest * minShare) continue;
        for (const pixel of blob) data.fill(0, pixel * 4, pixel * 4 + 4);
      }
    }
  }
  return { width, height, data };
}

/**
 * Vote weights for `resamplePixelArt`: `sqrt(topShare / share)`, capped at `cap`. The most
 * used colour weighs 1; a colour covering 1% of a sheet dominated by a 40% cloak weighs the
 * cap. Run it after `limitColors`, so the rare colours left are real details, not noise.
 */
export function salienceWeights(image: PngImage, cap = 3): Map<number, number> {
  const counts = colorCounts(image);
  const top = Math.max(0, ...Array.from(counts.values()));
  const weights = new Map<number, number>();
  for (const [color, count] of counts) weights.set(color, Math.min(cap, Math.sqrt(top / count)));
  return weights;
}

/**
 * Palette-map a sheet **consistently**: cluster the opaque colours of the whole sheet
 * (weighted k-means, deterministic farthest-point seeding), then send every pixel to the
 * palette colour nearest its cluster's centre.
 *
 * Mapping each pixel on its own lets a shade that sits halfway between two palette entries
 * flip between them from frame to frame (one frame's cloak goes tan, the next green). With
 * clusters, one shade of the design is one palette colour on every frame. Use enough
 * clusters (default 16) to keep accents; `limitColors` trims the result afterwards.
 */
export function clusterToPalette(image: PngImage, palette: readonly Rgb[], clusters = 16, iterations = 12): PngImage {
  if (palette.length === 0) throw new Error('palette is empty');
  const counts = colorCounts(image);
  const colors = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (colors.length === 0) return quantize(image, palette);
  const points = colors.map(([packed]) => unpack(packed));
  const weights = colors.map(([, count]) => count);

  // Seed: the most used colour, then repeatedly the colour with the largest weight × distance².
  const centres: Rgb[] = [points[0]!];
  const nearest = points.map((point) => distanceSq(point, centres[0]!));
  while (centres.length < Math.min(clusters, points.length)) {
    let best = -1;
    let bestScore = 0;
    nearest.forEach((distance, index) => {
      const score = distance * weights[index]!;
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best < 0) break;
    centres.push(points[best]!);
    points.forEach((point, index) => {
      nearest[index] = Math.min(nearest[index]!, distanceSq(point, points[best]!));
    });
  }

  const assignment = new Array<number>(points.length).fill(0);
  const assign = (): void => {
    points.forEach((point, index) => {
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      centres.forEach((centre, c) => {
        const distance = distanceSq(point, centre);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      });
      assignment[index] = best;
    });
  };
  for (let round = 0; round < iterations; round += 1) {
    assign();
    const sums = centres.map(() => [0, 0, 0, 0]);
    points.forEach((point, index) => {
      const sum = sums[assignment[index]!]!;
      const weight = weights[index]!;
      sum[0]! += point[0] * weight;
      sum[1]! += point[1] * weight;
      sum[2]! += point[2] * weight;
      sum[3]! += weight;
    });
    sums.forEach((sum, c) => {
      if (sum[3]! > 0) centres[c] = [sum[0]! / sum[3]!, sum[1]! / sum[3]!, sum[2]! / sum[3]!];
    });
  }
  assign();

  const target = centres.map((centre) => {
    let best = palette[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const color of palette) {
      const distance = distanceSq(color, centre);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = color;
      }
    }
    return best;
  });
  const lookup = new Map<number, Rgb>();
  colors.forEach(([packed], index) => lookup.set(packed, target[assignment[index]!]!));

  const data = Buffer.alloc(image.width * image.height * 4);
  for (let index = 0; index < image.data.length; index += 4) {
    if (image.data[index + 3]! < 128) continue;
    const packed = (image.data[index]! << 16) | (image.data[index + 1]! << 8) | image.data[index + 2]!;
    const color = lookup.get(packed)!;
    data[index] = color[0];
    data[index + 1] = color[1];
    data[index + 2] = color[2];
    data[index + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}
