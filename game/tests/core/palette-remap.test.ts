/**
 * Pure palette remap used by `gen:elites` (ADR-015): no `cc`, no file system — just numbers,
 * so the colour rules are testable without the art source.
 */
import { describe, expect, it } from 'vitest';
import {
  nearestPaletteIndex,
  paletteFromHex,
  remapPixels,
  remapTable,
  rgbToHex,
  type Rgb,
} from '../../scripts/lib/palette-remap';

const BW = paletteFromHex(['#000000', '#ffffff']);
const RED_UP = paletteFromHex(['#000000', '#ffffff', '#ff0000']);

describe('paletteFromHex', () => {
  it('parses #rrggbb into RGB, case-insensitively', () => {
    expect(paletteFromHex(['#D78B4A', '#ffffff'])).toEqual([
      { r: 0xd7, g: 0x8b, b: 0x4a },
      { r: 255, g: 255, b: 255 },
    ]);
  });

  it('rejects anything that is not #rrggbb', () => {
    expect(() => paletteFromHex(['#fff'])).toThrowError(/rrggbb/);
    expect(() => paletteFromHex(['red'])).toThrowError(/rrggbb/);
    expect(() => paletteFromHex(['#gg0000'])).toThrowError(/rrggbb/);
  });

  it('round-trips through rgbToHex as lowercase', () => {
    for (const hex of ['#000000', '#d78b4a', '#ffffff']) {
      expect(rgbToHex(paletteFromHex([hex])[0]!)).toBe(hex);
    }
  });
});

describe('nearestPaletteIndex', () => {
  it('returns the exact colour when it is in the palette', () => {
    expect(nearestPaletteIndex({ r: 255, g: 255, b: 255 }, BW)).toBe(1);
  });

  it('snaps an off-palette colour to the closest entry by squared RGB distance', () => {
    expect(nearestPaletteIndex({ r: 10, g: 10, b: 10 }, BW)).toBe(0);
    expect(nearestPaletteIndex({ r: 240, g: 250, b: 245 }, BW)).toBe(1);
    expect(nearestPaletteIndex({ r: 250, g: 40, b: 30 }, RED_UP)).toBe(2);
  });

  it('rejects an empty palette instead of returning a bogus index', () => {
    expect(() => nearestPaletteIndex({ r: 0, g: 0, b: 0 }, [])).toThrowError(/empty/);
  });
});

describe('remapTable', () => {
  it('fills every index with itself, then applies the table', () => {
    expect(remapTable({ '0': 2, '2': 0 }, 4)).toEqual([2, 1, 0, 3]);
  });

  it('rejects a start or target index outside the palette', () => {
    expect(() => remapTable({ '0': 4 }, 4)).toThrowError(/index/);
    expect(() => remapTable({ '-1': 0 }, 4)).toThrowError(/index/);
    expect(() => remapTable({ 'nope': 0 }, 4)).toThrowError(/index/);
  });
});

describe('remapPixels', () => {
  function image(pixels: ReadonlyArray<readonly [number, number, number, number]>): Buffer {
    return Buffer.from(pixels.flat());
  }

  it('maps opaque pixels through the palette table and keeps alpha', () => {
    const source = image([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 128],
    ]);
    const out = remapPixels(source, BW, [0, 0]);

    expect(Array.from(out)).toEqual([
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 128,
    ]);
  });

  it('snaps an off-palette colour before applying the table', () => {
    const source = image([[250, 250, 250, 255]]);
    const out = remapPixels(source, RED_UP, remapTable({ '1': 2 }, 3));
    expect(Array.from(out)).toEqual([255, 0, 0, 255]);
  });

  it('leaves alpha-0 pixels untouched, RGB included', () => {
    const source = image([
      [17, 34, 51, 0],
      [255, 255, 255, 255],
    ]);
    const out = remapPixels(source, BW, [0, 1]);
    expect(Array.from(out.subarray(0, 4))).toEqual([17, 34, 51, 0]);
    expect(Array.from(out.subarray(4))).toEqual([255, 255, 255, 255]);
  });

  it('does not mutate the source buffer', () => {
    const source = image([[255, 255, 255, 255]]);
    const before = Array.from(source);
    remapPixels(source, BW, [0, 0]);
    expect(Array.from(source)).toEqual(before);
  });

  it('rejects a table whose length does not match the palette', () => {
    const source = image([[0, 0, 0, 255]]);
    expect(() => remapPixels(source, BW, [0, 1, 2])).toThrowError(/table/);
  });

  it('rejects a buffer whose length is not a multiple of 4', () => {
    const palette: readonly Rgb[] = BW;
    expect(() => remapPixels(Buffer.alloc(3), palette, [0, 1])).toThrowError(/RGBA/);
  });
});
