import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROOM_COLS, ROOM_ROWS } from '../../assets/scripts/core/level/level-data';
import {
  areaContains,
  parseWaterLayout,
  waterAreasFor,
} from '../../assets/scripts/core/level/water-layout';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, '..', '..', 'assets', 'resources', 'data', 'water-layout.json');

const layout = parseWaterLayout(JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown);

describe('water-layout.json', () => {
  it('chỉ có chapter 2 và đúng 9 phòng', () => {
    expect(Object.keys(layout.rooms)).toEqual(['2']);
    expect(Object.keys(layout.rooms['2'] ?? {})).toHaveLength(9);
  });

  it('mọi area nằm trong phòng, kích thước dương và kind hợp lệ', () => {
    for (const [chapter, byRoom] of Object.entries(layout.rooms)) {
      for (const [room, areas] of Object.entries(byRoom)) {
        for (const area of areas) {
          expect(['river', 'waterfall'], `${chapter}/${room}`).toContain(area.kind);
          expect(area.width, `${chapter}/${room} width`).toBeGreaterThan(0);
          expect(area.height, `${chapter}/${room} height`).toBeGreaterThan(0);
          expect(area.x + area.width, `${chapter}/${room} x`).toBeLessThanOrEqual(ROOM_COLS);
          expect(area.y + area.height, `${chapter}/${room} y`).toBeLessThanOrEqual(ROOM_ROWS);
        }
      }
    }
  });

  it('mỗi phòng có sông và thác (theme sông/thác GDD §8)', () => {
    for (const [room, areas] of Object.entries(layout.rooms['2'] ?? {})) {
      expect(areas.some((area) => area.kind === 'river'), `room ${room} thiếu sông`).toBe(true);
    }
    const waterfalls = Object.values(layout.rooms['2'] ?? {}).flat();
    expect(waterfalls.filter((area) => area.kind === 'waterfall').length).toBeGreaterThan(2);
  });

  it('waterAreasFor trả đúng phòng và rỗng cho chapter 1/3', () => {
    expect(waterAreasFor(layout, 1, 1)).toEqual([]);
    expect(waterAreasFor(layout, 3, 1)).toEqual([]);
    expect(waterAreasFor(layout, 2, 1).length).toBeGreaterThan(0);
    expect(waterAreasFor(layout, 2, 99)).toEqual([]);
  });

  it('areaContains đúng biên', () => {
    const area = { kind: 'river' as const, x: 4, y: 5, width: 3, height: 2 };
    expect(areaContains(area, 4, 5)).toBe(true);
    expect(areaContains(area, 6, 6)).toBe(true);
    expect(areaContains(area, 7, 6)).toBe(false);
    expect(areaContains(area, 4, 7)).toBe(false);
  });
});
