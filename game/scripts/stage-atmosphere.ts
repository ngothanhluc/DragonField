/**
 * Stage the chapter-atmosphere + living-decor art (#6, rebuilt in M11 per ADR-019) from
 * `art-source/ninja-adventure/` and update the manifest entries in `animations.json`.
 *
 * Run: `bun run scripts/stage-atmosphere.ts`
 *
 * - Pack particle strips (`Leaf.png`, `LeafPink.png`, `Rain.png`, `RainOnFloor.png`, `Clouds.png`)
 *   are copied byte-for-byte into `assets/resources/art/atmosphere/` for crisp 1:1 pixel rendering.
 * - `DryLeaf.png` (Ch3 ash/dry leaves) and `Sand.png` (Ch4 wind-driven sand gusts) are derived
 *   directly from pack particle strips using exact `Palette.png` colours (ADR-015).
 * - `campfire.png` (Ch3 smoking campfire living-decor prop) composites the pack's campfire base,
 *   flickering `FX/Particle/Fire.png`, and rising `FX/Smoke/Smoke/SpriteSheet.png` into a 6-frame
 *   vertical `grid` sheet (`directions: []`, `anchor: 'feet'`).
 * - Legacy M8 overlay assets (`fx.raylight`, `fx.fog`, and old `art/fx/{raylight,fog,leaf,ash,sand}`)
 *   are removed cleanly.
 * - Existing `.meta` files keep their UUIDs so re-running the script is idempotent.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

/** Preserve an existing `.meta` verbatim when its dimensions still match (avoids churning editor trim data). */
function writeImageMetaIfNeeded(path: string): void {
  const metaPath = `${path}.meta`;
  if (existsSync(metaPath)) {
    try {
      const { width, height } = pngSize(path);
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        subMetas?: Record<string, { userData?: { rawWidth?: unknown; rawHeight?: unknown } }>;
      };
      const userData = parsed.subMetas?.['f9941']?.userData;
      if (userData?.rawWidth === width && userData?.rawHeight === height) return;
    } catch {
      // Regenerate malformed meta below.
    }
  }
  writeMeta(path, imageMeta(path));
}

function writeStagedPng(targetRel: string, image: PngImage): void {
  const target = join(RES, targetRel);
  ensureDir(dirname(target));
  writeFileSync(target, encodePng(image));
  writeImageMetaIfNeeded(target);
  console.log(`gen  ${targetRel} (${image.width}×${image.height})`);
}

function copyPng(sourceRel: string, targetRel: string): void {
  const source = join(PACK, sourceRel);
  const target = join(RES, targetRel);
  if (!existsSync(source)) throw new Error(`missing source asset: ${source}`);
  ensureDir(dirname(target));
  writeFileSync(target, readFileSync(source));
  writeImageMetaIfNeeded(target);
  console.log(`png  ${targetRel} (${statSync(target).size} B)`);
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
  writeStagedPng(targetRel, { width, height, data });
}

/**
 * Palette-remap `FX/Particle/Leaf.png` (6 frames of 12×7) to dry autumn / ash-brown leaves for Ch3,
 * keeping `#141b1b` (20,27,27) dark pixel outlines and mapping greens to `Palette.png` `#9c6546`
 * (156,101,70) and `#d2b37d` (210,179,125).
 */
function stageDryLeaf(targetRel: string): void {
  const source = readPng(join(PACK, 'FX/Particle/Leaf.png'));
  const data = Buffer.from(source.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (r === 116 && g === 163 && b === 52) {
      data[i] = 156;
      data[i + 1] = 101;
      data[i + 2] = 70;
    } else if (r === 173 && g === 188 && b === 58) {
      data[i] = 210;
      data[i + 1] = 179;
      data[i + 2] = 125;
    }
  }
  writeStagedPng(targetRel, { width: source.width, height: source.height, data });
}

/**
 * Derive crisp 3-frame `8×8` wind-driven desert sand streaks from `FX/Particle/Rain.png`,
 * oriented along the wind (`dx > 0, dy < 0`) and coloured with `Palette.png` desert ochre `#d78b4a`
 * (215,139,74) and umber `#965340` (150,83,64) so grains read crisply against bright sand tiles.
 */
function stageSandStreaks(targetRel: string): void {
  const rain = readPng(join(PACK, 'FX/Particle/Rain.png'));
  const data = Buffer.alloc(24 * 8 * 4);
  for (let frame = 0; frame < 3; frame += 1) {
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const sx = frame * 8 + (7 - y);
        const sy = x;
        const si = (sy * rain.width + sx) * 4;
        if (rain.data[si + 3]! === 0) continue;
        const di = (y * 24 + frame * 8 + x) * 4;
        const head = x >= 4;
        data[di] = head ? 150 : 215;
        data[di + 1] = head ? 83 : 139;
        data[di + 2] = head ? 64 : 74;
        data[di + 3] = 255;
      }
    }
  }
  writeStagedPng(targetRel, { width: 24, height: 8, data });
}

function blitOpaque(
  dst: PngImage,
  dx0: number,
  dy0: number,
  src: PngImage,
  sx0: number,
  sy0: number,
  w: number,
  h: number,
): void {
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dx = dx0 + x;
      const dy = dy0 + y;
      if (dx < 0 || dx >= dst.width || dy < 0 || dy >= dst.height) continue;
      const si = ((sy0 + y) * src.width + (sx0 + x)) * 4;
      if (src.data[si + 3]! === 0) continue;
      const di = (dy * dst.width + dx) * 4;
      src.data.copy(dst.data, di, si, si + 4);
    }
  }
}

/**
 * Build a 6-frame vertical `grid` smoking campfire prop (`32×42` per frame → `32×252`) for Ch3
 * from pack sheets:
 * 1. Rising smoke puff (`FX/Smoke/Smoke/SpriteSheet.png`, 6 frames of 32×32) drifting upward,
 * 2. 16×16 campfire base (`TilesetElement.png` `(112, 64, 16, 16)`) centred on the 1×1 floor tile,
 * 3. Flickering campfire flame (`FX/Particle/Fire.png`, frames 2..7 of 8×12) burning in front.
 */
function stageCampfireProp(targetRel: string): void {
  const element = readPng(join(PACK, 'Backgrounds/Tilesets/TilesetElement.png'));
  const fire = readPng(join(PACK, 'FX/Particle/Fire.png'));
  const smoke = readPng(join(PACK, 'FX/Smoke/Smoke/SpriteSheet.png'));

  const frameWidth = 32;
  const frameHeight = 42;
  const frames = 6;
  const out: PngImage = {
    width: frameWidth,
    height: frameHeight * frames,
    data: Buffer.alloc(frameWidth * frameHeight * frames * 4),
  };

  for (let frame = 0; frame < frames; frame += 1) {
    const yOff = frame * frameHeight;
    // Smoke rises upward by 2 px per frame above the fire, then dissipates cleanly.
    blitOpaque(out, 0, yOff + (10 - frame * 2), smoke, frame * 32, 0, 32, 32);
    // 16×16 hearth/logs centred at the bottom of the frame (`x = 8..24`, `y = 26..42`).
    blitOpaque(out, 8, yOff + 26, element, 112, 64, 16, 16);
    // 8×12 flame drawn in front of the smoke so the fire core stays bright on every frame.
    blitOpaque(out, 12, yOff + 23, fire, (frame + 2) * 8, 0, 8, 12);
  }

  writeStagedPng(targetRel, out);
}

/** Remove obsolete M8 atmosphere folders so dead overlay PNGs/metas do not linger in resources. */
function removeLegacyAtmosphereDirs(): void {
  for (const legacy of ['raylight', 'fog', 'leaf', 'ash', 'sand']) {
    const dir = join(RES, 'art', 'fx', legacy);
    const meta = `${dir}.meta`;
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    if (existsSync(meta)) rmSync(meta, { force: true });
  }
}

// --- Stage pack art --------------------------------------------------------
removeLegacyAtmosphereDirs();

ensureDirMeta('art/atmosphere');
ensureDirMeta('art/characters/animals');
ensureDirMeta('art/decor');

// Crisp 1:1 pack weather particle sheets (copied byte-for-byte where unremapped).
copyPng('FX/Particle/Leaf.png', 'art/atmosphere/Leaf.png');
copyPng('FX/Particle/LeafPink.png', 'art/atmosphere/LeafPink.png');
copyPng('FX/Particle/Clouds.png', 'art/atmosphere/Clouds.png');
copyPng('FX/Particle/Rain.png', 'art/atmosphere/Rain.png');
copyPng('FX/Particle/RainOnFloor.png', 'art/atmosphere/RainOnFloor.png');
stageDryLeaf('art/atmosphere/DryLeaf.png');
stageSandStreaks('art/atmosphere/Sand.png');

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
stageCampfireProp('art/decor/campfire.png');

// --- Manifest entries ------------------------------------------------------
// Every grid below is the real PNG size divided into whole frames (checked by `art-files.test`).
const SPRITES: Record<string, StagedSprite> = {};

const animalEntry = (name: string): StagedSprite => ({
  target: `resources/art/characters/animals/${name}.png`,
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
SPRITES['decor.campfire'] = {
  target: 'resources/art/decor/campfire.png',
  entry: {
    frameWidth: 32,
    frameHeight: 42,
    layout: 'grid',
    directions: [],
    frames: 6,
    fps: 7,
    loop: true,
    anchor: 'feet',
  },
};

SPRITES['fx.leaf'] = {
  target: 'resources/art/atmosphere/Leaf.png',
  // 72×7: six 12×7 tumbling green leaf frames.
  entry: {
    frameWidth: 12,
    frameHeight: 7,
    layout: 'strip',
    directions: [],
    frames: 6,
    fps: 8,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.leaf-pink'] = {
  target: 'resources/art/atmosphere/LeafPink.png',
  // 72×7: six 12×7 cherry-blossom petal frames.
  entry: {
    frameWidth: 12,
    frameHeight: 7,
    layout: 'strip',
    directions: [],
    frames: 6,
    fps: 8,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.cloud-shadow'] = {
  target: 'resources/art/atmosphere/Clouds.png',
  // 80×36: soft cloud silhouette tinted dark on the ground (`under-actors`).
  entry: {
    frameWidth: 80,
    frameHeight: 36,
    layout: 'strip',
    directions: [],
    frames: 1,
    fps: 1,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.rain'] = {
  target: 'resources/art/atmosphere/Rain.png',
  // 24×8: three 8×8 diagonal rain streak frames.
  entry: {
    frameWidth: 8,
    frameHeight: 8,
    layout: 'strip',
    directions: [],
    frames: 3,
    fps: 12,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.rain-splash'] = {
  target: 'resources/art/atmosphere/RainOnFloor.png',
  // 24×8: three 8×8 ground rain-splash ring frames.
  entry: {
    frameWidth: 8,
    frameHeight: 8,
    layout: 'strip',
    directions: [],
    frames: 3,
    fps: 8,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.ash'] = {
  target: 'resources/art/atmosphere/DryLeaf.png',
  // 72×7: six 12×7 palette-remapped dry/charred leaf frames for Ch3.
  entry: {
    frameWidth: 12,
    frameHeight: 7,
    layout: 'strip',
    directions: [],
    frames: 6,
    fps: 7,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.sand'] = {
  target: 'resources/art/atmosphere/Sand.png',
  // 24×8: three 8×8 palette-true wind-driven sand streak frames for Ch4.
  entry: {
    frameWidth: 8,
    frameHeight: 8,
    layout: 'strip',
    directions: [],
    frames: 3,
    fps: 12,
    loop: true,
    anchor: 'center',
  },
};
SPRITES['fx.ripple'] = {
  // Already staged by `stage-water.ts` — only the manifest key is maintained here.
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
// Drop removed M8 full-screen overlay entries (`fx.raylight`, `fx.fog`) per ADR-019.
delete sprites['fx.raylight'];
delete sprites['fx.fog'];

const added: string[] = [];
for (const [key, sprite] of Object.entries(SPRITES)) {
  sprites[key] = withFoot(sprite);
  added.push(key);
}

writeFileSync(MANIFEST, `${JSON.stringify({ version: 1, sprites }, null, 2)}\n`);
console.log(`animations.json: ${added.length} atmosphere/decor key(s): ${added.join(', ')}`);
