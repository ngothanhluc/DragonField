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
 * `TiledMap` draws the tile layer in **pixels** (512×288 px map, bottom-left origin, row 0
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
  UITransform as CocosUITransform,
  Vec2 as EngineVec2,
} from 'cc';
import type { TiledMapAsset as CocosTiledMapAsset } from 'cc';
import type { LevelData, Obstacle } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
import {
  obstacleSheets,
  obstacleVisual,
  type TileRect,
} from '../core/level/obstacle-visuals';
import type { Vec2 } from '../core/math/vec2';
import { loadTexture } from './assets/texture-cache';

// Kept re-exported for the UI modules that slice their own frames with `TileRect`
// and for `bootstrap`'s preload list; the definitions now live in core.
export { obstacleSheets };
export type { TileRect };

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

const OBSTACLE_KEYS = ['pillar', 'pillarSmall', 'wall', 'pit'] as const;

// ---------------------------------------------------------------------------
// Coordinate systems
// ---------------------------------------------------------------------------

/**
 * Point in `LevelData` (tiles, top-left origin, y down) → world (units, bottom-left origin, y up).
 * `worldX = x`, `worldY = 18 - y` — exactly the world convention formula.
 */
export function tileToWorld(point: Vec2): Vec2 {
  return { x: point.x, y: ROOM_ROWS - point.y };
}

/** World rectangle of an obstacle: bottom-left corner + size, both in units. */
function obstacleWorldRect(obstacle: Obstacle): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  return {
    x: obstacle.x,
    y: ROOM_ROWS - obstacle.y - obstacle.height,
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
 * The root stays in **world units** (1 tile = 1 unit) like every actor/bullet; only the child
 * `tile-map` node is scaled `1/16` (`ACTOR_SCALE`) so TMX pixels match world units. Obstacles
 * therefore reuse the milestone's unit coordinates instead of switching to pixels.
 *
 * Culling is off because a room is only 576 tiles and the world camera is letterboxed
 * (`Camera.rect`), a case where culling easily clips the wrong things.
 *
 * Obstacles: 1×1 unit sprites as before, with rectangles from the object layer (already parsed
 * into `LevelData.obstacles`) — there is no second pipeline.
 */
export function buildRoom(
  parent: Node,
  level: LevelData,
  tmxAsset: TiledMapAsset,
): Node {
  const root = new CocosNode(`room-${level.id}`);
  root.parent = parent;

  const mapNode = new CocosNode('tile-map');
  mapNode.parent = root;

  // TiledMap's `@requireComponent(UITransform)` adds UITransform as soon as addComponent runs.
  const map: TiledMap = mapNode.addComponent(CocosTiledMap);

  const transform: UITransform | null = mapNode.getComponent(CocosUITransform);
  if (transform !== null) transform.setAnchorPoint(0.5, 0.5);

  const scale = TILE_WORLD_UNITS / TILE_SIZE_PX;
  mapNode.setScale(scale, scale, 1);
  // Map centre = room centre: 512×288 px map × 1/16 = 32×18 units.
  mapNode.setPosition(ROOM_COLS / 2, ROOM_ROWS / 2, 0);

  // Assign the asset AFTER the node has its anchor/scale/parent: `_buildLayerAndGroup`
  // creates the layers under this node and reads the map anchor once.
  map.tmxAsset = tmxAsset;
  map.enableCulling = false;

  void buildObstacles(root, level).catch((error: unknown) => {
    reportLoadFailure('obstacles', `chapter ${level.chapter}`, error);
  });

  return root;
}

/** Obstacles: one tiled sprite per `Obstacle`, exactly its tile size. */
async function buildObstacles(root: Node, level: LevelData): Promise<void> {
  const sheets = obstacleSheets(level.chapter);
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

  level.obstacles.forEach((obstacle, index) => {
    const small = obstacle.kind === 'pillar' && obstacle.width <= 1 && obstacle.height <= 1;
    const key = small ? 'pillarSmall' : obstacle.kind;
    const visual = frames.get(key);
    if (visual === undefined) return;

    const rect = obstacleWorldRect(obstacle);
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
