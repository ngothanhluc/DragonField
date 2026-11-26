/**
 * Stage M12 XP & level-up assets from `art-source/ninja-adventure/`:
 *
 * 1. Audio (`assets/resources/audio/sfx/`):
 *    - `LevelUp1..3.wav` → `level-up-1..3.mp3` (3 distinct jingle variants for `'level-up'`).
 *    - `Bonus2..3.wav` → `xp-pickup.mp3`, `xp-pickup-2.mp3` (crisp, subtle rising crystal chimes
 *      that cascade cleanly without ear fatigue when vacuuming many orbs rapidly).
 * 2. XP orb sprites (`assets/resources/art/fx/xp-orb/`):
 *    - Upright faceted diamond crystals (`16×16`) derived from `Items/Resource/GemPurple.png`
 *      using exact `Palette.png` ramps (ADR-015) so all 3 tiers (`small`, `medium`, `large`) have
 *      an unmistakable diamond silhouette — never round like enemy bullets (ADR-016) or warm-gold
 *      like coins — with crisp `#141b1b` pixel outlines readable on both Ch1 grass and Ch4 sand.
 * 3. Manifest (`assets/resources/data/animations.json`):
 *    - Registers `fx.xp-orb-small`, `fx.xp-orb-medium`, and `fx.xp-orb-large` (`anchor: "center"`).
 *
 * Idempotent: existing `.meta` files keep their UUIDs across re-runs.
 *
 * Run: `cd game && bun run scripts/stage-m12-assets.ts`
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertAudio, ensureDir, ensureDirMeta, resolvePackDir, writeMeta } from './lib/audio';
import { encodePng, readPng, type PngImage } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const RES = join(PROJECT, 'assets', 'resources');
const MANIFEST = join(RES, 'data', 'animations.json');
const PACK = resolvePackDir();

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

type RgbTuple = readonly [number, number, number];

function pngSize(path: string): { readonly width: number; readonly height: number } {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${path}`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

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

function copyPackPng(sourceRel: string, targetRel: string): void {
  const source = join(PACK, sourceRel);
  const target = join(RES, targetRel);
  if (!existsSync(source)) throw new Error(`missing source asset: ${source}`);
  ensureDir(dirname(target));
  writeFileSync(target, readFileSync(source));
  writeImageMetaIfNeeded(target);
  console.log(`png  ${targetRel} (${statSync(target).size} B)`);
}

function writeRemappedGem(
  sourceRel: string,
  targetRel: string,
  colorMap: ReadonlyMap<string, RgbTuple>,
): void {
  const source = readPng(join(PACK, sourceRel));
  const data = Buffer.from(source.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const hex = `#${data[i]!.toString(16).padStart(2, '0')}${data[i + 1]!.toString(16).padStart(2, '0')}${data[i + 2]!.toString(16).padStart(2, '0')}`;
    const replacement = colorMap.get(hex);
    if (replacement !== undefined) {
      data[i] = replacement[0];
      data[i + 1] = replacement[1];
      data[i + 2] = replacement[2];
    }
  }
  const out: PngImage = { width: source.width, height: source.height, data };
  const target = join(RES, targetRel);
  ensureDir(dirname(target));
  writeFileSync(target, encodePng(out));
  writeImageMetaIfNeeded(target);
  console.log(`gen  ${targetRel} (${out.width}×${out.height})`);
}

// --- 1. Stage M12 audio ----------------------------------------------------
ensureDirMeta('audio/sfx');

// Three distinct LevelUp jingle variants (`LevelUp1..3.wav`), each with its own unique meta UUID.
convertAudio('Audio/Jingles/LevelUp1.wav', 'audio/sfx/level-up-1.mp3', '80k', 1);
convertAudio('Audio/Jingles/LevelUp2.wav', 'audio/sfx/level-up-2.mp3', '80k', 1);
convertAudio('Audio/Jingles/LevelUp3.wav', 'audio/sfx/level-up-3.mp3', '80k', 1);

// Crisp, subtle rising crystal chimes (`Bonus2..3.wav`) for rapid XP orb collection.
convertAudio('Audio/Sounds/Bonus/Bonus2.wav', 'audio/sfx/xp-pickup.mp3', '80k', 1);
convertAudio('Audio/Sounds/Bonus/Bonus3.wav', 'audio/sfx/xp-pickup-2.mp3', '80k', 1);

// --- 2. Stage M12 XP diamond crystal sprites -------------------------------
ensureDirMeta('art/fx');
ensureDirMeta('art/fx/xp-orb');

// Small tier: Spirit Cyan diamond (`Palette.png` #8feff1 / #71ddee / #2d697b, keeping #141b1b + #f2eaf1).
writeRemappedGem(
  'Items/Resource/GemPurple.png',
  'art/fx/xp-orb/xp-orb-small.png',
  new Map<string, RgbTuple>([
    ['#d3a2c0', [143, 239, 241]], // #8feff1
    ['#a5608b', [113, 221, 238]], // #71ddee
    ['#8f3e56', [45, 105, 123]], // #2d697b
  ]),
);

// Medium tier: byte-for-byte pack `GemPurple.png` (Royal Amethyst upright diamond).
copyPackPng('Items/Resource/GemPurple.png', 'art/fx/xp-orb/xp-orb-medium.png');

// Large tier: Crimson-Rose Yokai crystal (`Palette.png` #ffffff / #ef9597 / #e0394c / #8f3e56).
writeRemappedGem(
  'Items/Resource/GemPurple.png',
  'art/fx/xp-orb/xp-orb-large.png',
  new Map<string, RgbTuple>([
    ['#f2eaf1', [255, 255, 255]], // #ffffff pure gleam
    ['#d3a2c0', [239, 149, 151]], // #ef9597
    ['#a5608b', [224, 57, 76]], // #e0394c
    ['#8f3e56', [143, 62, 86]], // #8f3e56
  ]),
);

// --- 3. Register manifest keys in `animations.json` ------------------------
const parsed: unknown = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (typeof parsed !== 'object' || parsed === null) throw new Error('manifest must be an object');
const record = parsed as { version?: unknown; sprites?: unknown };
if (record.version !== 1) throw new Error('manifest version must be 1');
if (typeof record.sprites !== 'object' || record.sprites === null) {
  throw new Error('manifest.sprites must be an object');
}

const sprites = record.sprites as Record<string, ManifestEntry>;
const XP_ORB_ENTRIES: Readonly<Record<string, string>> = {
  'fx.xp-orb-small': 'resources/art/fx/xp-orb/xp-orb-small.png',
  'fx.xp-orb-medium': 'resources/art/fx/xp-orb/xp-orb-medium.png',
  'fx.xp-orb-large': 'resources/art/fx/xp-orb/xp-orb-large.png',
};

for (const [key, sheet] of Object.entries(XP_ORB_ENTRIES)) {
  sprites[key] = {
    sheet,
    frameWidth: 16,
    frameHeight: 16,
    layout: 'strip',
    directions: [],
    frames: 1,
    fps: 1,
    loop: true,
    anchor: 'center',
    footPx: 8,
  };
}

writeFileSync(MANIFEST, `${JSON.stringify({ version: 1, sprites }, null, 2)}\n`);
console.log(`animations.json: staged ${Object.keys(XP_ORB_ENTRIES).join(', ')}`);
