/**
 * The encoder is what `gen:elites` writes the elite sheets with. It must produce a PNG the
 * decoder (and the Cocos importer) reads back pixel-for-pixel: 8-bit RGBA, no interlace.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { encodePng, readPng, writePng, type PngImage } from '../../scripts/lib/png';

const tempDir = mkdtempSync(join(tmpdir(), 'yokai-png-'));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** A 3×2 image with transparent, opaque and semi-transparent pixels. */
function sample(): PngImage {
  const data = Buffer.alloc(3 * 2 * 4);
  const pixels = [
    [12, 34, 56, 255],
    [0, 0, 0, 0],
    [255, 255, 255, 255],
    [17, 0, 200, 128],
    [1, 2, 3, 255],
    [250, 251, 252, 7],
  ] as const;
  pixels.forEach((pixel, index) => data.set(pixel, index * 4));
  return { width: 3, height: 2, data };
}

describe('encodePng', () => {
  it('writes an 8-bit RGBA PNG (colour type 6, no interlace)', () => {
    const png = encodePng(sample());
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // IHDR data starts after the 8-byte signature + 8-byte chunk header.
    expect(png.readUInt32BE(16)).toBe(3); // width
    expect(png.readUInt32BE(20)).toBe(2); // height
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // colour type
    expect(png[28]).toBe(0); // interlace
  });

  it('round-trips through readPng: same size, same bytes', () => {
    const path = join(tempDir, 'round-trip.png');
    const image = sample();
    writePng(path, image);
    const back = readPng(path);
    expect([back.width, back.height]).toEqual([image.width, image.height]);
    expect(Array.from(back.data)).toEqual(Array.from(image.data));
  });

  it('is deterministic: encoding the same image twice gives identical bytes', () => {
    const image = sample();
    expect(Array.from(encodePng(image))).toEqual(Array.from(encodePng(image)));
  });

  it('rejects a buffer whose length does not match width × height × 4', () => {
    expect(() => encodePng({ width: 2, height: 2, data: Buffer.alloc(8) })).toThrowError(/data/);
  });
});
