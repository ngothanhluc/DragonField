/**
 * Stage M17 & M19 generated pixel-art batch into `game/assets/resources/art/generated/`:
 *
 * 1. 6 Character & NPC Portraits (64×64 px):
 *    `generated/portraits/portrait-{ninja,archer,mage,cultivator,shopkeeper,dojo-master}.png`
 * 2. 20 Class Skill Icons + 20 Disabled variants (24×24 px):
 *    `generated/icons/class-skills/<id>.png` and `<id>-disabled.png`
 * 3. 8 VFX & Pickup Sprites:
 *    `generated/fx/{portal-gate,health-potion,orbit-sword,sword-array,meteor,frost-orb,arrow-rain,sword-qi}.png`
 *
 * Pipeline per asset:
 * - Flood-fill + high-purity `#ff00ff` chroma key with JPEG fringe peeling (preserves interior
 *   purples/violets/gold runes while leaving zero magenta halo).
 * - Per-asset `clusterToPalette` + `limitColors` onto the exact 53-color Ninja Adventure `Palette.png`.
 * - Grid-aligned `fitCells` (`align: true`, `keepDetails: true`, `salienceWeights`) + `despeckle` +
 *   single-pixel `#141b1b` outline gap closure with guaranteed cell/inter-frame transparent margins.
 * - Deterministic 53-color stone-gray Disabled icon generation.
 * - Idempotent `.png.meta` (nearest filter) + directory `.meta` + `config/generated-art.json` +
 *   additive merge into `assets/resources/data/animations.json` (never touching existing entries).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { validateManifest, type SpriteEntry } from '../assets/scripts/core/art/manifest';
import { ensureDir, ensureDirMeta, resolvePackDir, writeMeta } from './lib/audio';
import {
  clusterToPalette,
  despeckle,
  dropStrayBlobs,
  fitCells,
  footPxFor,
  limitColors,
  nearestResize,
  paletteColors,
  quantize,
  salienceWeights,
  spriteFrameMeta,
  type Rgb,
} from './lib/gemini-art';
import { readPng, writePng, type PngImage } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const RES = join(PROJECT, 'assets', 'resources');
const ART = join(RES, 'art');
const MANIFEST_PATH = join(RES, 'data', 'animations.json');
const GENERATED_ACTORS_PATH = join(PROJECT, 'config', 'generated-art.json');
const PACK = resolvePackDir();
const PALETTE_PATH = join(PACK, 'Palette.png');

const OUTLINE_RGB: Rgb = [0x14, 0x1b, 0x1b]; // #141b1b

// Disabled icon 4-tone stone-gray ramp (all exact entries in 53-color Palette.png).
const DISABLED_OUTLINE: Rgb = [0x4e, 0x48, 0x4a]; // #4e484a
const DISABLED_DARK: Rgb = [0x8e, 0x7c, 0x73]; // #8e7c73
const DISABLED_MID: Rgb = [0xab, 0xc2, 0xbc]; // #abc2bc
const DISABLED_LIGHT: Rgb = [0xf2, 0xea, 0xf1]; // #f2eaf1

interface RawSheetPaths {
  readonly p1Heroes: string;
  readonly p2Npcs: string;
  readonly i1ClassSkills: string;
  readonly i2ClassEvos: string;
  readonly v1BigFx: string;
  readonly v2SmallFx: string;
  readonly previewOutDir?: string;
}

const DEFAULT_RAW_PATHS: RawSheetPaths = {
  p1Heroes:
    '/Users/ngothanhluc/.gemini/antigravity/brain/dc92f449-e152-4e9a-8de6-4e5d06783c9c/p1_heroes_v3_1795710396055.jpg',
  p2Npcs:
    '/Users/ngothanhluc/.gemini/antigravity/brain/dc92f449-e152-4e9a-8de6-4e5d06783c9c/p2_npcs_v3_1795710391948.jpg',
  i1ClassSkills:
    '/Users/ngothanhluc/.gemini/antigravity/brain/dc92f449-e152-4e9a-8de6-4e5d06783c9c/i1_class_skills_v2_1795710371266.jpg',
  i2ClassEvos:
    '/Users/ngothanhluc/.gemini/antigravity/brain/dc92f449-e152-4e9a-8de6-4e5d06783c9c/i2_class_evos_v3_1795710398227.jpg',
  v1BigFx:
    '/Users/ngothanhluc/.gemini/antigravity/brain/dc92f449-e152-4e9a-8de6-4e5d06783c9c/v1_big_fx_1795710384373.jpg',
  v2SmallFx:
    '/Users/ngothanhluc/.gemini/antigravity/brain/dc92f449-e152-4e9a-8de6-4e5d06783c9c/v2_small_fx_1795710392323.jpg',
  previewOutDir:
    '/Users/ngothanhluc/.gemini/antigravity/brain/352171ee-ed54-4ea9-90db-354f342b2303/scratch/previews',
};

export const PORTRAIT_IDS = [
  'ninja',
  'archer',
  'mage',
  'cultivator',
  'shopkeeper',
  'dojo-master',
] as const;

export const CLASS_SKILL_ICON_IDS = [
  // Ninja (4 exclusive + 1 evo)
  'ninja-shadow-clone',
  'ninja-venom-shuriken',
  'ninja-kunai-burst',
  'ninja-smoke-bomb',
  'ninja-phantom-assassin',
  // Archer (4 exclusive + 1 evo)
  'archer-arrow-rain',
  'archer-split-arrow',
  'archer-hunters-mark',
  'archer-wind-arrow',
  'archer-sky-tempest',
  // Mage (4 exclusive + 1 evo)
  'mage-meteor',
  'mage-frost-orbs',
  'mage-storm-strike',
  'mage-arcane-pulse',
  'mage-elemental-cataclysm',
  // Cultivator (4 exclusive + 1 evo)
  'cultivator-orbit-swords',
  'cultivator-sword-array',
  'cultivator-sword-qi',
  'cultivator-qi-barrier',
  'cultivator-myriad-swords',
] as const;

async function decodeImage(path: string): Promise<PngImage> {
  if (!existsSync(path)) {
    throw new Error(`Missing raw sheet: ${path}`);
  }
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: Buffer.from(data) };
}

function cropRect(image: PngImage, x0: number, y0: number, width: number, height: number): PngImage {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = y0 + y;
    if (sy < 0 || sy >= image.height) continue;
    for (let x = 0; x < width; x += 1) {
      const sx = x0 + x;
      if (sx < 0 || sx >= image.width) continue;
      const from = (sy * image.width + sx) * 4;
      const to = (y * width + x) * 4;
      data[to] = image.data[from]!;
      data[to + 1] = image.data[from + 1]!;
      data[to + 2] = image.data[from + 2]!;
      data[to + 3] = image.data[from + 3]!;
    }
  }
  return { width, height, data };
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Remove `#ff00ff` JPEG backdrop + mosquito compression fringe while preserving interior
 * purple/violet/pink/gold sprite details.
 */
function cleanMagentaBackdrop(image: PngImage): PngImage {
  const { width, height } = image;
  const data = Buffer.from(image.data);
  const total = width * height;
  const cleared = new Uint8Array(total);
  const queue: number[] = [];

  const isPureMagenta = (r: number, g: number, b: number): boolean =>
    r >= 226 && g <= 34 && b >= 222 && Math.abs(r - b) <= 34;

  const isMagentaBleed = (r: number, g: number, b: number): boolean => {
    if (luminance(r, g, b) < 55) return false; // Never eat dark outlines
    return r >= 172 && g <= 92 && b >= 168 && r + b - 2 * g >= 225;
  };

  const clearIdx = (idx: number): void => {
    if (cleared[idx] === 1) return;
    cleared[idx] = 1;
    const p = idx * 4;
    data[p] = 0;
    data[p + 1] = 0;
    data[p + 2] = 0;
    data[p + 3] = 0;
    queue.push(idx);
  };

  // Seed pure magenta anywhere (including enclosed holes inside rings/gates) + border bleeds.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const p = idx * 4;
      const r = data[p]!;
      const g = data[p + 1]!;
      const b = data[p + 2]!;
      const onBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (data[p + 3]! === 0 || isPureMagenta(r, g, b) || (onBorder && isMagentaBleed(r, g, b))) {
        clearIdx(idx);
      }
    }
  }

  // Flood-fill connected JPEG bleed pixels outward from cleared background.
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head]!;
    head += 1;
    const x = idx % width;
    const y = Math.floor(idx / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const nIdx = ny * width + nx;
        if (cleared[nIdx] === 1) continue;
        const p = nIdx * 4;
        if (isMagentaBleed(data[p]!, data[p + 1]!, data[p + 2]!)) {
          clearIdx(nIdx);
        }
      }
    }
  }

  // Two passes of rim cleanup on pixels touching transparency:
  // 1) Strong magenta tint anywhere on the outer boundary, OR
  // 2) Moderate magenta/purple JPEG DCT ringing sandwiched right against a dark `#141b1b` outline.
  for (let pass = 0; pass < 3; pass += 1) {
    const snap = Buffer.from(data);
    const prevCleared = new Uint8Array(cleared);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = y * width + x;
        if (prevCleared[idx] === 1) continue;
        const p = idx * 4;
        const r = snap[p]!;
        const g = snap[p + 1]!;
        const b = snap[p + 2]!;
        const lum = luminance(r, g, b);
        if (lum < 48) continue; // Keep true dark outline core intact

        let touchesTransparent = false;
        let nearDarkOutline = false;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
              if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) touchesTransparent = true;
              continue;
            }
            const nIdx = ny * width + nx;
            if (prevCleared[nIdx] === 1) {
              if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) touchesTransparent = true;
            } else {
              const np = nIdx * 4;
              if (luminance(snap[np]!, snap[np + 1]!, snap[np + 2]!) < 48) {
                nearDarkOutline = true;
              }
            }
          }
        }
        if (!touchesTransparent) continue;

        const strongMagenta = r >= 148 && b >= 142 && r + b - 2 * g >= 185;
        const outlineRinging = nearDarkOutline && r > g + 26 && b > g + 26 && Math.abs(r - b) <= 55;
        if (strongMagenta || outlineRinging) {
          cleared[idx] = 1;
          data[p] = 0;
          data[p + 1] = 0;
          data[p + 2] = 0;
          data[p + 3] = 0;
        }
      }
    }
  }

  return { width, height, data };
}

/**
 * Remove JPEG halo specks stranded OUTSIDE the `#141b1b` dark outline:
 * 1) Any non-dark pixel (`lum >= 45`) that touches transparency orthogonally and whose ONLY
 *    opaque orthogonal neighbors are dark outline (`lum < 45`) is an exterior JPEG speck, never
 *    interior fill — clear it.
 * 2) Any degree-1 pixel sticking orthogonally out from a dark outline (`orthoOpaque === 1` and
 *    neighbor is dark) is an outline wart — clear it.
 */
function pruneOutlineWarts(image: PngImage): PngImage {
  const { width, height } = image;
  const data = Buffer.from(image.data);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (let pass = 0; pass < 3; pass += 1) {
    const snap = Buffer.from(data);
    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        if (snap[idx + 3]! === 0) continue;
        const selfLum = luminance(snap[idx]!, snap[idx + 1]!, snap[idx + 2]!);

        let orthoOpaque = 0;
        let orthoDark = 0;
        let orthoTrans = 0;
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            orthoTrans += 1;
            continue;
          }
          const nIdx = (ny * width + nx) * 4;
          if (snap[nIdx + 3]! === 0) {
            orthoTrans += 1;
          } else {
            orthoOpaque += 1;
            if (luminance(snap[nIdx]!, snap[nIdx + 1]!, snap[nIdx + 2]!) < 45) {
              orthoDark += 1;
            }
          }
        }

        const isStrandedOutsideOutline = selfLum >= 45 && orthoTrans >= 1 && orthoOpaque > 0 && orthoDark === orthoOpaque;
        const isSinglePixelWart = orthoOpaque === 1 && orthoDark === 1;
        if (isStrandedOutsideOutline || isSinglePixelWart) {
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
        }
      }
    }
  }
  return { width, height, data };
}

/**
 * Close gaps in the 1px `#141b1b` silhouette outline ONLY where a bright/mid pixel (`L >= 58`)
 * directly 4-neighbors a transparent pixel inside the allowed safe box of each frame.
 * Never thickens existing dark outlines (`L < 58`) and never touches frame borders when `margin >= 1`.
 */
function closeBrightSilhouetteGaps(
  image: PngImage,
  frameWidth: number,
  frameHeight: number,
  margin = 1,
  skipBottomEdge = false,
): PngImage {
  const cols = Math.floor(image.width / frameWidth);
  const rows = Math.floor(image.height / frameHeight);
  const out = Buffer.from(image.data);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const xMin = col * frameWidth + margin;
      const xMax = (col + 1) * frameWidth - 1 - margin;
      const yMin = row * frameHeight + margin;
      const yMax = skipBottomEdge ? (row + 1) * frameHeight - 1 : (row + 1) * frameHeight - 1 - margin;

      for (let y = yMin; y <= yMax; y += 1) {
        if (skipBottomEdge && y === (row + 1) * frameHeight - 1) continue;
        for (let x = xMin; x <= xMax; x += 1) {
          const idx = (y * image.width + x) * 4;
          if (image.data[idx + 3]! > 0) continue;

          let touchesUnoutlinedColor = false;
          for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            if (
              nx < col * frameWidth ||
              nx >= (col + 1) * frameWidth ||
              ny < row * frameHeight ||
              ny >= (row + 1) * frameHeight
            ) {
              continue;
            }
            const nIdx = (ny * image.width + nx) * 4;
            if (image.data[nIdx + 3]! === 0) continue;
            const lum = luminance(image.data[nIdx]!, image.data[nIdx + 1]!, image.data[nIdx + 2]!);
            if (lum >= 58) {
              touchesUnoutlinedColor = true;
              break;
            }
          }

          if (touchesUnoutlinedColor) {
            out[idx] = OUTLINE_RGB[0];
            out[idx + 1] = OUTLINE_RGB[1];
            out[idx + 2] = OUTLINE_RGB[2];
            out[idx + 3] = 255;
          }
        }
      }
    }
  }

  return { width: image.width, height: image.height, data: out };
}

/** Remap an active 24×24 skill icon onto the 53-color stone-gray Disabled palette ramp. */
function makeDisabledIcon(active: PngImage): PngImage {
  const data = Buffer.alloc(active.data.length);
  for (let i = 0; i < active.data.length; i += 4) {
    if (active.data[i + 3]! === 0) continue;
    const lum = luminance(active.data[i]!, active.data[i + 1]!, active.data[i + 2]!);
    const target =
      lum < 55
        ? DISABLED_OUTLINE
        : lum < 125
          ? DISABLED_DARK
          : lum < 195
            ? DISABLED_MID
            : DISABLED_LIGHT;
    data[i] = target[0];
    data[i + 1] = target[1];
    data[i + 2] = target[2];
    data[i + 3] = 255;
  }
  return { width: active.width, height: active.height, data };
}

function assertCleanPixelArt(
  image: PngImage,
  label: string,
  paletteHexSet: ReadonlySet<string>,
  frameWidth: number,
  checkInterFrameMargin: boolean,
): void {
  let opaque = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      const a = image.data[i + 3]!;
      if (a === 0) continue;
      if (a !== 255) {
        throw new Error(`${label}: non-binary alpha ${a} at (${x},${y})`);
      }
      const hex = `#${image.data[i]!.toString(16).padStart(2, '0')}${image.data[i + 1]!.toString(16).padStart(2, '0')}${image.data[i + 2]!.toString(16).padStart(2, '0')}`;
      if (!paletteHexSet.has(hex)) {
        throw new Error(`${label}: off-palette color ${hex} at (${x},${y})`);
      }
      opaque += 1;
    }
  }
  if (opaque === 0) {
    throw new Error(`${label}: image has 0 opaque pixels`);
  }

  // Ensure every individual frame in a strip has opaque pixels AND clean inter-frame boundaries.
  const frames = Math.floor(image.width / frameWidth);
  for (let f = 0; f < frames; f += 1) {
    let frameOpaque = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let lx = 0; lx < frameWidth; lx += 1) {
        if (image.data[(y * image.width + f * frameWidth + lx) * 4 + 3]! > 0) {
          frameOpaque += 1;
        }
      }
    }
    if (frameOpaque === 0) {
      throw new Error(`${label}: frame ${f} is completely blank`);
    }
  }

  if (checkInterFrameMargin && frames > 1) {
    for (let f = 1; f < frames; f += 1) {
      const boundaryRightOfPrev = f * frameWidth - 1;
      const boundaryLeftOfCurr = f * frameWidth;
      for (let y = 0; y < image.height; y += 1) {
        const aPrev = image.data[(y * image.width + boundaryRightOfPrev) * 4 + 3]!;
        const aCurr = image.data[(y * image.width + boundaryLeftOfCurr) * 4 + 3]!;
        if (aPrev > 0 && aCurr > 0) {
          throw new Error(`${label}: inter-frame clip at seam x=${boundaryRightOfPrev}|${boundaryLeftOfCurr}, y=${y}`);
        }
      }
    }
  }
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

function writeStagedPng(
  relUnderArt: string,
  image: PngImage,
  paletteHexSet: ReadonlySet<string>,
  frameWidth: number,
  checkInterFrameMargin = false,
): string {
  assertCleanPixelArt(image, relUnderArt, paletteHexSet, frameWidth, checkInterFrameMargin);
  const fullPath = join(ART, relUnderArt);
  const relParts = `art/${relUnderArt}`.split('/');
  for (let i = 1; i < relParts.length; i += 1) {
    ensureDirMeta(relParts.slice(0, i).join('/'));
  }
  ensureDir(dirname(fullPath));
  writePng(fullPath, image);
  const name = relUnderArt.split('/').pop()?.replace(/\.png$/, '') ?? 'image';
  const uuid = existingUuid(fullPath) ?? randomUUID();
  writeMeta(fullPath, spriteFrameMeta(uuid, name, image.width, image.height));
  console.log(`staged  resources/art/${relUnderArt} (${image.width}×${image.height})`);
  return `resources/art/${relUnderArt}`;
}

function processSinglePortrait(rawCell: PngImage, palette: readonly Rgb[]): PngImage {
  const keyed = cleanMagentaBackdrop(rawCell);
  const dropped = dropStrayBlobs(keyed, 1, 1, 0.015);
  const mapped = limitColors(clusterToPalette(dropped, palette, 20), 14);
  const fitted = fitCells(mapped, {
    columns: 1,
    rows: 1,
    frameWidth: 64,
    frameHeight: 64,
    anchor: 'feet',
    share: 'cell',
    fitBox: [58, 61],
    align: true,
    keepDetails: false,
    weights: salienceWeights(mapped),
  });
  const cleaned = despeckle(pruneOutlineWarts(despeckle(fitted)));
  const outlined = closeBrightSilhouetteGaps(cleaned, 64, 64, 1, true);
  return quantize(outlined, palette);
}

function processSingleIcon(rawCell: PngImage, palette: readonly Rgb[]): PngImage {
  const keyed = cleanMagentaBackdrop(rawCell);
  const dropped = dropStrayBlobs(keyed, 1, 1, 0.015);
  const mapped = limitColors(clusterToPalette(dropped, palette, 16), 10);
  const fitted = fitCells(mapped, {
    columns: 1,
    rows: 1,
    frameWidth: 24,
    frameHeight: 24,
    anchor: 'center',
    share: 'cell',
    fitBox: [20, 20],
    align: true,
    keepDetails: false,
    weights: salienceWeights(mapped),
  });
  const cleaned = despeckle(pruneOutlineWarts(despeckle(fitted)));
  const outlined = closeBrightSilhouetteGaps(cleaned, 24, 24, 1, false);
  return quantize(outlined, palette);
}

function processVfxStrip(
  rawRow: PngImage,
  frames: number,
  frameWidth: number,
  frameHeight: number,
  fitBox: readonly [number, number],
  palette: readonly Rgb[],
): PngImage {
  const keyed = cleanMagentaBackdrop(rawRow);
  const dropped = dropStrayBlobs(keyed, frames, 1, 0.01);
  const mapped = limitColors(clusterToPalette(dropped, palette, 18), 11);
  const fitted = fitCells(mapped, {
    columns: frames,
    rows: 1,
    frameWidth,
    frameHeight,
    anchor: 'center',
    share: 'sheet',
    fitBox,
    align: true,
    keepDetails: frameHeight <= 16,
    weights: salienceWeights(mapped),
  });
  const cleaned = despeckle(pruneOutlineWarts(despeckle(fitted)));
  const outlined = closeBrightSilhouetteGaps(cleaned, frameWidth, frameHeight, 1, false);
  return quantize(outlined, palette);
}

/** Paint a zoomed contact sheet onto dark grass & wood panels for visual verification. */
function buildContactPreview(
  items: ReadonlyArray<{ readonly image: PngImage }>,
  cols: number,
  scale: number,
  padPx: number,
  bgRgb: Rgb,
): PngImage {
  const maxW = Math.max(...items.map((it) => it.image.width * scale));
  const maxH = Math.max(...items.map((it) => it.image.height * scale));
  const cellW = maxW + padPx * 2;
  const cellH = maxH + padPx * 2;
  const rows = Math.ceil(items.length / cols);
  const width = cols * cellW;
  const height = rows * cellH;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = bgRgb[0];
    data[i * 4 + 1] = bgRgb[1];
    data[i * 4 + 2] = bgRgb[2];
    data[i * 4 + 3] = 255;
  }

  items.forEach(({ image }, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const zoomed = nearestResize(image, image.width * scale, image.height * scale);
    const ox = col * cellW + Math.floor((cellW - zoomed.width) / 2);
    const oy = row * cellH + Math.floor((cellH - zoomed.height) / 2);

    // Subtle 1px cell guide box so frame edges & margins are easy to inspect.
    for (let y = 0; y < zoomed.height; y += 1) {
      for (let x = 0; x < zoomed.width; x += 1) {
        if (x === 0 || y === 0 || x === zoomed.width - 1 || y === zoomed.height - 1) {
          const gx = ox + x;
          const gy = oy + y;
          const gi = (gy * width + gx) * 4;
          data[gi] = Math.min(255, bgRgb[0] + 18);
          data[gi + 1] = Math.min(255, bgRgb[1] + 18);
          data[gi + 2] = Math.min(255, bgRgb[2] + 18);
        }
      }
    }

    for (let y = 0; y < zoomed.height; y += 1) {
      for (let x = 0; x < zoomed.width; x += 1) {
        const si = (y * zoomed.width + x) * 4;
        if (zoomed.data[si + 3]! === 0) continue;
        const di = ((oy + y) * width + (ox + x)) * 4;
        data[di] = zoomed.data[si]!;
        data[di + 1] = zoomed.data[si + 1]!;
        data[di + 2] = zoomed.data[si + 2]!;
        data[di + 3] = 255;
      }
    }
  });

  return { width, height, data };
}

export async function stageM19Art(paths: RawSheetPaths = DEFAULT_RAW_PATHS): Promise<void> {
  if (!existsSync(PALETTE_PATH)) {
    throw new Error(`Missing Palette.png at ${PALETTE_PATH}`);
  }
  const palettePng = readPng(PALETTE_PATH);
  const palette = paletteColors(palettePng);
  const paletteHexSet = new Set(
    palette.map(
      ([r, g, b]) =>
        `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
    ),
  );

  const [p1, p2, i1, i2, v1, v2] = await Promise.all([
    decodeImage(paths.p1Heroes),
    decodeImage(paths.p2Npcs),
    decodeImage(paths.i1ClassSkills),
    decodeImage(paths.i2ClassEvos),
    decodeImage(paths.v1BigFx),
    decodeImage(paths.v2SmallFx),
  ]);

  const newEntries = new Map<string, SpriteEntry>();

  // -------------------------------------------------------------------------
  // 1. 6 Character & NPC Portraits (64×64)
  //    Note: p1 splitY = 516 preserves Ninja & Archer's bottom outline (y=513)
  //    and Mage's wizard hat tip (y=520).
  // -------------------------------------------------------------------------
  const rawPortraitCells: ReadonlyArray<readonly [string, PngImage]> = [
    ['ninja', cropRect(p1, 0, 0, 514, 516)],
    ['archer', cropRect(p1, 514, 0, 510, 516)],
    ['mage', cropRect(p1, 0, 516, 514, 508)],
    ['cultivator', cropRect(p1, 514, 516, 510, 508)],
    ['shopkeeper', cropRect(p2, 0, 0, 512, 496)],
    ['dojo-master', cropRect(p2, 512, 0, 512, 496)],
  ];

  const stagedPortraits: Array<{ readonly id: string; readonly image: PngImage }> = [];
  for (const [id, cell] of rawPortraitCells) {
    const portrait = processSinglePortrait(cell, palette);
    const sheet = writeStagedPng(`generated/portraits/portrait-${id}.png`, portrait, paletteHexSet, 64, false);
    newEntries.set(`icon.portrait-${id}`, {
      sheet,
      frameWidth: 64,
      frameHeight: 64,
      layout: 'strip',
      directions: [],
      frames: 1,
      fps: 1,
      loop: false,
      anchor: 'center',
      footPx: footPxFor('center', portrait, 64),
    });
    stagedPortraits.push({ id, image: portrait });
  }

  // -------------------------------------------------------------------------
  // 2. 20 Class Skill Icons + 20 Disabled Variants (24×24)
  // -------------------------------------------------------------------------
  const i1Ids = [
    // Row 0: Ninja
    'ninja-shadow-clone',
    'ninja-venom-shuriken',
    'ninja-kunai-burst',
    'ninja-smoke-bomb',
    // Row 1: Archer
    'archer-arrow-rain',
    'archer-split-arrow',
    'archer-hunters-mark',
    'archer-wind-arrow',
    // Row 2: Mage
    'mage-meteor',
    'mage-frost-orbs',
    'mage-storm-strike',
    'mage-arcane-pulse',
    // Row 3: Cultivator
    'cultivator-orbit-swords',
    'cultivator-sword-array',
    'cultivator-sword-qi',
    'cultivator-qi-barrier',
  ] as const;

  const i2Ids = [
    'ninja-phantom-assassin',
    'archer-sky-tempest',
    'mage-elemental-cataclysm',
    'cultivator-myriad-swords',
  ] as const;

  const rawIconCells: Array<readonly [string, PngImage]> = [];
  i1Ids.forEach((id, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    rawIconCells.push([id, cropRect(i1, col * 256, row * 256, 256, 256)]);
  });
  i2Ids.forEach((id, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    rawIconCells.push([id, cropRect(i2, col * 512, row * 512, 512, 512)]);
  });

  const stagedIconsActive: Array<{ readonly id: string; readonly image: PngImage }> = [];
  const stagedIconsDisabled: Array<{ readonly id: string; readonly image: PngImage }> = [];

  for (const [id, cell] of rawIconCells) {
    const active = processSingleIcon(cell, palette);
    const disabled = makeDisabledIcon(active);

    const activeSheet = writeStagedPng(
      `generated/icons/class-skills/${id}.png`,
      active,
      paletteHexSet,
      24,
      false,
    );
    const disabledSheet = writeStagedPng(
      `generated/icons/class-skills/${id}-disabled.png`,
      disabled,
      paletteHexSet,
      24,
      false,
    );

    newEntries.set(`icon.${id}`, {
      sheet: activeSheet,
      frameWidth: 24,
      frameHeight: 24,
      layout: 'strip',
      directions: [],
      frames: 1,
      fps: 1,
      loop: false,
      anchor: 'center',
      footPx: footPxFor('center', active, 24),
    });
    newEntries.set(`icon.${id}-disabled`, {
      sheet: disabledSheet,
      frameWidth: 24,
      frameHeight: 24,
      layout: 'strip',
      directions: [],
      frames: 1,
      fps: 1,
      loop: false,
      anchor: 'center',
      footPx: footPxFor('center', disabled, 24),
    });

    stagedIconsActive.push({ id, image: active });
    stagedIconsDisabled.push({ id, image: disabled });
  }

  // -------------------------------------------------------------------------
  // 3. 8 VFX & Pickup Sprites
  // -------------------------------------------------------------------------
  interface VfxJob {
    readonly key: string;
    readonly file: string;
    readonly rawStrip: PngImage;
    readonly frames: number;
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly fitBox: readonly [number, number];
    readonly fps: number;
    readonly loop: boolean;
  }

  const vfxJobs: readonly VfxJob[] = [
    {
      key: 'fx.portal-gate',
      file: 'generated/fx/portal-gate.png',
      rawStrip: cropRect(v1, 0, 0, 1024, 256),
      frames: 4,
      frameWidth: 48,
      frameHeight: 48,
      fitBox: [44, 44],
      fps: 8,
      loop: true,
    },
    {
      key: 'fx.sword-array',
      file: 'generated/fx/sword-array.png',
      rawStrip: cropRect(v1, 0, 256, 1024, 256),
      frames: 4,
      frameWidth: 32,
      frameHeight: 32,
      fitBox: [28, 28],
      fps: 10,
      loop: true,
    },
    {
      key: 'fx.meteor',
      file: 'generated/fx/meteor.png',
      rawStrip: cropRect(v1, 0, 512, 1024, 256),
      frames: 4,
      frameWidth: 32,
      frameHeight: 32,
      fitBox: [28, 28],
      fps: 12,
      loop: false,
    },
    {
      key: 'fx.arrow-rain',
      file: 'generated/fx/arrow-rain.png',
      rawStrip: cropRect(v1, 0, 768, 1024, 256),
      frames: 4,
      frameWidth: 32,
      frameHeight: 32,
      fitBox: [28, 28],
      fps: 12,
      loop: false,
    },
    {
      key: 'fx.sword-qi',
      file: 'generated/fx/sword-qi.png',
      rawStrip: cropRect(v2, 0, 0, 1024, 256),
      frames: 4,
      frameWidth: 32,
      frameHeight: 32,
      fitBox: [28, 28],
      fps: 14,
      loop: true,
    },
    {
      key: 'fx.orbit-sword',
      file: 'generated/fx/orbit-sword.png',
      rawStrip: cropRect(v2, 0, 256, 1024, 256),
      frames: 4,
      frameWidth: 16,
      frameHeight: 16,
      fitBox: [14, 12],
      fps: 12,
      loop: true,
    },
    {
      key: 'fx.frost-orb',
      file: 'generated/fx/frost-orb.png',
      rawStrip: cropRect(v2, 0, 512, 1024, 256),
      frames: 4,
      frameWidth: 16,
      frameHeight: 16,
      fitBox: [14, 14],
      fps: 10,
      loop: true,
    },
    {
      // Single 16×16 pickup sprite (works identically via animations.json OR direct SpriteFrame load).
      key: 'fx.health-potion',
      file: 'generated/fx/health-potion.png',
      rawStrip: cropRect(v2, 256, 768, 256, 256),
      frames: 1,
      frameWidth: 16,
      frameHeight: 16,
      fitBox: [13, 14],
      fps: 1,
      loop: true,
    },
  ];

  const stagedVfx: Array<{ readonly key: string; readonly image: PngImage }> = [];
  for (const job of vfxJobs) {
    let strip = processVfxStrip(
      job.rawStrip,
      job.frames,
      job.frameWidth,
      job.frameHeight,
      job.fitBox,
      palette,
    );
    if (job.key === 'fx.health-potion') {
      // Ensure a crisp emerald/white '+' healing glint in top-right of the 16×16 ruby potion pickup.
      const setPx = (x: number, y: number, rgb: Rgb): void => {
        const i = (y * strip.width + x) * 4;
        strip.data[i] = rgb[0];
        strip.data[i + 1] = rgb[1];
        strip.data[i + 2] = rgb[2];
        strip.data[i + 3] = 255;
      };
      const emerald: Rgb = [0x74, 0xa3, 0x34]; // #74a334
      const white: Rgb = [0xff, 0xff, 0xff]; // #ffffff
      setPx(12, 3, emerald);
      setPx(11, 4, emerald);
      setPx(12, 4, white);
      setPx(13, 4, emerald);
      setPx(12, 5, emerald);
      strip = quantize(strip, palette);
    }
    const sheet = writeStagedPng(job.file, strip, paletteHexSet, job.frameWidth, true);
    newEntries.set(job.key, {
      sheet,
      frameWidth: job.frameWidth,
      frameHeight: job.frameHeight,
      layout: 'strip',
      directions: [],
      frames: job.frames,
      fps: job.fps,
      loop: job.loop,
      anchor: 'center',
      footPx: footPxFor('center', strip, job.frameHeight),
    });
    stagedVfx.push({ key: job.key, image: strip });
  }

  // -------------------------------------------------------------------------
  // 4. Update `config/generated-art.json` & merge new entries into `animations.json`
  // -------------------------------------------------------------------------
  const generatedConfig = JSON.parse(readFileSync(GENERATED_ACTORS_PATH, 'utf8')) as Record<string, unknown>;
  for (const [listKey, prefix] of [
    ['icons', 'icon'],
    ['vfx', 'fx'],
  ] as const) {
    const list = Array.isArray(generatedConfig[listKey])
      ? (generatedConfig[listKey] as string[])
      : (generatedConfig[listKey] = []);
    if (!list.includes(prefix)) list.push(prefix);
    list.sort();
  }
  writeFileSync(GENERATED_ACTORS_PATH, `${JSON.stringify(generatedConfig, null, 2)}\n`);

  const manifestRaw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    version: number;
    sprites: Record<string, SpriteEntry>;
  };
  for (const [key, entry] of newEntries) {
    manifestRaw.sprites[key] = entry;
  }
  validateManifest(manifestRaw);
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifestRaw, null, 2)}\n`);
  console.log(`manifest  ${MANIFEST_PATH} (+${newEntries.size} entries validated)`);

  // -------------------------------------------------------------------------
  // 5. Optional zoomed visual verification sheets (gitignored scratch dir)
  // -------------------------------------------------------------------------
  if (paths.previewOutDir !== undefined) {
    mkdirSync(paths.previewOutDir, { recursive: true });
    writePng(
      resolve(paths.previewOutDir, 'preview-portraits-x5.png'),
      buildContactPreview(stagedPortraits, 3, 5, 16, [0x3b, 0x36, 0x43]),
    );
    writePng(
      resolve(paths.previewOutDir, 'preview-icons-active-x8.png'),
      buildContactPreview(stagedIconsActive, 5, 8, 12, [0x4e, 0x48, 0x4a]),
    );
    writePng(
      resolve(paths.previewOutDir, 'preview-icons-disabled-x8.png'),
      buildContactPreview(stagedIconsDisabled, 5, 8, 12, [0x3b, 0x36, 0x43]),
    );
    writePng(
      resolve(paths.previewOutDir, 'preview-vfx-grass-x5.png'),
      buildContactPreview(stagedVfx, 2, 5, 16, [0x34, 0x5a, 0x52]),
    );
    console.log(`previews  ${paths.previewOutDir}`);
  }
}

if (import.meta.main) {
  await stageM19Art();
}
