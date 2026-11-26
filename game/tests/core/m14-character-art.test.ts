import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AttachmentNodeController } from '../../assets/scripts/core/art/attachment-node';
import { placeAttachment, validateAttachments } from '../../assets/scripts/core/art/attachments';
import { DIRECTIONS, validateManifest } from '../../assets/scripts/core/art/manifest';
import { entryAnchorY } from '../../assets/scripts/core/art/runtime';
import { frameBob } from '../../scripts/lib/gemini-art';
import { readPng } from '../../scripts/lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '../..');
const ASSETS = join(PROJECT, 'assets');
const MANIFEST_PATH = join(ASSETS, 'resources', 'data', 'animations.json');
const ATTACHMENTS_PATH = join(ASSETS, 'resources', 'data', 'attachments.json');

const manifest = validateManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown);
const attachments = validateAttachments(JSON.parse(readFileSync(ATTACHMENTS_PATH, 'utf8')) as unknown);

function resolvePackDir(): string {
  const candidates = [join(PROJECT, '..', 'art-source', 'ninja-adventure')];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: PROJECT,
      encoding: 'utf8',
    }).trim();
    candidates.push(join(dirname(resolve(PROJECT, common)), 'art-source', 'ninja-adventure'));
  } catch {
    // Fallback to relative path.
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) throw new Error('missing ninja-adventure art-source');
  return found;
}

function loadPalette(): ReadonlySet<string> {
  const pal = readPng(join(resolvePackDir(), 'Palette.png'));
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

function expectNearestMeta(pngPath: string): void {
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
}

describe('M14 character animations, weapon attachments, and class projectiles', () => {
  it('stages full 6-clip animation sets for archer, mage, and cultivator with nearest .meta', () => {
    for (const actor of ['archer', 'mage', 'cultivator'] as const) {
      for (const anim of ['idle', 'walk', 'attack', 'hit', 'dash'] as const) {
        for (const dir of DIRECTIONS) {
          const key = `${actor}.${anim}.${dir}`;
          const entry = manifest.sprites[key];
          expect(entry, `${key} missing`).toBeDefined();
          if (entry === undefined) continue;
          expect([entry.frameWidth, entry.frameHeight]).toEqual([16, 16]);
          expect(entry.layout).toBe('grid');
          expect(entry.directions).toEqual([...DIRECTIONS]);
          expect(entry.anchor).toBe('feet');
          const file = join(ASSETS, entry.sheet);
          expect(existsSync(file), entry.sheet).toBe(true);
          expectNearestMeta(file);
        }
      }
      const deadKey = `${actor}.dead`;
      const dead = manifest.sprites[deadKey];
      expect(dead, `${deadKey} missing`).toBeDefined();
      if (dead !== undefined) {
        expect(dead.directions).toEqual([]);
        expect(dead.loop).toBe(false);
        expect(dead.anchor).toBe('feet');
        expectNearestMeta(join(ASSETS, dead.sheet));
      }
    }
  });

  it('uses strictly binary alpha and exact 53-color Palette.png on generated cultivator, attachment, and projectile sheets', () => {
    const palette = loadPalette();
    expect(palette.size).toBe(53);

    const generatedSheets = [
      'resources/art/generated/cultivator/walk.png',
      'resources/art/generated/cultivator/attack.png',
      'resources/art/generated/cultivator/hit.png',
      'resources/art/generated/cultivator/dash.png',
      'resources/art/generated/cultivator/dead.png',
      'resources/art/generated/attachment/bow-hand.png',
      'resources/art/generated/attachment/staff-hand.png',
      'resources/art/fx/arcane-bolt/ArcaneBolt.png',
      'resources/art/fx/spirit-sword/SpiritSword.png',
    ] as const;

    for (const rel of generatedSheets) {
      const full = join(ASSETS, rel);
      expect(existsSync(full), rel).toBe(true);
      expectNearestMeta(full);
      const img = readPng(full);
      let opaque = 0;
      for (let y = 0; y < img.height; y += 1) {
        for (let x = 0; x < img.width; x += 1) {
          const i = (y * img.width + x) * 4;
          const a = img.data[i + 3]!;
          if (a === 0) continue;
          expect(a, `${rel} (${x},${y}) alpha`).toBe(255);
          const hex = `#${img.data[i]!.toString(16).padStart(2, '0')}${img.data[i + 1]!.toString(16).padStart(2, '0')}${img.data[i + 2]!.toString(16).padStart(2, '0')}`;
          expect(palette.has(hex), `${rel} (${x},${y}) color ${hex} not in Palette.png`).toBe(true);
          opaque += 1;
        }
      }
      expect(opaque, `${rel} has opaque pixels`).toBeGreaterThan(0);
    }
  });

  it('stages pointed class projectiles (fx.arrow, fx.arcane-bolt, fx.spirit-sword) oriented +X with center anchor', () => {
    for (const key of ['fx.arrow', 'fx.arcane-bolt', 'fx.spirit-sword'] as const) {
      const entry = manifest.sprites[key];
      expect(entry, `${key} missing`).toBeDefined();
      if (entry === undefined) continue;
      expect(entry.anchor).toBe('center');
      expect(entry.layout).toBe('strip');
      expect(entry.directions).toEqual([]);
      expect(entry.frameWidth).toBeGreaterThan(entry.frameHeight);
      const file = join(ASSETS, entry.sheet);
      expect(existsSync(file), entry.sheet).toBe(true);
      expectNearestMeta(file);
    }
  });

  it('records accurate measured per-frame bob and hand/back attach placements for archer, mage, and cultivator', () => {
    for (const actor of ['archer', 'mage', 'cultivator'] as const) {
      const rig = attachments.characters[actor];
      expect(rig, `missing rig ${actor}`).toBeDefined();
      if (rig === undefined) continue;
      expect(rig.frameWidth).toBe(16);
      expect(rig.frameHeight).toBe(16);
      expect(rig.points.hand).toBeDefined();
      expect(rig.points.back).toBeDefined();

      for (const anim of ['idle', 'walk', 'attack', 'hit', 'dash'] as const) {
        const entry = manifest.sprites[`${actor}.${anim}.down`]!;
        const png = readPng(join(ASSETS, entry.sheet));
        const measured = frameBob(png, 4, entry.frames, 16, 16);
        for (let i = 0; i < DIRECTIONS.length; i += 1) {
          const dir = DIRECTIONS[i]!;
          expect(rig.bob[anim]?.[dir], `${actor}.bob.${anim}.${dir}`).toEqual(measured[i]);
        }
      }
    }

    // Verify draw order & placement across all 4 directions and clips.
    const pairs = [
      { char: 'archer', item: 'bow-hand', hand: true },
      { char: 'mage', item: 'staff-hand', hand: true },
      { char: 'cultivator', item: 'sword-back', hand: false },
    ] as const;

    for (const { char, item, hand } of pairs) {
      const bodyEntry = manifest.sprites[`${char}.idle.down`]!;
      const itemEntry = manifest.sprites[`attachment.${item}.down`]!;
      const ctrl = new AttachmentNodeController(attachments, {
        character: char,
        item,
        weaponForm: 'attachment',
        bodyAnchorY: entryAnchorY(bodyEntry),
        itemAnchorY: entryAnchorY(itemEntry),
      });
      for (const anim of ['idle', 'walk', 'attack', 'hit', 'dash'] as const) {
        const frames = manifest.sprites[`${char}.${anim}.down`]!.frames;
        for (const direction of DIRECTIONS) {
          for (let frame = 0; frame < frames; frame += 1) {
            const p = placeAttachment(attachments, { character: char, item, animation: anim, direction, frame });
            expect(p.behind).toBe(hand ? direction === 'up' : direction !== 'up');
            const state = ctrl.update({ animation: anim, direction, frame });
            expect(state.active).toBe(true);
            expect(state.spriteKey).toBe(`attachment.${item}.${direction}`);
            expect(state.behind).toBe(p.behind);
          }
        }
      }
    }
  });

  it('has valid JSON and globally unique UUIDs across all .meta files under game/assets', () => {
    const seen = new Map<string, string>();
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (name.endsWith('.meta')) {
          const parsed = JSON.parse(readFileSync(full, 'utf8')) as { uuid?: unknown };
          expect(typeof parsed.uuid, relative(ASSETS, full)).toBe('string');
          const uuid = parsed.uuid as string;
          const prev = seen.get(uuid);
          expect(prev, `duplicate uuid ${uuid} in ${relative(ASSETS, full)} and ${prev}`).toBeUndefined();
          seen.set(uuid, relative(ASSETS, full));
        }
      }
    };
    walk(ASSETS);
    expect(seen.size).toBeGreaterThanOrEqual(680);
  });
});
