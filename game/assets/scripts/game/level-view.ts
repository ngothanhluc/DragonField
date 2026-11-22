/**
 * Build one room: `TiledMap` for the tile layer + sprites for obstacles.
 *
 * Coordinate systems:
 * - `LevelData` is **tile units, top-left origin, y down** (the Tiled system).
 * - The Cocos world is **bottom-left origin, y up**, 1 tile = 1 unit, camera
 *   `orthoHeight = 9` at `(16, 9)`.
 *
 * So every coordinate conversion goes through `tileToWorld` / `tileCenterToWorld` below.
 * Other files (`player-controller`, `enemy-view`, `bullet-view`) reuse these exact
 * functions so the room has **one** axis-flip convention.
 *
 * `TiledMap` draws the tile layer in **pixels** (cols×rows×16 px map, bottom-left origin, row 0
 * at the top). The map node is scaled `1/16` and placed at the room centre, so it matches
 * world units exactly: cell `(col,row)` covers exactly `[col, col+1) × [rows-row-1, rows-row)`.
 *
 * Obstacles are **not** derived from tiles: `LevelData.obstacles` (parsed from the `.tmx`
 * object layer, see `core/level/tmx.ts`) is the only source for both collision and visuals.
 */
import {
  Node as CocosNode,
  Rect,
  Size,
  Sprite as CocosSprite,
  SpriteFrame as CocosSpriteFrame,
  TiledMap as CocosTiledMap,
  TiledMapAsset as CocosTiledMapAsset,
  UITransform as CocosUITransform,
  Vec2 as EngineVec2,
} from 'cc';
import type { LevelData, Obstacle } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
import { splitTmxLayers } from '../core/level/tmx-chunks';
import {
  obstacleSheets as obstacleSheetsCore,
  obstacleVisual,
  type TileRect,
} from '../core/level/obstacle-visuals';
import { propDef, propSheets } from '../core/level/props';
import type { Vec2 } from '../core/math/vec2';
import { propCoverArea, propOverlayArea, type TileArea } from '../core/view/cover';
import { loadTexture } from './assets/texture-cache';

// Kept re-exported for the UI modules that slice their own frames with `TileRect`
// and for `bootstrap`'s preload list; the definitions now live in core.
export type { TileRect };

/**
 * Every sheet a chapter's rooms need preloaded: obstacle art plus the catalogue's prop art
 * (#35). Props are whole drawings from a sheet, so a room with a house pops if the sheet is
 * not preloaded — `bootstrap` and the menu backdrop both go through this list.
 */
export function obstacleSheets(chapter: number): string[] {
  return Array.from(new Set([...obstacleSheetsCore(chapter), ...propSheets(chapter)]));
}

/**
 * `cc` is an any module in this repo (see `types/cc.d.ts`), so import names only work in
 * value position. `InstanceType` keeps the meaning once the project is opened in the editor
 * with real types.
 */
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;
type Texture2D = Awaited<ReturnType<typeof loadTexture>>;
type TiledMap = InstanceType<typeof CocosTiledMap>;
type TiledMapAsset = InstanceType<typeof CocosTiledMapAsset>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** 1 tile = 1 world unit (the milestone's world convention). */
export const TILE_WORLD_UNITS = 1;

/** Name of the tile-map node (one map, or the group holding `tile-chunk-*` nodes). */
export const TILE_MAP_NODE = 'tile-map';
/** Prefix of one 32×18 chunk node under the `tile-map` group (a room bigger than one screen). */
export const TILE_CHUNK_PREFIX = 'tile-chunk-';

const OBSTACLE_KEYS = ['pillar', 'pillarSmall', 'wall', 'pit'] as const;

// ---------------------------------------------------------------------------
// Coordinate systems
// ---------------------------------------------------------------------------

/**
 * Room height in tiles used by `tileToWorld`, set once per room by `buildRoom`. The axis flip is
 * the **room's** height (a 72-tall room flips at 72), but every actor/bullet/FX adapter converts
 * tile → world without carrying a `LevelData`; the game has one live room, so it lives here.
 */
let roomRows = ROOM_ROWS;

/** Point in `LevelData` (tiles, top-left origin, y down) → world (units, bottom-left origin, y up). */
export function tileToWorld(point: Vec2): Vec2 {
  return { x: point.x, y: roomRows - point.y };
}

/** World rectangle of an obstacle: bottom-left corner + size, both in units. */
function obstacleWorldRect(obstacle: Obstacle, rows: number): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  return {
    x: obstacle.x,
    y: rows - obstacle.y - obstacle.height,
    width: obstacle.width,
    height: obstacle.height,
  };
}

/**
 * Node scale for an actor: **1 texture pixel = 1/16 world unit**, i.e. a 16 px frame
 * (monster) = 1 tile, a 32 px frame (player, though the character only fills ~15 px
 * of the frame) = 2 tiles, a 96 px frame (samurai) = 6 tiles.
 *
 * This is a constant, independent of the frame: one texture pixel is always 1/16 unit wide.
 * The `entry` parameter is kept so callers do not change if per-asset scaling appears later.
 *
 * No `node.scale.x` flipping: all 4 actor sheets in the pack have the full D/U/L/R columns
 * (the manifest declares `directions`), so direction is baked into the art. Scale flipping is
 * only needed for a sheet lacking a column — today only `Jump.png` (3 directions), and it is unused.
 */
export const ACTOR_SCALE = 1 / TILE_SIZE_PX;

/**
 * World offset (units) from the hitbox centre down to the sprite's feet. The new anchor puts
 * the frame's **feet** on the node; this offset keeps the visuals roughly where they were
 * (a centre anchor used to place the feet ~0.5 tile below the centre).
 */
export const ACTOR_FEET_OFFSET_TILES = 0.5;
/** Bosses are larger, so their feet sit a bit lower than the centre so the silhouette does not cover the player (core owns this number). */
export { BOSS_FEET_OFFSET_TILES } from '../core/boss/boss-defs';

/**
 * Slice one pixel cell into a standalone `SpriteFrame` pointing at `texture`.
 *
 * `SpriteFrame.rect` counts `y` **from the top** (engine: `_initVertices` flips with
 * `texh - rect.y - height`; `TiledMap.rectForGID` also lays rows out from the top), so
 * pass the rect read from the image as-is, with no extra arithmetic.
 */
export function sliceFrame(texture: Texture2D, rect: TileRect): SpriteFrame {
  const frame = new CocosSpriteFrame();
  // Assign the texture first so rect/originalSize are recomputed correctly.
  frame.texture = texture;
  frame.rect = new Rect(rect.x, rect.y, rect.width, rect.height);
  frame.originalSize = new Size(rect.width, rect.height);
  frame.offset = new EngineVec2(0, 0);
  frame.packable = false;
  return frame;
}

// ---------------------------------------------------------------------------
// Building the room
// ---------------------------------------------------------------------------

/**
 * Build a room from `LevelData` + `TiledMapAsset` and return the **root node** (destroying
 * the room = `root.destroy()`; the engine cleans every child, including TiledMap layers).
 *
 * The root stays in **world units** (1 tile = 1 unit) like every actor/bullet; tile nodes are
 * scaled `1/16` (`ACTOR_SCALE`) so TMX pixels match world units. Obstacles therefore reuse the
 * milestone's unit coordinates instead of switching to pixels.
 *
 * **Room bigger than one screen** (ticket #37, ADR-018): the floor is split into one `TiledMap`
 * node per 32×18 screen (`core/level/tmx-chunks.ts`). A single 128×72 layer was 36 864 vertices,
 * over the 2D batcher's 4096-vertex chunk (`Error 9004`, canvas freezes); one screen is 2304.
 * `world-culler.ts` deactivates off-screen chunks. A one-screen room keeps exactly today's
 * single map node, so chapter 1–3 rooms render byte-identically.
 *
 * Engine `TiledMap.enableCulling` stays off (the world camera is letterboxed via `Camera.rect`,
 * a case where it clips the wrong things); chunk culling is ours.
 *
 * Obstacles: 1×1 unit sprites as before, with rectangles from the object layer (already parsed
 * into `LevelData.obstacles`) — there is no second pipeline.
 */
export function buildRoom(
  parent: Node,
  level: LevelData,
  tmxAsset: TiledMapAsset,
  layers?: RoomLayers,
): Node {
  // Every actor/bullet/FX adapter flips tile → world with this; set it before any node is placed.
  roomRows = level.size.rows;

  const root = new CocosNode(`room-${level.id}`);
  root.parent = parent;

  if (level.size.cols <= ROOM_COLS && level.size.rows <= ROOM_ROWS) {
    buildWholeMap(root, level, tmxAsset);
  } else {
    buildChunkedMap(root, level, tmxAsset);
  }

  // The props container exists before any texture loads, so its depth is fixed: above the tile
  // map (and the water, which inserts itself at index 1 later), below obstacles and actors.
  // With `layers` (the run), prop bases are parented to the actors layer instead and this
  // container stays empty — see `RoomLayers`.
  const props = new CocosNode('props');
  props.parent = root;

  void buildProps(props, level, layers).catch((error: unknown) => {
    reportLoadFailure('props', `chapter ${level.chapter}`, error);
  });
  void buildObstacles(root, level).catch((error: unknown) => {
    reportLoadFailure('obstacles', `chapter ${level.chapter}`, error);
  });

  return root;
}

/**
 * Where the run's prop sprites go (#36). Prop **bases** must be siblings of the actors so the
 * y-sort can interleave them; canopies/roofs and grass tips go to the `overlays` layer, above
 * every actor. Omit this (menu backdrop) and a room keeps the #35 layout: whole props in one
 * container under the room root, no overlay split.
 */
export interface RoomLayers {
  /** Actors layer — prop bases are added here so `DepthView` can sort them with actors. */
  readonly props: Node;
  /** Overlays layer — canopies, roofs and the grass tips drawn over an actor. */
  readonly overlays: Node;
  /** Receives the built props once their sheets are loaded (empty list when there are none). */
  readonly onProps?: (views: readonly PropView[]) => void;
}

/** One placed prop as the run draws it: a base sprite, its overlay, and its grass tips. */
export interface PropView {
  /** Base drawing (below the overlay), parented to the actors layer. */
  readonly base: Node;
  /** Bottom edge of the base in room tiles (y down) — the y-sort key. */
  readonly footY: number;
  /** Canopy/roof sprite on the overlays layer; `null` when the prop has no overlay. */
  readonly overlay: Node | null;
  /** Overlay area in tiles (what fades while a body is under it). */
  readonly overlayArea: TileArea | null;
  /** Walk-in area in tiles (what fades an actor standing in it). */
  readonly coverArea: TileArea | null;
  /** Copy of the grass drawing shown over the actor while it stands inside. */
  readonly tips: Node | null;
}

/** One screen: the single `tile-map` node the game has always built. */
function buildWholeMap(root: Node, level: LevelData, tmxAsset: TiledMapAsset): void {
  const mapNode = new CocosNode(TILE_MAP_NODE);
  mapNode.parent = root;

  // TiledMap's `@requireComponent(UITransform)` adds UITransform as soon as addComponent runs.
  const map: TiledMap = mapNode.addComponent(CocosTiledMap);

  const transform: UITransform | null = mapNode.getComponent(CocosUITransform);
  if (transform !== null) transform.setAnchorPoint(0.5, 0.5);

  const scale = TILE_WORLD_UNITS / TILE_SIZE_PX;
  mapNode.setScale(scale, scale, 1);
  // Map centre = room centre: (cols×rows)×16 px map × 1/16 = cols×rows units.
  mapNode.setPosition(level.size.cols / 2, level.size.rows / 2, 0);

  // Assign the asset AFTER the node has its anchor/scale/parent: `_buildLayerAndGroup`
  // creates the layers under this node and reads the map anchor once.
  map.tmxAsset = tmxAsset;
  map.enableCulling = false;
}

/**
 * Several screens: one `TiledMap` per 32×18 chunk of the same `.tmx`, under a `tile-map` group
 * at the world origin. Each chunk node sits at its world centre (units) and is scaled 1/16, so
 * its local position is also its world position — what `world-culler` needs.
 */
function buildChunkedMap(root: Node, level: LevelData, tmxAsset: TiledMapAsset): void {
  const group = new CocosNode(TILE_MAP_NODE);
  group.parent = root;

  const scale = TILE_WORLD_UNITS / TILE_SIZE_PX;
  const chunks = splitTmxLayers(tmxAsset.tmxXmlStr);

  for (const chunk of chunks) {
    const node = new CocosNode(`${TILE_CHUNK_PREFIX}${chunk.col}-${chunk.row}`);
    node.parent = group;
    node.setScale(scale, scale, 1);
    node.setPosition(
      chunk.col + chunk.cols / 2,
      level.size.rows - chunk.row - chunk.rows / 2,
      0,
    );

    const map: TiledMap = node.addComponent(CocosTiledMap);
    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setAnchorPoint(0.5, 0.5);

    map.tmxAsset = chunkAsset(tmxAsset, chunk.xml);
    map.enableCulling = false;
  }
}

/**
 * A `TiledMapAsset` for one chunk: its own XML, but the source asset's sprite frames and `.tsx`
 * files. Reusing those references (they are the editor's import result) keeps the tilesets
 * resolvable without copying textures; `TiledMap._applyFile` only reads these fields.
 */
function chunkAsset(source: TiledMapAsset, xml: string): TiledMapAsset {
  const asset: TiledMapAsset = new CocosTiledMapAsset();
  asset.tmxXmlStr = xml;
  asset.spriteFrames = source.spriteFrames;
  asset.spriteFrameNames = source.spriteFrameNames;
  asset.spriteFrameSizes = source.spriteFrameSizes;
  asset.tsxFiles = source.tsxFiles;
  asset.tsxFileNames = source.tsxFileNames;
  asset.imageLayerSpriteFrame = source.imageLayerSpriteFrame;
  asset.imageLayerSpriteFrameNames = source.imageLayerSpriteFrameNames;
  return asset;
}

/** Obstacles: one tiled sprite per `Obstacle`, exactly its tile size. */
async function buildObstacles(root: Node, level: LevelData): Promise<void> {
  // A `prop` obstacle is the collider of a prop sprite; drawing it again would show a boulder
  // or crate on top of the tree/house. The prop itself is drawn by `buildProps`.
  // `edge` (#67) is the room's solid border ring: its art is the `border-*` tile layers (a tree
  // line or the sand-cliff band), so a tiled sprite here would bury that art.
  const drawable = level.obstacles.filter((obstacle) => obstacle.kind !== 'prop' && obstacle.kind !== 'edge');
  if (drawable.length === 0) return;

  const sheets = obstacleSheetsCore(level.chapter);
  const textures = await Promise.all(sheets.map((sheet) => loadTexture(sheet)));
  if (!root.isValid) return;

  const textureOf = new Map<string, Awaited<ReturnType<typeof loadTexture>>>();
  sheets.forEach((sheet, index) => {
    const texture = textures[index];
    if (texture !== undefined) textureOf.set(sheet, texture);
  });

  const frames = new Map<string, { frame: SpriteFrame; tile: boolean }>();
  for (const kind of OBSTACLE_KEYS) {
    const visual = obstacleVisual(level.chapter, kind);
    const texture = textureOf.get(visual.sheet);
    if (texture !== undefined) {
      frames.set(kind, { frame: sliceFrame(texture, visual.rect), tile: visual.tile });
    }
  }

  const obstacles = new CocosNode('obstacles');
  obstacles.parent = root;

  drawable.forEach((obstacle, index) => {
    const small = obstacle.kind === 'pillar' && obstacle.width <= 1 && obstacle.height <= 1;
    const key = small ? 'pillarSmall' : obstacle.kind;
    const visual = frames.get(key);
    if (visual === undefined) return;

    const rect = obstacleWorldRect(obstacle, level.size.rows);
    const node = makeObstacleNode(
      `obstacle-${index}-${obstacle.kind}`,
      visual.frame,
      visual.tile,
      rect.width * TILE_SIZE_PX,
      rect.height * TILE_SIZE_PX,
      TILE_WORLD_UNITS / TILE_SIZE_PX,
    );
    node.parent = obstacles;
    node.setPosition(rect.x + rect.width / 2, rect.y + rect.height / 2, 0);
  });
}

/**
 * Props (#35): one sprite per catalogue entry, sliced **whole** from its sheet (a 32×32 tree,
 * a 64×48 house front) — never re-tiled. Nearest filtering comes from the texture cache and the
 * scale is the actor rule (1 texture px = 1/16 unit), so a prop matches the tiles it stands on.
 *
 * #36 splits a prop that has an `overlay` (canopy, roof) into two sprites: the base below the
 * overlay (y-sorted with actors) and the overlay itself (on the overlays layer, faded while
 * someone is under it). Grass (`cover: true`) also gets a copy of the drawing on the overlays
 * layer — hidden until an actor stands in it, then drawn over the actor's legs.
 */
async function buildProps(container: Node, level: LevelData, layers?: RoomLayers): Promise<void> {
  const wanted = level.props.flatMap((prop) => {
    const def = propDef(level.chapter, prop.key);
    return def === undefined ? [] : [{ prop, def }];
  });
  if (wanted.length === 0) return;

  const sheets = Array.from(new Set(wanted.map(({ def }) => def.sheet)));
  const textures = await Promise.all(sheets.map((sheet) => loadTexture(sheet)));
  // `container` lives under the room root: its death is the room's, even when the sprites
  // themselves are parented to the (long-lived) actor/overlay layers.
  if (!container.isValid) return;

  const textureOf = new Map<string, Awaited<ReturnType<typeof loadTexture>>>();
  sheets.forEach((sheet, index) => {
    const texture = textures[index];
    if (texture !== undefined) textureOf.set(sheet, texture);
  });

  const baseParent = layers?.props ?? container;
  const overlayParent = layers?.overlays ?? null;
  const views: PropView[] = [];

  for (const { prop, def } of wanted) {
    const texture = textureOf.get(def.sheet);
    if (texture === undefined) continue;

    // Only the run splits a prop into base + overlay (#36). Without overlay layers (menu
    // backdrop) the whole drawing stays one sprite, exactly like #35.
    // `def.overlay` is **drawing-relative** (0,0 = the cell's top-left, see `above()` in
    // `props.ts`); slicing needs sheet coordinates, so both rects go through `toSheet`.
    const overlayDrawing = overlayParent === null ? null : (def.overlay ?? null);
    const baseDrawing =
      overlayDrawing === null
        ? { x: 0, y: 0, width: def.rect.width, height: def.rect.height }
        : baseBelowDrawing(def.rect, overlayDrawing);
    const baseRect = toSheet(def.rect, baseDrawing);
    const base = makePropNode(`prop-${prop.key}`, sliceFrame(texture, baseRect), baseRect);
    base.parent = baseParent;

    // Bottom edge of the base in room tiles: the prop's top-left plus the base's offset inside
    // the drawing (a sheet cell can sit anywhere in the sheet; only its offset matters here).
    const footY = prop.y + (baseDrawing.y + baseDrawing.height) / TILE_SIZE_PX;
    placePropNode(base, prop, def.rect, baseRect);

    let overlay: Node | null = null;
    let overlayArea: TileArea | null = null;
    if (overlayDrawing !== null && overlayParent !== null) {
      const overlayRect = toSheet(def.rect, overlayDrawing);
      overlay = makePropNode(`prop-${prop.key}-overlay`, sliceFrame(texture, overlayRect), overlayRect);
      overlay.parent = overlayParent;
      placePropNode(overlay, prop, def.rect, overlayRect);
      overlayArea = propOverlayArea(prop, def);
    }

    const coverArea = propCoverArea(prop, def);
    let tips: Node | null = null;
    if (coverArea !== null && overlayParent !== null) {
      tips = makePropNode(`prop-${prop.key}-tips`, sliceFrame(texture, def.rect), def.rect);
      tips.parent = overlayParent;
      placePropNode(tips, prop, def.rect, def.rect);
    }

    views.push({
      base,
      footY,
      overlay,
      overlayArea: overlay === null ? null : overlayArea,
      coverArea,
      tips,
    });
  }

  if (container.isValid) layers?.onProps?.(views);
}

/**
 * The part of a prop **drawing** below its overlay (canopy/roof), all rects drawing-relative.
 * The catalogue always declares the overlay as a full-width strip at the top (`above()` in
 * `props.ts`); anything else keeps the whole drawing so a prop never disappears.
 */
function baseBelowDrawing(cell: TileRect, overlay: TileRect): TileRect {
  const fullWidth = overlay.x <= 0 && overlay.x + overlay.width >= cell.width;
  if (!fullWidth || overlay.y > 0) return { x: 0, y: 0, width: cell.width, height: cell.height };

  const top = overlay.y + overlay.height;
  return { x: 0, y: top, width: cell.width, height: cell.height - top };
}

/** A drawing-relative rect → the sheet rect `sliceFrame` needs. */
function toSheet(cell: TileRect, rect: TileRect): TileRect {
  return { x: cell.x + rect.x, y: cell.y + rect.y, width: rect.width, height: rect.height };
}

/**
 * Place one slice of a prop: `LevelData` is top-left/y-down and the prop's sprite top-left sits
 * at `(prop.x, prop.y)`. `slice` is a rect inside the prop's sheet cell, so only its offset from
 * `cell` moves it (the cell's position in the sheet is irrelevant).
 */
function placePropNode(
  node: Node,
  prop: { readonly x: number; readonly y: number },
  cell: TileRect,
  slice: TileRect,
): void {
  const offsetX = (slice.x - cell.x) / TILE_SIZE_PX;
  const offsetY = (slice.y - cell.y) / TILE_SIZE_PX;
  node.setPosition(
    prop.x + offsetX + slice.width / (2 * TILE_SIZE_PX),
    roomRows - prop.y - offsetY - slice.height / (2 * TILE_SIZE_PX),
    0,
  );
}

/** Prop sprite: `SIMPLE` (the drawing is the frame), content size = the sheet rect in pixels. */
function makePropNode(name: string, frame: SpriteFrame, rect: TileRect): Node {
  const node = new CocosNode(name);

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SIMPLE;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;
  sprite.spriteFrame = frame;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  // `CUSTOM` takes its size from UITransform.contentSize (defaults to 100×100), not the frame:
  // without this line a 32 px tree draws ~3× too big even with the right rect and scale.
  if (transform !== null) transform.setContentSize(rect.width, rect.height);

  node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);
  return node;
}

/**
 * Obstacle node: `TILED` repeats the tile for walls/pits; `SIMPLE` + contentSize for a
 * 32×32 boulder (2×2 tiles) — it does not stretch one 16×16 cell into 4 detached blobs.
 */
function makeObstacleNode(
  name: string,
  frame: SpriteFrame,
  tile: boolean,
  widthPx: number,
  heightPx: number,
  scale: number,
): Node {
  const node = new CocosNode(name);

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = tile ? CocosSprite.Type.TILED : CocosSprite.Type.SIMPLE;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;
  sprite.spriteFrame = frame;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) {
    transform.setContentSize(widthPx, heightPx);
  }

  node.setScale(scale, scale, 1);
  return node;
}


function reportLoadFailure(what: string, sheet: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[YokaiField] Could not build ${what}: sheet "${sheet}". ${message}`);
}
