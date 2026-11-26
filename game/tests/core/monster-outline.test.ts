import { describe, expect, it } from 'vitest';
import { OUTLINE_RGB, outlineSpriteSheet } from '../../scripts/lib/monster-outline';

function blankSheet(width: number, height: number): Buffer {
  return Buffer.alloc(width * height * 4, 0);
}

function setPixel(
  buf: Buffer,
  width: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  const idx = (y * width + x) * 4;
  buf[idx] = r;
  buf[idx + 1] = g;
  buf[idx + 2] = b;
  buf[idx + 3] = a;
}

function getPixel(buf: Buffer, width: number, x: number, y: number): [number, number, number, number] {
  const idx = (y * width + x) * 4;
  return [buf[idx]!, buf[idx + 1]!, buf[idx + 2]!, buf[idx + 3]!];
}

describe('outlineSpriteSheet', () => {
  it('preserves dimensions and adds a 1 px #141b1b outline around opaque pixels', () => {
    const src = blankSheet(32, 32);
    setPixel(src, 32, 5, 5, 255, 0, 0, 255);
    const snapshot = Buffer.from(src);

    const out = outlineSpriteSheet(src, 32, 32, 16, 16);
    expect(out.length).toBe(src.length);
    expect(src.equals(snapshot)).toBe(true);

    // Center pixel preserved
    expect(getPixel(out, 32, 5, 5)).toEqual([255, 0, 0, 255]);
    // 4-connected neighbors outlined in #141b1b
    const outline: [number, number, number, number] = [OUTLINE_RGB.r, OUTLINE_RGB.g, OUTLINE_RGB.b, 255];
    expect(getPixel(out, 32, 4, 5)).toEqual(outline);
    expect(getPixel(out, 32, 6, 5)).toEqual(outline);
    expect(getPixel(out, 32, 5, 4)).toEqual(outline);
    expect(getPixel(out, 32, 5, 6)).toEqual(outline);
    // Diagonal neighbor remains transparent
    expect(getPixel(out, 32, 4, 4)[3]).toBe(0);
  });

  it('enforces binary alpha (0 or 255) on all pixels', () => {
    const src = blankSheet(16, 16);
    setPixel(src, 16, 4, 4, 100, 150, 200, 200);
    setPixel(src, 16, 10, 10, 50, 60, 70, 50);

    const out = outlineSpriteSheet(src, 16, 16, 16, 16);
    for (let i = 3; i < out.length; i += 4) {
      expect(out[i] === 0 || out[i] === 255).toBe(true);
    }
    // >= 128 becomes 255 and casts an outline; < 128 becomes 0
    expect(getPixel(out, 16, 4, 4)[3]).toBe(255);
    expect(getPixel(out, 16, 5, 4)[3]).toBe(255);
    expect(getPixel(out, 16, 10, 10)[3]).toBe(0);
  });

  it('does not bleed across 16×16 cell boundaries', () => {
    const src = blankSheet(32, 32);
    // Right edge of cell (0,0) and bottom edge of cell (0,0)
    setPixel(src, 32, 15, 8, 255, 255, 255, 255);
    setPixel(src, 32, 8, 15, 255, 255, 255, 255);
    // Left edge of cell (1,0)
    setPixel(src, 32, 16, 2, 0, 255, 0, 255);

    const out = outlineSpriteSheet(src, 32, 32, 16, 16);
    // Must NOT bleed into cell (1,0) or cell (0,1)
    expect(getPixel(out, 32, 16, 8)[3]).toBe(0);
    expect(getPixel(out, 32, 8, 16)[3]).toBe(0);
    // Must NOT bleed from cell (1,0) back into cell (0,0)
    expect(getPixel(out, 32, 15, 2)[3]).toBe(0);
    // Inside the same cell it still outlines normally
    expect(getPixel(out, 32, 14, 8)).toEqual([OUTLINE_RGB.r, OUTLINE_RGB.g, OUTLINE_RGB.b, 255]);
    expect(getPixel(out, 32, 17, 2)).toEqual([OUTLINE_RGB.r, OUTLINE_RGB.g, OUTLINE_RGB.b, 255]);
  });

  it('skips pixels already #141b1b and is 100% idempotent', () => {
    const src = blankSheet(16, 16);
    setPixel(src, 16, 8, 8, 120, 200, 80, 255);
    setPixel(src, 16, 7, 8, OUTLINE_RGB.r, OUTLINE_RGB.g, OUTLINE_RGB.b, 255);

    const pass1 = outlineSpriteSheet(src, 16, 16, 16, 16);
    const pass2 = outlineSpriteSheet(pass1, 16, 16, 16, 16);

    expect(pass2.equals(pass1)).toBe(true);
    // Pixel (6, 8) adjacent to existing #141b1b at (7, 8) must remain transparent
    expect(getPixel(pass1, 16, 6, 8)[3]).toBe(0);
  });
});
