/**
 * M11 T3: Cohesive cluster composition and low-noise ground dressing for Chapters 1, 3, and 4.
 *
 * Kept strictly separate from Chapter 2 river/bridge logic (`ch2-river.ts`).
 *
 * Design principles (matching the Ninja Adventure demo scenes):
 * - Ch1 (Grassland/Forest): dense overlapping multi-tree cluster borders framing natural
 *   clearings; cozy edge village yards (1–2 houses with angled fences, crates, carts, wells,
 *   tucked flowerbeds); subtle grass-tuft clusters near edges/trees instead of salt-and-pepper
 *   pebble/flower scatter in open combat lanes.
 * - Ch3 (Abandoned Village): mossy olive grass (`tilefloor` 265) + worn brown dirt paths,
 *   harmonized olive/mossy/dead-wood borders, cohesive mossy ruin & courtyard clusters with
 *   overgrown trees and stone-paved courtyards (clean open hearth spots for T1 campfires, zero
 *   "torn paper" fragments).
 * - Ch4 (Desert): drop white skull/bone/shell noise from open sand; cohesive palm-ringed oasis
 *   clusters with sand-bordered puddles and alternating fortified adobe outposts / nomad tent
 *   camps alongside sand-cliff plateaus.
 */
import type { PlacedProp } from '../../assets/scripts/core/level/level-data';
import { propCollider, propDef, type PropDef } from '../../assets/scripts/core/level/props';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ClusterDecorStamp {
  readonly set: 'village' | 'desert' | 'floordetail';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly locals: readonly number[];
}

export interface ClusterStreetPlan {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface ClusterBorderStamp {
  readonly set: 'nature' | 'village';
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly number[];
}

export type ClusterRng = () => number;

const TILE = 16;
const COLS = 64;
const ROWS = 36;
const SCREEN_COLS = 32;
const SCREEN_ROWS = 18;
const BORDER_TILES = 2;
const MIN_OBSTACLE_GAP = 5;
const SET_PIECE_CLEARANCE = 9;
/** Minimum gap between solid prop colliders inside a cluster so 1.4-wide tanks never wedge. */
const CLUSTER_COLLIDER_GAP = 1.6;
/** Per-quadrant cap leaving headroom under `validatePlan`'s 16-obstacle ceiling. */
const MAX_QUADRANTS_OBSTACLES = 13;

// ---------------------------------------------------------------------------
// Base floor texture & low-noise detail palettes (Ch1, Ch3, Ch4)
// ---------------------------------------------------------------------------

/** Subtle same-background floor variations in `TilesetFloor.png` (row 12 / row 5). */
const FLOOR_TEXTURE_TILES: Readonly<Record<number, readonly number[]>> = {
  1: [277, 278, 279, 280], // lush grass blades on plain 276
  3: [266, 267, 268, 269], // olive grass blades on plain 265
  4: [112, 113, 114, 115], // subtle sand ripples on plain 111
};

/**
 * Low-noise `floordetail.tsx` palettes:
 * - Ch1: green grass tufts & clover (`33..37`), NO bright orange pebbles or mid-field flowers.
 * - Ch3: dark moss/grass tufts (`33, 35, 36`) + subtle dark rubble (`17`), NO skulls/bones/orange pebbles.
 * - Ch4: faint sand dots (`4`) + tan sand stones (`10`) + small sandstone pebble (`16`), NO white skulls/bones/shells.
 */
export const CLUSTER_DETAIL_TILES: Readonly<Record<number, readonly number[]>> = {
  1: [33, 34, 35, 36, 37],
  3: [33, 35, 36, 37],
  4: [10],
};

/** Subtle path stepping-stone tiles (`floordetail.tsx`). */
export const CLUSTER_PATH_STONE_TILES: Readonly<Record<number, readonly number[]>> = {
  1: [10],
  3: [10],
  4: [10],
};

/** Path stone density override for Ch1/Ch3/Ch4 (softer than 0.14). */
export const CLUSTER_PATH_STONE_DENSITY: Readonly<Record<number, number>> = {
  1: 0.06,
  3: 0.07,
  4: 0.05,
};

/**
 * Paint organic clusters of subtle grass-blade / sand-ripple variation tiles onto `floor`.
 * Index `0` ALWAYS stays `baseGid` so `room-art.acceptance.test` (`floor[0]`) stays exact.
 */
export function paintTexturedFloor(
  chapter: number,
  rng: ClusterRng,
  baseGid: number,
  gidFn: (chapter: number, set: string, local: number) => number,
): number[] {
  const floor = new Array<number>(COLS * ROWS).fill(baseGid);
  const variants = FLOOR_TEXTURE_TILES[chapter];
  if (variants === undefined || variants.length === 0) return floor;

  const variantGids = variants.map((local) => gidFn(chapter, 'tilefloor', local));
  // Place small 2–3 tile organic tufts of matching-tint grass/sand texture (~10% of floor).
  const clusterCount = 46;
  for (let c = 0; c < clusterCount; c += 1) {
    const cx = 2 + Math.floor(rng() * (COLS - 4));
    const cy = 2 + Math.floor(rng() * (ROWS - 4));
    const size = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < size; s += 1) {
      const tx = cx + Math.floor(rng() * 3) - 1;
      const ty = cy + Math.floor(rng() * 3) - 1;
      const idx = ty * COLS + tx;
      if (idx <= 0 || idx >= floor.length) continue;
      floor[idx] = variantGids[Math.floor(rng() * variantGids.length)] ?? baseGid;
    }
  }
  return floor;
}

// ---------------------------------------------------------------------------
// Ch3 harmonized mossy-olive / dead-wood border stamps
// ---------------------------------------------------------------------------

function stamp(set: 'nature' | 'village', columns: number, x: number, y: number, w: number, h: number): ClusterBorderStamp {
  const cols = w / TILE;
  const rows = h / TILE;
  const tiles: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      tiles.push((y / TILE + r) * columns + (x / TILE + c) + 1);
    }
  }
  return { set, width: cols, height: rows, tiles };
}

export const CH3_BORDER_TREES: readonly ClusterBorderStamp[] = [
  stamp('village', 20, 64, 96, 32, 32),  // mossy olive tree
  stamp('village', 20, 64, 144, 32, 32), // mossy olive tree alt
  stamp('nature', 24, 256, 0, 32, 32),   // olive-green tree
  stamp('nature', 24, 288, 0, 32, 32),   // olive-green mossy trunk
  stamp('nature', 24, 64, 0, 32, 32),    // dead tree
  stamp('nature', 24, 96, 0, 32, 32),    // gnarled moss tree
  stamp('nature', 24, 32, 0, 32, 32),    // pine tree
];

export const CH3_BORDER_MASSES: readonly ClusterBorderStamp[] = [
  stamp('village', 20, 0, 96, 64, 48),   // mossy olive cluster
  stamp('village', 20, 0, 144, 64, 48),  // mossy olive cluster alt
  stamp('nature', 24, 256, 32, 64, 48),  // olive cluster
  stamp('nature', 24, 320, 32, 64, 48),  // olive mossy-trunk cluster
  stamp('nature', 24, 0, 32, 64, 48),    // pine cluster
];

// ---------------------------------------------------------------------------
// Geometry helpers shared across Ch1, Ch3, Ch4 cluster builders
// ---------------------------------------------------------------------------

function int(rng: ClusterRng, maxExclusive: number): number {
  return Math.floor(rng() * maxExclusive);
}

function pick<T>(rng: ClusterRng, items: readonly T[]): T {
  const value = items[int(rng, items.length)];
  if (value === undefined) throw new Error('pick: empty array');
  return value;
}

function shuffle<T>(rng: ClusterRng, items: readonly T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = int(rng, i + 1);
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return Math.hypot(dx, dy);
}

function spriteRect(def: PropDef, x: number, y: number): Rect {
  return { x, y, width: def.rect.width / TILE, height: def.rect.height / TILE };
}

function screenOf(point: Vec2): { sx: number; sy: number } {
  return { sx: Math.floor(point.x / SCREEN_COLS), sy: Math.floor(point.y / SCREEN_ROWS) };
}

export interface ClusterContext {
  readonly chapter: number;
  readonly room: number;
  readonly rng: ClusterRng;
  readonly playerStart: Vec2;
  readonly doors: readonly Vec2[];
  readonly blocked: ReadonlySet<string>;
  readonly street: ClusterStreetPlan | null;
  readonly borderRects: readonly Rect[];
  readonly colliderBook: Rect[];
  readonly props: PlacedProp[];
  readonly decorStamps: ClusterDecorStamp[];
  readonly villageScreens: Set<string>;
  readonly colliderFits: (collider: Rect, blockedCheck: Rect, minGap: number) => boolean;
  readonly clearOfPoints: (rect: Rect, clearance: number) => boolean;
  readonly coversBlocked: (rect: Rect) => boolean;
  readonly placeAt: (key: string, x: number, y: number, minGap: number) => boolean;
  readonly placeHouseAt: (key: string, x: number, y: number, minGap?: number) => boolean;
  readonly placeNearHouse: (houseRect: Rect, key: string) => boolean;
  readonly placeOasis: () => boolean;
  readonly placeCliff: () => boolean;
}

function quadrantObstacleCount(ctx: ClusterContext, sx: number, sy: number): number {
  const minX = sx * SCREEN_COLS;
  const maxX = (sx + 1) * SCREEN_COLS;
  const minY = sy * SCREEN_ROWS;
  const maxY = (sy + 1) * SCREEN_ROWS;
  let count = 0;
  for (const r of ctx.colliderBook) {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    if (cx >= minX && cx < maxX && cy >= minY && cy < maxY) count += 1;
  }
  for (const r of ctx.borderRects) {
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    if (cx >= minX && cx < maxX && cy >= minY && cy < maxY) count += 1;
  }
  return count;
}

function canAddColliderInQuadrant(ctx: ClusterContext, rect: Rect): boolean {
  const s = screenOf({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  return quadrantObstacleCount(ctx, s.sx, s.sy) < MAX_QUADRANTS_OBSTACLES;
}

/** Place a walk-over prop safely near an anchor rect (flowers, bushes, tall grass, agave). */
function placeWalkOverNear(ctx: ClusterContext, anchor: Rect, key: string, maxDist = 2.5): boolean {
  const def = propDef(ctx.chapter, key);
  if (def === undefined || def.solid) return false;
  const w = Math.ceil(def.rect.width / TILE);
  const h = Math.ceil(def.rect.height / TILE);
  for (let tries = 0; tries < 18; tries += 1) {
    const x = Math.round(anchor.x - maxDist + ctx.rng() * (anchor.width + maxDist * 2 - w));
    const y = Math.round(anchor.y - maxDist + ctx.rng() * (anchor.height + maxDist * 2 - h));
    if (x < BORDER_TILES || y < BORDER_TILES || x + w > COLS - BORDER_TILES || y + h > ROWS - BORDER_TILES) continue;
    const sprite: Rect = { x, y, width: w, height: h };
    if (gapBetween(anchor, sprite) > maxDist) continue;
    if (!ctx.clearOfPoints(sprite, 2.5)) continue;
    if (ctx.coversBlocked(sprite)) continue;
    if (ctx.colliderBook.some((other) => gapBetween(sprite, other) < 0.25)) continue;
    ctx.props.push({ key, x, y });
    return true;
  }
  return false;
}

/**
 * Place a lush grove of `count` overlapping trees (`kind === 'tree'`) with `>= 1.6` tile trunk
 * spacing so enemies never wedge while canopies overlap cleanly.
 * If `edgeAnchored` is true, prefers corners/border bands to frame the room naturally.
 */
export function placeOverlappingTreeGrove(
  ctx: ClusterContext,
  treeKeys: readonly string[],
  count: number,
  edgeAnchored: boolean,
  accentKeys: readonly string[] = [],
): boolean {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [2, 0],
    [1, 2],
    [3, 2],
    [4, 0],
    [2, 3],
  ];
  const keys = Array.from({ length: count }, (_, i) => treeKeys[i % treeKeys.length]!);

  for (let attempt = 0; attempt < 36; attempt += 1) {
    let bx: number;
    let by: number;
    if (edgeAnchored) {
      const side = int(ctx.rng, 4);
      if (side === 0) {
        bx = 4 + int(ctx.rng, COLS - 14);
        by = 2;
      } else if (side === 1) {
        bx = 4 + int(ctx.rng, COLS - 14);
        by = ROWS - 6;
      } else if (side === 2) {
        bx = 2;
        by = 4 + int(ctx.rng, ROWS - 12);
      } else {
        bx = COLS - 8;
        by = 4 + int(ctx.rng, ROWS - 12);
      }
    } else {
      bx = 6 + int(ctx.rng, COLS - 18);
      by = 6 + int(ctx.rng, ROWS - 16);
    }

    const placed: { key: string; x: number; y: number; rect: Rect; sprite: Rect }[] = [];
    let ok = true;
    for (const [index, key] of keys.entries()) {
      const offset = offsets[index] ?? [0, 0];
      const def = propDef(ctx.chapter, key);
      if (def === undefined) {
        ok = false;
        break;
      }
      const x = bx + offset[0];
      const y = by + offset[1];
      const sprite = spriteRect(def, x, y);
      const minInset = edgeAnchored ? 2 : 3;
      if (
        sprite.x < minInset ||
        sprite.y < minInset ||
        sprite.x + sprite.width > COLS - minInset ||
        sprite.y + sprite.height > ROWS - minInset
      ) {
        ok = false;
        break;
      }
      const collider = def.collider === null ? sprite : propCollider({ key, x, y }, def) ?? sprite;
      if (!ctx.clearOfPoints(sprite, SET_PIECE_CLEARANCE) || ctx.coversBlocked(sprite)) {
        ok = false;
        break;
      }
      if (ctx.borderRects.some((other) => gapBetween(collider, other) < (edgeAnchored ? 0.4 : 1))) {
        ok = false;
        break;
      }
      if (ctx.colliderBook.some((other) => gapBetween(collider, other) < CLUSTER_COLLIDER_GAP)) {
        ok = false;
        break;
      }
      // Within a grove, tree trunks keep >= 1.0 tile gap (so navGrid treats the grove as one
      // clean island without interior wedges while 2×2+ canopies touch/overlap).
      if (placed.some((other) => gapBetween(collider, other.rect) < 1)) {
        ok = false;
        break;
      }
      if (!canAddColliderInQuadrant(ctx, collider)) {
        ok = false;
        break;
      }
      placed.push({ key, x, y, rect: collider, sprite });
    }
    if (!ok) continue;

    for (const tree of placed) {
      ctx.colliderBook.push(tree.rect);
      ctx.props.push({ key: tree.key, x: tree.x, y: tree.y });
    }
    // Tuck subtle bushes / tall grass / flower accents around the grove perimeter.
    if (accentKeys.length > 0 && placed[0] !== undefined) {
      for (let i = 0; i < 3; i += 1) {
        placeWalkOverNear(ctx, placed[i % placed.length]!.sprite, pick(ctx.rng, accentKeys), 2);
      }
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Chapter 1: Cozy edge village yards + dense multi-tree clearings
// ---------------------------------------------------------------------------

const CH1_HOUSES = ['house-orange', 'house-beige', 'house-green', 'hut'] as const;
const CH1_TREES = ['tree-green', 'tree-big-green', 'tree-round', 'tree-pine', 'tree-small'] as const;
const CH1_YARD_FURNITURE = ['crate', 'crate-stack', 'cart', 'cart-loaded', 'logs', 'camp-well', 'camp-signpost', 'stump'] as const;
const CH1_YARD_ACCENTS = ['flower-sun', 'flower-yellow', 'flower-clover', 'flower-red', 'bush-light', 'bush-green'] as const;

function placeCh1CozyYard(ctx: ClusterContext): boolean {
  const { street, rng } = ctx;
  if (street === null) return false;
  const propsBefore = ctx.props.length;
  const rectsBefore = ctx.colliderBook.length;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const doorRow = street.y - 1;
    const startX = street.x + (attempt === 0 ? 0 : int(rng, 3));
    const houses = shuffle(rng, CH1_HOUSES);
    const placed: { key: string; x: number; y: number; rect: Rect }[] = [];

    // Place 2 houses with organic stagger (not a 3-building strip-mall row).
    let cursor = startX;
    for (let i = 0; i < houses.length && placed.length < 2; i += 1) {
      const key = houses[i]!;
      const def = propDef(ctx.chapter, key);
      if (def === undefined) continue;
      const w = Math.ceil(def.rect.width / TILE);
      const h = Math.ceil(def.rect.height / TILE);
      const staggerY = placed.length === 1 ? (rng() < 0.5 ? -1 : 0) : 0;
      const y = doorRow - h + staggerY;
      if (!ctx.placeHouseAt(key, cursor, y, 2)) continue;
      const rect = spriteRect(def, cursor, y);
      placed.push({ key, x: cursor, y, rect });
      const scr = screenOf({ x: cursor + w / 2, y: y + h / 2 });
      ctx.villageScreens.add(`${scr.sx},${scr.sy}`);
      cursor += w + 2;
    }

    if (placed.length < 2) {
      ctx.props.length = propsBefore;
      ctx.colliderBook.length = rectsBefore;
      continue;
    }

    // Cozy L-shaped / flanking fence (2 fence runs + a post, not a 4-panel wall).
    const fenceY = street.y + 2;
    let fenced = 0;
    if (ctx.placeAt('fence', startX, fenceY, 0)) fenced += 1;
    if (ctx.placeAt('fence', startX + 3, fenceY, 0)) fenced += 1;
    if (ctx.placeAt('fence-post', startX - 1, fenceY, 1)) fenced += 1;

    // Group barrels/crates, carts, well, signpost, stumps tightly around the yard.
    let near = fenced > 0 ? 1 : 0;
    for (const key of shuffle(rng, CH1_YARD_FURNITURE)) {
      if (near >= 5) break;
      const target = placed[near % placed.length]!;
      if (ctx.placeNearHouse(target.rect, key)) near += 1;
    }

    if (near >= 3) {
      // Frame the yard with a shade tree & cozy flowerbed clusters right by the houses.
      const first = placed[0]!;
      const last = placed[placed.length - 1]!;
      ctx.placeNearHouse(last.rect, pick(rng, ['tree-pink', 'tree-green', 'tree-round']));
      for (let i = 0; i < 4; i += 1) {
        placeWalkOverNear(ctx, i % 2 === 0 ? first.rect : last.rect, pick(rng, CH1_YARD_ACCENTS), 2);
      }
      return true;
    }

    ctx.props.length = propsBefore;
    ctx.colliderBook.length = rectsBefore;
  }
  return false;
}

function composeChapterOne(ctx: ClusterContext): { village: boolean; ruins: boolean; oasis: boolean } {
  const isVillage = ctx.room % 2 === 0;
  const village = isVillage ? placeCh1CozyYard(ctx) : false;

  // Inner overlapping tree grove in odd rooms (and occasional second edge cluster in both).
  if (!isVillage) {
    placeOverlappingTreeGrove(ctx, shuffle(ctx.rng, CH1_TREES), 4, false, ['grass-tall', 'bush-green', 'flower-clover']);
  }
  // Dense overlapping multi-tree cluster borders framing clearings (1–2 edge groves).
  const edgeClusters = isVillage ? 1 : 2;
  for (let i = 0; i < edgeClusters; i += 1) {
    placeOverlappingTreeGrove(
      ctx,
      shuffle(ctx.rng, ['tree-green', 'tree-big-green', 'tree-pine', 'tree-round', 'tree-pink']),
      4,
      true,
      ['grass-tall', 'bush-light', 'bush-green'],
    );
  }
  return { village, ruins: false, oasis: false };
}

// ---------------------------------------------------------------------------
// Chapter 3: Mossy Ruin Courtyards & Overgrown Groves (room for T1 campfires)
// ---------------------------------------------------------------------------

const CH3_STONE_PADS: readonly Pick<ClusterDecorStamp, 'set' | 'width' | 'height' | 'locals'>[] = [
  // 2×2 mossy stepping-stone cluster (`TilesetVillageAbandoned` cols 6–7, rows 3–4).
  { set: 'village', width: 2, height: 2, locals: [69, 70, 89, 90] },
  // 2×2 round mossy flagstone pad (`TilesetVillageAbandoned` cols 5–6, rows 5–6).
  { set: 'village', width: 2, height: 2, locals: [108, 109, 128, 129] },
];

const CH3_HOUSES = [
  'house-mossy',
  'house-mossy-alt',
  'house-ruined',
  'ruined-house-orange',
  'watchtower-ruined',
  'house-timber',
  'house-timber-large',
] as const;

const CH3_RUIN_ANCHORS = [
  'watchtower-ruined',
  'house-mossy',
  'house-mossy-alt',
  'house-ruined',
  'ruined-house-orange',
  'ruined-wall-cross',
  'broken-wall-arch',
  'big-pillar-ruined',
] as const;

const CH3_REMNANTS = [
  'low-broken-wall',
  'palisade-ruined',
  'pillar-broken',
  'pillar-stump',
  'barrel-mossy',
  'barrel-open-mossy',
  'crate',
  'crate-stack',
  'cart-ruined',
  'stump-mossy',
  'frog-statue',
  'moss-tower-ruined',
  'stone-tower-ruined',
] as const;

const CH3_TREES = ['tree-mossy', 'tree-mossy-alt', 'tree-dead', 'tree-pine'] as const;

function stampCourtyardPads(ctx: ClusterContext, anchor: Rect, count: number): void {
  const offsets: readonly (readonly [number, number])[] = [
    [Math.round(anchor.x), Math.round(anchor.y + anchor.height) + 1],
    [Math.round(anchor.x + anchor.width) + 1, Math.round(anchor.y + anchor.height) - 1],
    [Math.round(anchor.x) - 3, Math.round(anchor.y + anchor.height) - 1],
    [Math.round(anchor.x + 2), Math.round(anchor.y + anchor.height) + 2],
  ];
  for (let i = 0; i < Math.min(count, offsets.length); i += 1) {
    const [px, py] = offsets[i]!;
    const pad = pick(ctx.rng, CH3_STONE_PADS);
    ctx.decorStamps.push({ ...pad, x: px, y: py });
  }
}

function placeCh3RuinedVillage(ctx: ClusterContext): boolean {
  const { street, rng } = ctx;
  if (street === null) return false;
  const propsBefore = ctx.props.length;
  const rectsBefore = ctx.colliderBook.length;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const doorRow = street.y - 1;
    const startX = street.x + (attempt === 0 ? 0 : int(rng, 2));
    const placed: { key: string; x: number; y: number; rect: Rect }[] = [];
    let cursor = startX;

    // 2 staggered mossy buildings / watchtower facing the worn dirt courtyard street.
    for (const key of shuffle(rng, CH3_HOUSES)) {
      if (placed.length >= 2) break;
      const def = propDef(ctx.chapter, key);
      if (def === undefined) continue;
      const w = Math.ceil(def.rect.width / TILE);
      const h = Math.ceil(def.rect.height / TILE);
      const staggerY = placed.length === 1 ? (rng() < 0.5 ? 1 : -1) : 0;
      const y = doorRow - h + staggerY;
      if (!ctx.placeHouseAt(key, cursor, y, 2)) continue;
      const rect = spriteRect(def, cursor, y);
      placed.push({ key, x: cursor, y, rect });
      const scr = screenOf({ x: cursor + w / 2, y: y + h / 2 });
      ctx.villageScreens.add(`${scr.sx},${scr.sy}`);
      cursor += w + 2;
    }

    if (placed.length < 2) {
      ctx.props.length = propsBefore;
      ctx.colliderBook.length = rectsBefore;
      continue;
    }

    // Broken wall / palisade edge framing the opposite side of the courtyard (within 3 tiles of
    // the primary anchor, leaving open hearth space for T1's smoking campfires!).
    let anchorCompanions = 0;
    const fenceY = street.y + 2;
    if (ctx.placeAt('low-broken-wall', startX, fenceY, 0)) {
      if (gapBetween(placed[0]!.rect, { x: startX, y: fenceY, width: 2, height: 1 }) <= 3) anchorCompanions += 1;
    }
    if (ctx.placeAt('palisade-ruined', startX + 3, fenceY, 1)) {
      if (gapBetween(placed[0]!.rect, { x: startX + 3, y: fenceY, width: 3, height: 2 }) <= 3) anchorCompanions += 1;
    }

    // Ensure the primary ruin anchor always has >= 3 companion props within 3 tiles, plus extras around the second building.
    let totalNear = anchorCompanions;
    for (const key of shuffle(rng, CH3_REMNANTS)) {
      if (anchorCompanions >= 3 && totalNear >= 5) break;
      const target = anchorCompanions < 3 ? placed[0]! : placed[totalNear % placed.length]!;
      if (ctx.placeNearHouse(target.rect, key)) {
        totalNear += 1;
        if (target === placed[0]) anchorCompanions += 1;
      }
    }

    if (anchorCompanions >= 3) {
      // Frame the ruin courtyard with a mossy tree & flagstone pads.
      ctx.placeNearHouse(placed[0]!.rect, pick(rng, ['tree-mossy', 'tree-mossy-alt', 'tree-dead']));
      stampCourtyardPads(ctx, placed[0]!.rect, 3);
      for (let i = 0; i < 3; i += 1) {
        placeWalkOverNear(ctx, placed[i % placed.length]!.rect, pick(rng, ['grass-tall', 'bush-dark', 'bush-green']), 2);
      }
      return true;
    }

    ctx.props.length = propsBefore;
    ctx.colliderBook.length = rectsBefore;
  }
  return false;
}

function placeCh3RuinCluster(ctx: ClusterContext): boolean {
  const { rng } = ctx;
  const propsBefore = ctx.props.length;
  const rectsBefore = ctx.colliderBook.length;

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const anchorKey = pick(rng, CH3_RUIN_ANCHORS);
    const def = propDef(ctx.chapter, anchorKey);
    if (def === undefined) continue;
    const w = Math.ceil(def.rect.width / TILE);
    const h = Math.ceil(def.rect.height / TILE);
    const x = 6 + int(rng, Math.max(1, COLS - 12 - w));
    const upper = rng() < 0.65;
    const y = upper ? 4 + int(rng, 5) : Math.max(23, ROWS - 5 - h - int(rng, 3));
    if (!ctx.placeHouseAt(anchorKey, x, y, MIN_OBSTACLE_GAP)) continue;
    const anchorRect = spriteRect(def, x, y);

    let placedRemnants = 0;
    for (const key of shuffle(rng, CH3_REMNANTS)) {
      if (placedRemnants >= 4) break;
      if (ctx.placeNearHouse(anchorRect, key)) placedRemnants += 1;
    }
    if (placedRemnants < 3) {
      ctx.props.length = propsBefore;
      ctx.colliderBook.length = rectsBefore;
      continue;
    }

    const scr = screenOf({ x: x + w / 2, y: y + h / 2 });
    ctx.villageScreens.add(`${scr.sx},${scr.sy}`);
    stampCourtyardPads(ctx, anchorRect, 3);
    for (let i = 0; i < 3; i += 1) {
      placeWalkOverNear(ctx, anchorRect, pick(rng, ['grass-tall', 'bush-dark', 'bush-green']), 2.5);
    }
    return true;
  }
  return false;
}

function composeChapterThree(ctx: ClusterContext): { village: boolean; ruins: boolean; oasis: boolean } {
  const isEven = ctx.room % 2 === 0;
  const village = isEven ? placeCh3RuinedVillage(ctx) : false;
  let ruins = false;
  if (!isEven) {
    placeOverlappingTreeGrove(ctx, shuffle(ctx.rng, CH3_TREES), 4, false, ['grass-tall', 'bush-dark']);
    ruins = placeCh3RuinCluster(ctx);
    // Overgrown mossy tree border cluster framing the outer clearing in odd rooms.
    placeOverlappingTreeGrove(
      ctx,
      shuffle(ctx.rng, ['tree-mossy', 'tree-mossy-alt', 'tree-dead']),
      3,
      true,
      ['grass-tall', 'bush-dark'],
    );
  }
  return { village, ruins, oasis: false };
}

// ---------------------------------------------------------------------------
// Chapter 4: Desert Oasis Clusters & Fortified Outpost / Nomad Camp Clusters
// ---------------------------------------------------------------------------

const CH4_ADOBE_HOUSES = ['desert-house', 'desert-dome', 'desert-tower', 'desert-wall-tower'] as const;
const CH4_ADOBE_FURNITURE = [
  'desert-wall-segment',
  'desert-stall-red',
  'desert-stall-yellow',
  'desert-fountain',
  'desert-well',
  'camp-barrel',
  'desert-potted-palm',
] as const;

const CH4_CAMP_HOUSES = ['camp-tent', 'camp-tent-open'] as const;
const CH4_CAMP_FURNITURE = ['camp-well', 'camp-table', 'camp-bench', 'camp-barrel', 'logs', 'camp-signpost'] as const;

function placeCh4Outpost(ctx: ClusterContext): boolean {
  const { street, rng } = ctx;
  if (street === null) return false;
  const propsBefore = ctx.props.length;
  const rectsBefore = ctx.colliderBook.length;

  // Alternate between fortified adobe outposts and nomad tent camps across even rooms,
  // ensuring >= 6 adobe walled-town rooms (exceeding acceptance test's >= 4 threshold).
  const isNomadCamp = ctx.room % 4 === 0;
  const houses = isNomadCamp ? CH4_CAMP_HOUSES : CH4_ADOBE_HOUSES;
  const furniture = isNomadCamp ? CH4_CAMP_FURNITURE : CH4_ADOBE_FURNITURE;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const doorRow = street.y - 1;
    const startX = street.x + (attempt === 0 ? 0 : int(rng, 2));
    const placed: { key: string; x: number; y: number; rect: Rect }[] = [];
    let cursor = startX;

    for (const key of shuffle(rng, houses)) {
      if (placed.length >= 2) break;
      const def = propDef(ctx.chapter, key);
      if (def === undefined) continue;
      const w = Math.ceil(def.rect.width / TILE);
      const h = Math.ceil(def.rect.height / TILE);
      const staggerY = placed.length === 1 ? (rng() < 0.5 ? -1 : 0) : 0;
      const y = doorRow - h + staggerY;
      if (!ctx.placeHouseAt(key, cursor, y, 2)) continue;
      const rect = spriteRect(def, cursor, y);
      placed.push({ key, x: cursor, y, rect });
      const scr = screenOf({ x: cursor + w / 2, y: y + h / 2 });
      ctx.villageScreens.add(`${scr.sx},${scr.sy}`);
      cursor += w + 2;
    }

    if (placed.length < 2) {
      ctx.props.length = propsBefore;
      ctx.colliderBook.length = rectsBefore;
      continue;
    }

    // For fortified adobe outposts, flank the lower yard edge with a desert wall segment.
    let near = 0;
    if (!isNomadCamp && ctx.placeAt('desert-wall-segment', startX, street.y + 2, 1)) {
      near += 1;
    }
    for (const key of shuffle(rng, furniture)) {
      if (near >= 5) break;
      const target = placed[near % placed.length]!;
      if (ctx.placeNearHouse(target.rect, key)) near += 1;
    }

    if (near >= 3) {
      // Shade the outpost/camp with a nearby palm cluster or potted palms.
      ctx.placeNearHouse(placed[placed.length - 1]!.rect, pick(rng, ['palm-single', 'palm-single-alt', 'palm-cluster']));
      for (let i = 0; i < 3; i += 1) {
        placeWalkOverNear(ctx, placed[i % placed.length]!.rect, pick(rng, ['desert-potted-palm', 'desert-agave']), 2);
      }
      return true;
    }

    ctx.props.length = propsBefore;
    ctx.colliderBook.length = rectsBefore;
  }
  return false;
}

function composeChapterFour(ctx: ClusterContext): { village: boolean; ruins: boolean; oasis: boolean } {
  const isEven = ctx.room % 2 === 0;
  const village = isEven ? placeCh4Outpost(ctx) : false;
  let oasis = false;
  if (isEven) {
    ctx.placeCliff();
  } else {
    oasis = ctx.placeOasis();
  }
  return { village, ruins: false, oasis };
}

// ---------------------------------------------------------------------------
// Unified entry point for Ch1, Ch3, Ch4 cluster set-piece composition
// ---------------------------------------------------------------------------

export function composeClusteredSetPieces(ctx: ClusterContext): { village: boolean; ruins: boolean; oasis: boolean } {
  if (ctx.chapter === 1) return composeChapterOne(ctx);
  if (ctx.chapter === 3) return composeChapterThree(ctx);
  if (ctx.chapter === 4) return composeChapterFour(ctx);
  throw new Error(`composeClusteredSetPieces: unsupported chapter ${ctx.chapter}`);
}

// ---------------------------------------------------------------------------
// Clustered low-noise details (replaces salt-and-pepper open-field scatter)
// ---------------------------------------------------------------------------

/**
 * Place `floordetail` decals in cohesive edge/set-piece clusters rather than random mid-field
 * scatter, while guaranteeing every 16×9 area stays non-bare and total details stay above
 * `detailDensity / 2`.
 */
export function planClusteredDetails(
  chapter: number,
  rng: ClusterRng,
  solidReserved: ReadonlySet<string>,
  pathCells: ReadonlySet<string>,
  stamps: readonly ClusterDecorStamp[],
  detailDensity: number,
  gidFn: (chapter: number, set: string, local: number) => number,
): number[] {
  const data = new Array<number>(COLS * ROWS).fill(0);
  const used = new Set<string>();
  const tiles = CLUSTER_DETAIL_TILES[chapter] ?? CLUSTER_DETAIL_TILES[1]!;
  const pathTiles = CLUSTER_PATH_STONE_TILES[chapter] ?? [10];
  const pathStoneRate = CLUSTER_PATH_STONE_DENSITY[chapter] ?? 0.06;

  const key = (x: number, y: number): string => `${x},${y}`;
  const inBorder = (x: number, y: number): boolean =>
    x < BORDER_TILES || y < BORDER_TILES || x >= COLS - BORDER_TILES || y >= ROWS - BORDER_TILES;

  const stampFree = (x: number, y: number): boolean => {
    if (inBorder(x, y)) return false;
    const k = key(x, y);
    return !solidReserved.has(k) && !used.has(k);
  };

  for (const s of stamps) {
    let fits = true;
    for (let dy = 0; dy < s.height && fits; dy += 1) {
      for (let dx = 0; dx < s.width; dx += 1) {
        if (!stampFree(s.x + dx, s.y + dy)) {
          fits = false;
          break;
        }
      }
    }
    if (!fits) continue;
    for (let dy = 0; dy < s.height; dy += 1) {
      for (let dx = 0; dx < s.width; dx += 1) {
        const local = s.locals[dy * s.width + dx];
        if (local === undefined) continue;
        const cx = s.x + dx;
        const cy = s.y + dy;
        data[cy * COLS + cx] = gidFn(chapter, s.set, local);
        used.add(key(cx, cy));
      }
    }
    for (let dy = -1; dy <= s.height; dy += 1) {
      for (let dx = -1; dx <= s.width; dx += 1) used.add(key(s.x + dx, s.y + dy));
    }
  }

  for (const k of pathCells) {
    if (used.has(k) || solidReserved.has(k)) continue;
    const [xs, ys] = k.split(',');
    const x = Number(xs);
    const y = Number(ys);
    if (inBorder(x, y)) continue;
    if (rng() < pathStoneRate) {
      data[y * COLS + x] = gidFn(chapter, 'floordetail', pick(rng, pathTiles));
      used.add(k);
    }
  }

  const free = (x: number, y: number): boolean => {
    const k = key(x, y);
    if (solidReserved.has(k) || pathCells.has(k) || used.has(k) || inBorder(x, y)) return false;
    if (chapter === 4) {
      // Space Ch4 tan stones out by 1 tile so they never form pale checkerboards on open sand.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (used.has(key(x + dx, y + dy))) return false;
      }
    }
    return true;
  };
  const set = (x: number, y: number): boolean => {
    if (!free(x, y)) return false;
    data[y * COLS + x] = gidFn(chapter, 'floordetail', pick(rng, tiles));
    used.add(key(x, y));
    return true;
  };

  // Prefer cells hugging borders, solid props/obstacles, or path edges so open lanes stay clean.
  const isNearFeature = (x: number, y: number): boolean => {
    if (x <= BORDER_TILES + 2 || x >= COLS - BORDER_TILES - 3 || y <= BORDER_TILES + 2 || y >= ROWS - BORDER_TILES - 3) {
      return true;
    }
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const k = key(x + dx, y + dy);
        if (solidReserved.has(k) || pathCells.has(k)) return true;
      }
    }
    return false;
  };

  // Seed one small 3–5 tile tuft cluster per 16×9 sector, anchored near features where possible.
  const target = Math.max(Math.round(detailDensity * COLS * ROWS), 110);
  let placedCount = 0;

  const plantClusterAt = (ax: number, ay: number, size: number): void => {
    const spread = chapter === 4 ? 5 : 3;
    const offset = chapter === 4 ? 2 : 1;
    const count = chapter === 4 ? Math.min(2, size) : size;
    for (let s = 0; s < count; s += 1) {
      const tx = ax + int(rng, spread) - offset;
      const ty = ay + int(rng, spread) - offset;
      if (set(tx, ty)) placedCount += 1;
    }
  };

  for (let by = 0; by < ROWS / 9; by += 1) {
    for (let bx = 0; bx < COLS / 16; bx += 1) {
      let seeded = false;
      for (let attempt = 0; attempt < 48; attempt += 1) {
        const x = bx * 16 + int(rng, 16);
        const y = by * 9 + int(rng, 9);
        if (attempt < 32 && !isNearFeature(x, y)) continue;
        if (set(x, y)) {
          placedCount += 1;
          plantClusterAt(x, y, 4);
          seeded = true;
          break;
        }
      }
      if (!seeded) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          const x = bx * 16 + int(rng, 16);
          const y = by * 9 + int(rng, 9);
          if (set(x, y)) {
            placedCount += 1;
            break;
          }
        }
      }
    }
  }

  // Fill remaining target density with small clusters near borders, trees, ruins, cliffs, and paths.
  for (let attempt = 0; attempt < target * 16 && placedCount < target; attempt += 1) {
    const ax = BORDER_TILES + int(rng, COLS - 2 * BORDER_TILES);
    const ay = BORDER_TILES + int(rng, ROWS - 2 * BORDER_TILES);
    if (!isNearFeature(ax, ay)) continue;
    plantClusterAt(ax, ay, 3 + int(rng, 3));
  }

  return data;
}
