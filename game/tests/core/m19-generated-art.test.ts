import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../assets/scripts/core/art/manifest';
import { CLASS_SKILL_ICON_IDS, PORTRAIT_IDS } from '../../scripts/stage-m19-art';
import { readPng, type PngImage } from '../../scripts/lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '../..');
const ASSETS = join(PROJECT, 'assets');
const MANIFEST_PATH = join(ASSETS, 'resources', 'data', 'animations.json');
const GENERATED_CONFIG_PATH = join(PROJECT, 'config', 'generated-art.json');

const manifest = validateManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown);

function resolvePackDir(): string | null {
  const candidates = [join(PROJECT, '..', 'art-source', 'ninja-adventure')];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: PROJECT,
      encoding: 'utf8',
    }).trim();
    candidates.push(join(dirname(resolve(PROJECT, common)), 'art-source', 'ninja-adventure'));
  } catch {
    // Fallback to relative candidate.
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** `art-source/` is gitignored (not in CI), so palette checks only run where the pack exists. */
const PACK_AVAILABLE = resolvePackDir() !== null;

function loadPalette(): ReadonlySet<string> {
  const packDir = resolvePackDir();
  if (packDir === null) return new Set();
  const pal = readPng(join(packDir, 'Palette.png'));
  const set = new Set<string>();
  for (let i = 0; i < pal.data.length; i += 4) {
    if (pal.data[i + 3]! > 0) {
      set.add(
        `#${pal.data[i]!.toString(16).padStart(2, '0')}${pal.data[i + 1]!.toString(16).padStart(2, '0')}${pal.data[i + 2]!.toString(16).padStart(2, '0')}`,
      );
    }
  }
  return set;
}

function expectNearestSpriteMeta(pngPath: string, width: number, height: number): void {
  const metaPath = `${pngPath}.meta`;
  expect(existsSync(metaPath), `${metaPath} missing`).toBe(true);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
    importer?: string;
    uuid?: string;
    subMetas?: Record<string, { userData?: Record<string, unknown> }>;
  };
  expect(meta.importer).toBe('image');
  expect(typeof meta.uuid).toBe('string');
  expect(meta.subMetas?.['6c48a']?.userData?.['minfilter']).toBe('nearest');
  expect(meta.subMetas?.['6c48a']?.userData?.['magfilter']).toBe('nearest');
  expect(meta.subMetas?.['f9941']?.userData?.['width']).toBe(width);
  expect(meta.subMetas?.['f9941']?.userData?.['height']).toBe(height);
}

function expectBinaryPaletteArt(img: PngImage, label: string, palette: ReadonlySet<string>): number {
  let opaque = 0;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const i = (y * img.width + x) * 4;
      const a = img.data[i + 3]!;
      if (a === 0) continue;
      expect(a, `${label} (${x},${y}) alpha must be binary`).toBe(255);
      const hex = `#${img.data[i]!.toString(16).padStart(2, '0')}${img.data[i + 1]!.toString(16).padStart(2, '0')}${img.data[i + 2]!.toString(16).padStart(2, '0')}`;
      expect(hex, `${label} (${x},${y}) magenta leak`).not.toBe('#ff00ff');
      expect(palette.has(hex), `${label} (${x},${y}) color ${hex} not in 53-color Palette.png`).toBe(true);
      opaque += 1;
    }
  }
  expect(opaque, `${label} must have opaque pixels`).toBeGreaterThan(0);
  return opaque;
}

describe.skipIf(!PACK_AVAILABLE)('M17 & M19 generated pixel-art asset batch', () => {
  const palette = loadPalette();

  it('registers generated icon and vfx prefixes and directory .meta files', () => {
    expect(palette.size).toBe(53);
    const cfg = JSON.parse(readFileSync(GENERATED_CONFIG_PATH, 'utf8')) as {
      icons?: string[];
      vfx?: string[];
    };
    expect(cfg.icons).toContain('icon');
    expect(cfg.vfx).toContain('fx');

    for (const dirRel of [
      'resources/art/generated.meta',
      'resources/art/generated/portraits.meta',
      'resources/art/generated/icons.meta',
      'resources/art/generated/icons/class-skills.meta',
      'resources/art/generated/fx.meta',
    ]) {
      const full = join(ASSETS, dirRel);
      expect(existsSync(full), `${dirRel} missing`).toBe(true);
      const meta = JSON.parse(readFileSync(full, 'utf8')) as { importer?: string };
      expect(meta.importer).toBe('directory');
    }
  });

  it('stages all 6 character & NPC 64×64 portraits with nearest .meta, 53-color palette, and manifest keys', () => {
    expect(PORTRAIT_IDS).toEqual([
      'ninja',
      'archer',
      'mage',
      'cultivator',
      'shopkeeper',
      'dojo-master',
    ]);
    for (const id of PORTRAIT_IDS) {
      const key = `icon.portrait-${id}`;
      const entry = manifest.sprites[key];
      expect(entry, `${key} missing from animations.json`).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.sheet).toBe(`resources/art/generated/portraits/portrait-${id}.png`);
      expect([entry.frameWidth, entry.frameHeight]).toEqual([64, 64]);
      expect(entry.frames).toBe(1);
      expect(entry.anchor).toBe('center');
      expect(entry.footPx).toBe(32);

      const full = join(ASSETS, entry.sheet);
      expect(existsSync(full), entry.sheet).toBe(true);
      expectNearestSpriteMeta(full, 64, 64);
      const png = readPng(full);
      expect([png.width, png.height]).toEqual([64, 64]);
      const opaque = expectBinaryPaletteArt(png, entry.sheet, palette);
      expect(opaque).toBeGreaterThan(800);
    }
  });

  it('stages all 20 class skill 24×24 icons + 20 Disabled variants with unique silhouettes and 53-color palette', () => {
    expect(CLASS_SKILL_ICON_IDS).toHaveLength(20);
    const activeHashes = new Map<string, string>();

    for (const id of CLASS_SKILL_ICON_IDS) {
      const activeKey = `icon.${id}`;
      const disabledKey = `icon.${id}-disabled`;
      const activeEntry = manifest.sprites[activeKey];
      const disabledEntry = manifest.sprites[disabledKey];
      expect(activeEntry, `${activeKey} missing`).toBeDefined();
      expect(disabledEntry, `${disabledKey} missing`).toBeDefined();
      if (activeEntry === undefined || disabledEntry === undefined) continue;

      expect(activeEntry.sheet).toBe(`resources/art/generated/icons/class-skills/${id}.png`);
      expect(disabledEntry.sheet).toBe(`resources/art/generated/icons/class-skills/${id}-disabled.png`);

      const activePath = join(ASSETS, activeEntry.sheet);
      const disabledPath = join(ASSETS, disabledEntry.sheet);
      expectNearestSpriteMeta(activePath, 24, 24);
      expectNearestSpriteMeta(disabledPath, 24, 24);

      const activePng = readPng(activePath);
      const disabledPng = readPng(disabledPath);
      expect([activePng.width, activePng.height]).toEqual([24, 24]);
      expect([disabledPng.width, disabledPng.height]).toEqual([24, 24]);

      const activeOpaque = expectBinaryPaletteArt(activePng, activeEntry.sheet, palette);
      const disabledOpaque = expectBinaryPaletteArt(disabledPng, disabledEntry.sheet, palette);
      expect(disabledOpaque, `${id} disabled must preserve active silhouette pixel count`).toBe(activeOpaque);

      // Active and Disabled must not be byte-identical (active is colored, disabled is stone-gray).
      const activeHash = createHash('sha256').update(activePng.data).digest('hex');
      const disabledHash = createHash('sha256').update(disabledPng.data).digest('hex');
      expect(activeHash).not.toBe(disabledHash);

      const duplicateOf = activeHashes.get(activeHash);
      expect(duplicateOf, `${id} has duplicate pixels with ${duplicateOf}`).toBeUndefined();
      activeHashes.set(activeHash, id);
    }
  });

  it('stages all 8 M17/M19 VFX & pickup sheets with non-empty frames and zero inter-frame boundary clipping', () => {
    const expectedVfx: ReadonlyArray<{
      readonly key: string;
      readonly sheet: string;
      readonly fw: number;
      readonly fh: number;
      readonly frames: number;
      readonly loop: boolean;
    }> = [
      {
        key: 'fx.portal-gate',
        sheet: 'resources/art/generated/fx/portal-gate.png',
        fw: 48,
        fh: 48,
        frames: 4,
        loop: true,
      },
      {
        key: 'fx.health-potion',
        sheet: 'resources/art/generated/fx/health-potion.png',
        fw: 16,
        fh: 16,
        frames: 1,
        loop: true,
      },
      {
        key: 'fx.orbit-sword',
        sheet: 'resources/art/generated/fx/orbit-sword.png',
        fw: 16,
        fh: 16,
        frames: 4,
        loop: true,
      },
      {
        key: 'fx.sword-array',
        sheet: 'resources/art/generated/fx/sword-array.png',
        fw: 32,
        fh: 32,
        frames: 4,
        loop: true,
      },
      {
        key: 'fx.meteor',
        sheet: 'resources/art/generated/fx/meteor.png',
        fw: 32,
        fh: 32,
        frames: 4,
        loop: false,
      },
      {
        key: 'fx.frost-orb',
        sheet: 'resources/art/generated/fx/frost-orb.png',
        fw: 16,
        fh: 16,
        frames: 4,
        loop: true,
      },
      {
        key: 'fx.arrow-rain',
        sheet: 'resources/art/generated/fx/arrow-rain.png',
        fw: 32,
        fh: 32,
        frames: 4,
        loop: false,
      },
      {
        key: 'fx.sword-qi',
        sheet: 'resources/art/generated/fx/sword-qi.png',
        fw: 32,
        fh: 32,
        frames: 4,
        loop: true,
      },
    ];

    for (const spec of expectedVfx) {
      const entry = manifest.sprites[spec.key];
      expect(entry, `${spec.key} missing`).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.sheet).toBe(spec.sheet);
      expect([entry.frameWidth, entry.frameHeight]).toEqual([spec.fw, spec.fh]);
      expect(entry.layout).toBe('strip');
      expect(entry.directions).toEqual([]);
      expect(entry.frames).toBe(spec.frames);
      expect(entry.loop).toBe(spec.loop);
      expect(entry.anchor).toBe('center');
      expect(entry.footPx).toBe(Math.floor(spec.fh / 2));

      const full = join(ASSETS, entry.sheet);
      expectNearestSpriteMeta(full, spec.fw * spec.frames, spec.fh);
      const png = readPng(full);
      expect([png.width, png.height]).toEqual([spec.fw * spec.frames, spec.fh]);
      expectBinaryPaletteArt(png, spec.sheet, palette);

      for (let f = 0; f < spec.frames; f += 1) {
        let frameOpaque = 0;
        for (let y = 0; y < spec.fh; y += 1) {
          for (let lx = 0; lx < spec.fw; lx += 1) {
            if (png.data[(y * png.width + f * spec.fw + lx) * 4 + 3]! > 0) {
              frameOpaque += 1;
            }
          }
        }
        expect(frameOpaque, `${spec.key} frame ${f} must not be empty`).toBeGreaterThan(0);
      }

      for (let f = 1; f < spec.frames; f += 1) {
        const rightEdge = f * spec.fw - 1;
        const leftEdge = f * spec.fw;
        for (let y = 0; y < spec.fh; y += 1) {
          const prevOpaque = png.data[(y * png.width + rightEdge) * 4 + 3]! > 0;
          const nextOpaque = png.data[(y * png.width + leftEdge) * 4 + 3]! > 0;
          expect(
            prevOpaque && nextOpaque,
            `${spec.key} clips across frame boundary ${f - 1}|${f} at y=${y}`,
          ).toBe(false);
        }
      }
    }
  });
});
