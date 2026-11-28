import { createHash } from 'node:crypto';
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
import {
  CHARACTER_ROSTER,
  HERO_PORTRAIT_SHEETS,
  PORTRAIT_SOURCE_SIZE_PX,
  characterPortraitKey,
  characterPortraitSheet,
} from '../../assets/scripts/core/characters/roster';
import { EVOLUTIONS } from '../../assets/scripts/core/skills/evolutions';
import { SKILLS } from '../../assets/scripts/core/skills/pool';
import { skillIconSheet } from '../../assets/scripts/core/skills/icons';
import { bottomPadding, readPng } from '../../scripts/lib/png';
import { CLASS_SKILL_ICON_IDS, PORTRAIT_IDS } from '../helpers/generated-art-ids';

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

    for (const playable of ['archer', 'mage', 'cultivator'] as const) {
      for (const anim of ['idle', 'walk', 'attack', 'hit', 'dash'] as const) {
        for (const direction of ['down', 'up', 'left', 'right'] as const) {
          expect(manifest.sprites[`${playable}.${anim}.${direction}`]).toBeDefined();
        }
      }
      expect(manifest.sprites[`${playable}.dead`]).toBeDefined();
    }

    for (const item of ['bow-hand', 'staff-hand', 'sword-back'] as const) {
      for (const direction of ['down', 'up', 'left', 'right'] as const) {
        expect(manifest.sprites[`attachment.${item}.${direction}`]).toBeDefined();
      }
    }

    for (const proj of ['fx.arrow', 'fx.arcane-bolt', 'fx.spirit-sword'] as const) {
      expect(manifest.sprites[proj]).toBeDefined();
    }

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

describe('skill & Evolution icon files (M13)', () => {
  it('every skill and Evolution icon and its Disabled variant exist as 24×24 PNGs with a valid image meta', () => {
    for (const card of [...SKILLS, ...EVOLUTIONS]) {
      for (const disabled of [false, true]) {
        const sheet = skillIconSheet(card.id, { disabled });
        const path = join(ASSETS, sheet);
        expect(existsSync(path), `${card.id} → ${sheet} does not exist`).toBe(true);
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

describe('M16 FX slicing audit (no mid-frame rectangular cuts)', () => {
  it('fx.explosion matches the 360×40 sheet as 9 square 40×40 frames at 14 fps', () => {
    const entry = manifest.sprites['fx.explosion'];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(entry.frameWidth).toBe(40);
    expect(entry.frameHeight).toBe(40);
    expect(entry.frames).toBe(9);
    expect(entry.fps).toBe(14);
    expect(entry.loop).toBe(false);
    const png = readPng(sheetPath(entry));
    expect([png.width, png.height]).toEqual([360, 40]);
  });

  it('audited FX strips have zero inter-frame art cuts across frame boundaries', () => {
    // Full-cell-width tiles/rings (`fx.ripple`, `fx.shield`, `fx.smoke-circular`, `fx.coin`,
    // `fx.big-energy-ball`, `fx.plant-spike`, `fx.big-shuriken`, `fx.rain-splash`,
    // `fx.arcane-bolt`, `fx.spirit-sword`) legitimately touch their cell borders on peak frames.
    // Every other multi-frame FX strip must have clean transparent boundaries between frames.
    const EDGE_TOUCHING_FX: ReadonlySet<string> = new Set([
      'fx.ripple',
      'fx.shield',
      'fx.smoke-circular',
      'fx.coin',
      'fx.big-energy-ball',
      'fx.plant-spike',
      'fx.big-shuriken',
      'fx.rain-splash',
      'fx.arcane-bolt',
      'fx.spirit-sword',
    ]);

    for (const [key, entry] of entries) {
      if (!key.startsWith('fx.') || entry.frames <= 1 || EDGE_TOUCHING_FX.has(key)) continue;
      const png = readPng(sheetPath(entry));
      for (let frame = 1; frame < entry.frames; frame += 1) {
        const boundaryX = frame * entry.frameWidth;
        let sharedOpaqueRows = 0;
        for (let y = 0; y < png.height; y += 1) {
          const leftAlpha = png.data[(y * png.width + (boundaryX - 1)) * 4 + 3]!;
          const rightAlpha = png.data[(y * png.width + boundaryX) * 4 + 3]!;
          if (leftAlpha > 0 && rightAlpha > 0) sharedOpaqueRows += 1;
        }
        expect(
          sharedOpaqueRows,
          `${key} slices through ${sharedOpaqueRows} opaque row(s) at x=${boundaryX} (frameWidth=${entry.frameWidth})`,
        ).toBe(0);
      }
    }
  });

  it('audited M16 FX entries match their verified frame geometry', () => {
    const expected: ReadonlyArray<readonly [string, number, number, number]> = [
      ['fx.explosion', 40, 40, 9],
      ['fx.shuriken', 69, 54, 10],
      ['fx.impact', 27, 35, 10],
      ['fx.ice', 32, 32, 10],
      ['fx.poison', 30, 28, 8],
      ['fx.smoke-circular', 30, 14, 8],
    ];
    for (const [key, fw, fh, frames] of expected) {
      const entry = manifest.sprites[key];
      expect(entry, `${key} missing`).toBeDefined();
      expect([entry?.frameWidth, entry?.frameHeight, entry?.frames], key).toEqual([fw, fh, frames]);
    }
  });
});

describe('M19 hero/NPC portraits & class skill icons (ADR-027)', () => {
  it('resolves all 4 hero portrait keys + 2 NPC portrait keys as 64×64 nearest-filtered PNGs matching roster helpers', () => {
    expect(PORTRAIT_IDS).toEqual([
      'ninja',
      'archer',
      'mage',
      'cultivator',
      'shopkeeper',
      'dojo-master',
    ]);

    for (const char of CHARACTER_ROSTER) {
      expect(char.portraitKey).toBe(characterPortraitKey(char.id));
      const entry = manifest.sprites[char.portraitKey];
      expect(entry, `${char.id} missing ${char.portraitKey}`).toBeDefined();
      expect(entry?.sheet).toBe(HERO_PORTRAIT_SHEETS[char.id]);
      expect(characterPortraitSheet(char.id, manifest)).toBe(HERO_PORTRAIT_SHEETS[char.id]);
      expect(characterPortraitSheet(char.id, null)).toBe(HERO_PORTRAIT_SHEETS[char.id]);
    }

    for (const id of PORTRAIT_IDS) {
      const key = `icon.portrait-${id}`;
      const entry = manifest.sprites[key];
      expect(entry, `${key} missing from animations.json`).toBeDefined();
      if (entry === undefined) continue;

      const fullPath = sheetPath(entry);
      expect(existsSync(fullPath), `${key} → ${entry.sheet} missing`).toBe(true);
      const png = readPng(fullPath);
      expect([png.width, png.height], key).toEqual([
        PORTRAIT_SOURCE_SIZE_PX,
        PORTRAIT_SOURCE_SIZE_PX,
      ]);

      const meta = JSON.parse(readFileSync(`${fullPath}.meta`, 'utf8')) as {
        importer?: string;
        subMetas?: Record<string, { userData?: Record<string, unknown> }>;
      };
      expect(meta.importer, `${key} .meta importer`).toBe('image');
      expect(meta.subMetas?.['6c48a']?.userData?.['minfilter'], `${key} minfilter`).toBe('nearest');
      expect(meta.subMetas?.['6c48a']?.userData?.['magfilter'], `${key} magfilter`).toBe('nearest');
    }
  });

  it('gives all 21 shared skills + 7 Evolutions + 20 class skills (48 active icons + 48 disabled) unique 24×24 pixel art', () => {
    expect(SKILLS).toHaveLength(21);
    expect(EVOLUTIONS).toHaveLength(7);
    expect(CLASS_SKILL_ICON_IDS).toHaveLength(20);

    const activeHashes = new Map<string, string>();

    for (const card of [...SKILLS, ...EVOLUTIONS]) {
      const sheet = skillIconSheet(card.id);
      const png = readPng(join(ASSETS, sheet));
      const hash = createHash('sha256').update(png.data).digest('hex');
      const duplicate = activeHashes.get(hash);
      expect(duplicate, `${card.id} duplicates icon pixels of ${duplicate}`).toBeUndefined();
      activeHashes.set(hash, card.id);
    }

    for (const id of CLASS_SKILL_ICON_IDS) {
      for (const suffix of ['', '-disabled'] as const) {
        const key = `icon.${id}${suffix}`;
        const entry = manifest.sprites[key];
        expect(entry, `${key} missing from manifest`).toBeDefined();
        if (entry === undefined) continue;
        const fullPath = sheetPath(entry);
        expect(existsSync(fullPath), `${key} missing on disk`).toBe(true);
        const png = readPng(fullPath);
        expect([png.width, png.height], key).toEqual([24, 24]);

        const meta = JSON.parse(readFileSync(`${fullPath}.meta`, 'utf8')) as {
          importer?: string;
          subMetas?: Record<string, { userData?: Record<string, unknown> }>;
        };
        expect(meta.importer).toBe('image');
        expect(meta.subMetas?.['6c48a']?.userData?.['minfilter']).toBe('nearest');
        expect(meta.subMetas?.['6c48a']?.userData?.['magfilter']).toBe('nearest');

        if (suffix === '') {
          const hash = createHash('sha256').update(png.data).digest('hex');
          const duplicate = activeHashes.get(hash);
          expect(duplicate, `class icon ${id} duplicates icon pixels of ${duplicate}`).toBeUndefined();
          activeHashes.set(hash, id);
        }
      }
    }

    expect(activeHashes.size).toBe(48);
  });
});
