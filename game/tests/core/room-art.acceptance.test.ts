/**
 * Ticket #67 acceptance: generated normal rooms are composed like the Ninja Adventure demo —
 * autotiled ground patches, paths linking the doors, dense solid borders, tree groves, village
 * clusters, desert cliff plateaus and a light detail scatter — while every room stays playable
 * (doors, spawns and the player start keep their space).
 *
 * Contract this file relies on (agreed in the brief, do not rename):
 * - `core/level/autotile.ts` exports `pickBlobTile(mask, x, y)` (0 off-mask, else 1..13 in the
 *   13-piece blob layout of `TilesetField`: 1 2 3 / 6 7 8 / 11 12 13 outer, 4 5 / 9 10 inner
 *   corners), `normalizePatchMask(mask)` and `GROUND_TERRAINS[chapter] = { tileset, tiles }`
 *   (`tiles[blob - 1]` = 1-based local tile id inside `tileset`, a `.tsx` file name).
 * - Normal-room `.tmx` files carry tile layers named `ground` (the patches), `path` and `decor`.
 * - `config/tuning.json` → `roomArt.detailDensity`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LevelData, Obstacle } from '../../assets/scripts/core/level/level-data';
import { obstacleVisual } from '../../assets/scripts/core/level/obstacle-visuals';
import { propDef } from '../../assets/scripts/core/level/props';
import { firstHit } from '../../assets/scripts/core/combat/bullets';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';
import { childrenNamed, elementText, firstChild, parseXml } from '../../assets/scripts/core/level/xml';
import { LEVELS_ROOT } from '../helpers/tmx-levels';

const CHAPTERS = [1, 2, 3, 4] as const;
const NORMAL_ROOMS = 16;
const COLS = 64;
const ROWS = 36;
const TILE = 16;

interface PatchMask {
  readonly cols: number;
  readonly rows: number;
  /** Row-major: `cells[y * cols + x]`. Out of bounds counts as outside the patch. */
  readonly cells: readonly boolean[];
}

interface GroundTerrain {
  readonly tileset: string;
  readonly tiles: readonly number[];
}

interface AutotileModule {
  pickBlobTile(mask: PatchMask, x: number, y: number): number;
  normalizePatchMask(mask: PatchMask): PatchMask;
  readonly GROUND_TERRAINS: Readonly<Record<number, GroundTerrain>>;
}

let autotile: AutotileModule | null = null;

beforeAll(async () => {
  try {
    autotile = (await import('../../assets/scripts/core/level/autotile')) as unknown as AutotileModule;
  } catch {
    autotile = null;
  }
});

function lib(): AutotileModule {
  expect(autotile, 'core/level/autotile.ts must exist and export the edge picker').not.toBeNull();
  if (autotile === null) throw new Error('unreachable');
  return autotile;
}

/** ASCII → mask: `#` inside the patch, anything else outside. */
function mask(rows: readonly string[]): PatchMask {
  const cols = rows[0]?.length ?? 0;
  return { cols, rows: rows.length, cells: rows.flatMap((row) => Array.from(row, (ch) => ch === '#')) };
}

function picks(m: PatchMask): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < m.rows; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < m.cols; x += 1) row.push(lib().pickBlobTile(m, x, y));
    out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Edge picker (unit)
// ---------------------------------------------------------------------------

describe('autotile edge picker', () => {
  it('a 4×3 rectangle gets corners, edges and centre pieces', () => {
    const m = mask(['......', '.####.', '.####.', '.####.', '......']);
    expect(picks(m)).toEqual([
      [0, 0, 0, 0, 0, 0],
      [0, 1, 2, 2, 3, 0],
      [0, 6, 7, 7, 8, 0],
      [0, 11, 12, 12, 13, 0],
      [0, 0, 0, 0, 0, 0],
    ]);
  });

  it('a missing diagonal picks the matching inner corner (4 NW, 5 NE, 9 SW, 10 SE)', () => {
    // L-shape: the hole at the top-right makes (2,2) an inner corner with only NE outside.
    const l = mask(['.....', '.##..', '.####', '.####', '.####']);
    // Cell (2,2): N (2,1) in, E (3,2) in, NE (3,1) out → 5.
    expect(lib().pickBlobTile(l, 2, 2)).toBe(5);

    const nw = mask(['.....', '..###', '.####', '.####', '.....']);
    expect(lib().pickBlobTile(nw, 2, 2)).toBe(4);

    const sw = mask(['.....', '.####', '.####', '..###', '.....']);
    expect(lib().pickBlobTile(sw, 2, 2)).toBe(9);

    const se = mask(['.....', '.####', '.####', '.##..', '.....']);
    expect(lib().pickBlobTile(se, 2, 2)).toBe(10);
  });

  it('cells off the patch and on the map edge are handled', () => {
    const m = mask(['##', '##']);
    expect(picks(m)).toEqual([
      [1, 3],
      [11, 13],
    ]);
  });

  it('normalising drops cells no full 2×2 block covers (strips, single cells, diagonal touches)', () => {
    const m = mask(['#.....', '.###..', '.###..', '....#.', '#####.']);
    const normalised = lib().normalizePatchMask(m);
    const expected = mask(['......', '.###..', '.###..', '......', '......']);
    expect(normalised.cols).toBe(expected.cols);
    expect(normalised.rows).toBe(expected.rows);
    expect(normalised.cells).toEqual(expected.cells);
  });
});

// ---------------------------------------------------------------------------
// Rooms on disk
// ---------------------------------------------------------------------------

interface RoomFile {
  readonly level: LevelData;
  readonly layers: ReadonlyMap<string, readonly number[]>;
  /** `.tsx` file name → firstgid. */
  readonly tilesets: ReadonlyMap<string, number>;
}

function readRoom(chapter: number, room: number): RoomFile {
  const path = join(LEVELS_ROOT, `chapter-${chapter}`, `room-${room}.tmx`);
  const xml = readFileSync(path, 'utf8');
  const level = parseTmxLevel(xml, { source: `chapter-${chapter}/room-${room}.tmx` });
  const map = parseXml(xml);
  const layers = new Map<string, number[]>();
  for (const layer of childrenNamed(map, 'layer')) {
    const data = firstChild(layer, 'data');
    if (data === null) continue;
    const values = elementText(data)
      .split(',')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0)
      .map(Number);
    layers.set(layer.attributes['name'] ?? '', values);
  }
  const tilesets = new Map<string, number>();
  for (const tileset of childrenNamed(map, 'tileset')) {
    tilesets.set(tileset.attributes['source'] ?? '', Number(tileset.attributes['firstgid']));
  }
  return { level, layers, tilesets };
}

const rooms: Readonly<Record<number, readonly RoomFile[]>> = Object.fromEntries(
  CHAPTERS.map((chapter) => [
    chapter,
    Array.from({ length: NORMAL_ROOMS }, (_, index) => readRoom(chapter, index + 1)),
  ]),
);

function chapterRooms(chapter: number): readonly RoomFile[] {
  return rooms[chapter] ?? [];
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function gapToPoint(rect: Rect, point: { x: number; y: number }): number {
  const cx = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  return Math.hypot(point.x - cx, point.y - cy);
}

function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return Math.hypot(dx, dy);
}

function inside(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

interface DrawnProp {
  readonly key: string;
  readonly kind: string;
  readonly solid: boolean;
  /** Sprite rect, tiles. */
  readonly rect: Rect;
}

function drawnProps(file: RoomFile): DrawnProp[] {
  return file.level.props.flatMap((prop) => {
    const def = propDef(file.level.chapter, prop.key);
    if (def === undefined) return [];
    return [
      {
        key: prop.key,
        kind: def.kind,
        solid: def.solid,
        rect: { x: prop.x, y: prop.y, width: def.rect.width / TILE, height: def.rect.height / TILE },
      },
    ];
  });
}

/** Groups of props whose sprite rects touch or overlap (canopies overlapping). */
function touchingGroups(items: readonly DrawnProp[]): DrawnProp[][] {
  const groups: DrawnProp[][] = [];
  const seen = new Set<number>();
  items.forEach((_, start) => {
    if (seen.has(start)) return;
    const group: DrawnProp[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const index = queue.pop() ?? 0;
      const item = items[index];
      if (item === undefined) continue;
      group.push(item);
      items.forEach((other, next) => {
        if (seen.has(next)) return;
        if (gapBetween(item.rect, other.rect) <= 0) {
          seen.add(next);
          queue.push(next);
        }
      });
    }
    groups.push(group);
  });
  return groups;
}

function layer(file: RoomFile, name: string): readonly number[] {
  const values = file.layers.get(name);
  expect(values, `${file.level.id}: tile layer "${name}"`).toBeDefined();
  expect(values?.length, `${file.level.id}: layer "${name}" size`).toBe(COLS * ROWS);
  return values ?? [];
}

describe('ground patches use correct autotile edges', () => {
  for (const chapter of CHAPTERS) {
    it(`chapter ${chapter}: every patch cell is the piece the edge picker chooses`, () => {
      const terrain = lib().GROUND_TERRAINS[chapter];
      expect(terrain, `GROUND_TERRAINS[${chapter}]`).toBeDefined();
      if (terrain === undefined) return;
      expect(terrain.tiles).toHaveLength(13);
      const problems: string[] = [];
      for (const file of chapterRooms(chapter)) {
        const id = file.level.id;
        const ground = layer(file, 'ground');
        const first = file.tilesets.get(terrain.tileset);
        if (first === undefined) {
          problems.push(`${id}: no tileset ${terrain.tileset}`);
          continue;
        }
        const localOf = (value: number): number => value - first + 1;
        const cells = ground.map((value) => value !== 0 && terrain.tiles.includes(localOf(value)));
        const strays = ground.filter((value, index) => value !== 0 && !cells[index]).length;
        if (strays > 0) problems.push(`${id}: ${strays} ground cells are not ${terrain.tileset} patch tiles`);

        const m: PatchMask = { cols: COLS, rows: ROWS, cells };
        const has = (x: number, y: number): boolean =>
          x >= 0 && x < COLS && y >= 0 && y < ROWS && cells[y * COLS + x] === true;
        let count = 0;
        let innerCorners = 0;
        for (let y = 0; y < ROWS; y += 1) {
          for (let x = 0; x < COLS; x += 1) {
            if (!has(x, y)) continue;
            count += 1;
            // Every patch cell sits in a full 2×2 block (the 13-piece layout cannot draw strips).
            const inBlock = [
              [0, 0], [-1, 0], [0, -1], [-1, -1],
            ].some(([dx = 0, dy = 0]) => has(x + dx, y + dy) && has(x + dx + 1, y + dy) && has(x + dx, y + dy + 1) && has(x + dx + 1, y + dy + 1));
            if (!inBlock) problems.push(`${id}: patch cell ${x},${y} is not in a full 2×2 block`);
            const blob = lib().pickBlobTile(m, x, y);
            if ([4, 5, 9, 10].includes(blob)) innerCorners += 1;
            const want = terrain.tiles[blob - 1];
            const got = localOf(ground[y * COLS + x] ?? 0);
            if (want !== got) problems.push(`${id}: cell ${x},${y} has tile ${got}, picker wants ${want} (blob ${blob})`);
          }
        }
        const share = count / (COLS * ROWS);
        if (share < 0.05 || share > 0.4) problems.push(`${id}: patches cover ${(share * 100).toFixed(1)}% (want 5–40%)`);
        // Irregular, noise-driven patches always have inner corners; plain rectangles never do.
        if (innerCorners < 1) problems.push(`${id}: no inner corner — patches are plain rectangles`);
      }
      expect(problems.slice(0, 12)).toEqual([]);
    });
  }
});

describe('paths link the doors', () => {
  for (const chapter of CHAPTERS) {
    it(`chapter ${chapter}: a path joins every door, and never runs under an obstacle`, () => {
      const problems: string[] = [];
      for (const file of chapterRooms(chapter)) {
        const id = file.level.id;
        const path = layer(file, 'path');
        const cells: { x: number; y: number }[] = [];
        path.forEach((value, index) => {
          if (value !== 0) cells.push({ x: index % COLS, y: Math.floor(index / COLS) });
        });
        if (cells.length < 20) {
          problems.push(`${id}: only ${cells.length} path cells`);
          continue;
        }
        for (const cell of cells) {
          const blocked = file.level.obstacles.some((o) => inside(o, cell.x + 0.5, cell.y + 0.5));
          if (blocked) problems.push(`${id}: path cell ${cell.x},${cell.y} under an obstacle`);
        }
        // Stepping stones may leave a 1-tile gap: cells within 2 tiles (Chebyshev) are linked.
        const component = new Array<number>(cells.length).fill(-1);
        let next = 0;
        cells.forEach((_, start) => {
          if (component[start] !== -1) return;
          const queue = [start];
          component[start] = next;
          while (queue.length > 0) {
            const index = queue.pop() ?? 0;
            const cell = cells[index];
            if (cell === undefined) continue;
            cells.forEach((other, j) => {
              if (component[j] !== -1) return;
              if (Math.max(Math.abs(other.x - cell.x), Math.abs(other.y - cell.y)) <= 2) {
                component[j] = next;
                queue.push(j);
              }
            });
          }
          next += 1;
        });
        const near = (door: { x: number; y: number }): Set<number> =>
          new Set(
            cells
              .map((cell, index) => ({ cell, index }))
              .filter(({ cell }) => Math.hypot(cell.x + 0.5 - door.x, cell.y + 0.5 - door.y) <= 3)
              .map(({ index }) => component[index] ?? -1),
          );
        const sets = file.level.doors.map((door) => near(door.at));
        const shared = Array.from(sets[0] ?? []).filter((c) => sets.every((set) => set.has(c)));
        if (shared.length === 0) problems.push(`${id}: no single path reaches all ${file.level.doors.length} doors`);
      }
      expect(problems.slice(0, 12)).toEqual([]);
    });
  }
});

describe('the room edge reads as a wall', () => {
  for (const chapter of CHAPTERS) {
    it(`chapter ${chapter}: ≥ 70% of the 2-tile border band is drawn solid (outside the door mouths)`, () => {
      const problems: string[] = [];
      for (const file of chapterRooms(chapter)) {
        const solids: Rect[] = [
          ...file.level.obstacles,
          ...drawnProps(file).filter((prop) => prop.solid).map((prop) => prop.rect),
        ];
        let band = 0;
        let covered = 0;
        for (let y = 0; y < ROWS; y += 1) {
          for (let x = 0; x < COLS; x += 1) {
            if (x >= 2 && x < COLS - 2 && y >= 2 && y < ROWS - 2) continue;
            const cx = x + 0.5;
            const cy = y + 0.5;
            if (file.level.doors.some((door) => Math.hypot(cx - door.at.x, cy - door.at.y) <= 4)) continue;
            band += 1;
            if (solids.some((rect) => inside(rect, cx, cy))) covered += 1;
          }
        }
        const share = covered / band;
        if (share < 0.7) problems.push(`${file.level.id}: border ${(share * 100).toFixed(0)}% solid`);
      }
      expect(problems.slice(0, 12)).toEqual([]);
    });
  }
});

describe('clusters, not scatter', () => {
  for (const chapter of [1, 2, 3] as const) {
    it(`chapter ${chapter}: at least 6 of 16 rooms hold an inner grove of ≥ 3 trees with overlapping canopies`, () => {
      const withGrove = chapterRooms(chapter).filter((file) => {
        const trees = drawnProps(file).filter(
          (prop) =>
            prop.kind === 'tree' &&
            prop.rect.x >= 3 &&
            prop.rect.y >= 3 &&
            prop.rect.x + prop.rect.width <= COLS - 3 &&
            prop.rect.y + prop.rect.height <= ROWS - 3,
        );
        return touchingGroups(trees).some((group) => group.length >= 3);
      });
      expect(withGrove.length).toBeGreaterThanOrEqual(6);
    });
  }

  it('chapter 4: at least 6 of 16 rooms group ≥ 2 palm drawings together (oasis)', () => {
    const withPalms = chapterRooms(4).filter((file) => {
      const palms = drawnProps(file).filter((prop) => prop.kind === 'tree' && prop.key.startsWith('palm'));
      return touchingGroups(palms).some((group) => group.length >= 2);
    });
    expect(withPalms.length).toBeGreaterThanOrEqual(6);
  });

  for (const chapter of [1, 3, 4] as const) {
    it(`chapter ${chapter}: at least 4 of 16 rooms hold a village — a house with ≥ 3 props (fence, well, stump, sign…) within 3 tiles`, () => {
      const furniture = new Set(['structure', 'stump', 'decor', 'rock']);
      const withVillage = chapterRooms(chapter).filter((file) => {
        const props = drawnProps(file);
        return props.some(
          (house) =>
            house.kind === 'house' &&
            props.filter((other) => furniture.has(other.kind) && gapBetween(house.rect, other.rect) <= 3).length >= 3,
        );
      });
      expect(withVillage.length).toBeGreaterThanOrEqual(4);
    });
  }
});

describe('desert elevation', () => {
  it('chapter 4: at least 6 of 16 rooms have a cliff plateau from TilesetRelief sand cliffs, and it is solid', () => {
    const problems: string[] = [];
    let withCliff = 0;
    for (const file of chapterRooms(4)) {
      const first = file.tilesets.get('relief.tsx');
      if (first === undefined) continue;
      let cliffCells = 0;
      for (const [name, values] of file.layers) {
        values.forEach((value, index) => {
          const local = value - first + 1;
          if (value === 0 || local < 101 || local > 187) return;
          cliffCells += 1;
          const x = (index % COLS) + 0.5;
          const y = Math.floor(index / COLS) + 0.5;
          if (!file.level.obstacles.some((o: Obstacle) => inside(o, x, y))) {
            problems.push(`${file.level.id}: cliff tile on "${name}" at ${x - 0.5},${y - 0.5} is walkable`);
          }
        });
      }
      if (cliffCells >= 12) withCliff += 1;
    }
    expect(problems.slice(0, 12)).toEqual([]);
    expect(withCliff).toBeGreaterThanOrEqual(6);
  });
});

describe('detail scatter', () => {
  const tuning = JSON.parse(readFileSync(join(LEVELS_ROOT, '../../../../config/tuning.json'), 'utf8')) as {
    roomArt?: { detailDensity?: number };
  };

  it('tuning.json sets roomArt.detailDensity', () => {
    const density = tuning.roomArt?.detailDensity;
    expect(typeof density).toBe('number');
    expect(density).toBeGreaterThan(0);
    expect(density).toBeLessThanOrEqual(0.3);
  });

  for (const chapter of CHAPTERS) {
    it(`chapter ${chapter}: details reach half the tuned density, and no 16×9 area is bare`, () => {
      const density = tuning.roomArt?.detailDensity ?? 1;
      const problems: string[] = [];
      for (const file of chapterRooms(chapter)) {
        const id = file.level.id;
        const decor = layer(file, 'decor');
        const walkOvers = drawnProps(file).filter((prop) => !prop.solid);
        const details = decor.filter((value) => value !== 0).length + walkOvers.length;
        if (details / (COLS * ROWS) < density / 2) {
          problems.push(`${id}: ${details} details (${((details / (COLS * ROWS)) * 100).toFixed(1)}%)`);
        }
        const dressed = new Set<string>();
        for (const [name, values] of file.layers) {
          if (name === 'floor') continue;
          values.forEach((value, index) => {
            if (value !== 0) dressed.add(`${Math.floor((index % COLS) / 16)},${Math.floor(Math.floor(index / COLS) / 9)}`);
          });
        }
        for (const prop of file.level.props) dressed.add(`${Math.floor(prop.x / 16)},${Math.floor(prop.y / 9)}`);
        for (let by = 0; by < ROWS / 9; by += 1) {
          for (let bx = 0; bx < COLS / 16; bx += 1) {
            if (!dressed.has(`${bx},${by}`)) problems.push(`${id}: area ${bx},${by} is bare`);
          }
        }
      }
      expect(problems.slice(0, 12)).toEqual([]);
    });
  }
});

describe('set pieces leave the fight readable', () => {
  for (const chapter of CHAPTERS) {
    it(`chapter ${chapter}: obstacles keep 3 tiles from the start, 1.5 from doors, 1 from spawns`, () => {
      const problems: string[] = [];
      for (const file of chapterRooms(chapter)) {
        const { level } = file;
        for (const o of level.obstacles) {
          if (gapToPoint(o, level.playerStart) < 3) problems.push(`${level.id}: ${o.kind} near the player start`);
          for (const door of level.doors) {
            if (gapToPoint(o, door.at) < 1.5) problems.push(`${level.id}: ${o.kind} blocks door ${door.at.x},${door.at.y}`);
          }
          for (const wave of level.waves) {
            for (const enemy of wave.enemies) {
              if (gapToPoint(o, enemy.at) < 1) problems.push(`${level.id}: ${o.kind} on spawn ${enemy.at.x},${enemy.at.y}`);
            }
          }
        }
      }
      expect(problems.slice(0, 12)).toEqual([]);
    });
  }
});


describe('chapter 3 village ruins (#67 R9)', () => {
  const RUIN_ANCHORS = new Set([
    'house-ruined',
    'ruined-house-orange',
    'house-mossy',
    'house-mossy-alt',
    'watchtower-ruined',
    'house-timber',
    'house-timber-large',
    'ruined-wall-cross',
    'broken-wall-arch',
    'big-pillar-ruined',
  ]);

  it('uses weathered ruins ground distinct from ch1/ch2 grass, and never places intact bright houses', () => {
    const ch1Floor = layer(chapterRooms(1)[0]!, 'floor')[0];
    for (const file of chapterRooms(3)) {
      const floor = layer(file, 'floor');
      expect(floor[0], `${file.level.id}: base floor distinct from ch1`).not.toBe(ch1Floor);
      for (const prop of file.level.props) {
        expect(['house-orange', 'house-red', 'house-beige', 'house-green', 'fence'], file.level.id).not.toContain(
          prop.key,
        );
      }
    }
  });

  it('every room holds a multi-piece village ruin (anchor + ≥ 3 ruin remnants/props within 3 tiles)', () => {
    const companionKinds = new Set(['house', 'structure', 'stump']);
    const withRuins = chapterRooms(3).filter((file) => {
      const props = drawnProps(file);
      return props.some(
        (anchor) =>
          RUIN_ANCHORS.has(anchor.key) &&
          props.filter(
            (other) => other !== anchor && companionKinds.has(other.kind) && gapBetween(anchor.rect, other.rect) <= 3,
          ).length >= 3,
      );
    });
    expect(withRuins).toHaveLength(NORMAL_ROOMS);
  });
});

describe('chapter 4 desert oasis pond & walled town (#67 R9)', () => {
  it('draws ch4 pit obstacles as the 3×3 TilesetDesert oasis pond and lets bullets fly across it', () => {
    const visual = obstacleVisual(4, 'pit');
    expect(visual.sheet).toBe('resources/art/tilesets/TilesetDesert.png');
    expect(visual.rect).toEqual({ x: 272, y: 112, width: 48, height: 48 });
    expect(visual.tile).toBe(false);

    const file = chapterRooms(4).find((candidate) =>
      candidate.level.obstacles.some((o) => o.kind === 'pit'),
    );
    expect(file, 'at least one ch4 room has an oasis pit').toBeDefined();
    if (file === undefined) return;
    const pond = file.level.obstacles.find((o) => o.kind === 'pit')!;
    expect([pond.width, pond.height]).toEqual([3, 3]);
    // Bullets fly over water (`pit`), while solid props still stop bullets.
    const acrossPond = firstHit(
      { from: { x: pond.x - 1, y: pond.y + 1.5 }, to: { x: pond.x + 4, y: pond.y + 1.5 } },
      { ...file.level, obstacles: [pond] },
    );
    expect(acrossPond).toBeNull();
    const propObstacle = file.level.obstacles.find((o) => o.kind === 'prop')!;
    const intoProp = firstHit(
      {
        from: { x: propObstacle.x - 1, y: propObstacle.y + propObstacle.height / 2 },
        to: { x: propObstacle.x + propObstacle.width + 1, y: propObstacle.y + propObstacle.height / 2 },
      },
      { ...file.level, obstacles: [propObstacle] },
    );
    expect(intoProp).not.toBeNull();
  });

  it('at least 8 of 16 rooms hold an oasis pond with ≥ 2 palms grouped on its bank', () => {
    const withOasis = chapterRooms(4).filter((file) => {
      const ponds = file.level.obstacles.filter((o) => o.kind === 'pit' && o.width === 3 && o.height === 3);
      const palms = drawnProps(file).filter((prop) => prop.kind === 'tree' && prop.key.startsWith('palm'));
      return ponds.some(
        (pond) => palms.filter((palm) => gapBetween(pond, palm.rect) <= 3).length >= 2,
      );
    });
    expect(withOasis.length).toBeGreaterThanOrEqual(8);
  });

  it('at least 4 of 16 rooms feature walled-town or market architecture from TilesetDesert', () => {
    const townKeys = new Set([
      'desert-wall-segment',
      'desert-wall-tower',
      'desert-dome',
      'desert-stall-red',
      'desert-stall-yellow',
      'desert-fountain',
    ]);
    const withWalledTown = chapterRooms(4).filter((file) =>
      file.level.props.some((prop) => townKeys.has(prop.key)),
    );
    expect(withWalledTown.length).toBeGreaterThanOrEqual(4);
  });

  it('ground and path layers never overlap in any chapter room (no hard square baked-fringe seams)', () => {
    const problems: string[] = [];
    for (const chapter of CHAPTERS) {
      for (const file of chapterRooms(chapter)) {
        const ground = layer(file, 'ground');
        const path = layer(file, 'path');
        for (let index = 0; index < ground.length; index += 1) {
          if ((ground[index] ?? 0) !== 0 && (path[index] ?? 0) !== 0) {
            problems.push(`${file.level.id}: ground & path overlap at ${index % COLS},${Math.floor(index / COLS)}`);
            break;
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
