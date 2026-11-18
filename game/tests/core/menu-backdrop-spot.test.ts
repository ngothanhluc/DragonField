/**
 * Extra unit tests for the living menu backdrop (#8), alongside the acceptance contract in
 * `menu-backdrop.test.ts`: exact clearance edges and the no-space fallback.
 */
import { describe, expect, it } from 'vitest';
import {
  MENU_BACKDROP_ROOM,
  menuBackdropChapter,
  menuPlayerSpot,
  type TileRect,
} from '../../assets/scripts/core/view/menu-backdrop';
import { ROOM_COLS, ROOM_ROWS } from '../../assets/scripts/core/level/level-data';

const COLUMN: TileRect = { x: 8, y: 0, width: 16, height: 18 };

function clearOf(point: { x: number; y: number }, rect: TileRect, margin: number): boolean {
  return (
    point.x <= rect.x - margin ||
    point.x >= rect.x + rect.width + margin ||
    point.y <= rect.y - margin ||
    point.y >= rect.y + rect.height + margin
  );
}

describe('menuBackdropChapter — edges', () => {
  it('falls back to chapter 1 on a chapter the build has no data for', () => {
    expect(
      menuBackdropChapter({
        screen: 'chapter-select',
        focusedChapter: 3,
        current: null,
        hasData: (chapter) => chapter === 1,
      }),
    ).toBe(MENU_BACKDROP_ROOM);
  });

  it('never returns a chapter without data', () => {
    expect(
      menuBackdropChapter({
        screen: 'chapter-select',
        focusedChapter: 2,
        current: 2,
        hasData: () => false,
      }),
    ).toBe(MENU_BACKDROP_ROOM);
  });
});

describe('menuPlayerSpot — edges', () => {
  it('returns playerStart when it sits exactly one tile from the panel', () => {
    const start = { x: 7, y: 10 };
    expect(menuPlayerSpot({ playerStart: start, obstacles: [] }, COLUMN)).toEqual(start);
  });

  it('moves a playerStart that is only half a tile inside the panel edge', () => {
    const start = { x: 7.5, y: 10 };
    const spot = menuPlayerSpot({ playerStart: start, obstacles: [] }, COLUMN);
    expect(spot).not.toEqual(start);
    expect(clearOf(spot, COLUMN, 1)).toBe(true);
  });

  it('keeps the spot on whole room tiles for a moved ninja', () => {
    const spot = menuPlayerSpot({ playerStart: { x: 16, y: 16 }, obstacles: [] }, COLUMN);
    expect(Number.isInteger(spot.x)).toBe(true);
    expect(Number.isInteger(spot.y)).toBe(true);
    expect(spot.x).toBeGreaterThanOrEqual(1);
    expect(spot.x).toBeLessThanOrEqual(ROOM_COLS - 1);
    expect(spot.y).toBeGreaterThanOrEqual(2);
    expect(spot.y).toBeLessThanOrEqual(ROOM_ROWS - 1);
  });

  it('falls back to playerStart when the room has no free tile', () => {
    const wall: TileRect = { x: 0, y: 0, width: ROOM_COLS, height: ROOM_ROWS };
    const start = { x: 16, y: 16 };
    expect(menuPlayerSpot({ playerStart: start, obstacles: [wall] }, COLUMN)).toEqual(start);
  });
});
