/**
 * Apply the build-time 1 px dark silhouette outline (`#141b1b`) to all staged combat
 * monster sprite sheets (normal, `-elite.png`, and `-splitling.png`) using `sharp`.
 *
 * Run: `bun run outline:monsters` (or `bun run scripts/outline-monsters.ts`).
 *
 * Idempotent: pixels already `#141b1b` are skipped, and files whose pixel buffer is
 * unchanged are left untouched on disk.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { outlineSpriteSheet } from './lib/monster-outline';
import { bottomPadding, readPng } from './lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const ASSETS = join(PROJECT, 'assets');
const MONSTERS_DIR = join(ASSETS, 'resources', 'art', 'monsters');
const MANIFEST = join(ASSETS, 'resources', 'data', 'animations.json');

const CELL_SIZE = 16;

function collectMonsterPngs(): string[] {
  const files: string[] = [];
  for (const dir of readdirSync(MONSTERS_DIR).sort()) {
    const dirPath = join(MONSTERS_DIR, dir);
    if (!statSync(dirPath).isDirectory()) continue;
    for (const file of readdirSync(dirPath).sort()) {
      if (file.endsWith('.png')) files.push(join(dirPath, file));
    }
  }
  return files;
}

async function main(): Promise<void> {
  const pngs = collectMonsterPngs();
  let updated = 0;

  for (const path of pngs) {
    const { data, info } = await sharp(path)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const outlined = outlineSpriteSheet(data, info.width, info.height, CELL_SIZE, CELL_SIZE);
    if (outlined.equals(data)) continue;

    await sharp(outlined, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png({ palette: false, compressionLevel: 9 })
      .toFile(path);

    updated += 1;
  }

  console.log(`outline:monsters: ${updated}/${pngs.length} monster sheet(s) updated`);

  // Refresh `footPx` on monster manifest entries if the 1 px outline shifted bottom padding.
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    version: number;
    sprites: Record<string, { sheet: string; anchor?: string; footPx?: number }>;
  };
  let footUpdates = 0;
  const paddingCache = new Map<string, number>();
  for (const entry of Object.values(manifest.sprites)) {
    if (!entry.sheet.startsWith('resources/art/monsters/') || entry.anchor !== 'feet') continue;
    let pad = paddingCache.get(entry.sheet);
    if (pad === undefined) {
      pad = bottomPadding(readPng(join(ASSETS, entry.sheet)));
      paddingCache.set(entry.sheet, pad);
    }
    if (entry.footPx !== pad) {
      entry.footPx = pad;
      footUpdates += 1;
    }
  }
  if (footUpdates > 0) {
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`animations.json: updated footPx on ${footUpdates} monster entries`);
  }
}

await main();
