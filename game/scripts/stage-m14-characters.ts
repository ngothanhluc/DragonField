/**
 * Stage M14 playable character animations, weapon attachments, and pointed class projectiles.
 *
 * Run: `cd game && bun run scripts/stage-m14-characters.ts`
 *
 * - Resolves `art-source/ninja-adventure` across git worktrees via `git rev-parse --git-common-dir`.
 * - Stages `archer` (from `Hunter`) and `mage` (from `SorcererBlack`) full 6-clip sets
 *   (`Idle`, `Walk`, `Attack`, `Hit`, `Dash`, `Dead`) under `assets/resources/art/characters/`.
 * - Leaves `generated/cultivator/idle.png` and `generated/attachment/sword-back.png` untouched;
 *   programmatically authors `cultivator/{walk,attack,hit,dash,dead}.png`,
 *   `attachment/{bow-hand,staff-hand}.png`, `fx/arcane-bolt/ArcaneBolt.png`, and
 *   `fx/spirit-sword/SpiritSword.png` using strictly binary alpha and exact `Palette.png` colors.
 * - Stages `fx/arrow/Arrow.png` byte-for-byte from `Items/Weapons/Bow/Arrow.png`.
 * - Updates `animations.json` and `attachments.json` (with measured `footPx` and `frameBob`).
 * - Idempotent: preserves existing `.meta` UUIDs across re-runs.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateAttachments,
  type AttachmentItem,
  type AttachmentsData,
  type CharacterRig,
} from '../assets/scripts/core/art/attachments';
import { validateManifest, type Direction } from '../assets/scripts/core/art/manifest';
import { ensureDir, ensureDirMeta, resolvePackDir, writeMeta } from './lib/audio';
import { frameBob, spriteFrameMeta } from './lib/gemini-art';
import { bottomPadding, readPng, writePng, type PngImage } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const RES = join(PROJECT, 'assets', 'resources');
const ART = join(RES, 'art');
const MANIFEST_PATH = join(RES, 'data', 'animations.json');
const ATTACHMENTS_PATH = join(RES, 'data', 'attachments.json');
const PACK = resolvePackDir();

const DIRS: readonly Direction[] = ['down', 'up', 'left', 'right'];
const OUTLINE = '#141b1b';

interface ManifestEntry {
  sheet: string;
  frameWidth: number;
  frameHeight: number;
  layout: 'grid' | 'strip';
  directions: Direction[];
  frames: number;
  fps: number;
  loop: boolean;
  anchor: 'feet' | 'center';
  footPx: number;
}

type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

// ---------------------------------------------------------------------------
// Image & pixel helpers
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): Rgb {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function loadPaletteHexSet(): ReadonlySet<string> {
  const pal = readPng(join(PACK, 'Palette.png'));
  const set = new Set<string>();
  for (let i = 0; i < pal.data.length; i += 4) {
    if (pal.data[i + 3]! > 0) {
      set.add(rgbToHex(pal.data[i]!, pal.data[i + 1]!, pal.data[i + 2]!));
    }
  }
  return set;
}

function createCanvas(width: number, height: number): PngImage {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function getPixel(img: PngImage, x: number, y: number): Rgba {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [0, 0, 0, 0];
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
}

function setPixel(img: PngImage, x: number, y: number, rgba: Rgba): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = rgba[0];
  img.data[i + 1] = rgba[1];
  img.data[i + 2] = rgba[2];
  img.data[i + 3] = rgba[3];
}

function setHexPixel(img: PngImage, x: number, y: number, hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  setPixel(img, x, y, [r, g, b, 255]);
}

function cropCell(img: PngImage, col: number, row: number, w = 16, h = 16): PngImage {
  const out = createCanvas(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      setPixel(out, x, y, getPixel(img, col * w + x, row * h + y));
    }
  }
  return out;
}

function blitCell(dst: PngImage, src: PngImage, col: number, row: number, dx = 0, dy = 0): void {
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const px = getPixel(src, x, y);
      if (px[3] > 0) setPixel(dst, col * src.width + x + dx, row * src.height + y + dy, px);
    }
  }
}

function mirrorH(src: PngImage): PngImage {
  const out = createCanvas(src.width, src.height);
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      setPixel(out, src.width - 1 - x, y, getPixel(src, x, y));
    }
  }
  return out;
}

function rotate90CW(src: PngImage): PngImage {
  const out = createCanvas(src.height, src.width);
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      setPixel(out, src.height - 1 - y, x, getPixel(src, x, y));
    }
  }
  return out;
}

function rotate90CCW(src: PngImage): PngImage {
  const out = createCanvas(src.height, src.width);
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      setPixel(out, y, src.width - 1 - x, getPixel(src, x, y));
    }
  }
  return out;
}

function rotate180(src: PngImage): PngImage {
  const out = createCanvas(src.width, src.height);
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      setPixel(out, src.width - 1 - x, src.height - 1 - y, getPixel(src, x, y));
    }
  }
  return out;
}

/** Shift pixels in [yStart..yEnd] by (dx, dy) inside a 16×16 cell, keeping pixels outside fixed. */
function shiftBand(
  cell: PngImage,
  yStart: number,
  yEnd: number,
  dx: number,
  dy: number,
  keepBelow?: number,
): PngImage {
  const out = createCanvas(cell.width, cell.height);
  for (let y = 0; y < cell.height; y += 1) {
    for (let x = 0; x < cell.width; x += 1) {
      if (keepBelow !== undefined && y >= keepBelow) {
        setPixel(out, x, y, getPixel(cell, x, y));
      } else if (y >= yStart && y <= yEnd) {
        const px = getPixel(cell, x, y);
        if (px[3] > 0) setPixel(out, x + dx, y + dy, px);
      } else if (keepBelow === undefined) {
        setPixel(out, x, y, getPixel(cell, x, y));
      }
    }
  }
  return out;
}

function drawPattern(
  rows: readonly string[],
  colors: Readonly<Record<string, string>>,
  width = 16,
  height = 16,
  offsetX = 0,
  offsetY = 0,
): PngImage {
  const out = createCanvas(width, height);
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x += 1) {
      const ch = row[x]!;
      if (ch === '.') continue;
      const hex = colors[ch];
      if (hex === undefined) throw new Error(`unknown pattern char "${ch}"`);
      setHexPixel(out, offsetX + x, offsetY + y, hex);
    }
  }
  return out;
}

function assertPaletteAndBinaryAlpha(
  img: PngImage,
  label: string,
  palette: ReadonlySet<string>,
): void {
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const [r, g, b, a] = getPixel(img, x, y);
      if (a === 0) continue;
      if (a !== 255) {
        throw new Error(`${label}: non-binary alpha ${a} at (${x},${y})`);
      }
      const hex = rgbToHex(r, g, b);
      if (!palette.has(hex)) {
        throw new Error(`${label}: color ${hex} at (${x},${y}) is not in Palette.png`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Meta & disk helpers (idempotent UUIDs + nearest filter)
// ---------------------------------------------------------------------------

function existingUuid(path: string): string | null {
  const meta = `${path}.meta`;
  if (!existsSync(meta)) return null;
  try {
    const parsed = JSON.parse(readFileSync(meta, 'utf8')) as { uuid?: unknown };
    return typeof parsed.uuid === 'string' ? parsed.uuid : null;
  } catch {
    return null;
  }
}

function writeNearestImage(
  relUnderResArt: string,
  image: PngImage,
  opts?: { readonly paletteCheck?: ReadonlySet<string> },
): string {
  if (opts?.paletteCheck !== undefined) {
    assertPaletteAndBinaryAlpha(image, relUnderResArt, opts.paletteCheck);
  }
  const fullPath = join(ART, relUnderResArt);
  const relParts = join('art', relUnderResArt).split('/');
  for (let i = 1; i < relParts.length; i += 1) {
    ensureDirMeta(relParts.slice(0, i).join('/'));
  }
  ensureDir(dirname(fullPath));
  writePng(fullPath, image);
  const name = relUnderResArt.split('/').pop()?.replace(/\.png$/, '') ?? 'image';
  const uuid = existingUuid(fullPath) ?? randomUUID();
  writeMeta(fullPath, spriteFrameMeta(uuid, name, image.width, image.height));
  console.log(`art  ${relUnderResArt} (${image.width}×${image.height})`);
  return `resources/art/${relUnderResArt}`;
}

function copyPackBytes(packRel: string, relUnderResArt: string): string {
  const src = join(PACK, packRel);
  if (!existsSync(src)) throw new Error(`missing pack asset: ${src}`);
  const bytes = readFileSync(src);
  const fullPath = join(ART, relUnderResArt);
  const relParts = join('art', relUnderResArt).split('/');
  for (let i = 1; i < relParts.length; i += 1) {
    ensureDirMeta(relParts.slice(0, i).join('/'));
  }
  ensureDir(dirname(fullPath));
  writeFileSync(fullPath, bytes);
  const png = readPng(fullPath);
  const name = relUnderResArt.split('/').pop()?.replace(/\.png$/, '') ?? 'image';
  const uuid = existingUuid(fullPath) ?? randomUUID();
  writeMeta(fullPath, spriteFrameMeta(uuid, name, png.width, png.height));
  console.log(`copy ${relUnderResArt} (${png.width}×${png.height})`);
  return `resources/art/${relUnderResArt}`;
}

// ---------------------------------------------------------------------------
// 1. Pack character staging (Archer from Hunter, Mage from SorcererBlack)
// ---------------------------------------------------------------------------

interface PackCharSpec {
  readonly actor: 'archer' | 'mage';
  readonly packFolder: 'Hunter' | 'SorcererBlack';
  readonly points: CharacterRig['points'];
}

function buildIdleSheetFromPack(idleRow: PngImage): PngImage {
  const out = createCanvas(64, 64);
  for (let col = 0; col < 4; col += 1) {
    const base = cropCell(idleRow, col, 0, 16, 16);
    const breath = shiftBand(base, 0, 12, 0, 1, 13);
    blitCell(out, base, col, 0);
    blitCell(out, base, col, 1);
    blitCell(out, breath, col, 2);
    blitCell(out, base, col, 3);
  }
  return out;
}

function buildAttackSheetFromPack(idleRow: PngImage, attackRow: PngImage): PngImage {
  const out = createCanvas(64, 48);
  for (let col = 0; col < 4; col += 1) {
    const idleCell = cropCell(idleRow, col, 0, 16, 16);
    const atkCell = cropCell(attackRow, col, 0, 16, 16);
    const follow = shiftBand(atkCell, 0, 11, 0, 1, 12);
    blitCell(out, atkCell, col, 0);
    blitCell(out, follow, col, 1);
    blitCell(out, idleCell, col, 2);
  }
  return out;
}

function buildHitSheetFromPack(idleRow: PngImage, sp1Cell: PngImage): PngImage {
  const out = createCanvas(64, 32);
  const recoilDx = [0, 0, 1, -1] as const;
  for (let col = 0; col < 4; col += 1) {
    const idleCell = cropCell(idleRow, col, 0, 16, 16);
    const recoil = col === 0 ? sp1Cell : shiftBand(idleCell, 0, 11, recoilDx[col]!, 1, 12);
    const settle = shiftBand(idleCell, 0, 12, 0, 1, 13);
    blitCell(out, recoil, col, 0);
    blitCell(out, settle, col, 1);
  }
  return out;
}

function buildDashSheetFromPack(walkSheet: PngImage, jumpRow: PngImage): PngImage {
  const out = createCanvas(64, 48);
  for (let col = 0; col < 4; col += 1) {
    const launch = cropCell(walkSheet, col, 1, 16, 16);
    const jump = cropCell(jumpRow, col, 0, 16, 16);
    const glide = shiftBand(jump, 0, 12, 0, 1, 13);
    blitCell(out, launch, col, 0);
    blitCell(out, jump, col, 1);
    blitCell(out, glide, col, 2);
  }
  return out;
}

function registerDirectionalClips(
  sprites: Record<string, ManifestEntry>,
  actor: string,
  anim: string,
  sheetRel: string,
  frames: number,
  fps: number,
  loop: boolean,
): Record<string, readonly number[]> {
  const png = readPng(join(PROJECT, 'assets', sheetRel));
  const footPx = bottomPadding(png);
  const entry: ManifestEntry = {
    sheet: sheetRel,
    frameWidth: 16,
    frameHeight: 16,
    layout: 'grid',
    directions: Array.from(DIRS),
    frames,
    fps,
    loop,
    anchor: 'feet',
    footPx,
  };
  for (const dir of DIRS) {
    sprites[`${actor}.${anim}.${dir}`] = { ...entry };
  }
  const bobs = frameBob(png, 4, frames, 16, 16);
  return Object.fromEntries(DIRS.map((dir, i) => [dir, bobs[i]!]));
}

function registerDeadClip(
  sprites: Record<string, ManifestEntry>,
  actor: string,
  sheetRel: string,
): void {
  const png = readPng(join(PROJECT, 'assets', sheetRel));
  sprites[`${actor}.dead`] = {
    sheet: sheetRel,
    frameWidth: 16,
    frameHeight: 16,
    layout: 'grid',
    directions: [],
    frames: 1,
    fps: 4,
    loop: false,
    anchor: 'feet',
    footPx: bottomPadding(png),
  };
}

function stagePackCharacter(
  spec: PackCharSpec,
  sprites: Record<string, ManifestEntry>,
): CharacterRig {
  const base = join('Actor', 'Character', spec.packFolder, 'SeparateAnim');
  const idleRow = readPng(join(PACK, base, 'Idle.png'));
  const walkSheet = readPng(join(PACK, base, 'Walk.png'));
  const attackRow = readPng(join(PACK, base, 'Attack.png'));
  const jumpRow = readPng(join(PACK, base, 'Jump.png'));
  const sp1Cell = readPng(join(PACK, base, 'Special1.png'));

  const dir = `characters/${spec.actor}`;
  const idleRel = writeNearestImage(`${dir}/Idle.png`, buildIdleSheetFromPack(idleRow));
  const walkRel = copyPackBytes(join(base, 'Walk.png'), `${dir}/Walk.png`);
  const attackRel = writeNearestImage(
    `${dir}/Attack.png`,
    buildAttackSheetFromPack(idleRow, attackRow),
  );
  const hitRel = writeNearestImage(`${dir}/Hit.png`, buildHitSheetFromPack(idleRow, sp1Cell));
  const dashRel = writeNearestImage(`${dir}/Dash.png`, buildDashSheetFromPack(walkSheet, jumpRow));
  const deadRel = copyPackBytes(join(base, 'Dead.png'), `${dir}/Dead.png`);

  const bob = {
    idle: registerDirectionalClips(sprites, spec.actor, 'idle', idleRel, 4, 6, true),
    walk: registerDirectionalClips(sprites, spec.actor, 'walk', walkRel, 4, 10, true),
    attack: registerDirectionalClips(sprites, spec.actor, 'attack', attackRel, 3, 15, false),
    hit: registerDirectionalClips(sprites, spec.actor, 'hit', hitRel, 2, 12, false),
    dash: registerDirectionalClips(sprites, spec.actor, 'dash', dashRel, 3, 16, false),
  };
  registerDeadClip(sprites, spec.actor, deadRel);

  return {
    frameWidth: 16,
    frameHeight: 16,
    points: spec.points,
    bob,
  };
}

// ---------------------------------------------------------------------------
// 2. Cultivator missing clips (`walk`, `attack`, `hit`, `dash`, `dead`)
// ---------------------------------------------------------------------------

/** Paint a 1px shoe/foot pixel if currently empty, using cultivator's shoe/outline palette. */
function paintFoot(cell: PngImage, x: number, y: number, hex: string): void {
  setHexPixel(cell, x, y, hex);
}

function buildCultivatorWalk(idleSheet: PngImage): PngImage {
  const out = createCanvas(64, 64);
  for (let col = 0; col < 4; col += 1) {
    const base = cropCell(idleSheet, col, 0, 16, 16);
    // Stride A & B: bob upper body (y=0..12) by 1px and animate feet + hem cleanly at y=13..15.
    const buildStride = (phase: 1 | 3): PngImage => {
      const cell = shiftBand(base, 0, 12, 0, 1, 13);
      // Clear row 14..15 legs to re-draw crisp asymmetrical stride feet.
      for (let y = 14; y < 16; y += 1) {
        for (let x = 4; x < 12; x += 1) {
          setPixel(cell, x, y, [0, 0, 0, 0]);
        }
      }
      if (col === 0 || col === 1) {
        // Down / Up: alternate left & right leg planted on y=15 vs lifted to y=14.
        const leftPlanted = phase === 1;
        // Hem row 14
        for (let x = 5; x <= 10; x += 1) {
          setHexPixel(cell, x, 14, x === 5 || x === 10 ? OUTLINE : x === 7 || x === 8 ? '#b8dce5' : '#f2eaf1');
        }
        if (leftPlanted) {
          paintFoot(cell, 6, 15, OUTLINE);
          paintFoot(cell, 7, 15, '#695953');
          paintFoot(cell, 9, 14, '#695953');
          paintFoot(cell, 10, 14, OUTLINE);
          // Arm swing
          setHexPixel(cell, 4, 14, col === 0 ? '#f2ad7d' : '#f2eaf1');
          setHexPixel(cell, 11, 12, col === 0 ? '#ffcba9' : '#f2eaf1');
        } else {
          paintFoot(cell, 6, 14, OUTLINE);
          paintFoot(cell, 7, 14, '#695953');
          paintFoot(cell, 9, 15, '#695953');
          paintFoot(cell, 10, 15, OUTLINE);
          setHexPixel(cell, 4, 12, col === 0 ? '#ffcba9' : '#f2eaf1');
          setHexPixel(cell, 11, 14, col === 0 ? '#f2ad7d' : '#f2eaf1');
        }
      } else {
        // Left (col 2) / Right (col 3): stride split front/back on y=15.
        const isLeft = col === 2;
        for (let x = 5; x <= 10; x += 1) {
          setHexPixel(cell, x, 14, x === 5 || x === 10 ? OUTLINE : '#f2eaf1');
        }
        if (phase === 1) {
          // Wide stride: front foot forward, back foot trailing.
          paintFoot(cell, isLeft ? 5 : 9, 15, OUTLINE);
          paintFoot(cell, isLeft ? 6 : 10, 15, '#695953');
          paintFoot(cell, isLeft ? 9 : 5, 15, OUTLINE);
          paintFoot(cell, isLeft ? 10 : 6, 15, '#695953');
          // Front hand reach
          setHexPixel(cell, isLeft ? 4 : 11, 13, '#ffcba9');
        } else {
          // Passing compact stride.
          paintFoot(cell, isLeft ? 6 : 8, 15, OUTLINE);
          paintFoot(cell, isLeft ? 7 : 9, 15, '#695953');
          paintFoot(cell, isLeft ? 8 : 6, 14, '#695953');
          setHexPixel(cell, isLeft ? 7 : 8, 13, '#f2ad7d');
        }
      }
      return cell;
    };

    blitCell(out, base, col, 0);
    blitCell(out, buildStride(1), col, 1);
    blitCell(out, base, col, 2);
    blitCell(out, buildStride(3), col, 3);
  }
  return out;
}

function buildCultivatorAttack(idleSheet: PngImage): PngImage {
  const out = createCanvas(64, 48);
  for (let col = 0; col < 4; col += 1) {
    const base = cropCell(idleSheet, col, 0, 16, 16);
    const makeLunge = (sparkHex: string, coreHex: string): PngImage => {
      if (col === 0) {
        // Down: crouched sword-hand palm-cast lunge forward-right with spirit chi spark.
        const cell = shiftBand(base, 0, 12, 0, 1, 13);
        setHexPixel(cell, 11, 13, '#ffcba9');
        setHexPixel(cell, 12, 13, coreHex);
        setHexPixel(cell, 12, 14, sparkHex);
        setHexPixel(cell, 13, 13, sparkHex);
        return cell;
      }
      if (col === 1) {
        // Up: sword-hand raised beside right shoulder with spirit chi spark.
        const cell = shiftBand(base, 0, 12, 0, 1, 13);
        setHexPixel(cell, 11, 10, '#ffcba9');
        setHexPixel(cell, 12, 9, coreHex);
        setHexPixel(cell, 12, 8, sparkHex);
        setHexPixel(cell, 13, 9, sparkHex);
        return cell;
      }
      // Left (2) / Right (3): forward lunge 1px toward facing with extended palm-cast.
      const isLeft = col === 2;
      const dx = isLeft ? -1 : 1;
      const cell = shiftBand(base, 0, 13, dx, 1, 14);
      const palmX = isLeft ? 3 : 12;
      const sparkX = isLeft ? 2 : 13;
      const tipX = isLeft ? 1 : 14;
      setHexPixel(cell, palmX, 12, '#ffcba9');
      setHexPixel(cell, palmX, 11, OUTLINE);
      setHexPixel(cell, sparkX, 12, coreHex);
      setHexPixel(cell, tipX, 12, sparkHex);
      setHexPixel(cell, sparkX, 11, sparkHex);
      return cell;
    };
    blitCell(out, makeLunge('#8feff1', '#ffffff'), col, 0);
    blitCell(out, makeLunge('#71ddee', '#8feff1'), col, 1);
    blitCell(out, base, col, 2);
  }
  return out;
}

function buildCultivatorHit(idleSheet: PngImage): PngImage {
  const out = createCanvas(64, 32);
  const recoilDx = [0, 0, 1, -1] as const;
  for (let col = 0; col < 4; col += 1) {
    const base = cropCell(idleSheet, col, 0, 16, 16);
    const recoil = shiftBand(base, 0, 11, recoilDx[col]!, 1, 12);
    // White-flash eyes on frame 0 so hit reads clearly at 16px.
    if (col === 0) {
      setHexPixel(recoil, 6, 8, '#ffffff');
      setHexPixel(recoil, 9, 8, '#ffffff');
    } else if (col === 2) {
      setHexPixel(recoil, 6, 8, '#ffffff');
    } else if (col === 3) {
      setHexPixel(recoil, 9, 8, '#ffffff');
    }
    const squash = shiftBand(base, 0, 12, 0, 1, 13);
    blitCell(out, recoil, col, 0);
    blitCell(out, squash, col, 1);
  }
  return out;
}

function buildCultivatorDash(idleSheet: PngImage): PngImage {
  const out = createCanvas(64, 32);
  for (let col = 0; col < 4; col += 1) {
    const base = cropCell(idleSheet, col, 0, 16, 16);
    const makeGlide = (trailHex: string): PngImage => {
      const dx = col === 2 ? -1 : col === 3 ? 1 : 0;
      const cell = shiftBand(base, 0, 12, dx, 1, 13);
      if (col === 0 || col === 1) {
        // Down / Up: trailing spirit wisps on both shoulders.
        setHexPixel(cell, 4, 10, trailHex);
        setHexPixel(cell, 11, 10, trailHex);
        setHexPixel(cell, 3, 11, '#b8dce5');
        setHexPixel(cell, 12, 11, '#b8dce5');
      } else {
        // Left / Right: trailing spirit-glide streaks flowing directly off the robe hem.
        const trailX1 = col === 2 ? 10 : 5;
        const trailX2 = col === 2 ? 11 : 4;
        const trailX3 = col === 2 ? 12 : 3;
        setHexPixel(cell, trailX1, 12, trailHex);
        setHexPixel(cell, trailX2, 12, '#71ddee');
        setHexPixel(cell, trailX1, 14, '#b8dce5');
        setHexPixel(cell, trailX2, 14, trailHex);
        setHexPixel(cell, trailX3, 14, '#71ddee');
      }
      return cell;
    };
    blitCell(out, makeGlide('#8feff1'), col, 0);
    blitCell(out, makeGlide('#71ddee'), col, 1);
  }
  return out;
}

function buildCultivatorDead(): PngImage {
  // Collapsed pose (16×16, 100% Palette.png, footPx = 0 on row 15).
  return drawPattern(
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '....AAAA........',
      '...ABBBBAA......',
      '.AABBBCCCCAA....',
      'ABBBBBCCACCAA...',
      'AABBBCCCCFEFFA..',
      '..AABCCFFEGGFFA.',
      '...AAADFFEGJFFAA',
      '....AAAFFFFFFJJA',
      '......AAAAAAAAAA',
    ],
    {
      A: OUTLINE,
      B: '#3b3643',
      C: '#ffcba9',
      D: '#f2ad7d',
      E: '#b8dce5',
      F: '#f2eaf1',
      G: '#2d697b',
      J: '#695953',
    },
  );
}

// ---------------------------------------------------------------------------
// 3. Weapon attachments (`bow-hand`, `staff-hand`) & pointed projectiles
// ---------------------------------------------------------------------------

function buildBowHandSheet(): PngImage {
  const bow = readPng(join(PACK, 'Items', 'Weapons', 'Bow', 'Sprite.png')); // 15×7
  const out = createCanvas(64, 16);

  // Col 0 (down): horizontal bow curving down (15×7 placed at x=0, y=5).
  blitCell(out, bow, 0, 0, 0, 5);

  // Col 1 (up): horizontal bow rotated 180° curving up (15×7 placed at x=0, y=4).
  const bowUp = rotate180(bow);
  for (let y = 0; y < bowUp.height; y += 1) {
    for (let x = 0; x < bowUp.width; x += 1) {
      const px = getPixel(bowUp, x, y);
      if (px[3] > 0) setPixel(out, 16 + x, y + 4, px);
    }
  }

  // Col 2 (left): vertical bow curving left (7×15 placed at x=4, y=0).
  const bowLeft = rotate90CCW(bow);
  for (let y = 0; y < bowLeft.height; y += 1) {
    for (let x = 0; x < bowLeft.width; x += 1) {
      const px = getPixel(bowLeft, x, y);
      if (px[3] > 0) setPixel(out, 32 + x + 4, y, px);
    }
  }

  // Col 3 (right): vertical bow curving right (7×15 placed at x=5, y=0).
  const bowRight = rotate90CW(bow);
  for (let y = 0; y < bowRight.height; y += 1) {
    for (let x = 0; x < bowRight.width; x += 1) {
      const px = getPixel(bowRight, x, y);
      if (px[3] > 0) setPixel(out, 48 + x + 5, y, px);
    }
  }

  return out;
}

function buildStaffHandSheet(): PngImage {
  const out = createCanvas(64, 16);
  const colors = {
    A: OUTLINE,
    B: '#f2eaf1',
    C: '#79b8ce',
    D: '#ffad5d',
    E: '#965340',
    F: '#8feff1',
  };

  // Upright staff (5×16) for down (col 0) and up (col 1).
  const upright = drawPattern(
    [
      '.AAA.',
      'ABBCA',
      'ABFCA',
      'AACAA',
      'ADDDA',
      '.AEA.',
      '.ADA.',
      '.ADA.',
      '.ADA.',
      '.ADA.',
      '.ADA.',
      '.ADA.',
      '.ADA.',
      '.ADA.',
      '.ADA.',
      '..A..',
    ],
    colors,
    5,
    16,
  );
  // Diagonal staff angled forward-left (col 2) and mirrored right (col 3).
  const angledLeft = drawPattern(
    [
      '..AAA...........',
      '.ABBCA..........',
      '.ABFCA..........',
      '.AACAA..........',
      '..ADDDA.........',
      '...AEA..........',
      '....ADA.........',
      '....ADA.........',
      '.....ADA........',
      '.....ADA........',
      '......ADA.......',
      '......ADA.......',
      '.......ADA......',
      '.......ADA......',
      '........AA......',
      '................',
    ],
    colors,
    16,
    16,
  );
  const angledRight = mirrorH(angledLeft);

  for (let y = 0; y < upright.height; y += 1) {
    for (let x = 0; x < upright.width; x += 1) {
      const px = getPixel(upright, x, y);
      if (px[3] > 0) {
        setPixel(out, x + 5, y, px);
        setPixel(out, 16 + x + 5, y, px);
      }
    }
  }
  blitCell(out, angledLeft, 2, 0);
  blitCell(out, angledRight, 3, 0);
  return out;
}

function buildArcaneBoltStrip(): PngImage {
  // 4-frame pulsing pointed arcane crystal dart (16×7 per frame → 64×7), pointing RIGHT (+X).
  const out = createCanvas(64, 7);
  const frameSpecs = [
    { core: '#ffffff', mid: '#8feff1', edge: '#79b8ce', tail: '#d3a2c0' },
    { core: '#8feff1', mid: '#71ddee', edge: '#79b8ce', tail: '#a5608b' },
    { core: '#ffffff', mid: '#71ddee', edge: '#2d697b', tail: '#d3a2c0' },
    { core: '#8feff1', mid: '#8feff1', edge: '#79b8ce', tail: '#a5608b' },
  ] as const;

  for (let f = 0; f < frameSpecs.length; f += 1) {
    const spec = frameSpecs[f]!;
    const cell = drawPattern(
      [
        '.......AAAA.....',
        '..AAA.AEEEEAA...',
        '.ATTEAECCCCEEAA.',
        'ATTEEMMCCCCCCEEA',
        '.ATTEAECCCCEEAA.',
        '..AAA.AEEEEAA...',
        '.......AAAA.....',
      ],
      {
        A: OUTLINE,
        C: spec.core,
        M: spec.mid,
        E: spec.edge,
        T: spec.tail,
      },
      16,
      7,
    );
    blitCell(out, cell, f, 0);
  }
  return out;
}

function buildSpiritSwordStrip(): PngImage {
  // 2-frame shimmering pointed flying spirit blade (16×7 per frame → 32×7), pointing RIGHT (+X).
  // Colors match `sword-back.png` (cyan/teal blade, gold guard, crimson tassel) + `#141b1b` outline.
  const out = createCanvas(32, 7);
  const frames = [
    { edge: '#8feff1', blade: '#548789', spine: '#2d697b', tip: '#ffffff' },
    { edge: '#ffffff', blade: '#79b8ce', spine: '#548789', tip: '#8feff1' },
  ] as const;

  for (let f = 0; f < frames.length; f += 1) {
    const spec = frames[f]!;
    const cell = drawPattern(
      [
        '.....AA.........',
        '.AA..AGA........',
        'ATRAAGGAAAAAAA..',
        'ARHAAAGBBBBBBTTA',
        'ATRAAGGAAAAAAA..',
        '.AA..AGA........',
        '.....AA.........',
      ],
      {
        A: OUTLINE,
        B: spec.edge,
        G: '#f1c471',
        H: '#d78b4a',
        R: '#e0394c',
        T: '#8f3e56',
      },
      16,
      7,
    );
    // Spine highlight along middle of blade + gleaming tip.
    setHexPixel(cell, 7, 3, spec.spine);
    setHexPixel(cell, 8, 3, spec.blade);
    setHexPixel(cell, 13, 3, spec.tip);
    setHexPixel(cell, 14, 3, spec.tip);
    blitCell(out, cell, f, 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main staging flow
// ---------------------------------------------------------------------------

const palette = loadPaletteHexSet();
const manifestRaw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
  version: number;
  sprites: Record<string, ManifestEntry>;
};
const sprites: Record<string, ManifestEntry> = { ...manifestRaw.sprites };

const attachmentsRaw = JSON.parse(readFileSync(ATTACHMENTS_PATH, 'utf8')) as AttachmentsData;
const characters: Record<string, CharacterRig> = { ...attachmentsRaw.characters };
const items: Record<string, AttachmentItem> = { ...attachmentsRaw.items };

// 1. Archer (`Hunter`) & Mage (`SorcererBlack`)
characters['archer'] = stagePackCharacter(
  {
    actor: 'archer',
    packFolder: 'Hunter',
    points: {
      hand: { down: [12, 14], up: [2, 10], left: [2, 11], right: [13, 11] },
      back: { down: [10, 6], up: [8, 10], left: [10, 8], right: [6, 8] },
    },
  },
  sprites,
);

characters['mage'] = stagePackCharacter(
  {
    actor: 'mage',
    packFolder: 'SorcererBlack',
    points: {
      hand: { down: [13, 12], up: [1, 10], left: [3, 11], right: [12, 11] },
      back: { down: [10, 6], up: [8, 10], left: [10, 8], right: [6, 8] },
    },
  },
  sprites,
);

// 2. Cultivator missing clips (keep `generated/cultivator/idle.png` untouched!)
const cultivatorIdlePng = readPng(join(ART, 'generated/cultivator/idle.png'));
const cultWalkRel = writeNearestImage(
  'generated/cultivator/walk.png',
  buildCultivatorWalk(cultivatorIdlePng),
  { paletteCheck: palette },
);
const cultAttackRel = writeNearestImage(
  'generated/cultivator/attack.png',
  buildCultivatorAttack(cultivatorIdlePng),
  { paletteCheck: palette },
);
const cultHitRel = writeNearestImage(
  'generated/cultivator/hit.png',
  buildCultivatorHit(cultivatorIdlePng),
  { paletteCheck: palette },
);
const cultDashRel = writeNearestImage(
  'generated/cultivator/dash.png',
  buildCultivatorDash(cultivatorIdlePng),
  { paletteCheck: palette },
);
const cultDeadRel = writeNearestImage('generated/cultivator/dead.png', buildCultivatorDead(), {
  paletteCheck: palette,
});

const prevCultivator = characters['cultivator'];
if (prevCultivator === undefined) throw new Error('attachments.json is missing characters.cultivator');

const cultWalkBob = registerDirectionalClips(sprites, 'cultivator', 'walk', cultWalkRel, 4, 10, true);
const cultAttackBob = registerDirectionalClips(
  sprites,
  'cultivator',
  'attack',
  cultAttackRel,
  3,
  15,
  false,
);
const cultHitBob = registerDirectionalClips(sprites, 'cultivator', 'hit', cultHitRel, 2, 12, false);
const cultDashBob = registerDirectionalClips(
  sprites,
  'cultivator',
  'dash',
  cultDashRel,
  2,
  14,
  false,
);
registerDeadClip(sprites, 'cultivator', cultDeadRel);

characters['cultivator'] = {
  ...prevCultivator,
  bob: {
    ...prevCultivator.bob,
    walk: cultWalkBob,
    attack: cultAttackBob,
    hit: cultHitBob,
    dash: cultDashBob,
  },
};

// 3. Hand weapon attachments (keep `sword-back.png` untouched!)
const bowHandRel = writeNearestImage('generated/attachment/bow-hand.png', buildBowHandSheet(), {
  paletteCheck: palette,
});
const staffHandRel = writeNearestImage(
  'generated/attachment/staff-hand.png',
  buildStaffHandSheet(),
  { paletteCheck: palette },
);

for (const [key, sheet] of [
  ['attachment.bow-hand', bowHandRel],
  ['attachment.staff-hand', staffHandRel],
] as const) {
  for (const dir of DIRS) {
    sprites[`${key}.${dir}`] = {
      sheet,
      frameWidth: 16,
      frameHeight: 16,
      layout: 'grid',
      directions: Array.from(DIRS),
      frames: 1,
      fps: 1,
      loop: false,
      anchor: 'center',
      footPx: 8,
    };
  }
}

items['bow-hand'] = {
  sprite: 'attachment.bow-hand',
  slot: 'hand',
  frameWidth: 16,
  frameHeight: 16,
  grip: { down: [7, 9], up: [7, 6], left: [6, 7], right: [9, 7] },
};

items['staff-hand'] = {
  sprite: 'attachment.staff-hand',
  slot: 'hand',
  frameWidth: 16,
  frameHeight: 16,
  grip: { down: [7, 10], up: [7, 10], left: [7, 9], right: [8, 9] },
};

// 4. Pointed class projectiles (ADR-016)
const arrowRel = copyPackBytes('Items/Weapons/Bow/Arrow.png', 'fx/arrow/Arrow.png');
sprites['fx.arrow'] = {
  sheet: arrowRel,
  frameWidth: 13,
  frameHeight: 5,
  layout: 'strip',
  directions: [],
  frames: 1,
  fps: 10,
  loop: true,
  anchor: 'center',
  footPx: 2,
};

const arcaneBoltRel = writeNearestImage(
  'fx/arcane-bolt/ArcaneBolt.png',
  buildArcaneBoltStrip(),
  { paletteCheck: palette },
);
sprites['fx.arcane-bolt'] = {
  sheet: arcaneBoltRel,
  frameWidth: 16,
  frameHeight: 7,
  layout: 'strip',
  directions: [],
  frames: 4,
  fps: 12,
  loop: true,
  anchor: 'center',
  footPx: 3,
};

const spiritSwordRel = writeNearestImage(
  'fx/spirit-sword/SpiritSword.png',
  buildSpiritSwordStrip(),
  { paletteCheck: palette },
);
sprites['fx.spirit-sword'] = {
  sheet: spiritSwordRel,
  frameWidth: 16,
  frameHeight: 7,
  layout: 'strip',
  directions: [],
  frames: 2,
  fps: 12,
  loop: true,
  anchor: 'center',
  footPx: 3,
};

// 5. Validate & write manifests
const validatedManifest = validateManifest({ version: 1, sprites });
writeFileSync(MANIFEST_PATH, `${JSON.stringify(validatedManifest, null, 2)}\n`);

const validatedAttachments = validateAttachments({ version: 1, characters, items });
writeFileSync(ATTACHMENTS_PATH, `${JSON.stringify(validatedAttachments, null, 2)}\n`);

console.log(
  `Done: staged archer, mage, cultivator clips, bow-hand/staff-hand, fx.{arrow,arcane-bolt,spirit-sword}.`,
);
