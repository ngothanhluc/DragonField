/**
 * Generated 128×72 room pool (M9, ticket #38, ADR-018).
 *
 * Every chapter now holds a **pool** of 16 generated normal rooms instead of 8 hand-dressed
 * 32×18 ones; a run plays 8 of them drawn by its seed (`core/run/room-draw.ts`) plus the boss.
 * This module owns the generator: it plans one room (floor, decor, obstacles, props, water,
 * player start, 2 doors, spawns) with a seeded RNG, **validates** it with the same core modules
 * the game and the acceptance tests use, and serialises it to `.tmx`.
 *
 * Room anatomy (a normal room is 4×4 screens of 32×18 tiles):
 * - **Floor**: one uniform grass/sand gid, as before (`FLOOR_GID`).
 * - **Decor** (walkable tiles): grass/flower clusters (ch1/ch2) or whole VillageAbandoned blocks
 *   plus flat singles (ch3); chapter 4 keeps a plain sand floor. Never on an obstacle, spawn, door
 *   or the player start.
 * - **Obstacles/props**: 1–3 solid props per screen from the #35 catalogue, plus an authored
 *   pillar/pit/wall in about half of the screens. Blobs are never closer than `MIN_OBSTACLE_GAP`
 *   tiles edge to edge, so the room always stays a field of cover to dodge behind, never a maze.
 * - **Spawns**: the chapter's per-room spawn plan (today's counts and roles, see
 *   `SPAWN_TEMPLATES`), spread over the 4 screens around the player start, 7–26 tiles away.
 * - **Doors**: 2 spots on the room edge (entrance at the bottom, exit at the top), data only
 *   until #39 gives the door choice a screen.
 *
 * Determinism: `(chapter, room, attempt)` seeds one room; a room that fails validation retries
 * with the next attempt, so re-running the script rewrites byte-identical files.
 */
import { ROOM_EDGE_MARGIN_TILES } from '../../assets/scripts/core/enemies/behaviours';
import { buildFlowField, buildNavGrid } from '../../assets/scripts/core/enemies/navigation';
import type {
  EnemyRole,
  ObstacleKind,
  PlacedProp,
  LevelData,
} from '../../assets/scripts/core/level/level-data';
import { WALK_OVER_KEYS, propCollider, propDef } from '../../assets/scripts/core/level/props';
import { parseTmxLevel } from '../../assets/scripts/core/level/tmx';
import type { WaterArea } from '../../assets/scripts/core/level/water-layout';

/** One screen: the camera view, and the tile of every generated room is a grid of these. */
export const SCREEN_COLS = 32;
export const SCREEN_ROWS = 18;
/** Normal rooms are 4×4 screens (ADR-018): 128×72 tiles. */
export const ROOM_SCREENS = 4;
export const COLS = SCREEN_COLS * ROOM_SCREENS;
export const ROWS = SCREEN_ROWS * ROOM_SCREENS;
/** Normal rooms in a chapter's pool (the ticket asks for 15–18). */
export const NORMAL_ROOMS = 16;
/** The boss room is the last room, so `chapterFromLevels` still sees 1..N contiguous. */
export const BOSS_ROOM = NORMAL_ROOMS + 1;

const TILE = 16;

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
} as const satisfies Record<string, TilesetDef>;

/** Tilesets of a chapter, in `firstgid` order (the same sets the hand-dressed rooms used). */
const CHAPTER_SETS: Readonly<Record<number, readonly TilesetDef[]>> = {
  1: [TS.field, TS.nature, TS.relief, TS.element],
  2: [TS.field, TS.water, TS.nature],
  3: [TS.ground, TS.village, TS.house, TS.towers, TS.hole],
  // Chapter 4 — desert (#45): the desert village tileset (floor + houses + palms) and camp props.
  4: [TS.desert, TS.camp],
};

/** Uniform background per chapter: moss green (field) / village sand (desert). */
const FLOOR_GID: Readonly<Record<number, number>> = { 1: 37, 2: 37, 3: 176, 4: 176 };

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
  /** Everyday solids: trees, rocks, stumps, crates. */
  readonly solids: readonly string[];
  readonly walkOvers: readonly string[];
}

const PROP_THEMES: Readonly<Record<number, PropTheme>> = {
  1: {
    landmarks: ['house-orange', 'house-beige', 'house-green', 'hut', 'tent'],
    solids: [
      'tree-green', 'tree-pine', 'tree-dead', 'tree-pink', 'tree-round', 'tree-small',
      'tree-cluster-green', 'tree-cluster-pines', 'rock-boulder', 'rock-small', 'stump-big',
      'stump', 'bush-blue', 'crate', 'totem', 'logs',
    ],
    walkOvers: WALK_OVER_KEYS,
  },
  2: {
    landmarks: ['house-red', 'house-beige', 'house-orange', 'house-green'],
    solids: [
      'tree-green', 'tree-pine', 'tree-round', 'tree-big-orange', 'tree-cluster-pines',
      'rock-boulder-gray', 'rock-small-gray', 'stump', 'bush-blue', 'crate', 'totem',
    ],
    walkOvers: [...WALK_OVER_KEYS, 'fishnet'],
  },
  3: {
    landmarks: ['house-ruined', 'house-mossy', 'house-timber', 'house-timber-large', 'house-orange', 'house-red', 'frog-statue'],
    solids: [
      'tree-mossy', 'tree-mossy-alt', 'tree-cluster-green', 'tree-dead', 'tree-green', 'tree-pine',
      'rock-boulder', 'stump-big', 'bush-blue', 'totem', 'crate', 'frog-statue',
    ],
    walkOvers: WALK_OVER_KEYS,
  },
  // Chapter 4 — desert: camp tents / adobe houses as landmarks, palms, bones and camp furniture.
  4: {
    landmarks: ['camp-tent', 'camp-tent-open', 'desert-house', 'desert-tower'],
    solids: [
      'palm-cluster', 'palm-cluster-dusty', 'desert-skull', 'camp-well', 'camp-table', 'camp-bench',
      'camp-signpost', 'camp-barrel', 'logs', 'rock-boulder-gray', 'tree-dead', 'stump-big',
    ],
    walkOvers: [...WALK_OVER_KEYS, 'desert-fish-bones', 'desert-shell', 'desert-potted-palm'],
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
 *
 * Chapter 4 is the ×8 scale (GDD §13.2: 64–72 per room): 64 in 8 waves of 8, so at most 8 are
 * alive at once (the cap is 24) and a headless god-mode run of all 8 rooms still finishes well
 * inside the acceptance timeout. Each template cycles a different roster (every role, sniper and
 * splitter included); elites start in the fourth room, as in chapter 3.
 */
function chapterFourTemplate(
  roster: readonly SpawnRole[],
  eliteWaves = 0,
): readonly (readonly SpawnEntry[])[] {
  return Array.from({ length: 8 }, (_unused, wave) =>
    Array.from({ length: 8 }, (_entry, index): SpawnEntry => ({
      role: roster[(wave + index) % roster.length] as SpawnRole,
      elite: eliteWaves > 0 && wave >= 8 - eliteWaves && index === 0,
    })),
  );
}

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
    chapterFourTemplate(['chaser', 'chaser', 'caster', 'splitter', 'chaser', 'tank', 'chaser', 'sniper']),
    chapterFourTemplate(['chaser', 'caster', 'chaser', 'tank', 'splitter', 'chaser', 'sniper', 'chaser']),
    chapterFourTemplate(['tank', 'chaser', 'caster', 'chaser', 'splitter', 'chaser', 'sniper', 'caster']),
    chapterFourTemplate(['chaser', 'caster', 'splitter', 'chaser', 'tank', 'sniper', 'chaser', 'chaser'], 1),
    chapterFourTemplate(['caster', 'chaser', 'tank', 'splitter', 'chaser', 'sniper', 'caster', 'chaser'], 2),
    chapterFourTemplate(['chaser', 'tank', 'chaser', 'caster', 'sniper', 'chaser', 'splitter', 'chaser'], 3),
    chapterFourTemplate(['splitter', 'chaser', 'caster', 'tank', 'chaser', 'sniper', 'chaser', 'caster'], 4),
    chapterFourTemplate(['chaser', 'caster', 'tank', 'chaser', 'sniper', 'splitter', 'caster', 'chaser'], 5),
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
  /** Floor/decor gid grids, row-major, `COLS × ROWS`. */
  readonly floor: readonly number[];
  readonly decor: readonly number[];
  readonly spawns: readonly PlannedSpawn[];
}

/** Obstacle blobs stay this far apart (tiles, edge to edge): cover, never a maze. */
const MIN_OBSTACLE_GAP = 5;
/** Obstacles keep this far from the player start, the doors and the spawns. */
const POINT_CLEARANCE = 3;
/** A spawn sits this far from the player start (tiles). */
const SPAWN_MIN_DISTANCE = 7;
const SPAWN_MAX_DISTANCE = 9.5;
/**
 * Casters stand at the back of the pack: the player's auto-aim locks the **nearest** target, and
 * a stagger resets an enemy's attack cooldown, so a caster that spawns closest is held under fire
 * and never gets its (900 ms + 500 ms telegraph) shot off — the balance sim pins "every caster
 * fires before dying". Spawning it behind the melee line (just outside the 6-tile hold band, at
 * the edge of the 8-tile auto-aim range) gives it the walk-in time to fire first, then die.
 * The clear line is required so it really is in the fight, not several screens away.
 */
const CASTER_MIN_DISTANCE = 10;
const CASTER_MAX_DISTANCE = 12;

/**
 * Where the player starts: near the middle of the room, so a fight has room to dodge in every
 * direction. Room 1 is the room the title / chapter-select backdrop draws (`MENU_BACKDROP_ROOM`),
 * and the menu camera always shows the room's bottom-left screen; its start sits there, right of
 * the menu column, so the idle ninja is on screen and not behind the panel.
 */
const START_AREA = { minX: 60, maxX: 68, minY: 32, maxY: 40 } as const;
const MENU_ROOM_START = { x: 28, y: 60 } as const;

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

/**
 * Chapter 2's river: a shallow 2-tile band across the room, kept below the player's start row so
 * the entrance is on dry land, plus a waterfall running down to it in some rooms.
 */
function planRiver(rng: Rng): WaterArea[] {
  const width = 40 + int(rng, 26);
  const x = 2 + int(rng, COLS - width - 4);
  const y = 14 + int(rng, 34);
  const water: WaterArea[] = [{ kind: 'river', x, y, width, height: 2 }];
  if (rng() < 0.6) {
    const fallX = x + 2 + int(rng, Math.max(1, width - 6));
    water.push({ kind: 'waterfall', x: fallX, y: 0, width: 2, height: y });
  }
  return water;
}

/** A player start inside the bottom-left screen; room 1 sits clear of the menu panel. */
function planPlayerStart(room: number, rng: Rng): Vec2 {
  if (room === 1) return { ...MENU_ROOM_START };
  const x = START_AREA.minX + int(rng, START_AREA.maxX - START_AREA.minX + 1);
  const y = START_AREA.minY + int(rng, START_AREA.maxY - START_AREA.minY + 1);
  return { x, y };
}

interface ColliderBook {
  readonly rects: Rect[];
}

function colliderFits(
  book: ColliderBook,
  rect: Rect,
  playerStart: Vec2,
  doors: readonly Vec2[],
  water: readonly WaterArea[],
): boolean {
  if (!rectInsideRoom(rect)) return false;
  const centre = rectCentre(rect);
  // Keep every blob at least 2 tiles inside its screen: the acceptance test counts a blob by its
  // centre, and a 2-tile gutter between screens keeps the room connected.
  const { sx, sy } = screenOf(centre);
  const core: Rect = {
    x: sx * SCREEN_COLS + 2,
    y: sy * SCREEN_ROWS + 2,
    width: SCREEN_COLS - 4,
    height: SCREEN_ROWS - 4,
  };
  if (
    centre.x < core.x ||
    centre.x >= core.x + core.width ||
    centre.y < core.y ||
    centre.y >= core.y + core.height
  ) {
    return false;
  }
  if (gapToPoint(rect, playerStart) < POINT_CLEARANCE) return false;
  for (const door of doors) {
    if (gapToPoint(rect, door) < POINT_CLEARANCE) return false;
  }
  if (water.length > 0) {
    // A river prop (the boat) is the only thing allowed on the water; solids keep off it.
    for (const area of water) {
      const overlap =
        rect.x < area.x + area.width &&
        rect.x + rect.width > area.x &&
        rect.y < area.y + area.height &&
        rect.y + rect.height > area.y;
      if (overlap) return false;
    }
  }
  for (const other of book.rects) {
    if (gapBetween(rect, other) < MIN_OBSTACLE_GAP) return false;
  }
  return true;
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
  2: [
    { kind: 'pillar', width: 2, height: 2 },
    { kind: 'pillar', width: 1, height: 1 },
    { kind: 'pit', width: 2, height: 2 },
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
  // Chapter 4 — desert: boulders and broken walls on sand, holes are 2×2 like ch1/ch2.
  4: [
    { kind: 'pillar', width: 2, height: 2 },
    { kind: 'pillar', width: 1, height: 1 },
    { kind: 'pit', width: 2, height: 2 },
    { kind: 'wall', width: 3, height: 1 },
    { kind: 'wall', width: 1, height: 3 },
  ],
};

interface GeometryResult {
  readonly obstacles: AuthoredObstacle[];
  readonly props: PlacedProp[];
}

/**
 * Obstacles + props per screen: 1–3 solid prop drawings, plus an authored pillar/pit/wall in
 * about half of the screens, every blob ≥ `MIN_OBSTACLE_GAP` tiles from the next. The landmark
 * prop (a house/tent) goes in the entrance screen when the room rolls one.
 */
function planGeometry(
  chapter: number,
  room: number,
  rng: Rng,
  playerStart: Vec2,
  doors: readonly Vec2[],
  water: readonly WaterArea[],
): GeometryResult {
  const theme = PROP_THEMES[chapter];
  if (theme === undefined) throw new Error(`chapter ${chapter} has no prop theme`);
  const book: ColliderBook = { rects: [] };
  const obstacles: AuthoredObstacle[] = [];
  const props: PlacedProp[] = [];

  const placeAuthored = (sx: number, sy: number): void => {
    const shapes = AUTHORED_SHAPES[chapter];
    if (shapes === undefined) return;
    for (const shape of shuffle(rng, shapes)) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const rect = randomColliderInScreen(rng, sx, sy, shape.width, shape.height);
        if (rect === null) break;
        const candidate: AuthoredObstacle = { kind: shape.kind, ...rect };
        if (!colliderFits(book, candidate, playerStart, doors, water)) continue;
        book.rects.push(rect);
        obstacles.push(candidate);
        return;
      }
    }
  };

  const placeProp = (sx: number, sy: number, key: string): boolean => {
    const def = propDef(chapter, key);
    if (def === undefined) return false;
    const collider = def.collider;
    if (collider === null) return false;
    const width = Math.ceil(collider.width / TILE);
    const height = Math.ceil(collider.height / TILE);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const target = randomColliderInScreen(rng, sx, sy, width, height);
      if (target === null) return false;
      if (!colliderFits(book, target, playerStart, doors, water)) continue;
      const anchor = anchorForCollider(def, target);
      if (anchor === null) continue;
      // The whole drawing must stay in the room; only the collider is constrained per screen.
      if (
        anchor.x < 1 ||
        anchor.y < 1 ||
        anchor.x + Math.ceil(def.rect.width / TILE) > COLS - 1 ||
        anchor.y + Math.ceil(def.rect.height / TILE) > ROWS - 1
      ) {
        continue;
      }
      book.rects.push(target);
      props.push(anchor);
      return true;
    }
    return false;
  };

  const placeWalkOver = (sx: number, sy: number, key: string): void => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const point = {
        x: sx * SCREEN_COLS + 1 + int(rng, SCREEN_COLS - 2),
        y: sy * SCREEN_ROWS + 1 + int(rng, SCREEN_ROWS - 2),
      };
      if (gapToPoint({ x: point.x - 0.5, y: point.y - 0.5, width: 1, height: 1 }, playerStart) < 2) continue;
      if (doors.some((door) => gapToPoint({ x: point.x - 0.5, y: point.y - 0.5, width: 1, height: 1 }, door) < 2)) continue;
      if (water.length > 0 && waterGap(water, point) < 1.5) continue;
      props.push({ key, x: point.x, y: point.y });
      return;
    }
  };

  // A landmark only in the first screen (the entrance): the room gets one focus, not a village.
  if (room % 3 === 1) {
    for (const key of shuffle(rng, theme.landmarks)) {
      if (placeProp(0, ROOM_SCREENS - 1, key)) break;
    }
  }

  const solids = shuffle(rng, theme.solids);
  for (let sy = 0; sy < ROOM_SCREENS; sy += 1) {
    for (let sx = 0; sx < ROOM_SCREENS; sx += 1) {
      // Keep the screen holding the player start open: it needs a way out in every direction.
      const startScreen = screenOf(playerStart);
      const isStart = sx === startScreen.sx && sy === startScreen.sy;
      const targeted = isStart ? 1 : 2 + int(rng, 2);

      if (!isStart && rng() < 0.45) placeAuthored(sx, sy);

      let placed = 0;
      for (const key of shuffle(rng, solids)) {
        if (placed >= targeted) break;
        if (placeProp(sx, sy, key)) placed += 1;
      }
      // Every screen needs at least one obstacle (the acceptance test counts them per screen).
      if (placed === 0) placeAuthored(sx, sy);

      const walkTarget = 3 + int(rng, 2);
      for (let index = 0; index < walkTarget; index += 1) {
        placeWalkOver(sx, sy, pick(rng, theme.walkOvers));
      }
    }
  }

  return { obstacles, props };
}

/** Spawn points over the 4 screens around the player: 7–26 tiles away, clear of every blob. */
function planSpawns(
  chapter: number,
  room: number,
  rng: Rng,
  playerStart: Vec2,
  doors: readonly Vec2[],
  colliders: readonly Rect[],
  water: readonly WaterArea[],
): PlannedSpawn[] {
  const template = SPAWN_TEMPLATES[chapter];
  if (template === undefined) throw new Error(`chapter ${chapter} has no spawn template`);
  const waves = template[(room - 1) % template.length];
  if (waves === undefined) throw new Error(`chapter ${chapter} has no spawn template for room ${room}`);

  const startScreen = screenOf(playerStart);
  // Chapter 4 spawns 64 enemies per room: they do not fit the 7–9.5 tile annulus an 8-enemy room
  // uses, so they spread over all 16 screens. Everyone stays at least `SPAWN_MIN_DISTANCE` (7)
  // from the player — GDD fairness asks for ≥ 6 — and may stand anywhere farther; a caster with
  // no line of sight repositions (GDD §4), so no LOS requirement is placed on a wide room.
  const spreadRoom = chapter === 4;
  const allScreens: { sx: number; sy: number }[] = [];
  for (let sy = 0; sy < ROOM_SCREENS; sy += 1) {
    for (let sx = 0; sx < ROOM_SCREENS; sx += 1) allScreens.push({ sx, sy });
  }
  // The 2×2 block of screens around the start, preferring the side with room in the room.
  const baseSx = Math.min(ROOM_SCREENS - 2, Math.max(0, startScreen.sx - 1));
  const baseSy = Math.min(ROOM_SCREENS - 2, Math.max(0, startScreen.sy - 1));
  const screens = (spreadRoom
    ? allScreens
    : [
        { sx: startScreen.sx, sy: startScreen.sy },
        { sx: baseSx, sy: baseSy },
        { sx: baseSx + 1, sy: baseSy },
        { sx: baseSx, sy: baseSy + 1 },
        { sx: baseSx + 1, sy: baseSy + 1 },
      ]
  ).filter(
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
    const near = spreadRoom
      ? SPAWN_MIN_DISTANCE
      : role === 'caster'
        ? CASTER_MIN_DISTANCE
        : SPAWN_MIN_DISTANCE;
    const far = spreadRoom
      ? Number.POSITIVE_INFINITY
      : role === 'caster'
        ? CASTER_MAX_DISTANCE
        : SPAWN_MAX_DISTANCE;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const point = {
        x: screen.sx * SCREEN_COLS + 1 + rng() * (SCREEN_COLS - 2),
        y: screen.sy * SCREEN_ROWS + 1 + rng() * (SCREEN_ROWS - 2),
      };
      const toStart = Math.hypot(point.x - playerStart.x, point.y - playerStart.y);
      if (toStart < near || toStart > far) continue;
      if (!free(point, 1.2)) continue;
      // A caster opens fire from its band, so it must see the player from where it stands.
      if (!spreadRoom && role === 'caster' && !lineClear(point, playerStart, colliders)) continue;
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
      if (count < 1 || count > 16) problems.push(`screen ${sx},${sy}: ${count} obstacles`);
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Decor
// ---------------------------------------------------------------------------

/** Whole VillageAbandoned props (flat patches: every tile of a block is walkable). */
const VILLAGE_BLOCKS: readonly (readonly (readonly number[])[])[] = [
  [[108, 109], [128, 129]],
  [[67], [87]],
  [[69, 70], [0, 90]],
];

const VILLAGE_FLAT_SINGLES: readonly number[] = [68, 88, 89, 91, 105, 106, 165, 166, 225, 226];
const DESERT_FLAT_SINGLES: readonly number[] = [189, 190, 237, 238, 239, 240];
const BORDER_VILLAGE_PROPS: readonly number[] = [148, 149, 227, 230, 231, 232, 233, 234, 235];
const BORDER_DESERT_PROPS: readonly number[] = [215, 235, 227, 228];

const GRASS_TILES: readonly number[] = [241, 242, 243, 244, 245, 246, 247, 248, 253, 254];
const FLOWER_TILES: readonly number[] = [265, 266, 267, 268, 269, 270, 271, 272, 277, 278, 301, 302, 337, 338];
const PEBBLE_TILES: readonly number[] = [321, 322, 323, 324, 329, 330, 331, 332];

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** Cells decor must stay off: obstacles, spawns, doors, the start and the water. */
function reservedCells(plan: RoomPlan): Set<string> {
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

/** Ground decor: grass/flower clusters (ch1/ch2) or whole village blocks + flat singles (ch3). */
function planDecor(
  chapter: number,
  rng: Rng,
  reserved: ReadonlySet<string>,
): number[] {
  const data = new Array<number>(COLS * ROWS).fill(0);
  const used = new Set<string>();

  const set = (x: number, y: number, value: number): void => {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    if (reserved.has(cellKey(x, y)) || used.has(cellKey(x, y))) return;
    data[y * COLS + x] = value;
    used.add(cellKey(x, y));
  };

  if (chapter === 1 || chapter === 2) {
    for (let sy = 0; sy < ROOM_SCREENS; sy += 1) {
      for (let sx = 0; sx < ROOM_SCREENS; sx += 1) {
        for (let cluster = 0; cluster < 7; cluster += 1) {
          const x = sx * SCREEN_COLS + 1 + int(rng, SCREEN_COLS - 2);
          const y = sy * SCREEN_ROWS + 1 + int(rng, SCREEN_ROWS - 2);
          const size = 1 + int(rng, 3);
          for (let step = 0; step < size; step += 1) {
            const tx = x + int(rng, 3) - 1;
            const ty = y + int(rng, 3) - 1;
            const roll = rng();
            const list = roll < 0.6 ? GRASS_TILES : roll < 0.88 ? FLOWER_TILES : PEBBLE_TILES;
            set(tx, ty, gid(chapter, 'nature', pick(rng, list)));
          }
        }
      }
    }
    return data;
  }

  // Chapter 4 has no floor decor: `TilesetDesert` is a village object sheet (its sand tiles are
  // outlined corner pieces of the wall/plaza blocks, not walkable detail), so the sand stays plain.
  if (chapter === 4) return data;

  // Chapter 3: one whole block per screen (never a torn piece), flat singles, a sunken border.
  for (let sy = 0; sy < ROOM_SCREENS; sy += 1) {
    for (let sx = 0; sx < ROOM_SCREENS; sx += 1) {
      const block = pick(rng, VILLAGE_BLOCKS);
      const width = Math.max(...block.map((row) => row.length));
      const height = block.length;
      let stamped = false;
      for (let attempt = 0; attempt < 12 && !stamped; attempt += 1) {
        const x = sx * SCREEN_COLS + 1 + int(rng, SCREEN_COLS - width - 2);
        const y = sy * SCREEN_ROWS + 1 + int(rng, SCREEN_ROWS - height - 2);
        const fits = block.every((row, dy) =>
          row.every((local, dx) => {
            if (local === 0) return true;
            const cell = cellKey(x + dx, y + dy);
            return !reserved.has(cell) && !used.has(cell);
          }),
        );
        if (!fits) continue;
        block.forEach((row, dy) => {
          row.forEach((local, dx) => {
            if (local === 0) return;
            set(x + dx, y + dy, gid(3, 'village', local));
          });
        });
        stamped = true;
      }

      for (let step = 0; step < 5; step += 1) {
        const x = sx * SCREEN_COLS + 1 + int(rng, SCREEN_COLS - 2);
        const y = sy * SCREEN_ROWS + 1 + int(rng, SCREEN_ROWS - 2);
        const village = rng() < 0.6;
        const list = village ? VILLAGE_FLAT_SINGLES : DESERT_FLAT_SINGLES;
        set(x, y, gid(3, village ? 'village' : 'ground', pick(rng, list)));
      }
    }
  }

  // Border: complete solid props on the outer row/columns (all 4 sides of the 128×72 room).
  const border: { x: number; y: number }[] = [];
  for (let x = 1; x < COLS - 1; x += 1) {
    border.push({ x, y: 0 }, { x, y: ROWS - 1 });
  }
  for (let y = 1; y < ROWS - 1; y += 1) {
    border.push({ x: 0, y }, { x: COLS - 1, y });
  }
  for (let step = 0; step < 14 && border.length > 0; step += 1) {
    const [cell] = border.splice(int(rng, border.length), 1);
    if (cell === undefined) break;
    const set3 = rng() < 0.65 ? 'village' : 'ground';
    const list = set3 === 'village' ? BORDER_VILLAGE_PROPS : BORDER_DESERT_PROPS;
    set(cell.x, cell.y, gid(3, set3, pick(rng, list)));
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

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<map version="1.10" tiledversion="1.11.0" orientation="orthogonal" renderorder="right-down" ` +
      `width="${COLS}" height="${ROWS}" tilewidth="${TILE}" tileheight="${TILE}" infinite="0" ` +
      `nextlayerid="4" nextobjectid="${id}">`,
    ' <properties>',
    properties,
    ' </properties>',
    tilesetXml(chapter),
    ` <layer id="1" name="floor" width="${COLS}" height="${ROWS}">`,
    '  <data encoding="csv">',
    csv(plan.floor, COLS, ROWS),
    '  </data>',
    ' </layer>',
    ` <layer id="3" name="decor" width="${COLS}" height="${ROWS}">`,
    '  <data encoding="csv">',
    csv(plan.decor, COLS, ROWS),
    '  </data>',
    ' </layer>',
    ' <objectgroup id="2" name="objects">',
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
export function generateRoom(chapter: number, room: number): RoomPlan {
  const theme = PROP_THEMES[chapter];
  if (theme === undefined) throw new Error(`chapter ${chapter} has no prop theme`);
  const floorGid = FLOOR_GID[chapter];
  if (floorGid === undefined) throw new Error(`chapter ${chapter} has no floor tile`);

  const failures: string[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const rng = mulberry32((chapter * 1_000_003 + room * 7919 + attempt * 104_729) >>> 0);
      const playerStart = planPlayerStart(room, rng);
      const doors: Vec2[] = [
        { x: playerStart.x, y: ROWS - 0.5 },
        { x: 4 + int(rng, COLS - 8) + 0.5, y: 0.5 },
      ];
      const water = chapter === 2 ? planRiver(rng) : [];
      const { obstacles, props } = planGeometry(chapter, room, rng, playerStart, doors, water);
      const colliders: Rect[] = [
        ...obstacles,
        ...props.flatMap((prop) => {
          const def = propDef(chapter, prop.key);
          const collider = def === undefined ? null : propCollider(prop, def);
          return collider === null ? [] : [collider];
        }),
      ];
      const spawns = planSpawns(chapter, room, rng, playerStart, doors, colliders, water);
      const floor = new Array<number>(COLS * ROWS).fill(floorGid);
      const partial: RoomPlan = {
        chapter,
        room,
        playerStart,
        doors,
        obstacles,
        props,
        water,
        floor,
        decor: [],
        spawns,
      };
      const decor = planDecor(
        chapter,
        mulberry32((chapter * 31 + room * 17 + attempt) >>> 0),
        reservedCells(partial),
      );
      const plan: RoomPlan = { ...partial, decor };

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
