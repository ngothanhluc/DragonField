/**
 * Acceptance test for #4 (ADR-015): elites are palette-remapped PNGs generated at build time,
 * not a multiplicative tint.
 *
 * - `config/elite-palette.json` holds the pack palette (`art-source/ninja-adventure/Palette.png`,
 *   53 colours) as `#rrggbb` strings, so CI can check pixels without the gitignored art source.
 * - Every monster has `<monster>.elite.<clip>.<dir>` manifest keys pointing at its own elite PNG.
 * - Elite PNG: same size as the original, alpha identical pixel by pixel, every opaque pixel in
 *   the palette, visibly recoloured, and a valid `.meta` with a fresh uuid.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest, type AnimationManifest } from '../../assets/scripts/core/art/manifest';
import { eliteScale } from '../../assets/scripts/core/enemies/elite';
import { readPng, type PngImage } from '../../scripts/lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, '..', '..');
const ASSETS = join(GAME, 'assets');
const PALETTE_JSON = join(GAME, 'config', 'elite-palette.json');
const PALETTE_PNG = join(GAME, '..', 'art-source', 'ninja-adventure', 'Palette.png');

/** The 9 monster actors in the manifest (GDD §4 roster, `gen-animations.ts` MONSTERS). */
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
const CLIPS = ['idle', 'walk'] as const;
const DIRS = ['down', 'up', 'left', 'right'] as const;

const manifest: AnimationManifest = validateManifest(
  JSON.parse(readFileSync(join(ASSETS, 'resources', 'data', 'animations.json'), 'utf8')) as unknown,
);

function hex(image: PngImage, pixel: number): string {
  const at = pixel * 4;
  return `#${[0, 1, 2].map((k) => image.data[at + k]!.toString(16).padStart(2, '0')).join('')}`;
}

function readPalette(): string[] {
  if (!existsSync(PALETTE_JSON)) return [];
  const raw = JSON.parse(readFileSync(PALETTE_JSON, 'utf8')) as { palette?: unknown };
  return Array.isArray(raw.palette) ? raw.palette.map((value) => String(value).toLowerCase()) : [];
}

function eliteKey(monster: string, clip: string, dir: string): string {
  return `${monster}.elite.${clip}.${dir}`;
}

function eliteSheetOf(monster: string): string | undefined {
  return manifest.sprites[eliteKey(monster, 'walk', 'down')]?.sheet;
}

function allMetaUuids(): Map<string, string[]> {
  const byUuid = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (name.endsWith('.meta')) {
        const uuid = (JSON.parse(readFileSync(path, 'utf8')) as { uuid?: string }).uuid;
        if (uuid !== undefined) byUuid.set(uuid, [...(byUuid.get(uuid) ?? []), relative(ASSETS, path)]);
      }
    }
  };
  walk(ASSETS);
  return byUuid;
}

describe('elite palette data', () => {
  it('config/elite-palette.json lists the 53 distinct pack palette colours as #rrggbb', () => {
    const palette = readPalette();
    expect(palette).toHaveLength(53);
    expect(new Set(palette).size).toBe(53);
    for (const colour of palette) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.skipIf(!existsSync(PALETTE_PNG))('matches the opaque colours of art-source Palette.png', () => {
    const png = readPng(PALETTE_PNG);
    const fromPng = new Set<string>();
    for (let pixel = 0; pixel < png.width * png.height; pixel += 1) {
      if (png.data[pixel * 4 + 3]! > 0) fromPng.add(hex(png, pixel));
    }
    expect(new Set(readPalette())).toEqual(fromPng);
  });
});

describe('elite sprites in the manifest', () => {
  it.each(MONSTERS)('%s has elite idle/walk keys in 4 directions, same frames as the original', (monster) => {
    for (const clip of CLIPS) {
      for (const dir of DIRS) {
        const base = manifest.sprites[`${monster}.${clip}.${dir}`];
        const elite = manifest.sprites[eliteKey(monster, clip, dir)];
        expect(elite, `missing ${eliteKey(monster, clip, dir)}`).toBeDefined();
        if (base === undefined || elite === undefined) continue;
        expect(elite.sheet, `${monster} elite must use its own PNG`).not.toBe(base.sheet);
        expect({ ...elite, sheet: '' }).toEqual({ ...base, sheet: '' });
      }
    }
  });

  it('all 4 directions and both clips of one elite share one sheet', () => {
    for (const monster of MONSTERS) {
      const sheets = new Set(
        CLIPS.flatMap((clip) => DIRS.map((dir) => manifest.sprites[eliteKey(monster, clip, dir)]?.sheet)),
      );
      expect(sheets.size, monster).toBe(1);
    }
  });
});

describe('elite PNG files', () => {
  const palette = new Set(readPalette());

  it.each(MONSTERS)('%s elite PNG: same size, same alpha, every opaque pixel in the palette, recoloured', (monster) => {
    const sheet = eliteSheetOf(monster);
    const baseSheet = manifest.sprites[`${monster}.walk.down`]?.sheet;
    expect(sheet, `${monster} has no elite sheet`).toBeDefined();
    expect(baseSheet).toBeDefined();
    if (sheet === undefined || baseSheet === undefined) return;
    expect(sheet.startsWith('resources/art/'), sheet).toBe(true);

    const base = readPng(join(ASSETS, baseSheet));
    const elite = readPng(join(ASSETS, sheet));
    expect([elite.width, elite.height]).toEqual([base.width, base.height]);

    let opaque = 0;
    let changed = 0;
    const offPalette = new Set<string>();
    for (let pixel = 0; pixel < base.width * base.height; pixel += 1) {
      const alpha = base.data[pixel * 4 + 3]!;
      expect(elite.data[pixel * 4 + 3], `${sheet} alpha at pixel ${pixel}`).toBe(alpha);
      if (alpha === 0) continue;
      opaque += 1;
      const colour = hex(elite, pixel);
      if (!palette.has(colour)) offPalette.add(colour);
      if (colour !== hex(base, pixel)) changed += 1;
    }
    expect([...offPalette], `${sheet} has colours outside the palette`).toEqual([]);
    // Visibly an elite: at least a fifth of the body changes colour (outlines may stay).
    expect(changed / opaque, `${sheet} barely differs from ${baseSheet}`).toBeGreaterThanOrEqual(0.2);
  });

  it.each(MONSTERS)('%s elite PNG has a valid image .meta with a unique uuid', (monster) => {
    const sheet = eliteSheetOf(monster);
    expect(sheet).toBeDefined();
    if (sheet === undefined) return;
    const metaPath = join(ASSETS, `${sheet}.meta`);
    expect(existsSync(metaPath), `${sheet}.meta missing`).toBe(true);
    if (!existsSync(metaPath)) return;

    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
      importer?: string;
      uuid?: string;
      subMetas?: Record<string, { uuid?: string }>;
    };
    expect(meta.importer).toBe('image');
    expect(meta.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    for (const sub of Object.values(meta.subMetas ?? {})) {
      expect(sub.uuid?.startsWith(`${meta.uuid}@`), `${sheet} subMeta uuid`).toBe(true);
    }
    expect(allMetaUuids().get(meta.uuid ?? '')).toEqual([`${sheet}.meta`]);

    // Every folder between resources/art and the PNG must also be known to the asset DB.
    let dir = dirname(join(ASSETS, sheet));
    while (dir.startsWith(`${join(ASSETS, 'resources', 'art')}/`)) {
      expect(existsSync(`${dir}.meta`), `${relative(ASSETS, dir)}.meta missing`).toBe(true);
      dir = dirname(dir);
    }
  });
});

describe('elite sprite selection (core)', () => {
  it('spriteActorFor picks the elite actor prefix only for elites', async () => {
    const mod = (await import('../../assets/scripts/core/enemies/elite')) as unknown as Record<string, unknown>;
    const spriteActorFor = mod['spriteActorFor'];
    expect(typeof spriteActorFor, 'core/enemies/elite.ts must export spriteActorFor').toBe('function');
    if (typeof spriteActorFor !== 'function') return;
    const pick = spriteActorFor as (monster: string, elite: boolean) => string;
    for (const monster of MONSTERS) {
      expect(pick(monster, false)).toBe(monster);
      expect(pick(monster, true)).toBe(`${monster}.elite`);
      expect(manifest.sprites[`${pick(monster, true)}.walk.down`], monster).toBeDefined();
    }
  });

  it('elites keep the 1.15 scale', () => {
    expect(eliteScale()).toBe(1.15);
  });
});
