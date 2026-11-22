/**
 * Runtime contract of one room. This is what the game uses, not the editor format:
 * the data source is `.tmx` (see `core/level/tmx.ts` for the object layer convention), and the
 * mapper adapter turns an object layer into `LevelData` via `parseTmxLevel` → `parseLevelData`.
 *
 * Coordinate system: **tile units, top-left origin, y pointing down** — Tiled's system.
 * The Cocos adapter flips the y axis when building nodes. Tiles are 16 px
 * (`docs/gdd.md` §8); a room is a whole number of **screens** of 32×18 tiles: one screen for a
 * boss room, any multiple (e.g. 128×72 = 4×4) for a normal room (ADR-018). `size` is validated
 * against those rules, `tileSizePx` strictly.
 */
import type { Vec2 } from '../math/vec2';
import { CHAPTERS_PER_RUN } from '../run/run-state';

/**
 * One screen: the view the camera always shows, and the exact size of every boss room.
 * A normal room is a whole multiple of this (ADR-018); its real size lives in `LevelData.size`,
 * so never use these constants where "this room's size" is meant.
 */
export const ROOM_COLS = 32;
export const ROOM_ROWS = 18;
export const TILE_SIZE_PX = 16;

/**
 * GDD §4 calls the brute role "Brute"; the data contract uses the name `tank`.
 *
 * #42 adds three roles: `sniper` (keeps far, line telegraph, one fast shot), `splitter`
 * (splits into `splitling`s on death) and `splitling` (small, fast, never splits again).
 */
export const ENEMY_ROLES = [
  'chaser',
  'caster',
  'tank',
  'sniper',
  'splitter',
  'splitling',
] as const;
export type EnemyRole = (typeof ENEMY_ROLES)[number];

/**
 * `prop` is the collider of a catalogue prop (ticket #35): `LevelData.props` says what is drawn,
 * `obstacles` carries the part that blocks. It is solid for walkers and bullets like a wall.
 */
export const OBSTACLE_KINDS = ['pillar', 'wall', 'pit', 'prop'] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export interface RoomSize {
  readonly cols: number;
  readonly rows: number;
}

/** One screen; still exported for the code that builds a 32×18 room by hand (menus, tests). */
export const ROOM_SIZE: RoomSize = { cols: ROOM_COLS, rows: ROOM_ROWS };

export interface EnemySpawn {
  readonly role: EnemyRole;
  /** Position inside the room, tile units. */
  readonly at: Vec2;
  readonly elite: boolean;
}

export interface Wave {
  enemies: EnemySpawn[];
}

export interface Obstacle {
  readonly kind: ObstacleKind;
  /** Top-left corner of the rectangle, tile units. */
  readonly x: number;
  readonly y: number;
  /** Size in tiles; always > 0. */
  readonly width: number;
  readonly height: number;
}

export interface Door {
  readonly at: Vec2;
  /** Target room number within the chapter; `null` = chapter exit / goes nowhere. */
  readonly toRoom: number | null;
}

/**
 * One drawn prop in a room (ticket #35). The `.tmx` places it by catalogue key; its collider is
 * already an `Obstacle` of kind `prop` in `level.obstacles`, so nothing else reads this.
 */
export interface PlacedProp {
  /** Key in `PROP_CATALOGUE[chapter]` (e.g. `tree-green`). */
  readonly key: string;
  /** Top-left corner of the **sprite** (not the collider), tile units. */
  readonly x: number;
  readonly y: number;
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
  /** Drawn props (M9 #35). A solid prop also contributes one `prop` obstacle; walks over otherwise. */
  readonly props: PlacedProp[];
  readonly doors: Door[];
  /** Only present in a boss room; `name` matches an art key (e.g. `TenguBlue`). */
  readonly boss?: BossInfo;
  /** Only present in a boss room; where the boss stands (tile units). The adapter uses a default when absent. */
  readonly bossStart?: Vec2;
}

/** One chapter file: `{ chapter, rooms }`. */
export interface ChapterData {
  readonly chapter: number;
  readonly rooms: LevelData[];
}

const EPSILON = 1e-9;

/** Collect every problem then throw a single `Error`, instead of stopping at the first one. */
class ProblemList {
  private readonly items: string[] = [];

  add(path: string, message: string): void {
    this.items.push(path === '' ? message : `${path}: ${message}`);
  }

  throwIfAny(header: string): void {
    if (this.items.length === 0) return;

    const details = this.items.map((item) => `  - ${item}`).join('\n');
    throw new Error(`${header} (${this.items.length} problem(s))\n${details}`);
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
    problems.add(path, `must be a finite number, got ${describeValue(value)}`);
    return null;
  }
  return value;
}

function readVec2(value: unknown, path: string, problems: ProblemList): Vec2 | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object { x, y }, got ${describeValue(value)}`);
    return null;
  }

  const x = value.x;
  const y = value.y;
  const xOk = isFiniteNumber(x);
  const yOk = isFiniteNumber(y);

  if (!xOk) problems.add(`${path}.x`, `must be a finite number, got ${describeValue(x)}`);
  if (!yOk) problems.add(`${path}.y`, `must be a finite number, got ${describeValue(y)}`);

  return xOk && yOk ? { x, y } : null;
}

/** A valid point lies inside the closed rectangle [0, cols] × [0, rows]. */
function checkPointInRoom(point: Vec2, path: string, problems: ProblemList, size: RoomSize): void {
  if (point.x < 0 || point.x > size.cols) {
    problems.add(path, `x=${point.x} is outside the room (0..${size.cols})`);
  }
  if (point.y < 0 || point.y > size.rows) {
    problems.add(path, `y=${point.y} is outside the room (0..${size.rows})`);
  }
}

/**
 * Room size rules (ADR-018): whole multiples of the 32×18 screen, at least one screen.
 * Boss rooms are exactly one screen. Returns the declared size, or the fallback when invalid,
 * so the rest of the room can still be validated with usable bounds.
 */
function readSize(
  value: unknown,
  path: string,
  problems: ProblemList,
  isBossRoom: boolean,
): RoomSize {
  if (!isRecord(value)) {
    problems.add(
      path,
      `must be { cols, rows } — whole multiples of ${ROOM_COLS}×${ROOM_ROWS}, got ${describeValue(value)}`,
    );
    return ROOM_SIZE;
  }

  const cols = value.cols;
  const rows = value.rows;
  const colsOk = isInteger(cols) && isRoomDimension(cols, ROOM_COLS);
  const rowsOk = isInteger(rows) && isRoomDimension(rows, ROOM_ROWS);

  if (!colsOk) {
    problems.add(
      `${path}.cols`,
      `must be a whole multiple of ${ROOM_COLS} (>= ${ROOM_COLS}), got ${describeValue(cols)}`,
    );
  }
  if (!rowsOk) {
    problems.add(
      `${path}.rows`,
      `must be a whole multiple of ${ROOM_ROWS} (>= ${ROOM_ROWS}), got ${describeValue(rows)}`,
    );
  }

  const size: RoomSize = {
    cols: colsOk ? cols : ROOM_COLS,
    rows: rowsOk ? rows : ROOM_ROWS,
  };

  if (isBossRoom && (size.cols !== ROOM_COLS || size.rows !== ROOM_ROWS)) {
    problems.add(
      path,
      `a boss room is exactly ${ROOM_COLS}×${ROOM_ROWS}, got ${size.cols}×${size.rows}`,
    );
  }

  return size;
}

/** Positive whole multiple of `unit` (e.g. 64 is 2×32, 40 is not). */
function isRoomDimension(value: number, unit: number): boolean {
  return value >= unit && value % unit === 0;
}

function readEnemy(
  value: unknown,
  path: string,
  problems: ProblemList,
  size: RoomSize,
): EnemySpawn | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object EnemySpawn, got ${describeValue(value)}`);
    return null;
  }

  const role = value.role;
  const roleOk = isEnemyRole(role);
  if (!roleOk) {
    problems.add(
      `${path}.role`,
      `invalid (${describeValue(role)}); expected one of ${ENEMY_ROLES.join(', ')}`,
    );
  }

  const at = readVec2(value.at, `${path}.at`, problems);
  if (at !== null) checkPointInRoom(at, `${path}.at`, problems, size);

  const elite = value.elite;
  const eliteOk = typeof elite === 'boolean';
  if (!eliteOk) {
    problems.add(`${path}.elite`, `must be a boolean, got ${describeValue(elite)}`);
  }

  if (!roleOk || at === null || !eliteOk) return null;
  return { role, at, elite };
}

function readWave(
  value: unknown,
  path: string,
  problems: ProblemList,
  size: RoomSize,
): Wave | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object Wave, got ${describeValue(value)}`);
    return null;
  }

  if (!Array.isArray(value.enemies)) {
    problems.add(`${path}.enemies`, `must be an array of EnemySpawn, got ${describeValue(value.enemies)}`);
    return null;
  }

  const enemies: EnemySpawn[] = [];
  if (value.enemies.length === 0) {
    problems.add(`${path}.enemies`, 'must not be empty');
  }

  value.enemies.forEach((rawEnemy, index) => {
    const enemy = readEnemy(rawEnemy, `${path}.enemies[${index}]`, problems, size);
    if (enemy !== null) enemies.push(enemy);
  });

  return { enemies };
}

function readObstacle(
  value: unknown,
  path: string,
  problems: ProblemList,
  size: RoomSize,
): Obstacle | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object Obstacle, got ${describeValue(value)}`);
    return null;
  }

  const kind = value.kind;
  const kindOk = isObstacleKind(kind);
  if (!kindOk) {
    problems.add(
      `${path}.kind`,
      `invalid (${describeValue(kind)}); expected one of ${OBSTACLE_KINDS.join(', ')}`,
    );
  }

  const x = readFiniteNumber(value.x, `${path}.x`, problems);
  const y = readFiniteNumber(value.y, `${path}.y`, problems);
  const width = readFiniteNumber(value.width, `${path}.width`, problems);
  const height = readFiniteNumber(value.height, `${path}.height`, problems);

  if (x === null || y === null || width === null || height === null) return null;

  if (width <= 0) problems.add(`${path}.width`, `must be > 0, got ${width}`);
  if (height <= 0) problems.add(`${path}.height`, `must be > 0, got ${height}`);

  const outsideRoom =
    x < 0 ||
    y < 0 ||
    x + width > size.cols + EPSILON ||
    y + height > size.rows + EPSILON;
  if (outsideRoom) {
    problems.add(
      path,
      `extends outside the room 0..${size.cols} × 0..${size.rows} ` +
        `(x=${x}, y=${y}, width=${width}, height=${height})`,
    );
  }

  if (!kindOk || width <= 0 || height <= 0 || outsideRoom) return null;
  return { kind, x, y, width, height };
}

function readPlacedProp(value: unknown, path: string, problems: ProblemList): PlacedProp | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object { key, x, y }, got ${describeValue(value)}`);
    return null;
  }

  const key = value.key;
  if (typeof key !== 'string' || key.trim() === '') {
    problems.add(`${path}.key`, `must be a non-empty catalogue key, got ${describeValue(key)}`);
    return null;
  }

  const x = value.x;
  const y = value.y;
  const xOk = isFiniteNumber(x);
  const yOk = isFiniteNumber(y);
  if (!xOk) problems.add(`${path}.x`, `must be a finite number, got ${describeValue(x)}`);
  if (!yOk) problems.add(`${path}.y`, `must be a finite number, got ${describeValue(y)}`);
  if (!xOk || !yOk) return null;

  return { key, x, y };
}

function readDoor(
  value: unknown,
  path: string,
  problems: ProblemList,
  size: RoomSize,
): Door | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object Door, got ${describeValue(value)}`);
    return null;
  }

  const at = readVec2(value.at, `${path}.at`, problems);
  if (at !== null) checkPointInRoom(at, `${path}.at`, problems, size);

  let toRoom: number | null = null;
  let toRoomOk = true;
  if (value.toRoom !== null) {
    if (!isInteger(value.toRoom) || value.toRoom < 1) {
      problems.add(
        `${path}.toRoom`,
        `must be a room number >= 1 or null, got ${describeValue(value.toRoom)}`,
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
    problems.add(path, `must be an object { name }, got ${describeValue(value)}`);
    return null;
  }

  const name = value.name;
  if (typeof name !== 'string' || name.trim() === '') {
    problems.add(`${path}.name`, `must be a non-empty string, got ${describeValue(name)}`);
    return null;
  }

  return { name };
}

function parseRoom(value: unknown, path: string, problems: ProblemList): LevelData | null {
  if (!isRecord(value)) {
    problems.add(path, `must be an object LevelData, got ${describeValue(value)}`);
    return null;
  }

  let id = '';
  if (typeof value.id !== 'string' || value.id.trim() === '') {
    problems.add(`${path}.id`, `must be a non-empty string, got ${describeValue(value.id)}`);
  } else {
    id = value.id;
  }

  let chapter = 1;
  if (!isInteger(value.chapter) || value.chapter < 1 || value.chapter > CHAPTERS_PER_RUN) {
    problems.add(
      `${path}.chapter`,
      `must be an integer 1..${CHAPTERS_PER_RUN}, got ${describeValue(value.chapter)}`,
    );
  } else {
    chapter = value.chapter;
  }

  let room = 1;
  if (!isInteger(value.room) || value.room < 1) {
    problems.add(`${path}.room`, `must be an integer >= 1, got ${describeValue(value.room)}`);
  } else {
    room = value.room;
  }

  let isBossRoom = false;
  if (typeof value.isBossRoom !== 'boolean') {
    problems.add(
      `${path}.isBossRoom`,
      `must be a boolean, got ${describeValue(value.isBossRoom)}`,
    );
  } else {
    isBossRoom = value.isBossRoom;
  }

  const size = readSize(value.size, `${path}.size`, problems, isBossRoom);

  if (value.tileSizePx !== TILE_SIZE_PX) {
    problems.add(
      `${path}.tileSizePx`,
      `must equal ${TILE_SIZE_PX}, got ${describeValue(value.tileSizePx)}`,
    );
  }

  const playerStart = readVec2(value.playerStart, `${path}.playerStart`, problems);
  if (playerStart !== null) checkPointInRoom(playerStart, `${path}.playerStart`, problems, size);

  const waves: Wave[] = [];
  if (!Array.isArray(value.waves)) {
    problems.add(`${path}.waves`, `must be an array of Wave, got ${describeValue(value.waves)}`);
  } else {
    if (value.waves.length === 0) {
      problems.add(`${path}.waves`, 'must have at least 1 wave');
    }
    value.waves.forEach((rawWave, index) => {
      const wave = readWave(rawWave, `${path}.waves[${index}]`, problems, size);
      if (wave !== null) waves.push(wave);
    });
  }

  const obstacles: Obstacle[] = [];
  if (!Array.isArray(value.obstacles)) {
    problems.add(
      `${path}.obstacles`,
      `must be an array of Obstacle, got ${describeValue(value.obstacles)}`,
    );
  } else {
    value.obstacles.forEach((rawObstacle, index) => {
      const obstacle = readObstacle(rawObstacle, `${path}.obstacles[${index}]`, problems, size);
      if (obstacle !== null) obstacles.push(obstacle);
    });
  }

  const doors: Door[] = [];
  if (!Array.isArray(value.doors)) {
    problems.add(`${path}.doors`, `must be an array of Door, got ${describeValue(value.doors)}`);
  } else {
    value.doors.forEach((rawDoor, index) => {
      const door = readDoor(rawDoor, `${path}.doors[${index}]`, problems, size);
      if (door !== null) doors.push(door);
    });
  }

  const props: PlacedProp[] = [];
  if (value.props !== undefined) {
    if (!Array.isArray(value.props)) {
      problems.add(`${path}.props`, `must be an array of PlacedProp, got ${describeValue(value.props)}`);
    } else {
      value.props.forEach((rawProp, index) => {
        const prop = readPlacedProp(rawProp, `${path}.props[${index}]`, problems);
        if (prop !== null) props.push(prop);
      });
    }
  }

  let boss: BossInfo | undefined;
  if (value.boss !== undefined) {
    const parsedBoss = readBoss(value.boss, `${path}.boss`, problems);
    if (parsedBoss !== null) boss = parsedBoss;
  }

  if (isBossRoom && boss === undefined) {
    problems.add(`${path}.boss`, 'a boss room requires a boss { name }');
  }
  if (!isBossRoom && value.boss !== undefined) {
    problems.add(`${path}.boss`, 'only a boss room may declare boss');
  }

  let bossStart: Vec2 | undefined;
  if (value.bossStart !== undefined) {
    const parsedStart = readVec2(value.bossStart, `${path}.bossStart`, problems);
    if (parsedStart !== null) {
      checkPointInRoom(parsedStart, `${path}.bossStart`, problems, size);
      bossStart = parsedStart;
    }
  }
  if (!isBossRoom && value.bossStart !== undefined) {
    problems.add(`${path}.bossStart`, 'only a boss room may declare bossStart');
  }

  return {
    id,
    chapter,
    room,
    isBossRoom,
    size,
    tileSizePx: TILE_SIZE_PX,
    playerStart: playerStart ?? { x: 0, y: 0 },
    waves,
    obstacles,
    props,
    doors,
    ...(boss !== undefined ? { boss } : {}),
    ...(bossStart !== undefined ? { bossStart } : {}),
  };
}

function readChapter(value: unknown, problems: ProblemList): ChapterData | null {
  if (!isRecord(value)) {
    problems.add('chapter', `file must be an object { chapter, rooms }, got ${describeValue(value)}`);
    return null;
  }

  let chapter = 1;
  if (!isInteger(value.chapter) || value.chapter < 1 || value.chapter > CHAPTERS_PER_RUN) {
    problems.add(
      'chapter',
      `must be an integer 1..${CHAPTERS_PER_RUN}, got ${describeValue(value.chapter)}`,
    );
  } else {
    chapter = value.chapter;
  }

  if (!Array.isArray(value.rooms)) {
    problems.add('rooms', `must be an array of LevelData, got ${describeValue(value.rooms)}`);
    return null;
  }
  if (value.rooms.length === 0) {
    problems.add('rooms', 'must have at least 1 room');
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
        `must equal the file chapter (${chapter}), got ${level.chapter}`,
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
      problems.add('rooms', `room number ${roomNumber} is duplicated (index ${indices.join(', ')})`);
    }
  }

  const roomNumbers = new Set(parsed.map(({ level }) => level.room));
  for (const { level, index } of parsed) {
    level.doors.forEach((door, doorIndex) => {
      if (door.toRoom !== null && !roomNumbers.has(door.toRoom)) {
        problems.add(
          `rooms[${index}].doors[${doorIndex}].toRoom`,
          `points at room ${door.toRoom} which does not exist in the chapter`,
        );
      }
    });
  }

  return { chapter, rooms: parsed.map(({ level }) => level) };
}

/**
 * Parse one room, or one chapter file.
 *
 * - For a room object: validate that room. `door.toRoom` cannot be checked because
 *   the other rooms are unknown.
 * - For a chapter file `{ chapter, rooms }`: validate **all** rooms, including duplicate
 *   room numbers and doors pointing at rooms that do not exist; returns the first room.
 *   Use `parseChapterData` when you need all 9 rooms.
 *
 * Every problem is collected and thrown in **one** `Error`.
 */
export function parseLevelData(raw: unknown): LevelData {
  if (isRecord(raw) && Array.isArray(raw.rooms)) {
    const chapter = parseChapterData(raw);
    const first = chapter.rooms[0];
    if (first === undefined) throw new Error('Invalid LevelData: chapter has no rooms');
    return first;
  }

  const problems = new ProblemList();
  const level = parseRoom(raw, 'level', problems);
  problems.throwIfAny('Invalid LevelData');
  if (level === null) throw new Error('Invalid LevelData: raw data is not an object');
  return level;
}

/** Parse `{ chapter, rooms }`, validating every relationship between rooms. */
export function parseChapterData(raw: unknown): ChapterData {
  const problems = new ProblemList();
  const chapter = readChapter(raw, problems);
  problems.throwIfAny('Invalid ChapterData');
  if (chapter === null) throw new Error('Invalid ChapterData: raw data is not an object');
  return chapter;
}

/** Closed rectangle: a point on the boundary still counts as inside the room. */
export function isInsideRoom(level: LevelData, point: Vec2): boolean {
  return (
    point.x >= 0 &&
    point.x <= level.size.cols &&
    point.y >= 0 &&
    point.y <= level.size.rows
  );
}

/**
 * First obstacle containing the point. Half-open rectangle [x, x+width) × [y, y+height)
 * so two adjacent tiles never both contain a boundary point. O(n) in obstacle count —
 * a room has only a few obstacles, so no spatial index is needed.
 */
export function obstacleAt(level: LevelData, point: Vec2): Obstacle | null {
  for (const obstacle of level.obstacles) {
    const insideX = point.x >= obstacle.x && point.x < obstacle.x + obstacle.width;
    const insideY = point.y >= obstacle.y && point.y < obstacle.y + obstacle.height;
    if (insideX && insideY) return obstacle;
  }
  return null;
}

/**
 * First obstacle inside the point's clearance box: the same test as `obstacleAt`, grown by
 * `clearanceTiles` on every side. Used for "can a body of this radius stand here?" — a walk
 * target 0.2 tiles from a wall passes `obstacleAt` but can never be reached, which leaves an
 * enemy walking into the wall forever (found by the M9 balance sim).
 */
export function obstacleNear(
  level: LevelData,
  point: Vec2,
  clearanceTiles: number,
): Obstacle | null {
  const clearance = Math.max(0, clearanceTiles);
  for (const obstacle of level.obstacles) {
    const insideX =
      point.x >= obstacle.x - clearance &&
      point.x < obstacle.x + obstacle.width + clearance;
    const insideY =
      point.y >= obstacle.y - clearance &&
      point.y < obstacle.y + obstacle.height + clearance;
    if (insideX && insideY) return obstacle;
  }
  return null;
}
