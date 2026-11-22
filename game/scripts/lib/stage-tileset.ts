/**
 * Stage the pack sheets ticket #67 needs and give the room folders a `.tsx` for them.
 *
 * - `TilesetFloorDetail.png` (16×5 tiles: stepping stones, pebbles, grass tufts, bones) is copied
 *   byte-for-byte into `assets/resources/art/tilesets/`, like `stage-water.ts` does for the water.
 * - `floordetail.tsx` is written next to the rooms of all four chapters (the room pool reads it
 *   for the path and the detail scatter).
 * - `field.tsx` (the 13-piece patch terrain, already used by ch1/ch2) and, for ch4 only,
 *   `relief.tsx` (sand cliffs) are copied into the chapters that need them.
 * - `house.tsx` from TilesetHouse is added to ch4 for fences? No — nothing else is added.
 *
 * Existing files keep their uuid, so running it twice changes nothing. `.tsx` files are Tiled
 * text assets (`importer: "text"`, `files: [".json"]`) and each copy needs its own uuid; the
 * engine looks a tileset up by the exact `source` string next to the `.tmx`.
 *
 * Run: `bun run scripts/stage-tileset.ts` (only needed when a sheet is missing).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
}

const SHEETS: readonly Sheet[] = [
  { file: 'TilesetFloorDetail.png', target: 'TilesetFloorDetail.png', tsx: 'floordetail.tsx', chapters: [1, 2, 3, 4] },
  // Already staged; the ch3/ch4 room folders need their own copy of the patch terrain sheet.
  { file: 'TilesetField.png', target: 'TilesetField.png', tsx: 'field.tsx', chapters: [3, 4] },
  { file: 'TilesetRelief.png', target: 'TilesetRelief.png', tsx: 'relief.tsx', chapters: [4] },
];

function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Image asset meta, same shape `stage-water.ts` writes (nearest filtering for pixel art). */
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

mkdirSync(TILESETS, { recursive: true });
for (const sheet of SHEETS) {
  const source = join(PACK, sheet.file);
  const target = join(TILESETS, sheet.target);
  if (!existsSync(source)) throw new Error(`missing pack sheet ${source}`);
  if (!existsSync(target)) {
    copyFileSync(source, target);
    writeFileSync(`${target}.meta`, `${JSON.stringify(imageMeta(target), null, 2)}\n`);
    console.log(`staged ${sheet.target}`);
  }

  const { width, height } = pngSize(target);
  const columns = Math.floor(width / TILE);
  if (width % TILE !== 0 || height % TILE !== 0) throw new Error(`${sheet.target} is not a whole number of tiles`);
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
