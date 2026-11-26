/**
 * Fix the space glyph advance in the pixel TTF font.
 *
 * The pack's NormalFont.ttf has space = 227/2048 em (~0.11 em), so in Cocos
 * words stick together ("Clearthechapter"). We raise the advance of the **space glyph**
 * to 682/2048 em (1/3 em) — same glyph, same font, no glyph shape change, no need for an
 * extra Unicode space character outside the cmap (Label still uses ordinary spaces).
 *
 * A pure Bun/Node script, no added dependency: parses the sfnt tables, patches `hmtx`,
 * recomputes the table checksum and `head.checkSumAdjustment`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..', '..');
const FONT = join(PROJECT, 'assets', 'resources', 'art', 'ui', 'fonts', 'NormalFont.ttf');
/** Minimum space advance as a fraction of unitsPerEm (1/3 em prevents word collapse in Cocos). */
const MIN_SPACE_EM_RATIO = 1 / 3;

interface Table {
  readonly tag: string;
  readonly checksum: number;
  offset: number;
  length: number;
}

function tables(buffer: Buffer): Table[] {
  const count = buffer.readUInt16BE(4);
  const list: Table[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    list.push({
      tag: buffer.toString('ascii', at, at + 4),
      checksum: buffer.readUInt32BE(at + 4),
      offset: buffer.readUInt32BE(at + 8),
      length: buffer.readUInt32BE(at + 12),
    });
  }
  return list;
}

function table(list: readonly Table[], tag: string): Table {
  const found = list.find((entry) => entry.tag === tag);
  if (found === undefined) throw new Error(`font is missing table ${tag}`);
  return found;
}

function checksum(buffer: Buffer, offset: number, length: number): number {
  let sum = 0;
  const end = offset + length;
  for (let at = offset; at < end; at += 4) {
    let value = 0;
    for (let byte = 0; byte < 4; byte += 1) {
      const position = at + byte;
      value = (value << 8) | (position < end ? buffer[position]! : 0);
    }
    sum = (sum + value) >>> 0;
  }
  return sum >>> 0;
}

/** cmap format 4 → gid of U+0020. */
function spaceGlyph(buffer: Buffer, list: readonly Table[]): number {
  const cmap = table(list, 'cmap');
  const count = buffer.readUInt16BE(cmap.offset + 2);
  let unicodeOffset = -1;
  for (let index = 0; index < count; index += 1) {
    const at = cmap.offset + 4 + index * 8;
    const platform = buffer.readUInt16BE(at);
    const encoding = buffer.readUInt16BE(at + 2);
    const offset = buffer.readUInt32BE(at + 4);
    if ((platform === 3 && encoding === 1) || platform === 0) {
      unicodeOffset = cmap.offset + offset;
      break;
    }
  }
  if (unicodeOffset < 0) throw new Error('font has no Unicode cmap');
  if (buffer.readUInt16BE(unicodeOffset) !== 4) {
    throw new Error('cmap is not format 4');
  }

  const segmentCount = buffer.readUInt16BE(unicodeOffset + 6) / 2;
  const endCodes = unicodeOffset + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;
  const code = 0x20;

  for (let index = 0; index < segmentCount; index += 1) {
    const end = buffer.readUInt16BE(endCodes + index * 2);
    const start = buffer.readUInt16BE(startCodes + index * 2);
    if (code < start || code > end) continue;
    const delta = buffer.readInt16BE(deltas + index * 2);
    const rangeOffset = buffer.readUInt16BE(rangeOffsets + index * 2);
    if (rangeOffset === 0) return (code + delta) & 0xffff;
    const glyphAt = rangeOffsets + index * 2 + rangeOffset + (code - start) * 2;
    const glyph = buffer.readUInt16BE(glyphAt);
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
  }
  throw new Error('font has no space glyph');
}

export function fixFontSpacing(
  path: string = FONT,
): { readonly glyph: number; readonly oldAdvance: number; readonly newAdvance: number; readonly unitsPerEm: number } {
  const buffer = Buffer.from(readFileSync(path));
  const list = tables(buffer);
  const gid = spaceGlyph(buffer, list);
  const head = table(list, 'head');
  const unitsPerEm = buffer.readUInt16BE(head.offset + 18);
  const minAdvance = Math.round(unitsPerEm * MIN_SPACE_EM_RATIO);
  const hhea = table(list, 'hhea');
  const hmtx = table(list, 'hmtx');
  const metrics = buffer.readUInt16BE(hhea.offset + 34);
  if (gid >= metrics) throw new Error(`space gid ${gid} is outside ${metrics} long metrics`);

  const advanceAt = hmtx.offset + gid * 4;
  const oldAdvance = buffer.readUInt16BE(advanceAt);
  if (oldAdvance >= minAdvance) {
    return { glyph: gid, oldAdvance, newAdvance: oldAdvance, unitsPerEm };
  }

  buffer.writeUInt16BE(minAdvance, advanceAt);
  // Recompute table checksums.
  for (const entry of list) {
    if (entry.tag === 'head') continue;
    const sum = checksum(buffer, entry.offset, entry.length);
    const directoryAt = 12 + list.indexOf(entry) * 16;
    buffer.writeUInt32BE(sum, directoryAt + 4);
  }

  // head.checkSumAdjustment = 0 then whole-file checksum.
  buffer.writeUInt32BE(0, head.offset + 8);
  const headSum = checksum(buffer, head.offset, head.length);
  const headAt = 12 + list.indexOf(head) * 16;
  buffer.writeUInt32BE(headSum, headAt + 4);

  const whole = checksum(buffer, 0, buffer.length);
  buffer.writeUInt32BE((0xb1b0afba - whole) >>> 0, head.offset + 8);

  writeFileSync(path, buffer);
  return { glyph: gid, oldAdvance, newAdvance: minAdvance, unitsPerEm };
}
