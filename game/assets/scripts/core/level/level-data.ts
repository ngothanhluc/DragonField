/**
 * Hợp đồng runtime của một phòng. Đây là thứ game dùng, không phải định dạng editor:
 * nguồn dữ liệu là `.tmx` (xem `core/level/tmx.ts` cho quy ước object layer), và
 * adapter mapper object layer vào `LevelData` qua `parseTmxLevel` → `parseLevelData`.
 *
 * Hệ toạ độ: **tile unit, gốc trên-trái, y hướng xuống** — đúng hệ của Tiled.
 * Adapter Cocos lật trục y khi dựng node. Phòng luôn đúng 32×18 tile 16 px
 * (`docs/gdd.md` §8), nên `size` và `tileSizePx` bị validate cứng.
 */
import type { Vec2 } from '../math/vec2';

export const ROOM_COLS = 32;
export const ROOM_ROWS = 18;
export const TILE_SIZE_PX = 16;

/** GDD §4 gọi vai trò này là "Brute"; hợp đồng dữ liệu dùng tên `tank`. */
export const ENEMY_ROLES = ['chaser', 'caster', 'tank'] as const;
export type EnemyRole = (typeof ENEMY_ROLES)[number];

export const OBSTACLE_KINDS = ['pillar', 'wall', 'pit'] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export interface RoomSize {
  readonly cols: typeof ROOM_COLS;
  readonly rows: typeof ROOM_ROWS;
}

export const ROOM_SIZE: RoomSize = { cols: ROOM_COLS, rows: ROOM_ROWS };

export interface EnemySpawn {
  readonly role: EnemyRole;
  /** Vị trí trong phòng, tile unit. */
  readonly at: Vec2;
  readonly elite: boolean;
}

export interface Wave {
  enemies: EnemySpawn[];
}

export interface Obstacle {
  readonly kind: ObstacleKind;
  /** Góc trên-trái của hình chữ nhật, tile unit. */
  readonly x: number;
  readonly y: number;
  /** Kích thước theo tile; luôn > 0. */
  readonly width: number;
  readonly height: number;
}

export interface Door {
  readonly at: Vec2;
  /** Số phòng đích trong cùng chapter; `null` = cửa cuối chapter / không đi đâu. */
  readonly toRoom: number | null;
}

export interface BossInfo {
  readonly name: string;
}

export interface LevelData {
  readonly id: string;
  readonly chapter: number;
  readonly room: number;
  readonly isBossRoom: boolean;
  readonly size: RoomSize;
  readonly tileSizePx: typeof TILE_SIZE_PX;
  readonly playerStart: Vec2;
  readonly waves: Wave[];
  readonly obstacles: Obstacle[];
  readonly doors: Door[];
  /** Chỉ có ở phòng boss; `name` khớp key art (ví dụ `TenguBlue`). */
  readonly boss?: BossInfo;
  /** Chỉ có ở phòng boss; chỗ boss đứng (tile unit). Thiếu thì adapter dùng mặc định. */
  readonly bossStart?: Vec2;
}

/** Một file chapter: `{ chapter, rooms }`. */
export interface ChapterData {
  readonly chapter: number;
  readonly rooms: LevelData[];
}

const EPSILON = 1e-9;

/** Gom toàn bộ lỗi rồi ném một `Error` duy nhất, thay vì dừng ở lỗi đầu tiên. */
class ProblemList {
  private readonly items: string[] = [];

  add(path: string, message: string): void {
    this.items.push(path === '' ? message : `${path}: ${message}`);
  }

  throwIfAny(header: string): void {
    if (this.items.length === 0) return;

    const details = this.items.map((item) => `  - ${item}`).join('\n');
    throw new Error(`${header} (${this.items.length} lỗi)\n${details}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value);
}

function isEnemyRole(value: unknown): value is EnemyRole {
  return typeof value === 'string' && ENEMY_ROLES.some((role) => role === value);
}

function isObstacleKind(value: unknown): value is ObstacleKind {
  return typeof value === 'string' && OBSTACLE_KINDS.some((kind) => kind === value);
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function readFiniteNumber(
  value: unknown,
  path: string,
  problems: ProblemList,
): number | null {
  if (!isFiniteNumber(value)) {
    problems.add(path, `phải là số hữu hạn, nhận ${describeValue(value)}`);
    return null;
  }
  return value;
}

function readVec2(value: unknown, path: string, problems: ProblemList): Vec2 | null {
  if (!isRecord(value)) {
    problems.add(path, `phải là object { x, y }, nhận ${describeValue(value)}`);
    return null;
  }

  const x = value.x;
  const y = value.y;
  const xOk = isFiniteNumber(x);
  const yOk = isFiniteNumber(y);

  if (!xOk) problems.add(`${path}.x`, `phải là số hữu hạn, nhận ${describeValue(x)}`);
  if (!yOk) problems.add(`${path}.y`, `phải là số hữu hạn, nhận ${describeValue(y)}`);

  return xOk && yOk ? { x, y } : null;
}

/** Điểm hợp lệ nằm trong hình chữ nhật đóng [0, cols] × [0, rows]. */
function checkPointInRoom(point: Vec2, path: string, problems: ProblemList): void {
  if (point.x < 0 || point.x > ROOM_COLS) {
    problems.add(path, `x=${point.x} nằm ngoài phòng (0..${ROOM_COLS})`);
  }
  if (point.y < 0 || point.y > ROOM_ROWS) {
    problems.add(path, `y=${point.y} nằm ngoài phòng (0..${ROOM_ROWS})`);
  }
}

function readEnemy(
  value: unknown,
  path: string,
  problems: ProblemList,
): EnemySpawn | null {
  if (!isRecord(value)) {
    problems.add(path, `phải là object EnemySpawn, nhận ${describeValue(value)}`);
    return null;
  }

  const role = value.role;
  const roleOk = isEnemyRole(role);
  if (!roleOk) {
    problems.add(
      `${path}.role`,
      `không hợp lệ (${describeValue(role)}); chỉ nhận ${ENEMY_ROLES.join(', ')}`,
    );
  }

  const at = readVec2(value.at, `${path}.at`, problems);
  if (at !== null) checkPointInRoom(at, `${path}.at`, problems);

  const elite = value.elite;
  const eliteOk = typeof elite === 'boolean';
  if (!eliteOk) {
    problems.add(`${path}.elite`, `phải là boolean, nhận ${describeValue(elite)}`);
  }

  if (!roleOk || at === null || !eliteOk) return null;
  return { role, at, elite };
}

function readWave(value: unknown, path: string, problems: ProblemList): Wave | null {
  if (!isRecord(value)) {
    problems.add(path, `phải là object Wave, nhận ${describeValue(value)}`);
    return null;
  }

  if (!Array.isArray(value.enemies)) {
    problems.add(`${path}.enemies`, `phải là mảng EnemySpawn, nhận ${describeValue(value.enemies)}`);
    return null;
  }

  const enemies: EnemySpawn[] = [];
  if (value.enemies.length === 0) {
    problems.add(`${path}.enemies`, 'không được rỗng');
  }

  value.enemies.forEach((rawEnemy, index) => {
    const enemy = readEnemy(rawEnemy, `${path}.enemies[${index}]`, problems);
    if (enemy !== null) enemies.push(enemy);
  });

  return { enemies };
}

function readObstacle(
  value: unknown,
  path: string,
  problems: ProblemList,
): Obstacle | null {
  if (!isRecord(value)) {
    problems.add(path, `phải là object Obstacle, nhận ${describeValue(value)}`);
    return null;
  }

  const kind = value.kind;
  const kindOk = isObstacleKind(kind);
  if (!kindOk) {
    problems.add(
      `${path}.kind`,
      `không hợp lệ (${describeValue(kind)}); chỉ nhận ${OBSTACLE_KINDS.join(', ')}`,
    );
  }

  const x = readFiniteNumber(value.x, `${path}.x`, problems);
  const y = readFiniteNumber(value.y, `${path}.y`, problems);
  const width = readFiniteNumber(value.width, `${path}.width`, problems);
  const height = readFiniteNumber(value.height, `${path}.height`, problems);

  if (x === null || y === null || width === null || height === null) return null;

  if (width <= 0) problems.add(`${path}.width`, `phải > 0, nhận ${width}`);
  if (height <= 0) problems.add(`${path}.height`, `phải > 0, nhận ${height}`);

  const outsideRoom =
    x < 0 ||
    y < 0 ||
    x + width > ROOM_COLS + EPSILON ||
    y + height > ROOM_ROWS + EPSILON;
  if (outsideRoom) {
    problems.add(
      path,
      `vượt ra ngoài phòng 0..${ROOM_COLS} × 0..${ROOM_ROWS} ` +
        `(x=${x}, y=${y}, width=${width}, height=${height})`,
    );
  }

  if (!kindOk || width <= 0 || height <= 0 || outsideRoom) return null;
  return { kind, x, y, width, height };
}

function readDoor(value: unknown, path: string, problems: ProblemList): Door | null {
  if (!isRecord(value)) {
    problems.add(path, `phải là object Door, nhận ${describeValue(value)}`);
    return null;
  }

  const at = readVec2(value.at, `${path}.at`, problems);
  if (at !== null) checkPointInRoom(at, `${path}.at`, problems);

  let toRoom: number | null = null;
  let toRoomOk = true;
  if (value.toRoom !== null) {
    if (!isInteger(value.toRoom) || value.toRoom < 1) {
      problems.add(
        `${path}.toRoom`,
        `phải là số phòng >= 1 hoặc null, nhận ${describeValue(value.toRoom)}`,
      );
      toRoomOk = false;
    } else {
      toRoom = value.toRoom;
    }
  }

  if (at === null || !toRoomOk) return null;
  return { at, toRoom };
}

function readBoss(value: unknown, path: string, problems: ProblemList): BossInfo | null {
  if (!isRecord(value)) {
    problems.add(path, `phải là object { name }, nhận ${describeValue(value)}`);
    return null;
  }

  const name = value.name;
  if (typeof name !== 'string' || name.trim() === '') {
    problems.add(`${path}.name`, `phải là chuỗi không rỗng, nhận ${describeValue(name)}`);
    return null;
  }

  return { name };
}

function parseRoom(value: unknown, path: string, problems: ProblemList): LevelData | null {
  if (!isRecord(value)) {
    problems.add(path, `phải là object LevelData, nhận ${describeValue(value)}`);
    return null;
  }

  let id = '';
  if (typeof value.id !== 'string' || value.id.trim() === '') {
    problems.add(`${path}.id`, `phải là chuỗi không rỗng, nhận ${describeValue(value.id)}`);
  } else {
    id = value.id;
  }

  let chapter = 1;
  if (!isInteger(value.chapter) || value.chapter < 1 || value.chapter > 3) {
    problems.add(`${path}.chapter`, `phải là số nguyên 1..3, nhận ${describeValue(value.chapter)}`);
  } else {
    chapter = value.chapter;
  }

  let room = 1;
  if (!isInteger(value.room) || value.room < 1) {
    problems.add(`${path}.room`, `phải là số nguyên >= 1, nhận ${describeValue(value.room)}`);
  } else {
    room = value.room;
  }

  let isBossRoom = false;
  if (typeof value.isBossRoom !== 'boolean') {
    problems.add(
      `${path}.isBossRoom`,
      `phải là boolean, nhận ${describeValue(value.isBossRoom)}`,
    );
  } else {
    isBossRoom = value.isBossRoom;
  }

  const size = value.size;
  if (!isRecord(size)) {
    problems.add(`${path}.size`, `phải là { cols: ${ROOM_COLS}, rows: ${ROOM_ROWS} }`);
  } else {
    if (size.cols !== ROOM_COLS) {
      problems.add(`${path}.size.cols`, `phải bằng ${ROOM_COLS}, nhận ${describeValue(size.cols)}`);
    }
    if (size.rows !== ROOM_ROWS) {
      problems.add(`${path}.size.rows`, `phải bằng ${ROOM_ROWS}, nhận ${describeValue(size.rows)}`);
    }
  }

  if (value.tileSizePx !== TILE_SIZE_PX) {
    problems.add(
      `${path}.tileSizePx`,
      `phải bằng ${TILE_SIZE_PX}, nhận ${describeValue(value.tileSizePx)}`,
    );
  }

  const playerStart = readVec2(value.playerStart, `${path}.playerStart`, problems);
  if (playerStart !== null) checkPointInRoom(playerStart, `${path}.playerStart`, problems);

  const waves: Wave[] = [];
  if (!Array.isArray(value.waves)) {
    problems.add(`${path}.waves`, `phải là mảng Wave, nhận ${describeValue(value.waves)}`);
  } else {
    if (value.waves.length === 0) {
      problems.add(`${path}.waves`, 'phải có ít nhất 1 wave');
    }
    value.waves.forEach((rawWave, index) => {
      const wave = readWave(rawWave, `${path}.waves[${index}]`, problems);
      if (wave !== null) waves.push(wave);
    });
  }

  const obstacles: Obstacle[] = [];
  if (!Array.isArray(value.obstacles)) {
    problems.add(
      `${path}.obstacles`,
      `phải là mảng Obstacle, nhận ${describeValue(value.obstacles)}`,
    );
  } else {
    value.obstacles.forEach((rawObstacle, index) => {
      const obstacle = readObstacle(rawObstacle, `${path}.obstacles[${index}]`, problems);
      if (obstacle !== null) obstacles.push(obstacle);
    });
  }

  const doors: Door[] = [];
  if (!Array.isArray(value.doors)) {
    problems.add(`${path}.doors`, `phải là mảng Door, nhận ${describeValue(value.doors)}`);
  } else {
    value.doors.forEach((rawDoor, index) => {
      const door = readDoor(rawDoor, `${path}.doors[${index}]`, problems);
      if (door !== null) doors.push(door);
    });
  }

  let boss: BossInfo | undefined;
  if (value.boss !== undefined) {
    const parsedBoss = readBoss(value.boss, `${path}.boss`, problems);
    if (parsedBoss !== null) boss = parsedBoss;
  }

  if (isBossRoom && boss === undefined) {
    problems.add(`${path}.boss`, 'phòng boss bắt buộc có boss { name }');
  }
  if (!isBossRoom && value.boss !== undefined) {
    problems.add(`${path}.boss`, 'chỉ phòng boss mới được khai báo boss');
  }

  let bossStart: Vec2 | undefined;
  if (value.bossStart !== undefined) {
    const parsedStart = readVec2(value.bossStart, `${path}.bossStart`, problems);
    if (parsedStart !== null) {
      checkPointInRoom(parsedStart, `${path}.bossStart`, problems);
      bossStart = parsedStart;
    }
  }
  if (!isBossRoom && value.bossStart !== undefined) {
    problems.add(`${path}.bossStart`, 'chỉ phòng boss mới được khai báo bossStart');
  }

  return {
    id,
    chapter,
    room,
    isBossRoom,
    size: { cols: ROOM_COLS, rows: ROOM_ROWS },
    tileSizePx: TILE_SIZE_PX,
    playerStart: playerStart ?? { x: 0, y: 0 },
    waves,
    obstacles,
    doors,
    ...(boss !== undefined ? { boss } : {}),
    ...(bossStart !== undefined ? { bossStart } : {}),
  };
}

function readChapter(value: unknown, problems: ProblemList): ChapterData | null {
  if (!isRecord(value)) {
    problems.add('chapter', `file phải là object { chapter, rooms }, nhận ${describeValue(value)}`);
    return null;
  }

  let chapter = 1;
  if (!isInteger(value.chapter) || value.chapter < 1 || value.chapter > 3) {
    problems.add('chapter', `phải là số nguyên 1..3, nhận ${describeValue(value.chapter)}`);
  } else {
    chapter = value.chapter;
  }

  if (!Array.isArray(value.rooms)) {
    problems.add('rooms', `phải là mảng LevelData, nhận ${describeValue(value.rooms)}`);
    return null;
  }
  if (value.rooms.length === 0) {
    problems.add('rooms', 'phải có ít nhất 1 phòng');
    return { chapter, rooms: [] };
  }

  const parsed: Array<{ level: LevelData; index: number }> = [];
  value.rooms.forEach((rawRoom, index) => {
    const path = `rooms[${index}]`;
    const level = parseRoom(rawRoom, path, problems);
    if (level === null) return;

    if (level.chapter !== chapter) {
      problems.add(
        `${path}.chapter`,
        `phải bằng chapter của file (${chapter}), nhận ${level.chapter}`,
      );
    }
    parsed.push({ level, index });
  });

  const indicesByRoom = new Map<number, number[]>();
  for (const { level, index } of parsed) {
    const indices = indicesByRoom.get(level.room);
    if (indices === undefined) indicesByRoom.set(level.room, [index]);
    else indices.push(index);
  }
  for (const [roomNumber, indices] of indicesByRoom) {
    if (indices.length > 1) {
      problems.add('rooms', `số phòng ${roomNumber} bị trùng (index ${indices.join(', ')})`);
    }
  }

  const roomNumbers = new Set(parsed.map(({ level }) => level.room));
  for (const { level, index } of parsed) {
    level.doors.forEach((door, doorIndex) => {
      if (door.toRoom !== null && !roomNumbers.has(door.toRoom)) {
        problems.add(
          `rooms[${index}].doors[${doorIndex}].toRoom`,
          `trỏ tới phòng ${door.toRoom} không tồn tại trong chapter`,
        );
      }
    });
  }

  return { chapter, rooms: parsed.map(({ level }) => level) };
}

/**
 * Parse một phòng, hoặc một file chapter.
 *
 * - Với object phòng: validate phòng đó. Không thể kiểm tra `door.toRoom` vì
 *   không biết các phòng khác.
 * - Với file chapter `{ chapter, rooms }`: validate **tất cả** phòng, kể cả số
 *   phòng trùng và door trỏ tới phòng không tồn tại; trả về phòng đầu tiên.
 *   Dùng `parseChapterData` khi cần cả 9 phòng.
 *
 * Mọi lỗi được gom lại và ném trong **một** `Error`.
 */
export function parseLevelData(raw: unknown): LevelData {
  if (isRecord(raw) && Array.isArray(raw.rooms)) {
    const chapter = parseChapterData(raw);
    const first = chapter.rooms[0];
    if (first === undefined) throw new Error('LevelData không hợp lệ: chapter không có phòng nào');
    return first;
  }

  const problems = new ProblemList();
  const level = parseRoom(raw, 'level', problems);
  problems.throwIfAny('LevelData không hợp lệ');
  if (level === null) throw new Error('LevelData không hợp lệ: dữ liệu gốc không phải object');
  return level;
}

/** Parse `{ chapter, rooms }`, validate toàn bộ quan hệ giữa các phòng. */
export function parseChapterData(raw: unknown): ChapterData {
  const problems = new ProblemList();
  const chapter = readChapter(raw, problems);
  problems.throwIfAny('ChapterData không hợp lệ');
  if (chapter === null) throw new Error('ChapterData không hợp lệ: dữ liệu gốc không phải object');
  return chapter;
}

/** Hình chữ nhật đóng: điểm trên biên vẫn tính là trong phòng. */
export function isInsideRoom(level: LevelData, point: Vec2): boolean {
  return (
    point.x >= 0 &&
    point.x <= level.size.cols &&
    point.y >= 0 &&
    point.y <= level.size.rows
  );
}

/**
 * Obstacle đầu tiên chứa điểm. Hình chữ nhật nửa mở [x, x+width) × [y, y+height)
 * để hai tile kề nhau không cùng chứa một điểm trên biên. O(n) theo số obstacle —
 * phòng chỉ có vài vật cản nên không cần spatial index.
 */
export function obstacleAt(level: LevelData, point: Vec2): Obstacle | null {
  for (const obstacle of level.obstacles) {
    const insideX = point.x >= obstacle.x && point.x < obstacle.x + obstacle.width;
    const insideY = point.y >= obstacle.y && point.y < obstacle.y + obstacle.height;
    if (insideX && insideY) return obstacle;
  }
  return null;
}
