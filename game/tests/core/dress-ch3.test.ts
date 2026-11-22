/**
 * Acceptance test for ticket #7 — re-dress chapter 3 + the boss arena (M8).
 *
 * Reads the real `.tmx`/`.tsx`/PNG files on disk (the output of `scripts/dress-rooms.ts`), so it
 * checks what the game actually loads, not the script's intent.
 *
 * Vocabulary:
 * - **border cell**: row 0 or 17, column 0 or 31. Actors are clamped 1 tile away from the edge
 *   (`ROOM_EDGE_MARGIN_TILES`), so solid-looking art there changes nothing in gameplay.
 * - **flat tile**: ground decor you could walk over (paving/moss patches, leaves, low bushes, bones).
 *   Every other ch3 decor tile **looks solid**.
 * - **art-connected**: two neighbouring tiles in a tileset PNG whose touching edges share at least
 *   `CONNECT_MIN_PIXELS` pairs of opaque pixels — they are two pieces of one drawn prop. Placing one
 *   piece without its neighbour is the "torn paper" look this ticket removes.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Obstacle } from '../../assets/scripts/core/level/level-data';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';
import { readPng, type PngImage } from '../../scripts/lib/png';
import { findTmxFiles, LEVELS_ROOT, type TmxFile } from '../helpers/tmx-levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, '../..');
const TILE = 16;
const CONNECT_MIN_PIXELS = 4;
/** Tiled flip flags live in the top 3 bits of a gid; this project never flips tiles. */
const MAX_PLAIN_GID = 0x1fffffff;

/** Flat tiles per ch3 tileset name (1-based local ids, as `dress-rooms.ts` uses them). */
const FLAT_TILES: Readonly<Record<string, ReadonlySet<number>>> = {
  // VillageAbandoned: moss/paving patches (rows 3-6), low bushes (105-106), fallen leaves.
  village: new Set([67, 68, 69, 70, 87, 88, 89, 90, 91, 105, 106, 108, 109, 128, 129, 165, 166, 225, 226]),
  // Desert: dry bush, sprig, bones/skulls.
  ground: new Set([189, 190, 237, 238, 239, 240]),
};

const NATURE_OR_ELEMENT = [
  'resources/art/tilesets/TilesetNature.png',
  'resources/art/tilesets/TilesetElement.png',
];
const CH3_SHEETS = [
  'resources/art/tilesets/TilesetVillageAbandoned.png',
  'resources/art/tilesets/TilesetHouse.png',
  'resources/art/tilesets/TilesetTowers.png',
  'resources/art/tilesets/TilesetHole.png',
  'resources/art/tilesets/TilesetDesert.png',
];

// ---------------------------------------------------------------------------
// Reading .tmx / .tsx / PNG
// ---------------------------------------------------------------------------

interface Tileset {
  readonly firstgid: number;
  readonly source: string;
  readonly name: string;
  readonly columns: number;
  readonly tilecount: number;
  readonly imagePath: string;
  readonly declaredWidth: number;
  readonly declaredHeight: number;
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

function readTilesets(file: TmxFile): Tileset[] {
  const dir = dirname(file.path);
  return [...file.xml.matchAll(/<tileset\b[^>]*\/>/g)].map((match) => {
    const tag = match[0];
    const source = attr(tag, 'source') ?? '';
    const tsxPath = join(dir, source);
    if (!existsSync(tsxPath)) throw new Error(`${file.name}: tileset source ${source} does not exist next to the .tmx`);
    const tsx = readFileSync(tsxPath, 'utf8');
    const tilesetTag = /<tileset\b[^>]*>/.exec(tsx)?.[0] ?? '';
    const imageTag = /<image\b[^>]*>/.exec(tsx)?.[0] ?? '';
    return {
      firstgid: Number(attr(tag, 'firstgid')),
      source,
      name: attr(tilesetTag, 'name') ?? '',
      columns: Number(attr(tilesetTag, 'columns')),
      tilecount: Number(attr(tilesetTag, 'tilecount')),
      imagePath: join(dirname(tsxPath), attr(imageTag, 'source') ?? ''),
      declaredWidth: Number(attr(imageTag, 'width')),
      declaredHeight: Number(attr(imageTag, 'height')),
    };
  });
}

function readLayer(file: TmxFile, name: string): number[] {
  const layers = [...file.xml.matchAll(/<layer\b[^>]*>[\s\S]*?<\/layer>/g)].filter(
    (match) => attr(/<layer\b[^>]*>/.exec(match[0])?.[0] ?? '', 'name') === name,
  );
  if (layers.length !== 1) throw new Error(`${file.name}: expected exactly 1 layer "${name}", found ${layers.length}`);
  const csv = /<data encoding="csv">([\s\S]*?)<\/data>/.exec(layers[0]![0])?.[1] ?? '';
  return csv
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map(Number);
}

const pngCache = new Map<string, PngImage>();
function png(path: string): PngImage {
  let image = pngCache.get(path);
  if (image === undefined) {
    image = readPng(path);
    pngCache.set(path, image);
  }
  return image;
}

function opaque(image: PngImage, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return false;
  return (image.data[(y * image.width + x) * 4 + 3] ?? 0) > 0;
}

type Direction = 'up' | 'down' | 'left' | 'right';
const STEP: Readonly<Record<Direction, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

/** Is local tile `local` art-connected to its sheet neighbour in `direction`? */
function artConnected(set: Tileset, local: number, direction: Direction): boolean {
  const image = png(set.imagePath);
  const col = (local - 1) % set.columns;
  const row = Math.floor((local - 1) / set.columns);
  const x0 = col * TILE;
  const y0 = row * TILE;
  let pairs = 0;
  for (let i = 0; i < TILE; i += 1) {
    const [a, b] =
      direction === 'right'
        ? [[x0 + TILE - 1, y0 + i], [x0 + TILE, y0 + i]]
        : direction === 'left'
          ? [[x0, y0 + i], [x0 - 1, y0 + i]]
          : direction === 'down'
            ? [[x0 + i, y0 + TILE - 1], [x0 + i, y0 + TILE]]
            : [[x0 + i, y0], [x0 + i, y0 - 1]];
    if (opaque(image, a[0]!, a[1]!) && opaque(image, b[0]!, b[1]!)) pairs += 1;
  }
  return pairs >= CONNECT_MIN_PIXELS;
}

/** Local id of the sheet neighbour in `direction`, or null when it falls outside the sheet. */
function sheetNeighbour(set: Tileset, local: number, direction: Direction): number | null {
  const col = (local - 1) % set.columns + STEP[direction][0];
  const row = Math.floor((local - 1) / set.columns) + STEP[direction][1];
  const rows = set.tilecount / set.columns;
  if (col < 0 || col >= set.columns || row < 0 || row >= rows) return null;
  return row * set.columns + col + 1;
}

interface DecorTile {
  readonly x: number;
  readonly y: number;
  readonly set: Tileset;
  readonly local: number;
}

interface Room {
  readonly file: TmxFile;
  readonly room: number;
  /** Real size of the room in tiles (32×18 boss arena, 64×36 pool room since #66). */
  readonly cols: number;
  readonly rows: number;
  readonly tilesets: Tileset[];
  readonly decor: (DecorTile | null)[];
  readonly obstacles: readonly Obstacle[];
}

function resolve(tilesets: readonly Tileset[], gid: number): { set: Tileset; local: number } | null {
  if (gid === 0) return null;
  const set = [...tilesets].reverse().find((entry) => gid >= entry.firstgid);
  if (set === undefined) return null;
  return { set, local: gid - set.firstgid + 1 };
}

function loadRoom(file: TmxFile): Room {
  const tilesets = readTilesets(file);
  const level = parseTmxLevel(file.xml, { source: file.name });
  const { cols, rows } = level.size;
  const decor = readLayer(file, 'decor').map((gid, index) => {
    const hit = resolve(tilesets, gid);
    return hit === null ? null : { x: index % cols, y: Math.floor(index / cols), ...hit };
  });
  return { file, room: level.room, cols, rows, tilesets, decor, obstacles: level.obstacles };
}

function chapterRooms(chapter: number): Room[] {
  return findTmxFiles(join(LEVELS_ROOT, `chapter-${chapter}`)).map(loadRoom);
}

function at(room: Room, x: number, y: number): DecorTile | null {
  if (x < 0 || x >= room.cols || y < 0 || y >= room.rows) return null;
  return room.decor[y * room.cols + x] ?? null;
}

function isBorder(room: Room, x: number, y: number): boolean {
  return x === 0 || x === room.cols - 1 || y === 0 || y === room.rows - 1;
}

function onObstacle(room: Room, x: number, y: number): boolean {
  return room.obstacles.some(
    (o) => x >= o.x && x < o.x + o.width && y >= o.y && y < o.y + o.height,
  );
}

function isFlat(tile: DecorTile): boolean {
  // #67 dresses ch3 with `TilesetFloorDetail` decals (tufts, pebbles, stepping stones) and the
  // `border` layer with foliage: every tile of that sheet is walk-over detail.
  if (tile.set.name === 'floordetail') return true;
  return FLAT_TILES[tile.set.name]?.has(tile.local) ?? false;
}

function describeTile(room: Room, tile: DecorTile): string {
  return `${room.file.name} (${tile.x},${tile.y}) ${tile.set.name}#${tile.local}`;
}

/** Village tiles grouped into drawn props: map-adjacent AND art-connected in that direction. */
function villageBlocks(room: Room): DecorTile[][] {
  const seen = new Set<string>();
  const blocks: DecorTile[][] = [];
  for (const start of room.decor) {
    if (start === null || start.set.name !== 'village' || seen.has(`${start.x},${start.y}`)) continue;
    const block: DecorTile[] = [];
    const queue = [start];
    seen.add(`${start.x},${start.y}`);
    while (queue.length > 0) {
      const tile = queue.pop()!;
      block.push(tile);
      for (const direction of Object.keys(STEP) as Direction[]) {
        if (!artConnected(tile.set, tile.local, direction)) continue;
        const next = at(room, tile.x + STEP[direction][0], tile.y + STEP[direction][1]);
        if (next === null || next.set.name !== 'village' || seen.has(`${next.x},${next.y}`)) continue;
        seen.add(`${next.x},${next.y}`);
        queue.push(next);
      }
    }
    blocks.push(block);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Obstacle visuals seam (core/level/obstacle-visuals.ts)
// ---------------------------------------------------------------------------

interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface ObstacleVisual {
  readonly sheet: string;
  readonly rect: TileRect;
  readonly tile: boolean;
}
type ObstacleVisualKey = 'pillar' | 'pillarSmall' | 'wall' | 'pit';
interface ObstacleVisualsModule {
  obstacleVisual(chapter: number, key: ObstacleVisualKey): ObstacleVisual;
}

async function loadObstacleVisuals(): Promise<ObstacleVisualsModule | null> {
  // Built at runtime so a missing module fails this assertion instead of the whole file.
  const path = ['..', '..', 'assets', 'scripts', 'core', 'level', 'obstacle-visuals'].join('/');
  try {
    return (await import(/* @vite-ignore */ path)) as ObstacleVisualsModule;
  } catch {
    return null;
  }
}

function sheetPath(sheet: string): string {
  return join(GAME, 'assets', sheet);
}

/** Same rule as `level-view.ts`: a 1×1 pillar uses the `pillarSmall` visual. */
function visualKey(obstacle: Obstacle & { kind: Exclude<Obstacle['kind'], 'prop'> }): ObstacleVisualKey {
  return obstacle.kind === 'pillar' && obstacle.width <= 1 && obstacle.height <= 1 ? 'pillarSmall' : obstacle.kind;
}
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('#7 the boss rooms keep their collision', () => {
  // #38 replaced the hand-dressed normal rooms with a generated pool; the boss rooms kept their
  // content (only the `room` property changed, 9 → 17), so the pre-ticket snapshot still pins them.
  it('every chapter boss room equals the pre-#38 snapshot of the authored obstacles', () => {
    const before = JSON.parse(
      readFileSync(join(HERE, '../fixtures/level-obstacles.json'), 'utf8'),
    ) as Record<string, Obstacle[]>;

    for (const chapter of [1, 2, 3]) {
      const files = findTmxFiles(join(LEVELS_ROOT, `chapter-${chapter}`));
      const file = files.find((candidate) => candidate.name.endsWith('room-17.tmx'));
      expect(file, `chapter ${chapter} boss file`).toBeDefined();
      if (file === undefined) continue;
      // #35 adds generated `prop` obstacles on top of these; the snapshot pins the authored ones.
      const now = parseTmxLevel(file.xml, { source: file.name }).obstacles.filter(
        (obstacle) => (obstacle.kind as string) !== 'prop',
      );
      expect(now, `chapter ${chapter} boss`).toEqual(before[`chapter-${chapter}/room-9.tmx`]);
    }
  });
});

describe('#7 every .tmx is valid', () => {
  const files = findTmxFiles();

  it.each(files.map((file) => [file.name, file] as const))('%s', (_name, file) => {
    expect(() => parseTmxLevel(file.xml, { source: file.name })).not.toThrow();

    const tilesets = readTilesets(file);
    expect(tilesets.length).toBeGreaterThan(0);
    let expectedFirstgid = 1;
    for (const set of tilesets) {
      expect(set.source, 'tileset source must be a bare file name next to the .tmx').not.toContain('/');
      expect(set.firstgid, `${set.source} firstgid`).toBe(expectedFirstgid);
      expect(existsSync(set.imagePath), `${set.source} image ${set.imagePath}`).toBe(true);
      const image = png(set.imagePath);
      expect([set.declaredWidth, set.declaredHeight], `${set.source} declared image size`).toEqual([image.width, image.height]);
      expect(set.columns * TILE, `${set.source} columns`).toBe(image.width);
      expect(set.tilecount, `${set.source} tilecount`).toBe(set.columns * (image.height / TILE));
      const meta = join(dirname(file.path), `${set.source}.meta`);
      expect(existsSync(meta), `${meta} exists`).toBe(true);
      expect((JSON.parse(readFileSync(meta, 'utf8')) as { importer?: string }).importer).toBe('text');
      expectedFirstgid += set.tilecount;
    }

    const level = parseTmxLevel(file.xml, { source: file.name });
    for (const layer of ['floor', 'decor']) {
      const data = readLayer(file, layer);
      expect(data, `${layer} cell count`).toHaveLength(level.size.cols * level.size.rows);
      for (const gid of data) {
        expect(Number.isInteger(gid) && gid >= 0 && gid <= MAX_PLAIN_GID, `${layer} gid ${gid}`).toBe(true);
        expect(gid, `${layer} gid ${gid} must belong to a declared tileset`).toBeLessThan(expectedFirstgid);
      }
    }

    const ids = [...file.xml.matchAll(/<(?:layer|objectgroup)\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));
    const nextLayerId = Number(/<map\b[^>]*\bnextlayerid="(\d+)"/.exec(file.xml)?.[1]);
    expect(new Set(ids).size, 'layer ids are unique').toBe(ids.length);
    expect(Math.max(...ids), 'nextlayerid is above every layer id').toBeLessThan(nextLayerId);
  });
});

describe('#7 chapter 3 decor follows collision', () => {
  const rooms = chapterRooms(3);

  it('has the whole pool: 16 normal rooms + the boss last', () => {
    const numbers = rooms.map((room) => room.room).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_value, index) => index + 1));
    expect(numbers.length).toBeGreaterThanOrEqual(15);
    const bossRoom = numbers[numbers.length - 1] ?? 0;
    expect(numbers.filter((number) => number === bossRoom)).toHaveLength(1);
  });

  it('every solid-looking decor tile sits on an obstacle or a border cell', () => {
    const offenders = rooms.flatMap((room) =>
      room.decor
        .filter((tile): tile is DecorTile => tile !== null && !isFlat(tile))
        .filter((tile) => !isBorder(room, tile.x, tile.y) && !onObstacle(room, tile.x, tile.y))
        .map((tile) => describeTile(room, tile)),
    );

    expect(offenders).toEqual([]);
  });

  it('no torn paper: every art-connected piece is placed with its neighbour (or runs off the room edge)', () => {
    const offenders: string[] = [];
    for (const room of rooms) {
      for (const tile of room.decor) {
        if (tile === null) continue;
        for (const direction of Object.keys(STEP) as Direction[]) {
          if (!artConnected(tile.set, tile.local, direction)) continue;
          const nx = tile.x + STEP[direction][0];
          const ny = tile.y + STEP[direction][1];
          if (nx < 0 || nx >= room.cols || ny < 0 || ny >= room.rows) continue;
          const expected = sheetNeighbour(tile.set, tile.local, direction);
          const actual = at(room, nx, ny);
          if (actual === null || actual.set.name !== tile.set.name || actual.local !== expected) {
            offenders.push(
              `${describeTile(room, tile)} continues ${direction} into ${tile.set.name}#${expected}, map has ${actual === null ? 'nothing' : `${actual.set.name}#${actual.local}`}`,
            );
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('#7 chapter 3 is re-dressed', () => {
  const rooms = chapterRooms(3);

  it.each(rooms.map((room) => [room.file.name, room] as const))(
    '%s uses VillageAbandoned per block: >= 2 multi-tile blocks and >= 8 village tiles',
    (_name, room) => {
      const blocks = villageBlocks(room);
      const multiTile = blocks.filter((block) => block.length >= 2);
      const villageTiles = blocks.reduce((sum, block) => sum + block.length, 0);

      expect(multiTile.length, 'multi-tile VillageAbandoned blocks').toBeGreaterThanOrEqual(2);
      expect(villageTiles, 'VillageAbandoned decor tiles').toBeGreaterThanOrEqual(8);
    },
  );

  it.each(rooms.map((room) => [room.file.name, room] as const))(
    '%s frames the room with solid props on the border (>= 4, the boss arena >= 8)',
    (_name, room) => {
      const props = room.decor.filter(
        (tile): tile is DecorTile => tile !== null && !isFlat(tile) && isBorder(room, tile.x, tile.y),
      );

      expect(props.length).toBeGreaterThanOrEqual(room.room === 9 ? 8 : 4);
    },
  );
});

describe('#7 obstacle visuals', () => {
  it('core/level/obstacle-visuals.ts exports obstacleVisual(chapter, key)', async () => {
    const module = await loadObstacleVisuals();

    expect(module, 'core/level/obstacle-visuals.ts (pure, no cc) must export obstacleVisual').not.toBeNull();
    expect(typeof module?.obstacleVisual).toBe('function');
  });

  it('chapters 1-2 keep their current visuals', async () => {
    const module = await loadObstacleVisuals();
    expect(module).not.toBeNull();
    const nature = 'resources/art/tilesets/TilesetNature.png';
    const element = 'resources/art/tilesets/TilesetElement.png';
    for (const chapter of [1, 2]) {
      expect(module!.obstacleVisual(chapter, 'pillar')).toEqual({ sheet: nature, rect: { x: 240, y: 224, width: 32, height: 32 }, tile: false });
      expect(module!.obstacleVisual(chapter, 'pillarSmall')).toEqual({ sheet: element, rect: { x: 112, y: 0, width: 16, height: 16 }, tile: true });
      expect(module!.obstacleVisual(chapter, 'wall')).toEqual({ sheet: nature, rect: { x: 272, y: 208, width: 16, height: 16 }, tile: true });
      expect(module!.obstacleVisual(chapter, 'pit')).toEqual({ sheet: nature, rect: { x: 240, y: 224, width: 32, height: 32 }, tile: false });
    }
  });

  it('chapter 3 (and the boss arena pillars) use ch3 stone art, never Nature boulders or Element crates', async () => {
    const module = await loadObstacleVisuals();
    expect(module).not.toBeNull();
    for (const key of ['pillar', 'pillarSmall', 'wall', 'pit'] as const) {
      const visual = module!.obstacleVisual(3, key);
      expect(NATURE_OR_ELEMENT, `ch3 ${key}`).not.toContain(visual.sheet);
      expect(CH3_SHEETS, `ch3 ${key}`).toContain(visual.sheet);
    }
    expect(module!.obstacleVisual(3, 'pit').sheet).toBe('resources/art/tilesets/TilesetHole.png');
  });

  it('every ch3 obstacle is drawn pixel-perfect from a mostly opaque frame inside its sheet', async () => {
    const module = await loadObstacleVisuals();
    expect(module).not.toBeNull();
    for (const room of chapterRooms(3)) {
      for (const obstacle of room.obstacles.filter(
        (candidate): candidate is Obstacle & { kind: Exclude<Obstacle['kind'], 'prop'> } =>
          (candidate.kind as string) !== 'prop',
      )) {
        const label = `${room.file.name} ${obstacle.kind} ${obstacle.width}x${obstacle.height} at (${obstacle.x},${obstacle.y})`;
        const visual = module!.obstacleVisual(3, visualKey(obstacle));
        const { rect } = visual;
        const image = png(sheetPath(visual.sheet));
        expect(rect.x % TILE === 0 && rect.y % TILE === 0, `${label}: rect on the 16 px grid`).toBe(true);
        expect(rect.x + rect.width <= image.width && rect.y + rect.height <= image.height, `${label}: rect inside ${visual.sheet}`).toBe(true);
        if (visual.tile) {
          expect([rect.width, rect.height], `${label}: tiled frame is one tile`).toEqual([TILE, TILE]);
        } else {
          expect([rect.width, rect.height], `${label}: stretched frame must be 1:1 with the obstacle`).toEqual([
            obstacle.width * TILE,
            obstacle.height * TILE,
          ]);
        }
        let filled = 0;
        for (let y = rect.y; y < rect.y + rect.height; y += 1) {
          for (let x = rect.x; x < rect.x + rect.width; x += 1) if (opaque(image, x, y)) filled += 1;
        }
        expect(filled / (rect.width * rect.height), `${label}: frame opacity`).toBeGreaterThanOrEqual(0.5);
      }
    }
  });
});
