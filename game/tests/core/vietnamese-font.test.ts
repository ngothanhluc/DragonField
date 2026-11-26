import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(
  HERE,
  '..',
  '..',
  'assets',
  'resources',
  'art',
  'ui',
  'fonts',
  'NormalFont.ttf',
);

/** All 134 Vietnamese accented letters (67 lowercase + 67 uppercase). */
const VIETNAMESE_LOWER =
  'àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ';
const VIETNAMESE_UPPER = VIETNAMESE_LOWER.toUpperCase();
const ALL_VIETNAMESE_CHARS = `${VIETNAMESE_LOWER}${VIETNAMESE_UPPER}`;

interface SfntTable {
  readonly tag: string;
  readonly offset: number;
  readonly length: number;
}

function parseSfntTables(buffer: Buffer): Map<string, SfntTable> {
  const count = buffer.readUInt16BE(4);
  const map = new Map<string, SfntTable>();
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    const tag = buffer.toString('ascii', at, at + 4);
    map.set(tag, {
      tag,
      offset: buffer.readUInt32BE(at + 8),
      length: buffer.readUInt32BE(at + 12),
    });
  }
  return map;
}

/** Parse Unicode cmap subtables (format 4 & format 12) from a TTF/OTF buffer. */
export function readTtfCodePoints(buffer: Buffer): Map<number, number> {
  const tables = parseSfntTables(buffer);
  const cmap = tables.get('cmap');
  if (cmap === undefined) throw new Error('Font missing cmap table');

  const numSubtables = buffer.readUInt16BE(cmap.offset + 2);
  const mapped = new Map<number, number>();

  for (let i = 0; i < numSubtables; i += 1) {
    const recAt = cmap.offset + 4 + i * 8;
    const platformId = buffer.readUInt16BE(recAt);
    const encodingId = buffer.readUInt16BE(recAt + 2);
    const subOffset = cmap.offset + buffer.readUInt32BE(recAt + 4);
    const isUnicode =
      platformId === 0 || (platformId === 3 && (encodingId === 1 || encodingId === 10));
    if (!isUnicode) continue;

    const format = buffer.readUInt16BE(subOffset);
    if (format === 4) {
      const segCount = buffer.readUInt16BE(subOffset + 6) / 2;
      const endCodes = subOffset + 14;
      const startCodes = endCodes + segCount * 2 + 2;
      const idDeltas = startCodes + segCount * 2;
      const idRangeOffsets = idDeltas + segCount * 2;

      for (let s = 0; s < segCount; s += 1) {
        const start = buffer.readUInt16BE(startCodes + s * 2);
        const end = buffer.readUInt16BE(endCodes + s * 2);
        if (start === 0xffff && end === 0xffff) continue;
        const delta = buffer.readInt16BE(idDeltas + s * 2);
        const rangeOffset = buffer.readUInt16BE(idRangeOffsets + s * 2);

        for (let cp = start; cp <= end; cp += 1) {
          let gid: number;
          if (rangeOffset === 0) {
            gid = (cp + delta) & 0xffff;
          } else {
            const glyphPtr = idRangeOffsets + s * 2 + rangeOffset + (cp - start) * 2;
            const rawGid = buffer.readUInt16BE(glyphPtr);
            gid = rawGid === 0 ? 0 : (rawGid + delta) & 0xffff;
          }
          if (gid !== 0) mapped.set(cp, gid);
        }
      }
    } else if (format === 12) {
      const numGroups = buffer.readUInt32BE(subOffset + 12);
      for (let g = 0; g < numGroups; g += 1) {
        const gAt = subOffset + 16 + g * 12;
        const start = buffer.readUInt32BE(gAt);
        const end = buffer.readUInt32BE(gAt + 4);
        const startGid = buffer.readUInt32BE(gAt + 8);
        for (let cp = start; cp <= end; cp += 1) {
          const gid = startGid + (cp - start);
          if (gid !== 0) mapped.set(cp, gid);
        }
      }
    }
  }

  return mapped;
}

describe('M16 Vietnamese pixel font (NormalFont.ttf = VT323, SIL OFL 1.1)', () => {
  it('exists on disk with a valid Cocos ttf-font .meta', () => {
    expect(existsSync(FONT_PATH)).toBe(true);
    expect(existsSync(`${FONT_PATH}.meta`)).toBe(true);
    const meta = JSON.parse(readFileSync(`${FONT_PATH}.meta`, 'utf8')) as { importer?: string };
    expect(meta.importer).toBe('ttf-font');
  });

  it('covers 100% of all 134 Vietnamese upper + lower diacritic characters', () => {
    expect(ALL_VIETNAMESE_CHARS.length).toBe(134);
    const codePoints = readTtfCodePoints(readFileSync(FONT_PATH));
    const missing: string[] = [];
    for (const ch of ALL_VIETNAMESE_CHARS) {
      const cp = ch.codePointAt(0)!;
      if (!codePoints.has(cp)) {
        missing.push(`${ch} (U+${cp.toString(16).toUpperCase()})`);
      }
    }
    expect(missing, `Missing Vietnamese diacritics: ${missing.join(', ')}`).toEqual([]);
  });

  it('covers full printable ASCII and has a readable space advance (>= 1/3 em)', () => {
    const buffer = readFileSync(FONT_PATH);
    const codePoints = readTtfCodePoints(buffer);
    for (let cp = 0x20; cp <= 0x7e; cp += 1) {
      expect(codePoints.has(cp), `Missing ASCII U+${cp.toString(16)}`).toBe(true);
    }

    const tables = parseSfntTables(buffer);
    const head = tables.get('head')!;
    const hhea = tables.get('hhea')!;
    const hmtx = tables.get('hmtx')!;
    const unitsPerEm = buffer.readUInt16BE(head.offset + 18);
    const numHMetrics = buffer.readUInt16BE(hhea.offset + 34);
    const spaceGid = codePoints.get(0x20)!;
    const metricIndex = Math.min(spaceGid, numHMetrics - 1);
    const spaceAdvance = buffer.readUInt16BE(hmtx.offset + metricIndex * 4);

    expect(spaceAdvance / unitsPerEm).toBeGreaterThanOrEqual(1 / 3);
  });
});
