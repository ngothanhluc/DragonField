/**
 * Dựng một phòng: `TiledMap` cho tile layer + sprite cho vật cản.
 *
 * Hệ toạ độ:
 * - `LevelData` là **tile unit, gốc trên-trái, y hướng xuống** (đúng hệ Tiled).
 * - World của Cocos là **gốc dưới-trái, y hướng lên**, 1 tile = 1 unit, camera
 *   `orthoHeight = 9` tại `(16, 9)`.
 *
 * Nên mọi chỗ chuyển toạ độ đi qua `tileToWorld` / `tileCenterToWorld` ở dưới. Các
 * file khác (`player-controller`, `enemy-view`, `bullet-view`) dùng lại đúng mấy hàm
 * này để cả phòng chỉ có **một** quy ước lật trục.
 *
 * Tile layer do `TiledMap` vẽ trong **pixel** (map 512×288 px, gốc dưới-trái, hàng 0
 * ở trên). Node map được scale `1/16` và đặt ở tâm phòng nên khớp tuyệt đối với world
 * unit: ô `(col,row)` phủ đúng `[col, col+1) × [rows-row-1, rows-row)`.
 *
 * Vật cản **không** được suy ra từ tile: `LevelData.obstacles` (parse từ object layer
 * của `.tmx`, xem `core/level/tmx.ts`) là nguồn duy nhất cho cả va chạm lẫn hình.
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
import type { LevelData, Obstacle, ObstacleKind } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { loadTexture } from './assets/texture-cache';

/**
 * `cc` trong repo là module any (xem `types/cc.d.ts`), nên tên import chỉ dùng được ở vị
 * trí value. `InstanceType` giữ đúng nghĩa khi mở project trong editor có type thật.
 */
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;
type Texture2D = Awaited<ReturnType<typeof loadTexture>>;
type TiledMap = InstanceType<typeof CocosTiledMap>;
type TiledMapAsset = InstanceType<typeof CocosTiledMapAsset>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** 1 tile = 1 world unit (world convention của milestone). */
export const TILE_WORLD_UNITS = 1;

interface ObstacleVisual {
  readonly sheet: string;
  readonly rect: TileRect;
  /** `true` = lặp tile theo rect; `false` = kéo frame (boulder 32×32) đúng 1:1 ở 2×2. */
  readonly tile: boolean;
}

const BOUNDS = {
  boulder: { x: 240, y: 224, width: 32, height: 32 },
  smallRock: { x: 256, y: 192, width: 16, height: 16 },
  natureWall: { x: 272, y: 208, width: 16, height: 16 },
  crate: { x: 112, y: 0, width: 16, height: 16 },
  stone: tileRectFromGid(33, 22),
  stoneAlt: tileRectFromGid(33, 23),
  hole: tileRectFromGid(11, 13),
} as const satisfies Record<string, TileRect>;

const OBSTACLE_VISUALS: Readonly<
  Record<number, Readonly<Record<ObstacleKind | 'pillarSmall', ObstacleVisual>>>
> = {
  1: {
    pillar: { sheet: 'resources/art/tilesets/TilesetNature.png', rect: BOUNDS.boulder, tile: false },
    pillarSmall: { sheet: 'resources/art/tilesets/TilesetElement.png', rect: BOUNDS.crate, tile: true },
    wall: { sheet: 'resources/art/tilesets/TilesetNature.png', rect: BOUNDS.natureWall, tile: true },
    pit: { sheet: 'resources/art/tilesets/TilesetNature.png', rect: BOUNDS.boulder, tile: false },
  },
  2: {
    pillar: { sheet: 'resources/art/tilesets/TilesetNature.png', rect: BOUNDS.boulder, tile: false },
    pillarSmall: { sheet: 'resources/art/tilesets/TilesetElement.png', rect: BOUNDS.crate, tile: true },
    wall: { sheet: 'resources/art/tilesets/TilesetNature.png', rect: BOUNDS.natureWall, tile: true },
    pit: { sheet: 'resources/art/tilesets/TilesetNature.png', rect: BOUNDS.boulder, tile: false },
  },
  3: {
    pillar: { sheet: 'resources/art/tilesets/TilesetNature.png', rect: BOUNDS.boulder, tile: false },
    pillarSmall: { sheet: 'resources/art/tilesets/TilesetElement.png', rect: BOUNDS.crate, tile: true },
    wall: { sheet: 'resources/art/tilesets/TilesetNature.png', rect: BOUNDS.natureWall, tile: true },
    pit: { sheet: 'resources/art/tilesets/TilesetNature.png', rect: BOUNDS.boulder, tile: false },
  },
};


/** Ô pixel của gid (1-based) trong sheet có `columns` cột. */
export function tileRectFromGid(columns: number, gid: number): TileRect {
  const index = Math.max(0, gid - 1);
  return {
    x: (index % columns) * 16,
    y: Math.floor(index / columns) * 16,
    width: 16,
    height: 16,
  };
}

/** Mọi sheet vật cản cần preload cho một chapter. */
export function obstacleSheets(chapter: number): string[] {
  const visuals = OBSTACLE_VISUALS[chapter] ?? OBSTACLE_VISUALS[1]!;
  return Array.from(new Set(Object.values(visuals).map((visual) => visual.sheet)));
}


/** Một ô pixel trong sheet, gốc **trên-trái** (cùng quy ước với `manifest.frameRect`). */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const OBSTACLE_KEYS = ['pillar', 'pillarSmall', 'wall', 'pit'] as const;

// ---------------------------------------------------------------------------
// Hệ toạ độ
// ---------------------------------------------------------------------------

/**
 * Điểm trong `LevelData` (tile, gốc trên-trái, y xuống) → world (unit, gốc dưới-trái, y lên).
 * `worldX = x`, `worldY = 18 - y` — đúng công thức của world convention.
 */
export function tileToWorld(point: Vec2): Vec2 {
  return { x: point.x, y: ROOM_ROWS - point.y };
}

/** Hình chữ nhật world của một vật cản: góc dưới-trái + kích thước, cả hai theo unit. */
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
 * Scale node cho một actor: **1 texture pixel = 1/16 world unit**, tức frame
 * 16 px (monster) = 1 tile, frame 32 px (player, nhưng nhân vật chỉ chiếm ~15 px
 * giữa khung) = 2 tile, frame 96 px (samurai) = 6 tile.
 *
 * Đây là hằng số, không phụ thuộc frame: một texture pixel luôn rộng 1/16 unit.
 * Tham số `entry` giữ lại để nơi gọi không phải đổi nếu sau này có asset scale riêng.
 *
 * Không lật `node.scale.x`: cả 4 sheet actor của pack đều có đủ 4 cột D/U/L/R (manifest
 * khai `directions`), nên hướng đã nằm trong art. Quy ước lật scale chỉ cần khi một sheet
 * thiếu cột — hiện chỉ có `Jump.png` (3 hướng) và nó chưa được dùng.
 */
export const ACTOR_SCALE = 1 / TILE_SIZE_PX;

/**
 * Offset world (unit) từ tâm hitbox xuống chân sprite. Anchor mới đặt **chân**
 * frame vào node; offset này giữ vị trí hình gần như cũ (trước đây anchor giữa
 * frame khiến chân nằm dưới tâm ~0.5 tile).
 */
export const ACTOR_FEET_OFFSET_TILES = 0.5;
/** Boss to hơn nên chân hơi thấp hơn tâm để silhouette không che player. */
export const BOSS_FEET_OFFSET_TILES = 0.75;

/**
 * Cắt một ô pixel thành `SpriteFrame` độc lập trỏ vào `texture`.
 *
 * `SpriteFrame.rect` đếm `y` **từ trên xuống** (engine: `_initVertices` lật bằng
 * `texh - rect.y - height`; `TiledMap.rectForGID` cũng xếp hàng từ trên), nên
 * truyền thẳng rect đọc từ ảnh, không cộng trừ gì thêm.
 */
export function sliceFrame(texture: Texture2D, rect: TileRect): SpriteFrame {
  const frame = new CocosSpriteFrame();
  // Gán texture trước để rect/originalSize được tính lại đúng.
  frame.texture = texture;
  frame.rect = new Rect(rect.x, rect.y, rect.width, rect.height);
  frame.originalSize = new Size(rect.width, rect.height);
  frame.offset = new EngineVec2(0, 0);
  frame.packable = false;
  return frame;
}

// ---------------------------------------------------------------------------
// Dựng phòng
// ---------------------------------------------------------------------------

/**
 * Dựng phòng từ `LevelData` + `TiledMapAsset` và trả về **root node** (huỷ phòng =
 * `root.destroy()`, engine tự dọn hết node con, kể cả layer của TiledMap).
 *
 * Root giữ hệ **world unit** (1 tile = 1 unit) như mọi actor/đạn; node `tile-map` con
 * mới là node bị scale `1/16` (`ACTOR_SCALE`) để TMX pixel khớp world unit. Nhờ vậy
 * vật cản dùng lại đúng toạ độ unit của milestone, không phải đổi sang pixel.
 *
 * Tắt culling vì phòng chỉ 576 tile và camera world bị letterbox (`Camera.rect`), một
 * trường hợp dễ làm culling cắt nhầm.
 *
 * Vật cản: sprite 1×1 unit như trước, hình chữ nhật lấy từ object layer (đã parse
 * thành `LevelData.obstacles`) — không có pipeline thứ hai.
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

  // `@requireComponent(UITransform)` của TiledMap thêm UITransform ngay khi addComponent.
  const map: TiledMap = mapNode.addComponent(CocosTiledMap);

  const transform: UITransform | null = mapNode.getComponent(CocosUITransform);
  if (transform !== null) transform.setAnchorPoint(0.5, 0.5);

  const scale = TILE_WORLD_UNITS / TILE_SIZE_PX;
  mapNode.setScale(scale, scale, 1);
  // Tâm map = tâm phòng: map 512×288 px × 1/16 = 32×18 unit.
  mapNode.setPosition(ROOM_COLS / 2, ROOM_ROWS / 2, 0);

  // Gán asset SAU khi node đã có anchor/scale/parent: `_buildLayerAndGroup` tạo layer
  // dưới node này và đọc anchor của map một lần.
  map.tmxAsset = tmxAsset;
  map.enableCulling = false;

  void buildObstacles(root, level).catch((error: unknown) => {
    reportLoadFailure('vật cản', `chapter ${level.chapter}`, error);
  });

  return root;
}

/** Vật cản: một sprite lặp tile cho mỗi `Obstacle`, đúng kích thước tile của nó. */
async function buildObstacles(root: Node, level: LevelData): Promise<void> {
  const visuals = OBSTACLE_VISUALS[level.chapter] ?? OBSTACLE_VISUALS[1]!;
  const sheets = Array.from(new Set(Object.values(visuals).map((visual) => visual.sheet)));
  const textures = await Promise.all(sheets.map((sheet) => loadTexture(sheet)));
  if (!root.isValid) return;

  const textureOf = new Map<string, Awaited<ReturnType<typeof loadTexture>>>();
  sheets.forEach((sheet, index) => {
    const texture = textures[index];
    if (texture !== undefined) textureOf.set(sheet, texture);
  });

  const frames = new Map<string, { frame: SpriteFrame; tile: boolean }>();
  for (const kind of OBSTACLE_KEYS) {
    const visual = visuals[kind];
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
 * Node vật cản: `TILED` lặp tile cho tường/hố; `SIMPLE` + contentSize cho boulder
 * 32×32 (2×2 tile) — không kéo giãn một ô 16×16 thành 4 blob rời.
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
  console.error(`[YokaiField] Không dựng được ${what}: sheet "${sheet}". ${message}`);
}
