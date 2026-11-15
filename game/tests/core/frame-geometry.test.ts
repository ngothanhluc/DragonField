import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  frameColumns,
  frameRect,
  frameRows,
  validateManifest,
  type AnimationManifest,
} from '../../assets/scripts/core/art/manifest';

const here = dirname(fileURLToPath(import.meta.url));
const manifestFile = join(here, '../../assets/resources/data/animations.json');

function load(): AnimationManifest {
  return validateManifest(JSON.parse(readFileSync(manifestFile, 'utf8')));
}

describe('frame geometry', () => {
  it('sheet 4 hướng là 4 cột × frames hàng', () => {
    const entry = load().sprites['player.idle.down'];

    expect(entry).toBeDefined();
    if (!entry) return;

    expect(frameColumns(entry)).toBe(4);
    expect(frameRows(entry)).toBe(4);
  });

  it('tính đúng rect của một hướng cụ thể', () => {
    const entry = load().sprites['player.idle.down'];
    if (!entry) throw new Error('thiếu key player.idle.down');

    // Cột 2 = left (thứ tự D/U/L/R), hàng 3 = frame thứ 4.
    expect(frameRect(entry, 'left', 3)).toEqual({ x: 64, y: 96, width: 32, height: 32 });
  });

  it('sheet chết một cột không chia cho 0', () => {
    const entry = load().sprites['player.dead'];
    if (!entry) throw new Error('thiếu key player.dead');

    expect(entry.directions).toHaveLength(0);
    expect(frameColumns(entry)).toBe(1);
    expect(frameRows(entry)).toBe(2);
    expect(frameRect(entry, 'down', 1)).toEqual({ x: 0, y: 32, width: 32, height: 32 });
  });

  it('sheet boss là strip: 1 hàng, direction bị bỏ qua', () => {
    const entry = load().sprites['tengu.idle'];
    if (!entry) throw new Error('thiếu key tengu.idle');

    expect(entry.layout).toBe('strip');
    expect(frameRows(entry)).toBe(1);
    expect(frameColumns(entry)).toBe(entry.frames);
    expect(frameRect(entry, 'down', 2)).toEqual({
      x: 2 * entry.frameWidth,
      y: 0,
      width: entry.frameWidth,
      height: entry.frameHeight,
    });
  });

  it('mọi sheet nằm trong resources/ để load được lúc runtime', () => {
    const manifest = load();

    for (const [key, entry] of Object.entries(manifest.sprites)) {
      expect(entry.sheet.startsWith('resources/art/'), `${key} → ${entry.sheet}`).toBe(true);
    }
  });

  it('từ chối frame ngoài phạm vi và hướng không có', () => {
    const entry = load().sprites['player.walk.down'];
    if (!entry) throw new Error('thiếu key player.walk.down');

    expect(() => frameRect(entry, 'down', entry.frames)).toThrow();
    expect(() => frameRect(entry, 'down', -1)).toThrow();
    expect(() => frameRect(entry, 'down', 0.5)).toThrow();

    const single = load().sprites['squid.shoot'];
    if (!single) throw new Error('thiếu key squid.shoot');
    expect(() => frameRect(single, 'up', 0)).not.toThrow();
  });
});
