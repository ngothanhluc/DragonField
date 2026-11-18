/**
 * Minimal PNG reader/writer (8-bit, RGB/RGBA, no interlace) for the generation scripts
 * and the pivot test. Not a full codec — just enough for the pack's 16 px pixel art.
 *
 * The writer always emits 8-bit RGBA (colour type 6) with filter 0 on every row, so the
 * generated elite sheets round-trip through `readPng` exactly (see `png-encode.test.ts`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

export interface PngImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 byte/pixel. */
  readonly data: Buffer;
}

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
}

function chunks(buffer: Buffer): Chunk[] {
  const result: Chunk[] = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    result.push({ type, data });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return result;
}

export function readPng(path: string): PngImage {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`not a PNG: ${path}`);
  }

  const list = chunks(buffer);
  const ihdr = list.find((chunk) => chunk.type === 'IHDR')?.data;
  if (ihdr === undefined) throw new Error(`PNG is missing IHDR: ${path}`);

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];

  if (bitDepth !== 8) throw new Error(`PNG ${path}: only 8-bit supported, got ${bitDepth}`);
  if (interlace !== 0) throw new Error(`PNG ${path}: interlace not supported`);
  if (colorType !== 2 && colorType !== 3 && colorType !== 6) {
    throw new Error(`PNG ${path}: only RGB/RGBA/palette supported, got colorType ${colorType}`);
  }

  const palette = list.find((chunk) => chunk.type === 'PLTE')?.data;
  const transparency = list.find((chunk) => chunk.type === 'tRNS')?.data;
  if (colorType === 3 && palette === undefined) throw new Error(`PNG palette is missing PLTE: ${path}`);

  const compressed = Buffer.concat(
    list.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data),
  );
  const raw = inflateSync(compressed);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const rowBytes = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(rowBytes);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (rowBytes + 1)] ?? 0;
    const source = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bpp ? row[x - bpp]! : 0;
      const up = previous[x]!;
      const upLeft = x >= bpp ? previous[x - bpp]! : 0;
      const value = source[x]!;
      let decoded = value;
      switch (filter) {
        case 0:
          break;
        case 1:
          decoded = value + left;
          break;
        case 2:
          decoded = value + up;
          break;
        case 3:
          decoded = value + ((left + up) >> 1);
          break;
        case 4:
          decoded = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`PNG ${path}: invalid filter ${filter}`);
      }
      row[x] = decoded & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 4;
      if (colorType === 3) {
        const index = row[x]!;
        const base = index * 3;
        out[dst] = palette![base] ?? 0;
        out[dst + 1] = palette![base + 1] ?? 0;
        out[dst + 2] = palette![base + 2] ?? 0;
        out[dst + 3] = transparency?.[index] ?? 255;
      } else {
        const src = x * bpp;
        out[dst] = row[src]!;
        out[dst + 1] = row[src + 1]!;
        out[dst + 2] = row[src + 2]!;
        out[dst + 3] = bpp === 4 ? row[src + 3]! : 255;
      }
    }
    previous = row;
  }

  return { width, height, data: out };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** CRC32 table for PNG chunk checksums (ISO 3309 / the polynomial PNG mandates). */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(parts: readonly Buffer[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) {
      crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** length + type + data + CRC32(type + data). */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([head.subarray(4), data]), 0);
  return Buffer.concat([head, data, crc]);
}

/** Encode any RGBA image as an 8-bit RGBA PNG (colour type 6, filter 0, zlib `deflateSync`). */
export function encodePng(image: PngImage): Buffer {
  const expected = image.width * image.height * 4;
  if (image.data.length !== expected) {
    throw new Error(
      `encodePng: data must hold ${expected} bytes for ${image.width}×${image.height} RGBA, got ${image.data.length}`,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None) per row
    image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Encode and write in one step (the generation scripts only ever need the file). */
export function writePng(path: string, image: PngImage): void {
  writeFileSync(path, encodePng(image));
}

/** Transparent pixels from the image bottom to the lowest solid pixel. */
export function bottomPadding(image: PngImage): number {
  for (let y = image.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3]! > 0) {
        return image.height - 1 - y;
      }
    }
  }
  return image.height;
}
