import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_ACTOR_ANIMATIONS,
  frameColumns,
  frameRows,
  validateManifest,
  type AnimationManifest,
  type SpriteEntry,
} from '../../assets/scripts/core/art/manifest';
import { entryAnchorY } from '../../assets/scripts/core/art/runtime';
import { BOSSES, BOSS_IDS } from '../../assets/scripts/core/boss/boss-defs';
import { SKILLS } from '../../assets/scripts/core/skills/pool';
import { skillIconSheet } from '../../assets/scripts/core/skills/icons';
import { bottomPadding, readPng } from '../../scripts/lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', 'assets');
const MANIFEST_PATH = join(ASSETS, 'resources', 'data', 'animations.json');

/** Generated prefix allowlists written by staging (`config/generated-art.json`). */
const GENERATED = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'config', 'generated-art.json'), 'utf8'),
) as {
  readonly icons?: readonly string[];
  readonly ui?: readonly string[];
  readonly attachments?: readonly string[];
  readonly vfx?: readonly string[];
  readonly particles?: readonly string[];
};
/**
 * Prefixes whose entries anchor at the centre: pack FX, plus the generated kinds staging
 * fits around their centre (icons, UI images, attachments, VFX and particles).
 */
const CENTRE_PREFIXES: ReadonlySet<string> = new Set([
  'fx',
  ...(GENERATED.icons ?? []),
  ...(GENERATED.ui ?? []),
  ...(GENERATED.attachments ?? []),
  ...(GENERATED.vfx ?? []),
  ...(GENERATED.particles ?? []),
]);

const manifest: AnimationManifest = validateManifest(
  JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown,
);
const entries = Object.entries(manifest.sprites) as [string, SpriteEntry][];

function sheetPath(entry: SpriteEntry): string {
  return join(ASSETS, entry.sheet);
}

function actorOf(key: string): string {
  return key.split('.')[0] ?? '';
}

describe('the manifest points at real files', () => {
  it('every sheet exists on disk', () => {
    for (const [key, entry] of entries) {
      expect(existsSync(sheetPath(entry)), `${key} → ${entry.sheet} does not exist`).toBe(true);
    }
  });

  it('the frame grid divides the real sheet size', () => {
    const sizes = new Map<string, { width: number; height: number }>();
    for (const [key, entry] of entries) {
      let size = sizes.get(entry.sheet);
      if (size === undefined) {
        const png = readPng(sheetPath(entry));
        size = { width: png.width, height: png.height };
        sizes.set(entry.sheet, size);
      }

      expect(size.width, `${key}: sheet ${size.width}px is not divisible by ${frameColumns(entry)} column(s)`).toBe(
        entry.frameWidth * frameColumns(entry),
      );
      expect(size.height, `${key}: sheet ${size.height}px is not divisible by ${frameRows(entry)} row(s)`).toBe(
        entry.frameHeight * frameRows(entry),
      );
    }
  });

  it('the image has solid pixels in at least the first frame (not an empty file)', () => {
    const checked = new Set<string>();
    for (const entry of Object.values(manifest.sprites)) {
      if (checked.has(entry.sheet)) continue;
      checked.add(entry.sheet);
      const png = readPng(sheetPath(entry));
      let opaque = 0;
      for (let index = 3; index < png.data.length; index += 4) {
        if (png.data[index]! > 0) opaque += 1;
      }
      expect(opaque, entry.sheet).toBeGreaterThan(0);
    }
  });
});

describe('feet pivot', () => {
  it('anchors actors at the feet and centre-anchored kinds at the frame centre', () => {
    const padding = new Map<string, number>();
    for (const [key, entry] of entries) {
      const actor = actorOf(key);
      expect(entry.anchor, `${key} anchor`).toBe(CENTRE_PREFIXES.has(actor) ? 'center' : 'feet');

      let computed = padding.get(entry.sheet);
      if (computed === undefined) {
        computed = bottomPadding(readPng(sheetPath(entry)));
        padding.set(entry.sheet, computed);
      }
      if (entry.anchor === 'feet') {
        expect(entry.footPx, `${key} footPx must equal the bottom solid pixel of ${entry.sheet}`).toBe(computed);
      } else {
        expect(entry.footPx, `${key} FX anchors at the centre`).toBe(Math.floor(entry.frameHeight / 2));
      }

      const ratio = entryAnchorY(entry);
      expect(ratio, `${key} anchorY`).toBeGreaterThanOrEqual(0);
      expect(ratio, `${key} anchorY`).toBeLessThan(1);
    }
  });

  it('same actor, different anchorY, but the feet always stay on the node (world foot = 0)', () => {
    // footY inside the frame = footPx; after subtracting anchorY*frameHeight it must be 0.
    for (const [key, entry] of entries) {
      if (entry.anchor !== 'feet') continue;
      const footInFrame = entry.footPx;
      const afterAnchor = footInFrame - entryAnchorY(entry) * entry.frameHeight;
      expect(Math.abs(afterAnchor), `${key} foot is off by ${afterAnchor}px`).toBeLessThan(1e-9);
    }
  });

  it('boss frames change size within an animation (samurai) yet still pivot at the feet', () => {
    const idle = manifest.sprites['samurai.idle'];
    const attack = manifest.sprites['samurai.attack.left'];
    if (idle === undefined || attack === undefined) throw new Error('missing samurai');

    expect(idle.frameHeight).not.toBe(attack.frameHeight);
    expect(idle.anchor).toBe('feet');
    expect(attack.anchor).toBe('feet');
    expect(entryAnchorY(idle)).not.toBe(entryAnchorY(attack));
  });
});

describe('required animation set per role', () => {
  it('every key in the required table resolves', () => {
    for (const [actor, keys] of Object.entries(REQUIRED_ACTOR_ANIMATIONS)) {
      expect(keys.length, `${actor} must have animations`).toBeGreaterThan(0);
      for (const key of keys) {
        expect(manifest.sprites[key], `${actor} is missing ${key}`).toBeDefined();
      }
    }
  });

  it('player has idle/walk/hit/dead; monsters have idle/walk; bosses have attacks/death', () => {
    for (const anim of ['idle', 'walk', 'hit']) {
      for (const direction of ['down', 'up', 'left', 'right'] as const) {
        expect(manifest.sprites[`player.${anim}.${direction}`]).toBeDefined();
      }
    }
    expect(manifest.sprites['player.dead']).toBeDefined();

    for (const actor of ['bluebat', 'spiderred', 'snake3', 'eye', 'greenoctopus', 'lanternred', 'bear', 'trex', 'cyclope']) {
      for (const direction of ['down', 'up', 'left', 'right'] as const) {
        expect(manifest.sprites[`${actor}.idle.${direction}`]).toBeDefined();
        expect(manifest.sprites[`${actor}.walk.${direction}`]).toBeDefined();
      }
    }

    for (const key of [
      'tengu.attack',
      'tengu.trans',
      'tengu.hit',
      'squid.attack-loop',
      'squid.shoot',
      'squid.hit',
      'samurai.attack.left',
      'samurai.attack.right',
      'samurai.charge.left',
      'samurai.charge.right',
      'samurai.hit',
    ]) {
      expect(manifest.sprites[key], key).toBeDefined();
    }
  });

  it('FX use the right loop kind: shield loops, impact/explosion play once', () => {
    expect(manifest.sprites['fx.shield']?.loop).toBe(true);
    for (const key of ['fx.impact', 'fx.explosion', 'fx.smoke', 'fx.ice', 'fx.poison']) {
      expect(manifest.sprites[key]?.loop, key).toBe(false);
    }
    for (const key of ['fx.shuriken', 'fx.energy-ball']) {
      expect(manifest.sprites[key]?.loop, key).toBe(true);
    }
  });
});

describe('boss sprite size declared in core', () => {
  it('spriteExtentTiles covers every solid pixel of every boss frame (feet anchor)', () => {
    for (const id of BOSS_IDS) {
      const declared = BOSSES[id].spriteExtentTiles;
      const measured = { left: 0, right: 0, up: 0 };
      for (const key of BOSSES[id].animations) {
        const entry = manifest.sprites[key];
        expect(entry, `${id}: missing ${key} in the manifest`).toBeDefined();
        if (entry === undefined) continue;
        const png = readPng(sheetPath(entry));
        const feetRow = entry.frameHeight * (1 - entryAnchorY(entry));
        for (let y = 0; y < png.height; y += 1) {
          for (let x = 0; x < png.width; x += 1) {
            if (png.data[(y * png.width + x) * 4 + 3] === 0) continue;
            const localX = x % entry.frameWidth;
            const localY = y % entry.frameHeight;
            measured.left = Math.max(measured.left, (entry.frameWidth / 2 - localX) / 16);
            measured.right = Math.max(measured.right, (localX + 1 - entry.frameWidth / 2) / 16);
            measured.up = Math.max(measured.up, (feetRow - localY) / 16);
          }
        }
      }
      expect(declared.left, `${id}.left`).toBeGreaterThanOrEqual(measured.left);
      expect(declared.right, `${id}.right`).toBeGreaterThanOrEqual(measured.right);
      expect(declared.up, `${id}.up`).toBeGreaterThanOrEqual(measured.up);
    }
  });
});

describe('skill icon files (#5)', () => {
  it('every skill icon and its Disabled variant exist as 24×24 PNGs with a valid image meta', () => {
    for (const skill of SKILLS) {
      for (const disabled of [false, true]) {
        const sheet = skillIconSheet(skill.id, { disabled });
        const path = join(ASSETS, sheet);
        expect(existsSync(path), `${skill.id} → ${sheet} does not exist`).toBe(true);
        const png = readPng(path);
        expect([png.width, png.height], sheet).toEqual([24, 24]);
        expect(existsSync(`${path}.meta`), `${sheet}.meta missing`).toBe(true);
        const meta = JSON.parse(readFileSync(`${path}.meta`, 'utf8')) as { importer?: string };
        expect(meta.importer, `${sheet}.meta importer`).toBe('image');
      }
    }
  });
});

describe('M11 weather particle & campfire art files (ADR-019)', () => {
  const WEATHER_KEYS = [
    'fx.leaf',
    'fx.leaf-pink',
    'fx.cloud-shadow',
    'fx.rain',
    'fx.rain-splash',
    'fx.ash',
    'fx.sand',
    'fx.ripple',
    'decor.campfire',
  ] as const;

  it('every weather particle and campfire sheet has a valid nearest-filtered image .meta and no legacy overlays remain', () => {
    expect(manifest.sprites['fx.raylight']).toBeUndefined();
    expect(manifest.sprites['fx.fog']).toBeUndefined();
    expect(existsSync(join(ASSETS, 'resources/art/atmosphere.meta'))).toBe(true);

    for (const key of WEATHER_KEYS) {
      const entry = manifest.sprites[key];
      expect(entry, `${key} missing from manifest`).toBeDefined();
      if (entry === undefined) continue;
      const path = sheetPath(entry);
      expect(existsSync(`${path}.meta`), `${entry.sheet}.meta missing`).toBe(true);
      const meta = JSON.parse(readFileSync(`${path}.meta`, 'utf8')) as {
        importer?: string;
        subMetas?: Record<string, { userData?: Record<string, unknown> }>;
      };
      expect(meta.importer, `${entry.sheet}.meta importer`).toBe('image');
      expect(meta.subMetas?.['6c48a']?.userData?.['minfilter'], `${key} minfilter`).toBe('nearest');
      expect(meta.subMetas?.['6c48a']?.userData?.['magfilter'], `${key} magfilter`).toBe('nearest');
    }
  });
});
