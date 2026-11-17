/**
 * Đọc PNG tối thiểu (8-bit, RGB/RGBA, không interlace) cho script sinh manifest
 * và test pivot. Không phải decoder đầy đủ — chỉ đủ cho art pixel 16px của pack.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

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
    throw new Error(`không phải PNG: ${path}`);
  }

  const list = chunks(buffer);
  const ihdr = list.find((chunk) => chunk.type === 'IHDR')?.data;
  if (ihdr === undefined) throw new Error(`PNG thiếu IHDR: ${path}`);

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];

  if (bitDepth !== 8) throw new Error(`PNG ${path}: chỉ hỗ trợ 8-bit, nhận ${bitDepth}`);
  if (interlace !== 0) throw new Error(`PNG ${path}: không hỗ trợ interlace`);
  if (colorType !== 2 && colorType !== 3 && colorType !== 6) {
    throw new Error(`PNG ${path}: chỉ hỗ trợ RGB/RGBA/palette, nhận colorType ${colorType}`);
  }

  const palette = list.find((chunk) => chunk.type === 'PLTE')?.data;
  const transparency = list.find((chunk) => chunk.type === 'tRNS')?.data;
  if (colorType === 3 && palette === undefined) throw new Error(`PNG palette thiếu PLTE: ${path}`);

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
          throw new Error(`PNG ${path}: filter ${filter} không hợp lệ`);
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

/** Số pixel trong suốt từ đáy ảnh tới pixel đặc thấp nhất. */
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
