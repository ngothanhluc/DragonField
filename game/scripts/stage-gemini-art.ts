/**
 * Stage art generated with `create-game-assets` from `art-source/gemini/` into the asset DB.
 *
 * Run: `bun run stage:gen` (optionally pass a spec path as the first argument).
 *
 * - The raw download is never committed. Order matters: chroma key → palette mapping at full
 *   resolution, per colour cluster so a shade maps the same way on every frame → limit the sheet to `maxColors` → drop stray blobs per cell → quality gate → fit/downscale (dominant
 *   palette colour per block, rare colours weighted up) → despeckle → mirror. Mapping before the downscale makes the
 *   block vote count palette colours instead of thousands of raw shades, which is what
 *   turned edges into noise.
 * - The quality gate (`inspectCells`) runs only for kinds with an `edgeGate`; it aborts on a
 *   sprite crossing its cell edge or a frame whose colours drift from its column (drift is
 *   skipped for icons, whose cells are different objects). `--force` stages anyway and only
 *   prints the issues.
 * - `kind` picks the pipeline: animated sheets fit cells, `attachment` also records the
 *   item's grip, `character` with `attach` records the rig and its per-frame bob, `icon`
 *   splits one fitted grid into one PNG per name, `ui` stretches to the exact size with
 *   nine-slice borders, `tileset` slices whole tiles and optionally writes a `.tsx`.
 * - `.meta` keeps its uuid across re-runs; the manifest is merged, not regenerated.
 * - New actors are registered in `config/generated-art.json` by kind so the manifest test
 *   accepts them.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDirMeta, writeMeta } from './lib/audio';
import {
  chromaKey,
  clusterToPalette,
  cornerColor,
  cropToOpaque,
  despeckle,
  directionKey,
  dropStrayBlobs,
  fitCells,
  fitPoint,
  footPxFor,
  frameBob,
  inspectCells,
  kindDefaults,
  limitColors,
  mirrorColumn,
  paletteColors,
  parseSpec,
  quantize,
  removeMarker,
  resamplePixelArt,
  resolutionIssues,
  salienceWeights,
  sliceTiles,
  spriteFrameMeta,
  type AssetKind,
  type AssetSpec,
  type AttachPoints,
  type FitCellsOptions,
  type NineSlice,
  type Point,
  type PointMap,
} from './lib/gemini-art';
import { buildTsx } from './lib/room-layout';
import { readPng, writePng } from './lib/png';
import type { PngImage } from './lib/png';
import { validateAttachments, type AttachmentItem, type CharacterRig } from '../assets/scripts/core/art/attachments';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const ROOT = join(PROJECT, '..');
const RES = join(PROJECT, 'assets', 'resources');
const ART = join(RES, 'art');
const MANIFEST = join(RES, 'data', 'animations.json');
const ATTACHMENTS = join(RES, 'data', 'attachments.json');
const GENERATED_ACTORS = join(PROJECT, 'config', 'generated-art.json');
const PALETTE = join(ROOT, 'art-source', 'ninja-adventure', 'Palette.png');
const DEFAULT_SPEC = join(ROOT, 'art-source', 'gemini', 'spec.json');
const DEFAULT_MAX_COLORS = 10;
const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;

interface ManifestEntry {
  readonly sheet: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly layout: 'grid' | 'strip';
  readonly directions: readonly string[];
  readonly frames: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly anchor: 'feet' | 'center';
  readonly footPx: number;
}

interface StagedAsset {
  readonly key: string;
  readonly entry: ManifestEntry;
}

interface Registration {
  readonly kind: AssetKind;
  readonly name: string;
}

/** Palette-mapped source grid, plus the grip-marker centres read from the keyed download. */
interface Prepared {
  readonly image: PngImage;
  readonly markerCentres: ReadonlyArray<readonly [number, number] | null>;
}

interface AttachmentsFile {
  version: number;
  characters: Record<string, CharacterRig>;
  items: Record<string, AttachmentItem>;
}

/** Which list in `config/generated-art.json` a staged prefix belongs to. */
const LIST_BY_KIND: Readonly<Record<AssetKind, string | null>> = {
  character: 'actors',
  monster: 'monsters',
  boss: 'bosses',
  prop: 'props',
  vfx: 'vfx',
  particle: 'particles',
  attachment: 'attachments',
  icon: 'icons',
  ui: 'ui',
  tileset: null,
};

function inside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}${sep}`);
}

/** uuid of an existing `.meta`, so a re-run never invalidates editor references. */
function stableUuid(path: string): string {
  const metaPath = `${path}.meta`;
  if (existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid?: unknown };
      if (typeof parsed.uuid === 'string') return parsed.uuid;
    } catch {
      // A malformed meta is replaced with a fresh uuid.
    }
  }
  return randomUUID();
}

function imageMeta(path: string, width: number, height: number, border?: NineSlice): object {
  const name = path.split('/').pop()?.replace(/\.png$/, '') ?? 'image';
  return spriteFrameMeta(stableUuid(path), name, width, height, border);
}

function textMeta(path: string): object {
  return {
    ver: '1.0.1',
    importer: 'text',
    imported: true,
    uuid: stableUuid(path),
    files: ['.json'],
    subMetas: {},
    userData: {},
  };
}

/** Create every missing folder between `assets/resources/` and `path`, with its meta. */
function ensureResourceDir(path: string): void {
  const rel = relative(RES, path).split(sep).join('/');
  if (rel === '' || rel.startsWith('..')) return;
  const parts = rel.split('/');
  parts.forEach((_part, index) => ensureDirMeta(parts.slice(0, index + 1).join('/')));
}

/** Write a staged PNG under `assets/resources/art/` plus its stable `.meta`. */
function writeImage(relativePath: string, image: PngImage, border?: NineSlice): void {
  const path = resolve(ART, relativePath);
  if (!inside(path, ART)) throw new Error(`${relativePath}: sheet must live under assets/resources/art`);
  ensureResourceDir(dirname(path));
  writePng(path, image);
  writeMeta(path, imageMeta(path, image.width, image.height, border));
  console.log(`art  ${relativePath} (${image.width}×${image.height})`);
}

/** Source grid geometry of an asset: column = direction, row = frame (a strip is one row). */
function sourceCells(asset: AssetSpec): { readonly columns: number; readonly rows: number } {
  if (asset.kind === 'icon') {
    const count = asset.names?.length ?? 1;
    const columns = Math.max(1, asset.columns ?? count);
    return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
  }
  if (asset.layout === 'grid') return { columns: Math.max(1, asset.directions.length), rows: asset.frames };
  return { columns: asset.frames, rows: 1 };
}

/**
 * Raw download → palette-mapped source grid, with the quality gate. Chroma key only runs
 * when the spec names a background, so tilesets (drawn opaque) are untouched. A
 * `gripMarker` is read and removed here, on the keyed image, before the palette mapping
 * can fold its colour into a sprite colour.
 */
function prepare(
  asset: AssetSpec,
  palette: readonly (readonly [number, number, number])[],
  force: boolean,
): Prepared {
  const source = resolve(ROOT, asset.source);
  if (!inside(source, join(ROOT, 'art-source', 'gemini'))) {
    throw new Error(`${asset.key}: source must live under art-source/gemini`);
  }
  if (!existsSync(source)) throw new Error(`${asset.key}: missing source image ${source}`);

  const defaults = kindDefaults(asset.kind);
  const cells = sourceCells(asset);
  const raw = readPng(source);
  let keyed =
    asset.background === undefined
      ? raw
      : chromaKey(raw, asset.background === 'auto' ? cornerColor(raw) : asset.background);
  let markerCentres: ReadonlyArray<readonly [number, number] | null> = [];
  if (asset.gripMarker !== undefined) {
    const removed = removeMarker(keyed, asset.gripMarker, cells.columns, cells.rows);
    keyed = removed.image;
    markerCentres = removed.centres;
  }

  const maxColors = asset.maxColors ?? (asset.kind === 'tileset' ? undefined : DEFAULT_MAX_COLORS);
  let mapped = clusterToPalette(keyed, palette);
  if (maxColors !== undefined) mapped = limitColors(mapped, maxColors);

  if (asset.layout === 'grid' || asset.kind === 'icon') {
    mapped = dropStrayBlobs(mapped, cells.columns, cells.rows);
  }
  if (defaults.edgeGate) {
    const mirrored = Object.keys(asset.mirror ?? {}).map((direction) => asset.directions.indexOf(direction));
    let issues = inspectCells(mapped, cells.columns, cells.rows, { skipColumns: mirrored });
    // An icon set is a grid of different objects: their colours legitimately differ.
    if (asset.kind === 'icon') issues = issues.filter((issue) => issue.kind !== 'drift');
    for (const issue of issues) {
      const direction = asset.directions[issue.column] ?? `column ${issue.column}`;
      console.warn(`${force ? 'warn' : 'FAIL'}  ${asset.key} ${direction} frame ${issue.row + 1}: ${issue.kind} — ${issue.detail}`);
    }
    if (issues.length > 0 && !force) {
      throw new Error(`${asset.key}: ${issues.length} quality issue(s); regenerate, or pass --force to stage anyway`);
    }
  }
  return { image: mapped, markerCentres };
}

function cropCell(image: PngImage, column: number, row: number, width: number, height: number): PngImage {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((row * height + y) * image.width + column * width) * 4;
    data.set(image.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data };
}

function entryFor(asset: AssetSpec, sheet: string, image: PngImage): ManifestEntry {
  return {
    sheet,
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
    layout: asset.layout,
    directions: asset.directions,
    frames: asset.frames,
    fps: asset.fps,
    loop: asset.loop,
    anchor: asset.anchor,
    footPx: footPxFor(asset.anchor, image, asset.frameHeight),
  };
}

/** Single-image entry: one frame, centred, no direction (icons and UI images). */
function stillEntry(asset: AssetSpec, sheet: string, image: PngImage): ManifestEntry {
  return {
    sheet,
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
    layout: 'strip',
    directions: [],
    frames: 1,
    fps: 1,
    loop: false,
    anchor: 'center',
    footPx: footPxFor('center', image, asset.frameHeight),
  };
}

function prefixOf(asset: AssetSpec): string {
  return asset.key.split('.')[0] ?? asset.key;
}

function stage(
  asset: AssetSpec,
  palette: readonly (readonly [number, number, number])[],
  force: boolean,
  attachments: AttachmentsFile,
): StagedAsset[] {
  const defaults = kindDefaults(asset.kind);
  const prepared = prepare(asset, palette, force);
  const mapped = prepared.image;
  const cells = sourceCells(asset);
  // Kinds fitted into a frame line their output grid up with the source's pixel grid, so a
  // feature narrower than one output pixel (an eye) keeps its own block, and give back a pixel
  // to the small details the block vote still erases. `ui` stretches and `tileset` slices
  // whole cells, so both keep their exact mapping.
  const align = defaults.fit === 'feet' || defaults.fit === 'center';

  if (defaults.register === 'tileset') {
    const columns = asset.columns ?? 1;
    const rows = asset.rows ?? 1;
    const sliced = quantize(sliceTiles(mapped, columns, rows, asset.frameWidth), palette);
    writeImage(asset.sheet, sliced);
    if (asset.tsx !== undefined) writeTsx(asset, sliced, columns, rows);
    return [];
  }

  if (asset.kind === 'ui') {
    // A generated panel arrives on a fixed canvas; with a keyed backdrop the drawn margin is
    // transparent, so crop to the panel before stretching it to the exact target size.
    const drawn = asset.background === undefined ? mapped : cropToOpaque(mapped);
    const processed = quantize(resamplePixelArt(drawn, asset.frameWidth, asset.frameHeight), palette);
    writeImage(asset.sheet, processed, asset.nineSlice);
    return [{ key: asset.key, entry: stillEntry(asset, `resources/art/${asset.sheet}`, processed) }];
  }

  if (asset.kind === 'icon') {
    const processed = quantize(
      despeckle(
        fitCells(mapped, {
          columns: cells.columns,
          rows: cells.rows,
          frameWidth: asset.frameWidth,
          frameHeight: asset.frameHeight,
          anchor: defaults.anchor,
          share: defaults.share,
          align,
          keepDetails: align,
        }),
      ),
      palette,
    );
    const parts = asset.key.split('.');
    const actor = parts[0] ?? asset.key;
    const set = parts[1] ?? 'icon';
    return (asset.names ?? []).map((name, index) => {
      const column = index % cells.columns;
      const row = Math.floor(index / cells.columns);
      const file = `${asset.sheet}/${set}-${name}.png`;
      const cell = cropCell(processed, column, row, asset.frameWidth, asset.frameHeight);
      writeImage(file, cell);
      return { key: `${actor}.${set}-${name}`, entry: stillEntry(asset, `resources/art/${file}`, cell) };
    });
  }

  const fitOptions: FitCellsOptions = {
    columns: cells.columns,
    rows: cells.rows,
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
    anchor: defaults.anchor,
    share: defaults.share,
    align,
    keepDetails: align,
    weights: salienceWeights(mapped),
    ...(asset.fitBox === undefined ? {} : { fitBox: asset.fitBox }),
  };

  // A download drawn with more native blocks than its frame has pixels loses its 1-block
  // details in the downscale. Warn; never fail — this never changes the staged pixels.
  const fitBox: readonly [number, number] =
    asset.fitBox ??
    (defaults.anchor === 'feet'
      ? [asset.frameWidth - 1, asset.frameHeight - 1]
      : [asset.frameWidth, asset.frameHeight]);
  if (asset.directions.length > 0) {
    for (const issue of resolutionIssues(mapped, cells.columns, cells.rows, fitBox)) {
      const direction = asset.directions[issue.column] ?? `column ${issue.column}`;
      console.warn(`warn  ${asset.key} ${direction}: resolution — ${issue.detail}`);
    }
  }

  const fitted = fitCells(mapped, fitOptions);
  let shaded = despeckle(fitted);
  for (const [target, from] of Object.entries(asset.mirror ?? {})) {
    shaded = mirrorColumn(shaded, asset.frameWidth, asset.directions.indexOf(from), asset.directions.indexOf(target));
  }
  // Resolve marker grips before writing anything: a missing marker must fail the asset
  // without leaving a half-staged PNG behind.
  const markerGrips =
    asset.kind === 'attachment' && asset.gripMarker !== undefined
      ? gripFromMarker(asset, mapped, fitOptions, prepared.markerCentres)
      : {};
  // The input is already on the palette; this only re-asserts binary alpha.
  const processed = quantize(shaded, palette);
  writeImage(asset.sheet, processed);

  const entry = entryFor(asset, `resources/art/${asset.sheet}`, processed);

  if (asset.kind === 'character' && asset.attach !== undefined) recordCharacter(attachments, asset, processed, cells);
  if (asset.kind === 'attachment') recordItem(attachments, asset, markerGrips);

  if (asset.directions.length <= 1) return [{ key: asset.key, entry }];
  return asset.directions.map((direction) => ({ key: directionKey(asset.key, direction), entry }));
}

/** Record a character's attach points and per-frame bob, merging animations staged separately. */
function recordCharacter(
  file: AttachmentsFile,
  asset: AssetSpec,
  processed: PngImage,
  cells: { readonly columns: number; readonly rows: number },
): void {
  if (asset.layout !== 'grid') throw new Error(`${asset.key}: attach needs a grid character sheet`);
  const parts = asset.key.split('.');
  const actor = parts[0] ?? asset.key;
  const animation = parts[1] ?? 'idle';
  const bobColumns = frameBob(processed, cells.columns, cells.rows, asset.frameWidth, asset.frameHeight);
  const bob: Record<string, number[]> = {};
  if (asset.directions.length === 0) bob['down'] = bobColumns[0] ?? [];
  asset.directions.forEach((direction, index) => {
    bob[direction] = bobColumns[index] ?? [];
  });
  const existing = file.characters[actor];
  file.characters[actor] = {
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
    points: { ...(existing?.points ?? {}), ...(asset.attach ?? {}) } satisfies AttachPoints,
    bob: { ...(existing?.bob ?? {}), [animation]: bob },
  };
}

/**
 * Output-frame grip points of an attachment, read from the marker in each direction cell.
 * Explicit `grip[direction]` entries still win in `recordItem`; a cell without a marker is
 * an authoring mistake, so it fails with the direction named.
 */
function gripFromMarker(
  asset: AssetSpec,
  image: PngImage,
  fitOptions: FitCellsOptions,
  centres: ReadonlyArray<readonly [number, number] | null>,
): PointMap {
  const grips: Record<string, Point> = {};
  asset.directions.forEach((direction, index) => {
    const centre = centres[index];
    if (centre === null || centre === undefined) {
      throw new Error(
        `${asset.key}: no ${String(asset.gripMarker)} gripMarker pixel in the ${direction} cell — paint one small marker block on the item, or drop gripMarker`,
      );
    }
    grips[direction] = fitPoint(image, fitOptions, centre);
  });
  return grips;
}

/** Record an attachment's slot, grip and draw-order override. */
function recordItem(file: AttachmentsFile, asset: AssetSpec, markerGrips: PointMap = {}): void {
  const name = asset.key.split('.')[1] ?? asset.key;
  const centre: Point = [Math.floor(asset.frameWidth / 2), Math.floor(asset.frameHeight / 2)];
  const grip: Record<string, Point> = {};
  for (const direction of DIRECTIONS) {
    grip[direction] = asset.grip?.[direction] ?? markerGrips[direction] ?? centre;
  }
  file.items[name] = {
    sprite: asset.key,
    slot: asset.slot ?? 'hand',
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
    grip,
    ...(asset.behind === undefined ? {} : { behind: asset.behind }),
  };
}

function writeTsx(asset: AssetSpec, image: PngImage, columns: number, rows: number): void {
  if (asset.tsx === undefined) return;
  const tsxPath = resolve(RES, asset.tsx);
  if (!inside(tsxPath, RES)) throw new Error(`${asset.key}: tsx must live under assets/resources`);
  const pngPath = resolve(ART, asset.sheet);
  ensureResourceDir(dirname(tsxPath));
  const imagePath = relative(dirname(tsxPath), pngPath).split(sep).join('/');
  const xml = buildTsx({
    name: basename(tsxPath).replace(/\.tsx$/, ''),
    image: imagePath,
    tileWidth: asset.frameWidth,
    tileHeight: asset.frameHeight,
    columns,
    tilecount: columns * rows,
    imageWidth: image.width,
    imageHeight: image.height,
  });
  writeFileSync(tsxPath, xml);
  writeMeta(tsxPath, textMeta(tsxPath));
  console.log(`tsx  ${asset.tsx}`);
}

function readAttachments(): AttachmentsFile {
  if (!existsSync(ATTACHMENTS)) return { version: 1, characters: {}, items: {} };
  const parsed = JSON.parse(readFileSync(ATTACHMENTS, 'utf8')) as Partial<AttachmentsFile>;
  return { version: 1, characters: { ...(parsed.characters ?? {}) }, items: { ...(parsed.items ?? {}) } };
}

function writeAttachments(file: AttachmentsFile): void {
  validateAttachments(file);
  writeFileSync(ATTACHMENTS, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`attach  ${ATTACHMENTS}`);
}

function mergeManifest(entries: ReadonlyMap<string, ManifestEntry>): void {
  const current = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    version: number;
    sprites: Record<string, ManifestEntry>;
  };
  for (const [key, entry] of entries) current.sprites[key] = entry;
  writeFileSync(MANIFEST, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`manifest  ${MANIFEST} (+${entries.size} entries)`);
}

function registerGenerated(registrations: readonly Registration[]): void {
  const current = JSON.parse(readFileSync(GENERATED_ACTORS, 'utf8')) as Record<string, unknown>;
  for (const { kind, name } of registrations) {
    const listName = LIST_BY_KIND[kind];
    if (listName === null) continue;
    const list = Array.isArray(current[listName]) ? (current[listName] as string[]) : (current[listName] = []);
    if (!list.includes(name)) list.push(name);
    list.sort();
  }
  writeFileSync(GENERATED_ACTORS, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`actors  ${GENERATED_ACTORS}`);
}

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const specArg = args.find((arg) => !arg.startsWith('--'));
  const specPath = specArg === undefined ? DEFAULT_SPEC : resolve(specArg);
  if (!existsSync(specPath)) throw new Error(`missing spec: ${specPath}`);
  const spec = parseSpec(JSON.parse(readFileSync(specPath, 'utf8')) as unknown);
  if (!existsSync(PALETTE)) throw new Error(`missing palette: ${PALETTE}`);
  const palette = paletteColors(readPng(PALETTE));
  if (palette.length === 0) throw new Error(`palette has no opaque colours: ${PALETTE}`);

  const entries = new Map<string, ManifestEntry>();
  const registrations = new Map<string, Registration>();
  const attachments = readAttachments();
  let touchesAttachments = false;
  for (const asset of spec.assets) {
    for (const staged of stage(asset, palette, force, attachments)) {
      entries.set(staged.key, staged.entry);
    }
    registrations.set(`${asset.kind}:${prefixOf(asset)}`, { kind: asset.kind, name: prefixOf(asset) });
    if (asset.kind === 'attachment' || (asset.kind === 'character' && asset.attach !== undefined)) {
      touchesAttachments = true;
    }
  }
  if (entries.size > 0) mergeManifest(entries);
  registerGenerated(Array.from(registrations.values()));
  if (touchesAttachments) writeAttachments(attachments);
}

main();
