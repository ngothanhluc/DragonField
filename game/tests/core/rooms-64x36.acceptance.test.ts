/**
 * Ticket #66 acceptance: normal rooms shrink to 64×36 tiles (2×2 screens of 32×18) with the same
 * enemy counts per room, boss arenas stay 32×18, and the player moves at 5 tiles/s.
 *
 * Expected enemy counts are the numbers the 128×72 pool produced on master `657e7ee` (authored
 * spawns per room, and `roomEnemyTotal` for seeds 1–3), so "denser rooms, same fights" is pinned.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FollowCamera } from '../../assets/scripts/core/camera/follow-camera';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { ROOM_EDGE_MARGIN_TILES } from '../../assets/scripts/core/enemies/behaviours';
import { buildFlowField, buildNavGrid } from '../../assets/scripts/core/enemies/navigation';
import { CAMERA_TUNING, WAVES_TUNING } from '../../assets/scripts/core/enemies/tuning';
import {
  WaveScheduler,
  roomEnemyTotal,
  usesWaveScheduler,
} from '../../assets/scripts/core/enemies/wave-scheduler';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import type { ChapterData, LevelData } from '../../assets/scripts/core/level/level-data';
import { distance, type Vec2 } from '../../assets/scripts/core/math/vec2';
import { DRAWN_NORMAL_ROOMS, drawRunRooms } from '../../assets/scripts/core/run/room-draw';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const CHAPTERS = [1, 2, 3, 4] as const;
const VIEW = { cols: 32, rows: 18 };

const chapters: Readonly<Record<number, ChapterData>> = Object.fromEntries(
  CHAPTERS.map((n) => [n, chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${n}`)))]),
);

function chapter(n: number): ChapterData {
  const data = chapters[n];
  if (data === undefined) throw new Error(`chapter ${n}`);
  return data;
}

function normalRooms(n: number): LevelData[] {
  return chapter(n).rooms.filter((room) => !room.isBossRoom);
}

/** [room, authored spawns, roomEnemyTotal(seed 1), (seed 2), (seed 3)] per normal room, from master. */
type Expected = readonly [number, number, readonly [number, number, number]];
const EXPECTED_COUNTS: Readonly<Record<number, readonly Expected[]>> = {
  1: [
    [1, 9, [32, 32, 32]], [2, 4, [32, 31, 32]], [3, 4, [32, 31, 29]], [4, 4, [32, 32, 31]],
    [5, 4, [32, 32, 32]], [6, 4, [32, 32, 31]], [7, 4, [32, 32, 31]], [8, 4, [32, 31, 31]],
    [9, 9, [32, 32, 32]], [10, 4, [32, 32, 32]], [11, 4, [32, 29, 32]], [12, 4, [31, 32, 30]],
    [13, 4, [32, 32, 30]], [14, 4, [31, 30, 32]], [15, 4, [32, 30, 32]], [16, 4, [31, 31, 32]],
  ],
  2: [
    [1, 6, [48, 47, 48]], [2, 6, [44, 48, 48]], [3, 6, [43, 48, 48]], [4, 6, [48, 48, 48]],
    [5, 6, [48, 48, 44]], [6, 6, [48, 46, 45]], [7, 6, [48, 48, 48]], [8, 6, [45, 48, 48]],
    [9, 6, [48, 48, 48]], [10, 6, [48, 48, 48]], [11, 6, [45, 48, 44]], [12, 6, [48, 48, 48]],
    [13, 6, [48, 48, 44]], [14, 6, [48, 48, 46]], [15, 6, [48, 48, 46]], [16, 6, [45, 46, 47]],
  ],
  3: [
    [1, 8, [61, 64, 64]], [2, 7, [62, 56, 56]], [3, 8, [64, 63, 62]], [4, 8, [64, 64, 64]],
    [5, 8, [64, 60, 60]], [6, 8, [64, 64, 59]], [7, 8, [64, 64, 64]], [8, 8, [60, 58, 64]],
    [9, 8, [61, 64, 59]], [10, 7, [58, 56, 56]], [11, 8, [62, 64, 58]], [12, 8, [64, 61, 64]],
    [13, 8, [64, 64, 64]], [14, 8, [58, 58, 64]], [15, 8, [64, 60, 64]], [16, 8, [64, 64, 64]],
  ],
  4: [
    [1, 8, [64, 66, 64]], [2, 8, [65, 70, 64]], [3, 8, [66, 68, 64]], [4, 9, [72, 70, 72]],
    [5, 9, [72, 72, 69]], [6, 9, [68, 70, 72]], [7, 9, [66, 66, 72]], [8, 9, [68, 72, 72]],
    [9, 8, [69, 64, 68]], [10, 8, [64, 64, 64]], [11, 8, [66, 68, 64]], [12, 9, [72, 69, 72]],
    [13, 9, [72, 72, 71]], [14, 9, [72, 72, 72]], [15, 9, [66, 70, 72]], [16, 9, [66, 67, 70]],
  ],
};

describe('#66 room size', () => {
  for (const n of CHAPTERS) {
    it(`chapter ${n}: 16 normal rooms of 64×36 and one 32×18 boss arena`, () => {
      const normal = normalRooms(n);
      expect(normal).toHaveLength(16);
      for (const room of normal) expect(room.size, room.id).toEqual({ cols: 64, rows: 36 });
      const boss = chapter(n).rooms.filter((room) => room.isBossRoom);
      expect(boss).toHaveLength(1);
      expect(boss[0]?.size).toEqual({ cols: 32, rows: 18 });
    });
  }

  it('a run still draws 8 distinct normal rooms by seed, then the boss', () => {
    for (const n of CHAPTERS) {
      const rooms = drawRunRooms(chapter(n), 7);
      expect(DRAWN_NORMAL_ROOMS).toBe(8);
      expect(rooms).toHaveLength(9);
      expect(new Set(rooms.slice(0, 8).map((room) => room.id)).size).toBe(8);
      expect(rooms[8]?.isBossRoom).toBe(true);
    }
  });
});

describe('#66 reachability', () => {
  for (const n of CHAPTERS) {
    it(`chapter ${n}: from the player start every door is reachable`, () => {
      const problems: string[] = [];
      for (const room of normalRooms(n)) {
        const grid = buildNavGrid(room, 0.25, ROOM_EDGE_MARGIN_TILES);
        if (room.doors.length < 2) problems.push(`${room.id}: ${room.doors.length} doors`);
        for (const door of room.doors) {
          const field = buildFlowField(grid, door.at);
          const d = field.distanceAt(Math.floor(room.playerStart.x), Math.floor(room.playerStart.y));
          if (!Number.isFinite(d)) problems.push(`${room.id}: door ${JSON.stringify(door.at)} unreachable`);
        }
      }
      expect(problems.slice(0, 10)).toEqual([]);
    });
  }
});

function insideObstacle(room: LevelData, at: Vec2): boolean {
  return room.obstacles.some(
    (o) => at.x >= o.x && at.x <= o.x + o.width && at.y >= o.y && at.y <= o.y + o.height,
  );
}

describe('#66 spawn rules in the smaller room', () => {
  for (const n of CHAPTERS) {
    it(`chapter ${n}: every scheduled spawn is in the room, off obstacles, ≥ min distance, telegraphed in view`, () => {
      const problems: string[] = [];
      for (const room of normalRooms(n)) {
        expect(usesWaveScheduler(room), room.id).toBe(true);
        const scheduler = new WaveScheduler(room, 1, 8);
        const camera = new FollowCamera(room.size, VIEW, CAMERA_TUNING);
        camera.reset(room.playerStart);
        const view = camera.viewRect();
        const player = room.playerStart;
        let spawned = 0;
        for (let step = 0; step < 400 && spawned < scheduler.total; step += 1) {
          const batch = scheduler.step({ nowMs: step * 10_000, player, view, alive: 0 });
          for (const spawn of batch) {
            spawned += 1;
            const { x, y } = spawn.at;
            if (x < 0 || y < 0 || x > room.size.cols || y > room.size.rows) {
              problems.push(`${room.id}: spawn ${x.toFixed(1)},${y.toFixed(1)} outside the room`);
            }
            if (insideObstacle(room, spawn.at)) {
              problems.push(`${room.id}: spawn ${x.toFixed(1)},${y.toFixed(1)} inside an obstacle`);
            }
            if (distance(spawn.at, player) < WAVES_TUNING.minSpawnDistanceTiles) {
              problems.push(`${room.id}: spawn ${distance(spawn.at, player).toFixed(1)} tiles from the player`);
            }
            const inView = x >= view.x && x <= view.x + view.width && y >= view.y && y <= view.y + view.height;
            if (inView && spawn.telegraphMs <= 0) problems.push(`${room.id}: in-view spawn without telegraph`);
          }
        }
        if (spawned !== scheduler.total) problems.push(`${room.id}: spawned ${spawned}/${scheduler.total}`);
      }
      expect(problems.slice(0, 10)).toEqual([]);
    });
  }
});

describe('#66 enemy counts per room unchanged', () => {
  for (const n of CHAPTERS) {
    it(`chapter ${n}: authored spawns and room totals match the 128×72 pool`, () => {
      const actual = normalRooms(n)
        .slice()
        .sort((a, b) => a.room - b.room)
        .map((room) => [
          room.room,
          room.waves.flatMap((wave) => wave.enemies).length,
          [1, 2, 3].map((seed) => roomEnemyTotal(room, seed)),
        ]);
      expect(actual).toEqual(EXPECTED_COUNTS[n]);
    });
  }

  it('the alive cap (M18: 30) and the chapter totals live in tuning', () => {
    expect(WAVES_TUNING.aliveCap).toBe(30);
    expect(WAVES_TUNING.chapterTotals).toEqual([
      { min: 24, max: 32 },
      { min: 40, max: 48 },
      { min: 56, max: 64 },
      { min: 64, max: 72 },
    ]);
  });
});

describe('#66 follow camera in a 64×36 room', () => {
  it('the room is larger than the view and the camera never shows past its edges', () => {
    const room = normalRooms(1)[0];
    if (room === undefined) throw new Error('room');
    expect(room.size.cols).toBeGreaterThan(VIEW.cols);
    expect(room.size.rows).toBeGreaterThan(VIEW.rows);
    const camera = new FollowCamera(room.size, VIEW, CAMERA_TUNING);
    camera.reset(room.playerStart);
    const corners: Vec2[] = [
      { x: 0, y: 0 },
      { x: room.size.cols, y: 0 },
      { x: room.size.cols, y: room.size.rows },
      { x: 0, y: room.size.rows },
    ];
    for (const target of corners) {
      for (let frame = 0; frame < 240; frame += 1) {
        camera.update(target, { x: 1, y: 1 }, 1 / 60);
        const view = camera.viewRect();
        expect(view.x).toBeGreaterThanOrEqual(-1e-9);
        expect(view.y).toBeGreaterThanOrEqual(-1e-9);
        expect(view.x + view.width).toBeLessThanOrEqual(room.size.cols + 1e-9);
        expect(view.y + view.height).toBeLessThanOrEqual(room.size.rows + 1e-9);
      }
    }
  });
});

describe('#66 player speed', () => {
  it('the player moves at 5 tiles per second', () => {
    expect(DEFAULT_COMBAT.moveSpeedTilesPerSecond).toBe(5);
  });
});
