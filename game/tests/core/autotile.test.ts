/**
 * Unit tests for the ground-patch edge picker (ticket #67). The acceptance contract lives in
 * `room-art.acceptance.test.ts`; these pin the pieces the acceptance test only reaches through
 * generated files: the blob ids per neighbour pattern and the terrain table.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GROUND_TERRAINS,
  floorBlockTiles,
  normalizePatchMask,
  pickBlobTile,
  type PatchMask,
} from '../../assets/scripts/core/level/autotile';
import { readPng } from '../../scripts/lib/png';

function mask(rows: readonly string[]): PatchMask {
  const cols = rows[0]?.length ?? 0;
  return { cols, rows: rows.length, cells: rows.flatMap((row) => Array.from(row, (ch) => ch === '#')) };
}

describe('pickBlobTile', () => {
  it('maps every single missing orthogonal to its edge piece', () => {
    // A 5×5 patch: the centre cell (2,2) is fully surrounded, so carve out one neighbour at a time.
    const full = ['#####', '#####', '#####', '#####', '#####'];
    const without = (x: number, y: number): number => {
      const rows = full.map((row, index) => (index === y ? `${row.slice(0, x)}.${row.slice(x + 1)}` : row));
      return pickBlobTile(mask(rows), 2, 2);
    };
    expect(without(2, 1)).toBe(2); // north
    expect(without(2, 3)).toBe(12); // south
    expect(without(1, 2)).toBe(6); // west
    expect(without(3, 2)).toBe(8); // east
    expect(without(1, 1)).toBe(4); // NW diagonal
    expect(without(3, 1)).toBe(5); // NE diagonal
    expect(without(1, 3)).toBe(9); // SW diagonal
    expect(without(3, 3)).toBe(10); // SE diagonal
  });

  it('is 0 off the patch and counts the map edge as outside', () => {
    const m = mask(['##', '##']);
    expect(pickBlobTile(m, 2, 0)).toBe(0);
    expect(pickBlobTile(m, -1, 0)).toBe(0);
    expect(pickBlobTile(m, 0, 0)).toBe(1);
  });
});

describe('normalizePatchMask', () => {
  it('is idempotent', () => {
    const once = normalizePatchMask(mask(['......', '.###..', '.###..', '.#####', '######']));
    expect(normalizePatchMask(once)).toEqual(once);
  });
});

describe('GROUND_TERRAINS', () => {
  it('gives every chapter a 13-piece terrain from the sheet next to the rooms', () => {
    for (const chapter of [1, 2, 3, 4]) {
      const terrain = GROUND_TERRAINS[chapter];
      expect(terrain, `chapter ${chapter}`).toBeDefined();
      expect(terrain?.tileset).toBe('tilefloor.tsx');
      expect(terrain?.tiles).toHaveLength(13);
      expect(new Set(terrain?.tiles).size).toBe(13);
    }
  });

  it('places the outer blob in the 3×3 the template shows and the inner corners at (6,2)/(5,2)/(6,1)/(5,1)', () => {
    // Block origin (11, 7) on a 22-column sheet: NW = row 7, col 11 → 7*22 + 11 + 1 = 166.
    const at = (col: number, row: number): number => (7 + row) * 22 + (11 + col) + 1;
    const tiles = floorBlockTiles(11, 7);
    expect(tiles[0]).toBe(at(0, 0)); // 1  NW corner
    expect(tiles[1]).toBe(at(1, 0)); // 2  N edge
    expect(tiles[2]).toBe(at(2, 0)); // 3  NE corner
    expect(tiles[3]).toBe(at(6, 2)); // 4  inner corner, outside diagonal NW
    expect(tiles[4]).toBe(at(5, 2)); // 5  inner corner, outside diagonal NE
    expect(tiles[5]).toBe(at(0, 1)); // 6  W edge
    expect(tiles[6]).toBe(at(1, 1)); // 7  centre
    expect(tiles[7]).toBe(at(2, 1)); // 8  E edge
    expect(tiles[8]).toBe(at(6, 1)); // 9  inner corner, outside diagonal SW
    expect(tiles[9]).toBe(at(5, 1)); // 10 inner corner, outside diagonal SE
    expect(tiles[10]).toBe(at(0, 2)); // 11 SW corner
    expect(tiles[11]).toBe(at(1, 2)); // 12 S edge
    expect(tiles[12]).toBe(at(2, 2)); // 13 SE corner
  });

  it('gives chapter 3 a weathered ruins earth terrain distinct from ch1/ch2 grass, with matching baked fringes', () => {
    expect(GROUND_TERRAINS[3]?.plain).toBe(430);
    expect(GROUND_TERRAINS[3]?.plain).not.toBe(GROUND_TERRAINS[1]?.plain);
    expect(GROUND_TERRAINS[3]?.tiles).toEqual(floorBlockTiles(11, 14));

    const here = dirname(fileURLToPath(import.meta.url));
    const sheet = readPng(join(here, '../../assets/resources/art/tilesets/TilesetFloor.png'));
    const pixel = (local: number, dx: number, dy: number): number[] => {
      const col = (local - 1) % 22;
      const row = Math.floor((local - 1) / 22);
      const index = ((row * 16 + dy) * sheet.width + (col * 16 + dx)) * 4;
      return [sheet.data[index] ?? 0, sheet.data[index + 1] ?? 0, sheet.data[index + 2] ?? 0, sheet.data[index + 3] ?? 0];
    };

    // Every chapter's NW corner outer pixel must match its `plain` floor tile so patches have no box seam.
    for (const chapter of [1, 2, 3, 4]) {
      const terrain = GROUND_TERRAINS[chapter];
      expect(terrain).toBeDefined();
      if (terrain === undefined) continue;
      expect(pixel(terrain.tiles[0]!, 0, 0), `chapter ${chapter} NW fringe vs plain`).toEqual(
        pixel(terrain.plain, 0, 0),
      );
    }
  });
});
