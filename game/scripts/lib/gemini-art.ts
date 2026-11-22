/**
 * Pure transforms and spec validation for generated pixel art. Kept free of filesystem
 * access so the palette mapping and downscale rules can be tested like any other core logic.
 */
import type { PngImage } from './png';

export type AssetRole = 'actor' | 'monster' | 'boss';

/** Every kind of art the pipeline can stage. `tilemap` is not here: rooms come from text layouts. */
export const ASSET_KINDS = [
  'character',
  'monster',
  'boss',
  'attachment',
  'prop',
  'vfx',
  'particle',
  'icon',
  'ui',
  'tileset',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** How a kind is fitted, gated and registered unless the spec overrides it. */
export interface KindDefaults {
  /** `feet`: bottom-centred on the cell floor; `center`: centred; `stretch`: exact target size; `tile`: whole cells edge to edge. */
  readonly fit: 'feet' | 'center' | 'stretch' | 'tile';
  readonly anchor: 'feet' | 'center';
  /** Which cells share one crop window and scale: a direction column, the whole sheet, or each cell alone. */
  readonly share: 'column' | 'sheet' | 'cell';
  /** Whether the quality gate rejects sprites touching their cell's side/top edge. */
  readonly edgeGate: boolean;
  /** `sprite`: entry in the animation manifest; `tileset`: PNG + `.tsx` for Tiled rooms. */
  readonly register: 'sprite' | 'tileset';
}

/** Nine-slice insets in output pixels. */
export interface NineSlice {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface FitCellsOptions {
  readonly columns: number;
  readonly rows: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly anchor: 'feet' | 'center';
  readonly share: 'column' | 'sheet' | 'cell';
  readonly weights?: ReadonlyMap<number, number>;
  /**
   * Size in output pixels the shared crop window may fill, instead of the whole frame.
   * An attachment keeps its size relative to the body this way. Defaults to today's
   * behaviour: `frameWidth - 1 × frameHeight - 1` for `feet`, the frame for `center`.
   */
  readonly fitBox?: readonly [number, number];
  /**
   * Shift the shared crop window by up to one output block so the output grid lines up with
   * the source's pixel grid. A feature narrower than one output pixel (an eye) then lands in
   * one block instead of straddling two and losing both. Off by default.
   */
  readonly align?: boolean;
  /**
   * Give one output pixel back to each small blob (an eye) the dominant-colour vote erased.
   * Off by default; staging turns it on with `align`, since two details closer together than
   * one output pixel cannot all be aligned. See `keepSmallBlobs`.
   */
  readonly keepDetails?: boolean;
}

/** A point in output-frame pixels. */
export type Point = readonly [number, number];

/** Attach points of one direction, keyed by direction. */
export type PointMap = Readonly<Record<string, Point>>;

/** Where a playable character carries an item: on the `hand` or the `back`. */
export type AttachSlot = 'hand' | 'back';

/** `character` attach points, per slot and direction (output-frame pixels). */
export interface AttachPoints {
  readonly hand?: PointMap;
  readonly back?: PointMap;
}

export interface AssetSpec {
  readonly key: string;
  /** Always set after `parseSpec`: a legacy `role` is translated, and defaulted to `character`. */
  readonly kind: AssetKind;
  /** `icon`: one output file per name, read from the source grid in row-major order. */
  readonly names?: readonly string[];
  /** `icon`/`tileset`: source grid size in cells. */
  readonly columns?: number;
  readonly rows?: number;
  /** `ui`: nine-slice insets written into the sprite frame meta. */
  readonly nineSlice?: NineSlice;
  /** `attachment`: which body slot the item is worn on. Defaults to `hand`. */
  readonly slot?: AttachSlot;
  /** `attachment`: direction → grip point in the output frame. Defaults to the frame centre. */
  readonly grip?: PointMap;
  /** `attachment`: colour of the grip marker Gemini paints on the item (ticket #22). */
  readonly gripMarker?: Rgb;
  /** `attachment`: directions where the item is drawn behind the body. */
  readonly behind?: readonly string[];
  /** `character`: attach points for a weapon/prop, in output-frame pixels. */
  readonly attach?: AttachPoints;
  /** `tileset`: `.tsx` path under `assets/resources/` written next to the PNG. */
  readonly tsx?: string;
  /** Fitted kinds: size the shared crop window may fill, instead of the whole frame. */
  readonly fitBox?: readonly [number, number];
  readonly source: string;
  /** File path under `assets/resources/art/`; a **directory** for `icon`. */
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
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIRECTIONS: ReadonlySet<string> = new Set(['down', 'up', 'left', 'right']);
const ROLES: ReadonlySet<string> = new Set(['actor', 'monster', 'boss']);
const ROLE_KINDS: Readonly<Record<AssetRole, AssetKind>> = {
  actor: 'character',
  monster: 'monster',
  boss: 'boss',
};
/** Kinds drawn as animation sheets: they keep the pre-#20 required fields. */
const ANIMATED_KINDS: ReadonlySet<AssetKind> = new Set(['character', 'monster', 'boss', 'prop', 'vfx', 'particle']);
const KINDS: ReadonlySet<string> = new Set(ASSET_KINDS);
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

function optionalInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  return integer(value, label);
}

/** `[x, y]` of two integers. */
function point(value: unknown, label: string): Point {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} must be [x, y]`);
  const [x, y] = value as readonly unknown[];
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`${label} must be [x, y] of two integers`);
  return [x as number, y as number];
}

/** Direction → point, every key a direction. */
function pointMap(value: unknown, label: string): PointMap {
  if (!isRecord(value)) throw new Error(`${label} must map a direction to [x, y]`);
  const result: Record<string, Point> = {};
  for (const [direction, raw] of Object.entries(value)) {
    if (!DIRECTIONS.has(direction)) throw new Error(`${label}.${direction} must be a direction (down/up/left/right)`);
    result[direction] = point(raw, `${label}.${direction}`);
  }
  return result;
}

function nineSlice(value: unknown, label: string): NineSlice {
  if (!isRecord(value)) throw new Error(`${label} must be { left, right, top, bottom }`);
  const side = (name: 'left' | 'right' | 'top' | 'bottom'): number => {
    const raw = value[name];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      throw new Error(`${label}.${name} must be a non-negative integer`);
    }
    return raw;
  };
  return { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom') };
}

function attachPoints(value: unknown, label: string): AttachPoints {
  if (!isRecord(value)) throw new Error(`${label} must map hand/back to their direction points`);
  const result: { hand?: PointMap; back?: PointMap } = {};
  for (const [slot, raw] of Object.entries(value)) {
    if (slot !== 'hand' && slot !== 'back') throw new Error(`${label}.${slot} must be hand or back`);
    result[slot] = pointMap(raw, `${label}.${slot}`);
  }
  return result;
}

function parseAsset(value: unknown, index: number): AssetSpec {
  if (!isRecord(value)) throw new Error(`assets[${index}] must be an object`);
  const field = (name: string): unknown => value[name];
  const key = field('key');
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new Error(`assets[${index}].key must be a logical key like actor.idle.down`);
  }

  // Kind: the new field, or the legacy role, or the old default (a playable character).
  const role = field('role');
  if (role !== undefined && (typeof role !== 'string' || !ROLES.has(role))) {
    throw new Error(`${key}.role must be actor, monster or boss`);
  }
  const kindRaw = field('kind') ?? (role === undefined ? 'character' : ROLE_KINDS[role as AssetRole]);
  if (typeof kindRaw !== 'string' || !KINDS.has(kindRaw)) {
    throw new Error(`${key}.kind must be one of ${ASSET_KINDS.join(', ')}`);
  }
  const kind = kindRaw as AssetKind;
  const defaults = kindDefaults(kind);
  const animated = ANIMATED_KINDS.has(kind);

  for (const name of ['source'] as const) {
    const text = field(name);
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error(`${key}.${name} must be a non-empty string`);
    }
  }
  const sheet = field('sheet');
  if (typeof sheet !== 'string' || sheet.length === 0) throw new Error(`${key}.sheet must be a non-empty string`);
  if (sheet.includes('..') || sheet.startsWith('/') || sheet.includes('\\')) {
    throw new Error(`${key}.sheet must be a relative path under assets/resources/art`);
  }
  if (kind === 'icon') {
    if (sheet.endsWith('.png')) throw new Error(`${key}.sheet must be a directory (no .png) for an icon set`);
  } else if (!sheet.endsWith('.png')) {
    throw new Error(`${key}.sheet must be a relative .png path under assets/resources/art`);
  }

  let layout: 'grid' | 'strip';
  if (animated) {
    const raw = field('layout');
    if (raw !== 'grid' && raw !== 'strip') throw new Error(`${key}.layout must be grid or strip`);
    layout = raw;
  } else if (kind === 'attachment') {
    const raw = field('layout') ?? 'grid';
    if (raw !== 'grid') throw new Error(`${key}.layout must be grid for an attachment`);
    layout = 'grid';
  } else {
    const raw = field('layout') ?? 'strip';
    if (raw !== 'grid' && raw !== 'strip') throw new Error(`${key}.layout must be grid or strip`);
    layout = raw;
  }

  let directions: readonly string[];
  if (kind === 'attachment') {
    const raw = field('directions') ?? ['down', 'up', 'left', 'right'];
    directions = parseDirections(raw, key);
    for (const direction of ['down', 'up', 'left', 'right']) {
      if (!directions.includes(direction)) throw new Error(`${key}.directions must hold all four directions`);
    }
  } else if (animated) {
    directions = parseDirections(field('directions'), key);
  } else {
    const raw = field('directions') ?? [];
    directions = parseDirections(raw, key);
    if (directions.length > 0) throw new Error(`${key}.directions must be empty for a ${kind}`);
  }

  let frames: number;
  if (animated) {
    frames = integer(field('frames'), `${key}.frames`);
  } else if (kind === 'attachment') {
    const raw = field('frames') ?? 1;
    if (integer(raw, `${key}.frames`) !== 1) throw new Error(`${key}.frames must be 1 for an attachment`);
    frames = 1;
  } else {
    frames = optionalInteger(field('frames'), `${key}.frames`) ?? 1;
  }

  let fps: number;
  if (animated) {
    const raw = field('fps');
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new Error(`${key}.fps must be a positive number`);
    }
    fps = raw;
  } else {
    const raw = field('fps') ?? 1;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      throw new Error(`${key}.fps must be a positive number`);
    }
    fps = raw;
  }

  const anchorRaw = field('anchor') ?? defaults.anchor;
  if (anchorRaw !== 'feet' && anchorRaw !== 'center') throw new Error(`${key}.anchor must be feet or center`);
  const anchor = anchorRaw;

  const frameWidth = integer(field('frameWidth'), `${key}.frameWidth`);
  const frameHeight = integer(field('frameHeight'), `${key}.frameHeight`);
  if (kind === 'tileset' && frameWidth !== frameHeight) {
    throw new Error(`${key}.frameWidth and frameHeight must be equal (a square tile)`);
  }

  let names: readonly string[] | undefined;
  if (kind === 'icon') {
    const raw = field('names');
    if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${key}.names must list at least one icon name`);
    names = (raw as readonly unknown[]).map((name, at) => {
      if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
        throw new Error(`${key}.names[${at}] must be kebab-case`);
      }
      return name;
    });
  }
  const columns = optionalInteger(field('columns'), `${key}.columns`) ?? (kind === 'icon' ? names?.length ?? 1 : undefined);
  const rows = optionalInteger(field('rows'), `${key}.rows`);
  if (kind === 'tileset' && (columns === undefined || rows === undefined)) {
    throw new Error(`${key}.columns and rows are required for a tileset`);
  }

  const nineSliceRaw = field('nineSlice');
  const slice = nineSliceRaw === undefined ? undefined : nineSlice(nineSliceRaw, `${key}.nineSlice`);

  const slotRaw = field('slot');
  if (slotRaw !== undefined && slotRaw !== 'hand' && slotRaw !== 'back') {
    throw new Error(`${key}.slot must be hand or back`);
  }
  const gripRaw = field('grip');
  const grip = gripRaw === undefined ? undefined : pointMap(gripRaw, `${key}.grip`);
  const gripMarkerRaw = field('gripMarker');
  let gripMarker: Rgb | undefined;
  if (gripMarkerRaw !== undefined) {
    if (typeof gripMarkerRaw !== 'string' || !HEX_COLOUR.test(gripMarkerRaw)) {
      throw new Error(`${key}.gripMarker must be "#rrggbb"`);
    }
    gripMarker = hexToRgb(gripMarkerRaw);
  }
  const behindRaw = field('behind');
  let behind: readonly string[] | undefined;
  if (behindRaw !== undefined) {
    if (!Array.isArray(behindRaw) || behindRaw.some((d) => typeof d !== 'string' || !DIRECTIONS.has(d))) {
      throw new Error(`${key}.behind must contain only down/up/left/right`);
    }
    behind = behindRaw as readonly string[];
  }

  const attachRaw = field('attach');
  const attach = attachRaw === undefined ? undefined : attachPoints(attachRaw, `${key}.attach`);

  const tsxRaw = field('tsx');
  let tsx: string | undefined;
  if (tsxRaw !== undefined) {
    if (
      typeof tsxRaw !== 'string' ||
      !tsxRaw.endsWith('.tsx') ||
      tsxRaw.startsWith('/') ||
      tsxRaw.includes('\\') ||
      tsxRaw.split('/').some((segment) => segment === '..' || segment === '')
    ) {
      throw new Error(`${key}.tsx must be a relative .tsx path under assets/resources/`);
    }
    tsx = tsxRaw;
  }

  const fitBoxRaw = field('fitBox');
  let fitBox: readonly [number, number] | undefined;
  if (fitBoxRaw !== undefined) {
    const box = point(fitBoxRaw, `${key}.fitBox`);
    if (box[0] <= 0 || box[1] <= 0) throw new Error(`${key}.fitBox must be two positive sizes`);
    fitBox = box;
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
    kind,
    ...(names === undefined ? {} : { names }),
    ...(columns === undefined ? {} : { columns }),
    ...(rows === undefined ? {} : { rows }),
    ...(slice === undefined ? {} : { nineSlice: slice }),
    ...(slotRaw === undefined ? {} : { slot: slotRaw as AttachSlot }),
    ...(grip === undefined ? {} : { grip }),
    ...(gripMarker === undefined ? {} : { gripMarker }),
    ...(behind === undefined ? {} : { behind }),
    ...(attach === undefined ? {} : { attach }),
    ...(tsx === undefined ? {} : { tsx }),
    ...(fitBox === undefined ? {} : { fitBox }),
    source: field('source') as string,
    sheet,
    frameWidth,
    frameHeight,
    layout,
    directions,
    frames,
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

/** Direction list, only down/up/left/right, no duplicates. */
function parseDirections(value: unknown, key: string): readonly string[] {
  if (!Array.isArray(value) || value.some((d) => typeof d !== 'string' || !DIRECTIONS.has(d))) {
    throw new Error(`${key}.directions must contain only down/up/left/right`);
  }
  return value as readonly string[];
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

/** Blob areas `keepDetails` restores, in output px²: a detail (an eye), not a speck or a limb. */
const KEEP_DETAILS_MIN_AREA = 0.4;
const KEEP_DETAILS_MAX_AREA = 3;
/** Share of a blob's surroundings the target pixel's colour must reach before it is repainted. */
const KEEP_DETAILS_SURROUND_SHARE = 0.25;
/**
 * How deep into a blob's surroundings to sample, in output-block widths. One output pixel is
 * `1/scale` source px, so this lands about two pixels out — past the detail's own antialiased
 * edge, inside the colour that surrounds it.
 */
const KEEP_DETAILS_RING = 0.15;
/** The four orthogonal steps component labelling and border sampling walk. */
const ORTHOGONAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Give one output pixel back to each small blob (an eye) the dominant-colour vote erased.
 *
 * `source` is the window `output` was resampled from, so one source pixel covers
 * `output.width / source.width` output pixels. A 4-connected opaque blob narrower than one
 * output pixel loses every block it straddles: two eyes 2.5 output px apart cannot both sit on
 * the grid, so aligning the window (#24) saves at most one of them. After the vote, a blob is
 * restored only when all of this holds:
 * - its area is 0.4–3 output px² (a detail, not a speck or a limb);
 * - no output pixel under its bbox already shows its colour;
 * - the output pixel at its centroid is opaque and not already its colour, and that pixel's
 *   colour makes up at least a quarter of the blob's surroundings — sampled `ring` source px
 *   inwards from every border step, transparent included. A blob whose centroid lands on a
 *   colour it is not ringed by is a coincidence of the block grid, not a lost detail.
 * Decisions read the vote's output, never pixels another blob painted, so each blob is
 * judged alone. Without the option `fitCells` keeps its bytes exactly.
 */
export function keepSmallBlobs(source: PngImage, output: PngImage): PngImage {
  const { width: sourceWidth, height: sourceHeight } = source;
  const scaleX = output.width / sourceWidth;
  const scaleY = output.height / sourceHeight;
  const ring = Math.max(2, Math.round(KEEP_DETAILS_RING / scaleX));
  const data = Buffer.from(output.data);
  const seen = new Uint8Array(sourceWidth * sourceHeight);

  const outputColour = (x: number, y: number): number => {
    const from = (y * output.width + x) * 4;
    if (output.data[from + 3]! < 128) return -1;
    return (output.data[from]! << 16) | (output.data[from + 1]! << 8) | output.data[from + 2]!;
  };

  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] === 1) continue;
    const colour = packedPixel(source, start % sourceWidth, Math.floor(start / sourceWidth));
    seen[start] = 1;
    if (colour < 0) continue;

    // 4-connected blob of one opaque colour, plus the colours it borders.
    const pixels: number[] = [];
    const surroundings = new Map<number, number>();
    let borderSteps = 0;
    const stack = [start];
    while (stack.length > 0) {
      const pixel = stack.pop()!;
      pixels.push(pixel);
      const x = pixel % sourceWidth;
      const y = Math.floor(pixel / sourceWidth);
      for (const [dx, dy] of ORTHOGONAL_STEPS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= sourceWidth || ny >= sourceHeight) {
          borderSteps += 1;
          surroundings.set(-1, (surroundings.get(-1) ?? 0) + 1);
          continue;
        }
        const next = ny * sourceWidth + nx;
        const neighbour = packedPixel(source, nx, ny);
        if (neighbour === colour) {
          if (seen[next] === 0) {
            seen[next] = 1;
            stack.push(next);
          }
          continue;
        }
        const sample = packedPixel(source, clamp(x + dx * ring, 0, sourceWidth - 1), clamp(y + dy * ring, 0, sourceHeight - 1));
        const surrounding = sample === colour ? neighbour : sample;
        borderSteps += 1;
        surroundings.set(surrounding, (surroundings.get(surrounding) ?? 0) + 1);
      }
    }

    const area = pixels.length * scaleX * scaleY;
    if (area < KEEP_DETAILS_MIN_AREA || area > KEEP_DETAILS_MAX_AREA) continue;
    let dominant = -1;
    let dominantCount = 0;
    for (const [surrounding, count] of surroundings) {
      if (count > dominantCount) {
        dominant = surrounding;
        dominantCount = count;
      }
    }
    // Most of the blob borders the keyed backdrop: it is not enclosed by a detail.
    if (dominant < 0) continue;

    let sumX = 0;
    let sumY = 0;
    let x0 = sourceWidth;
    let y0 = sourceHeight;
    let x1 = -1;
    let y1 = -1;
    for (const pixel of pixels) {
      const x = pixel % sourceWidth;
      const y = Math.floor(pixel / sourceWidth);
      sumX += x + 0.5;
      sumY += y + 0.5;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }

    // Already in the output (the vote kept it in a block of its own): nothing to give back.
    let present = false;
    const bx1 = Math.min(output.width - 1, Math.floor((x1 + 1) * scaleX));
    const by1 = Math.min(output.height - 1, Math.floor((y1 + 1) * scaleY));
    for (let oy = Math.floor(y0 * scaleY); oy <= by1 && !present; oy += 1) {
      for (let ox = Math.floor(x0 * scaleX); ox <= bx1; ox += 1) {
        if (outputColour(ox, oy) === colour) {
          present = true;
          break;
        }
      }
    }
    if (present) continue;

    const tx = clamp(Math.floor((sumX / pixels.length) * scaleX), 0, output.width - 1);
    const ty = clamp(Math.floor((sumY / pixels.length) * scaleY), 0, output.height - 1);
    const target = outputColour(tx, ty);
    if (target === colour || target < 0) continue;
    if ((surroundings.get(target) ?? 0) < KEEP_DETAILS_SURROUND_SHARE * borderSteps) continue;

    const to = (ty * output.width + tx) * 4;
    data[to] = (colour >> 16) & 0xff;
    data[to + 1] = (colour >> 8) & 0xff;
    data[to + 2] = colour & 0xff;
    data[to + 3] = 255;
  }
  return { width: output.width, height: output.height, data };
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

/** Crop `width × height` at `(x0, y0)`, treating everything outside `bounds` as transparent. */
function cropWindow(
  image: PngImage,
  x0: number,
  y0: number,
  width: number,
  height: number,
  bounds: Box,
): PngImage {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = y0 + y;
    if (sourceY < bounds.y0 || sourceY >= bounds.y1) continue;
    const left = Math.max(0, bounds.x0 - x0);
    const right = Math.min(width, bounds.x1 - x0);
    if (right <= left) continue;
    const from = (sourceY * image.width + x0 + left) * 4;
    data.set(image.data.subarray(from, from + (right - left) * 4), (y * width + left) * 4);
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
  return fitCells(image, {
    columns,
    rows: frames,
    frameWidth,
    frameHeight,
    anchor: 'feet',
    share: 'column',
    ...(weights === undefined ? {} : { weights }),
  });
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
  readonly kind: 'edge' | 'drift' | 'empty' | 'resolution';
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

// ---- Ticket #20: asset kinds, per-kind fitting, slicing, meta, bob. ----

const KIND_DEFAULTS: Readonly<Record<AssetKind, KindDefaults>> = {
  character: { fit: 'feet', anchor: 'feet', share: 'column', edgeGate: true, register: 'sprite' },
  monster: { fit: 'feet', anchor: 'feet', share: 'column', edgeGate: true, register: 'sprite' },
  boss: { fit: 'feet', anchor: 'feet', share: 'sheet', edgeGate: true, register: 'sprite' },
  prop: { fit: 'feet', anchor: 'feet', share: 'sheet', edgeGate: true, register: 'sprite' },
  attachment: { fit: 'center', anchor: 'center', share: 'sheet', edgeGate: true, register: 'sprite' },
  vfx: { fit: 'center', anchor: 'center', share: 'sheet', edgeGate: false, register: 'sprite' },
  particle: { fit: 'center', anchor: 'center', share: 'sheet', edgeGate: false, register: 'sprite' },
  icon: { fit: 'center', anchor: 'center', share: 'cell', edgeGate: true, register: 'sprite' },
  ui: { fit: 'stretch', anchor: 'center', share: 'sheet', edgeGate: false, register: 'sprite' },
  tileset: { fit: 'tile', anchor: 'center', share: 'sheet', edgeGate: false, register: 'tileset' },
};

/** Defaults for a kind. */
export function kindDefaults(kind: AssetKind): KindDefaults {
  return KIND_DEFAULTS[kind];
}

interface Cell {
  readonly box: Box;
  readonly local: Box | null;
}

/** Crop to the opaque bbox of the whole image (returns it unchanged when nothing is opaque). */
export function cropToOpaque(image: PngImage): PngImage {
  const box = opaqueBox(image, { x0: 0, y0: 0, x1: image.width, y1: image.height });
  return box === null ? image : crop(image, box);
}

/**
 * `footPx` for a manifest entry. The runtime anchors at `footPx / frameHeight`, so:
 * - `feet`: transparent rows from the sheet bottom to its lowest solid pixel;
 * - `center`: the frame centre (the runtime's `center` anchor), whatever the art contains.
 */
export function footPxFor(anchor: 'feet' | 'center', image: PngImage, frameHeight: number): number {
  if (anchor === 'center') return Math.floor(frameHeight / 2);
  for (let y = image.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3]! > 0) return image.height - 1 - y;
    }
  }
  return image.height;
}

/** Shared crop window and scale of one `share` group, in source-cell pixels. */
interface FitPlan {
  readonly region: Box;
  readonly scale: number;
  readonly fitWidth: number;
  readonly fitHeight: number;
  /** Source pixels the window starts before the region when `align` is on; `[0, 0]` otherwise. */
  readonly offset: readonly [number, number];
}

/** Most distinct colours per cell the alignment score tracks; a palette-mapped sheet uses ~10. */
const ALIGN_COLOR_LIMIT = 24;
/** Prefix-sum cells the score may allocate (~32 MB of Uint32 per cell), so huge cells track fewer colours. */
const ALIGN_PREFIX_BUDGET = 8_000_000;

/** Per-pixel colour of a cell, as prefix sums the alignment score can query per block in O(1). */
interface AlignCounts {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  /** One prefix sum per tracked colour; untracked colours are counted by `opaque` minus their sum. */
  readonly colours: readonly Uint32Array[];
  readonly opaque: Uint32Array;
}

function regionSum(prefix: Uint32Array, stride: number, x0: number, y0: number, x1: number, y1: number): number {
  return prefix[y1 * stride + x1]! - prefix[y0 * stride + x1]! - prefix[y1 * stride + x0]! + prefix[y0 * stride + x0]!;
}

/**
 * Colour prefix sums over one cell. The offset search queries thousands of block rectangles,
 * so counting their pixels per candidate would be quadratic; prefix sums make each query O(1).
 */
function alignCounts(image: PngImage, box: Box): AlignCounts {
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  const stride = width + 1;
  const packed = new Int32Array(width * height).fill(-1);
  const histogram = new Map<number, number>();
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = ((box.y0 + y) * image.width + box.x0 + x) * 4;
      if (image.data[from + 3]! < 128) continue;
      const colour = (image.data[from]! << 16) | (image.data[from + 1]! << 8) | image.data[from + 2]!;
      packed[y * width + x] = colour;
      histogram.set(colour, (histogram.get(colour) ?? 0) + 1);
    }
  }
  const budget = Math.max(1, Math.floor(ALIGN_PREFIX_BUDGET / (stride * (height + 1))));
  const tracked = Array.from(histogram.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, Math.min(ALIGN_COLOR_LIMIT, budget))
    .map(([colour]) => colour);
  const slotOf = new Map<number, number>();
  tracked.forEach((colour, index) => slotOf.set(colour, index + 1));
  const colours = tracked.map(() => new Uint32Array(stride * (height + 1)));
  const opaque = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colour = packed[y * width + x]!;
      const slot = colour < 0 ? 0 : slotOf.get(colour) ?? 0;
      const here = (y + 1) * stride + x + 1;
      for (let k = 0; k < colours.length; k += 1) {
        const prefix = colours[k]!;
        prefix[here] = prefix[y * stride + x + 1]! + prefix[(y + 1) * stride + x]! - prefix[y * stride + x]! + (slot === k + 1 ? 1 : 0);
      }
      opaque[here] = opaque[y * stride + x + 1]! + opaque[(y + 1) * stride + x]! - opaque[y * stride + x]! + (colour < 0 ? 0 : 1);
    }
  }
  return { originX: box.x0, originY: box.y0, width, height, stride, colours, opaque };
}

/**
 * Mean dominant-colour share of one cell's output blocks for one window offset.
 *
 * Blocks are laid out exactly like `resamplePixelArt` lays them out for a window of
 * `fitWidth × blk` source pixels, so the score measures the pixels the fit would actually
 * pick. Transparent pixels (including anything outside the cell) vote as a colour; a block
 * that is mostly backdrop cannot win over a solid sprite pixel, and the eye that lands in
 * one block outright beats the skin around it, which is what vanishes otherwise.
 */
function alignCellScore(
  counts: AlignCounts,
  region: Box,
  scale: number,
  frameWidth: number,
  frameHeight: number,
  ox: number,
  oy: number,
): number {
  const blk = 1 / scale;
  const fitWidth = clamp(Math.ceil((region.x1 - region.x0 + ox) * scale), 1, frameWidth);
  const fitHeight = clamp(Math.ceil((region.y1 - region.y0 + oy) * scale), 1, frameHeight);
  const windowWidth = fitWidth * blk;
  const windowHeight = fitHeight * blk;
  const windowX = counts.originX + region.x0 - ox;
  const windowY = counts.originY + region.y0 - oy;
  let score = 0;
  for (let by = 0; by < fitHeight; by += 1) {
    const ys = Math.floor((by * windowHeight) / fitHeight);
    const ye = Math.max(ys + 1, Math.floor(((by + 1) * windowHeight) / fitHeight));
    for (let bx = 0; bx < fitWidth; bx += 1) {
      const xs = Math.floor((bx * windowWidth) / fitWidth);
      const xe = Math.max(xs + 1, Math.floor(((bx + 1) * windowWidth) / fitWidth));
      const area = (xe - xs) * (ye - ys);
      const cx0 = clamp(windowX + xs - counts.originX, 0, counts.width);
      const cx1 = clamp(windowX + xe - counts.originX, 0, counts.width);
      const cy0 = clamp(windowY + ys - counts.originY, 0, counts.height);
      const cy1 = clamp(windowY + ye - counts.originY, 0, counts.height);
      const inside = Math.max(0, cx1 - cx0) * Math.max(0, cy1 - cy0);
      let best = area - inside;
      let tracked = 0;
      for (const prefix of counts.colours) {
        const count = regionSum(prefix, counts.stride, cx0, cy0, cx1, cy1);
        if (count > best) best = count;
        tracked += count;
      }
      const opaqueInside = regionSum(counts.opaque, counts.stride, cx0, cy0, cx1, cy1);
      if (opaqueInside - tracked > best) best = opaqueInside - tracked;
      if (inside - opaqueInside > best) best = inside - opaqueInside;
      score += best / area;
    }
  }
  return score / (fitWidth * fitHeight);
}

/** Window offset (source px before the region) where the group's blocks are most uniform. */
function bestAlignOffset(
  image: PngImage,
  members: readonly Cell[],
  region: Box,
  scale: number,
  frameWidth: number,
  frameHeight: number,
): readonly [number, number] {
  const span = Math.max(1, Math.ceil(1 / scale));
  const totals = new Float64Array(span * span);
  for (const cell of members) {
    if (cell.local === null) continue;
    const counts = alignCounts(image, cell.box);
    for (let oy = 0; oy < span; oy += 1) {
      for (let ox = 0; ox < span; ox += 1) {
        totals[oy * span + ox]! += alignCellScore(counts, region, scale, frameWidth, frameHeight, ox, oy);
      }
    }
  }
  // Ascending index keeps the smallest offset on a tie, so aligned art never moves.
  let best = 0;
  for (let index = 1; index < totals.length; index += 1) {
    if (totals[index]! > totals[best]!) best = index;
  }
  return [best % span, Math.floor(best / span)];
}

interface Fitting {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly cells: readonly Cell[];
  readonly groupOf: (row: number, column: number) => number;
  readonly plans: ReadonlyMap<number, FitPlan>;
}

/**
 * The crop/scale decisions `fitCells` makes, shared with `fitPoint` so a source point maps
 * to the pixel the fitted sheet actually shows.
 */
function planFitting(image: PngImage, options: FitCellsOptions): Fitting {
  const { columns, rows, frameWidth, frameHeight, anchor, share } = options;
  for (const [label, value] of [
    ['columns', columns],
    ['rows', rows],
    ['frameWidth', frameWidth],
    ['frameHeight', frameHeight],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  }
  const cellWidth = image.width / columns;
  const cellHeight = image.height / rows;
  if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) {
    throw new Error(`source ${image.width}×${image.height} does not split into ${columns}×${rows} cells`);
  }

  const cells: Cell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const box: Box = {
        x0: column * cellWidth,
        y0: row * cellHeight,
        x1: (column + 1) * cellWidth,
        y1: (row + 1) * cellHeight,
      };
      const found = opaqueBox(image, box);
      cells.push({
        box,
        local:
          found === null
            ? null
            : { x0: found.x0 - box.x0, y0: found.y0 - box.y0, x1: found.x1 - box.x0, y1: found.y1 - box.y0 },
      });
    }
  }

  const groupOf = (row: number, column: number): number =>
    share === 'sheet' ? 0 : share === 'column' ? column : row * columns + column;
  const members = new Map<number, Cell[]>();
  const regions = new Map<number, Box | null>();
  cells.forEach((cell, index) => {
    const group = groupOf(Math.floor(index / columns), index % columns);
    const list = members.get(group);
    if (list === undefined) members.set(group, [cell]);
    else list.push(cell);
    const current = regions.has(group) ? regions.get(group)! : null;
    regions.set(group, unionBox(current, cell.local));
  });

  const align = options.align === true;
  const [boxWidth, boxHeight] =
    options.fitBox ?? (anchor === 'feet' ? [frameWidth - 1, frameHeight - 1] : [frameWidth, frameHeight]);
  const plans = new Map<number, FitPlan>();
  for (const [group, region] of regions) {
    if (region === null) continue;
    const regionWidth = region.x1 - region.x0;
    const regionHeight = region.y1 - region.y0;
    if (regionWidth <= 0 || regionHeight <= 0) continue;
    const scale = Math.min(boxWidth / regionWidth, boxHeight / regionHeight);
    if (!align) {
      plans.set(group, {
        region,
        scale,
        offset: [0, 0],
        fitWidth: Math.min(frameWidth, Math.max(1, Math.round(regionWidth * scale))),
        fitHeight: Math.min(frameHeight, Math.max(1, Math.round(regionHeight * scale))),
      });
      continue;
    }
    // The window grows by the offset it starts before the region, so it always covers the
    // whole region; the extra block is what makes up the sub-pixel shift.
    const offset = bestAlignOffset(image, members.get(group) ?? [], region, scale, frameWidth, frameHeight);
    plans.set(group, {
      region,
      scale,
      offset,
      fitWidth: Math.min(frameWidth, Math.max(1, Math.ceil((regionWidth + offset[0]) * scale))),
      fitHeight: Math.min(frameHeight, Math.max(1, Math.ceil((regionHeight + offset[1]) * scale))),
    });
  }
  return { cellWidth, cellHeight, cells, groupOf, plans };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Frame-local top-left corner of a plan's piece. `feet` puts the frame's lowest opaque output
 * row on the cell floor; `center` centres the piece. An aligned window may start before the
 * region, so its extra rows count towards where the feet land; either way the piece and its
 * placement stay inside the frame.
 */
function piecePlacement(plan: FitPlan, local: Box, options: FitCellsOptions): Point {
  const { frameWidth, frameHeight, anchor, align } = options;
  const { region, scale, fitWidth, fitHeight, offset } = plan;
  if (align === true) {
    return [
      clamp(Math.floor((frameWidth - fitWidth) / 2), 0, frameWidth - fitWidth),
      anchor === 'feet'
        ? clamp(frameHeight - Math.ceil((local.y1 - region.y0 + offset[1]) * scale), 0, frameHeight - fitHeight)
        : clamp(Math.floor((frameHeight - fitHeight) / 2), 0, frameHeight - fitHeight),
    ];
  }
  return [
    Math.floor((frameWidth - fitWidth) / 2),
    anchor === 'feet'
      ? Math.max(0, frameHeight - Math.round((local.y1 - region.y0) * scale))
      : Math.floor((frameHeight - fitHeight) / 2),
  ];
}

/**
 * Fit every cell of a source grid into output frames.
 *
 * `share` decides which cells union their crop window (and therefore share one scale):
 * - `column`: every frame of a direction column (today's character/monster behaviour),
 * - `sheet`: every cell of the sheet (an effect strip keeps its motion between frames),
 * - `cell`: each cell alone (icons each fill their own frame).
 *
 * `anchor: 'center'` centres the shared window in the frame; `'feet'` puts each frame's
 * own feet on the cell floor, exactly like `fitColumnsToCells`.
 */
export function fitCells(image: PngImage, options: FitCellsOptions): PngImage {
  const { columns, rows, frameWidth, frameHeight, weights, align } = options;
  const { cells, groupOf, plans } = planFitting(image, options);

  const outWidth = frameWidth * columns;
  const data = Buffer.alloc(outWidth * frameHeight * rows * 4);
  cells.forEach((cell, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const plan = plans.get(groupOf(row, column));
    if (plan === undefined || cell.local === null) return;
    const { region, scale, fitWidth, fitHeight, offset } = plan;
    let windowed: PngImage;
    if (align === true) {
      // The window starts `offset` before the region and is a whole number of blocks wide, so
      // every output block is exactly one source block and the feature that straddled two
      // blocks now sits inside one.
      const windowWidth = Math.ceil(fitWidth / scale);
      const windowHeight = Math.ceil(fitHeight / scale);
      windowed = cropWindow(
        image,
        cell.box.x0 + region.x0 - offset[0],
        cell.box.y0 + region.y0 - offset[1],
        windowWidth,
        windowHeight,
        cell.box,
      );
    } else {
      const window: Box = {
        x0: cell.box.x0 + region.x0,
        y0: cell.box.y0 + region.y0,
        x1: cell.box.x0 + region.x1,
        y1: cell.box.y0 + region.y1,
      };
      windowed = crop(image, window);
    }
    const voted = resamplePixelArt(windowed, fitWidth, fitHeight, weights);
    const piece = options.keepDetails === true ? keepSmallBlobs(windowed, voted) : voted;
    const [pieceLeft, pieceTop] = piecePlacement(plan, cell.local, options);
    const left = column * frameWidth + pieceLeft;
    const top = row * frameHeight + pieceTop;
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
  });
  return { width: outWidth, height: frameHeight * rows, data };
}

/**
 * Slice a tileset grid into whole tiles, edge to edge: every source cell is resampled
 * (dominant colour per block) to one `tileSize × tileSize` tile, no crop and no chroma
 * key. Alpha stays binary, so an opaque tile stays opaque.
 */
export function sliceTiles(image: PngImage, columns: number, rows: number, tileSize: number): PngImage {
  for (const [label, value] of [
    ['columns', columns],
    ['rows', rows],
    ['tileSize', tileSize],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  }
  const cellWidth = image.width / columns;
  const cellHeight = image.height / rows;
  if (!Number.isInteger(cellWidth) || !Number.isInteger(cellHeight)) {
    throw new Error(`source ${image.width}×${image.height} does not split into ${columns}×${rows} tiles`);
  }
  const width = columns * tileSize;
  const data = Buffer.alloc(columns * tileSize * rows * tileSize * 4);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const box: Box = {
        x0: column * cellWidth,
        y0: row * cellHeight,
        x1: (column + 1) * cellWidth,
        y1: (row + 1) * cellHeight,
      };
      const tile = resamplePixelArt(crop(image, box), tileSize, tileSize);
      for (let y = 0; y < tileSize; y += 1) {
        const from = y * tileSize * 4;
        data.set(tile.data.subarray(from, from + tileSize * 4), ((row * tileSize + y) * width + column * tileSize) * 4);
      }
    }
  }
  return { width, height: rows * tileSize, data };
}

/**
 * Cocos `.meta` for a nearest-filtered sprite frame, optionally nine-sliced. The caller
 * owns uuid stability: pass the uuid already in the `.meta` file when re-staging.
 */
export function spriteFrameMeta(
  uuid: string,
  name: string,
  width: number,
  height: number,
  border?: NineSlice,
): Record<string, unknown> {
  const sx = Math.round(width / 2);
  const sy = Math.round(height / 2);
  return {
    ver: '1.0.27',
    importer: 'image',
    imported: true,
    uuid,
    files: ['.json', '.png'],
    subMetas: {
      '6c48a': {
        importer: 'texture',
        uuid: `${uuid}@6c48a`,
        displayName: name,
        id: '6c48a',
        name: 'texture',
        userData: {
          wrapModeS: 'clamp-to-edge',
          wrapModeT: 'clamp-to-edge',
          imageUuidOrDatabaseUri: uuid,
          isUuid: true,
          visible: false,
          minfilter: 'nearest',
          magfilter: 'nearest',
          mipfilter: 'none',
          anisotropy: 0,
        },
        ver: '1.0.22',
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
      f9941: {
        importer: 'sprite-frame',
        uuid: `${uuid}@f9941`,
        displayName: name,
        id: 'f9941',
        name: 'spriteFrame',
        userData: {
          trimThreshold: 1,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          trimX: 0,
          trimY: 0,
          width,
          height,
          rawWidth: width,
          rawHeight: height,
          borderTop: border?.top ?? 0,
          borderBottom: border?.bottom ?? 0,
          borderLeft: border?.left ?? 0,
          borderRight: border?.right ?? 0,
          packable: true,
          pixelsToUnit: 100,
          pivotX: 0.5,
          pivotY: 0.5,
          meshType: 0,
          vertices: {
            rawPosition: [-sx, -sy, 0, sx, -sy, 0, -sx, sy, 0, sx, sy, 0],
            indexes: [0, 1, 2, 2, 1, 3],
            uv: [0, height, width, height, 0, 0, width, 0],
            nuv: [0, 0, 1, 0, 0, 1, 1, 1],
            minPos: [-sx, -sy, 0],
            maxPos: [sx, sy, 0],
          },
          isUuid: true,
          imageUuidOrDatabaseUri: `${uuid}@6c48a`,
          atlasUuid: '',
          trimType: 'auto',
        },
        ver: '1.0.12',
        imported: true,
        files: ['.json'],
        subMetas: {},
      },
    },
    userData: {
      type: 'sprite-frame',
      fixAlphaTransparencyArtifacts: false,
      hasAlpha: true,
      redirect: `${uuid}@6c48a`,
    },
  };
}

/**
 * Per column, per frame: how many pixels the top of the sprite sits below frame 0's
 * (positive = lower). A frame with no opaque pixel gets 0, so an attachment never jumps
 * on an empty cell.
 */
export function frameBob(image: PngImage, columns: number, rows: number, frameWidth: number, frameHeight: number): number[][] {
  const topOf = (column: number, row: number): number | null => {
    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        if (image.data[((row * frameHeight + y) * image.width + column * frameWidth + x) * 4 + 3]! >= 128) {
          return y;
        }
      }
    }
    return null;
  };
  const result: number[][] = [];
  for (let column = 0; column < columns; column += 1) {
    const base = topOf(column, 0);
    const bobs: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      const top = topOf(column, row);
      bobs.push(top === null || base === null ? 0 : top - base);
    }
    result.push(bobs);
  }
  return result;
}

// ---- Ticket #22: resolution warning and grip markers. ----

/** Block sizes Gemini draws pixel art with. Largest first: a 16 px block is also a valid 8 px grid. */
const NATIVE_BLOCK_SIZES = [32, 16, 8] as const;
/**
 * Share of an axis' colour changes that must sit on one block grid before the grid is
 * believed. The real downloads measure ~0.92 for their 16 px grid and ~0.50 for their 32 px
 * candidate (which only sees every second line), so the split is wide.
 */
const BLOCK_GRID_SHARE = 0.65;
/** Gemini's blocks are 15–16 px with a 1 px seam, so a change may land just beside the line. */
const BLOCK_SEAM_SLACK = 1;

/** Packed colour of a pixel, or -1 when it is transparent. */
function packedPixel(image: PngImage, x: number, y: number): number {
  const index = (y * image.width + x) * 4;
  if (image.data[index + 3]! < 128) return -1;
  return (image.data[index]! << 16) | (image.data[index + 1]! << 8) | image.data[index + 2]!;
}

/**
 * Positions (x for `x`, y for `y`) where the colour changes between adjacent pixels, weighted
 * by how many rows/columns change there, and **ignoring changes that touch a 1 px run**.
 *
 * A real block boundary repeats across the whole sprite; an anti-aliased speck is a 1 px run
 * that changes on both sides in a single row. Weighting and dropping those runs keeps the
 * grid measurable through the noise of a real download (which has ~10 000 of them), while a
 * genuine pixel-art block grid still explains > 90% of the remaining changes.
 */
function transitionCounts(image: PngImage, axis: 'x' | 'y'): Map<number, number> {
  const counts = new Map<number, number>();
  const outer = axis === 'x' ? image.height : image.width;
  const inner = axis === 'x' ? image.width : image.height;
  const at = (index: number, other: number): number =>
    axis === 'x' ? packedPixel(image, index, other) : packedPixel(image, other, index);
  for (let other = 0; other < outer; other += 1) {
    let runStart = 0;
    let runColour = at(0, other);
    for (let index = 1; index <= inner; index += 1) {
      if (index < inner && at(index, other) === runColour) continue;
      if (index < inner) {
        let nextEnd = index + 1;
        while (nextEnd < inner && at(nextEnd, other) === at(index, other)) nextEnd += 1;
        if (index - runStart >= 2 && nextEnd - index >= 2) {
          counts.set(index, (counts.get(index) ?? 0) + 1);
        }
      }
      runStart = index;
      if (index < inner) runColour = at(index, other);
    }
  }
  return counts;
}

/** Share of the axis' colour changes that land within `BLOCK_SEAM_SLACK` of the best grid line. */
function gridShare(counts: ReadonlyMap<number, number>, block: number): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  if (total < 8) return 0;
  let best = 0;
  for (let line = 0; line < block; line += 1) {
    let onGrid = 0;
    for (const [position, count] of counts) {
      const residue = ((position % block) + block) % block;
      const distance = Math.min(Math.abs(residue - line), block - Math.abs(residue - line));
      if (distance <= BLOCK_SEAM_SLACK) onGrid += count;
    }
    if (onGrid > best) best = onGrid;
  }
  return best / total;
}

/**
 * Size in source pixels of the pixel blocks the image was drawn with.
 *
 * A block size and its divisors both explain a purely block-aligned image, so the largest
 * accepted size wins: art drawn with 16 px blocks is not "8 px art", and its 32 px candidate
 * only covers half of the changes. Smooth (not blocky) art has no grid that explains most
 * changes and returns 1.
 */
export function nativeBlockSize(image: PngImage): number {
  const xs = transitionCounts(image, 'x');
  const ys = transitionCounts(image, 'y');
  for (const block of NATIVE_BLOCK_SIZES) {
    if (gridShare(xs, block) >= BLOCK_GRID_SHARE && gridShare(ys, block) >= BLOCK_GRID_SHARE) return block;
  }
  return 1;
}

/**
 * One `resolution` issue per direction column whose sprite has far more native blocks than
 * its fitted height: below one block per output pixel, 1-block details such as eyes vanish
 * in the downscale. Warns, never blocks — the caller prints it and stages anyway.
 */
export function resolutionIssues(
  image: PngImage,
  columns: number,
  rows: number,
  fitBox: readonly [number, number],
): SheetIssue[] {
  const blockSize = nativeBlockSize(image);
  const cellWidth = Math.floor(image.width / columns);
  const cellHeight = Math.floor(image.height / rows);
  const issues: SheetIssue[] = [];
  for (let column = 0; column < columns; column += 1) {
    let region: Box | null = null;
    for (let row = 0; row < rows; row += 1) {
      const box: Box = {
        x0: column * cellWidth,
        y0: row * cellHeight,
        x1: (column + 1) * cellWidth,
        y1: (row + 1) * cellHeight,
      };
      const found = opaqueBox(image, box);
      region = unionBox(
        region,
        found === null
          ? null
          : { x0: found.x0 - box.x0, y0: found.y0 - box.y0, x1: found.x1 - box.x0, y1: found.y1 - box.y0 },
      );
    }
    if (region === null) continue;
    const regionWidth = region.x1 - region.x0;
    const regionHeight = region.y1 - region.y0;
    if (regionWidth <= 0 || regionHeight <= 0) continue;
    const scale = Math.min(fitBox[0] / regionWidth, fitBox[1] / regionHeight);
    const fittedHeight = Math.round(regionHeight * scale);
    const blocksTall = Math.round(regionHeight / blockSize);
    if (blocksTall > fittedHeight * 1.5) {
      issues.push({
        kind: 'resolution',
        column,
        row: 0,
        detail: `drawn ${blocksTall} blocks tall, staged ${fittedHeight} px — 1-block details (eyes) will be lost; ask for fewer, larger blocks`,
      });
    }
  }
  return issues;
}

/** RGB euclidean distance under which a pixel counts as the grip marker (Gemini's shades drift). */
const MARKER_TOLERANCE = 60;
/**
 * Blends of marker and item around the plate count as marker up to this distance. They no
 * longer match the marker colour (a cyan marker's blends land on the palette's aqua), but a
 * halo left behind folds into an aqua pixel in the staged sheet.
 */
const MARKER_HALO_TOLERANCE = 160;
/** How far around a marker pixel the replacement colour is searched, and how thick the halo is. */
const MARKER_RING = 2;

/**
 * Remove the grip marker Gemini painted on an attachment and read where it was.
 *
 * Marker pixels take the most common opaque, non-marker colour in the ring around them —
 * that restores the item's own colour where the marker covered it — or vanish when only the
 * keyed backdrop surrounds them. A marker plate wider than the ring inherits from its edge,
 * so a whole block is removed without leaving a hole. The anti-aliased ring Gemini blends
 * around the plate is removed too, but only where a pixel is closer to the marker than to
 * the item colour beside it, so a genuinely aqua detail next to the marker survives.
 * `centres` is per cell in row-major order, in absolute source pixels (pixel (x, y) has
 * centre (x + 0.5, y + 0.5)), or null.
 */
export function removeMarker(
  image: PngImage,
  marker: Rgb,
  columns: number,
  rows: number,
): { readonly image: PngImage; readonly centres: Array<readonly [number, number] | null> } {
  const { width, height } = image;
  const cellWidth = Math.floor(width / columns);
  const cellHeight = Math.floor(height / rows);
  const coreLimit = MARKER_TOLERANCE * MARKER_TOLERANCE;
  const haloLimit = MARKER_HALO_TOLERANCE * MARKER_HALO_TOLERANCE;

  /** Squared RGB distance of a pixel to the marker colour, or -1 when it is transparent. */
  const markerDistance = (index: number): number => {
    const from = index * 4;
    if (image.data[from + 3]! < 128) return -1;
    const dr = image.data[from]! - marker[0];
    const dg = image.data[from + 1]! - marker[1];
    const db = image.data[from + 2]! - marker[2];
    return dr * dr + dg * dg + db * db;
  };

  const core = new Uint8Array(width * height);
  for (let index = 0; index < core.length; index += 1) {
    const distance = markerDistance(index);
    if (distance >= 0 && distance <= coreLimit) core[index] = 1;
  }

  const centres: Array<readonly [number, number] | null> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      for (let y = row * cellHeight; y < (row + 1) * cellHeight; y += 1) {
        for (let x = column * cellWidth; x < (column + 1) * cellWidth; x += 1) {
          if (core[y * width + x] !== 1) continue;
          count += 1;
          sumX += x + 0.5;
          sumY += y + 0.5;
        }
      }
      centres.push(count === 0 ? null : [sumX / count, sumY / count]);
    }
  }

  const data = Buffer.from(image.data);
  const resolved = new Uint8Array(width * height);
  const queue: number[] = [];
  const replace = (index: number, colour: number): void => {
    data[index * 4] = (colour >> 16) & 0xff;
    data[index * 4 + 1] = (colour >> 8) & 0xff;
    data[index * 4 + 2] = colour & 0xff;
    data[index * 4 + 3] = 255;
  };
  const clear = (index: number): void => {
    data.fill(0, index * 4, index * 4 + 4);
  };

  /** Most common opaque item colour in the ring, skipping the marker and its halo. */
  const itemColourAround = (x: number, y: number): number | null => {
    const counts = new Map<number, number>();
    for (let dy = -MARKER_RING; dy <= MARKER_RING; dy += 1) {
      for (let dx = -MARKER_RING; dx <= MARKER_RING; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        const distance = markerDistance(neighbour);
        if (distance >= 0 && distance <= haloLimit) continue;
        const from = neighbour * 4;
        if (image.data[from + 3]! < 128) continue;
        const packed = (image.data[from]! << 16) | (image.data[from + 1]! << 8) | image.data[from + 2]!;
        counts.set(packed, (counts.get(packed) ?? 0) + 1);
      }
    }
    let best: number | null = null;
    let bestCount = -1;
    for (const [packed, count] of counts) {
      if (count > bestCount || (count === bestCount && best !== null && packed < best)) {
        best = packed;
        bestCount = count;
      }
    }
    return best;
  };

  // The halo: blends of marker and item that sit on the plate but no longer match the marker
  // colour. They are excluded from `centres`, so the grip does not move towards them.
  const halo = new Set<number>();
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -MARKER_RING; dy <= MARKER_RING; dy += 1) {
      for (let dx = -MARKER_RING; dx <= MARKER_RING; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (core[neighbour] === 1) continue;
        const distance = markerDistance(neighbour);
        if (distance < 0 || distance > haloLimit) continue;
        halo.add(neighbour);
      }
    }
  }
  for (const index of halo) {
    const colour = itemColourAround(index % width, Math.floor(index / width));
    if (colour === null) {
      clear(index);
      continue;
    }
    const fill = unpack(colour);
    const from = index * 4;
    const toFill = (image.data[from]! - fill[0]) ** 2 + (image.data[from + 1]! - fill[1]) ** 2 + (image.data[from + 2]! - fill[2]) ** 2;
    if (markerDistance(index) < toFill) replace(index, colour);
  }

  // Each plate pixel that can see the item takes the ring's most common colour.
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== 1) continue;
    const colour = itemColourAround(index % width, Math.floor(index / width));
    if (colour === null) continue;
    replace(index, colour);
    resolved[index] = 1;
    queue.push(index);
  }

  // A plate wider than the ring inherits from its resolved edge.
  for (let head = 0; head < queue.length; head += 1) {
    const pixel = queue[head]!;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const colour = (data[pixel * 4]! << 16) | (data[pixel * 4 + 1]! << 8) | data[pixel * 4 + 2]!;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (core[neighbour] !== 1 || resolved[neighbour] === 1) continue;
        replace(neighbour, colour);
        resolved[neighbour] = 1;
        queue.push(neighbour);
      }
    }
  }

  // Whatever is left of the plate sat on the backdrop: remove it.
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] === 1 && resolved[index] === 0) clear(index);
  }

  return { image: { width, height, data }, centres };
}

/**
 * Map a source point to the frame-local output pixel `fitCells` puts it in: same cell
 * lookup, shared region, scale and placement, floored and clamped inside the frame.
 * Staging uses it to turn a marker centre into an attachment grip.
 */
export function fitPoint(image: PngImage, options: FitCellsOptions, point: readonly [number, number]): Point {
  const { columns, rows, frameWidth, frameHeight } = options;
  const { cellWidth, cellHeight, cells, groupOf, plans } = planFitting(image, options);
  const column = clamp(Math.floor(point[0] / cellWidth), 0, columns - 1);
  const row = clamp(Math.floor(point[1] / cellHeight), 0, rows - 1);
  const cell = cells[row * columns + column]!;
  const plan = plans.get(groupOf(row, column));
  const middle: Point = [Math.floor(frameWidth / 2), Math.floor(frameHeight / 2)];
  if (plan === undefined || cell.local === null) return middle;
  const { region, scale, fitWidth, fitHeight, offset } = plan;
  const [left, top] = piecePlacement(plan, cell.local, options);
  if (options.align === true) {
    // Same window, block count and placement `fitCells` uses, so the grip lands on the pixel
    // the staged sheet shows.
    const windowWidth = Math.ceil(fitWidth / scale);
    const windowHeight = Math.ceil(fitHeight / scale);
    const windowX = cell.box.x0 + region.x0 - offset[0];
    const windowY = cell.box.y0 + region.y0 - offset[1];
    return [
      clamp(left + Math.floor(((point[0] - windowX) * fitWidth) / windowWidth), 0, frameWidth - 1),
      clamp(top + Math.floor(((point[1] - windowY) * fitHeight) / windowHeight), 0, frameHeight - 1),
    ];
  }
  return [
    clamp(left + Math.floor((point[0] - (cell.box.x0 + region.x0)) * scale), 0, frameWidth - 1),
    clamp(top + Math.floor((point[1] - (cell.box.y0 + region.y0)) * scale), 0, frameHeight - 1),
  ];
}
