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
 * - The quality gate (`inspectCells`) aborts on a sprite crossing its cell edge or a frame
 *   whose colours drift from its column; `--force` stages anyway and only prints them.
 * - `.meta` keeps its uuid across re-runs; the manifest is merged, not regenerated.
 * - New actors are registered in `config/generated-art.json` so the manifest test accepts them.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDirMeta, writeMeta } from './lib/audio';
import {
  chromaKey,
  clusterToPalette,
  cornerColor,
  despeckle,
  directionKey,
  dropStrayBlobs,
  fitColumnsToCells,
  inspectCells,
  limitColors,
  mirrorColumn,
  paletteColors,
  parseSpec,
  quantize,
  resamplePixelArt,
  salienceWeights,
  sheetSize,
  type AssetRole,
  type AssetSpec,
} from './lib/gemini-art';
import { bottomPadding, readPng, writePng } from './lib/png';
import type { PngImage } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const ROOT = join(PROJECT, '..');
const RES = join(PROJECT, 'assets', 'resources');
const ART = join(RES, 'art');
const MANIFEST = join(RES, 'data', 'animations.json');
const GENERATED_ACTORS = join(PROJECT, 'config', 'generated-art.json');
const PALETTE = join(ROOT, 'art-source', 'ninja-adventure', 'Palette.png');
const DEFAULT_SPEC = join(ROOT, 'art-source', 'gemini', 'spec.json');
const DEFAULT_MAX_COLORS = 10;

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

interface GeneratedActors {
  actors: string[];
  monsters: string[];
  bosses: string[];
}

function inside(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}${sep}`);
}

function imageMeta(path: string, width: number, height: number): object {
  const metaPath = `${path}.meta`;
  let uuid: string = randomUUID();
  if (existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid?: unknown };
      if (typeof parsed.uuid === 'string') uuid = parsed.uuid;
    } catch {
      // A malformed meta is replaced with a fresh uuid.
    }
  }
  const name = path.split('/').pop()?.replace(/\.png$/, '') ?? 'image';
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
          borderTop: 0,
          borderBottom: 0,
          borderLeft: 0,
          borderRight: 0,
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

function stage(
  asset: AssetSpec,
  palette: readonly (readonly [number, number, number])[],
  force: boolean,
): StagedAsset[] {
  const source = resolve(ROOT, asset.source);
  if (!inside(source, join(ROOT, 'art-source', 'gemini'))) {
    throw new Error(`${asset.key}: source must live under art-source/gemini`);
  }
  if (!existsSync(source)) throw new Error(`${asset.key}: missing source image ${source}`);

  const raw = readPng(source);
  const keyed =
    asset.background === undefined
      ? raw
      : chromaKey(raw, asset.background === 'auto' ? cornerColor(raw) : asset.background);

  if (asset.layout === 'strip' && asset.directions.length > 1) {
    throw new Error(`${asset.key}: layout "strip" has a single row, so at most one direction`);
  }

  // A four-column sheet stays one file; the manifest gets one key per direction and
  // the runtime picks the column with `directions.indexOf(direction)`.
  let mapped = limitColors(clusterToPalette(keyed, palette), asset.maxColors ?? DEFAULT_MAX_COLORS);
  if (asset.layout === 'grid') {
    mapped = dropStrayBlobs(mapped, Math.max(1, asset.directions.length), asset.frames);
    const mirrored = Object.keys(asset.mirror ?? {}).map((direction) => asset.directions.indexOf(direction));
    const issues = inspectCells(mapped, Math.max(1, asset.directions.length), asset.frames, {
      skipColumns: mirrored,
    });
    for (const issue of issues) {
      const direction = asset.directions[issue.column] ?? `column ${issue.column}`;
      console.warn(`${force ? 'warn' : 'FAIL'}  ${asset.key} ${direction} frame ${issue.row + 1}: ${issue.kind} — ${issue.detail}`);
    }
    if (issues.length > 0 && !force) {
      throw new Error(`${asset.key}: ${issues.length} quality issue(s); regenerate, or pass --force to stage anyway`);
    }
  }
  const entry = writeSheet(asset, mapped, palette);
  if (asset.directions.length <= 1) return [{ key: asset.key, entry }];
  return asset.directions.map((direction) => ({
    key: directionKey(asset.key, direction),
    entry,
  }));
}

function writeSheet(
  asset: AssetSpec,
  image: PngImage,
  palette: readonly (readonly [number, number, number])[],
): ManifestEntry {
  const size = sheetSize(asset);
  const sheet = resolve(ART, asset.sheet);
  if (!inside(sheet, ART)) throw new Error(`${asset.key}: sheet must live under assets/resources/art`);

  const columns = Math.max(1, asset.directions.length);
  const weights = salienceWeights(image);
  const fitted =
    asset.layout === 'grid' && (asset.fit ?? 'cell') === 'cell'
      ? fitColumnsToCells(image, columns, asset.frames, asset.frameWidth, asset.frameHeight, weights)
      : resamplePixelArt(image, size.width, size.height, weights);
  let prepared = despeckle(fitted);
  for (const [target, from] of Object.entries(asset.mirror ?? {})) {
    prepared = mirrorColumn(prepared, asset.frameWidth, asset.directions.indexOf(from), asset.directions.indexOf(target));
  }
  // The input is already on the palette; this only re-asserts binary alpha.
  const processed = quantize(prepared, palette);
  const folder = `art/${dirname(asset.sheet).replace(/\\/g, '/')}`;
  const parts = folder.split('/').filter((part) => part.length > 0 && part !== '.');
  parts.forEach((_part, index) => ensureDirMeta(parts.slice(0, index + 1).join('/')));
  writePng(sheet, processed);
  writeMeta(sheet, imageMeta(sheet, size.width, size.height));
  console.log(`art  ${asset.sheet} (${size.width}×${size.height})`);

  return {
    sheet: `resources/art/${asset.sheet}`,
    frameWidth: asset.frameWidth,
    frameHeight: asset.frameHeight,
    layout: asset.layout,
    directions: asset.directions,
    frames: asset.frames,
    fps: asset.fps,
    loop: asset.loop,
    anchor: asset.anchor,
    footPx: bottomPadding(processed),
  };
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

function registerActors(roles: ReadonlyMap<string, AssetRole>): void {
  const current = JSON.parse(readFileSync(GENERATED_ACTORS, 'utf8')) as GeneratedActors;
  for (const [actor, role] of roles) {
    const list = role === 'boss' ? current.bosses : role === 'monster' ? current.monsters : current.actors;
    if (!list.includes(actor)) list.push(actor);
  }
  current.actors.sort();
  current.monsters.sort();
  current.bosses.sort();
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
  const roles = new Map<string, AssetRole>();
  for (const asset of spec.assets) {
    for (const staged of stage(asset, palette, force)) {
      entries.set(staged.key, staged.entry);
      roles.set(staged.key.split('.')[0] ?? staged.key, asset.role ?? 'actor');
    }
  }
  mergeManifest(entries);
  registerActors(roles);
}

main();
