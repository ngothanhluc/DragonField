import { describe, expect, it } from 'vitest';
import {
  isInsideRoom,
  obstacleAt,
  parseLevelData,
  type ChapterData,
  type LevelData,
} from '../../assets/scripts/core/level/level-data';
import { parseTileRows } from '../../assets/scripts/core/level/tile-rows';
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
// Bản JSON thuần để mutate trong test validation: parser TMX trả object readonly nhưng
// schema `parseLevelData` nhận dữ liệu thô, nên test được đúng đường validate.
const rawChapter = JSON.parse(JSON.stringify(chapter)) as RawChapter;

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`Fixture thiếu phần tử index ${index}`);
  }
  return value;
}

function room(number: number): LevelData {
  const found = chapter.rooms.find((candidate) => candidate.room === number);
  if (found === undefined) {
    throw new Error(`chapter 1 thiếu phòng ${number}`);
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
  it('parse được đủ 9 phòng, đúng thứ tự', () => {
    expect(chapter.chapter).toBe(1);
    expect(chapter.rooms).toHaveLength(9);
    expect(chapter.rooms.map((level) => level.room)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('parseLevelData nhận file chapter và trả về phòng đầu tiên', () => {
    const first = parseLevelData(rawChapter);

    expect(first.room).toBe(1);
    expect(first.id).toBe('ch1-r1');
  });

  it('phòng 1 có 3 wave, đủ chaser + caster, 4 cột và player start ở đáy giữa', () => {
    const room1 = room(1);

    expect(room1.isBossRoom).toBe(false);
    expect(room1.waves.length).toBeGreaterThanOrEqual(3);

    const roles = new Set(room1.waves.flatMap((wave) => wave.enemies.map((enemy) => enemy.role)));
    expect(roles.has('chaser')).toBe(true);
    expect(roles.has('caster')).toBe(true);

    expect(room1.obstacles.filter((obstacle) => obstacle.kind === 'pillar')).toHaveLength(4);
    expect(room1.obstacles.length).toBeGreaterThanOrEqual(1);
    expect(room1.playerStart).toEqual({ x: 16, y: 16 });
    expect(room1.doors).toHaveLength(1);
  });

  it('phòng 9 là boss room có boss name, bossStart và 4 cột', () => {
    const bossRoom = room(9);

    expect(bossRoom.isBossRoom).toBe(true);
    expect(bossRoom.boss?.name).toBe('TenguBlue');
    expect(bossRoom.bossStart).toEqual({ x: 16, y: 5 });
    expect(bossRoom.obstacles.filter((obstacle) => obstacle.kind === 'pillar')).toHaveLength(4);
  });

  it('mọi door trỏ tới phòng có thật (hoặc null)', () => {
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
  it('nhận điểm trong phòng và trên biên', () => {
    const room1 = room(1);

    expect(isInsideRoom(room1, { x: 16, y: 9 })).toBe(true);
    expect(isInsideRoom(room1, { x: 0, y: 0 })).toBe(true);
    expect(isInsideRoom(room1, { x: 32, y: 18 })).toBe(true);
  });

  it('từ chối điểm ngoài phòng', () => {
    const room1 = room(1);

    expect(isInsideRoom(room1, { x: -0.01, y: 9 })).toBe(false);
    expect(isInsideRoom(room1, { x: 16, y: 18.01 })).toBe(false);
  });
});

describe('obstacleAt', () => {
  it('trả về cột khi điểm nằm trong', () => {
    const room1 = room(1);

    expect(obstacleAt(room1, { x: 8, y: 6 })).toEqual({
      kind: 'pillar',
      x: 8,
      y: 6,
      width: 2,
      height: 2,
    });
    expect(obstacleAt(room1, { x: 9.99, y: 7.99 })?.kind).toBe('pillar');
  });

  it('trả về null khi điểm ở khoảng trống', () => {
    const room1 = room(1);

    expect(obstacleAt(room1, { x: 16, y: 9 })).toBeNull();
    expect(obstacleAt(room1, { x: 10, y: 7 })).toBeNull();
  });
});

describe('parseLevelData — validation', () => {
  it('gom nhiều lỗi vào một Error duy nhất', () => {
    const broken = cloneChapter();
    // Thêm bản sao phòng 1: trùng số phòng nhưng không làm gãy door nào khác.
    broken.rooms.push(structuredClone(at(broken.rooms, 0)));
    at(broken.rooms, 0).size.rows = 17;

    let message = '';
    try {
      parseLevelData(broken);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/rooms\[0\]\.size\.rows/);
    expect(message).toMatch(/số phòng 1 bị trùng/);
    expect(message).toMatch(/2 lỗi/);
  });

  it('parse được một phòng lẻ', () => {
    const single = parseLevelData(structuredClone(at(rawChapter.rooms, 0)));

    expect(single.room).toBe(1);
    expect(single.waves).toHaveLength(3);
  });

  it('từ chối phòng lẻ có spawn ngoài phòng', () => {
    const single = structuredClone(at(rawChapter.rooms, 0));
    const enemy = at(at(single.waves, 0).enemies, 0);
    enemy.at.y = 19;

    expect(() => parseLevelData(single)).toThrow(
      /level\.waves\[0\]\.enemies\[0\]\.at.*ngoài phòng/,
    );
  });

  it('từ chối sai kích thước phòng', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).size.cols = 31;
    }, /rooms\[0\]\.size\.cols/);
  });

  it('từ chối tileSizePx khác 16', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).tileSizePx = 32;
    }, /rooms\[0\]\.tileSizePx/);
  });

  it('từ chối player start ngoài phòng', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).playerStart.y = -1;
    }, /rooms\[0\]\.playerStart.*ngoài phòng/);
  });

  it('từ chối spawn ngoài phòng', () => {
    expectChapterError((broken) => {
      at(at(at(broken.rooms, 0).waves, 0).enemies, 0).at.x = 33;
    }, /rooms\[0\]\.waves\[0\]\.enemies\[0\]\.at.*ngoài phòng/);
  });

  it('từ chối waves rỗng', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).waves = [];
    }, /rooms\[0\]\.waves.*ít nhất 1 wave/);
  });

  it('từ chối wave không có enemy', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).waves = [{ enemies: [] }];
    }, /rooms\[0\]\.waves\[0\]\.enemies.*rỗng/);
  });

  it('từ chối role không nằm trong chaser/caster/tank', () => {
    expectChapterError((broken) => {
      at(at(at(broken.rooms, 0).waves, 0).enemies, 0).role = 'brute';
    }, /rooms\[0\]\.waves\[0\]\.enemies\[0\]\.role.*chaser, caster, tank/);
  });

  it('từ chối obstacle vượt ra ngoài phòng', () => {
    expectChapterError((broken) => {
      at(at(broken.rooms, 0).obstacles, 0).width = 30;
    }, /rooms\[0\]\.obstacles\[0\].*vượt ra ngoài phòng/);
  });

  it('từ chối obstacle có kích thước <= 0', () => {
    expectChapterError((broken) => {
      at(at(broken.rooms, 0).obstacles, 0).height = 0;
    }, /rooms\[0\]\.obstacles\[0\]\.height.*> 0/);
  });

  it('từ chối boss room thiếu boss marker', () => {
    expectChapterError((broken) => {
      delete at(broken.rooms, 8).boss;
    }, /rooms\[8\]\.boss.*bắt buộc/);
  });

  it('từ chối boss marker ở phòng thường', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).boss = { name: 'TenguBlue' };
    }, /rooms\[0\]\.boss.*chỉ phòng boss/);
  });

  it('từ chối boss name rỗng', () => {
    expectChapterError((broken) => {
      const bossRoom = at(broken.rooms, 8);
      if (bossRoom.boss === undefined) throw new Error('fixture thiếu boss');
      bossRoom.boss.name = '   ';
    }, /rooms\[8\]\.boss\.name/);
  });

  it('từ chối số phòng trùng', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 1).room = 1;
    }, /số phòng 1 bị trùng/);
  });

  it('nhận số phòng 10 — tổng phòng là dữ liệu, không phải hằng số', () => {
    const broken = cloneChapter();
    at(broken.rooms, 0).room = 10;

    expect(parseLevelData(broken).room).toBe(10);
  });

  it('từ chối số phòng 0 hoặc âm', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).room = 0;
    }, /rooms\[0\]\.room.*>= 1/);
  });

  it('từ chối bossStart ở phòng thường', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 0).bossStart = { x: 16, y: 5 };
    }, /rooms\[0\]\.bossStart.*chỉ phòng boss/);
  });

  it('từ chối bossStart ngoài phòng', () => {
    expectChapterError((broken) => {
      const bossRoom = at(broken.rooms, 8);
      bossRoom.bossStart = { x: 16, y: 19 };
    }, /rooms\[8\]\.bossStart.*ngoài phòng/);
  });

  it('từ chối door trỏ tới phòng không tồn tại', () => {
    expectChapterError((broken) => {
      at(at(broken.rooms, 0).doors, 0).toRoom = 99;
    }, /rooms\[0\]\.doors\[0\]\.toRoom.*99.*không tồn tại/);
  });

  it('từ chối chapter của phòng khác chapter của file', () => {
    expectChapterError((broken) => {
      at(broken.rooms, 2).chapter = 2;
    }, /rooms\[2\]\.chapter.*chapter của file/);
  });

  it('từ chối file chapter không có phòng', () => {
    expectChapterError((broken) => {
      broken.rooms = [];
    }, /rooms.*ít nhất 1 phòng/);
  });
});

describe('parseTileRows', () => {
  it('đọc legend thành ma trận solid', () => {
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

  it('từ chối các hàng lệch độ dài', () => {
    expect(() => parseTileRows(['###', '##'])).toThrow(/hàng 1.*hình chữ nhật/);
  });

  it('từ chối ký tự không có trong legend', () => {
    expect(() => parseTileRows(['#x#'])).toThrow(/ký tự không rõ "x"/);
  });

  it('từ chối danh sách rỗng và hàng rỗng', () => {
    expect(() => parseTileRows([])).toThrow(/ít nhất 1 hàng/);
    expect(() => parseTileRows([''])).toThrow(/hàng đầu tiên rỗng/);
  });

  it('gom lỗi của nhiều hàng vào một Error', () => {
    let message = '';
    try {
      parseTileRows(['###', '#x', '###']);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/hàng 1 có 2 cột/);
    expect(message).toMatch(/hàng 1, cột 1: ký tự không rõ "x"/);
  });
});
