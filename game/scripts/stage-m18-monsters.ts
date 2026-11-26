/**
 * Stage M18 enemy art (Dasher & Gunner per chapter from unused pack monsters):
 * - Dasher (Ch1–Ch4): owl, reptile, spirit (already staged), beast
 * - Gunner (Ch1–Ch4): lizard, octopus2, skull, dragon
 *
 * Run: `bun run scripts/stage-m18-monsters.ts`
 *
 * - PNGs are copied byte-for-byte into `assets/resources/art/monsters/<dir>/`.
 * - Each base PNG gets a nearest-filter image `.meta` (never rewritten on rerun so UUIDs never churn).
 * - Resolves `art-source/ninja-adventure` across git worktrees via `--git-common-dir`.
 * - Seeds `walk` keys for the 7 newly staged monsters into `animations.json`, ready for
 *   `gen:anim`, `outline:monsters`, and `gen:elites`.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * M18 Dasher (owl, reptile, beast; Ch3 `spirit` is already staged) and Gunner
 * (lizard, octopus2, skull, dragon) — all unused pack 64×64 (4×4 16px) sheets.
 */
const MONSTERS: readonly StagedMonster[] = [
  { actor: 'owl', dir: 'owl', source: 'Owl/Owl.png', file: 'Owl.png' },
  { actor: 'reptile', dir: 'reptile', source: 'Reptile/Reptile.png', file: 'Reptile.png' },
  { actor: 'beast', dir: 'beast', source: 'Beast/Beast.png', file: 'Beast.png' },
  { actor: 'lizard', dir: 'lizard', source: 'Lizard/Lizard.png', file: 'Lizard.png' },
  { actor: 'octopus2', dir: 'octopus2', source: 'Octopus2/SpriteSheet.png', file: 'SpriteSheet.png' },
  { actor: 'skull', dir: 'skull', source: 'Skull/SpriteSheet.png', file: 'SpriteSheet.png' },
  { actor: 'dragon', dir: 'dragon', source: 'Dragon/SpriteSheet.png', file: 'SpriteSheet.png' },
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
    // Not a git checkout: fall back to the candidates above.
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`cannot find the art pack; tried: ${candidates.join(', ')}`);
  }
  return found;
}

const PACK = packPath();

function pngSize(path: string): { width: number; height: number } {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${path}`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Nearest-filtered Cocos image `.meta` (same shape as `stage-m9-monsters.ts`). */
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
  const baseEntry: RawEntry = {
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

  for (const clip of ['idle', 'walk'] as const) {
    const fps = clip === 'idle' ? 4 : 10;
    for (const direction of DIRS) {
      const key = `${monster.actor}.${clip}.${direction}`;
      if (manifest.sprites[key] === undefined) {
        manifest.sprites[key] = { ...baseEntry, fps };
      }
    }
  }
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`animations.json: idle+walk keys seeded for ${MONSTERS.length} M18 monsters`);
