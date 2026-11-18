/**
 * `.tmx` → `LevelData`. **One** parser for both vitest (Node) and the Cocos runtime:
 * bootstrap takes the XML from `TiledMapAsset.tmxXmlStr` and calls this same function, and tests
 * read real `.tmx` files from disk. There is no second parse path to drift.
 *
 * ## Room file convention (`assets/resources/data/levels/chapter-<n>/room-<r>.tmx`)
 *
 * - Map: `orientation="orthogonal"`, `width=32`, `height=18`, `tilewidth=16`,
 *   `tileheight=16`. Wrong dimensions are an error: each room is exactly one 512×288 screen.
 * - Tile layers: the `<layer>`s (usually just one `floor` layer) are drawn by the
 *   `TiledMap` component. The parser does **not** infer collision from tiles; collision data lives
 *   in the object layer. The data layer should be `encoding="csv"` (the parser checks the cell count when it
 *   sees CSV; base64/gzip is left to the engine — not a format we author).
 * - Object layers (any name, usually `objects`): each object is identified by
 *   **`name`**, coordinates are Tiled pixels (16 px = 1 tile):
 *
 *   | name         | type     | required properties                 | meaning |
 *   |--------------|----------|-------------------------------------|---------|
 *   | `playerStart`| point    | —                                   | player position, exactly 1 object |
 *   | `spawn`      | point    | `role`, `wave` (int ≥ 1); `elite` (bool, default false) | 1 enemy; `role` ∈ chaser/caster/tank |
 *   | `obstacle`   | rect     | `kind` ∈ pillar/wall/pit            | obstacle: x/y/width/height are pixels |
 *   | `door`       | point    | `toRoom` (int ≥ 1) or absent        | no `toRoom` = chapter exit door (`null`) |
 *   | `bossStart`  | point    | — (boss room only)                  | where the boss stands; default (16, 5) |
 *
 *   An object with any other name ⇒ **error**, so a typo cannot silently become a skipped object.
 *   `rotation` must be 0 (collisions are axis-aligned rectangles).
 * - Map properties:
 *
 *   | name         | type   | required | meaning |
 *   |--------------|--------|----------|---------|
 *   | `chapter`    | int    | yes      | 1..3 |
 *   | `room`       | int    | yes      | ≥ 1, unique within the same folder |
 *   | `isBossRoom` | bool   | no       | defaults to false |
 *   | `boss`       | string | for boss | sprite name in `BOSSES` (e.g. `TenguBlue`) |
 *
 * - Waves: `spawn`s sharing the same `wave` merge into one wave; the indices must be contiguous
 *   `1..N` (wave 3 without wave 2 is an error). Adding a room = adding a `.tmx` file,
 *   no code change; the total room count is derived from the file count (`chapterFromLevels`).
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

/** Object names in the object layer — see the convention table at the top of the file. */
export const TMX_OBJECTS = {
  playerStart: 'playerStart',
  spawn: 'spawn',
  obstacle: 'obstacle',
  door: 'door',
  bossStart: 'bossStart',
} as const;

/** Collect every problem then throw a single `Error` (same shape as `level-data.ts`). */
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
    throw new Error(`${source}: invalid TMX (${this.items.length} problem(s))\n${details}`);
  }
}

interface TmxProperty {
  readonly name: string;
  readonly raw: string;
  readonly type: string;
  readonly path: string;
}

function describe(value: string | undefined): string {
  return value === undefined ? 'missing' : JSON.stringify(value);
}

/** String attribute, required. */
function requiredAttribute(
  element: XmlElement,
  name: string,
  path: string,
  problems: ProblemList,
): string | null {
  const value = element.attributes[name];
  if (value === undefined || value.trim() === '') {
    problems.add(path, `missing attribute "${name}"`);
    return null;
  }
  return value;
}

/** Numeric attribute (finite), required. */
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
    problems.add(path, `attribute "${name}" must be a number, got ${JSON.stringify(raw)}`);
    return null;
  }
  return value;
}

/** Numeric attribute, with a default when absent. */
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
    problems.add(path, `attribute "${name}" must be a number, got ${JSON.stringify(raw)}`);
    return fallback;
  }
  return value;
}

/**
 * Direct `<properties>` of `element` → map name → raw property.
 * Duplicate property names are an error: `get` would return one and silently drop the other.
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
      problems.add(`${path}.properties[${index}]`, `only <property> allowed, found <${property.name}>`);
      return;
    }

    const propertyPath = `${path}.properties[${index}]`;
    const name = requiredAttribute(property, 'name', propertyPath, problems);
    if (name === null) return;

    if (result.has(name)) {
      problems.add(propertyPath, `property "${name}" is declared more than once`);
      return;
    }

    // Tiled stores bool/int as a `value` attribute; the type lives in `type`.
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
    if (required) problems.add(namePath, `missing property "${name}"`);
    return null;
  }

  const raw = property.raw.trim();
  if (property.type !== 'int' || !/^-?\d+$/.test(raw)) {
    problems.add(property.path, `must be an int, got type=${JSON.stringify(property.type)} value=${JSON.stringify(property.raw)}`);
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
      `must be a bool, got type=${JSON.stringify(property.type)} value=${JSON.stringify(property.raw)}`,
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
    problems.add(property.path, `must be a string, got type=${JSON.stringify(property.type)}`);
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

/** Tiled pixel coordinates → tile units. No rounding: Tiled allows half tiles. */
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
    problems.add('map', 'at least one <objectgroup> is required (playerStart, spawn, obstacle, door)');
    return result;
  }

  // Nested `<group>` is not supported: objects inside would be silently skipped.
  for (const child of map.children) {
    if (child.name === 'group') {
      problems.add('map', 'nested <group> is not supported; put objectgroup at the map level');
    }
  }

  const objects: RawObject[] = [];
  groups.forEach((group, groupIndex) => {
    const groupName = group.attributes['name'] ?? `#${groupIndex}`;
    const groupPath = `objectgroup[${groupIndex}](${groupName})`;
    const groupProperties = readProperties(group, groupPath, problems);
    if (groupProperties.size > 0) {
      problems.add(groupPath, 'objectgroups do not take properties; declare them on each object');
    }

    group.children.forEach((element, objectIndex) => {
      if (element.name !== 'object') {
        const path = `${groupPath}.children[${objectIndex}]`;
        problems.add(path, `only <object> allowed, found <${element.name}>`);
        return;
      }

      const path = `${groupPath}.objects[${objectIndex}]`;
      const name = requiredAttribute(element, 'name', path, problems);
      if (name === null) return;

      const rotation = optionalNumber(element, 'rotation', 0, path, problems);
      if (rotation !== 0) {
        problems.add(path, `rotation must be 0 (collisions are rectangles), got ${rotation}`);
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
          problems.add(path, 'exactly one playerStart is allowed');
          break;
        }
        result.playerStart = { x: pixelsToTiles(x), y: pixelsToTiles(y) };
        break;
      }

      case TMX_OBJECTS.bossStart: {
        if (result.bossStart !== null) {
          problems.add(path, 'at most one bossStart is allowed');
          break;
        }
        result.bossStart = { x: pixelsToTiles(x), y: pixelsToTiles(y) };
        break;
      }

      case TMX_OBJECTS.spawn: {
        const role = readStringProperty(properties, 'role', problems);
        if (role === null) {
          problems.add(path, 'spawn requires the "role" property (chaser|caster|tank)');
          break;
        }
        if (!isEnemyRole(role)) {
          problems.add(path, `invalid role ${JSON.stringify(role)}; expected one of ${ENEMY_ROLES.join(', ')}`);
          break;
        }

        const wave = readIntegerProperty(properties, 'wave', path, true, problems);
        if (wave === null) break;
        if (wave < 1) {
          problems.add(path, `wave must be >= 1, got ${wave}`);
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
          problems.add(path, `obstacle requires the "kind" property (${OBSTACLE_KINDS.join('|')})`);
          break;
        }
        if (!isObstacleKind(kind)) {
          problems.add(path, `invalid kind ${JSON.stringify(kind)}; expected one of ${OBSTACLE_KINDS.join(', ')}`);
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
          `object name ${JSON.stringify(name)} is not in the convention ` +
            `(${Object.values(TMX_OBJECTS).join(', ')})`,
        );
    }
  }

  if (result.playerStart === null) {
    problems.add('map', 'missing object "playerStart"');
  }

  // Waves must be contiguous 1..N: a gap means some spawn got the wrong wave.
  const indices = Array.from(waveIndices.keys()).sort((a, b) => a - b);
  indices.forEach((index, position) => {
    if (index !== position + 1) {
      problems.add(
        'map',
        `wave must be contiguous from 1; missing wave ${position + 1} (have ${indices.join(', ')})`,
      );
    }
    const enemies = waveIndices.get(index);
    if (enemies !== undefined) result.waves.push({ enemies });
  });

  if (result.waves.length === 0) {
    problems.add('map', 'at least one "spawn" object is required');
  }

  return result;
}

/** Check the tile layer: correct map size, and enough cells for CSV. */
function checkTileLayers(map: XmlElement, problems: ProblemList): void {
  const layers = childrenNamed(map, 'layer');
  if (layers.length === 0) {
    problems.add('map', 'at least one <layer> floor is required for TiledMap to draw the room');
    return;
  }

  layers.forEach((layer, index) => {
    const name = layer.attributes['name'] ?? `#${index}`;
    const path = `layer[${index}](${name})`;

    const width = requiredNumber(layer, 'width', path, problems);
    const height = requiredNumber(layer, 'height', path, problems);
    if (width !== null && width !== ROOM_COLS) {
      problems.add(path, `width must equal ${ROOM_COLS}, got ${width}`);
    }
    if (height !== null && height !== ROOM_ROWS) {
      problems.add(path, `height must equal ${ROOM_ROWS}, got ${height}`);
    }

    const data = firstChild(layer, 'data');
    if (data === null) {
      problems.add(path, 'missing <data>');
      return;
    }

    if (data.attributes['encoding'] !== 'csv') return;

    const values = elementText(data).split(',');
    if (values.length !== ROOM_COLS * ROOM_ROWS) {
      problems.add(
        path,
        `CSV has ${values.length} cells, expected ${ROOM_COLS * ROOM_ROWS} (${ROOM_COLS}×${ROOM_ROWS})`,
      );
      return;
    }

    const invalid = values.find((value) => !/^\d+$/.test(value.trim()));
    if (invalid !== undefined) {
      problems.add(path, `CSV has a value that is not a non-negative integer: ${JSON.stringify(invalid)}`);
    }
  });
}

export interface ParseTmxOptions {
  /** File/asset name so error messages point at the right place. */
  readonly source?: string;
}

/**
 * Parse one `.tmx` file into a validated `LevelData`.
 *
 * Throws an `Error` with **every** problem found (XML syntax, TMX convention, then the
 * `LevelData` schema) so you can fix all at once instead of hunting one at a time.
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
    problems.add('map', `root element must be <map>, got <${root.name}>`);
    problems.throwIfAny(source);
  }

  const orientation = root.attributes['orientation'];
  if (orientation !== 'orthogonal') {
    problems.add('map', `orientation must be "orthogonal", got ${describe(orientation)}`);
  }

  const width = requiredNumber(root, 'width', 'map', problems);
  const height = requiredNumber(root, 'height', 'map', problems);
  const tileWidth = requiredNumber(root, 'tilewidth', 'map', problems);
  const tileHeight = requiredNumber(root, 'tileheight', 'map', problems);

  if (width !== null && width !== ROOM_COLS) {
    problems.add('map', `width must equal ${ROOM_COLS}, got ${width}`);
  }
  if (height !== null && height !== ROOM_ROWS) {
    problems.add('map', `height must equal ${ROOM_ROWS}, got ${height}`);
  }
  if (tileWidth !== null && tileWidth !== TILE_SIZE_PX) {
    problems.add('map', `tilewidth must equal ${TILE_SIZE_PX}, got ${tileWidth}`);
  }
  if (tileHeight !== null && tileHeight !== TILE_SIZE_PX) {
    problems.add('map', `tileheight must equal ${TILE_SIZE_PX}, got ${tileHeight}`);
  }

  checkTileLayers(root, problems);

  const mapProperties = readProperties(root, 'map', problems);
  const chapter = readIntegerProperty(mapProperties, 'chapter', 'map', true, problems);
  const room = readIntegerProperty(mapProperties, 'room', 'map', true, problems);
  const isBossRoom = readBooleanProperty(mapProperties, 'isBossRoom', false, problems);
  const bossName = readStringProperty(mapProperties, 'boss', problems);

  if (chapter !== null && (chapter < 1 || chapter > 3)) {
    problems.add('map.properties.chapter', `must be an integer 1..3, got ${chapter}`);
  }
  if (room !== null && room < 1) {
    problems.add('map.properties.room', `must be an integer >= 1, got ${room}`);
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
