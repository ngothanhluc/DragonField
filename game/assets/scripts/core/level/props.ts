/**
 * Prop catalogue (M9, ticket #35): what a room may place, how it is drawn, and what part of it
 * blocks. "What looks solid is solid": a solid prop's collider becomes an obstacle at parse time.
 *
 * A prop is a **whole drawing** sliced out of a pack sheet (`rect`), never a stamp of single
 * tiles: a 32×32 tree, a 64×48 house front, a 64×48 tree cluster. The room places it once, at a
 * tile anchor, and `core/level/tmx.ts` turns `collider` into an `Obstacle` of kind `prop`
 * (see `LevelData.props`). So collision (#33), bullets and navigation read the same
 * `obstacles` array as before — no prop-specific movement code.
 *
 * `collider` is the **base** of the drawing, in pixels relative to `rect`'s top-left:
 * - a tree blocks at its trunk (narrow, so you can walk under the canopy),
 * - a house at its ground-floor walls, the roof above it goes to `overlay`,
 * - a rock/stump/crate at the part that touches the ground.
 * Tall grass, bushes and flowers are `solid: false` (`collider: null`) and walk-over.
 *
 * `overlay` (canopy/roof) and `cover` are read by #36 (depth sorting, fade, walk-in grass);
 * this ticket only fills them in, nothing renders differently yet.
 */
import type { TileRect } from './obstacle-visuals';
import { TILE_SIZE_PX, type Obstacle, type PlacedProp } from './level-data';

/** What a prop is, for collider rules and later depth/cover rules (#36). */
export type PropKind =
  | 'tree'
  | 'rock'
  | 'house'
  | 'stump'
  | 'structure'
  | 'bush'
  | 'grass'
  | 'flower'
  | 'decor';

export interface PropDef {
  /** Unique within its chapter, e.g. `tree-green`. Referenced by `.tmx` `prop` objects. */
  readonly key: string;
  readonly kind: PropKind;
  /** Resource path of the sheet, like `resources/art/tilesets/TilesetNature.png`. */
  readonly sheet: string;
  /** Sprite cell in the sheet, pixels, top-left origin. */
  readonly rect: TileRect;
  /** `true` = blocks walkers and bullets through its collider. */
  readonly solid: boolean;
  /**
   * The blocking part, pixels **relative to `rect`'s top-left**; `null` when not solid.
   * A tree blocks only at its trunk, a house at its ground-floor walls, a rock at its base.
   */
  readonly collider: TileRect | null;
  /** Part drawn above actors and faded when someone is under it (tree canopy, roof) — used by #36. */
  readonly overlay?: TileRect;
  /** Walk-in cover (tall grass, bushes) — used by #36. */
  readonly cover?: boolean;
}

const NATURE = 'resources/art/tilesets/TilesetNature.png';
const ELEMENT = 'resources/art/tilesets/TilesetElement.png';
const HOUSE = 'resources/art/tilesets/TilesetHouse.png';
const VILLAGE = 'resources/art/tilesets/TilesetVillageAbandoned.png';
const TOWERS = 'resources/art/tilesets/TilesetTowers.png';
const CAMP = 'resources/art/tilesets/tileset_camp.png';
const DESERT = 'resources/art/tilesets/TilesetDesert.png';
const PROPS = 'resources/art/props/';

/** Trunk of a 32×32 tree: 1 tile wide, half a tile deep, so the canopy is walk-under. */
const TRUNK = { x: 8, y: 24, width: 16, height: 8 } as const;
/** Trunk of the narrower round tree (its base is 13 px wide in the sheet). */
const TRUNK_ROUND = { x: 9, y: 24, width: 14, height: 8 } as const;
/** Trunk of a 48×48 tree: still 1 tile wide, the extra depth is the root flare. */
const TRUNK_BIG = { x: 16, y: 36, width: 16, height: 12 } as const;
/** Trunk of the small round tree (96,128): shorter, the whole drawing is 32×32. */
const TRUNK_SMALL = { x: 10, y: 22, width: 12, height: 10 } as const;
/** Root strip under a 64×48 tree cluster (three trunks side by side). */
const CLUSTER_BASE = { x: 4, y: 34, width: 56, height: 14 } as const;
/** Walls of a 64×48 house front: the bottom 2 tiles, the roof above is `overlay`. */
const HOUSE_WALLS = { x: 2, y: 30, width: 60, height: 18 } as const;
/** Walls of a 48-wide house front. */
const HOUSE_WALLS_NARROW = { x: 2, y: 30, width: 44, height: 18 } as const;

/** The part of the drawing above the blocking base (canopy, roof) — #36 fades it. */
function above(rect: TileRect, collider: TileRect): TileRect {
  return { x: 0, y: 0, width: rect.width, height: collider.y };
}

interface PropShape {
  readonly kind: PropKind;
  readonly sheet: string;
  readonly rect: TileRect;
  readonly collider: TileRect | null;
  readonly cover?: boolean;
}

/** A solid prop whose collider becomes an obstacle; `overlay` is everything above that base. */
function solid(key: string, shape: PropShape): PropDef {
  const collider = shape.collider;
  if (collider === null) throw new Error(`props: solid prop ${key} has no collider`);
  return {
    key,
    kind: shape.kind,
    sheet: shape.sheet,
    rect: shape.rect,
    solid: true,
    collider,
    // Rocks/stumps/crates have no canopy: only trees and roofs get an overlay.
    ...(shape.kind === 'tree' || shape.kind === 'house' ? { overlay: above(shape.rect, collider) } : {}),
  };
}

/** A walk-over prop: drawn, never an obstacle (grass, flowers, bushes). */
function walkOver(key: string, shape: PropShape): PropDef {
  return {
    key,
    kind: shape.kind,
    sheet: shape.sheet,
    rect: shape.rect,
    solid: false,
    collider: null,
    ...(shape.cover === true ? { cover: true } : {}),
  };
}

function tree(key: string, sheet: string, rect: TileRect, collider: TileRect): PropDef {
  return solid(key, { kind: 'tree', sheet, rect, collider });
}

function house(key: string, sheet: string, rect: TileRect, collider: TileRect): PropDef {
  return solid(key, { kind: 'house', sheet, rect, collider });
}

/** Nature props every chapter can use (grass, trees, rocks). */
const NATURE_PROPS: readonly PropDef[] = [
  tree('tree-green', NATURE, { x: 0, y: 0, width: 32, height: 32 }, TRUNK),
  tree('tree-pine', NATURE, { x: 32, y: 0, width: 32, height: 32 }, TRUNK),
  tree('tree-dead', NATURE, { x: 64, y: 0, width: 32, height: 32 }, TRUNK),
  tree('tree-pink', NATURE, { x: 224, y: 0, width: 32, height: 32 }, TRUNK),
  tree('tree-round', NATURE, { x: 256, y: 0, width: 32, height: 32 }, TRUNK_ROUND),
  tree('tree-big-green', NATURE, { x: 48, y: 288, width: 48, height: 48 }, TRUNK_BIG),
  tree('tree-big-orange', NATURE, { x: 144, y: 288, width: 48, height: 48 }, TRUNK_BIG),
  tree('tree-small', NATURE, { x: 96, y: 128, width: 32, height: 32 }, TRUNK_SMALL),
  solid('tree-cluster-pines', {
    kind: 'structure',
    sheet: NATURE,
    rect: { x: 0, y: 32, width: 64, height: 48 },
    collider: CLUSTER_BASE,
  }),
  solid('tree-cluster-green', {
    kind: 'structure',
    sheet: NATURE,
    rect: { x: 64, y: 32, width: 64, height: 48 },
    collider: CLUSTER_BASE,
  }),
  solid('rock-boulder', {
    kind: 'rock',
    sheet: NATURE,
    rect: { x: 208, y: 128, width: 32, height: 32 },
    collider: { x: 2, y: 18, width: 28, height: 13 },
  }),
  solid('rock-boulder-gray', {
    kind: 'rock',
    sheet: NATURE,
    rect: { x: 256, y: 128, width: 32, height: 32 },
    collider: { x: 2, y: 18, width: 28, height: 13 },
  }),
  solid('rock-small', {
    kind: 'rock',
    sheet: NATURE,
    rect: { x: 240, y: 144, width: 16, height: 16 },
    collider: { x: 0, y: 8, width: 16, height: 8 },
  }),
  solid('rock-small-gray', {
    kind: 'rock',
    sheet: NATURE,
    rect: { x: 288, y: 144, width: 16, height: 16 },
    collider: { x: 0, y: 8, width: 16, height: 8 },
  }),
  solid('rock-cluster', {
    kind: 'rock',
    sheet: NATURE,
    rect: { x: 192, y: 80, width: 64, height: 48 },
    collider: { x: 0, y: 36, width: 60, height: 10 },
  }),
  solid('rock-cluster-gray', {
    kind: 'rock',
    sheet: NATURE,
    rect: { x: 256, y: 80, width: 64, height: 48 },
    collider: { x: 0, y: 36, width: 60, height: 10 },
  }),
  solid('rock-sandstone-mound', {
    kind: 'rock',
    sheet: NATURE,
    rect: { x: 272, y: 160, width: 64, height: 48 },
    collider: { x: 4, y: 32, width: 56, height: 15 },
  }),
  solid('rock-sandstone', {
    kind: 'rock',
    sheet: NATURE,
    rect: { x: 240, y: 160, width: 32, height: 32 },
    collider: { x: 2, y: 18, width: 28, height: 13 },
  }),
  solid('rock-sandstone-small', {
    kind: 'rock',
    sheet: NATURE,
    rect: { x: 272, y: 208, width: 16, height: 16 },
    collider: { x: 0, y: 8, width: 16, height: 8 },
  }),
  solid('stump-big', {
    kind: 'stump',
    sheet: NATURE,
    rect: { x: 0, y: 128, width: 32, height: 32 },
    collider: { x: 3, y: 14, width: 26, height: 14 },
  }),
  solid('stump', {
    kind: 'stump',
    sheet: NATURE,
    rect: { x: 64, y: 128, width: 16, height: 16 },
    collider: { x: 1, y: 8, width: 14, height: 8 },
  }),
  solid('bush-blue', {
    kind: 'bush',
    sheet: NATURE,
    rect: { x: 0, y: 192, width: 32, height: 32 },
    collider: { x: 2, y: 20, width: 28, height: 12 },
  }),
  walkOver('bush-light', { kind: 'bush', sheet: NATURE, rect: { x: 0, y: 160, width: 16, height: 16 }, collider: null }),
  walkOver('bush-green', { kind: 'bush', sheet: NATURE, rect: { x: 16, y: 160, width: 16, height: 16 }, collider: null }),
  walkOver('bush-dark', { kind: 'bush', sheet: NATURE, rect: { x: 32, y: 160, width: 16, height: 16 }, collider: null }),
  walkOver('grass-tall', {
    kind: 'grass',
    sheet: NATURE,
    rect: { x: 48, y: 160, width: 16, height: 16 },
    collider: null,
    cover: true,
  }),
  walkOver('flower-sun', { kind: 'flower', sheet: NATURE, rect: { x: 0, y: 176, width: 16, height: 16 }, collider: null }),
  walkOver('flower-yellow', { kind: 'flower', sheet: NATURE, rect: { x: 16, y: 176, width: 16, height: 16 }, collider: null }),
  walkOver('flower-clover', { kind: 'flower', sheet: NATURE, rect: { x: 32, y: 176, width: 16, height: 16 }, collider: null }),
  walkOver('flower-red', { kind: 'flower', sheet: NATURE, rect: { x: 48, y: 176, width: 16, height: 16 }, collider: null }),
];

/** Element-sheet furniture: a crate, a cart and a totem pole. */const ELEMENT_PROPS: readonly PropDef[] = [
  solid('crate', {
    kind: 'structure',
    sheet: ELEMENT,
    rect: { x: 112, y: 0, width: 16, height: 16 },
    collider: { x: 0, y: 8, width: 16, height: 8 },
  }),
  solid('cart', {
    kind: 'structure',
    sheet: ELEMENT,
    rect: { x: 0, y: 48, width: 32, height: 32 },
    collider: { x: 2, y: 18, width: 28, height: 12 },
  }),
  solid('totem', {
    kind: 'structure',
    sheet: ELEMENT,
    rect: { x: 0, y: 80, width: 16, height: 32 },
    collider: { x: 1, y: 24, width: 14, height: 8 },
  }),
];

/** Complete house fronts (64×48) and two huts — a village needs a house. */
const HOUSE_PROPS: readonly PropDef[] = [
  house('house-orange', HOUSE, { x: 0, y: 0, width: 64, height: 48 }, HOUSE_WALLS),
  house('house-beige', HOUSE, { x: 64, y: 0, width: 64, height: 48 }, HOUSE_WALLS),
  house('house-red', HOUSE, { x: 192, y: 0, width: 64, height: 48 }, HOUSE_WALLS),
  house('house-green', HOUSE, { x: 304, y: 0, width: 64, height: 48 }, HOUSE_WALLS),
  house('hut', HOUSE, { x: 0, y: 120, width: 48, height: 40 }, { x: 2, y: 26, width: 44, height: 14 }),
  house('hut-small', HOUSE, { x: 48, y: 128, width: 48, height: 32 }, { x: 2, y: 18, width: 44, height: 14 }),
];

/**
 * Village fences (#67 review): a three-panel run and a single post from `TilesetHouse`, so a
 * village has a street instead of loose crates. Solid at the rails (the bottom 8 px), the same
 * rule as every other "looks solid is solid" prop.
 */
const FENCE_PROPS: readonly PropDef[] = [
  solid('fence', {
    kind: 'structure',
    sheet: HOUSE,
    rect: { x: 160, y: 80, width: 48, height: 16 },
    collider: { x: 0, y: 8, width: 48, height: 8 },
  }),
  solid('fence-post', {
    kind: 'structure',
    sheet: HOUSE,
    rect: { x: 160, y: 64, width: 16, height: 16 },
    collider: { x: 0, y: 8, width: 16, height: 8 },
  }),
];

/** Camp furniture a village can use outside the desert too: a well and a signpost. */
const VILLAGE_EXTRA_PROPS: readonly PropDef[] = [
  solid('camp-well', {
    kind: 'structure',
    sheet: CAMP,
    rect: { x: 20, y: 80, width: 28, height: 26 },
    collider: { x: 2, y: 12, width: 24, height: 12 },
  }),
  solid('camp-signpost', {
    kind: 'structure',
    sheet: CAMP,
    rect: { x: 96, y: 81, width: 16, height: 30 },
    collider: { x: 5, y: 22, width: 6, height: 8 },
  }),
];

/** Camp corner: a tent and a log pile. */
const CAMP_PROPS: readonly PropDef[] = [
  solid('tent', {
    kind: 'structure',
    sheet: CAMP,
    rect: { x: 64, y: 0, width: 48, height: 48 },
    collider: { x: 2, y: 30, width: 44, height: 18 },
  }),
  solid('logs', {
    kind: 'structure',
    sheet: CAMP,
    rect: { x: 0, y: 0, width: 32, height: 16 },
    collider: { x: 0, y: 6, width: 32, height: 10 },
  }),
];

/** Abandoned-village ruins: broken houses, watchtowers, crumbling stone walls, pillars and statues. */
const VILLAGE_PROPS: readonly PropDef[] = [
  house('house-ruined', VILLAGE, { x: 0, y: 0, width: 64, height: 48 }, HOUSE_WALLS),
  house('ruined-house-orange', VILLAGE, { x: 64, y: 0, width: 64, height: 48 }, HOUSE_WALLS),
  house('house-mossy', VILLAGE, { x: 176, y: 0, width: 48, height: 48 }, HOUSE_WALLS_NARROW),
  house('house-mossy-alt', VILLAGE, { x: 176, y: 48, width: 48, height: 48 }, HOUSE_WALLS_NARROW),
  house('watchtower-ruined', VILLAGE, { x: 224, y: 0, width: 48, height: 80 }, { x: 2, y: 56, width: 44, height: 24 }),
  house('ruined-shelter', VILLAGE, { x: 272, y: 0, width: 48, height: 46 }, { x: 2, y: 30, width: 44, height: 16 }),
  house('house-timber', VILLAGE, { x: 192, y: 96, width: 64, height: 96 }, { x: 2, y: 64, width: 60, height: 32 }),
  house('house-timber-large', VILLAGE, { x: 256, y: 80, width: 64, height: 80 }, { x: 2, y: 64, width: 60, height: 16 }),
  tree('tree-mossy', VILLAGE, { x: 64, y: 96, width: 32, height: 32 }, TRUNK_ROUND),
  tree('tree-mossy-alt', VILLAGE, { x: 64, y: 144, width: 32, height: 32 }, TRUNK_ROUND),
  solid('tree-mossy-cluster', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 0, y: 96, width: 64, height: 48 },
    collider: { x: 6, y: 34, width: 52, height: 14 },
  }),
  solid('tree-mossy-cluster-alt', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 0, y: 144, width: 64, height: 48 },
    collider: { x: 6, y: 34, width: 52, height: 14 },
  }),
  solid('ruined-wall-cross', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 128, y: 8, width: 48, height: 40 },
    collider: { x: 2, y: 24, width: 44, height: 16 },
  }),
  solid('broken-wall-arch', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 272, y: 48, width: 48, height: 32 },
    collider: { x: 2, y: 18, width: 44, height: 14 },
  }),
  solid('low-broken-wall', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 224, y: 80, width: 32, height: 16 },
    collider: { x: 0, y: 6, width: 32, height: 10 },
  }),
  solid('palisade-ruined', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 144, y: 144, width: 48, height: 32 },
    collider: { x: 2, y: 18, width: 44, height: 14 },
  }),
  solid('ruined-statue-tall', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 0, y: 48, width: 32, height: 48 },
    collider: { x: 2, y: 32, width: 28, height: 16 },
  }),
  solid('pillar-broken', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 32, y: 54, width: 16, height: 42 },
    collider: { x: 1, y: 28, width: 14, height: 14 },
  }),
  solid('pillar-stump', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 48, y: 58, width: 16, height: 22 },
    collider: { x: 1, y: 10, width: 14, height: 12 },
  }),
  solid('big-pillar-ruined', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 112, y: 129, width: 32, height: 63 },
    collider: { x: 2, y: 45, width: 28, height: 18 },
  }),
  solid('cart-ruined', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 147, y: 114, width: 27, height: 27 },
    collider: { x: 2, y: 14, width: 23, height: 12 },
  }),
  solid('barrel-mossy', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 64, y: 58, width: 16, height: 22 },
    collider: { x: 1, y: 10, width: 14, height: 12 },
  }),
  solid('barrel-open-mossy', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 80, y: 60, width: 16, height: 20 },
    collider: { x: 1, y: 8, width: 14, height: 11 },
  }),
  solid('stump-mossy', {
    kind: 'stump',
    sheet: VILLAGE,
    rect: { x: 112, y: 112, width: 16, height: 16 },
    collider: { x: 1, y: 8, width: 14, height: 8 },
  }),
  solid('frog-statue', {
    kind: 'structure',
    sheet: VILLAGE,
    rect: { x: 144, y: 80, width: 32, height: 32 },
    collider: { x: 2, y: 22, width: 28, height: 10 },
  }),
  solid('moss-tower-ruined', {
    kind: 'structure',
    sheet: TOWERS,
    rect: { x: 66, y: 32, width: 26, height: 32 },
    collider: { x: 2, y: 18, width: 22, height: 14 },
  }),
  solid('stone-tower-ruined', {
    kind: 'structure',
    sheet: TOWERS,
    rect: { x: 260, y: 0, width: 26, height: 32 },
    collider: { x: 2, y: 18, width: 22, height: 14 },
  }),
];

/** River props staged byte-for-byte from `Backgrounds/Vehicles/` (ch2). */
const RIVER_PROPS: readonly PropDef[] = [
  solid('boat', {
    kind: 'structure',
    sheet: `${PROPS}Boat.png`,
    rect: { x: 0, y: 0, width: 80, height: 32 },
    collider: { x: 4, y: 10, width: 72, height: 20 },
  }),
  walkOver('fishnet', { kind: 'decor', sheet: `${PROPS}FishNet.png`, rect: { x: 0, y: 0, width: 33, height: 25 }, collider: null }),
];

/** Grass/bushes/flowers shared by every chapter (the walk-over floor of the catalogue). */
const WALK_OVER_NATURE = NATURE_PROPS.filter((def) => !def.solid);

/**
 * Desert village (`TilesetDesert`, ch4): two adobe houses, palm clusters, a skull and small
 * bones/shells scattered on the sand. The palms block only at the middle trunk, so the fronds
 * are walk-under (the same rule as the nature trees).
 */
const DESERT_PROPS: readonly PropDef[] = [
  house('desert-house', DESERT, { x: 96, y: 0, width: 56, height: 60 }, { x: 2, y: 44, width: 52, height: 14 }),
  house('desert-dome', DESERT, { x: 0, y: 0, width: 48, height: 48 }, { x: 2, y: 32, width: 44, height: 16 }),
  house('desert-tower', DESERT, { x: 49, y: 0, width: 46, height: 80 }, { x: 4, y: 64, width: 38, height: 14 }),
  house('desert-wall-tower', DESERT, { x: 224, y: 64, width: 48, height: 80 }, { x: 2, y: 58, width: 44, height: 22 }),
  tree('palm-cluster', DESERT, { x: 160, y: 64, width: 64, height: 42 }, { x: 26, y: 30, width: 12, height: 10 }),
  tree('palm-cluster-dusty', DESERT, { x: 160, y: 110, width: 64, height: 42 }, { x: 26, y: 30, width: 12, height: 10 }),
  tree('palm-single', DESERT, { x: 160, y: 160, width: 32, height: 32 }, { x: 10, y: 21, width: 12, height: 10 }),
  tree('palm-single-alt', DESERT, { x: 192, y: 160, width: 32, height: 32 }, { x: 10, y: 21, width: 12, height: 10 }),
  solid('desert-wall-segment', {
    kind: 'structure',
    sheet: DESERT,
    rect: { x: 272, y: 64, width: 48, height: 48 },
    collider: { x: 0, y: 32, width: 48, height: 16 },
  }),
  solid('desert-stall-red', {
    kind: 'structure',
    sheet: DESERT,
    rect: { x: 32, y: 160, width: 32, height: 31 },
    collider: { x: 2, y: 19, width: 28, height: 12 },
  }),
  solid('desert-stall-yellow', {
    kind: 'structure',
    sheet: DESERT,
    rect: { x: 64, y: 160, width: 32, height: 31 },
    collider: { x: 2, y: 19, width: 28, height: 12 },
  }),
  solid('desert-fountain', {
    kind: 'structure',
    sheet: DESERT,
    rect: { x: 128, y: 112, width: 32, height: 32 },
    collider: { x: 2, y: 16, width: 28, height: 16 },
  }),
  solid('desert-well', {
    kind: 'structure',
    sheet: DESERT,
    rect: { x: 0, y: 48, width: 32, height: 32 },
    collider: { x: 3, y: 16, width: 26, height: 15 },
  }),
  solid('desert-tree-scrub', {
    kind: 'structure',
    sheet: DESERT,
    rect: { x: 128, y: 160, width: 32, height: 31 },
    collider: { x: 6, y: 20, width: 20, height: 11 },
  }),
  solid('desert-skull', {
    kind: 'structure',
    sheet: DESERT,
    rect: { x: 256, y: 176, width: 16, height: 16 },
    collider: { x: 1, y: 10, width: 14, height: 6 },
  }),
  walkOver('desert-agave', {
    kind: 'bush',
    sheet: DESERT,
    rect: { x: 144, y: 144, width: 16, height: 16 },
    collider: null,
  }),
  walkOver('desert-bush-dry', {
    kind: 'bush',
    sheet: DESERT,
    rect: { x: 128, y: 144, width: 16, height: 15 },
    collider: null,
  }),
  walkOver('desert-fish-bones', {
    kind: 'decor',
    sheet: DESERT,
    rect: { x: 272, y: 176, width: 16, height: 16 },
    collider: null,
  }),
  walkOver('desert-shell', {
    kind: 'decor',
    sheet: DESERT,
    rect: { x: 288, y: 176, width: 16, height: 16 },
    collider: null,
  }),
  walkOver('desert-potted-palm', {
    kind: 'decor',
    sheet: DESERT,
    rect: { x: 224, y: 160, width: 16, height: 16 },
    collider: null,
  }),
];

/**
 * Desert camp (`tileset_camp`, ch4): tents count as `house` (the brief's house rule), plus the
 * camp furniture — a well, a table, a bench, a signpost, a barrel and the log pile.
 */
const DESERT_CAMP_PROPS: readonly PropDef[] = [
  house('camp-tent', CAMP, { x: 64, y: 0, width: 48, height: 48 }, { x: 2, y: 30, width: 44, height: 18 }),
  house('camp-tent-open', CAMP, { x: 112, y: 0, width: 48, height: 48 }, { x: 2, y: 30, width: 44, height: 18 }),
  solid('camp-well', {
    kind: 'structure',
    sheet: CAMP,
    rect: { x: 20, y: 80, width: 28, height: 26 },
    collider: { x: 2, y: 12, width: 24, height: 12 },
  }),
  solid('camp-table', {
    kind: 'structure',
    sheet: CAMP,
    rect: { x: 128, y: 64, width: 32, height: 16 },
    collider: { x: 2, y: 10, width: 28, height: 6 },
  }),
  solid('camp-bench', {
    kind: 'structure',
    sheet: CAMP,
    rect: { x: 2, y: 112, width: 44, height: 16 },
    collider: { x: 0, y: 8, width: 44, height: 8 },
  }),
  solid('camp-signpost', {
    kind: 'structure',
    sheet: CAMP,
    rect: { x: 96, y: 81, width: 16, height: 30 },
    collider: { x: 5, y: 22, width: 6, height: 8 },
  }),
  solid('camp-barrel', {
    kind: 'structure',
    sheet: CAMP,
    rect: { x: 64, y: 98, width: 32, height: 31 },
    collider: { x: 2, y: 17, width: 28, height: 12 },
  }),
];

/** Catalogue per chapter number. Keys are unique within a chapter. */
export const PROP_CATALOGUE: Readonly<Record<number, readonly PropDef[]>> = {
  1: [
    ...NATURE_PROPS,
    ...ELEMENT_PROPS,
    ...HOUSE_PROPS,
    ...CAMP_PROPS,
    ...FENCE_PROPS,
    ...VILLAGE_EXTRA_PROPS,
  ],
  2: [
    ...NATURE_PROPS,
    ...ELEMENT_PROPS,
    ...HOUSE_PROPS.filter((def) => def.key !== 'hut' && def.key !== 'hut-small'),
    ...RIVER_PROPS,
    ...FENCE_PROPS,
  ],
  3: [
    ...NATURE_PROPS,
    ...ELEMENT_PROPS,
    ...HOUSE_PROPS,
    ...VILLAGE_PROPS,
    ...FENCE_PROPS,
    ...VILLAGE_EXTRA_PROPS,
  ],
  // Chapter 4 — desert: the M9 desert village tileset + camp, with the shared nature walk-overs.
  4: [
    ...NATURE_PROPS,
    ...ELEMENT_PROPS,
    ...CAMP_PROPS,
    ...DESERT_PROPS,
    ...DESERT_CAMP_PROPS,
  ],
};

/** Every walk-over key of a chapter, in catalogue order. */
export const WALK_OVER_KEYS: readonly string[] = WALK_OVER_NATURE.map((def) => def.key);

export function propDef(chapter: number, key: string): PropDef | undefined {
  return PROP_CATALOGUE[chapter]?.find((def) => def.key === key);
}

/** Every sheet a chapter's props draw from — preloaded with the obstacle sheets. */
export function propSheets(chapter: number): string[] {
  return Array.from(new Set((PROP_CATALOGUE[chapter] ?? []).map((def) => def.sheet)));
}

/**
 * The obstacle a placed prop contributes: its collider moved to the prop's position, in tiles.
 * `null` for a walk-over prop. This is the **only** place the conversion happens, so the
 * `.tmx` parse, the dress script's reachability check and the catalogue agree by construction.
 */
export function propCollider(prop: PlacedProp, def: PropDef): Obstacle | null {
  const collider = def.collider;
  if (collider === null) return null;
  return {
    kind: 'prop',
    x: prop.x + collider.x / TILE_SIZE_PX,
    y: prop.y + collider.y / TILE_SIZE_PX,
    width: collider.width / TILE_SIZE_PX,
    height: collider.height / TILE_SIZE_PX,
  };
}
