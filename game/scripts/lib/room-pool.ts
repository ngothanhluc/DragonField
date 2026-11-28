/**
 * Generated 64×36 room pool (M9 ticket #38, recomposed in M10 ticket #67).
 *
 * Every chapter holds a **pool** of 16 generated normal rooms; a run plays 8 of them drawn by its
 * seed (`core/run/room-draw.ts`) plus the boss. This module plans one room and serialises it to
 * `.tmx`; the runtime parser (`core/level/tmx.ts`) and the acceptance tests read the same files.
 *
 * Room anatomy (2×2 screens of 32×18 tiles), the way the Ninja Adventure demo scenes are built:
 * - **Floor**: one uniform grass/sand gid (`FLOOR_GID`), the base everything else sits on.
 * - **Ground patches**: 13-piece blob autotile of a second terrain (`scripts/lib/autotile.ts`) over
 *   a value-noise mask — irregular dirt/grass/sand patches with proper corners, never hard squares.
 * - **Path**: stepping stones from the entrance door to the exit door (and a short spur toward the
 *   set piece), carved first so obstacles never sit on it.
 * - **Border**: a 2-tile solid band around the room (one long `edge` obstacle per side with a mouth
 *   at each door) dressed with dense foliage / cliff tiles, so the edge reads as a wall.
 * - **Set pieces**: a tree grove (palms in the desert), a small village (house + fence-line props),
 *   and for chapter 4 a sand cliff plateau from `TilesetRelief` — all placed by the room seed and
 *   never blocking a door, the start or a spawn.
 * - **Decor**: a light scatter of walkable details (tufts, pebbles, flowers, bones) at
 *   `roomArt.detailDensity`, with at least one in every 16×9 area.
 * - **Spawns**: the chapter's per-room spawn plan (the M9 counts), spread over the 4 screens.
 * - **Doors**: 2 spots on the room edge (entrance at the bottom, exit at the top).
 *
 * Determinism: `(chapter, room, attempt)` seeds one room; a room that fails validation retries
 * with the next attempt, so re-running the script rewrites byte-identical files.
 */
import { ROOM_EDGE_MARGIN_TILES } from '../../assets/scripts/core/enemies/behaviours';
import { buildFlowField, buildNavGrid } from '../../assets/scripts/core/enemies/navigation';
import { TUNING } from '../../assets/scripts/core/enemies/tuning';
import {
  GROUND_TERRAINS,
  normalizePatchMask,
  pickBlobTile,
  type PatchMask,
} from './autotile';
import type {
  EnemyRole,
  ObstacleKind,
  PlacedProp,
  LevelData,
} from '../../assets/scripts/core/level/level-data';
import { WALK_OVER_KEYS, propCollider, propDef, type PropDef } from '../../assets/scripts/core/level/props';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';
import type { WaterArea } from '../../assets/scripts/core/level/water-layout';
import { planChapterTwoRiver, type Ch2RiverLayer, type Ch2RiverPlan } from './ch2-river';
import {
  CH3_BORDER_MASSES,
  CH3_BORDER_TREES,
  composeClusteredSetPieces,
  paintTexturedFloor,
  planClusteredDetails,
} from './room-clusters';

/** One screen: the camera view, and the tile of every generated room is a grid of these. */
export const SCREEN_COLS = 32;
export const SCREEN_ROWS = 18;
/** Normal rooms are 2×2 screens (ADR-018): 64×36 tiles. */
export const ROOM_SCREENS = 2;
export const COLS = SCREEN_COLS * ROOM_SCREENS;
export const ROWS = SCREEN_ROWS * ROOM_SCREENS;
/** Normal rooms in a chapter's pool (the ticket asks for 15–18). */
export const NORMAL_ROOMS = 16;
/**
 * Salt of the per-room seed: a one-line re-roll of the whole pool. Every layout change re-rolls the
 * rooms the balance sims play, so a re-roll has to be re-validated with `bun run check` (the sims
 * run fixed seeds; what changes is the pool, never a balance number).
 */
const CHAPTER_SEED_SALT: Readonly<Record<number, number>> = {
  1: 27,
  2: 41,
  3: 5,
  4: 27,
};
/** The boss room is the last room, so `chapterFromLevels` still sees 1..N contiguous. */
export const BOSS_ROOM = NORMAL_ROOMS + 1;

const TILE = 16;

/** Thickness of the solid border band, tiles (the acceptance test measures a 2-tile band). */
const BORDER_TILES = 2;
/** Half-width of the opening the border leaves at each door, tiles (the test's 4-tile door radius). */
const DOOR_MOUTH = 4;

/** The `.tmx` reference to a tileset that already lives next to the rooms. */
interface TilesetDef {
  readonly source: string;
  readonly name: string;
  readonly count: number;
}

const TS = {
  field: { source: 'field.tsx', name: 'field', count: 75 },
  nature: { source: 'nature.tsx', name: 'nature', count: 504 },
  relief: { source: 'relief.tsx', name: 'relief', count: 240 },
  element: { source: 'element.tsx', name: 'element', count: 240 },
  water: { source: 'water.tsx', name: 'water', count: 476 },
  ground: { source: 'ground.tsx', name: 'ground', count: 240 },
  village: { source: 'village.tsx', name: 'village', count: 240 },
  house: { source: 'house.tsx', name: 'house', count: 759 },
  towers: { source: 'towers.tsx', name: 'towers', count: 144 },
  hole: { source: 'hole.tsx', name: 'hole', count: 55 },
  desert: { source: 'desert.tsx', name: 'desert', count: 240 },
  camp: { source: 'camp.tsx', name: 'camp', count: 207 },
  floordetail: { source: 'floordetail.tsx', name: 'floordetail', count: 80 },
  tilefloor: { source: 'tilefloor.tsx', name: 'tilefloor', count: 572 },
} as const satisfies Record<string, TilesetDef>;

/**
 * Tilesets of a chapter, in `firstgid` order. #67 appends the demo's terrain sheet (`tilefloor`,
 * patches and trail), the detail sheet (`floordetail`), and the sand cliffs (`relief`) to ch4;
 * appending keeps every existing gid (and the hand-authored boss rooms) valid. Chapter 3 appends
 * `nature` for its overgrown-ruins tree line (R2: the abandoned-village sheet only has four tree
 * drawings, which read as one bush repeated along the edge).
 */
const CHAPTER_SETS: Readonly<Record<number, readonly TilesetDef[]>> = {
  1: [TS.field, TS.nature, TS.relief, TS.element, TS.floordetail, TS.tilefloor],
  2: [TS.field, TS.water, TS.nature, TS.floordetail, TS.tilefloor],
  3: [TS.ground, TS.village, TS.house, TS.towers, TS.hole, TS.floordetail, TS.tilefloor, TS.nature],
  // Chapter 4 — desert (#45, #67): the desert village/camp sheets plus patches, details and cliffs.
  4: [TS.desert, TS.camp, TS.floordetail, TS.relief, TS.tilefloor],
};

/**
 * Uniform background per chapter: the patch terrain's own baked background (see
 * `GROUND_TERRAINS[chapter].plain`), so a patch/path cell meets the floor with no box (R8).
 */
function floorGid(chapter: number): number {
  const terrain = GROUND_TERRAINS[chapter];
  if (terrain === undefined) throw new Error(`chapter ${chapter} has no ground terrain`);
  return gid(chapter, terrain.tileset.replace(/\.tsx$/, ''), terrain.plain);
}

/**
 * Detail decals per chapter, 1-based local ids of `floordetail.tsx` (16×5 tiles):
 * - row 0 (`1..16`): brown/tan pebbles (`2, 4, 5, 10`), twigs (`6, 7, 8`),
 *   shells/skulls/bones (`13, 14, 15`), small sandstone rock (`16`),
 * - row 1 (`17`): dark grey cobble/rubble pebbles,
 * - row 2 (`33..40`): green grass tufts, clover, sprouts and wildflowers (note: 32 is transparent,
 *   `49..56` are snowy winter grass and `11` is snow bumps — never used in temperate/ruins/desert).
 */
const DETAIL_TILES: Readonly<Record<number, readonly number[]>> = {
  1: [2, 5, 33, 34, 35, 36, 37, 38, 39, 40],
  2: [2, 17, 33, 34, 35, 36, 37, 39, 40],
  3: [2, 5, 6, 7, 8, 14, 15, 17, 33, 35, 36],
  4: [4, 5, 6, 10, 13, 14, 15, 16],
};

/** Stepping-stone / cobble decals stamped along the trail (`floordetail.tsx` 1-based locals). */
const PATH_STONE_TILES: Readonly<Record<number, readonly number[]>> = {
  1: [2, 5, 10],
  2: [2, 17],
  3: [2, 5, 17],
  4: [5, 10, 16],
};

/**
 * One whole pack drawing stamped onto a border layer (R2 of the #67 review): the room edge must
 * read as a tree line, not a row of 16-px decals. `tiles` is row-major local ids of `set`; a `0`
 * leaves the cell as it is.
 */
interface BorderStamp {
  readonly set: 'nature' | 'village';
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly number[];
}

/** Slice a whole drawing out of a sheet on the 16-px grid, as local tile ids. */
function sheetStamp(set: BorderStamp['set'], columns: number, x: number, y: number, width: number, height: number): BorderStamp {
  const cols = width / TILE;
  const rows = height / TILE;
  const tiles: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      tiles.push((y / TILE + row) * columns + (x / TILE + col) + 1);
    }
  }
  return { set, width: cols, height: rows, tiles };
}

/** Whole 2×2 trees of `TilesetNature.png` (24 columns) — the everyday tree line of ch1/ch2. */
const NATURE_TREES: readonly BorderStamp[] = [
  sheetStamp('nature', 24, 0, 0, 32, 32),
  sheetStamp('nature', 24, 32, 0, 32, 32),
  sheetStamp('nature', 24, 64, 0, 32, 32),
  sheetStamp('nature', 24, 96, 0, 32, 32),
  sheetStamp('nature', 24, 224, 0, 32, 32),
  sheetStamp('nature', 24, 256, 0, 32, 32),
  sheetStamp('nature', 24, 288, 0, 32, 32),
];

/** 4×3 tree clusters and 3×3 big trees: the masses that break the row of single trees (no snow tree). */
const NATURE_MASSES: readonly BorderStamp[] = [
  sheetStamp('nature', 24, 0, 32, 64, 48),
  sheetStamp('nature', 24, 64, 32, 64, 48),
  sheetStamp('nature', 24, 256, 32, 64, 48),
  sheetStamp('nature', 24, 0, 288, 48, 48),
  sheetStamp('nature', 24, 48, 288, 48, 48),
];

/**
 * The tree line of a chapter's room edge (ch4 rings the room with its sand cliff instead; ch3
 * uses `CH3_BORDER_TREES` / `CH3_BORDER_MASSES` from `room-clusters.ts`).
 */
function borderArt(chapter: number): { readonly trees: readonly BorderStamp[]; readonly masses: readonly BorderStamp[] } {
  if (chapter === 1) {
    return {
      trees: NATURE_TREES.filter((_, index) => index !== 2 && index !== 4),
      masses: NATURE_MASSES.filter((_, index) => index !== 3),
    };
  }
  if (chapter === 3) {
    return {
      trees: CH3_BORDER_TREES,
      masses: CH3_BORDER_MASSES,
    };
  }
  return { trees: NATURE_TREES, masses: NATURE_MASSES };
}

/** One border layer: its `.tmx` layer name and the row-major gid grid. */
interface BorderArtLayer {
  readonly name: string;
  readonly tiles: number[];
}

/** Border art layers, **back to front**: a later layer composites over an earlier one. */
const BORDER_LAYER_NAMES = ['border-back', 'border-mid', 'border-front'] as const;

/**
 * Stamp whole drawings along the room edge, one layer per pass, back to front, so canopies that
 * overlap *composite* instead of overwriting each other's 16-px slices. Every drawing is anchored
 * so its near (bottom) row lands on the band's inner row: a 2×2 tree is a whole tree in the band,
 * a 3-tall cluster simply runs off the outer edge. Nothing is drawn in the walkable area and no
 * drawing is cut at the band's inner edge, which is what used to make the flat silhouette line.
 * The only cells skipped are the door mouths (`covered`), so a door reads as a gap in the hedge.
 */
function paintBorderRing(
  chapter: number,
  rng: Rng,
  tiles: number[],
  stamps: readonly BorderStamp[],
  step: number,
  phase: number,
  covered: (x: number, y: number) => boolean,
): void {
  if (stamps.length === 0) return;
  const pickStamp = (): BorderStamp => stamps[int(rng, stamps.length)] ?? stamps[0]!;

  const place = (stamp: BorderStamp, ox: number, oy: number): void => {
    for (let row = 0; row < stamp.height; row += 1) {
      for (let col = 0; col < stamp.width; col += 1) {
        const x = ox + col;
        const y = oy + row;
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
        if (!covered(x, y)) continue;
        const local = stamp.tiles[row * stamp.width + col];
        if (local === undefined || local === 0) continue;
        tiles[y * COLS + x] = gid(chapter, stamp.set, local);
      }
    }
  };

  // Horizontal edges: jitter only forward (never back), so drawings in one pass never overlap.
  for (let x = -BORDER_TILES + phase; x < COLS; x += step + int(rng, 2)) {
    const stamp = pickStamp();
    place(stamp, x, BORDER_TILES - stamp.height);
    if (stamp.height <= BORDER_TILES) place(stamp, x, ROWS - stamp.height);
  }
  // Vertical edges, between the two horizontal runs.
  for (let y = BORDER_TILES + phase; y < ROWS - BORDER_TILES; y += step + int(rng, 2)) {
    const stamp = pickStamp();
    place(stamp, BORDER_TILES - stamp.width, y);
    place(stamp, COLS - BORDER_TILES, y);
  }
}

/**
 * Sand cliff pieces of `relief.tsx` (locals 121–187): the rock face under the pale shelf lip and
 * the same face with its dark base rim.
 */
const CLIFF_LIP = [125, 126, 127, 129, 130, 131] as const;
const CLIFF_BASE = [145, 146, 147, 149, 150, 151] as const;

/**
 * Chapter 4's room edge is a sand cliff (R2): the outer ring is the rock face under the pale shelf
 * overhang, the inner ring the same face with its dark base rim, per cell from the fully-opaque
 * sand-cliff tiles. The old one-tile stamping used corner tiles with transparent pixels, which is
 * what left the checkerboard of plain-sand holes.
 */
function paintCliffBand(chapter: number, rng: Rng, tiles: number[], covered: (x: number, y: number) => boolean): void {
  const pickLocal = (locals: readonly number[], fallback: number): number =>
    gid(chapter, 'relief', locals[int(rng, locals.length)] ?? fallback);
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!covered(x, y)) continue;
      const outer = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      tiles[y * COLS + x] = outer ? pickLocal(CLIFF_LIP, 125) : pickLocal(CLIFF_BASE, 145);
    }
  }
}

/**
 * Draw the border art over the band: ch4's sand-cliff ring, the other chapters' tree line.
 * Visual only: the collision stays the `edge` rects (and the view draws nothing for them).
 */
function dressBorder(
  chapter: number,
  rng: Rng,
  layers: readonly number[][],
  covered: (x: number, y: number) => boolean,
): void {
  const back = layers[0];
  if (back === undefined) throw new Error('dressBorder: no border layers');
  if (chapter === 4) {
    paintCliffBand(chapter, rng, back, covered);
    return;
  }

  const art = borderArt(chapter);
  // Pass 1: whole trees on the 2-tile lattice; pass 2: the same trees offset one tile, closing
  // the notches between canopies; pass 3: clusters and big trees every few tiles.
  const pass = (index: number, stamps: readonly BorderStamp[], step: number, phase: number): void => {
    const tiles = layers[index];
    if (tiles === undefined) return;
    paintBorderRing(chapter, rng, tiles, stamps, step, phase, covered);
  };
  pass(0, art.trees, 2, 0);
  pass(1, art.trees, 2, 1);
  pass(2, art.masses, 5, 2);
}

/** Global id of 1-based local tile `local` inside tileset `name` of `chapter`. */
export function gid(chapter: number, name: string, local: number): number {
  const set = CHAPTER_SETS[chapter];
  if (set === undefined) throw new Error(`chapter ${chapter} has no tileset set`);
  let first = 1;
  for (const entry of set) {
    if (entry.name === name) return first + local - 1;
    first += entry.count;
  }
  throw new Error(`chapter ${chapter} has no tileset ${name}`);
}

function tilesetXml(chapter: number): string {
  const set = CHAPTER_SETS[chapter];
  if (set === undefined) throw new Error(`chapter ${chapter} has no tileset set`);
  let next = 1;
  const lines = set.map((entry) => {
    const line = ` <tileset firstgid="${next}" source="${entry.source}"/>`;
    next += entry.count;
    return line;
  });
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32, same as the old dress script)
// ---------------------------------------------------------------------------

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const value = items[Math.floor(rng() * items.length)];
  if (value === undefined) throw new Error('pick: empty array');
  return value;
}

function int(rng: Rng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = int(rng, i + 1);
    const value = copy[i];
    const other = copy[j];
    if (value === undefined || other === undefined) continue;
    copy[i] = other;
    copy[j] = value;
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Prop themes (the #35 catalogue, grouped the way the hand-dressed rooms used them)
// ---------------------------------------------------------------------------

interface PropTheme {
  /** At most one landmark per room (a house, a tent, a statue). */
  readonly landmarks: readonly string[];
  /** Overlapping-canopy trees for the grove (palms in the desert). */
  readonly trees: readonly string[];
  /** Everyday solids: trees, rocks, stumps, crates. */
  readonly solids: readonly string[];
  /** Village furniture that may sit inside the cluster's 3-tile radius. */
  readonly furniture: readonly string[];
  /** Fence runs of the village street (empty where the pack has no fence). */
  readonly fences: readonly string[];
  readonly walkOvers: readonly string[];
}

const PROP_THEMES: Readonly<Record<number, PropTheme>> = {
  1: {
    landmarks: ['house-orange', 'house-beige', 'house-green', 'hut', 'tent'],
    trees: ['tree-green', 'tree-pine', 'tree-round', 'tree-big-green', 'tree-small'],
    solids: [
      'tree-green', 'tree-pine', 'tree-round', 'tree-small',
      'tree-cluster-green', 'tree-cluster-pines', 'rock-boulder', 'rock-small', 'stump-big',
      'stump', 'bush-blue', 'crate', 'logs',
    ],
    furniture: ['crate', 'crate-stack', 'logs', 'stump', 'stump-big', 'cart', 'cart-loaded', 'totem', 'rock-small'],
    fences: ['fence', 'fence', 'fence-post'],
    walkOvers: ['bush-light', 'bush-green', 'bush-dark', 'grass-tall'],
  },
  2: {
    landmarks: ['house-red', 'house-beige', 'house-orange', 'house-green'],
    trees: ['tree-green', 'tree-pine', 'tree-round', 'tree-big-orange'],
    solids: [
      'tree-green', 'tree-pine', 'tree-round', 'tree-big-orange', 'tree-cluster-pines',
      'rock-boulder-gray', 'rock-small-gray', 'stump', 'bush-blue', 'crate', 'totem',
    ],
    furniture: ['crate', 'logs', 'stump', 'stump-big', 'cart', 'rock-small-gray'],
    fences: ['fence', 'fence-post'],
    walkOvers: [...WALK_OVER_KEYS, 'fishnet'],
  },
  3: {
    landmarks: [
      'house-ruined',
      'ruined-house-orange',
      'house-mossy',
      'house-mossy-alt',
      'watchtower-ruined',
      'house-timber',
      'house-timber-large',
    ],
    trees: ['tree-mossy', 'tree-mossy-alt', 'tree-dead', 'tree-pine'],
    solids: [
      'tree-mossy',
      'tree-mossy-alt',
      'tree-dead',
      'low-broken-wall',
      'pillar-broken',
      'pillar-stump',
      'moss-tower-ruined',
      'stone-tower-ruined',
      'cart-ruined',
      'frog-statue',
      'stump-mossy',
      'barrel-mossy',
    ],
    furniture: [
      'cart-ruined',
      'barrel-mossy',
      'barrel-open-mossy',
      'crate',
      'crate-stack',
      'pillar-broken',
      'pillar-stump',
      'ruined-statue-tall',
      'frog-statue',
      'stump-mossy',
      'low-broken-wall',
    ],
    fences: ['low-broken-wall', 'palisade-ruined'],
    walkOvers: ['bush-light', 'bush-green', 'bush-dark', 'grass-tall'],
  },
  // Chapter 4 — desert: walled adobe/domed town + market stalls, oasis palms, sandstone boulders.
  4: {
    landmarks: ['desert-house', 'desert-dome', 'desert-tower', 'desert-wall-tower', 'camp-tent', 'camp-tent-open'],
    trees: ['palm-cluster', 'palm-cluster-dusty', 'palm-single', 'palm-single-alt'],
    solids: [
      'rock-sandstone',
      'rock-sandstone-small',
      'desert-tree-scrub',
      'desert-well',
      'camp-well',
      'camp-barrel',
      'logs',
      'tree-dead',
    ],
    furniture: [
      'desert-wall-segment',
      'desert-stall-red',
      'desert-stall-yellow',
      'desert-fountain',
      'desert-well',
      'camp-well',
      'camp-table',
      'camp-bench',
      'camp-signpost',
      'camp-barrel',
    ],
    fences: ['desert-wall-segment'],
    walkOvers: ['desert-agave', 'desert-bush-dry', 'desert-potted-palm'],
  },
};

// ---------------------------------------------------------------------------
// Spawn plans — today's per-room counts and roles (chapter-assets.test.ts)
// ---------------------------------------------------------------------------

type SpawnRole = EnemyRole;

interface SpawnEntry {
  readonly role: SpawnRole;
  readonly elite: boolean;
}

/** `role` (`*` = elite) */
const ELITE = '*';

function roles(...list: readonly string[]): readonly SpawnEntry[] {
  return list.map((entry): SpawnEntry =>
    entry.endsWith(ELITE)
      ? { role: entry.slice(0, -1) as SpawnRole, elite: true }
      : { role: entry as SpawnRole, elite: false },
  );
}

/**
 * Waves per chapter and **template** index (1..8): ch1 3–4 per wave, ch2 5–6 per room, ch3 7–8
 * per room with elites from the fourth room, exactly the numbers the hand-dressed rooms had.
 * Chapter 4 authors the same 8–9 per room as ch3: `roomEnemyTotal` (#41) scales a normal room to
 * 8× inside `waves.chapterTotals[3]` (64–72), so the authored list stays the role mix, not the count.
 */
const SPAWN_TEMPLATES: Readonly<Record<number, readonly (readonly (readonly SpawnEntry[])[])[]>> = {
  1: [
    [roles('chaser', 'chaser', 'caster'), roles('chaser', 'chaser', 'chaser'), roles('chaser', 'caster', 'caster')],
    [roles('chaser', 'chaser', 'caster', 'sniper')],
    [roles('chaser', 'chaser', 'caster', 'splitter')],
    [roles('chaser', 'chaser', 'caster', 'sniper')],
    [roles('chaser', 'chaser', 'caster', 'splitter')],
    [roles('chaser', 'chaser', 'caster', 'tank')],
    [roles('chaser', 'chaser', 'caster', 'tank')],
    [roles('caster*', 'chaser', 'chaser', 'tank')],
  ],
  2: [
    [roles('chaser', 'chaser'), roles('caster', 'chaser'), roles('chaser', 'sniper')],
    [roles('chaser', 'chaser'), roles('caster', 'caster'), roles('chaser', 'chaser')],
    [roles('chaser', 'chaser'), roles('caster', 'tank'), roles('chaser', 'splitter')],
    [roles('chaser', 'caster'), roles('caster', 'tank'), roles('chaser', 'chaser')],
    [roles('caster', 'chaser'), roles('tank', 'chaser'), roles('caster', 'chaser')],
    [roles('chaser', 'tank'), roles('chaser', 'caster'), roles('chaser', 'caster')],
    [roles('tank', 'caster'), roles('chaser', 'chaser'), roles('tank', 'chaser')],
    [roles('chaser*', 'caster*'), roles('tank', 'chaser'), roles('caster', 'chaser')],
  ],
  3: [
    [roles('chaser', 'chaser'), roles('chaser', 'caster'), roles('caster', 'tank', 'tank', 'sniper')],
    [roles('chaser', 'caster'), roles('chaser', 'tank'), roles('caster', 'chaser', 'tank')],
    [roles('chaser', 'caster'), roles('tank', 'chaser'), roles('chaser', 'caster', 'tank', 'chaser')],
    [roles('caster', 'chaser'), roles('tank', 'chaser'), roles('caster', 'tank', 'caster*', 'chaser')],
    [roles('chaser', 'tank'), roles('caster', 'chaser'), roles('chaser', 'tank', 'tank*', 'splitter')],
    [roles('tank', 'caster'), roles('chaser', 'tank'), roles('caster', 'chaser', 'chaser', 'chaser*')],
    [roles('chaser', 'caster'), roles('tank', 'chaser'), roles('caster', 'tank', 'chaser', 'caster*')],
    [roles('chaser', 'caster'), roles('tank', 'chaser'), roles('caster', 'tank', 'chaser', 'tank')],
  ],
  4: [
    [roles('chaser', 'chaser'), roles('chaser', 'caster'), roles('caster', 'tank', 'sniper', 'splitter')],
    [roles('chaser', 'caster'), roles('chaser', 'tank', 'sniper'), roles('caster', 'chaser', 'splitter')],
    [roles('chaser', 'chaser'), roles('tank', 'caster'), roles('chaser', 'caster', 'sniper', 'splitter')],
    [roles('caster', 'chaser'), roles('tank', 'chaser', 'splitter'), roles('caster', 'tank', 'caster*', 'sniper')],
    [roles('chaser', 'tank'), roles('caster', 'chaser', 'sniper'), roles('chaser', 'tank', 'tank*', 'splitter')],
    [roles('tank', 'caster'), roles('chaser', 'tank', 'chaser'), roles('caster', 'sniper', 'chaser', 'chaser*')],
    [roles('chaser', 'caster'), roles('tank', 'chaser', 'splitter'), roles('caster', 'tank', 'chaser', 'caster*')],
    [roles('chaser', 'caster'), roles('tank', 'chaser', 'sniper'), roles('caster', 'tank', 'chaser', 'splitter*')],
  ],
};

// ---------------------------------------------------------------------------
// Room plan
// ---------------------------------------------------------------------------

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

interface AuthoredObstacle extends Rect {
  readonly kind: Exclude<ObstacleKind, 'prop'>;
}

export interface PlannedSpawn {
  readonly role: SpawnRole;
  readonly elite: boolean;
  readonly wave: number;
  readonly at: Vec2;
}

export interface RoomPlan {
  readonly chapter: number;
  readonly room: number;
  readonly playerStart: Vec2;
  readonly doors: readonly Vec2[];
  readonly obstacles: readonly AuthoredObstacle[];
  readonly props: readonly PlacedProp[];
  readonly water: readonly WaterArea[];
  /** Row-major gid grids, `COLS × ROWS`: base floor, ground patches, path and details. */
  readonly floor: readonly number[];
  readonly ground: readonly number[];
  readonly path: readonly number[];
  /** Optional chapter-2 river & bridge tile layers drawn after `path` and before `decor`. */
  readonly riverLayers?: readonly Ch2RiverLayer[];
  readonly decor: readonly number[];
  /** Dense border ring (foliage / cliffs), one grid per art layer, back to front. */
  readonly borders: readonly BorderArtLayer[];
  readonly spawns: readonly PlannedSpawn[];
}

/** Obstacle blobs stay this far apart (tiles, edge to edge): cover, never a maze. */
const MIN_OBSTACLE_GAP = 5;
/** Obstacles keep this far from the player start, the doors and the spawns. */
const POINT_CLEARANCE = 3;
/** A set piece (grove, village, ruins, oasis, cliff) keeps outside the 8-tile auto-aim combat ring. */
const SET_PIECE_CLEARANCE = 9;
/** A spawn sits this far from the player start (tiles). */
const SPAWN_MIN_DISTANCE = 7;
const SPAWN_MAX_DISTANCE = 9.5;
/**
 * Casters stand at the back of the pack: the player's auto-aim locks the **nearest** target, and
 * an enemy under constant fire keeps its attack cycle but is delayed, so a caster that spawns
 * closest is held under fire and never gets its (3000 ms + 500 ms telegraph) shot off. Spawning it
 * behind the melee line (just outside the 6-tile hold band, at the edge of the 8-tile auto-aim
 * range) gives it the walk-in time to fire first, then die. The clear line is required so it
 * really is in the fight, not several screens away.
 */
const CASTER_MIN_DISTANCE = 10;
const CASTER_MAX_DISTANCE = 12;

/**
 * Where the player starts: near the middle of the room, so a fight has room to dodge in every
 * direction and every one of the room's 4 screens is a fair walk away. Room 1 is the room the
 * title / chapter-select backdrop draws (`MENU_BACKDROP_ROOM`), and the menu camera always shows
 * the room's bottom-left screen: its start sits there, right of the menu column, so the idle ninja
 * is on screen and not behind the panel.
 */
const START_AREA = { minX: 28, maxX: 34, minY: 16, maxY: 24 } as const;
const MENU_ROOM_START = { x: 30, y: 20 } as const;

function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return Math.hypot(dx, dy);
}

function gapToPoint(rect: Rect, point: Vec2): number {
  const cx = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const cy = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  return Math.hypot(point.x - cx, point.y - cy);
}

function rectInsideRoom(rect: Rect): boolean {
  return (
    rect.x >= 0.5 &&
    rect.y >= 0.5 &&
    rect.x + rect.width <= COLS - 0.5 &&
    rect.y + rect.height <= ROWS - 0.5
  );
}

function rectCentre(rect: Rect): Vec2 {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Conservative line check: the segment `from → to` keeps at least 0.3 tiles from every collider,
 * i.e. no obstacle stands between the two points (the same clearance the reachability tests use).
 */
function lineClear(from: Vec2, to: Vec2, colliders: readonly Rect[]): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(length / 0.25));
  for (let step = 0; step <= steps; step += 1) {
    const ratio = step / steps;
    const point = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    for (const rect of colliders) {
      if (gapToPoint(rect, point) < 0.3) return false;
    }
  }
  return true;
}

/** Screen index (0..3, 0..3) of a point. */
function screenOf(point: Vec2): { sx: number; sy: number } {
  return { sx: Math.floor(point.x / SCREEN_COLS), sy: Math.floor(point.y / SCREEN_ROWS) };
}

/** Distance from a point to the nearest water area (0 inside). */
function waterGap(water: readonly WaterArea[], point: Vec2): number {
  let best = Number.POSITIVE_INFINITY;
  for (const area of water) {
    const rect = { x: area.x, y: area.y, width: area.width, height: area.height };
    best = Math.min(best, gapToPoint(rect, point));
  }
  return best;
}

function overlapsWater(water: readonly WaterArea[], rect: Rect): boolean {
  return water.some((area) => overlap(rect, { x: area.x, y: area.y, width: area.width, height: area.height }));
}

/** A player start inside the bottom-left screen; room 1 sits clear of the menu panel. */
function planPlayerStart(room: number, rng: Rng): Vec2 {
  if (room === 1) return { ...MENU_ROOM_START };
  const x = START_AREA.minX + int(rng, START_AREA.maxX - START_AREA.minX + 1);
  const y = START_AREA.minY + int(rng, START_AREA.maxY - START_AREA.minY + 1);
  return { x, y };
}

// ---------------------------------------------------------------------------
// Border ring + doors
// ---------------------------------------------------------------------------

interface BorderPlan {
  readonly rects: Rect[];
  readonly obstacles: AuthoredObstacle[];
  /** Border art layers, back to front: whole drawings (or the cliff band) over the 2-tile ring. */
  readonly layers: readonly BorderArtLayer[];
  /** Band cells (and the solid side rects) the interior must keep clear of. */
  readonly blocked: Set<string>;
}

/** True when `(x, y)` is inside the 2-tile ring around the room. */
function inBorderBand(x: number, y: number): boolean {
  return x < BORDER_TILES || y < BORDER_TILES || x >= COLS - BORDER_TILES || y >= ROWS - BORDER_TILES;
}

/**
 * The solid border: one long `edge` obstacle per side, split around the doors, dressed with the
 * chapter's dense foliage (or the desert's cliff face). The door mouths stay open so the player
 * can walk to either door.
 */
function planBorder(chapter: number, rng: Rng, doors: readonly Vec2[]): BorderPlan {
  const layers = BORDER_LAYER_NAMES.map((name) => ({
    name,
    tiles: new Array<number>(COLS * ROWS).fill(0),
  }));
  const blocked = new Set<string>();
  const rects: Rect[] = [];
  const obstacles: AuthoredObstacle[] = [];

  const bottomDoor = doors.find((door) => door.y > ROWS / 2);
  const topDoor = doors.find((door) => door.y <= ROWS / 2);
  const bottomX = bottomDoor === undefined ? COLS / 2 : Math.floor(bottomDoor.x);
  const topX = topDoor === undefined ? COLS / 2 : Math.floor(topDoor.x);

  const add = (rect: Rect): void => {
    rects.push(rect);
    obstacles.push({ kind: 'edge', ...rect });
  };

  // Bottom and top bands, each split into a left and a right run around the door mouth.
  for (const [side, doorX] of [
    ['bottom', bottomX],
    ['top', topX],
  ] as const) {
    const y = side === 'bottom' ? ROWS - BORDER_TILES : 0;
    const leftEnd = doorX - DOOR_MOUTH;
    const rightStart = doorX + DOOR_MOUTH;
    if (leftEnd > 0) add({ x: 0, y, width: leftEnd, height: BORDER_TILES });
    if (rightStart < COLS) add({ x: rightStart, y, width: COLS - rightStart, height: BORDER_TILES });
  }
  // Left and right bands run between the two horizontal runs (corners are already covered).
  add({ x: 0, y: BORDER_TILES, width: BORDER_TILES, height: ROWS - 2 * BORDER_TILES });
  add({ x: COLS - BORDER_TILES, y: BORDER_TILES, width: BORDER_TILES, height: ROWS - 2 * BORDER_TILES });

  // Every band cell inside a solid run gets its tile; the door mouths stay open in both the
  // collision (no rect) and the art (no tile), so nothing solid is drawn where nothing blocks.
  const covered = (x: number, y: number): boolean =>
    rects.some(
      (rect) =>
        x + 0.5 >= rect.x &&
        x + 0.5 < rect.x + rect.width &&
        y + 0.5 >= rect.y &&
        y + 0.5 < rect.y + rect.height,
    );

  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!inBorderBand(x, y)) continue;
      blocked.add(`${x},${y}`);
    }
  }

  dressBorder(
    chapter,
    rng,
    layers.map((layer) => layer.tiles),
    covered,
  );

  return { rects, obstacles, layers, blocked };
}

// ---------------------------------------------------------------------------
// Ground patches (13-piece blob autotile)
// ---------------------------------------------------------------------------

/** Share of the room the noise patches cover before normalising. */
const PATCH_SHARE = 0.22;

/**
 * Smooth value noise over the whole room: two octaves of a seeded lattice, bilinearly
 * interpolated, so a threshold yields organic blobs instead of square blocks.
 */
function noiseField(rng: Rng): number[] {
  const octave = (cell: number, weight: number): number[] => {
    const gw = Math.ceil(COLS / cell) + 2;
    const gh = Math.ceil(ROWS / cell) + 2;
    const lattice = Array.from({ length: gw * gh }, () => rng());
    const values = new Array<number>(COLS * ROWS).fill(0);
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const gx = x / cell;
        const gy = y / cell;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = gx - x0;
        const fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const at = (ix: number, iy: number): number =>
          lattice[Math.min(gh - 1, Math.max(0, iy)) * gw + Math.min(gw - 1, Math.max(0, ix))] ?? 0;
        const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
        const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
        values[y * COLS + x] = weight * (top * (1 - sy) + bottom * sy);
      }
    }
    return values;
  };

  const coarse = octave(10, 0.7);
  const fine = octave(4, 0.3);
  return coarse.map((value, index) => value + (fine[index] ?? 0));
}

interface PatchPlan {
  /** Patch cells (path and detail placement avoid them where it matters). */
  readonly cells: Set<string>;
}

/**
 * The ground patch mask: noise → top N cells → `normalizePatchMask`. Cells over the river or
 * within 1 tile of `pathCells` are dropped before `normalizePatchMask`, so `path` (layer 3) and
 * `ground` (layer 2) never overlap and never stamp conflicting baked-floor fringes.
 */
function planPatches(
  rng: Rng,
  water: readonly WaterArea[],
  pathCells: ReadonlySet<string>,
  riverReserved?: ReadonlySet<string>,
): PatchPlan {
  const nearPath = new Array<boolean>(COLS * ROWS).fill(false);
  for (const key of pathCells) {
    const parts = key.split(',');
    const px = Number(parts[0]);
    const py = Number(parts[1]);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = px + dx;
        const ny = py + dy;
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) nearPath[ny * COLS + nx] = true;
      }
    }
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const noise = noiseField(rng);
    const candidates: number[] = [];
    for (let index = 0; index < COLS * ROWS; index += 1) {
      if (nearPath[index] === true) continue;
      const x = index % COLS;
      const y = Math.floor(index / COLS);
      if (riverReserved !== undefined && riverReserved.has(`${x},${y}`)) continue;
      const point = { x: x + 0.5, y: y + 0.5 };
      if (water.length > 0 && waterGap(water, point) < 0.5) continue;
      candidates.push(index);
    }
    candidates.sort((a, b) => (noise[b] ?? 0) - (noise[a] ?? 0));

    const cells = new Array<boolean>(COLS * ROWS).fill(false);
    const take = Math.min(candidates.length, Math.round(PATCH_SHARE * COLS * ROWS));
    for (let index = 0; index < take; index += 1) {
      const cell = candidates[index];
      if (cell !== undefined) cells[cell] = true;
    }

    const mask = normalizePatchMask({ cols: COLS, rows: ROWS, cells });
    const patchCells = new Set<string>();
    let count = 0;
    let innerCorners = 0;
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const blob = pickBlobTile(mask, x, y);
        if (blob === 0) continue;
        patchCells.add(`${x},${y}`);
        count += 1;
        if (blob === 4 || blob === 5 || blob === 9 || blob === 10) innerCorners += 1;
      }
    }

    const share = count / (COLS * ROWS);
    if (share >= 0.06 && share <= 0.34 && innerCorners >= 2) {
      return { cells: patchCells };
    }
  }

  throw new Error('no patch mask with 6–34% cover and inner corners');
}

/**
 * The `ground` layer for a finished mask: every cell gets the 13-piece autotile the edge picker
 * chooses. The mask is the noise patches plus the desert plateau's surface, so a plateau is a
 * raised shelf with the same fringe/outline as a patch and never a hard-edged rectangle.
 */
function paintGround(chapter: number, cells: ReadonlySet<string>): number[] {
  const terrain = GROUND_TERRAINS[chapter];
  if (terrain === undefined) throw new Error(`chapter ${chapter} has no ground terrain`);
  const mask: PatchMask = {
    cols: COLS,
    rows: ROWS,
    cells: Array.from({ length: COLS * ROWS }, (_, index) => cells.has(`${index % COLS},${Math.floor(index / COLS)}`)),
  };
  const normalised = normalizePatchMask(mask);
  const tiles = new Array<number>(COLS * ROWS).fill(0);
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const blob = pickBlobTile(normalised, x, y);
      if (blob === 0) continue;
      const local = terrain.tiles[blob - 1];
      if (local === undefined) continue;
      tiles[y * COLS + x] = gid(chapter, terrain.tileset.replace(/\.tsx$/, ''), local);
    }
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Path between the doors
// ---------------------------------------------------------------------------

interface PathPlan {
  /** Row-major `path` layer: stepping-stone gids. */
  readonly tiles: number[];
  readonly cells: Set<string>;
  readonly blocked: Set<string>;
  /** The straight street spur a village fronts onto, when this room has one. */
  readonly street: StreetPlan | null;
}

/** A straight 2-tile-wide street joined to the trail: `x..x+width` over rows `y`, `y + 1`. */
export interface StreetPlan {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/**
 * A stepping-stone path from the entrance door (bottom) to the exit door (top): a straight run up
 * from the entrance to a seeded row, across the room, then up to the exit. Obstacles are placed
 * afterwards and never on a path cell, so the route always stays walkable.
 */
function planPath(
  chapter: number,
  rng: Rng,
  doors: readonly Vec2[],
  playerStart: Vec2,
  water: readonly WaterArea[],
  villageRoom: boolean,
  ch2River: Ch2RiverPlan | null = null,
): PathPlan {
  const bottom = doors.find((door) => door.y > ROWS / 2);
  const top = doors.find((door) => door.y <= ROWS / 2);
  const startX = Math.max(4, Math.min(COLS - 5, Math.floor(bottom?.x ?? COLS / 2)));
  const endX = Math.max(4, Math.min(COLS - 5, Math.floor(top?.x ?? COLS / 2)));

  // A two-tile trail from the entrance to the exit: the centre line runs from `startX` at the
  // bottom to `endX` at the top with a seeded sine wander, so the path is a road, not a ruler.
  const phase = rng() * Math.PI * 2;
  const amplitude = 2.5 + rng() * 3.5;
  const raw = new Array<boolean>(COLS * ROWS).fill(false);
  const add = (x: number, y: number): void => {
    if (x < 1 || y < 0 || x >= COLS - 1 || y >= ROWS) return;
    raw[y * COLS + x] = true;
  };
  const stamp2x2 = (x: number, y: number): void => {
    add(x, y);
    add(x + 1, y);
    add(x, y + 1);
    add(x + 1, y + 1);
  };
  // The trail lives inside the room: rows 2..ROWS-3 keep it out of the solid border band while
  // its ends stay within 3 tiles of each door.
  const first = 2;
  const last = ROWS - 3;

  if (ch2River !== null) {
    // Chapter 2 (ADR-020): route the dirt road cleanly across the primary wooden bridge so no
    // path cell ever falls onto an impassable water `pit`.
    const bridge = ch2River.primaryBridge;
    const bridgeX = bridge.x + Math.floor((bridge.width - 2) / 2);
    const northRoadY = Math.max(first, Math.min(2, bridge.y - 2));

    // North bank: straight down from top door to `northRoadY`, horizontally to the bridge, then onto it.
    for (let y = first; y <= northRoadY; y += 1) stamp2x2(endX, y);
    const northLo = Math.min(endX, bridgeX);
    const northHi = Math.max(endX, bridgeX);
    for (let x = northLo; x <= northHi; x += 1) stamp2x2(x, northRoadY);
    for (let y = northRoadY; y < bridge.y + bridge.height; y += 1) stamp2x2(bridgeX, y);

    // South bank: organic sine wander from the bridge exit down to the bottom door.
    const southStart = bridge.y + bridge.height;
    let previous = bridgeX;
    for (let y = southStart; y < last; y += 1) {
      const denom = Math.max(1, last - southStart);
      const t = (y - southStart) / denom;
      const base = bridgeX + (startX - bridgeX) * t;
      const envelope = Math.sin(Math.PI * t);
      const wobble = (Math.sin(t * Math.PI * 2.0 + phase) * amplitude + (rng() - 0.5) * 1.5) * envelope;
      const wanted = Math.round(Math.max(3, Math.min(COLS - 6, base + wobble)));
      const centre = Math.max(previous - 2, Math.min(previous + 2, wanted));
      previous = centre;
      stamp2x2(centre, y);
    }
    // Guarantee the bottom end meets `startX` even if the bridge was horizontally far from the door.
    const southLo = Math.min(previous, startX);
    const southHi = Math.max(previous, startX);
    for (let x = southLo; x <= southHi; x += 1) stamp2x2(x, last - 1);
  } else {
    let previous = endX;
    for (let y = first; y < last; y += 1) {
      const t = (y - first) / (last - first); // 0 at the exit, 1 at the bottom door
      const base = endX + (startX - endX) * t;
      // The wander fades to nothing at both doors, so the trail's ends sit on the door tiles.
      const envelope = Math.sin((Math.PI * (y - first)) / (last - first));
      const wobble = (Math.sin(t * Math.PI * 2.2 + phase) * amplitude + (rng() - 0.5) * 1.5) * envelope;
      const wanted = Math.round(Math.max(3, Math.min(COLS - 6, base + wobble)));
      // Two tiles of drift per row at most (still cell-to-cell connected for the door check), and
      // every row stamps a full 2×2 block: the trail is two tiles wide *and* holds the 2×2 blocks
      // the 13-piece autotile needs.
      const centre = Math.max(previous - 2, Math.min(previous + 2, wanted));
      previous = centre;
      stamp2x2(centre, y);
    }
  }

  // A village street: a straight horizontal run joined to the trail, with clear ground for the
  // houses above it. The village is built on this street (R5 of the #67 review), so the trail
  // really passes the doors instead of happening to end up near them.
  // `planStreet` always runs (it owns a fixed slice of the room seed); only a village room grows
  // the street, so a grove room keeps one clean trail with no dead-end arm.
  const planned = planStreet(rng, raw, doors, playerStart, water, ch2River?.reservedCells);
  const street = villageRoom ? planned : null;
  if (street !== null) {
    for (let y = street.y; y <= street.y + 1; y += 1) {
      for (let x = street.x; x < street.x + street.width; x += 1) add(x, y);
    }
  }

  const mask = normalizePatchMask({ cols: COLS, rows: ROWS, cells: raw });
  const terrain = GROUND_TERRAINS[chapter];
  if (terrain === undefined) throw new Error(`chapter ${chapter} has no ground terrain`);

  const tiles = new Array<number>(COLS * ROWS).fill(0);
  const cells = new Set<string>();
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const blob = pickBlobTile(mask, x, y);
      if (blob === 0) continue;
      const local = terrain.tiles[blob - 1];
      if (local === undefined) continue;
      tiles[y * COLS + x] = gid(chapter, terrain.tileset.replace(/\.tsx$/, ''), local);
      cells.add(`${x},${y}`);
    }
  }

  return { tiles, cells, blocked: cells, street };
}

/** How long the street of a village is, tiles. */
const STREET_WIDTH = 13;

/**
 * Find a stretch of straight street for the village: a row where the trail can grow a horizontal
 * arm with five clear rows above it (room for the houses). The arm joins the trail at one end, so
 * the trail itself never crosses the house row. Returns `null` when no spot fits (chapter 2
 * tolerates that; the village chapters retry the room).
 */
function planStreet(
  rng: Rng,
  trail: readonly boolean[],
  doors: readonly Vec2[],
  playerStart: Vec2,
  water: readonly WaterArea[],
  riverReserved?: ReadonlySet<string>,
): StreetPlan | null {
  const free = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < COLS && y < ROWS && trail[y * COLS + x] === true;

  // Candidate street rows sit inside the upper or lower interior (never crammed against row 9 where
  // tall roofs clip above the camera), while `SET_PIECE_CLEARANCE` keeps the middle around the
  // player start open for combat.
  // The street runs near the top edge of the room, so the village lines the wall and the middle of
  // the fight stays open (the houses have south-facing doors, so the street must be below them).
  const rows = [9, 10, 11, 12] as const;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const y = rows[int(rng, rows.length)] ?? 10;
    // The trail's columns on this row: the arm grows out of the left or the right side of it.
    let minX = COLS;
    let maxX = -1;
    for (let x = 0; x < COLS; x += 1) {
      if (!free(x, y) || !free(x, y + 1)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (maxX < 0) continue;
    const right = rng() < 0.5;
    const x = right ? maxX + 2 : minX - 2 - STREET_WIDTH;
    if (x < 3 || x + STREET_WIDTH > COLS - 3) continue;

    // Six rows above the arm hold the houses/watchtowers, and three below hold the wall/fence run.
    const yard = { x: x - 1, y: y - 7, width: STREET_WIDTH + 2, height: 6 };
    const footprint = { x: x - 1, y: y - 7, width: STREET_WIDTH + 2, height: 11 };
    if (yard.y < 2 || y + 5 > ROWS - 2) continue;
    let blockedYard = false;
    for (let cy = yard.y; cy < yard.y + yard.height && !blockedYard; cy += 1) {
      for (let cx = yard.x; cx < yard.x + yard.width; cx += 1) {
        if (free(cx, cy)) {
          blockedYard = true;
          break;
        }
      }
    }
    if (blockedYard) continue;
    if (water.length > 0 && overlapsWater(water, footprint)) continue;
    if (riverReserved !== undefined && coversBlocked(riverReserved, footprint)) continue;
    if (gapToPoint(footprint, playerStart) < SET_PIECE_CLEARANCE) continue;
    if (doors.some((door) => gapToPoint(footprint, door) < 3)) continue;
    return { x, y, width: STREET_WIDTH };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Obstacles + props
// ---------------------------------------------------------------------------

interface ColliderBook {
  readonly rects: Rect[];
}

/** True when any tile of `rect` is a path cell or a border-band cell. */
function coversBlocked(blocked: ReadonlySet<string>, rect: Rect): boolean {
  for (let y = Math.floor(rect.y); y < Math.ceil(rect.y + rect.height); y += 1) {
    for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.width); x += 1) {
      if (blocked.has(`${x},${y}`)) return true;
    }
  }
  return false;
}

/** A random collider top-left inside a screen's core, for a `width × height` collider. */
function randomColliderInScreen(rng: Rng, sx: number, sy: number, width: number, height: number): Rect | null {
  const minX = sx * SCREEN_COLS + 3;
  const maxX = (sx + 1) * SCREEN_COLS - 3 - width;
  const minY = sy * SCREEN_ROWS + 3;
  const maxY = (sy + 1) * SCREEN_ROWS - 3 - height;
  if (maxX < minX || maxY < minY) return null;
  return {
    x: Math.round(minX + rng() * (maxX - minX)),
    y: Math.round(minY + rng() * (maxY - minY)),
    width,
    height,
  };
}

const AUTHORED_SHAPES: Readonly<Record<number, readonly { kind: Exclude<ObstacleKind, 'prop'>; width: number; height: number }[]>> = {
  // The drawn frame decides the size of a stretched obstacle (see `core/level/obstacle-visuals`):
  // ch1/ch2 boulders and the ch3 hole are 2×2, the ch3 stone column is 1 wide and 2 tall. Walls
  // repeat one 16×16 tile, so any size is fine.
  1: [
    { kind: 'pillar', width: 2, height: 2 },
    { kind: 'pillar', width: 1, height: 1 },
    { kind: 'pit', width: 2, height: 2 },
    { kind: 'wall', width: 3, height: 1 },
    { kind: 'wall', width: 1, height: 3 },
  ],
  // Chapter 2 (M11 ADR-020): `pit` obstacles belong exclusively to impassable river & waterfall tiles.
  2: [
    { kind: 'pillar', width: 2, height: 2 },
    { kind: 'pillar', width: 1, height: 1 },
    { kind: 'wall', width: 3, height: 1 },
    { kind: 'wall', width: 1, height: 3 },
  ],
  3: [
    { kind: 'pillar', width: 1, height: 2 },
    { kind: 'pillar', width: 1, height: 1 },
    { kind: 'pit', width: 2, height: 2 },
    { kind: 'wall', width: 3, height: 1 },
    { kind: 'wall', width: 1, height: 3 },
  ],
  // Chapter 4 — desert: sandstone boulders and broken walls; `pit` (3×3 oasis pond) is placed only
  // by `placeOasis` so water never spawns without its shore palms and puddles.
  4: [
    { kind: 'pillar', width: 2, height: 2 },
    { kind: 'pillar', width: 1, height: 1 },
    { kind: 'wall', width: 3, height: 1 },
    { kind: 'wall', width: 1, height: 3 },
  ],
};

/** Multi-tile flat ground art stamped onto `decor` before scatter (ch3 flagstones, ch4 puddles). */
interface DecorStamp {
  readonly set: 'village' | 'desert' | 'floordetail';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Row-major 1-based local tile ids inside `set`. */
  readonly locals: readonly number[];
}

const CH3_STONE_PADS: readonly Pick<DecorStamp, 'set' | 'width' | 'height' | 'locals'>[] = [
  // 2×2 mossy stepping-stone cluster (`TilesetVillageAbandoned` cols 6–7, rows 3–4).
  { set: 'village', width: 2, height: 2, locals: [69, 70, 89, 90] },
  // 2×2 round mossy flagstone pad (`TilesetVillageAbandoned` cols 5–6, rows 5–6).
  { set: 'village', width: 2, height: 2, locals: [108, 109, 128, 129] },
];

const CH4_OASIS_PUDDLES: readonly Pick<DecorStamp, 'set' | 'width' | 'height' | 'locals'>[] = [
  // 2×1 shallow oval oasis puddle (`TilesetDesert` cols 17–18, row 10).
  { set: 'desert', width: 2, height: 1, locals: [218, 219] },
  // 1×1 kidney oasis puddle + droplet (`TilesetDesert` col 19, row 10).
  { set: 'desert', width: 1, height: 1, locals: [220] },
];

interface GeometryArgs {
  readonly chapter: number;
  readonly room: number;
  readonly rng: Rng;
  readonly playerStart: Vec2;
  readonly doors: readonly Vec2[];
  readonly water: readonly WaterArea[];
  /** Path cells + border band: nothing solid goes there. */
  readonly blocked: ReadonlySet<string>;
  /** The village street, when this room has one (see `planStreet`). */
  readonly street: StreetPlan | null;
  /** The border's solid rects: interior blobs keep `MIN_OBSTACLE_GAP` clear of them. */
  readonly borderRects: readonly Rect[];
  /** Chapter 2 river `pit` rects: interior solids keep >= 2 tiles clear so tanks never wedge. */
  readonly riverPits?: readonly Rect[];
}

interface GeometryResult {
  readonly obstacles: AuthoredObstacle[];
  readonly props: PlacedProp[];
  /** `true` when the room got its village (even rooms must have one, see `generateRoom`). */
  readonly village: boolean;
  /** `true` when a chapter-3 room placed its dedicated ruins cluster. */
  readonly ruins: boolean;
  /** `true` when a chapter-4 room placed its oasis pond + palm cluster. */
  readonly oasis: boolean;
  /** Ground cells of the desert cliff plateau (its shelf joins the patch mask). */
  readonly plateauSurface: readonly string[];
  /** Extra `border-front`-layer cells: the plateau's sand-cliff face. */
  readonly plateauFace: readonly { readonly index: number; readonly value: number }[];
  /** Multi-tile flat ground stamps queued for the `decor` layer. */
  readonly decorStamps: readonly DecorStamp[];
}

/** Sprite rect of a prop in tiles, from its catalogue cell. */
function spriteRect(def: PropDef, x: number, y: number): Rect {
  return { x, y, width: def.rect.width / TILE, height: def.rect.height / TILE };
}

/**
 * Obstacles + props: the set pieces of the room (grove, village, cliff plateau) followed by the
 * per-screen solids. Everything keeps its distance from the start, the doors, the water, the path
 * and the border, and `validatePlan` proves the room still plays.
 */
function planGeometry(args: GeometryArgs): GeometryResult {
  const { chapter, room, rng, playerStart, doors, water, blocked, street, borderRects, riverPits = [] } = args;
  const theme = PROP_THEMES[chapter];
  if (theme === undefined) throw new Error(`chapter ${chapter} has no prop theme`);

  const book: ColliderBook = { rects: [] };
  const obstacles: AuthoredObstacle[] = [];
  const props: PlacedProp[] = [];
  const plateauSurface: string[] = [];
  /** Screens a set piece already dresses with cover, so per-screen scatter stays light there. */
  const villageScreens = new Set<string>();
  const plateauFace: { index: number; value: number }[] = [];
  const decorStamps: DecorStamp[] = [];

  const clearOfPoints = (rect: Rect, clearance: number): boolean =>
    gapToPoint(rect, playerStart) >= clearance && doors.every((door) => gapToPoint(rect, door) >= clearance);

  /**
   * `minGap` is the field rule between interior blobs (cover, not a maze); the solid border ring
   * is allowed to be closer (it is the room's hedge), so a prop can stand against the edge and the
   * middle of the room stays open to dodge in.
   */
  const colliderFits = (collider: Rect, blockedCheck: Rect, minGap: number): boolean => {
    if (!rectInsideRoom(blockedCheck)) return false;
    if (!clearOfPoints(blockedCheck, POINT_CLEARANCE)) return false;
    if (water.length > 0 && overlapsWater(water, blockedCheck)) return false;
    if (coversBlocked(blocked, blockedCheck)) return false;
    if (borderRects.some((other) => gapBetween(collider, other) < 1)) return false;
    if (riverPits.some((other) => gapBetween(collider, other) < 2)) return false;
    return book.rects.every((other) => gapBetween(collider, other) >= minGap);
  };

  /** Place a catalogue prop at an exact sprite anchor. */
  const placeAt = (key: string, x: number, y: number, minGap: number): boolean => {
    const def = propDef(chapter, key);
    if (def === undefined) return false;
    const sprite = spriteRect(def, x, y);
    if (sprite.x < 1 || sprite.y < 1 || sprite.x + sprite.width > COLS - 1 || sprite.y + sprite.height > ROWS - 1) {
      return false;
    }
    const collider = def.collider === null ? null : propCollider({ key, x, y }, def);
    if (!colliderFits(collider ?? sprite, sprite, minGap)) return false;
    if (collider !== null) book.rects.push(collider);
    props.push({ key, x, y });
    return true;
  };

  const placeAuthored = (kind: Exclude<ObstacleKind, 'prop'>, rect: Rect): boolean => {
    if (!colliderFits(rect, rect, MIN_OBSTACLE_GAP)) return false;
    book.rects.push(rect);
    obstacles.push({ kind, ...rect });
    return true;
  };

  // -- Set piece: grove of overlapping trees (ch4: a palm group by the oasis) ----------------
  const placeGrove = (): boolean => {
    const offsets: readonly (readonly [number, number])[] = [
      [0, 0],
      [2, 0],
      [1, 2],
      [3, 2],
    ];
    const keys = shuffle(rng, theme.trees).slice(0, 4);
    if (keys.length < 3) return false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const bx = 6 + int(rng, COLS - 18);
      const by = 6 + int(rng, ROWS - 16);
      const placed: { key: string; x: number; y: number; rect: Rect }[] = [];
      let ok = true;
      for (const [index, key] of keys.entries()) {
        const offset = offsets[index] ?? [0, 0];
        const def = propDef(chapter, key);
        if (def === undefined) {
          ok = false;
          break;
        }
        const x = bx + offset[0];
        const y = by + offset[1];
        const sprite = spriteRect(def, x, y);
        if (sprite.x < 3 || sprite.y < 3 || sprite.x + sprite.width > COLS - 3 || sprite.y + sprite.height > ROWS - 3) {
          ok = false;
          break;
        }
        const collider = def.collider === null ? sprite : propCollider({ key, x, y }, def) ?? sprite;
        if (!clearOfPoints(sprite, SET_PIECE_CLEARANCE) || coversBlocked(blocked, sprite)) {
          ok = false;
          break;
        }
        if (water.length > 0 && overlapsWater(water, sprite)) {
          ok = false;
          break;
        }
        if (riverPits.some((other) => gapBetween(collider, other) < 2)) {
          ok = false;
          break;
        }
        if (book.rects.some((other) => gapBetween(collider, other) < 1)) {
          ok = false;
          break;
        }
        placed.push({ key, x, y, rect: collider });
      }
      if (!ok) continue;
      for (const tree of placed) {
        book.rects.push(tree.rect);
        props.push({ key: tree.key, x: tree.x, y: tree.y });
      }
      return true;
    }
    return false;
  };

  // -- Set piece: a village — two or three houses on a street, fences, well/sign/stump --------
  /** The gap between the buildings and the fences of one village (they stand shoulder to shoulder). */
  const VILLAGE_GAP = 1;

  /** Place one house at a sprite anchor; commits its prop and collider. */
  const placeHouseAt = (key: string, x: number, y: number, minGap: number = MIN_OBSTACLE_GAP): boolean => {
    const def = propDef(chapter, key);
    if (def === undefined) return false;
    const width = Math.ceil(def.rect.width / TILE);
    const height = Math.ceil(def.rect.height / TILE);
    if (x < BORDER_TILES + 1 || y < BORDER_TILES + 1) return false;
    if (x + width > COLS - BORDER_TILES - 1 || y + height > ROWS - BORDER_TILES - 1) return false;
    const house = spriteRect(def, x, y);
    if (gapToPoint(house, playerStart) < SET_PIECE_CLEARANCE) return false;
    const collider = def.collider === null ? house : propCollider({ key, x, y }, def) ?? house;
    if (!colliderFits(collider, house, minGap)) return false;
    book.rects.push(collider);
    props.push({ key, x, y });
    return true;
  };

  /** Put one catalogue prop near a structure/pond (1.6-tile collider gap so tanks never wedge). */
  const placeNearHouse = (houseRect: Rect, key: string): boolean => {
    const def = propDef(chapter, key);
    if (def === undefined) return false;
    const width = Math.ceil(def.rect.width / TILE);
    const height = Math.ceil(def.rect.height / TILE);
    for (let tries = 0; tries < 28; tries += 1) {
      const side = int(rng, 4);
      const step = 2 + int(rng, 2);
      const x =
        side === 0 ? Math.round(houseRect.x) - width - step
        : side === 1 ? Math.round(houseRect.x + houseRect.width) + step
        : Math.round(houseRect.x) - 1 + int(rng, Math.max(1, Math.round(houseRect.width) - width + 3));
      const y =
        side === 0 || side === 1
          ? Math.round(houseRect.y) - 1 + int(rng, Math.max(1, Math.round(houseRect.height) - height + 3))
          : side === 2 ? Math.round(houseRect.y) - height - step
          : Math.round(houseRect.y + houseRect.height) + step;
      if (x < 2 || y < 2 || x + width > COLS - 2 || y + height > ROWS - 2) continue;
      const sprite = spriteRect(def, x, y);
      if (gapBetween(houseRect, sprite) > 3) continue;
      if (gapToPoint(sprite, playerStart) < SET_PIECE_CLEARANCE) continue;
      const collider = def.collider === null ? null : propCollider({ key, x, y }, def);
      // Keep >= 1.6 tiles between solid colliders so no 1.4-wide tank/enemy wedges in a narrow slot.
      if (!colliderFits(collider ?? sprite, sprite, collider === null ? 0.5 : 1.6)) continue;
      if (collider !== null) book.rects.push(collider);
      props.push({ key, x, y });
      return true;
    }
    return false;
  };

  /**
   * A village: two or three houses shoulder to shoulder along a fenced street, with the trail
   * passing their doors and the everyday furniture (well, sign, stump, crates) in front (R5 of the
   * #67 review — one hut with loose crates is not a village). The street runs along the room's
   * trail, so a cleared room walks straight through the village on the way to the exit door.
   */
  const placeVillage = (): boolean => {
    const houses = theme.landmarks.filter((key) => propDef(chapter, key)?.kind === 'house');
    if (houses.length === 0 || street === null) return false;

    const panel = theme.fences.reduce<string | null>((best, key) => {
      const def = propDef(chapter, key);
      if (def === undefined) return best;
      const bestDef = best === null ? undefined : propDef(chapter, best);
      return bestDef === undefined || def.rect.width > bestDef.rect.width ? key : best;
    }, null);

    const propsBefore = props.length;
    const rectsBefore = book.rects.length;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      // The houses stand on the north pavement of the street, doors toward it: two or three of
      // them shoulder to shoulder, aligned by the street side and one tile apart.
      const doorRow = street.y - 1;
      const rowX = street.x + (attempt === 0 ? 0 : int(rng, 3));
      const placed: { key: string; x: number; y: number; rect: Rect }[] = [];
      let cursor = rowX;
      for (const key of shuffle(rng, houses)) {
        if (placed.length >= 3) break;
        const def = propDef(chapter, key);
        if (def === undefined) continue;
        const width = Math.ceil(def.rect.width / TILE);
        const height = Math.ceil(def.rect.height / TILE);
        const y = doorRow - height;
        if (!placeHouseAt(key, cursor, y, VILLAGE_GAP)) continue;
        placed.push({ key, x: cursor, y, rect: spriteRect(def, cursor, y) });
        const screen = screenOf({ x: cursor + width / 2, y: y + height / 2 });
        villageScreens.add(`${screen.sx},${screen.sy}`);
        cursor += width + VILLAGE_GAP;
      }
      if (placed.length < 2) {
        props.length = propsBefore;
        book.rects.length = rectsBefore;
        continue;
      }

      // A continuous fence/wall run on the far side of the street: 4 panels for 1-tile wooden/stone
      // fences, 2 panels for tall 3×3 desert town walls so the kiting lane stays open.
      const fenceY = street.y + 2;
      let fenced = 0;
      if (panel !== null) {
        const panelDef = propDef(chapter, panel);
        const width = Math.ceil((panelDef?.rect.width ?? TILE) / TILE);
        const maxPanels = (panelDef?.rect.height ?? TILE) > TILE ? 2 : 4;
        // Panels touch their neighbours (the rails join), so the village gap floor is 0 here.
        for (let index = 0; index < maxPanels; index += 1) {
          if (!placeAt(panel, rowX + index * width, fenceY, 0)) break;
          fenced += 1;
        }
      }

      // Furniture: the well, the sign, a stump and a crate, tucked against the houses.
      const first = placed[0];
      let near = fenced > 0 ? 1 : 0;
      for (const key of shuffle(rng, theme.furniture)) {
        if (near >= 5) break;
        const target = placed[near % placed.length] ?? first;
        if (target !== undefined && placeNearHouse(target.rect, key)) near += 1;
      }

      if (near >= 3) {
        if (chapter === 3) {
          for (let padIndex = 0; padIndex < 3; padIndex += 1) {
            const pad = pick(rng, CH3_STONE_PADS);
            const px = street.x + 1 + int(rng, Math.max(1, street.width - 3));
            const py = street.y + (padIndex % 2 === 0 ? 0 : 2);
            decorStamps.push({ ...pad, x: px, y: py });
          }
        }
        return true;
      }
      // Not a village: undo everything this attempt placed and try again on the same street.
      props.length = propsBefore;
      book.rects.length = rectsBefore;
    }
    return false;
  };

  // -- Set piece: chapter 4 desert oasis pond (3×3 pond pit + clustered palms + shore puddles) ---
  const placeOasis = (): boolean => {
    const pondSize = 3;
    const propsBefore = props.length;
    const rectsBefore = book.rects.length;
    const obsBefore = obstacles.length;
    for (let attempt = 0; attempt < 56; attempt += 1) {
      const px = 6 + int(rng, COLS - 14 - pondSize);
      const py = 6 + int(rng, ROWS - 14 - pondSize);
      const pond: Rect = { x: px, y: py, width: pondSize, height: pondSize };
      if (gapToPoint(pond, playerStart) < SET_PIECE_CLEARANCE) continue;
      if (!colliderFits(pond, pond, MIN_OBSTACLE_GAP)) continue;

      book.rects.push(pond);
      obstacles.push({ kind: "pit", ...pond });

      // Palm candidates ring the shore so 4-tile canopies overlap each other and touch the pond while
      // 0.75-tile trunk colliders keep >= 1.5 tiles from the pond and each other (zero enemy wedges).
      const palmSlots: readonly { readonly key: string; readonly dx: number; readonly dy: number }[] = [
        { key: "palm-cluster", dx: -4, dy: -3 },
        { key: "palm-cluster-dusty", dx: -1, dy: -4 },
        { key: "palm-cluster", dx: 3, dy: -3 },
        { key: "palm-single", dx: -4, dy: 0 },
        { key: "palm-single-alt", dx: 5, dy: 0 },
        { key: "palm-cluster-dusty", dx: -1, dy: 4 },
        { key: "palm-single", dx: -3, dy: 4 },
        { key: "palm-single-alt", dx: 4, dy: 4 },
      ];
      const placedPalms: Rect[] = [];
      for (const slot of palmSlots) {
        if (placedPalms.length >= 4) break;
        const def = propDef(chapter, slot.key);
        if (def === undefined) continue;
        const x = px + slot.dx;
        const y = py + slot.dy;
        const sprite = spriteRect(def, x, y);
        if (sprite.x < 3 || sprite.y < 3 || sprite.x + sprite.width > COLS - 3 || sprite.y + sprite.height > ROWS - 3) {
          continue;
        }
        const collider = def.collider === null ? sprite : propCollider({ key: slot.key, x, y }, def) ?? sprite;
        if (!clearOfPoints(collider, SET_PIECE_CLEARANCE) || coversBlocked(blocked, sprite)) continue;
        if (borderRects.some((other) => gapBetween(collider, other) < 1)) continue;
        if (!book.rects.every((other) => gapBetween(collider, other) >= 1.5)) continue;
        book.rects.push(collider);
        props.push({ key: slot.key, x, y });
        placedPalms.push(sprite);
      }

      // Require >= 3 palms with at least one touching pair so the oasis reads as a shady grove.
      const hasTouchingPair = placedPalms.some((a, index) =>
        placedPalms.slice(index + 1).some((b) => gapBetween(a, b) <= 0),
      );
      if (placedPalms.length < 3 || !hasTouchingPair) {
        props.length = propsBefore;
        book.rects.length = rectsBefore;
        obstacles.length = obsBefore;
        continue;
      }

      // Tuck 1–2 desert shore props (sandstone rock, scrub or agave) near the bank.
      let shore = 0;
      for (const key of shuffle(rng, ['rock-sandstone-small', 'rock-sandstone', 'desert-tree-scrub', 'desert-agave', 'desert-bush-dry', 'desert-potted-palm'])) {
        if (shore >= 2) break;
        if (placeNearHouse(pond, key)) shore += 1;
      }

      // Queue 2 shallow satellite puddles + tan shore stones beside the oasis pond.
      const puddlePositions: readonly (readonly [number, number])[] = [
        [px - 3, py + 2],
        [px + pondSize + 1, py + 1],
        [px + 1, py + pondSize + 1],
      ];
      for (const [index, [sx, sy]] of puddlePositions.entries()) {
        const template = CH4_OASIS_PUDDLES[index % CH4_OASIS_PUDDLES.length];
        if (template !== undefined) decorStamps.push({ ...template, x: sx, y: sy });
      }
      decorStamps.push({ set: 'floordetail', x: px + pondSize, y: py + pondSize, width: 1, height: 1, locals: [10] });

      const screen = screenOf({ x: px + pondSize / 2, y: py + pondSize / 2 });
      villageScreens.add(`${screen.sx},${screen.sy}`);
      return true;
    }
    return false;
  };

  // -- Set piece: desert cliff plateau (a raised sand mesa from TilesetRelief) -------------------
  const placeCliff = (): boolean => {
    const widths = [6, 7, 8] as const;
    const width = widths[int(rng, widths.length)] ?? 8;
    // Four rows from `TilesetRelief` (20 cols, 1-based locals): black-outlined top rim, flat pale
    // sand shelf, overhang lip, and rock base rim — seamless mesa with zero ground-fringe gap.
    const mesaRows: readonly (readonly [number, number, number])[] = [
      [102, 103, 104],
      [122, 123, 124],
      [105, 106, 107],
      [145, 146, 147],
    ];
    const height = mesaRows.length;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const minX = BORDER_TILES + 1;
      const minY = BORDER_TILES + 1;
      const x = minX + int(rng, Math.max(1, COLS - 2 * minX - width));
      const y = minY + int(rng, Math.max(1, ROWS - 2 * minY - height));
      const rect: Rect = { x, y, width, height };
      if (gapToPoint(rect, playerStart) < SET_PIECE_CLEARANCE) continue;
      if (!colliderFits(rect, rect, MIN_OBSTACLE_GAP)) continue;
      book.rects.push(rect);
      obstacles.push({ kind: 'edge', ...rect });
      for (let row = 0; row < height; row += 1) {
        const [west, mid, east] = mesaRows[row]!;
        for (let col = 0; col < width; col += 1) {
          const local = col === 0 ? west : col === width - 1 ? east : mid;
          plateauFace.push({ index: (y + row) * COLS + (x + col), value: gid(chapter, 'relief', local) });
        }
      }
      // Tuck a sandstone rock at the cliff foot, as in `desert-town.png`.
      placeNearHouse(rect, rng() < 0.6 ? 'rock-sandstone' : 'rock-sandstone-small');
      return true;
    }
    return false;
  };

  // Compose set pieces per chapter theme while keeping one clear focus per screen so kiting stays open:
  // - Ch1/Ch3/Ch4: cohesive cluster composition via `composeClusteredSetPieces` (`room-clusters.ts`).
  // - Ch2: keeps existing river/grove/village flow (owned by `rivers`).
  let village = false;
  let oasis = false;
  let ruins = false;
  if (chapter === 2) {
    village = room % 2 === 0 ? placeVillage() : false;
    if (room % 2 === 1) placeGrove();
  } else {
    const composed = composeClusteredSetPieces({
      chapter,
      room,
      rng,
      playerStart,
      doors,
      blocked,
      street,
      borderRects,
      colliderBook: book.rects,
      props,
      decorStamps,
      villageScreens,
      colliderFits,
      clearOfPoints,
      coversBlocked: (rect) => coversBlocked(blocked, rect),
      placeAt,
      placeHouseAt,
      placeNearHouse,
      placeOasis,
      placeCliff,
    });
    village = composed.village;
    ruins = composed.ruins;
    oasis = composed.oasis;
  }

  // A landmark only in the entrance screen (the entrance): the room keeps one focus, not a town.
  if (chapter === 2 && room % 3 === 1 && room % 2 === 0) {
    for (const key of shuffle(rng, theme.landmarks)) {
      if (placePropInScreen(0, ROOM_SCREENS - 1, key)) break;
    }
  }

  function placePropInScreen(sx: number, sy: number, key: string): boolean {
    const def = propDef(chapter, key);
    if (def === undefined || def.collider === null) return false;
    const width = Math.ceil(def.collider.width / TILE);
    const height = Math.ceil(def.collider.height / TILE);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const target = randomColliderInScreen(rng, sx, sy, width, height);
      if (target === null) return false;
      if (!colliderFits(target, target, MIN_OBSTACLE_GAP)) continue;
      const anchor = anchorForCollider(def, target);
      if (anchor === null) continue;
      if (placeAt(key, anchor.x, anchor.y, MIN_OBSTACLE_GAP)) return true;
    }
    return false;
  }

  const placeWalkOver = (sx: number, sy: number, key: string): void => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const point = {
        x: sx * SCREEN_COLS + 1 + int(rng, SCREEN_COLS - 2),
        y: sy * SCREEN_ROWS + 1 + int(rng, SCREEN_ROWS - 2),
      };
      const cell = { x: point.x - 0.5, y: point.y - 0.5, width: 1, height: 1 };
      if (gapToPoint(cell, playerStart) < 2) continue;
      if (doors.some((door) => gapToPoint(cell, door) < 2)) continue;
      if (coversBlocked(blocked, cell)) continue;
      if (water.length > 0 && waterGap(water, point) < 1.5) continue;
      props.push({ key, x: point.x, y: point.y });
      return;
    }
  };

  const solids = shuffle(rng, theme.solids);
  for (let sy = 0; sy < ROOM_SCREENS; sy += 1) {
    for (let sx = 0; sx < ROOM_SCREENS; sx += 1) {
      // Keep the screen holding the player start open: it needs a way out in every direction.
      const startScreen = screenOf(playerStart);
      const isStart = sx === startScreen.sx && sy === startScreen.sy;
      // A village screen already has its cover (houses, fence, furniture): adding the per-screen
      // solids there would wall the middle off. The fight keeps its dodging room.
      if (villageScreens.has(`${sx},${sy}`)) continue;
      // Chapter 3 is the busiest pool: one interior solid per screen keeps the middle open.
      const targeted = isStart ? 1 : chapter === 3 ? 1 : 1 + int(rng, 2);

      if (!isStart && rng() < 0.45) {
        const shapes = AUTHORED_SHAPES[chapter] ?? [];
        for (const shape of shuffle(rng, shapes)) {
          let done = false;
          for (let attempt = 0; attempt < 6 && !done; attempt += 1) {
            const rect = randomColliderInScreen(rng, sx, sy, shape.width, shape.height);
            if (rect === null) break;
            done = placeAuthored(shape.kind, rect);
          }
          if (done) break;
        }
      }

      let placed = 0;
      for (const key of shuffle(rng, solids)) {
        if (placed >= targeted) break;
        if (placePropInScreen(sx, sy, key)) placed += 1;
      }

      const walkTarget = chapter === 2 ? 3 + int(rng, 2) : 1 + int(rng, 2);
      for (let index = 0; index < walkTarget; index += 1) {
        placeWalkOver(sx, sy, pick(rng, theme.walkOvers));
      }
    }
  }

  return { obstacles, props, village, ruins, oasis, plateauSurface, plateauFace, decorStamps };
}

/**
 * Prop anchor whose collider lands on `target` (the collider offset inside the sprite). Tiled
 * coordinates are written in pixels, so the anchor is rounded to the 1/16-tile pixel grid; the
 * collider then sits within half a pixel of `target`.
 */
function anchorForCollider(def: ReturnType<typeof propDef>, target: Rect): PlacedProp | null {
  if (def === undefined) return null;
  const collider = def.collider;
  if (collider === null) return null;
  const snap = (value: number): number => Math.round(value * TILE) / TILE;
  return {
    key: def.key,
    x: snap(target.x - collider.x / TILE),
    y: snap(target.y - collider.y / TILE),
  };
}

/** Spawn points over the room's 4 screens around the player: 7–12 tiles away, clear of every blob. */
function planSpawns(
  chapter: number,
  room: number,
  rng: Rng,
  playerStart: Vec2,
  doors: readonly Vec2[],
  colliders: readonly Rect[],
  water: readonly WaterArea[],
  losColliders: readonly Rect[] = colliders,
): PlannedSpawn[] {
  const template = SPAWN_TEMPLATES[chapter];
  if (template === undefined) throw new Error(`chapter ${chapter} has no spawn template`);
  const waves = template[(room - 1) % template.length];
  if (waves === undefined) throw new Error(`chapter ${chapter} has no spawn template for room ${room}`);

  const startScreen = screenOf(playerStart);
  // The 2×2 block of screens around the start, preferring the side with room in the room.
  const baseSx = Math.min(ROOM_SCREENS - 2, Math.max(0, startScreen.sx - 1));
  const baseSy = Math.min(ROOM_SCREENS - 2, Math.max(0, startScreen.sy - 1));
  const screens = [
    { sx: startScreen.sx, sy: startScreen.sy },
    { sx: baseSx, sy: baseSy },
    { sx: baseSx + 1, sy: baseSy },
    { sx: baseSx, sy: baseSy + 1 },
    { sx: baseSx + 1, sy: baseSy + 1 },
  ].filter(
    (screen, index, all) =>
      all.findIndex((other) => other.sx === screen.sx && other.sy === screen.sy) === index,
  );

  const spawns: PlannedSpawn[] = [];
  const placed: Vec2[] = [];
  const order = shuffle(rng, screens);
  let next = 0;

  const free = (point: Vec2, clearance: number): boolean => {
    if (point.x < ROOM_EDGE_MARGIN_TILES + 0.5 || point.x > COLS - ROOM_EDGE_MARGIN_TILES - 0.5) return false;
    if (point.y < ROOM_EDGE_MARGIN_TILES + 0.5 || point.y > ROWS - ROOM_EDGE_MARGIN_TILES - 0.5) return false;
    for (const rect of colliders) {
      if (gapToPoint(rect, point) < clearance) return false;
    }
    if (water.length > 0 && waterGap(water, point) < 0.5) return false;
    return true;
  };

  /** A free spawn point in one screen, >= the role's near distance and <= the far one. */
  const pointIn = (screen: { sx: number; sy: number }, role: SpawnRole): Vec2 | null => {
    const near = role === 'caster' ? CASTER_MIN_DISTANCE : SPAWN_MIN_DISTANCE;
    const far = role === 'caster' ? CASTER_MAX_DISTANCE : SPAWN_MAX_DISTANCE;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const point = {
        x: screen.sx * SCREEN_COLS + 1 + rng() * (SCREEN_COLS - 2),
        y: screen.sy * SCREEN_ROWS + 1 + rng() * (SCREEN_ROWS - 2),
      };
      const toStart = Math.hypot(point.x - playerStart.x, point.y - playerStart.y);
      if (toStart < near || toStart > far) continue;
      if (!free(point, 1.2)) continue;
      // A caster opens fire from its band, so it must see the player from where it stands (pits do not block shots).
      if (role === 'caster' && !lineClear(point, playerStart, losColliders)) continue;
      if (doors.some((door) => Math.hypot(point.x - door.x, point.y - door.y) < 2)) continue;
      if (placed.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < 2)) continue;
      return { x: Math.round(point.x * 2) / 2, y: Math.round(point.y * 2) / 2 };
    }
    return null;
  };

  waves.forEach((wave, waveIndex) => {
    for (const enemy of wave) {
      // Round-robin over the screens so every one of the 4 gets spawns (the acceptance test
      // wants the room's spawns spread over at least 4 screens).
      let chosen: Vec2 | null = null;
      for (let step = 0; step < order.length && chosen === null; step += 1) {
        const screen = order[(next + step) % order.length];
        if (screen === undefined) continue;
        chosen = pointIn(screen, enemy.role);
      }
      if (chosen === null) throw new Error(`ch${chapter} r${room}: no free spawn spot in the start screens`);
      next += 1;
      placed.push(chosen);
      spawns.push({ role: enemy.role, elite: enemy.elite, wave: waveIndex + 1, at: chosen });
    }
  });

  return spawns;
}

// ---------------------------------------------------------------------------
// Validation (the same core modules the game and the acceptance tests use)
// ---------------------------------------------------------------------------

function parsePlan(plan: RoomPlan): LevelData {
  return parseTmxLevel(roomTmx(plan), { source: `ch${plan.chapter}-r${plan.room}` });
}

/** Everything a generated room must satisfy before it may be written to disk. */
export function validatePlan(plan: RoomPlan): string[] {
  const problems: string[] = [];
  let level: LevelData;
  try {
    level = parsePlan(plan);
  } catch (error: unknown) {
    return [`parse: ${error instanceof Error ? error.message : String(error)}`];
  }

  if (level.size.cols !== COLS || level.size.rows !== ROWS) {
    problems.push(`size ${level.size.cols}×${level.size.rows}`);
  }
  if (level.doors.length < 2) problems.push(`${level.doors.length} doors`);

  // Player radius: the start must reach every door on the nav grid.
  const grid = buildNavGrid(level, 0.25, ROOM_EDGE_MARGIN_TILES);
  const startCol = Math.floor(level.playerStart.x);
  const startRow = Math.floor(level.playerStart.y);
  for (const door of level.doors) {
    const field = buildFlowField(grid, door.at);
    if (!Number.isFinite(field.distanceAt(startCol, startRow))) {
      problems.push(`door ${JSON.stringify(door.at)} unreachable`);
    }
  }

  // Enemy radius (the largest silhouette is a tank at 0.7): every spawn must reach the player.
  const enemyGrid = buildNavGrid(level, 0.75, ROOM_EDGE_MARGIN_TILES);
  const toPlayer = buildFlowField(enemyGrid, level.playerStart);
  for (const wave of level.waves) {
    for (const enemy of wave.enemies) {
      if (!Number.isFinite(toPlayer.distanceAt(Math.floor(enemy.at.x), Math.floor(enemy.at.y)))) {
        problems.push(`spawn ${enemy.role} at ${enemy.at.x},${enemy.at.y} boxed in`);
      }
    }
  }

  const screens = new Set<string>();
  for (const wave of level.waves) {
    for (const enemy of wave.enemies) {
      screens.add(`${Math.floor(enemy.at.x / SCREEN_COLS)},${Math.floor(enemy.at.y / SCREEN_ROWS)}`);
    }
  }
  if (screens.size < 4) problems.push(`spawns in ${screens.size} screens`);

  for (let sx = 0; sx < ROOM_SCREENS; sx += 1) {
    for (let sy = 0; sy < ROOM_SCREENS; sy += 1) {
      const count = level.obstacles.filter((obstacle) => {
        const centre = rectCentre(obstacle);
        return (
          centre.x >= sx * SCREEN_COLS &&
          centre.x < (sx + 1) * SCREEN_COLS &&
          centre.y >= sy * SCREEN_ROWS &&
          centre.y < (sy + 1) * SCREEN_ROWS
        );
      }).length;
      // A screen with no cover at all is a bare field; more than 16 blobs is a maze.
      if (count > 16) problems.push(`screen ${sx},${sy}: ${count} obstacles`);
    }
  }

  for (let index = 0; index < plan.ground.length; index += 1) {
    if ((plan.ground[index] ?? 0) !== 0 && (plan.path[index] ?? 0) !== 0) {
      problems.push(`ground/path overlap at ${index % COLS},${Math.floor(index / COLS)}`);
      break;
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Detail scatter
// ---------------------------------------------------------------------------

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Cells solid props/obstacles/spawns/doors/water occupy (stamps and path stones must avoid these). */
function solidReservedCells(plan: RoomPlan): Set<string> {
  const cells = new Set<string>();
  const reserve = (x: number, y: number, radius: number): void => {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const nx = Math.round(x) + dx;
        const ny = Math.round(y) + dy;
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) cells.add(cellKey(nx, ny));
      }
    }
  };

  for (const obstacle of plan.obstacles) {
    for (let y = Math.floor(obstacle.y) - 1; y <= Math.ceil(obstacle.y + obstacle.height); y += 1) {
      for (let x = Math.floor(obstacle.x) - 1; x <= Math.ceil(obstacle.x + obstacle.width); x += 1) {
        cells.add(cellKey(x, y));
      }
    }
  }
  for (const prop of plan.props) {
    const def = propDef(plan.chapter, prop.key);
    if (def === undefined) continue;
    for (let y = Math.floor(prop.y) - 1; y <= Math.ceil(prop.y + def.rect.height / TILE); y += 1) {
      for (let x = Math.floor(prop.x) - 1; x <= Math.ceil(prop.x + def.rect.width / TILE); x += 1) {
        cells.add(cellKey(x, y));
      }
    }
  }
  reserve(plan.playerStart.x, plan.playerStart.y, 1);
  for (const door of plan.doors) reserve(door.x, door.y, 1);
  for (const spawn of plan.spawns) reserve(spawn.at.x, spawn.at.y, 1);
  for (const area of plan.water) {
    for (let y = area.y - 1; y <= area.y + area.height; y += 1) {
      for (let x = area.x - 1; x <= area.x + area.width; x += 1) {
        if (x >= 0 && x < COLS && y >= 0 && y < ROWS) cells.add(cellKey(x, y));
      }
    }
  }
  return cells;
}

/**
 * The detail scatter: multi-tile ground stamps (ch3 flagstones, ch4 oasis puddles), cobble
 * stepping stones along the trail at `roomArt.pathStoneDensity`, and walkable floor decals at
 * `roomArt.detailDensity` with one guaranteed in every 16×9 area.
 */
function planDetails(
  chapter: number,
  rng: Rng,
  solidReserved: ReadonlySet<string>,
  pathCells: ReadonlySet<string>,
  stamps: readonly DecorStamp[],
  extraDecor: readonly { readonly index: number; readonly gid: number }[] = [],
): number[] {
  const data = new Array<number>(COLS * ROWS).fill(0);
  const used = new Set<string>();
  const tiles = DETAIL_TILES[chapter] ?? DETAIL_TILES[1] ?? [33];
  const pathTiles = PATH_STONE_TILES[chapter] ?? [10];

  for (const cell of extraDecor) {
    const x = cell.index % COLS;
    const y = Math.floor(cell.index / COLS);
    const key = cellKey(x, y);
    if (pathCells.has(key) || used.has(key) || inBorderBand(x, y)) continue;
    data[cell.index] = cell.gid;
    used.add(key);
  }

  const stampFree = (x: number, y: number): boolean => {
    if (x < BORDER_TILES || y < BORDER_TILES || x >= COLS - BORDER_TILES || y >= ROWS - BORDER_TILES) return false;
    const key = cellKey(x, y);
    return !solidReserved.has(key) && !used.has(key);
  };

  for (const stamp of stamps) {
    let fits = true;
    for (let dy = 0; dy < stamp.height && fits; dy += 1) {
      for (let dx = 0; dx < stamp.width; dx += 1) {
        if (!stampFree(stamp.x + dx, stamp.y + dy)) {
          fits = false;
          break;
        }
      }
    }
    if (!fits) continue;
    for (let dy = 0; dy < stamp.height; dy += 1) {
      for (let dx = 0; dx < stamp.width; dx += 1) {
        const local = stamp.locals[dy * stamp.width + dx];
        if (local === undefined) continue;
        const cx = stamp.x + dx;
        const cy = stamp.y + dy;
        data[cy * COLS + cx] = gid(chapter, stamp.set, local);
        used.add(cellKey(cx, cy));
      }
    }
    // Keep a 1-tile buffer around multi-tile stamps so two stamps never touch edges.
    for (let dy = -1; dy <= stamp.height; dy += 1) {
      for (let dx = -1; dx <= stamp.width; dx += 1) {
        used.add(cellKey(stamp.x + dx, stamp.y + dy));
      }
    }
  }

  // Stepping-stone / cobble accents along the trail (walk-over `floordetail` pebbles).
  const pathStoneDensity = TUNING.roomArt.pathStoneDensity;
  for (const key of pathCells) {
    if (used.has(key) || solidReserved.has(key)) continue;
    const parts = key.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (inBorderBand(x, y)) continue;
    if (rng() < pathStoneDensity) {
      data[y * COLS + x] = gid(chapter, 'floordetail', pick(rng, pathTiles));
      used.add(key);
    }
  }

  const free = (x: number, y: number): boolean => {
    const key = cellKey(x, y);
    return !solidReserved.has(key) && !pathCells.has(key) && !used.has(key) && !inBorderBand(x, y);
  };
  const set = (x: number, y: number): boolean => {
    if (!free(x, y)) return false;
    data[y * COLS + x] = gid(chapter, 'floordetail', pick(rng, tiles));
    used.add(cellKey(x, y));
    return true;
  };

  // One guaranteed detail per 16×9 area: the acceptance test calls an empty area bare.
  for (let by = 0; by < ROWS / 9; by += 1) {
    for (let bx = 0; bx < COLS / 16; bx += 1) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const x = bx * 16 + int(rng, 16);
        const y = by * 9 + int(rng, 9);
        if (set(x, y)) break;
      }
    }
  }

  const density = TUNING.roomArt.detailDensity;
  const target = Math.round(density * COLS * ROWS);
  let scattered = 0;
  for (let attempt = 0; attempt < target * 24 && scattered < target; attempt += 1) {
    if (set(int(rng, COLS), int(rng, ROWS))) scattered += 1;
  }

  return data;
}

// ---------------------------------------------------------------------------
// TMX serialisation
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function property(name: string, value: string, type?: 'int' | 'bool'): string {
  return `    <property name="${escapeXml(name)}"${type === undefined ? '' : ` type="${type}"`} value="${escapeXml(value)}"/>`;
}

function csv(data: readonly number[], width: number, height: number): string {
  const rows: string[] = [];
  for (let y = 0; y < height; y += 1) rows.push(data.slice(y * width, (y + 1) * width).join(','));
  return rows.join(',\n');
}

function layerXml(id: number, name: string, data: readonly number[]): string {
  return [
    ` <layer id="${id}" name="${name}" width="${COLS}" height="${ROWS}">`,
    '  <data encoding="csv">',
    csv(data, COLS, ROWS),
    '  </data>',
    ' </layer>',
  ].join('\n');
}

/** `plan` → the exact `.tmx` the game loads (the parser is the test, see `validatePlan`). */
export function roomTmx(plan: RoomPlan): string {
  const chapter = plan.chapter;
  const objects: string[] = [];
  let id = 1;

  objects.push(`  <object id="${id++}" name="playerStart" x="${plan.playerStart.x * TILE}" y="${plan.playerStart.y * TILE}"><point/></object>`);

  for (const spawn of plan.spawns) {
    objects.push(
      `  <object id="${id++}" name="spawn" x="${spawn.at.x * TILE}" y="${spawn.at.y * TILE}">\n` +
        `   <properties>\n` +
        `${property('role', spawn.role)}\n` +
        `${property('wave', String(spawn.wave), 'int')}\n` +
        `${property('elite', spawn.elite ? 'true' : 'false', 'bool')}\n` +
        `   </properties>\n` +
        `  <point/></object>`,
    );
  }

  for (const door of plan.doors) {
    objects.push(`  <object id="${id++}" name="door" x="${door.x * TILE}" y="${door.y * TILE}"><point/></object>`);
  }

  for (const obstacle of plan.obstacles) {
    objects.push(
      `  <object id="${id++}" name="obstacle" x="${obstacle.x * TILE}" y="${obstacle.y * TILE}" ` +
        `width="${obstacle.width * TILE}" height="${obstacle.height * TILE}">\n` +
        `   <properties>\n${property('kind', obstacle.kind)}\n   </properties>\n` +
        `  </object>`,
    );
  }

  for (const prop of plan.props) {
    const def = propDef(chapter, prop.key);
    if (def === undefined) throw new Error(`chapter ${chapter} has no prop ${prop.key}`);
    objects.push(
      `  <object id="${id++}" name="prop" x="${prop.x * TILE}" y="${prop.y * TILE}" ` +
        `width="${def.rect.width}" height="${def.rect.height}">\n` +
        `   <properties>\n${property('key', prop.key)}\n   </properties>\n` +
        `  </object>`,
    );
  }

  const properties = [
    property('chapter', String(chapter), 'int'),
    property('room', String(plan.room), 'int'),
    property('isBossRoom', 'false', 'bool'),
  ].join('\n');

  const riverLayers = plan.riverLayers ?? [];
  const decorLayerId = 4 + riverLayers.length;
  const firstBorderLayerId = decorLayerId + 1;
  const objectLayerId = firstBorderLayerId + plan.borders.length;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<map version="1.10" tiledversion="1.11.0" orientation="orthogonal" renderorder="right-down" ` +
      `width="${COLS}" height="${ROWS}" tilewidth="${TILE}" tileheight="${TILE}" infinite="0" ` +
      `nextlayerid="${objectLayerId + 1}" nextobjectid="${id}">`,
    ' <properties>',
    properties,
    ' </properties>',
    tilesetXml(chapter),
    layerXml(1, 'floor', plan.floor),
    layerXml(2, 'ground', plan.ground),
    layerXml(3, 'path', plan.path),
    ...riverLayers.map((layer, index) => layerXml(4 + index, layer.name, layer.tiles)),
    layerXml(decorLayerId, 'decor', plan.decor),
    ...plan.borders.map((border, index) => layerXml(firstBorderLayerId + index, border.name, border.tiles)),
    ` <objectgroup id="${objectLayerId}" name="objects">`,
    ...objects,
    ' </objectgroup>',
    '</map>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Plan normal room `room` (1..`NORMAL_ROOMS`) of `chapter`. Retries with the next sub-seed when
 * validation fails, so the caller always gets a room that passes `validatePlan`.
 */
export function generateRoom(chapter: number, room: number, saltOverride?: number): RoomPlan {
  const theme = PROP_THEMES[chapter];
  if (theme === undefined) throw new Error(`chapter ${chapter} has no prop theme`);
  const baseFloor = floorGid(chapter);
  const salt = saltOverride ?? CHAPTER_SEED_SALT[chapter] ?? 27;

  const failures: string[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const rng = mulberry32((chapter * 1_000_003 + room * 7919 + attempt * 104_729) ^ (salt * 2_654_435_761) >>> 0);
      const playerStart = planPlayerStart(room, rng);
      const doors: Vec2[] = [
        { x: playerStart.x, y: ROWS - 0.5 },
        { x: 4 + int(rng, COLS - 8) + 0.5, y: 0.5 },
      ];
      const ch2River =
        chapter === 2
          ? planChapterTwoRiver({
              rng,
              cols: COLS,
              rows: ROWS,
              borderTiles: BORDER_TILES,
              playerStart,
              doors,
              gid: (set, local) => gid(chapter, set, local),
            })
          : null;
      const water = ch2River !== null ? ch2River.waterAreas : [];
      const riverPitObstacles: AuthoredObstacle[] =
        ch2River === null
          ? []
          : ch2River.pitObstacles.map((rect) => ({ kind: 'pit', ...rect }));

      const border = planBorder(chapter, rng, doors);
      const path = planPath(chapter, rng, doors, playerStart, water, room % 2 === 0, ch2River);
      const patches = planPatches(rng, water, path.cells, ch2River?.reservedCells);

      const blocked = new Set<string>([
        ...border.blocked,
        ...path.blocked,
        ...(ch2River?.reservedCells ?? []),
      ]);
      const { obstacles, props, village, ruins, oasis, plateauSurface, plateauFace, decorStamps } = planGeometry({
        chapter,
        room,
        rng,
        playerStart,
        doors,
        water,
        blocked,
        street: path.street,
        borderRects: border.rects,
        ...(ch2River !== null ? { riverPits: ch2River.pitObstacles } : {}),
      });

      const propColliders: Rect[] = props.flatMap((prop) => {
        const def = propDef(chapter, prop.key);
        const collider = def === undefined ? null : propCollider(prop, def);
        return collider === null ? [] : [collider];
      });
      const colliders: Rect[] = [
        ...border.rects,
        ...riverPitObstacles,
        ...obstacles,
        ...propColliders,
      ];
      const losColliders: Rect[] = [
        ...border.rects,
        ...obstacles.filter((obstacle) => obstacle.kind !== 'pit'),
        ...propColliders,
      ];
      const spawns = planSpawns(chapter, room, rng, playerStart, doors, colliders, water, losColliders);

      // The front border layer also carries the desert plateau's cliff face.
      const borders = border.layers.map((layer, index) => {
        if (index !== border.layers.length - 1 || plateauFace.length === 0) return layer;
        const tiles = layer.tiles.slice();
        for (const cell of plateauFace) tiles[cell.index] = cell.value;
        return { name: layer.name, tiles };
      });

      const floorTiles =
        chapter === 2
          ? new Array<number>(COLS * ROWS).fill(baseFloor)
          : paintTexturedFloor(chapter, rng, baseFloor, gid);

      const partial: RoomPlan = {
        chapter,
        room,
        playerStart,
        doors,
        obstacles: [...border.obstacles, ...riverPitObstacles, ...obstacles],
        props,
        water,
        floor: floorTiles,
        ground: paintGround(chapter, new Set([...patches.cells, ...plateauSurface])),
        path: path.tiles,
        ...(ch2River !== null ? { riverLayers: ch2River.layers } : {}),
        borders,
        decor: [],
        spawns,
      };

      const decorReserved = solidReservedCells(partial);
      if (ch2River !== null) {
        for (const cell of ch2River.waterCells) decorReserved.add(cell);
        for (const bridge of ch2River.bridges) {
          for (let y = bridge.y; y < bridge.y + bridge.height; y += 1) {
            for (let x = bridge.x; x < bridge.x + bridge.width; x += 1) {
              decorReserved.add(cellKey(x, y));
            }
          }
        }
      }
      const decor =
        chapter === 2
          ? planDetails(
              chapter,
              mulberry32((chapter * 31 + room * 17 + attempt) >>> 0),
              decorReserved,
              path.cells,
              decorStamps,
              ch2River?.bankDecor ?? [],
            )
          : planClusteredDetails(
              chapter,
              mulberry32((chapter * 31 + room * 17 + attempt) >>> 0),
              decorReserved,
              path.cells,
              decorStamps,
              TUNING.roomArt.detailDensity,
              gid,
            );
      const plan: RoomPlan = { ...partial, decor };

      // An even room of a village chapter is a village room (R5): a room that could not fit its
      // village retries with another seed instead of silently falling back to scatter. Chapter 2
      // is the water/forest chapter — a riverside hamlet is welcome there, not required.
      if (chapter !== 2 && room % 2 === 0 && !village) {
        failures.push(`attempt ${attempt}: no village`);
        continue;
      }
      if (chapter === 3 && room % 2 === 1 && !ruins) {
        failures.push(`attempt ${attempt}: no ruins set piece`);
        continue;
      }
      if (chapter === 4 && room % 2 === 1 && !oasis) {
        failures.push(`attempt ${attempt}: no oasis pond`);
        continue;
      }

      const problems = validatePlan(plan);
      if (problems.length === 0) return plan;
      failures.push(`attempt ${attempt}: ${problems.slice(0, 4).join('; ')}`);
    } catch (error: unknown) {
      failures.push(`attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`ch${chapter} r${room}: no valid layout after 40 attempts\n${failures.slice(0, 5).join('\n')}`);
}

/** All normal rooms of a chapter, in room order. */
export function generateChapterRooms(chapter: number): RoomPlan[] {
  const rooms: RoomPlan[] = [];
  for (let room = 1; room <= NORMAL_ROOMS; room += 1) rooms.push(generateRoom(chapter, room));
  return rooms;
}

/** Water areas of the generated rooms, keyed as `water-layout.json` expects. */
export function waterLayoutFor(plans: readonly RoomPlan[], bossRoom: number, bossWater: readonly WaterArea[]): Record<string, readonly WaterArea[]> {
  const byRoom: Record<string, readonly WaterArea[]> = {};
  for (const plan of plans) {
    if (plan.water.length > 0) byRoom[String(plan.room)] = plan.water;
  }
  if (bossWater.length > 0) byRoom[String(bossRoom)] = bossWater;
  return byRoom;
}
