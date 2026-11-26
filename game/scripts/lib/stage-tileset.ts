/**
 * Stage the pack sheets ticket #67 needs, give the room folders a `.tsx` for them, and set the
 * pixel-art filter on every sheet a tile layer draws.
 *
 * - `TilesetFloor.png` is the demo's terrain sheet: each 11×7 block holds a 3×3 blob at columns
 *   0-2, the strip/single pieces, then the four inner corners at (6,2) NW / (5,2) NE / (6,1) SW /
 *   (5,1) SE (verified from the pixel transparency, see `tests/core/autotile.test.ts`). Every tile
 *   has the surrounding terrain baked in, so a room uses the block that matches its base floor.
 *   The sheet is 352×417: the last row is one stray pixel, cropped to 416 so `tilecount` is a
 *   whole 22×26 (the project checks `columns * height / 16`).
 * - `TilesetFloorDetail.png` (16×5 tiles: stepping stones, pebbles, grass tufts, bones) is copied
 *   byte-for-byte, like `stage-water.ts` does for the water.
 * - `tilefloor.tsx` / `floordetail.tsx` go next to the rooms of all four chapters; `field.tsx`
 *   (the ch1/ch2 base floor terrain) is copied into ch3/ch4 and `relief.tsx` (sand cliffs) into ch4.
 * - Every tileset PNG imports with **nearest** filtering: the default linear filter bleeds the
 *   neighbouring atlas tile into a patch edge as a 1-px line.
 *
 * Existing files keep their uuid, so running it twice changes nothing. `.tsx` files are Tiled text
 * assets (`importer: "text"`, `files: [".json"]`) and each copy needs its own uuid; the engine
 * looks a tileset up by the exact `source` string next to the `.tmx`.
 *
 * Run: `bun run scripts/lib/stage-tileset.ts` (asset bookkeeping, not part of the game build).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..', '..');
/** `art-source/` is gitignored; a worktree points at the main checkout with `NINJA_PACK`. */
const PACK =
  process.env['NINJA_PACK'] ?? join(PROJECT, '..', 'art-source', 'ninja-adventure', 'Backgrounds', 'Tilesets');
const TILESETS = join(PROJECT, 'assets', 'resources', 'art', 'tilesets');
const LEVELS = join(PROJECT, 'assets', 'resources', 'data', 'levels');

const TILE = 16;

interface Sheet {
  /** Pack file name. */
  readonly file: string;
  /** Target name under `art/tilesets/`. */
  readonly target: string;
  /** `.tsx` file name written next to the rooms. */
  readonly tsx: string;
  /** Chapter folders that get the `.tsx`. */
  readonly chapters: readonly number[];
  /** Crop the 1-px trailing row so the sheet is a whole number of tiles (TilesetFloor only). */
  readonly wholeTiles?: boolean;
}

const SHEETS: readonly Sheet[] = [
  { file: 'TilesetFloor.png', target: 'TilesetFloor.png', tsx: 'tilefloor.tsx', chapters: [1, 2, 3, 4], wholeTiles: true },
  { file: 'TilesetFloorDetail.png', target: 'TilesetFloorDetail.png', tsx: 'floordetail.tsx', chapters: [1, 2, 3, 4] },
  { file: 'TilesetRelief.png', target: 'TilesetRelief.png', tsx: 'relief.tsx', chapters: [4] },
];

function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Image asset meta, same shape `stage-water.ts` writes; pixel art needs nearest filtering. */
function imageMeta(path: string): object {
  const uuid = randomUUID();
  const { width, height } = pngSize(path);
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

function tsxBody(name: string, source: string, columns: number, tilecount: number, width: number, height: number): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tileset version="1.10" tiledversion="1.11.0" name="${name}" tilewidth="${TILE}" tileheight="${TILE}" ` +
      `tilecount="${tilecount}" columns="${columns}">`,
    ` <image source="${source}" width="${width}" height="${height}"/>`,
    '</tileset>',
    '',
  ].join('\n');
}

function textMeta(): object {
  return {
    ver: '1.0.1',
    importer: 'text',
    imported: true,
    uuid: randomUUID(),
    files: ['.json'],
    subMetas: {},
    userData: {},
  };
}

function writeIfMissing(path: string, content: string): boolean {
  if (existsSync(path)) return false;
  writeFileSync(path, content);
  return true;
}

/**
 * Nearest filtering for every staged tileset (R1 of the #67 review): linear filtering samples the
 * neighbouring atlas tile and draws a 1-px line outside each patch edge. Only the filter fields
 * change; uuids and everything else stay as imported.
 */
function nearestFiltering(path: string): boolean {
  const metaPath = `${path}.meta`;
  if (!existsSync(metaPath)) return false;
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    subMetas?: Record<string, { userData?: Record<string, unknown> }>;
  };
  const texture = meta.subMetas?.['6c48a'];
  if (texture?.userData === undefined) return false;
  const data = texture.userData;
  if (data['minfilter'] === 'nearest' && data['magfilter'] === 'nearest' && data['mipfilter'] === 'none') {
    return false;
  }
  data['minfilter'] = 'nearest';
  data['magfilter'] = 'nearest';
  data['mipfilter'] = 'none';
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  return true;
}

async function stageSheet(sheet: Sheet): Promise<void> {
  const source = join(PACK, sheet.file);
  const target = join(TILESETS, sheet.target);
  if (!existsSync(source)) throw new Error(`missing pack sheet ${source}`);

  if (!existsSync(target)) {
    if (sheet.wholeTiles === true) {
      const { width, height } = pngSize(source);
      const cropped = Math.floor(height / TILE) * TILE;
      await sharp(source)
        .extract({ left: 0, top: 0, width, height: cropped })
        .png()
        .toFile(target);
      console.log(`staged ${sheet.target} (cropped ${width}×${height} → ${width}×${cropped})`);
    } else {
      copyFileSync(source, target);
      console.log(`staged ${sheet.target}`);
    }
    writeFileSync(`${target}.meta`, `${JSON.stringify(imageMeta(target), null, 2)}\n`);
  }

  if (nearestFiltering(target)) console.log(`nearest filter: ${sheet.target}`);

  const { width, height } = pngSize(target);
  if (width % TILE !== 0 || height % TILE !== 0) throw new Error(`${sheet.target} is not a whole number of tiles`);
  const columns = width / TILE;
  const tilecount = columns * (height / TILE);
  const name = sheet.tsx.replace(/\.tsx$/, '');
  const body = tsxBody(name, `../../../art/tilesets/${sheet.target}`, columns, tilecount, width, height);

  for (const chapter of sheet.chapters) {
    const dir = join(LEVELS, `chapter-${chapter}`);
    const tsx = join(dir, sheet.tsx);
    if (writeIfMissing(tsx, body)) console.log(`wrote chapter-${chapter}/${sheet.tsx}`);
    writeIfMissing(`${tsx}.meta`, `${JSON.stringify(textMeta(), null, 2)}\n`);
  }
}

mkdirSync(TILESETS, { recursive: true });

async function main(): Promise<void> {
  for (const sheet of SHEETS) await stageSheet(sheet);

  // Every other sheet a room tile layer draws gets the same treatment (R1 of the #67 review).
  const others = [
    'TilesetField',
    'TilesetNature',
    'TilesetRelief',
    'TilesetElement',
    'TilesetWater',
    'TilesetDesert',
    'TilesetHouse',
    'TilesetTowers',
    'TilesetHole',
    'TilesetVillageAbandoned',
    'tileset_camp',
  ];
  for (const file of others) {
    if (nearestFiltering(join(TILESETS, `${file}.png`))) console.log(`nearest filter: ${file}.png`);
  }
}

void main();

