/**
 * Acceptance test for ticket #8 (title / chapter select with a living background). Written by
 * the orchestrator; the executor does NOT edit this file.
 *
 * Seam: the pure `core/view/menu-backdrop.ts` — which chapter room is drawn behind the menu and
 * where the idle NinjaGreen stands so the panel does not hide it. What is actually drawn (room,
 * atmosphere, critters, dimming, node cleanup) is proven in the browser, not here.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MENU_BACKDROP_ROOM,
  menuBackdropChapter,
  menuPlayerSpot,
  type TileRect,
} from '../../assets/scripts/core/view/menu-backdrop';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const allData = (): boolean => true;

/** A centred column panel, 16 tiles wide, full height (what a narrow menu panel covers). */
const COLUMN: TileRect = { x: 8, y: 0, width: 16, height: 18 };

/** At least 1 tile clear of the rectangle on some side. */
function clearOf(point: Vec2, rect: TileRect, margin: number): boolean {
  return (
    point.x <= rect.x - margin ||
    point.x >= rect.x + rect.width + margin ||
    point.y <= rect.y - margin ||
    point.y >= rect.y + rect.height + margin
  );
}

/** Feet inside the room with room for the sprite: 1 tile from the sides, 2 from the top. */
function insideRoom(point: Vec2, size: { readonly cols: number; readonly rows: number }): boolean {
  return point.x >= 1 && point.x <= size.cols - 1 && point.y >= 2 && point.y <= size.rows - 1;
}

describe('menuBackdropChapter — which room is behind the menu', () => {
  it('the title always shows chapter 1', () => {
    expect(
      menuBackdropChapter({ screen: 'title', focusedChapter: null, current: null, hasData: allData }),
    ).toBe(1);
    expect(
      menuBackdropChapter({ screen: 'title', focusedChapter: 3, current: 3, hasData: allData }),
    ).toBe(1);
  });

  it('chapter select shows the focused chapter (ch1 / ch2 / ch3)', () => {
    for (const chapter of [1, 2, 3]) {
      expect(
        menuBackdropChapter({
          screen: 'chapter-select',
          focusedChapter: chapter,
          current: 1,
          hasData: allData,
        }),
      ).toBe(chapter);
    }
  });

  it('focus on Back (no chapter) keeps the room already shown', () => {
    expect(
      menuBackdropChapter({ screen: 'chapter-select', focusedChapter: null, current: 2, hasData: allData }),
    ).toBe(2);
    expect(
      menuBackdropChapter({ screen: 'chapter-select', focusedChapter: null, current: null, hasData: allData }),
    ).toBe(1);
  });

  it('a focused chapter without level data does not replace the room', () => {
    const noCh3 = (chapter: number): boolean => chapter !== 3;
    expect(
      menuBackdropChapter({ screen: 'chapter-select', focusedChapter: 3, current: 2, hasData: noCh3 }),
    ).toBe(2);
    expect(
      menuBackdropChapter({ screen: 'chapter-select', focusedChapter: 3, current: null, hasData: noCh3 }),
    ).toBe(1);
  });

  it('draws room 1 of the chapter', () => {
    expect(MENU_BACKDROP_ROOM).toBe(1);
  });
});

describe('menuPlayerSpot — the idle ninja stays visible beside the panel', () => {
  it('keeps playerStart when the panel does not cover it', () => {
    const spot = menuPlayerSpot({ playerStart: { x: 4, y: 10 }, obstacles: [] }, COLUMN);
    expect(spot).toEqual({ x: 4, y: 10 });
  });

  it('moves the ninja out from under the panel, next to it, on the same floor line', () => {
    const start = { x: 16, y: 16 };
    const spot = menuPlayerSpot({ playerStart: start, obstacles: [] }, COLUMN);
    expect(clearOf(spot, COLUMN, 1)).toBe(true);
    expect(insideRoom(spot, { cols: 32, rows: 18 })).toBe(true);
    expect(Math.abs(spot.y - start.y)).toBeLessThanOrEqual(1);
    // Right beside the panel, not pushed into a far corner.
    expect(Math.abs(spot.x - start.x)).toBeLessThanOrEqual(10);
  });

  it('never stands the ninja inside or against an obstacle', () => {
    const obstacles: TileRect[] = [
      { x: 0, y: 13, width: 8, height: 5 },
      { x: 24, y: 13, width: 8, height: 5 },
    ];
    const spot = menuPlayerSpot({ playerStart: { x: 16, y: 16 }, obstacles }, COLUMN);
    expect(clearOf(spot, COLUMN, 1)).toBe(true);
    expect(insideRoom(spot, { cols: 32, rows: 18 })).toBe(true);
    for (const obstacle of obstacles) {
      expect(clearOf(spot, obstacle, 1)).toBe(true);
    }
  });

  it('finds a visible, free spot in the real room 1 of chapters 1–3, deterministically', () => {
    for (const chapter of [1, 2, 3]) {
      const levels = loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`));
      const room = levels.find((level) => level.room === MENU_BACKDROP_ROOM);
      expect(room, `chapter ${chapter} room ${MENU_BACKDROP_ROOM}`).toBeDefined();
      if (room === undefined) continue;

      const spot = menuPlayerSpot(room, COLUMN);
      expect(clearOf(spot, COLUMN, 1), `chapter ${chapter}: ${JSON.stringify(spot)}`).toBe(true);
      expect(insideRoom(spot, room.size), `chapter ${chapter}: ${JSON.stringify(spot)}`).toBe(true);
      for (const obstacle of room.obstacles) {
        expect(clearOf(spot, obstacle, 1), `chapter ${chapter} vs ${JSON.stringify(obstacle)}`).toBe(true);
      }
      expect(menuPlayerSpot(room, COLUMN)).toEqual(spot);
    }
  });
});
