import { describe, expect, it } from 'vitest';
import { splitTmxLayers } from '../../assets/scripts/core/level/tmx-chunks';
import { childrenNamed, elementText, firstChild, parseXml } from '../../assets/scripts/core/level/xml';

const COLS = 64;
const ROWS = 36;

/** A rectangular map with two tilesets and two CSV layers; the floor gids alternate. */
function tmxOf(cols: number, rows: number): string {
  const floor: number[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) floor.push((x + y) % 2 === 0 ? 37 : 76);
  }
  const decor: number[] = Array.from({ length: cols * rows }, () => 0);
  decor[7 * cols + 5] = 346;
  decor[Math.min(rows - 1, 30) * cols + Math.min(cols - 1, 60)] = 12;

  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" renderorder="right-down" width="${cols}" height="${rows}" tilewidth="16" tileheight="16" infinite="0">
 <tileset firstgid="1" source="field.tsx"/>
 <tileset firstgid="76" source="nature.tsx"/>
 <layer id="1" name="floor" width="${cols}" height="${rows}">
  <data encoding="csv">${floor.join(',')}</data>
 </layer>
 <layer id="2" name="decor" width="${cols}" height="${rows}">
  <data encoding="csv">${decor.join(',')}</data>
 </layer>
</map>`;
}

function bigTmx(): string {
  return tmxOf(COLS, ROWS);
}

interface Slice {
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly gids: number[];
}

/** Read a chunk's own XML back with the same parser the engine uses. */
function layersOf(xml: string): Slice[] {
  const root = parseXml(xml);
  return childrenNamed(root, 'layer').map((layer) => {
    const data = firstChild(layer, 'data');
    const gids = (data === null ? '' : elementText(data))
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10));
    return {
      name: layer.attributes['name'] ?? '',
      cols: Number(layer.attributes['width']),
      rows: Number(layer.attributes['height']),
      gids,
    };
  });
}

function originalLayers(xml: string): Map<string, { cols: number; rows: number; gids: number[] }> {
  const result = new Map<string, { cols: number; rows: number; gids: number[] }>();
  for (const layer of layersOf(xml)) {
    result.set(layer.name, { cols: layer.cols, rows: layer.rows, gids: layer.gids });
  }
  return result;
}

describe('splitTmxLayers — one TiledMap per 32×18 screen', () => {
  it('a 64×36 map becomes four 32×18 chunks at the right tile offsets', () => {
    const chunks = splitTmxLayers(bigTmx());

    expect(chunks.map((chunk) => [chunk.col, chunk.row])).toEqual([
      [0, 0],
      [32, 0],
      [0, 18],
      [32, 18],
    ]);
    for (const chunk of chunks) {
      expect([chunk.cols, chunk.rows]).toEqual([32, 18]);
    }
  });

  it('every chunk has both tilesets and one CSV layer per source layer, ≤ one screen of cells', () => {
    for (const chunk of splitTmxLayers(bigTmx())) {
      const root = parseXml(chunk.xml);
      const sources = childrenNamed(root, 'tileset').map((set) => set.attributes['source']);
      expect(sources).toEqual(['field.tsx', 'nature.tsx']);

      const layers = layersOf(chunk.xml);
      expect(layers.map((layer) => layer.name)).toEqual(['floor', 'decor']);
      for (const layer of layers) {
        expect(layer.gids).toHaveLength(32 * 18);
        expect(layer.gids.length).toBeLessThanOrEqual(32 * 18);
      }
    }
  });

  it('placing the chunks back reconstructs every source layer exactly', () => {
    const xml = bigTmx();
    const chunks = splitTmxLayers(xml);
    const originals = originalLayers(xml);

    for (const [name, original] of originals) {
      const rebuilt = Array.from({ length: COLS * ROWS }, () => -1);
      for (const chunk of chunks) {
        const layer = layersOf(chunk.xml).find((candidate) => candidate.name === name);
        expect(layer, `${name} missing from chunk ${chunk.col},${chunk.row}`).toBeDefined();
        if (layer === undefined) continue;
        for (let y = 0; y < chunk.rows; y += 1) {
          for (let x = 0; x < chunk.cols; x += 1) {
            rebuilt[(chunk.row + y) * COLS + chunk.col + x] = layer.gids[y * chunk.cols + x]!;
          }
        }
      }
      expect(rebuilt).toEqual(original.gids);
    }
  });

  it('a 128×72 room becomes 16 chunks; a 32×18 room stays one', () => {
    const wide = splitTmxLayers(tmxOf(128, 72));
    expect(wide).toHaveLength(16);
    expect(wide.every((chunk) => chunk.cols === 32 && chunk.rows === 18)).toBe(true);

    const small = splitTmxLayers(tmxOf(32, 18));
    expect(small).toHaveLength(1);
    expect([small[0]!.cols, small[0]!.rows]).toEqual([32, 18]);
  });

  it('rejects a layer it cannot slice (not CSV)', () => {
    const xml = bigTmx().replace('encoding="csv"', 'encoding="base64"');
    expect(() => splitTmxLayers(xml)).toThrow(/encoding="csv"/);
  });
});
