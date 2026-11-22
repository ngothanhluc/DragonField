/**
 * Generate the splitling sheets (#42): the splitter's sheet recoloured onto the pack palette,
 * exactly like `gen-elites.ts` does for elites (ADR-015). Splitlings must read as a different
 * creature, and a runtime multiply-tint would leave the pack's 53-colour palette (rejected).
 *
 * Run: `bun run gen:splitlings` (after `gen:animations`).
 *
 * - Reads the base sheet from `resources/art/monsters/<monster>/` (via the manifest).
 * - Writes `<stem>-splitling.png` next to it, and its `.meta` (a copy of the base meta with a
 *   fresh uuid; reruns keep the existing meta so editor uuids do not churn).
 * - Adds `<monster>.splitling.<idle|walk>.<direction>` to `animations.json`: the base entry with
 *   only `sheet` changed. `gen-animations.ts` keeps these keys on regeneration.
 *
 * The remap is a **green** ramp (the elite ramp is violet), built from the committed palette by
 * luminance so every output pixel stays in the pack palette.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paletteFromHex, remapPixels, type Rgb } from './lib/palette-remap';
import { readPng, writePng } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const ASSETS = join(PROJECT, 'assets');
const MANIFEST = join(ASSETS, 'resources', 'data', 'animations.json');
const PALETTE_JSON = join(PROJECT, 'config', 'elite-palette.json');

/** Monster actors whose splitter uses this sheet (same mapping as `bootstrap.ts`). */
const SPLITTERS = ['slimegreen', 'slime2', 'slime3'] as const;
const CLIPS = ['idle', 'walk'] as const;
const DIRS = ['down', 'up', 'left', 'right'] as const;

/** Palette indices forming a dark→light green ramp (`#345a52 … #abc2bc`). */
const GREEN_RAMP = [45, 34, 35, 36, 37, 46] as const;

interface RawEntry {
  sheet: string;
  [field: string]: unknown;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Relative luminance (sRGB weights) used to pick the ramp step for each source colour. */
function luminance(colour: Rgb): number {
  return 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
}

/**
 * Dense remap table: each palette colour goes to the green-ramp colour with the closest
 * luminance. Ramp colours are fixed points, outlines stay dark, highlights stay light.
 */
function greenTable(palette: readonly Rgb[]): number[] {
  const ramp = GREEN_RAMP.map((index) => {
    const colour = palette[index];
    if (colour === undefined) throw new Error(`elite-palette.json has no colour ${index}`);
    return { index, luminance: luminance(colour) };
  });

  return palette.map((colour) => {
    const target = luminance(colour);
    let best = ramp[0]!;
    for (const step of ramp) {
      if (Math.abs(step.luminance - target) < Math.abs(best.luminance - target)) best = step;
    }
    return best.index;
  });
}

/** Replace every string in a copied `.meta` through `rewrite` (uuids, display names). */
function rewriteStrings(value: unknown, rewrite: (text: string) => string): unknown {
  if (typeof value === 'string') return rewrite(value);
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map((item) => rewriteStrings(item, rewrite));
  }
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      copy[key] = rewriteStrings(entry, rewrite);
    }
    return copy;
  }
  return value;
}

/** Variant `.meta`: fresh uuid for a new sheet, the existing uuid on rerun. */
function variantMeta(baseMetaPath: string, variantMetaPath: string, variantName: string): void {
  if (existsSync(variantMetaPath)) return;

  const baseMeta = readJson<{ uuid?: unknown }>(baseMetaPath);
  const baseUuid = typeof baseMeta.uuid === 'string' ? baseMeta.uuid : undefined;
  if (baseUuid === undefined) throw new Error(`${baseMetaPath} has no uuid`);

  const uuid = randomUUID();
  const meta = rewriteStrings(baseMeta, (text) => {
    if (text === baseUuid) return uuid;
    if (text.startsWith(`${baseUuid}@`)) return `${uuid}${text.slice(baseUuid.length)}`;
    return text;
  }) as Record<string, unknown>;

  const subMetas = meta['subMetas'];
  if (typeof subMetas === 'object' && subMetas !== null) {
    for (const sub of Object.values(subMetas as Record<string, unknown>)) {
      if (typeof sub === 'object' && sub !== null) {
        (sub as Record<string, unknown>)['displayName'] = variantName;
      }
    }
  }

  writeFileSync(variantMetaPath, `${JSON.stringify(meta, null, 2)}\n`);
}

function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

const config = readJson<{ palette: string[] }>(PALETTE_JSON);
const palette = paletteFromHex(config.palette);
const table = greenTable(palette);

const manifest = readJson<{ version: number; sprites: Record<string, RawEntry> }>(MANIFEST);

for (const monster of SPLITTERS) {
  const base = manifest.sprites[`${monster}.walk.down`];
  if (base === undefined) throw new Error(`missing ${monster}.walk.down in animations.json`);

  const basePath = join(ASSETS, base.sheet);
  const stem = basename(basePath).replace(/\.png$/, '');
  const variantName = `${kebabCase(stem)}-splitling`;
  const variantFile = `${variantName}.png`;
  const variantPath = join(dirname(basePath), variantFile);
  const variantSheet = `${dirname(base.sheet)}/${variantFile}`;

  const source = readPng(basePath);
  writePng(variantPath, {
    width: source.width,
    height: source.height,
    data: remapPixels(source.data, palette, table),
  });
  variantMeta(`${basePath}.meta`, `${variantPath}.meta`, variantName);

  for (const clip of CLIPS) {
    for (const direction of DIRS) {
      const original = manifest.sprites[`${monster}.${clip}.${direction}`];
      if (original === undefined) throw new Error(`missing ${monster}.${clip}.${direction}`);
      manifest.sprites[`${monster}.splitling.${clip}.${direction}`] = {
        ...original,
        sheet: variantSheet,
      };
    }
  }

  console.log(`${monster}: ${variantSheet}`);
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`animations.json: ${Object.keys(manifest.sprites).length} keys (splitling entries included)`);
