/**
 * Rooms from text layouts (ticket #20).
 *
 * A room spec is 18 rows of 32 characters; a legend maps each character to a tile gid and
 * optionally to an object (obstacle, player start, spawn, door). `buildRoomTmx` writes a
 * `.tmx` that `parseTmxLevel` accepts. `buildTsx` writes the tileset file Tiled rooms reference.
 */
import type { EnemyRole, ObstacleKind } from '../../assets/scripts/core/level/level-data';

export interface LegendEntry {
  /** Tile gid written as-is into the floor layer (0 = empty). */
  readonly tile: number;
  readonly obstacle?: ObstacleKind;
  readonly playerStart?: true;
  readonly spawn?: { readonly role: EnemyRole; readonly wave: number; readonly elite?: boolean };
  readonly door?: { readonly toRoom?: number };
}

export interface RoomLayoutSpec {
  readonly chapter: number;
  readonly room: number;
  readonly isBossRoom?: boolean;
  readonly boss?: string;
  readonly tilesets: readonly { readonly source: string; readonly firstgid: number }[];
  readonly legend: Readonly<Record<string, LegendEntry>>;
  readonly rows: readonly string[];
}

export interface TsxSpec {
  readonly name: string;
  /** Image path relative to the `.tsx` file. */
  readonly image: string;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly columns: number;
  readonly tilecount: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
}

/** A room is exactly `ROOM_COLS × ROOM_ROWS` tiles of `TILE_SIZE_PX` (see `core/level/tmx.ts`). */
const COLS = 32;
const ROWS = 18;
const TILE = 16;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Merge same-kind obstacle cells into rectangles: horizontal runs first, then stack equal
 * runs vertically. Every obstacle cell is covered exactly once.
 */
function mergeObstacles(mask: readonly (readonly boolean[])[]): Rect[] {
  interface Run {
    readonly x: number;
    readonly width: number;
    y: number;
    height: number;
  }
  const runs: Run[] = [];
  mask.forEach((row, y) => {
    let x = 0;
    while (x < COLS) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < COLS && row[x]) x += 1;
      runs.push({ x: start, width: x - start, y, height: 1 });
    }
  });
  // Stack runs with the same horizontal extent when they sit on consecutive rows.
  const merged: Run[] = [];
  for (const run of runs) {
    const above = merged.find(
      (candidate) => candidate.x === run.x && candidate.width === run.width && candidate.y + candidate.height === run.y,
    );
    if (above === undefined) merged.push({ ...run });
    else above.height += 1;
  }
  return merged.map((run) => ({ x: run.x, y: run.y, width: run.width, height: run.height }));
}

function pointObject(id: number, name: string, x: number, y: number, properties: string): string {
  const body = properties === '' ? '<point/>' : `<properties>\n${properties}\n    </properties>\n   <point/>`;
  return `  <object id="${id}" name="${escapeXml(name)}" x="${x}" y="${y}">\n   ${body}</object>`;
}

function property(name: string, value: string, type?: 'int' | 'bool'): string {
  const typeAttribute = type === undefined ? '' : ` type="${type}"`;
  return `    <property name="${escapeXml(name)}"${typeAttribute} value="${escapeXml(value)}"/>`;
}

/** `.tmx` from a text layout. Throws on anything `parseTmxLevel` would reject later. */
export function buildRoomTmx(spec: RoomLayoutSpec): string {
  if (spec.rows.length !== ROWS) {
    throw new Error(`room layout must have exactly 18 rows, got ${spec.rows.length}`);
  }
  spec.rows.forEach((row, y) => {
    if (row.length !== COLS) {
      throw new Error(`room layout row ${y} must have exactly 32 characters, got ${row.length}`);
    }
    [...row].forEach((char, x) => {
      if (spec.legend[char] === undefined) {
        throw new Error(`room layout row ${y} column ${x} uses "${char}", which is not in the legend`);
      }
    });
  });

  const gids = spec.rows.map((row) => [...row].map((char) => spec.legend[char]!.tile));

  const obstacleKinds = new Set<ObstacleKind>();
  spec.rows.forEach((row) => {
    [...row].forEach((char) => {
      const obstacle = spec.legend[char]!.obstacle;
      if (obstacle !== undefined) obstacleKinds.add(obstacle);
    });
  });
  const obstacleRects: Array<{ kind: ObstacleKind; rect: Rect }> = [];
  for (const kind of obstacleKinds) {
    const mask = spec.rows.map((row) => [...row].map((char) => spec.legend[char]!.obstacle === kind));
    for (const rect of mergeObstacles(mask)) obstacleRects.push({ kind, rect });
  }

  const objects: Array<() => string> = [];
  spec.rows.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const entry = spec.legend[char]!;
      const centre = { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
      if (entry.playerStart === true) {
        objects.push(() => pointObject(0, 'playerStart', centre.x, centre.y, ''));
      }
      if (entry.spawn !== undefined) {
        const spawn = entry.spawn;
        const properties = [
          property('role', spawn.role),
          property('wave', String(spawn.wave), 'int'),
          property('elite', spawn.elite === true ? 'true' : 'false', 'bool'),
        ].join('\n');
        objects.push(() => pointObject(0, 'spawn', centre.x, centre.y, properties));
      }
      if (entry.door !== undefined) {
        const toRoom = entry.door.toRoom;
        const properties =
          toRoom === undefined ? '' : property('toRoom', String(toRoom), 'int');
        objects.push(() => pointObject(0, 'door', centre.x, centre.y, properties));
      }
    });
  });

  const objectXml: string[] = [];
  let nextObjectId = 1;
  for (const build of objects) objectXml.push(build().replace('id="0"', `id="${nextObjectId++}"`));
  for (const { kind, rect } of obstacleRects) {
    objectXml.push(
      `  <object id="${nextObjectId++}" name="obstacle" x="${rect.x * TILE}" y="${rect.y * TILE}" ` +
        `width="${rect.width * TILE}" height="${rect.height * TILE}">\n` +
        `   <properties>\n${property('kind', kind)}\n    </properties>\n  </object>`,
    );
  }

  const properties = [
    property('chapter', String(spec.chapter), 'int'),
    property('room', String(spec.room), 'int'),
    property('isBossRoom', spec.isBossRoom === true ? 'true' : 'false', 'bool'),
    ...(spec.isBossRoom === true && spec.boss !== undefined ? [property('boss', spec.boss)] : []),
  ].join('\n');
  const tilesets = spec.tilesets
    .map((tileset) => ` <tileset firstgid="${tileset.firstgid}" source="${escapeXml(tileset.source)}"/>`)
    .join('\n');
  const csv = gids.map((row) => row.join(',')).join(',\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<map version="1.10" tiledversion="1.11.0" orientation="orthogonal" renderorder="right-down" ` +
      `width="${COLS}" height="${ROWS}" tilewidth="${TILE}" tileheight="${TILE}" infinite="0" ` +
      `nextlayerid="2" nextobjectid="${nextObjectId}">`,
    ' <properties>',
    properties,
    ' </properties>',
    tilesets,
    ' <layer id="1" name="floor" width="32" height="18">',
    '  <data encoding="csv">',
    csv,
    '  </data>',
    ' </layer>',
    ' <objectgroup id="2" name="objects">',
    ...objectXml,
    ' </objectgroup>',
    '</map>',
    '',
  ].join('\n');
}

/** `.tsx` Tiled loads next to the rooms that use the tileset. */
export function buildTsx(spec: TsxSpec): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<tileset version="1.10" tiledversion="1.11.0" name="${escapeXml(spec.name)}" ` +
      `tilewidth="${spec.tileWidth}" tileheight="${spec.tileHeight}" tilecount="${spec.tilecount}" ` +
      `columns="${spec.columns}">`,
    ` <image source="${escapeXml(spec.image)}" width="${spec.imageWidth}" height="${spec.imageHeight}"/>`,
    '</tileset>',
    '',
  ].join('\n');
}
