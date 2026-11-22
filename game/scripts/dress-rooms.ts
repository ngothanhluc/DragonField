/**
 * Decorate 27 rooms with tilesets that really exist in the pack (GDD §8): ch1
 * Nature/Relief/Element/Field, ch2 Water + waterfall + Nature banks, ch3
 * VillageAbandoned/House/Towers/Hole — and place the room's **props** (#35).
 *
 * Three layers of dressing, in this order:
 * - **Tiles** (walkable ground only): grass, flowers, dirt, gravel, shallow water. Never
 *   roof/canopy there.
 * - **Props** (`PROP_CATALOGUE[chapter]`, ticket #35): whole pack drawings — trees, rocks,
 *   houses, tents, a boat — as `prop` objects in the object layer. A solid prop's **base**
 *   (trunk, walls, rock bottom) becomes an obstacle at parse time, so what looks solid is solid.
 * - **Borders** (rows/columns 0/31 and 0/17 are outside the actor clamp) can also hold tile
 *   decor that reads as solid without changing gameplay.
 *
 * Placement rules for props (see `planProps`): deterministic per chapter+room, never on
 * playerStart/spawns/doors/obstacles, never covering water (the boat excepted), and a
 * placement that would break the playerStart → door route is rejected. Entrance rooms keep
 * only a knee-high solid so the no-skill run stays as open as before.
 *
 * Run: `bun run scripts/dress-rooms.ts`. Idempotent: re-running gives the same result
 * (props are stripped and regenerated; the prop rng is separate from the decor rng).
 *
 * **Superseded by `scripts/generate-rooms.ts` (M9 #38).** That script wrote the 8 hand-dressed
 * 32×18 rooms; chapters now hold a generated 16-room pool of 64×36 rooms, and this one only knows
 * the old one-screen layout. It refuses to touch a room that is not 32×18 so a stray run cannot
 * corrupt the pool.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { PlacedProp } from '../assets/scripts/core/level/level-data';
import { WALK_OVER_KEYS, propCollider, propDef, type PropDef } from '../assets/scripts/core/level/props';
import type { WaterArea } from '../assets/scripts/core/level/water-layout';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const LEVELS = join(PROJECT, 'assets', 'resources', 'data', 'levels');
const RES_ART = join(PROJECT, 'assets', 'resources', 'art', 'tilesets');

const COLS = 32;
const ROWS = 18;

interface TilesetDef {
  readonly source: string;
  readonly name: string;
  readonly image: string;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly count: number;
}

const TS = {
  field: { source: 'field.tsx', name: 'field', image: 'TilesetField.png', width: 80, height: 240, columns: 5, count: 75 },
  nature: { source: 'nature.tsx', name: 'nature', image: 'TilesetNature.png', width: 384, height: 336, columns: 24, count: 504 },
  relief: { source: 'relief.tsx', name: 'relief', image: 'TilesetRelief.png', width: 320, height: 192, columns: 20, count: 240 },
  element: { source: 'element.tsx', name: 'element', image: 'TilesetElement.png', width: 256, height: 240, columns: 16, count: 240 },
  water: { source: 'water.tsx', name: 'water', image: 'TilesetWater.png', width: 448, height: 272, columns: 28, count: 476 },
  ground: { source: 'ground.tsx', name: 'ground', image: 'TilesetDesert.png', width: 320, height: 192, columns: 20, count: 240 },
  village: { source: 'village.tsx', name: 'village', image: 'TilesetVillageAbandoned.png', width: 320, height: 192, columns: 20, count: 240 },
  house: { source: 'house.tsx', name: 'house', image: 'TilesetHouse.png', width: 528, height: 368, columns: 33, count: 759 },
  towers: { source: 'towers.tsx', name: 'towers', image: 'TilesetTowers.png', width: 384, height: 96, columns: 24, count: 144 },
  hole: { source: 'hole.tsx', name: 'hole', image: 'TilesetHole.png', width: 176, height: 80, columns: 11, count: 55 },
} as const satisfies Record<string, TilesetDef>;

const CHAPTER_SETS: Readonly<Record<number, readonly TilesetDef[]>> = {
  1: [TS.field, TS.nature, TS.relief, TS.element],
  2: [TS.field, TS.water, TS.nature],
  3: [TS.ground, TS.village, TS.house, TS.towers, TS.hole],
};

/** firstgid of each tileset in chapter order. */
const FIRST_GID: Readonly<Record<string, number>> = (() => {
  const map: Record<string, number> = {};
  for (const set of Object.values(CHAPTER_SETS)) {
    let next = 1;
    for (const entry of set) {
      map[`${set.indexOf(entry)}:${entry.name}`] = next;
      next += entry.count;
    }
  }
  return map;
})();

function firstGid(chapter: number, name: string): number {
  const set = CHAPTER_SETS[chapter] ?? [];
  const index = set.findIndex((entry) => entry.name === name);
  if (index < 0) throw new Error(`chapter ${chapter} has no tileset ${name}`);
  return (FIRST_GID[`${index}:${name}`] ?? 1) + 0;
}

/** Global gid of a 1-based local tile inside a tileset. */
function gid(chapter: number, name: string, local: number): number {
  return firstGid(chapter, name) + local - 1;
}

/** Small PRNG, seeded by chapter+room so re-running gives the same map. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Reserved {
  readonly cells: Set<string>;
  /** playerStart cell — water must not sit right under the player's feet on room entry. */
  readonly playerStart: string | null;
  /** Existing authored obstacles, in tiles (`pillar`/`wall`/`pit`); props add to these. */
  readonly obstacles: readonly Rect[];
  /** playerStart, doors and spawns in tiles — props keep 0.5 tile clear of every one. */
  readonly points: readonly Vec2[];
  /** Doors only: the reachability targets. */
  readonly doors: readonly Vec2[];
  /** playerStart itself, where the reachability flood fill starts. */
  readonly start: Vec2 | null;
}

interface Vec2 {
  readonly x: number;
  readonly y: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}


function key(x: number, y: number): string {
  return `${x},${y}`;
}

function reserve(cells: Set<string>, x: number, y: number, radius = 0): void {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) cells.add(key(nx, ny));
    }
  }
}

function parseReserved(xml: string): Reserved {
  const cells = new Set<string>();
  let playerStart: string | null = null;
  const obstacles: Rect[] = [];
  const points: Vec2[] = [];
  const doors: Vec2[] = [];
  let start: Vec2 | null = null;

  for (const match of xml.matchAll(/<object[^>]*name="obstacle"[^>]*>/g)) {
    const tag = match[0];
    const x = Number(/\bx="(\d+)"/.exec(tag)?.[1] ?? 0) / 16;
    const y = Number(/\by="(\d+)"/.exec(tag)?.[1] ?? 0) / 16;
    const width = Number(/\bwidth="(\d+)"/.exec(tag)?.[1] ?? 0) / 16;
    const height = Number(/\bheight="(\d+)"/.exec(tag)?.[1] ?? 0) / 16;
    obstacles.push({ x, y, width, height });
    for (let ty = y; ty < y + height; ty += 1) {
      for (let tx = x; tx < x + width; tx += 1) cells.add(key(tx, ty));
    }
  }

  for (const match of xml.matchAll(/<object[^>]*name="(playerStart|spawn|door|bossStart)"[^>]*>/g)) {
    const tag = match[0];
    const name = match[1];
    const px = Number(/\bx="(\d+)"/.exec(tag)?.[1] ?? 0);
    const py = Number(/\by="(\d+)"/.exec(tag)?.[1] ?? 0);
    const x = Math.floor(px / 16);
    const y = Math.floor(py / 16);
    if (name === 'playerStart') playerStart = key(x, y);
    // Spawns, doors and the boss are points: props must not sit within 0.5 tile of them.
    if (name !== 'bossStart') points.push({ x: px / 16, y: py / 16 });
    if (name === 'playerStart') start = { x: px / 16, y: py / 16 };
    if (name === 'door') doors.push({ x: px / 16, y: py / 16 });
    reserve(cells, x, y, 1);
  }

  return { cells, playerStart, obstacles, points, doors, start };
}

function setTile(data: number[], x: number, y: number, value: number): void {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
  data[y * COLS + x] = value;
}

function canPlace(reserved: Reserved, x: number, y: number): boolean {
  if (x < 1 || x >= COLS - 1 || y < 1 || y >= ROWS - 1) return false;
  return !reserved.cells.has(key(x, y));
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const value = items[Math.floor(rng() * items.length)];
  if (value === undefined) throw new Error('pick: empty array');
  return value;
}

// ---------------------------------------------------------------------------
// Ch1 — grass, flowers, gravel; Relief rocks and Element barrels on non-walkable edges
// ---------------------------------------------------------------------------

function dressChapterOne(chapter: number, room: number, reserved: Reserved, rng: () => number): number[] {
  const data = new Array<number>(COLS * ROWS).fill(0);
  const grass = [241, 242, 243, 244, 245, 246, 247, 248, 253, 254];
  const flowers = [265, 266, 267, 268, 269, 270, 271, 272, 277, 278, 301, 302, 337, 338];
  const pebbles = [321, 322, 323, 324, 329, 330, 331, 332];

  for (let cluster = 0; cluster < 10; cluster += 1) {
    const x = 1 + Math.floor(rng() * (COLS - 2));
    const y = 1 + Math.floor(rng() * (ROWS - 2));
    if (!canPlace(reserved, x, y)) continue;
    const size = 1 + Math.floor(rng() * 3);
    for (let step = 0; step < size; step += 1) {
      const tx = x + Math.floor(rng() * 3) - 1;
      const ty = y + Math.floor(rng() * 3) - 1;
      if (!canPlace(reserved, tx, ty)) continue;
      const roll = rng();
      const list = roll < 0.55 ? grass : roll < 0.85 ? flowers : pebbles;
      setTile(data, tx, ty, gid(chapter, 'nature', pick(rng, list)));
    }
  }

  // Row 0 is left empty: props there get cut by the HUD and read as debris. Only low
  // grass/flowers along the other edges (not touching the HUD).

  // Bottom/left/right edges: low grass and flowers.
  for (let x = 2; x < COLS - 2; x += 3) {
    setTile(data, x, ROWS - 1, gid(chapter, 'nature', pick(rng, grass)));
  }
  for (let y = 2; y < ROWS - 2; y += 4) {
    setTile(data, 0, y, gid(chapter, 'nature', pick(rng, grass)));
    setTile(data, COLS - 1, y, gid(chapter, 'nature', pick(rng, flowers)));
  }

  void room;
  return data;
}

// ---------------------------------------------------------------------------
// Ch2 — shallow river, waterfall, grass banks
// ---------------------------------------------------------------------------

/** A complete 4×3 pond block in TilesetWater (banks included). */

function dressChapterTwo(
  chapter: number,
  room: number,
  reserved: Reserved,
  rng: () => number,
): { data: number[]; water: WaterArea[] } {
  const data = new Array<number>(COLS * ROWS).fill(0);
  const bankGrass = [241, 242, 243, 244, 245, 246, 247, 248, 253, 254];
  const water: WaterArea[] = [];

  // A 2-cell-high river (animated water is drawn by RoomWater, not the Water sheet's mosaic tiles).
  const riverWidth = 12 + Math.floor(rng() * 7);
  const riverX = 1 + Math.floor(rng() * (COLS - riverWidth - 2));
  const riverY = 6 + Math.floor(rng() * 5);
  const coversPlayer =
    reserved.playerStart !== null &&
    (() => {
      const [px, py] = reserved.playerStart.split(',').map(Number);
      return (
        px! >= riverX - 1 &&
        px! < riverX + riverWidth + 1 &&
        py! >= riverY - 1 &&
        py! < riverY + 3
      );
    })();
  if (!coversPlayer) {
    water.push({ kind: 'river', x: riverX, y: riverY, width: riverWidth, height: 2 });
  }

  // A 2-column waterfall running from the top edge down to exactly the river row (continuous, not floating).
  if (room % 2 === 1 || room === 9) {
    const fallX = Math.min(
      riverX + 2 + Math.floor(rng() * Math.max(1, riverWidth - 6)),
      COLS - 3,
    );
    if (
      !reserved.cells.has(key(fallX, 1)) &&
      !reserved.cells.has(key(fallX + 1, 1))
    ) {
      water.push({ kind: 'waterfall', x: fallX, y: 0, width: 2, height: Math.max(4, riverY) });
    }
  }

  // Grass banks on both sides of the river + both ends (only where there is no spawn/obstacle).
  if (riverY >= 1) {
    for (let dx = 0; dx < riverWidth; dx += 1) {
      for (const by of [riverY - 1, riverY + 2]) {
        if (canPlace(reserved, riverX + dx, by) && rng() < 0.55) {
          setTile(data, riverX + dx, by, gid(chapter, 'nature', pick(rng, bankGrass)));
        }
      }
    }
    for (const bx of [riverX - 1, riverX + riverWidth]) {
      for (const by of [riverY, riverY + 1]) {
        if (canPlace(reserved, bx, by)) {
          setTile(data, bx, by, gid(chapter, 'nature', pick(rng, bankGrass)));
        }
      }
    }
  }

  // Grass/flowers along the bottom edge and both sides.
  for (let x = 2; x < COLS - 2; x += 2) {
    if (rng() < 0.7) setTile(data, x, ROWS - 1, gid(chapter, 'nature', pick(rng, bankGrass)));
  }
  for (let y = 2; y < ROWS - 2; y += 3) {
    if (rng() < 0.6) setTile(data, 0, y, gid(chapter, 'nature', pick(rng, bankGrass)));
    if (rng() < 0.6) setTile(data, COLS - 1, y, gid(chapter, 'nature', pick(rng, bankGrass)));
  }

  // Grass/reeds + flowers along the river, avoiding the water area.
  const inWater = (x: number, y: number): boolean =>
    water.some(
      (area) =>
        x >= area.x - 1 &&
        x < area.x + area.width + 1 &&
        y >= area.y - 1 &&
        y < area.y + area.height + 1,
    );

  for (let cluster = 0; cluster < 14; cluster += 1) {
    const x = 1 + Math.floor(rng() * (COLS - 2));
    const y = 1 + Math.floor(rng() * (ROWS - 2));
    if (!canPlace(reserved, x, y) || inWater(x, y)) continue;
    const size = 1 + Math.floor(rng() * 3);
    for (let step = 0; step < size; step += 1) {
      const tx = x + Math.floor(rng() * 3) - 1;
      const ty = y + Math.floor(rng() * 3) - 1;
      if (!canPlace(reserved, tx, ty) || inWater(tx, ty)) continue;
      setTile(
        data,
        tx,
        ty,
        gid(
          chapter,
          'nature',
          pick(rng, [...bankGrass, 265, 266, 267, 268, 301, 302, 337, 338]),
        ),
      );
    }
  }

  return { data, water };
}

// ---------------------------------------------------------------------------
// Ch3 — abandoned-village paving/patches in the field, stone props on the border
// ---------------------------------------------------------------------------

/** Rows of 1-based local ids; `0` leaves the cell empty. Whole props, never single pieces. */
type BlockRows = readonly (readonly number[])[];

/** Verified complete flat VillageAbandoned props (row 3–4 of the sheet). */
const VILLAGE_BLOCKS: readonly BlockRows[] = [
  [[108, 109], [128, 129]], // round moss patch 2×2
  [[67], [87]], // tall paving patch 1×2
  [[69, 70], [0, 90]], // L-shaped paving patch
];

/** Verified flat single tiles (paving, stepping stones, low bushes, fallen leaves). */
const VILLAGE_FLAT_SINGLES: readonly number[] = [68, 88, 89, 91, 105, 106, 165, 166, 225, 226];
const DESERT_FLAT_SINGLES: readonly number[] = [189, 190, 237, 238, 239, 240];

/** Complete solid props that fit in one border cell (self-contained in the PNG). */
const BORDER_VILLAGE_PROPS: readonly number[] = [148, 149, 227, 230, 231, 232, 233, 234, 235];
const BORDER_DESERT_PROPS: readonly number[] = [215, 235, 227, 228];

interface Cell {
  readonly x: number;
  readonly y: number;
}

function dressChapterThree(
  chapter: number,
  room: number,
  reserved: Reserved,
  rng: () => number,
): number[] {
  const data = new Array<number>(COLS * ROWS).fill(0);
  const used = new Set<string>();

  const fitsBlock = (block: BlockRows, x: number, y: number): boolean => {
    for (let dy = 0; dy < block.length; dy += 1) {
      const row = block[dy] ?? [];
      for (let dx = 0; dx < row.length; dx += 1) {
        if ((row[dx] ?? 0) === 0) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (!canPlace(reserved, tx, ty) || used.has(key(tx, ty))) return false;
      }
    }
    return true;
  };

  const stampBlock = (block: BlockRows, x: number, y: number): void => {
    for (let dy = 0; dy < block.length; dy += 1) {
      const row = block[dy] ?? [];
      for (let dx = 0; dx < row.length; dx += 1) {
        const local = row[dx] ?? 0;
        if (local === 0) continue;
        setTile(data, x + dx, y + dy, gid(chapter, 'village', local));
        used.add(key(x + dx, y + dy));
      }
    }
  };

  const placeFlat = (
    set: 'village' | 'ground',
    local: number,
    x: number,
    y: number,
  ): boolean => {
    if (!canPlace(reserved, x, y) || used.has(key(x, y))) return false;
    setTile(data, x, y, gid(chapter, set, local));
    used.add(key(x, y));
    return true;
  };

  // One of each whole village prop: two multi-tile patches per room minimum, never torn pieces.
  const anchors: Cell[] = [];
  for (const block of VILLAGE_BLOCKS) {
    const height = block.length;
    const width = Math.max(...block.map((row) => row.length));
    const options: Cell[] = [];
    for (let y = 1; y + height <= ROWS - 1; y += 1) {
      for (let x = 1; x + width <= COLS - 1; x += 1) {
        if (fitsBlock(block, x, y)) options.push({ x, y });
      }
    }
    if (options.length === 0) continue;
    const at = pick(rng, options);
    stampBlock(block, at.x, at.y);
    anchors.push({ x: at.x + Math.floor(width / 2), y: at.y + Math.floor(height / 2) });
  }

  // Stepping stones / paving spilling out of the patches.
  for (const anchor of anchors) {
    for (let step = 0; step < 3; step += 1) {
      const tx = anchor.x + Math.floor(rng() * 7) - 3;
      const ty = anchor.y + Math.floor(rng() * 7) - 3;
      placeFlat('village', pick(rng, VILLAGE_FLAT_SINGLES), tx, ty);
    }
  }

  // A few loose village tiles plus the dry Desert bushes that were already there.
  for (let step = 0; step < 5; step += 1) {
    placeFlat(
      'village',
      pick(rng, VILLAGE_FLAT_SINGLES),
      1 + Math.floor(rng() * (COLS - 2)),
      1 + Math.floor(rng() * (ROWS - 2)),
    );
  }
  for (let step = 0; step < 10; step += 1) {
    placeFlat(
      'ground',
      pick(rng, DESERT_FLAT_SINGLES),
      1 + Math.floor(rng() * (COLS - 2)),
      1 + Math.floor(rng() * (ROWS - 2)),
    );
  }

  // Border: complete solid props on row 17 and columns 0/31 (row 0 sits under the HUD).
  const border: Cell[] = [];
  for (let x = 1; x < COLS - 1; x += 1) border.push({ x, y: ROWS - 1 });
  for (let y = 1; y < ROWS - 1; y += 1) {
    border.push({ x: 0, y });
    border.push({ x: COLS - 1, y });
  }
  const free = border.filter(
    (cell) => !used.has(key(cell.x, cell.y)) && !reserved.cells.has(key(cell.x, cell.y)),
  );
  const wanted = room === 9 ? 10 : 6;
  for (let step = 0; step < wanted && free.length > 0; step += 1) {
    const [cell] = free.splice(Math.floor(rng() * free.length), 1);
    if (cell === undefined) break;
    const set = rng() < 0.65 ? 'village' : 'ground';
    const local = set === 'village' ? pick(rng, BORDER_VILLAGE_PROPS) : pick(rng, BORDER_DESERT_PROPS);
    setTile(data, cell.x, cell.y, gid(chapter, set, local));
    used.add(key(cell.x, cell.y));
  }

  return data;
}

// ---------------------------------------------------------------------------
// Props (#35) — whole drawings from the pack; a solid prop's base is an obstacle
// ---------------------------------------------------------------------------

/** Tile size in pixels, the unit `PROP_CATALOGUE` rects and colliders use. */
const TILE = 16;

/** Rooms 1–3 of a chapter are its entrance: props there stay small (see `planProps`). */
const ENTRANCE_ROOMS = 3;

/**
 * Rows at the bottom of a room that no solid prop may block. That band is the lane the player
 * retreats along when dodging; a wall touching the bottom edge turns it into a pocket where a
 * caster can keep its distance while the player cannot reach it, and the room never clears.
 */
const SOLID_BOTTOM_CLEAR_ROWS = 4;

interface PropTheme {
  /** At most one landmark per room (a house, a tent, a statue), and only in every third room. */
  readonly landmarks: readonly string[];
  /** Everyday solids, each used at most once per room. */
  readonly solids: readonly string[];
  /** Knee-high solids (a 16×16 rock/stump/crate) for the entrance rooms, which stay open. */
  readonly smallSolids: readonly string[];
  readonly walkOvers: readonly string[];
}

/** The eight Nature walk-over props every chapter shares (grass, flowers, bushes). */
const WALK_OVERS = WALK_OVER_KEYS;

const PROP_THEMES: Readonly<Record<number, PropTheme>> = {
  1: {
    landmarks: ['house-orange', 'house-beige', 'house-green', 'hut', 'tent'],
    solids: [
      'tree-green', 'tree-pine', 'tree-dead', 'tree-pink', 'tree-round', 'tree-big-green',
      'tree-small', 'tree-cluster-green', 'tree-cluster-pines', 'rock-boulder', 'rock-small',
      'rock-cluster', 'stump-big', 'stump', 'bush-blue', 'cart', 'crate', 'totem', 'logs',
    ],
    smallSolids: ['rock-small', 'stump', 'crate'],
    walkOvers: WALK_OVERS,
  },
  2: {
    landmarks: ['house-red', 'house-beige', 'house-orange', 'house-green'],
    solids: [
      'tree-green', 'tree-pine', 'tree-round', 'tree-big-orange', 'tree-cluster-pines',
      'rock-boulder-gray', 'rock-small-gray', 'rock-cluster-gray', 'stump', 'bush-blue',
      'crate', 'totem',
    ],
    smallSolids: ['rock-small-gray', 'stump', 'crate'],
    walkOvers: [...WALK_OVERS, 'fishnet'],
  },
  3: {
    landmarks: ['house-ruined', 'house-mossy', 'house-timber', 'house-timber-large', 'house-orange', 'house-red', 'frog-statue'],
    solids: [
      'tree-mossy', 'tree-mossy-alt', 'tree-mossy-cluster', 'tree-mossy-cluster-alt', 'tree-dead',
      'tree-green', 'tree-pine', 'rock-boulder', 'rock-cluster', 'stump-big', 'bush-blue',
      'totem', 'cart', 'crate',
    ],
    smallSolids: ['rock-small', 'stump', 'crate'],
    walkOvers: WALK_OVERS,
  },
};

/** Fisher–Yates with the room's seeded rng: the same room always gets the same props. */
function shuffle<T>(rng: () => number, items: readonly T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = copy[i];
    const other = copy[j];
    if (swap === undefined || other === undefined) continue;
    copy[i] = other;
    copy[j] = swap;
  }
  return copy;
}

function rectCells(rect: Rect): string[] {
  const cells: string[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) cells.push(key(x, y));
  }
  return cells;
}

/** Distance from a point to a rectangle (0 when inside) — the same rule the acceptance test uses. */
function gapToRect(point: Vec2, rect: Rect): number {
  const cx = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  return Math.hypot(point.x - cx, point.y - cy);
}

function overlapsWater(sprite: Rect, water: readonly WaterArea[]): boolean {
  return water.some(
    (area) =>
      sprite.x < area.x + area.width &&
      sprite.x + sprite.width > area.x &&
      sprite.y < area.y + area.height &&
      sprite.y + sprite.height > area.y,
  );
}

/**
 * 4-way BFS over tiles whose centre is at least 0.3 tiles from every blocker — the room must
 * stay traversable after the props land, so a crate can never seal a door. Mirrors the
 * acceptance test on purpose: the script refuses exactly the placements the test would reject.
 */
function reachable(blockers: readonly Rect[], from: Vec2, to: Vec2): boolean {
  const free = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < COLS && r < ROWS &&
    blockers.every((block) => gapToRect({ x: c + 0.5, y: r + 0.5 }, block) >= 0.3);

  const row = Math.floor(from.y);
  const start: readonly [number, number] = [Math.floor(from.x), row];
  const goal = `${Math.min(COLS - 1, Math.floor(to.x))},${Math.min(ROWS - 1, Math.floor(to.y))}`;
  const seen = new Set<string>([`${start[0]},${start[1]}`]);
  const queue: Array<readonly [number, number]> = [start];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const [c, r] = current;
    if (`${c},${r}` === goal) return true;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = `${c + dc},${r + dr}`;
      if (seen.has(next)) continue;
      // The door tile itself may sit on the room edge; accept it as the goal even if near a wall.
      if (next !== goal && !free(c + dc, r + dr)) continue;
      seen.add(next);
      queue.push([c + dc, r + dr]);
    }
  }
  return false;
}

/**
 * Place the room's props. A dressed room (rooms 4+) gets 4–6 solid and 4–7 walk-over props
 * (8–13 total) plus a landmark in every third room; the entrance rooms (1–3) get exactly one
 * knee-high solid and 7 walk-overs, so the no-skill run-entrance stays as open as it was before
 * props (see `run-simulation`). Boss arenas get a couple of edge props.
 *
 * Every placement keeps 0.5 tile clear of playerStart/spawns/doors, never covers water unless
 * it is the boat, and is rejected if it would break the playerStart → door route.
 * Deterministic per chapter+room.
 */
function planProps(
  chapter: number,
  room: number,
  isBossRoom: boolean,
  reserved: Reserved,
  water: readonly WaterArea[],
  rng: () => number,
): PlacedProp[] {
  const theme = PROP_THEMES[chapter];
  if (theme === undefined) return [];

  const occupied = new Set(reserved.cells);
  const blockers: Rect[] = [...reserved.obstacles];
  const placed: PlacedProp[] = [];
  const usedKeys = new Set<string>();
  const from = reserved.start ?? { x: 1, y: 1 };

  /** Try `placeKey` at the first free anchor of `pools` (in order), mutating the bookkeeping on success. */
  const tryPlace = (
    placeKey: string,
    pools: readonly (readonly Vec2[])[],
    allowWater: boolean,
  ): boolean => {
    const def: PropDef | undefined = propDef(chapter, placeKey);
    if (def === undefined) throw new Error(`chapter ${chapter} has no prop ${placeKey}`);
    const width = Math.ceil(def.rect.width / TILE);
    const height = Math.ceil(def.rect.height / TILE);

    for (const pool of pools) {
      for (const anchor of pool) {
        const sprite: Rect = { x: anchor.x, y: anchor.y, width, height };
        if (sprite.x + sprite.width > COLS || sprite.y + sprite.height > ROWS) continue;
        if (!allowWater && water.length > 0 && overlapsWater(sprite, water)) continue;

        const cells = rectCells(sprite);
        if (cells.some((cell) => occupied.has(cell))) continue;

        const prop: PlacedProp = { key: placeKey, x: anchor.x, y: anchor.y };
        const collider = propCollider(prop, def);
        if (collider !== null) {
          // Keep the dodging lane along the bottom edge open (see SOLID_BOTTOM_CLEAR_ROWS).
          if (collider.y + collider.height > ROWS - SOLID_BOTTOM_CLEAR_ROWS) continue;
          if (reserved.points.some((point) => gapToRect(point, collider) < 0.5)) continue;
          const trial = [...blockers, collider];
          if (reserved.doors.some((door) => !reachable(trial, from, door))) continue;
          blockers.push(collider);
        }

        for (const cell of cells) occupied.add(cell);
        placed.push(prop);
        usedKeys.add(placeKey);
        return true;
      }
    }
    return false;
  };

  // Anchors: row 0 stays empty (the HUD cuts anything drawn there). Edges first for the big
  // solids, the middle for walk-over decoration.
  const edge: Vec2[] = [];
  const inner: Vec2[] = [];
  for (let y = 1; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const onEdge = x <= 1 || x >= COLS - 2 || y <= 1 || y >= ROWS - 2;
      (onEdge ? edge : inner).push({ x, y });
    }
  }
  const edgePool = shuffle(rng, edge);
  const innerPool = shuffle(rng, inner);

  // A boat only makes sense on the river: try it first, on the water itself.
  if (chapter === 2) {
    const riverAnchors: Vec2[] = [];
    for (const area of water) {
      if (area.kind !== 'river') continue;
      for (let dx = 0; dx + 5 <= area.width; dx += 1) riverAnchors.push({ x: area.x + dx, y: area.y });
    }
    if (riverAnchors.length > 0) tryPlace('boat', [shuffle(rng, riverAnchors)], true);
  }

  // The first rooms are the chapter entrance: the no-skill run (run-simulation) must survive
  // there, so a big house/tree cluster in rooms 1–3 would turn the arena into a maze. Those
  // rooms get knee-high solids only; the rest of the chapter is dressed fully.
  const entrance = !isBossRoom && room <= ENTRANCE_ROOMS;
  const solidTarget = isBossRoom || entrance ? 1 : 4 + (room % 3);
  const walkTarget = isBossRoom ? 2 : entrance ? 7 : 4 + (room % 4);

  // A landmark in every third room (rooms 1, 4, 7): a house or tent gives the room a focus.
  if (!isBossRoom && !entrance && room % 3 === 1) {
    for (const landmark of shuffle(rng, theme.landmarks)) {
      if (tryPlace(landmark, [edgePool, innerPool], false)) break;
    }
  }

  const solidStock = entrance ? theme.smallSolids : theme.solids;
  let solidCount = placed.filter((prop) => propDef(chapter, prop.key)?.solid === true).length;
  for (const candidate of shuffle(rng, solidStock)) {
    if (solidCount >= solidTarget) break;
    if (usedKeys.has(candidate)) continue;
    if (tryPlace(candidate, [edgePool, innerPool], false)) solidCount += 1;
  }

  let walkCount = placed.filter((prop) => propDef(chapter, prop.key)?.solid === false).length;
  for (const candidate of shuffle(rng, theme.walkOvers)) {
    if (walkCount >= walkTarget) break;
    if (usedKeys.has(candidate)) continue;
    if (tryPlace(candidate, [innerPool, edgePool], false)) walkCount += 1;
  }

  return placed;
}

/** Drop the previous run's prop objects so re-running is idempotent. */
function stripPropObjects(xml: string): string {
  return xml.replace(/[ \t]*<object[^>]*name="prop"[\s\S]*?<\/object>\n?/g, '');
}

function maxObjectId(xml: string): number {
  let max = 0;
  for (const match of xml.matchAll(/<object\b[^>]*\bid="(\d+)"/g)) {
    max = Math.max(max, Number(match[1] ?? 0));
  }
  return max;
}

/** `prop` objects for the object layer: x/y are the **sprite's** top-left in Tiled pixels. */
function propObjectsXml(props: readonly PlacedProp[], chapter: number, firstId: number): string {
  return props
    .map((prop, index) => {
      const def = propDef(chapter, prop.key);
      if (def === undefined) throw new Error(`chapter ${chapter} has no prop ${prop.key}`);
      return (
        `  <object id="${firstId + index}" name="prop" x="${prop.x * TILE}" y="${prop.y * TILE}"` +
        ` width="${def.rect.width}" height="${def.rect.height}">\n` +
        `   <properties>\n    <property name="key" value="${prop.key}"/>\n   </properties>\n` +
        `  </object>\n`
      );
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Ghi TMX
// ---------------------------------------------------------------------------

function tilesetXml(chapter: number): string {
  const set = CHAPTER_SETS[chapter];
  if (set === undefined) throw new Error(`chapter ${chapter} has no tileset`);
  let next = 1;
  const lines: string[] = [];
  for (const entry of set) {
    lines.push(` <tileset firstgid="${next}" source="${entry.source}"/>`);
    next += entry.count;
  }
  return lines.join('\n');
}

function csv(data: readonly number[]): string {
  const rows: string[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    rows.push(data.slice(y * COLS, (y + 1) * COLS).join(','));
  }
  return rows.join(',\n');
}

/** Uniform background per chapter: moss green (field) / village sand (desert). */
const FLOOR_GID: Readonly<Record<number, number>> = { 1: 37, 2: 37, 3: 176 };

function setFloor(xml: string, chapter: number): string {
  const base = FLOOR_GID[chapter];
  if (base === undefined) return xml;
  const floor = new Array<number>(COLS * ROWS).fill(base);
  return xml.replace(
    /(<layer[^>]*name="floor"[\s\S]*?<data encoding="csv">)([\s\S]*?)(<\/data>)/,
    (_match, before: string, _old: string, after: string) =>
      `${before}\n${csv(floor)}\n  ${after}`,
  );
}

function maxLayerId(xml: string): number {
  let max = 0;
  for (const match of xml.matchAll(/<(?:layer|objectgroup)[^>]*\bid="(\d+)"/g)) {
    max = Math.max(max, Number(match[1] ?? 0));
  }
  return max;
}


function ensureTsx(chapterDir: string, def: TilesetDef): void {
  const path = join(chapterDir, def.source);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" tiledversion="1.11.0" name="${def.name}" tilewidth="16" tileheight="16" tilecount="${def.count}" columns="${def.columns}">\n <image source="../../../art/tilesets/${def.image}" width="${def.width}" height="${def.height}"/>\n</tileset>\n`;
  writeFileSync(path, xml);
  const meta = `${path}.meta`;
  if (!existsSync(meta)) {
    writeFileSync(
      meta,
      `${JSON.stringify(
        {
          ver: '1.0.1',
          importer: 'text',
          imported: true,
          uuid: randomUUID(),
          files: ['.json'],
          subMetas: {},
          userData: {},
        },
        null,
        2,
      )}\n`,
    );
  }
}

function dressFile(path: string, chapter: number, room: number): WaterArea[] {
  const raw = readFileSync(path, 'utf8');
  // This script only understands the pre-#38 one-screen layout; the pool rooms are 64×36 and
  // are written by `scripts/generate-rooms.ts`.
  if (!/width="32" height="18"/.test(raw)) {
    throw new Error(
      `${path} is not a 32×18 room; the room pool is generated by scripts/generate-rooms.ts`,
    );
  }
  // Remove `kind=solid` obstacles from the previous trial run (dropped: does not change collision).
  const withoutLegacy = raw.replace(/ ?<object[^>]*name="obstacle"[\s\S]*?<\/object>\n?/g, (block) =>
    block.includes('value="solid"') ? '' : block,
  );
  // Props are regenerated from scratch every run (idempotent), so their colliders are not
  // reserved as authored obstacles below — `planProps` tracks what it places itself.
  const original = stripPropObjects(withoutLegacy);
  const reserved = parseReserved(original);
  const rng = mulberry32(chapter * 100_003 + room * 977);

  const result =
    chapter === 1
      ? { data: dressChapterOne(chapter, room, reserved, rng), water: [] as WaterArea[] }
      : chapter === 2
        ? dressChapterTwo(chapter, room, reserved, rng)
        : { data: dressChapterThree(chapter, room, reserved, rng), water: [] as WaterArea[] };
  const decor = result.data;

  // Props get their own rng stream so changing them never reshuffles the ground decor.
  const isBossRoom = /<property\b[^>]*name="isBossRoom"[^>]*value="true"/.test(original);
  const props = planProps(
    chapter,
    room,
    isBossRoom,
    reserved,
    result.water,
    mulberry32(chapter * 7919 + room * 104_729 + 35),
  );

  // Drop the old tilesets + decor; keep floor/objectgroup.
  const withoutTilesets = original.replace(/^ <tileset[^\n]*\/>\n?/gm, '');
  const withoutDecor = withoutTilesets.replace(
    / ?<layer[^>]*name="decor"[\s\S]*?<\/layer>\n?/g,
    '',
  );

  const layerId = maxLayerId(withoutDecor) + 1;
  const decorLayer = ` <layer id="${layerId}" name="decor" width="${COLS}" height="${ROWS}">\n  <data encoding="csv">\n${csv(decor)}\n  </data>\n </layer>\n`;
  const tilesets = `${tilesetXml(chapter)}\n`;

  let next = setFloor(withoutDecor, chapter).replace(/<map([^>]*)>/, (_match, attributes: string) =>
    `<map${attributes.replace(/nextlayerid="\d+"/, `nextlayerid="${layerId + 1}"`)}>`,
  );

  // Insert tilesets right after </properties> (or after the <map ...> tag when absent).
  if (next.includes('</properties>')) {
    next = next.replace('</properties>\n', `</properties>\n${tilesets}`);
  } else {
    next = next.replace(/<map[^>]*>\n/, (match) => `${match}${tilesets}`);
  }

  // Decor after the last tile layer, before the objectgroup.
  const objectIndex = next.indexOf(' <objectgroup');
  if (objectIndex < 0) throw new Error(`${path}: no objectgroup`);
  next = `${next.slice(0, objectIndex)}${decorLayer}${next.slice(objectIndex)}`;

  // Prop objects go last in the object layer; their colliders become obstacles at parse time.
  const firstPropId = maxObjectId(next) + 1;
  if (props.length > 0) {
    const block = propObjectsXml(props, chapter, firstPropId).trimEnd();
    const close = /\n[ \t]*<\/objectgroup>/.exec(next);
    if (close === null) throw new Error(`${path}: objectgroup is not closed as expected`);
    next = next.replace(close[0], `\n${block}${close[0]}`);
  }
  next = next.replace(/nextobjectid="\d+"/, `nextobjectid="${firstPropId + props.length}"`);

  writeFileSync(path, next);
  return result.water;
}

const waterRooms: Record<string, Record<string, WaterArea[]>> = {};

for (const chapterName of readdirSync(LEVELS)) {
  if (!chapterName.startsWith('chapter-')) continue;
  const chapter = Number(chapterName.replace('chapter-', ''));
  const dir = join(LEVELS, chapterName);
  const set = CHAPTER_SETS[chapter];
  if (set === undefined) continue;
  for (const def of set) ensureTsx(dir, def);

  const byRoom: Record<string, WaterArea[]> = {};
  for (const file of readdirSync(dir)) {
    const match = /^room-(\d+)\.tmx$/.exec(file);
    if (match === null) continue;
    const room = Number(match[1]);
    const water = dressFile(join(dir, file), chapter, room);
    if (water.length > 0) byRoom[String(room)] = water;
  }
  if (Object.keys(byRoom).length > 0) waterRooms[String(chapter)] = byRoom;
  console.log(`chapter ${chapter}: dressed ${readdirSync(dir).filter((f) => f.endsWith('.tmx')).length} rooms`);
}

const waterPath = join(PROJECT, 'assets', 'resources', 'data', 'water-layout.json');
writeFileSync(waterPath, `${JSON.stringify({ version: 1, rooms: waterRooms }, null, 2)}\n`);
if (!existsSync(`${waterPath}.meta`)) {
  writeFileSync(
    `${waterPath}.meta`,
    `${JSON.stringify(
      {
        ver: '2.0.1',
        importer: 'json',
        imported: true,
        uuid: randomUUID(),
        files: ['.json'],
        subMetas: {},
        userData: {},
      },
      null,
      2,
    )}\n`,
  );
}
console.log(`water-layout.json: ${JSON.stringify(waterRooms)}`);

// art source checks: files must exist for TiledMap to import them.
for (const def of Object.values(TS)) {
  if (!existsSync(join(RES_ART, def.image))) {
    throw new Error(`missing tileset ${def.image} in resources/art/tilesets`);
  }
}
