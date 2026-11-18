/**
 * Generate the elite sprite sheets (ADR-015): the base monster sheet recoloured onto the
 * Ninja Adventure palette (`art-source/ninja-adventure/Palette.png`, 53 colours) instead of
 * multiplying the sprite with a pale purple tint at runtime.
 *
 * Run: `bun run gen:elites` (or `bun run scripts/gen-elites.ts`).
 *
 * What it does, per monster in `MONSTERS` (the 9 monster actors of `gen-animations.ts`):
 * 1. read the base sheet `resources/art/monsters/<monster>/<Sheet>.png` from the manifest;
 * 2. remap every opaque pixel (`scripts/lib/palette-remap.ts`) and write the elite PNG next to
 *    it as `<kebab-case stem>-elite.png` (`SpriteSheet.png` → `sprite-sheet-elite.png`,
 *    `Eye.png` → `eye-elite.png`);
 * 3. write its `.meta`: a copy of the base PNG's meta with a fresh uuid, or the **existing**
 *    meta when rerun (so UUIDs do not churn between runs);
 * 4. add `<monster>.elite.<idle|walk>.<dir>` to `animations.json`: the base entry with only
 *    `sheet` changed. `gen-animations.ts` keeps those keys when it regenerates the manifest.
 *
 * `config/elite-palette.json` (committed data, tweakable by hand):
 * - `palette` — the 53 distinct opaque colours of `Palette.png` as lowercase `#rrggbb`, in
 *   raster order (row by row, left to right, first occurrence wins). Regenerated from the PNG
 *   on every run; the committed list is what CI and the tests read (art-source is gitignored).
 * - `remap` — the index table, **palette index → palette index**, sparse JSON object
 *   (`{ "12": 40 }`: index 12 becomes palette colour 40). A missing index maps to itself.
 *
 * How the current table was built: bin every palette colour by its relative luminance onto the
 * pack's own purple ramp (indices 37 `#3b3643`, 38 `#543c52`, 39 `#8f3e56`, 40 `#a5608b`,
 * 24 `#ef9597`, 41 `#d3a2c0`), so the whole sprite reads as a violet "this one is stronger"
 * variant while the near-black outline (46 `#141b1b`) stays for the silhouette. The ramp
 * colours are fixed points of the mapping, and at least 20 % of every sprite changes colour.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paletteFromHex, remapPixels, remapTable, rgbToHex, type Rgb } from './lib/palette-remap';
import { readPng, writePng } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const ASSETS = join(PROJECT, 'assets');
const MANIFEST = join(ASSETS, 'resources', 'data', 'animations.json');
const PALETTE_JSON = join(PROJECT, 'config', 'elite-palette.json');
const PALETTE_PNG = join(PROJECT, '..', 'art-source', 'ninja-adventure', 'Palette.png');

const DIRS = ['down', 'up', 'left', 'right'] as const;
const CLIPS = ['idle', 'walk'] as const;

/** The 9 monster actors (GDD §4 roster; same list as `gen-animations.ts`). */
const MONSTERS = [
  'bluebat',
  'spiderred',
  'snake3',
  'eye',
  'greenoctopus',
  'lanternred',
  'bear',
  'trex',
  'cyclope',
] as const;

interface ElitePaletteConfig {
  palette: string[];
  remap: Record<string, number>;
}

interface RawEntry {
  sheet: string;
  [field: string]: unknown;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Distinct opaque colours of Palette.png, in raster order (row by row, left to right). */
function paletteFromPng(path: string): string[] {
  const png = readPng(path);
  const colours: string[] = [];
  const seen = new Set<string>();
  for (let pixel = 0; pixel < png.width * png.height; pixel += 1) {
    const at = pixel * 4;
    if (png.data[at + 3] === 0) continue;
    const hex = rgbToHex({
      r: png.data[at]!,
      g: png.data[at + 1]!,
      b: png.data[at + 2]!,
    });
    if (seen.has(hex)) continue;
    seen.add(hex);
    colours.push(hex);
  }
  return colours;
}

/** `SpriteSheet` → `sprite-sheet`, `Eye` → `eye`, `Snake3` → `snake3`. */
function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
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

/**
 * Elite `.meta`: fresh uuid for a new sheet, the existing uuid on rerun. Every occurrence of the
 * base uuid (`<uuid>`, `<uuid>@6c48a`, …) is rewritten, so texture/sprite-frame sub-metas and
 * `userData.redirect` stay consistent.
 */
function eliteMeta(baseMetaPath: string, eliteMetaPath: string, eliteName: string): void {
  if (existsSync(eliteMetaPath)) {
    // Keep the uuid stable: reruns must not churn asset uuids.
    return;
  }

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
        (sub as Record<string, unknown>)['displayName'] = eliteName;
      }
    }
  }

  writeFileSync(eliteMetaPath, `${JSON.stringify(meta, null, 2)}\n`);
}

const config = readJson<ElitePaletteConfig>(PALETTE_JSON);

// The palette list is regenerated from the pack when the (gitignored) art source is present.
const committedPalette = Array.isArray(config.palette) ? config.palette : [];
let paletteHex = committedPalette;
if (existsSync(PALETTE_PNG)) {
  paletteHex = paletteFromPng(PALETTE_PNG);
  if (
    paletteHex.length !== committedPalette.length ||
    paletteHex.some((hex, index) => hex !== committedPalette[index])
  ) {
    console.warn(
      `elite-palette.json: palette regenerated from Palette.png (${paletteHex.length} colours). ` +
        'The remap table is index-based — re-check it before committing.',
    );
  }
}

const palette: Rgb[] = paletteFromHex(paletteHex);
const table = remapTable(config.remap, palette.length);

writeFileSync(
  PALETTE_JSON,
  `${JSON.stringify({ palette: paletteHex, remap: config.remap }, null, 2)}\n`,
);

const manifest = readJson<{ version: number; sprites: Record<string, RawEntry> }>(MANIFEST);

for (const monster of MONSTERS) {
  const base = manifest.sprites[`${monster}.walk.down`];
  if (base === undefined) throw new Error(`missing ${monster}.walk.down in animations.json`);

  const basePath = join(ASSETS, base.sheet);
  const baseDir = dirname(basePath);
  const stem = basename(basePath).replace(/\.png$/, '');
  const eliteName = `${kebabCase(stem)}-elite`;
  const eliteFile = `${eliteName}.png`;
  const elitePath = join(baseDir, eliteFile);
  const eliteSheet = `${dirname(base.sheet)}/${eliteFile}`;

  const source = readPng(basePath);
  writePng(elitePath, {
    width: source.width,
    height: source.height,
    data: remapPixels(source.data, palette, table),
  });
  eliteMeta(`${basePath}.meta`, `${elitePath}.meta`, eliteName);

  for (const clip of CLIPS) {
    for (const direction of DIRS) {
      const original = manifest.sprites[`${monster}.${clip}.${direction}`];
      if (original === undefined) throw new Error(`missing ${monster}.${clip}.${direction}`);
      manifest.sprites[`${monster}.elite.${clip}.${direction}`] = {
        ...original,
        sheet: eliteSheet,
      };
    }
  }

  console.log(`${monster}: ${eliteSheet}`);
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`animations.json: ${Object.keys(manifest.sprites).length} keys (elite entries included)`);
