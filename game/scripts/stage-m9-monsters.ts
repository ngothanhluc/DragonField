/**
 * Stage the #42 enemy art from the pack: sniper and splitter monsters that were not used before.
 *
 * Run: `bun run scripts/stage-m9-monsters.ts`
 *
 * - PNGs are copied byte-for-byte (no re-encoding pixel art) into
 *   `assets/resources/art/monsters/<kebab>/`.
 * - Each base PNG gets an image `.meta` (the same shape `stage-m6-assets.ts` writes) because
 *   `gen-elites.ts` derives the elite variant's uuid from the base meta; without it the elite
 *   sheet cannot be generated. Existing metas are never rewritten (no uuid churn on rerun).
 * - Seeds the four `walk` keys of each new monster into `animations.json` so
 *   `gen-animations.ts` (which expects a walk sheet per monster) can rebuild the manifest.
 *
 * The role → monster mapping lives in `assets/scripts/game/bootstrap.ts`
 * (`MONSTERS_BY_CHAPTER`); this script only puts the files on disk.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, ensureDirMeta, writeMeta } from './lib/audio';
import { bottomPadding, readPng } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const ASSETS = join(PROJECT, 'assets');
const MANIFEST = join(ASSETS, 'resources', 'data', 'animations.json');

interface StagedMonster {
  /** Manifest actor name (no hyphen, lowercase). */
  readonly actor: string;
  /** Folder under `resources/art/monsters/`. */
  readonly dir: string;
  /** Sheet path inside `Actor/Monster/`. */
  readonly source: string;
  /** File name inside the staged folder. */
  readonly file: string;
}

const MONSTERS: readonly StagedMonster[] = [
  { actor: 'kappagreen', dir: 'kappa-green', source: 'KappaGreen/SpriteSheet.png', file: 'SpriteSheet.png' },
  { actor: 'kappared', dir: 'kappa-red', source: 'KappaRed/SpriteSheet.png', file: 'SpriteSheet.png' },
  { actor: 'skullblue', dir: 'skull-blue', source: 'SkullBlue/SpriteSheet.png', file: 'SpriteSheet.png' },
  { actor: 'slimegreen', dir: 'slime-green', source: 'Slime/Slime.png', file: 'Slime.png' },
  { actor: 'slime2', dir: 'slime2', source: 'Slime2/Slime2.png', file: 'Slime2.png' },
  { actor: 'slime3', dir: 'slime3', source: 'Slime3/Slime3.png', file: 'Slime3.png' },
];

const DIRS = ['down', 'up', 'left', 'right'] as const;

/** The pack is gitignored and lives in the main checkout; a worktree asks git where it is. */
function packPath(): string {
  const override = process.env['ART_SOURCE'];
  const candidates = [
    ...(override === undefined ? [] : [join(override, 'ninja-adventure')]),
    join(PROJECT, '..', 'art-source', 'ninja-adventure'),
  ];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: PROJECT,
      encoding: 'utf8',
    }).trim();
    candidates.push(join(dirname(resolve(PROJECT, common)), 'art-source', 'ninja-adventure'));
  } catch {
    // Not a git checkout: the candidates above are all we can try.
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error(`cannot find the art pack; tried: ${candidates.join(', ')}`);
  return found;
}

const PACK = packPath();

function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${path}`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Same `.meta` shape as `stage-m6-assets.ts` (nearest filtering for pixel art). */
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

interface RawEntry {
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  layout: 'grid';
  directions: string[];
  frames: number;
  fps: number;
  loop: boolean;
  anchor: 'feet';
  footPx: number;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
  version: number;
  sprites: Record<string, RawEntry>;
};

for (const monster of MONSTERS) {
  const targetDir = join(ASSETS, 'resources', 'art', 'monsters', monster.dir);
  const target = join(targetDir, monster.file);
  ensureDirMeta(`art/monsters/${monster.dir}`);
  ensureDir(targetDir);

  if (!existsSync(target)) {
    const source = join(PACK, 'Actor', 'Monster', monster.source);
    if (!existsSync(source)) throw new Error(`missing source asset: ${source}`);
    writeFileSync(target, readFileSync(source));
    console.log(`png  ${monster.dir}/${monster.file}`);
  }
  if (!existsSync(`${target}.meta`)) {
    writeMeta(target, imageMeta(target));
    console.log(`meta ${monster.dir}/${monster.file}.meta`);
  }

  const png = readPng(target);
  if (png.width !== 64 || png.height !== 64) {
    throw new Error(`${monster.dir}/${monster.file} is ${png.width}×${png.height}; expected the 4×4 16px grid`);
  }
  const footPx = bottomPadding(png);
  const entry: RawEntry = {
    sheet: `resources/art/monsters/${monster.dir}/${monster.file}`,
    frameWidth: 16,
    frameHeight: 16,
    layout: 'grid',
    directions: [...DIRS],
    frames: 4,
    fps: 10,
    loop: true,
    anchor: 'feet',
    footPx,
  };

  for (const direction of DIRS) {
    const key = `${monster.actor}.walk.${direction}`;
    if (manifest.sprites[key] === undefined) manifest.sprites[key] = { ...entry };
  }
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`animations.json: walk keys seeded for ${MONSTERS.length} monsters`);
