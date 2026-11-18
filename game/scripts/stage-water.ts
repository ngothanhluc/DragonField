/**
 * Stage the animated water sheets (3-part waterfall + water ripples) from `Backgrounds/Animated/`.
 * They are 16×16 sprite strips, not a tileset, so they are drawn by `RoomWater`.
 *
 * Run: `bun run scripts/stage-water.ts`
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const PACK = join(PROJECT, '..', 'art-source', 'ninja-adventure', 'Backgrounds', 'Animated');
const TARGET = join(PROJECT, 'assets', 'resources', 'art', 'fx', 'water');

const FILES: ReadonlyArray<readonly [string, string]> = [
  ['Waterfall/TopSheet16x16.png', 'waterfall-top.png'],
  ['Waterfall/MiddleSheet16x16.png', 'waterfall-mid.png'],
  ['Waterfall/BottomSheet16x16.png', 'waterfall-bottom.png'],
  ['Water Ripples/SpriteSheet16x16.png', 'ripple.png'],
];

function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function meta(path: string): object {
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

mkdirSync(TARGET, { recursive: true });
for (const [sourceRel, targetName] of FILES) {
  const source = join(PACK, sourceRel);
  const target = join(TARGET, targetName);
  if (!existsSync(source)) throw new Error(`missing ${source}`);
  writeFileSync(target, readFileSync(source));
  writeFileSync(`${target}.meta`, `${JSON.stringify(meta(target), null, 2)}\n`);
  console.log(targetName, pngSize(target));
}

const folderMeta = `${TARGET}.meta`;
if (!existsSync(folderMeta)) {
  writeFileSync(
    folderMeta,
    `${JSON.stringify(
      {
        ver: '1.2.0',
        importer: 'directory',
        imported: true,
        uuid: randomUUID(),
        files: [],
        subMetas: {},
        userData: {},
      },
      null,
      2,
    )}\n`,
  );
}
