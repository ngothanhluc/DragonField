/**
 * Stage the chapter-atmosphere + living-decor art (#6) from `art-source/ninja-adventure/`
 * and add the manifest entries that point at it.
 *
 * Run: `bun run scripts/stage-atmosphere.ts`
 *
 * - PNGs are copied byte-for-byte (no re-encoding pixel art), except `fx.leaf`: the pack ships
 *   leaves as a loose scatter on one strip, so a single complete 8×7 leaf is cropped out.
 * - `footPx` is read from the staged PNG (`bottomPadding`): the same number `gen-animations.ts`
 *   would compute, so running either script last leaves an identical `animations.json`.
 * - The manifest is merged, not regenerated: every other key keeps its order and values.
 * - Existing `.meta` files keep their uuid; re-running the script changes nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { bottomPadding, encodePng, readPng, type PngImage } from './lib/png';
import { ensureDir, ensureDirMeta, writeMeta } from './lib/audio';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const RES = join(PROJECT, 'assets', 'resources');
const MANIFEST = join(RES, 'data', 'animations.json');

/** The pack is gitignored and lives in the main checkout; a worktree finds it via the git common dir. */
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

interface ManifestEntry {
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  layout: 'grid' | 'strip';
  directions: string[];
  frames: number;
  fps: number;
  loop: boolean;
  anchor: 'feet' | 'center';
  footPx: number;
}

interface StagedSprite {
  /** Target path relative to `assets/`. */
  readonly target: string;
  readonly entry: Omit<ManifestEntry, 'sheet' | 'footPx'>;
}

function pngSize(path: string): { readonly width: number; readonly height: number } {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${path}`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function imageMeta(path: string): object {
  const uuid = existingImageUuid(path) ?? randomUUID();
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

/** Re-use the uuid of an existing `.meta` so a re-run never breaks editor references. */
function existingImageUuid(path: string): string | null {
  const meta = `${path}.meta`;
  if (!existsSync(meta)) return null;
  try {
    const parsed = JSON.parse(readFileSync(meta, 'utf8')) as { uuid?: unknown };
    return typeof parsed.uuid === 'string' ? parsed.uuid : null;
  } catch {
    return null;
  }
}

function copyPng(sourceRel: string, targetRel: string): void {
  const source = join(PACK, sourceRel);
  const target = join(RES, targetRel);
  if (!existsSync(source)) throw new Error(`missing source asset: ${source}`);
  ensureDir(dirname(target));
  writeFileSync(target, readFileSync(source));
  writeMeta(target, imageMeta(target));
  console.log(`png  ${targetRel} (${statSync(target).size} B)`);
}

/** Crop a rect out of a pack sheet (pixel art only; the result is re-encoded losslessly). */
function cropPng(
  sourceRel: string,
  targetRel: string,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): void {
  const source = readPng(join(PACK, sourceRel));
  const data = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const from = ((rect.y + y) * source.width + rect.x + x) * 4;
      const to = (y * rect.width + x) * 4;
      source.data.copy(data, to, from, from + 4);
    }
  }
  const cropped: PngImage = { width: rect.width, height: rect.height, data };
  const target = join(RES, targetRel);
  ensureDir(dirname(target));
  writeFileSync(target, encodePng(cropped));
  writeMeta(target, imageMeta(target));
  console.log(`crop ${targetRel} (${rect.width}×${rect.height})`);
}

/**
 * Re-pack a horizontal strip (`frames` × frameWidth wide) as a vertical sheet.
 *
 * `core/art/manifest.ts` reads a single-column sheet as `layout: "grid"` with `directions: []`
 * (column = direction, row = frame — the same shape as `player.dead`). Actors/props use grid,
 * so the staged sheet must be vertical; FX may stay a horizontal strip.
 */
function stackFrames(
  sourceRel: string,
  targetRel: string,
  frameWidth: number,
  frameHeight: number,
  frames: number,
): void {
  const source = readPng(join(PACK, sourceRel));
  const width = frameWidth;
  const height = frameHeight * frames;
  const data = Buffer.alloc(width * height * 4);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const from = (y * source.width + frame * frameWidth + x) * 4;
        const to = ((frame * frameHeight + y) * width + x) * 4;
        source.data.copy(data, to, from, from + 4);
      }
    }
  }
  const stacked: PngImage = { width, height, data };
  const target = join(RES, targetRel);
  ensureDir(dirname(target));
  writeFileSync(target, encodePng(stacked));
  writeMeta(target, imageMeta(target));
  console.log(`grid ${targetRel} (${width}×${height}, ${frames} frame(s))`);
}

// --- Copy the pack art ------------------------------------------------------
ensureDirMeta('art/fx/raylight');
ensureDirMeta('art/fx/fog');
ensureDirMeta('art/fx/leaf');
ensureDirMeta('art/fx/ash');
ensureDirMeta('art/fx/sand');
ensureDirMeta('art/characters/animals');
ensureDirMeta('art/decor');

copyPng('FX/Environment/Raylight.png', 'art/fx/raylight/Raylight.png');
copyPng('FX/Environment/Fog.png', 'art/fx/fog/Fog.png');
// The pack's leaf sheet is a loose scatter (72×7, not on a grid): crop one complete 8×7 leaf.
cropPng('FX/Particle/Leaf.png', 'art/fx/leaf/Leaf.png', { x: 2, y: 0, width: 8, height: 7 });
// Ash flakes (8×8 each, 7 frames) — tinted grey in the adapter; sand streaks (8×8, 3 frames).
copyPng('FX/Particle/Snow.png', 'art/fx/ash/Snow.png');
copyPng('FX/Particle/Rain.png', 'art/fx/sand/Rain.png');

const ANIMALS: ReadonlyArray<readonly [string, string]> = [
  ['Frog', 'frog'],
  ['Chicken/SpriteSheetCute.png', 'chicken'],
  ['Cat', 'cat'],
  ['Racoon', 'racoon'],
  ['Dog', 'dog'],
];
for (const [source, name] of ANIMALS) {
  const file = source.endsWith('.png') ? source : `${source}/SpriteSheet.png`;
  // Pack animal sheets are a horizontal 2-frame 16×16 strip → staged as a 16×32 grid sheet.
  stackFrames(`Actor/Animal/${file}`, `art/characters/animals/${name}.png`, 16, 16, 2);
}

const FLAGS: ReadonlyArray<readonly [string, string]> = [
  ['FlagGreen16x16.png', 'flag-green'],
  ['FlagBlue16x16.png', 'flag-blue'],
  ['FlagRed16x16.png', 'flag-red'],
  ['FlagBlack16x16.png', 'flag-black'],
];
for (const [source, name] of FLAGS) {
  // 64×16 horizontal strip → 16×64 vertical sheet (4 frames).
  stackFrames(`Backgrounds/Animated/Flag/${source}`, `art/decor/${name}.png`, 16, 16, 4);
}
stackFrames(
  'Backgrounds/Animated/Flower/SpriteSheet16x16.png',
  'art/decor/flower.png',
  10,
  8,
  2,
);
stackFrames('Backgrounds/Animated/Plant/SpriteSheet16x16.png', 'art/decor/plant.png', 16, 16, 4);

// --- Manifest entries ------------------------------------------------------
// Every grid below is the real PNG size divided into whole frames (checked by `art-files.test`).
const SPRITES: Record<string, StagedSprite> = {};

const animalEntry = (name: string): StagedSprite => ({
  target: `resources/art/characters/animals/${name}.png`,
  // Staged as a 16×32 single-column grid (2 frames of 16×16) — the shape `manifest.ts` calls `grid`.
  entry: {
    frameWidth: 16,
    frameHeight: 16,
    layout: 'grid',
    directions: [],
    frames: 2,
    fps: 6,
    loop: true,
    anchor: 'feet',
  },
});
for (const [, name] of ANIMALS) {
  SPRITES[`animal.${name}`] = animalEntry(name);
}

SPRITES['decor.flower'] = {
  target: 'resources/art/decor/flower.png',
  // Flower sheet is 20×8: two 10×8 frames (the pack names it 16x16 but the pixels are 10 wide),
  // staged as a 10×16 vertical grid.
  entry: {
    frameWidth: 10,
    frameHeight: 8,
    layout: 'grid',
    directions: [],
    frames: 2,
    fps: 3,
    loop: true,
    anchor: 'feet',
  },
};
for (const name of ['plant', 'flag-green', 'flag-blue', 'flag-red', 'flag-black']) {
  SPRITES[`decor.${name}`] = {
    target: `resources/art/decor/${name}.png`,
    // 4 frames of 16×16, staged as a 16×64 vertical grid.
    entry: {
      frameWidth: 16,
      frameHeight: 16,
      layout: 'grid',
      directions: [],
      frames: 4,
      fps: name.startsWith('flag') ? 8 : 4,
      loop: true,
      anchor: 'feet',
    },
  };
}

SPRITES['fx.raylight'] = {
  target: 'resources/art/fx/raylight/Raylight.png',
  // One 216×102 light-shaft image (a still, slowly pulsed by the adapter).
  entry: {
    frameWidth: 216,
    frameHeight: 102,
    layout: 'strip',
    directions: [],
    frames: 1,
    fps: 1,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.fog'] = {
  target: 'resources/art/fx/fog/Fog.png',
  // One 320×180 fog image, drifted/scaled by the adapter.
  entry: {
    frameWidth: 320,
    frameHeight: 180,
    layout: 'strip',
    directions: [],
    frames: 1,
    fps: 1,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.leaf'] = {
  target: 'resources/art/fx/leaf/Leaf.png',
  // One cropped 8×7 leaf (see `cropPng` above).
  entry: {
    frameWidth: 8,
    frameHeight: 7,
    layout: 'strip',
    directions: [],
    frames: 1,
    fps: 1,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.ash'] = {
  target: 'resources/art/fx/ash/Snow.png',
  // 56×8: seven 8×8 flake frames, tinted grey by the adapter.
  entry: {
    frameWidth: 8,
    frameHeight: 8,
    layout: 'strip',
    directions: [],
    frames: 7,
    fps: 6,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.sand'] = {
  target: 'resources/art/fx/sand/Rain.png',
  // 24×8: three 8×8 streak frames, tinted sand by the adapter.
  entry: {
    frameWidth: 8,
    frameHeight: 8,
    layout: 'strip',
    directions: [],
    frames: 3,
    fps: 10,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.ripple'] = {
  // Already staged by `stage-water.ts` — only the manifest key is new.
  target: 'resources/art/fx/water/ripple.png',
  entry: {
    frameWidth: 16,
    frameHeight: 16,
    layout: 'strip',
    directions: [],
    frames: 4,
    fps: 8,
    loop: true,
    anchor: 'center',
  },
};

function withFoot(entry: StagedSprite): ManifestEntry {
  const path = join(PROJECT, 'assets', entry.target);
  const footPx =
    entry.entry.anchor === 'center'
      ? Math.floor(entry.entry.frameHeight / 2)
      : bottomPadding(readPng(path));
  return { sheet: entry.target, ...entry.entry, footPx };
}

const parsed: unknown = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (typeof parsed !== 'object' || parsed === null) throw new Error('manifest must be an object');
const record = parsed as { version?: unknown; sprites?: unknown };
if (record.version !== 1) throw new Error('manifest version must be 1');
if (typeof record.sprites !== 'object' || record.sprites === null) {
  throw new Error('manifest.sprites must be an object');
}

const sprites = record.sprites as Record<string, ManifestEntry>;
const added: string[] = [];
for (const [key, sprite] of Object.entries(SPRITES)) {
  sprites[key] = withFoot(sprite);
  added.push(key);
}

writeFileSync(MANIFEST, `${JSON.stringify({ version: 1, sprites }, null, 2)}\n`);
console.log(`animations.json: ${added.length} atmosphere/decor key(s): ${added.join(', ')}`);
