/**
 * Unit tests for the ground-patch edge picker (ticket #67). The acceptance contract lives in
 * `room-art.acceptance.test.ts`; these pin the pieces the acceptance test only reaches through
 * generated files: the blob ids per neighbour pattern and the terrain table.
 */
import { describe, expect, it } from 'vitest';
import {
  GROUND_TERRAINS,
  normalizePatchMask,
  pickBlobTile,
  type PatchMask,
} from '../../assets/scripts/core/level/autotile';

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
  it('gives every chapter a 13-piece terrain from a sheet next to the rooms', () => {
    for (const chapter of [1, 2, 3, 4]) {
      const terrain = GROUND_TERRAINS[chapter];
      expect(terrain, `chapter ${chapter}`).toBeDefined();
      expect(terrain?.tileset).toBe('field.tsx');
      expect(terrain?.tiles).toHaveLength(13);
      expect(new Set(terrain?.tiles).size).toBe(13);
    }
  });
});
