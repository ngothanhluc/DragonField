/**
 * Stage M21 Village Hub & Shop Interior pack assets from `art-source/ninja-adventure/`:
 *
 * 1. Tilesets (`assets/resources/art/tilesets/`):
 *    - Verifies/stages Village Hub tilesets (`TilesetHouse`, `TilesetNature`, `TilesetElement`,
 *      `TilesetField`, `TilesetFloor`, `TilesetFloorDetail`, `tileset_camp`) and Shop Interior
 *      tilesets (`interior/Elements`, `interior/TilesetInterior`, `interior/TilesetInteriorFloor`,
 *      `interior/TilesetWallSimple`, `tileset_bed`), enforcing `nearest` texture filtering on all
 *      `.meta` files while preserving existing UUIDs.
 * 2. Non-playable NPCs (`assets/resources/art/npc/<id>/`):
 *    - Stages 5 villagers (`Villager`, `Villager2`, `Villager3`, `Villager4`, `Woman`) +
 *      `shopkeeper` (`OldMan`) + `dojo-master` (`Master`) with byte-for-byte `Idle.png`,
 *      `Faceset.png`, lossless 4-direction `stand` (`16×16`) & `step` (`64×16`) strips, and
 *      nearest-filtered `.meta` files.
 *    - Stages `animal.bird` (`Actor/Animal/Parrot/SpriteSheetBlue.png` → `16×32` vertical grid).
 *    - Merges only the new `npc.*` + `animal.bird` entries at the bottom of `animations.json`
 *      via `mergeM21ManifestEntries` (existing entries untouched).
 * 3. Village & Dialog Audio (`assets/resources/audio/`):
 *    - Stages cozy village music `Audio/Musics/1 - Adventure Begin.ogg` → `audio/music/village.mp3`.
 *    - Stages soft RPG dialog voice blips (`Voice4.wav`, `Voice3.wav`, `Move1.wav`) →
 *      `audio/sfx/dialog-blip{,-2,-3}.mp3`.
 *
 * Idempotent: re-running keeps every existing `.meta` UUID unchanged.
 *
 * Run: `cd game && bun run scripts/stage-m21-assets.ts`
 */
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIRECTIONS } from '../assets/scripts/core/art/manifest';
import { convertAudio, ensureDir, ensureDirMeta, resolvePackDir, writeMeta } from './lib/audio';
import {
  M21_NPC_SOURCES,
  buildM21SpriteEntries,
  mergeM21ManifestEntries,
} from './lib/m21-manifest';
import { bottomPadding, encodePng, readPng, type PngImage } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const ASSETS = join(PROJECT, 'assets');
const RES = join(ASSETS, 'resources');
const MANIFEST_PATH = join(RES, 'data', 'animations.json');
const PACK = resolvePackDir();

function pngSize(path: string): { readonly width: number; readonly height: number } {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${path}`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function existingUuid(path: string): string | null {
  const metaPath = `${path}.meta`;
  if (!existsSync(metaPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { uuid?: unknown };
    return typeof parsed.uuid === 'string' ? parsed.uuid : null;
  } catch {
    return null;
  }
}

function imageMeta(path: string): object {
  const uuid = existingUuid(path) ?? randomUUID();
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

/** Ensure an existing or newly-staged PNG has a valid nearest-filtered `.meta` keeping its UUID. */
function ensureNearestImageMeta(path: string): void {
  const metaPath = `${path}.meta`;
  if (existsSync(metaPath)) {
    try {
      const { width, height } = pngSize(path);
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        importer?: string;
        subMetas?: Record<string, { userData?: Record<string, unknown> }>;
      };
      const texData = parsed.subMetas?.['6c48a']?.userData;
      const frameData = parsed.subMetas?.['f9941']?.userData;
      if (
        parsed.importer === 'image' &&
        texData !== undefined &&
        frameData?.['rawWidth'] === width &&
        frameData?.['rawHeight'] === height
      ) {
        if (
          texData['minfilter'] !== 'nearest' ||
          texData['magfilter'] !== 'nearest' ||
          texData['mipfilter'] !== 'none'
        ) {
          texData['minfilter'] = 'nearest';
          texData['magfilter'] = 'nearest';
          texData['mipfilter'] = 'none';
          writeFileSync(metaPath, `${JSON.stringify(parsed, null, 2)}\n`);
          console.log(`nearest filter updated: ${path}`);
        }
        return;
      }
    } catch {
      // Fall through to rewrite malformed meta.
    }
  }
  writeMeta(path, imageMeta(path));
}

function stagePngCopy(packRel: string, resRel: string): string {
  const source = join(PACK, packRel);
  const target = join(RES, resRel);
  if (!existsSync(source)) throw new Error(`missing pack PNG: ${source}`);
  ensureDir(dirname(target));
  if (!existsSync(target)) {
    copyFileSync(source, target);
    console.log(`staged ${resRel}`);
  }
  ensureNearestImageMeta(target);
  return target;
}

function writeStagedPng(resRel: string, image: PngImage): string {
  const target = join(RES, resRel);
  ensureDir(dirname(target));
  writeFileSync(target, encodePng(image));
  ensureNearestImageMeta(target);
  return target;
}

/** Slice a single `16×16` cell `(col, row)` from a sheet. */
function extractCell(sheet: PngImage, col: number, row: number, size = 16): PngImage {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const si = ((row * size + y) * sheet.width + (col * size + x)) * 4;
      const di = (y * size + x) * 4;
      sheet.data.copy(data, di, si, si + 4);
    }
  }
  return { width: size, height: size, data };
}

/** Slice column `col` (`rows` cells of `16×16`) into a horizontal strip (`(rows*16)×16`). */
function columnToHorizontalStrip(sheet: PngImage, col: number, rows: number, size = 16): PngImage {
  const width = size * rows;
  const height = size;
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < rows; row += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const si = ((row * size + y) * sheet.width + (col * size + x)) * 4;
        const di = (y * width + (row * size + x)) * 4;
        sheet.data.copy(data, di, si, si + 4);
      }
    }
  }
  return { width, height, data };
}

/** Re-pack a horizontal strip (`frames × size` wide) into a vertical grid (`size × (frames*size)`). */
function horizontalToVerticalGrid(sheet: PngImage, frames: number, size = 16): PngImage {
  const width = size;
  const height = size * frames;
  const data = Buffer.alloc(width * height * 4);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const si = (y * sheet.width + (frame * size + x)) * 4;
        const di = ((frame * size + y) * width + x) * 4;
        sheet.data.copy(data, di, si, si + 4);
      }
    }
  }
  return { width, height, data };
}

// --- 1. Verify & ensure nearest filtering on M21 Village + Interior tilesets -
ensureDirMeta('art/tilesets');
ensureDirMeta('art/tilesets/interior');

const REQUIRED_TILESETS: readonly (readonly [string, string])[] = [
  ['Backgrounds/Tilesets/TilesetHouse.png', 'art/tilesets/TilesetHouse.png'],
  ['Backgrounds/Tilesets/TilesetNature.png', 'art/tilesets/TilesetNature.png'],
  ['Backgrounds/Tilesets/TilesetElement.png', 'art/tilesets/TilesetElement.png'],
  ['Backgrounds/Tilesets/TilesetField.png', 'art/tilesets/TilesetField.png'],
  ['Backgrounds/Tilesets/tileset_camp.png', 'art/tilesets/tileset_camp.png'],
  ['Backgrounds/Tilesets/tileset_bed.png', 'art/tilesets/tileset_bed.png'],
  ['Backgrounds/Tilesets/Interior/Elements.png', 'art/tilesets/interior/Elements.png'],
  ['Backgrounds/Tilesets/Interior/TilesetInterior.png', 'art/tilesets/interior/TilesetInterior.png'],
  [
    'Backgrounds/Tilesets/Interior/TilesetInteriorFloor.png',
    'art/tilesets/interior/TilesetInteriorFloor.png',
  ],
  [
    'Backgrounds/Tilesets/Interior/TilesetWallSimple.png',
    'art/tilesets/interior/TilesetWallSimple.png',
  ],
];

for (const [packRel, resRel] of REQUIRED_TILESETS) {
  stagePngCopy(packRel, resRel);
}
// Also ensure already-staged cropped `TilesetFloor.png` + `TilesetFloorDetail.png` keep nearest meta.
for (const extra of ['art/tilesets/TilesetFloor.png', 'art/tilesets/TilesetFloorDetail.png']) {
  const full = join(RES, extra);
  if (existsSync(full)) ensureNearestImageMeta(full);
}

// --- 2. Stage 7 NPCs (5 villagers + shopkeeper + dojo-master) + bird animal --
ensureDirMeta('art/npc');
ensureDirMeta('art/characters/animals');

const footBySheet = new Map<string, number>();

function recordFoot(assetRelSheet: string, pngPath: string): void {
  footBySheet.set(assetRelSheet, bottomPadding(readPng(pngPath)));
}

for (const { id, packFolder } of M21_NPC_SOURCES) {
  const dirRel = `art/npc/${id}`;
  ensureDirMeta(dirRel);

  const charDir = `Actor/Character/${packFolder}`;
  // Byte-for-byte Faceset (38×38) and 4-direction Idle strip (64×16).
  stagePngCopy(`${charDir}/Faceset.png`, `${dirRel}/Faceset.png`);
  const idleTarget = stagePngCopy(`${charDir}/SeparateAnim/Idle.png`, `${dirRel}/${id}.png`);
  recordFoot(`resources/${dirRel}/${id}.png`, idleTarget);

  const idlePng = readPng(join(PACK, `${charDir}/SeparateAnim/Idle.png`));
  const walkPng = readPng(join(PACK, `${charDir}/SeparateAnim/Walk.png`));

  DIRECTIONS.forEach((dir, colIndex) => {
    const standRel = `${dirRel}/${id}-stand-${dir}.png`;
    const standPath = writeStagedPng(standRel, extractCell(idlePng, colIndex, 0, 16));
    recordFoot(`resources/${standRel}`, standPath);

    const stepRel = `${dirRel}/${id}-step-${dir}.png`;
    const stepPath = writeStagedPng(stepRel, columnToHorizontalStrip(walkPng, colIndex, 4, 16));
    recordFoot(`resources/${stepRel}`, stepPath);
  });
}

// Relocated village bird (`Parrot/SpriteSheetBlue.png`: 32×16 horizontal → 16×32 vertical grid).
const parrotPng = readPng(join(PACK, 'Actor/Animal/Parrot/SpriteSheetBlue.png'));
const birdRel = 'art/characters/animals/bird.png';
const birdPath = writeStagedPng(birdRel, horizontalToVerticalGrid(parrotPng, 2, 16));
recordFoot(`resources/${birdRel}`, birdPath);

// Merge M21 sprite entries cleanly at the bottom of `animations.json`.
const existingRaw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const m21Sprites = buildM21SpriteEntries(footBySheet);
const mergedManifest = mergeM21ManifestEntries(existingRaw, m21Sprites);
writeFileSync(MANIFEST_PATH, `${JSON.stringify(mergedManifest, null, 2)}\n`);
console.log(
  `animations.json: merged ${Object.keys(m21Sprites).length} M21 keys (${Object.keys(mergedManifest.sprites).length} total)`,
);

// --- 3. Stage cozy village music & soft dialog voice blips -------------------
ensureDirMeta('audio/music');
ensureDirMeta('audio/sfx');

convertAudio('Audio/Musics/1 - Adventure Begin.ogg', 'audio/music/village.mp3', '64k', 2);
convertAudio('Audio/Sounds/Voice/Voice4.wav', 'audio/sfx/dialog-blip.mp3', '80k', 1);
convertAudio('Audio/Sounds/Voice/Voice3.wav', 'audio/sfx/dialog-blip-2.mp3', '80k', 1);
convertAudio('Audio/Sounds/Menu/Move1.wav', 'audio/sfx/dialog-blip-3.mp3', '80k', 1);
