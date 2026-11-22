/**
 * Layout of the 128×72 dev room (ticket #37): a lean chapter-1 floor with a few pillars and
 * short walls spread over all four screens, spawns spread out so the follow camera moves while
 * enemies live everywhere, the player start near the middle and one door.
 *
 * It is **not** part of any chapter (`data/levels/dev/` is never in `CHAPTER_FOLDERS`); it exists
 * so the browser proof can run along the walls and into the corners. `build-dev-room.ts` turns
 * this into `assets/resources/data/levels/dev/room-big.tmx`.
 */
import type { RoomLayoutSpec } from './room-layout';

const COLS = 128;
const ROWS = 72;
/** Field tileset gid for the chapter-1 grass floor. */
const FLOOR_GID = 37;

type Cell = '.' | '#' | 'o' | 'P' | 'D' | 'a' | 'b' | 'c' | 'd';

export function devRoomLayout(): RoomLayoutSpec {
  const grid: Cell[][] = Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => '.' as Cell),
  );

  const put = (x: number, y: number, cell: Cell): void => {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    grid[y]![x] = cell;
  };

  /** 2×2 pillar (the room's `pillar` visual). */
  const pillar = (x: number, y: number): void => {
    for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) put(x + dx, y + dy, 'o');
  };

  /** Horizontal wall run. */
  const wall = (x: number, y: number, length: number): void => {
    for (let dx = 0; dx < length; dx += 1) put(x + dx, y, '#');
  };

  // A few pieces per screen, away from the edges and from the spawn cells below.
  pillar(14, 10);
  pillar(44, 16);
  pillar(78, 44);
  pillar(110, 58);
  pillar(24, 56);
  pillar(100, 12);
  pillar(60, 30);
  pillar(60, 40);
  wall(8, 24, 10);
  wall(56, 18, 10);
  wall(86, 62, 10);
  wall(48, 50, 12);
  wall(104, 30, 8);

  // Player start: the middle of the room (the camera starts on it, a hard cut - not the corner).
  put(64, 36, 'P');

  // One door near the top edge, centred.
  put(64, 2, 'D');

  // Spawns spread over the whole room, three waves, every role used.
  put(8, 8, 'a');
  put(118, 8, 'a');
  put(8, 62, 'a');
  put(118, 62, 'a');
  put(40, 8, 'b');
  put(88, 62, 'b');
  put(20, 36, 'c');
  put(106, 36, 'c');
  put(64, 16, 'd');
  put(64, 54, 'd');

  return {
    chapter: 1,
    room: 1,
    isBossRoom: false,
    // One tileset keeps the dev room lean; the gid only matters for the floor look.
    tilesets: [{ source: 'field.tsx', firstgid: 1 }],
    legend: {
      '.': { tile: FLOOR_GID },
      'o': { tile: FLOOR_GID, obstacle: 'pillar' },
      '#': { tile: FLOOR_GID, obstacle: 'wall' },
      'P': { tile: FLOOR_GID, playerStart: true },
      'D': { tile: FLOOR_GID, door: {} },
      'a': { tile: FLOOR_GID, spawn: { role: 'chaser', wave: 1 } },
      'b': { tile: FLOOR_GID, spawn: { role: 'caster', wave: 1 } },
      'c': { tile: FLOOR_GID, spawn: { role: 'tank', wave: 2 } },
      'd': { tile: FLOOR_GID, spawn: { role: 'chaser', wave: 3 } },
    },
    rows: grid.map((row) => row.join('')),
  };
}
