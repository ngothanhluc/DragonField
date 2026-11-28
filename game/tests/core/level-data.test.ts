import { describe, expect, it } from 'vitest';
import {
  isInsideRoom,
  obstacleAt,
  parseLevelData,
  type ChapterData,
  type LevelData,
} from '../../assets/scripts/core/level/level-data';
import { parseTileRows } from '../../scripts/lib/tile-rows';
import { loadChapterOne } from '../helpers/tmx-levels';

interface RawPoint {
  x: number;
  y: number;
}

interface RawEnemy {
  role: string;
  at: RawPoint;
  elite: boolean;
}

interface RawWave {
  enemies: RawEnemy[];
}

interface RawObstacle {
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RawDoor {
  at: RawPoint;
  toRoom: number | null;
}

interface RawRoom {
  id: string;
  chapter: number;
  room: number;
  isBossRoom: boolean;
  size: { cols: number; rows: number };
  tileSizePx: number;
  playerStart: RawPoint;
  waves: RawWave[];
  obstacles: RawObstacle[];
  doors: RawDoor[];
  boss?: { name: string };
  bossStart?: RawPoint;
}

interface RawChapter {
  chapter: number;
  rooms: RawRoom[];
}

const chapter: ChapterData = loadChapterOne();
// Plain JSON to mutate in validation tests: the TMX parser returns readonly objects but
// `parseLevelData` takes raw data, so the test can exercise the real validation path.
const rawChapter = JSON.parse(JSON.stringify(chapter)) as RawChapter;
/** The boss is the chapter's last room (#38: the pool is followed by the boss). */
const BOSS_INDEX = rawChapter.rooms.length - 1;

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`Fixture is missing element at index ${index}`);
  }
  return value;
}

function room(number: number): LevelData {
  const found = chapter.rooms.find((candidate) => candidate.room === number);
  if (found === undefined) {
    throw new Error(`chapter 1 is missing room ${number}`);
  }
  return found;
}

function cloneChapter(): RawChapter {
  return structuredClone(rawChapter);
}

function expectChapterError(mutate: (chapter: RawChapter) => void, pattern: RegExp): void {
  const broken = cloneChapter();
  mutate(broken);
  expect(() => parseLevelData(broken)).toThrow(pattern);
}

describe('chapter 1 (.tmx → LevelData)', () => {
  it('parses all 17 rooms in order (16 normal + the boss)', () => {
    expect(chapter.chapter).toBe(1);
    expect(chapter.rooms).toHaveLength(17);
    expect(chapter.rooms.map((level) => level.room)).toEqual(
      Array.from({ length: 17 }, (_value, index) => index + 1),
    );
  });

  it('parseLevelData accepts a chapter file and returns the first room', () => {
    const first = parseLevelData(rawChapter);

    expect(first.room).toBe(1);
    expect(first.id).toBe('ch1-r1');
  });

  it('room 1 is a 64×36 room with waves, both chaser + caster, obstacles and 2 doors', () => {
    const room1 = room(1);

    expect(room1.isBossRoom).toBe(false);
    expect(room1.size).toEqual({ cols: 64, rows: 36 });
    expect(room1.waves.length).toBeGreaterThanOrEqual(1);

    const roles = new Set(room1.waves.flatMap((wave) => wave.enemies.map((enemy) => enemy.role)));
    expect(roles.has('chaser')).toBe(true);
    expect(roles.has('caster')).toBe(true);

    expect(room1.obstacles.length).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(room1.playerStart.x)).toBe(true);
    expect(Number.isFinite(room1.playerStart.y)).toBe(true);
    // Two door spots on the room edge: the door choice (#39) offers 2 after every normal room.
    expect(room1.doors).toHaveLength(2);
  });

  it('the last room is the boss room with a boss name, bossStart and pillars', () => {
    const rooms = chapter.rooms;
    const bossRoom = rooms[rooms.length - 1];

    expect(bossRoom?.isBossRoom).toBe(true);
    expect(bossRoom?.boss?.name).toBe('TenguBlue');
    expect(bossRoom?.bossStart).toEqual({ x: 16, y: 5 });
    expect(bossRoom?.obstacles.filter((obstacle) => obstacle.kind === 'pillar')).toHaveLength(4);
  });

  it('every door points at a real room (or null)', () => {
    const roomNumbers = new Set(chapter.rooms.map((level) => level.room));

    for (const level of chapter.rooms) {
      for (const door of level.doors) {
        if (door.toRoom !== null) {
          expect(roomNumbers.has(door.toRoom)).toBe(true);
        }
      }
    }
  });
});

describe('isInsideRoom', () => {
  it('accepts points inside the room and on the boundary', () => {
    const room1 = room(1);

    expect(isInsideRoom(room1, { x: 16, y: 9 })).toBe(true);
    expect(isInsideRoom(room1, { x: 0, y: 0 })).toBe(true);
    expect(isInsideRoom(room1, { x: room1.size.cols, y: room1.size.rows })).toBe(true);
  });

  it('rejects points outside the room', () => {
    const room1 = room(1);

    expect(isInsideRoom(room1, { x: -0.01, y: 9 })).toBe(false);
    expect(isInsideRoom(room1, { x: 16, y: room1.size.rows + 0.01 })).toBe(false);
  });
});

describe('obstacleAt', () => {
  it('returns the obstacle that contains the point', () => {
    const room1 = room(1);
    const block = at(room1.obstacles, 0);

    expect(obstacleAt(room1, { x: block.x + 0.5, y: block.y + 0.5 })).toEqual(block);
    expect(
      obstacleAt(room1, { x: block.x + block.width - 0.01, y: block.y + block.height - 0.01 }),
    ).toEqual(block);
  });

  it('returns null when the point is in open space', () => {
    const room1 = room(1);

    // #67 rings every generated room with an `edge` border, so open space is the interior: the
    // player start is kept three tiles clear of every obstacle.
    expect(obstacleAt(room1, room1.playerStart)).toBeNull();
  });
});

describe('parseLevelData — validation', () => {
  it('collects multiple problems into a single Error', () => {
    const broken = cloneChapter();
    // Add a copy of room 1: duplicates the room number without breaking any other door.
    broken.rooms.push(structuredClone(at(broken.rooms, 0)));
    at(broken.rooms, 0).tileSizePx = 32;

    let message = '';
    try {
      parseLevelData(broken);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/rooms\[0\]\.tileSizePx/);
    expect(message).toMatch(/room number 1 is duplicated/);
    expect(message).toMatch(/2 problem/);
  });

  it('parses a single room', () => {
    const single = parseLevelData(structuredClone(at(rawChapter.rooms, 0)));

    expect(single.room).toBe(1);
    expect(single.waves).toHaveLength(3);
  });

  it('rejects a single room with a spawn outside the room', () => {
    const single = structuredClone(at(rawChapter.rooms, 0));
    const enemy = at(at(single.waves, 0).enemies, 0);
    enemy.at.y = single.size.rows + 1;

    expect(() => parseLevelData(single)).toThrow(
      /level\.waves\[0\]\.enemies\[0\]\.at.*outside the room/,
    );
  });

  it('rejects a wrong room size', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).size.cols = 31;
    }, /rooms\[0\]\.size\.cols/);
  });

  it('rejects a tileSizePx other than 16', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).tileSizePx = 32;
    }, /rooms\[0\]\.tileSizePx/);
  });

  it('rejects a player start outside the room', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).playerStart.y = -1;
    }, /rooms\[0\]\.playerStart.*outside the room/);
  });

  it('rejects a spawn outside the room', () => {
    expectChapterError((broken) => {
      at(at(at(broken.rooms, 0).waves, 0).enemies, 0).at.x = at(broken.rooms, 0).size.cols + 1;
    }, /rooms\[0\]\.waves\[0\]\.enemies\[0\]\.at.*outside the room/);
  });

  it('rejects empty waves', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).waves = [];
    }, /rooms\[0\]\.waves.*at least 1 wave/);
  });

  it('rejects a wave without enemies', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).waves = [{ enemies: [] }];
    }, /rooms\[0\]\.waves\[0\]\.enemies.*must not be empty/);
  });

  it('rejects a role outside chaser/caster/tank', () => {
    expectChapterError((broken) => {
      at(at(at(broken.rooms, 0).waves, 0).enemies, 0).role = 'brute';
    }, /rooms\[0\]\.waves\[0\]\.enemies\[0\]\.role.*chaser, caster, tank/);
  });

  it('rejects an obstacle that extends outside the room', () => {
    expectChapterError((broken) => {
      at(at(broken.rooms, 0).obstacles, 0).width = at(broken.rooms, 0).size.cols + 1;
    }, /rooms\[0\]\.obstacles\[0\].*extends outside the room/);
  });

  it('rejects an obstacle with size <= 0', () => {
    expectChapterError((broken) => {
      at(at(broken.rooms, 0).obstacles, 0).height = 0;
    }, /rooms\[0\]\.obstacles\[0\]\.height.*> 0/);
  });

  it('rejects a boss room without a boss marker', () => {
    expectChapterError((broken) => {
      delete at(broken.rooms, broken.rooms.length - 1).boss;
    }, new RegExp(`rooms\\[${BOSS_INDEX}\\]\\.boss.*requires a boss`));
  });

  it('rejects a boss marker in a regular room', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).boss = { name: 'TenguBlue' };
    }, /rooms\[0\]\.boss.*only a boss room/);
  });

  it('rejects an empty boss name', () => {
    expectChapterError((broken) => {
      const bossRoom = at(broken.rooms, broken.rooms.length - 1);
      if (bossRoom.boss === undefined) throw new Error('fixture is missing boss');
      bossRoom.boss.name = '   ';
    }, new RegExp(`rooms\\[${BOSS_INDEX}\\]\\.boss\\.name`));
  });

  it('rejects a duplicate room number', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 1).room = 1;
    }, /room number 1 is duplicated/);
  });

  it('accepts a room number above the pool size — the room total is data, not a constant', () => {
    const broken = cloneChapter();
    at(broken.rooms, 0).room = 100;

    expect(parseLevelData(broken).room).toBe(100);
  });

  it('rejects room number 0 or negative', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).room = 0;
    }, /rooms\[0\]\.room.*>= 1/);
  });

  it('rejects bossStart in a regular room', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).bossStart = { x: 16, y: 5 };
    }, /rooms\[0\]\.bossStart.*only a boss room/);
  });

  it('rejects bossStart outside the room', () => {
    expectChapterError((broken) => {
      const bossRoom = at(broken.rooms, broken.rooms.length - 1);
      bossRoom.bossStart = { x: 16, y: 19 };
    }, new RegExp(`rooms\\[${BOSS_INDEX}\\]\\.bossStart.*outside the room`));
  });

  it('rejects a door pointing at a room that does not exist', () => {
    expectChapterError((broken) => {
      at(at(broken.rooms, 0).doors, 0).toRoom = 99;
    }, /rooms\[0\]\.doors\[0\]\.toRoom.*99.*does not exist/);
  });

  it('rejects a room chapter different from the file chapter', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 2).chapter = 2;
    }, /rooms\[2\]\.chapter.*file chapter/);
  });

  it('rejects a chapter file with no rooms', () => {
    expectChapterError((broken) => {
      broken.rooms = [];
    }, /rooms.*at least 1 room/);
  });
});

describe('parseTileRows', () => {
  it('reads the legend into a solid matrix', () => {
    const parsed = parseTileRows(['###', '#.#', '#o#', '#~#']);

    expect(parsed.cols).toBe(3);
    expect(parsed.rows).toBe(4);
    expect(parsed.solid).toEqual([
      [true, true, true],
      [true, false, true],
      [true, true, true],
      [true, true, true],
    ]);
  });

  it('rejects rows of different lengths', () => {
    expect(() => parseTileRows(['###', '##'])).toThrow(/row 1.*rectangular/);
  });

  it('rejects a character not in the legend', () => {
    expect(() => parseTileRows(['#x#'])).toThrow(/unknown character "x"/);
  });

  it('rejects an empty list and an empty row', () => {
    expect(() => parseTileRows([])).toThrow(/at least 1 row/);
    expect(() => parseTileRows([''])).toThrow(/first row is empty/);
  });

  it('collects problems from several rows into one Error', () => {
    let message = '';
    try {
      parseTileRows(['###', '#x', '###']);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/row 1 has 2 columns/);
    expect(message).toMatch(/row 1, column 1: unknown character "x"/);
  });
});
