/**
 * `.tmx` → `LevelData`. **Một** parser cho cả vitest (Node) và runtime Cocos:
 * bootstrap lấy XML từ `TiledMapAsset.tmxXmlStr` rồi gọi đúng hàm này, và test
 * đọc file `.tmx` thật trên đĩa. Không có đường parse thứ hai để lệch nhau.
 *
 * ## Quy ước file phòng (`assets/resources/data/levels/chapter-<n>/room-<r>.tmx`)
 *
 * - Map: `orientation="orthogonal"`, `width=32`, `height=18`, `tilewidth=16`,
 *   `tileheight=16`. Sai kích thước là lỗi: mỗi phòng đúng 1 màn hình 512×288.
 * - Tile layer: các `<layer>` (thường chỉ 1 layer `floor`) do component
 *   `TiledMap` vẽ. Parser **không** suy ra va chạm từ tile; dữ liệu va chạm nằm
 *   ở object layer. Data layer nên là `encoding="csv"` (parser kiểm tra đủ ô khi
 *   gặp CSV, còn base64/gzip thì để engine lo — không phải định dạng ta author).
 * - Object layer (tên gì cũng được, thường `objects`): mỗi object nhận diện bằng
 *   **`name`**, toạ độ tính bằng pixel của Tiled (16 px = 1 tile):
 *
 *   | name         | kiểu     | thuộc tính bắt buộc                 | ý nghĩa |
 *   |--------------|----------|-------------------------------------|---------|
 *   | `playerStart`| point    | —                                   | vị trí player, đúng 1 object |
 *   | `spawn`      | point    | `role`, `wave` (int ≥ 1); `elite` (bool, mặc định false) | 1 enemy; `role` ∈ chaser/caster/tank |
 *   | `obstacle`   | rect     | `kind` ∈ pillar/wall/pit            | vật cản: x/y/width/height là pixel |
 *   | `door`       | point    | `toRoom` (int ≥ 1) hoặc không có    | không có `toRoom` = cửa cuối chapter (`null`) |
 *   | `bossStart`  | point    | — (chỉ phòng boss)                  | chỗ đứng của boss; mặc định (16, 5) |
 *
 *   Object tên khác ⇒ **lỗi**, để typo không âm thầm thành object bị bỏ qua.
 *   `rotation` phải bằng 0 (collision là hình chữ nhật trục song song).
 * - Map properties:
 *
 *   | tên          | kiểu   | bắt buộc | ý nghĩa |
 *   |--------------|--------|----------|---------|
 *   | `chapter`    | int    | có       | 1..3 |
 *   | `room`       | int    | có       | ≥ 1, không trùng trong cùng thư mục |
 *   | `isBossRoom` | bool   | không    | mặc định false |
 *   | `boss`       | string | khi boss | tên sprite trong `BOSSES` (vd `TenguBlue`) |
 *
 * - Wave: các `spawn` có cùng `wave` gộp thành một wave; chỉ số phải liền mạch
 *   `1..N` (thiếu wave 2 mà có wave 3 là lỗi). Thêm phòng = thêm file `.tmx`,
 *   không sửa code; tổng số phòng suy ra từ số file (`chapterFromLevels`).
 */
import type { Vec2 } from '../math/vec2';
import {
  ENEMY_ROLES,
  OBSTACLE_KINDS,
  ROOM_COLS,
  ROOM_ROWS,
  TILE_SIZE_PX,
  parseLevelData,
} from './level-data';
import type { BossInfo, Door, EnemyRole, EnemySpawn, LevelData, ObstacleKind, Wave } from './level-data';
import { childrenNamed, elementText, firstChild, parseXml } from './xml';
import type { XmlElement } from './xml';

/** Tên object trong object layer — xem bảng quy ước ở đầu file. */
export const TMX_OBJECTS = {
  playerStart: 'playerStart',
  spawn: 'spawn',
  obstacle: 'obstacle',
  door: 'door',
  bossStart: 'bossStart',
} as const;

/** Gom toàn bộ lỗi rồi ném một `Error` duy nhất (cùng kiểu `level-data.ts`). */
class ProblemList {
  private readonly items: string[] = [];

  add(path: string, message: string): void {
    this.items.push(path === '' ? message : `${path}: ${message}`);
  }

  get length(): number {
    return this.items.length;
  }

  throwIfAny(source: string): void {
    if (this.items.length === 0) return;

    const details = this.items.map((item) => `  - ${item}`).join('\n');
    throw new Error(`${source}: TMX không hợp lệ (${this.items.length} lỗi)\n${details}`);
  }
}

interface TmxProperty {
  readonly name: string;
  readonly raw: string;
  readonly type: string;
  readonly path: string;
}

function describe(value: string | undefined): string {
  return value === undefined ? 'thiếu' : JSON.stringify(value);
}

/** Thuộc tính dạng chuỗi, bắt buộc. */
function requiredAttribute(
  element: XmlElement,
  name: string,
  path: string,
  problems: ProblemList,
): string | null {
  const value = element.attributes[name];
  if (value === undefined || value.trim() === '') {
    problems.add(path, `thiếu thuộc tính "${name}"`);
    return null;
  }
  return value;
}

/** Thuộc tính dạng số (hữu hạn), bắt buộc. */
function requiredNumber(
  element: XmlElement,
  name: string,
  path: string,
  problems: ProblemList,
): number | null {
  const raw = requiredAttribute(element, name, path, problems);
  if (raw === null) return null;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    problems.add(path, `thuộc tính "${name}" phải là số, nhận ${JSON.stringify(raw)}`);
    return null;
  }
  return value;
}

/** Thuộc tính dạng số, có giá trị mặc định khi vắng mặt. */
function optionalNumber(
  element: XmlElement,
  name: string,
  fallback: number,
  path: string,
  problems: ProblemList,
): number {
  const raw = element.attributes[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    problems.add(path, `thuộc tính "${name}" phải là số, nhận ${JSON.stringify(raw)}`);
    return fallback;
  }
  return value;
}

/**
 * `<properties>` trực tiếp của `element` → map tên → property thô.
 * Property trùng tên là lỗi: `get` sẽ chỉ trả một cái, còn cái kia im lặng mất.
 */
function readProperties(
  element: XmlElement,
  path: string,
  problems: ProblemList,
): Map<string, TmxProperty> {
  const result = new Map<string, TmxProperty>();
  const container = firstChild(element, 'properties');
  if (container === null) return result;

  container.children.forEach((property, index) => {
    if (property.name !== 'property') {
      problems.add(`${path}.properties[${index}]`, `chỉ nhận <property>, gặp <${property.name}>`);
      return;
    }

    const propertyPath = `${path}.properties[${index}]`;
    const name = requiredAttribute(property, 'name', propertyPath, problems);
    if (name === null) return;

    if (result.has(name)) {
      problems.add(propertyPath, `property "${name}" bị khai báo trùng`);
      return;
    }

    // Tiled lưu bool/int dưới dạng attribute `value`; kiểu nằm ở `type`.
    result.set(name, {
      name,
      raw: property.attributes['value'] ?? '',
      type: property.attributes['type'] ?? 'string',
      path: `${path}.properties[${index}](${name})`,
    });
  });

  return result;
}

function readIntegerProperty(
  properties: ReadonlyMap<string, TmxProperty>,
  name: string,
  namePath: string,
  required: boolean,
  problems: ProblemList,
): number | null {
  const property = properties.get(name);
  if (property === undefined) {
    if (required) problems.add(namePath, `thiếu property "${name}"`);
    return null;
  }

  const raw = property.raw.trim();
  if (property.type !== 'int' || !/^-?\d+$/.test(raw)) {
    problems.add(property.path, `phải là int, nhận type=${JSON.stringify(property.type)} value=${JSON.stringify(property.raw)}`);
    return null;
  }

  return Number.parseInt(raw, 10);
}

function readBooleanProperty(
  properties: ReadonlyMap<string, TmxProperty>,
  name: string,
  fallback: boolean,
  problems: ProblemList,
): boolean {
  const property = properties.get(name);
  if (property === undefined) return fallback;

  const raw = property.raw.trim();
  if (property.type !== 'bool' || (raw !== 'true' && raw !== 'false')) {
    problems.add(
      property.path,
      `phải là bool, nhận type=${JSON.stringify(property.type)} value=${JSON.stringify(property.raw)}`,
    );
    return fallback;
  }

  return raw === 'true';
}

function readStringProperty(
  properties: ReadonlyMap<string, TmxProperty>,
  name: string,
  problems: ProblemList,
): string | null {
  const property = properties.get(name);
  if (property === undefined) return null;

  if (property.type !== 'string') {
    problems.add(property.path, `phải là string, nhận type=${JSON.stringify(property.type)}`);
    return null;
  }

  return property.raw;
}

function isEnemyRole(value: string): value is EnemyRole {
  return (ENEMY_ROLES as readonly string[]).includes(value);
}

function isObstacleKind(value: string): value is ObstacleKind {
  return (OBSTACLE_KINDS as readonly string[]).includes(value);
}

/** Toạ độ pixel Tiled → tile unit. Không làm tròn: Tiled cho phép nửa tile. */
function pixelsToTiles(value: number): number {
  return value / TILE_SIZE_PX;
}

interface RawObject {
  readonly element: XmlElement;
  readonly name: string;
  readonly path: string;
  readonly properties: ReadonlyMap<string, TmxProperty>;
}

function readObjects(
  map: XmlElement,
  problems: ProblemList,
): { playerStart: Vec2 | null; bossStart: Vec2 | null; waves: Wave[]; obstacles: LevelData['obstacles']; doors: Door[] } {
  const result = {
    playerStart: null as Vec2 | null,
    bossStart: null as Vec2 | null,
    waves: [] as Wave[],
    obstacles: [] as LevelData['obstacles'],
    doors: [] as Door[],
  };

  const groups = childrenNamed(map, 'objectgroup');
  if (groups.length === 0) {
    problems.add('map', 'cần ít nhất một <objectgroup> (playerStart, spawn, obstacle, door)');
    return result;
  }

  // `<group>` lồng nhau không được hỗ trợ: object bên trong sẽ bị bỏ qua im lặng.
  for (const child of map.children) {
    if (child.name === 'group') {
      problems.add('map', 'không hỗ trợ <group> lồng nhau; để objectgroup ở cấp map');
    }
  }

  const objects: RawObject[] = [];
  groups.forEach((group, groupIndex) => {
    const groupName = group.attributes['name'] ?? `#${groupIndex}`;
    const groupPath = `objectgroup[${groupIndex}](${groupName})`;
    const groupProperties = readProperties(group, groupPath, problems);
    if (groupProperties.size > 0) {
      problems.add(groupPath, 'objectgroup không dùng property; khai báo trên từng object');
    }

    group.children.forEach((element, objectIndex) => {
      if (element.name !== 'object') {
        const path = `${groupPath}.children[${objectIndex}]`;
        problems.add(path, `chỉ nhận <object>, gặp <${element.name}>`);
        return;
      }

      const path = `${groupPath}.objects[${objectIndex}]`;
      const name = requiredAttribute(element, 'name', path, problems);
      if (name === null) return;

      const rotation = optionalNumber(element, 'rotation', 0, path, problems);
      if (rotation !== 0) {
        problems.add(path, `rotation phải bằng 0 (collision là hình chữ nhật), nhận ${rotation}`);
        return;
      }

      objects.push({ element, name, path, properties: readProperties(element, path, problems) });
    });
  });

  const waveIndices = new Map<number, EnemySpawn[]>();

  for (const object of objects) {
    const { element, name, path, properties } = object;
    const x = requiredNumber(element, 'x', path, problems);
    const y = requiredNumber(element, 'y', path, problems);
    if (x === null || y === null) continue;

    switch (name) {
      case TMX_OBJECTS.playerStart: {
        if (result.playerStart !== null) {
          problems.add(path, 'chỉ được có đúng một playerStart');
          break;
        }
        result.playerStart = { x: pixelsToTiles(x), y: pixelsToTiles(y) };
        break;
      }

      case TMX_OBJECTS.bossStart: {
        if (result.bossStart !== null) {
          problems.add(path, 'chỉ được có tối đa một bossStart');
          break;
        }
        result.bossStart = { x: pixelsToTiles(x), y: pixelsToTiles(y) };
        break;
      }

      case TMX_OBJECTS.spawn: {
        const role = readStringProperty(properties, 'role', problems);
        if (role === null) {
          problems.add(path, 'spawn cần property "role" (chaser|caster|tank)');
          break;
        }
        if (!isEnemyRole(role)) {
          problems.add(path, `role không hợp lệ ${JSON.stringify(role)}; chỉ nhận ${ENEMY_ROLES.join(', ')}`);
          break;
        }

        const wave = readIntegerProperty(properties, 'wave', path, true, problems);
        if (wave === null) break;
        if (wave < 1) {
          problems.add(path, `wave phải >= 1, nhận ${wave}`);
          break;
        }

        const elite = readBooleanProperty(properties, 'elite', false, problems);
        const enemies = waveIndices.get(wave) ?? [];
        enemies.push({ role, at: { x: pixelsToTiles(x), y: pixelsToTiles(y) }, elite });
        waveIndices.set(wave, enemies);
        break;
      }

      case TMX_OBJECTS.obstacle: {
        const kind = readStringProperty(properties, 'kind', problems);
        if (kind === null) {
          problems.add(path, 'obstacle cần property "kind" (pillar|wall|pit)');
          break;
        }
        if (!isObstacleKind(kind)) {
          problems.add(path, `kind không hợp lệ ${JSON.stringify(kind)}; chỉ nhận ${OBSTACLE_KINDS.join(', ')}`);
          break;
        }

        const width = requiredNumber(element, 'width', path, problems);
        const height = requiredNumber(element, 'height', path, problems);
        if (width === null || height === null) break;

        result.obstacles.push({
          kind,
          x: pixelsToTiles(x),
          y: pixelsToTiles(y),
          width: pixelsToTiles(width),
          height: pixelsToTiles(height),
        });
        break;
      }

      case TMX_OBJECTS.door: {
        const toRoom = readIntegerProperty(properties, 'toRoom', path, false, problems);
        if (properties.has('toRoom') && toRoom === null) break;
        result.doors.push({ at: { x: pixelsToTiles(x), y: pixelsToTiles(y) }, toRoom });
        break;
      }

      default:
        problems.add(
          path,
          `object tên ${JSON.stringify(name)} không có trong quy ước ` +
            `(${Object.values(TMX_OBJECTS).join(', ')})`,
        );
    }
  }

  if (result.playerStart === null) {
    problems.add('map', 'thiếu object "playerStart"');
  }

  // Wave phải liền mạch 1..N: đứt quãng nghĩa là có spawn bị gán nhầm wave.
  const indices = Array.from(waveIndices.keys()).sort((a, b) => a - b);
  indices.forEach((index, position) => {
    if (index !== position + 1) {
      problems.add(
        'map',
        `wave phải liền mạch từ 1; thiếu wave ${position + 1} (đang có ${indices.join(', ')})`,
      );
    }
    const enemies = waveIndices.get(index);
    if (enemies !== undefined) result.waves.push({ enemies });
  });

  if (result.waves.length === 0) {
    problems.add('map', 'cần ít nhất một object "spawn"');
  }

  return result;
}

/** Kiểm tra tile layer: đúng kích thước map, CSV thì đủ ô. */
function checkTileLayers(map: XmlElement, problems: ProblemList): void {
  const layers = childrenNamed(map, 'layer');
  if (layers.length === 0) {
    problems.add('map', 'cần ít nhất một <layer> sàn để TiledMap vẽ phòng');
    return;
  }

  layers.forEach((layer, index) => {
    const name = layer.attributes['name'] ?? `#${index}`;
    const path = `layer[${index}](${name})`;

    const width = requiredNumber(layer, 'width', path, problems);
    const height = requiredNumber(layer, 'height', path, problems);
    if (width !== null && width !== ROOM_COLS) {
      problems.add(path, `width phải bằng ${ROOM_COLS}, nhận ${width}`);
    }
    if (height !== null && height !== ROOM_ROWS) {
      problems.add(path, `height phải bằng ${ROOM_ROWS}, nhận ${height}`);
    }

    const data = firstChild(layer, 'data');
    if (data === null) {
      problems.add(path, 'thiếu <data>');
      return;
    }

    if (data.attributes['encoding'] !== 'csv') return;

    const values = elementText(data).split(',');
    if (values.length !== ROOM_COLS * ROOM_ROWS) {
      problems.add(
        path,
        `CSV có ${values.length} ô, cần ${ROOM_COLS * ROOM_ROWS} (${ROOM_COLS}×${ROOM_ROWS})`,
      );
      return;
    }

    const invalid = values.find((value) => !/^\d+$/.test(value.trim()));
    if (invalid !== undefined) {
      problems.add(path, `CSV có giá trị không phải số nguyên không âm: ${JSON.stringify(invalid)}`);
    }
  });
}

export interface ParseTmxOptions {
  /** Tên file/asset để message lỗi chỉ đúng chỗ. */
  readonly source?: string;
}

/**
 * Parse một file `.tmx` thành `LevelData` đã validate.
 *
 * Ném `Error` gồm **mọi** lỗi tìm thấy (cú pháp XML, quy ước TMX, rồi schema
 * `LevelData`), để sửa một lần thay vì mò từng lỗi.
 */
export function parseTmxLevel(xml: string, options: ParseTmxOptions = {}): LevelData {
  const source = options.source ?? 'tmx';
  const problems = new ProblemList();

  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${source}: ${message}`);
  }

  if (root.name !== 'map') {
    problems.add('map', `phần tử gốc phải là <map>, nhận <${root.name}>`);
    problems.throwIfAny(source);
  }

  const orientation = root.attributes['orientation'];
  if (orientation !== 'orthogonal') {
    problems.add('map', `orientation phải là "orthogonal", nhận ${describe(orientation)}`);
  }

  const width = requiredNumber(root, 'width', 'map', problems);
  const height = requiredNumber(root, 'height', 'map', problems);
  const tileWidth = requiredNumber(root, 'tilewidth', 'map', problems);
  const tileHeight = requiredNumber(root, 'tileheight', 'map', problems);

  if (width !== null && width !== ROOM_COLS) {
    problems.add('map', `width phải bằng ${ROOM_COLS}, nhận ${width}`);
  }
  if (height !== null && height !== ROOM_ROWS) {
    problems.add('map', `height phải bằng ${ROOM_ROWS}, nhận ${height}`);
  }
  if (tileWidth !== null && tileWidth !== TILE_SIZE_PX) {
    problems.add('map', `tilewidth phải bằng ${TILE_SIZE_PX}, nhận ${tileWidth}`);
  }
  if (tileHeight !== null && tileHeight !== TILE_SIZE_PX) {
    problems.add('map', `tileheight phải bằng ${TILE_SIZE_PX}, nhận ${tileHeight}`);
  }

  checkTileLayers(root, problems);

  const mapProperties = readProperties(root, 'map', problems);
  const chapter = readIntegerProperty(mapProperties, 'chapter', 'map', true, problems);
  const room = readIntegerProperty(mapProperties, 'room', 'map', true, problems);
  const isBossRoom = readBooleanProperty(mapProperties, 'isBossRoom', false, problems);
  const bossName = readStringProperty(mapProperties, 'boss', problems);

  if (chapter !== null && (chapter < 1 || chapter > 3)) {
    problems.add('map.properties.chapter', `phải là số nguyên 1..3, nhận ${chapter}`);
  }
  if (room !== null && room < 1) {
    problems.add('map.properties.room', `phải là số nguyên >= 1, nhận ${room}`);
  }

  const objects = readObjects(root, problems);

  problems.throwIfAny(source);

  const chapterValue = chapter ?? 1;
  const roomValue = room ?? 1;

  const raw: unknown = {
    id: `ch${chapterValue}-r${roomValue}`,
    chapter: chapterValue,
    room: roomValue,
    isBossRoom,
    size: { cols: ROOM_COLS, rows: ROOM_ROWS },
    tileSizePx: TILE_SIZE_PX,
    playerStart: objects.playerStart,
    waves: objects.waves,
    obstacles: objects.obstacles,
    doors: objects.doors,
    ...(bossName !== null ? { boss: { name: bossName } satisfies BossInfo } : {}),
    ...(objects.bossStart !== null ? { bossStart: objects.bossStart } : {}),
  };

  try {
    return parseLevelData(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${source}: ${message}`);
  }
}
