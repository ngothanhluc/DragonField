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
  it('a 4-direction sheet is 4 columns × frames rows', () => {
    const entry = load().sprites['player.idle.down'];

    expect(entry).toBeDefined();
    if (!entry) return;

    expect(frameColumns(entry)).toBe(4);
    expect(frameRows(entry)).toBe(4);
  });

  it('computes the exact rect of one direction', () => {
    const entry = load().sprites['player.idle.down'];
    if (!entry) throw new Error('missing key player.idle.down');

    // Column 2 = left (D/U/L/R order), row 3 = the 4th frame.
    expect(frameRect(entry, 'left', 3)).toEqual({ x: 64, y: 96, width: 32, height: 32 });
  });

  it('a single-column dead sheet does not divide by 0', () => {
    const entry = load().sprites['player.dead'];
    if (!entry) throw new Error('missing key player.dead');

    expect(entry.directions).toHaveLength(0);
    expect(frameColumns(entry)).toBe(1);
    expect(frameRows(entry)).toBe(2);
    expect(frameRect(entry, 'down', 1)).toEqual({ x: 0, y: 32, width: 32, height: 32 });
  });

  it('boss sheets are strips: 1 row, direction ignored', () => {
    const entry = load().sprites['tengu.idle'];
    if (!entry) throw new Error('missing key tengu.idle');

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

  it('every sheet lives under resources/ so it can load at runtime', () => {
    const manifest = load();

    for (const [key, entry] of Object.entries(manifest.sprites)) {
      expect(entry.sheet.startsWith('resources/art/'), `${key} → ${entry.sheet}`).toBe(true);
    }
  });

  it('rejects out-of-range frames and missing directions', () => {
    const entry = load().sprites['player.walk.down'];
    if (!entry) throw new Error('missing key player.walk.down');

    expect(() => frameRect(entry, 'down', entry.frames)).toThrow();
    expect(() => frameRect(entry, 'down', -1)).toThrow();
    expect(() => frameRect(entry, 'down', 0.5)).toThrow();

    const single = load().sprites['squid.shoot'];
    if (!single) throw new Error('missing key squid.shoot');
    expect(() => frameRect(single, 'up', 0)).not.toThrow();
  });
});
