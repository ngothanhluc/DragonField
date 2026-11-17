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
import { bottomPadding, readPng } from '../../scripts/lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', 'assets');
const MANIFEST_PATH = join(ASSETS, 'resources', 'data', 'animations.json');

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

describe('manifest trỏ tới file thật', () => {
  it('mọi sheet tồn tại trên đĩa', () => {
    for (const [key, entry] of entries) {
      expect(existsSync(sheetPath(entry)), `${key} → ${entry.sheet} không tồn tại`).toBe(true);
    }
  });

  it('lưới frame chia hết kích thước sheet thật', () => {
    const sizes = new Map<string, { width: number; height: number }>();
    for (const [key, entry] of entries) {
      let size = sizes.get(entry.sheet);
      if (size === undefined) {
        const png = readPng(sheetPath(entry));
        size = { width: png.width, height: png.height };
        sizes.set(entry.sheet, size);
      }

      expect(size.width, `${key}: sheet ${size.width}px không chia hết ${frameColumns(entry)} cột`).toBe(
        entry.frameWidth * frameColumns(entry),
      );
      expect(size.height, `${key}: sheet ${size.height}px không chia hết ${frameRows(entry)} hàng`).toBe(
        entry.frameHeight * frameRows(entry),
      );
    }
  });

  it('ảnh có pixel đặc ít nhất ở frame đầu (không phải file rỗng)', () => {
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

describe('pivot theo chân', () => {
  it('mọi entry actor neo feet và footPx đúng pixel đặc thấp nhất của sheet', () => {
    const padding = new Map<string, number>();
    for (const [key, entry] of entries) {
      const actor = actorOf(key);
      expect(entry.anchor, `${key} anchor`).toBe(actor === 'fx' ? 'center' : 'feet');

      let computed = padding.get(entry.sheet);
      if (computed === undefined) {
        computed = bottomPadding(readPng(sheetPath(entry)));
        padding.set(entry.sheet, computed);
      }
      if (entry.anchor === 'feet') {
        expect(entry.footPx, `${key} footPx phải bằng đáy pixel đặc của ${entry.sheet}`).toBe(computed);
      } else {
        expect(entry.footPx, `${key} FX neo giữa`).toBe(Math.floor(entry.frameHeight / 2));
      }

      const ratio = entryAnchorY(entry);
      expect(ratio, `${key} anchorY`).toBeGreaterThanOrEqual(0);
      expect(ratio, `${key} anchorY`).toBeLessThan(1);
    }
  });

  it('cùng actor, anchorY khác nhau nhưng chân luôn ở node (world foot = 0)', () => {
    // footY trong frame = footPx; sau khi trừ anchorY*frameHeight phải bằng 0.
    for (const [key, entry] of entries) {
      if (entry.anchor !== 'feet') continue;
      const footInFrame = entry.footPx;
      const afterAnchor = footInFrame - entryAnchorY(entry) * entry.frameHeight;
      expect(Math.abs(afterAnchor), `${key} lệch chân ${afterAnchor}px`).toBeLessThan(1e-9);
    }
  });

  it('frame boss đổi kích thước giữa anim (samurai) nhưng vẫn có pivot feet', () => {
    const idle = manifest.sprites['samurai.idle'];
    const attack = manifest.sprites['samurai.attack.left'];
    if (idle === undefined || attack === undefined) throw new Error('thiếu samurai');

    expect(idle.frameHeight).not.toBe(attack.frameHeight);
    expect(idle.anchor).toBe('feet');
    expect(attack.anchor).toBe('feet');
    expect(entryAnchorY(idle)).not.toBe(entryAnchorY(attack));
  });
});

describe('bộ animation bắt buộc theo vai trò', () => {
  it('mọi key trong bảng yêu cầu resolve được', () => {
    for (const [actor, keys] of Object.entries(REQUIRED_ACTOR_ANIMATIONS)) {
      expect(keys.length, `${actor} phải có animation`).toBeGreaterThan(0);
      for (const key of keys) {
        expect(manifest.sprites[key], `${actor} thiếu ${key}`).toBeDefined();
      }
    }
  });

  it('player có idle/walk/hit/dead; monster có idle/walk; boss có đòn/chết', () => {
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

  it('FX dùng đúng kiểu loop: shield loop, impact/explosion một lần', () => {
    expect(manifest.sprites['fx.shield']?.loop).toBe(true);
    for (const key of ['fx.impact', 'fx.explosion', 'fx.smoke', 'fx.ice', 'fx.poison']) {
      expect(manifest.sprites[key]?.loop, key).toBe(false);
    }
    for (const key of ['fx.shuriken', 'fx.energy-ball']) {
      expect(manifest.sprites[key]?.loop, key).toBe(true);
    }
  });
});

describe('kích thước sprite boss khai báo trong core', () => {
  it('spriteExtentTiles phủ mọi pixel đặc của mọi frame boss (neo theo chân)', () => {
    for (const id of BOSS_IDS) {
      const declared = BOSSES[id].spriteExtentTiles;
      const measured = { left: 0, right: 0, up: 0 };
      for (const key of BOSSES[id].animations) {
        const entry = manifest.sprites[key];
        expect(entry, `${id}: thiếu ${key} trong manifest`).toBeDefined();
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
