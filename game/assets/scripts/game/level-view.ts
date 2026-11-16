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

/**
 * Sheet vật cản: `TilesetHouse.png` (528×368 px). Ba ô đá/bóng tối:
 * - `pillar` → tile (22, 0): khối đá `#5F7160` (204/256 px), có cột gỗ mảnh ở mép.
 * - `wall`   → tile (21, 0): cùng chất đá nhưng phẳng hơn, dùng cho tường thấp.
 * - `pit`    → tile (27, 2): gần đen `#141B1B` (202/256 px) ⇒ đọc thành hố.
 *
 * TODO(art): đây là tile tường nhà, không phải cột đá vẽ riêng. Khi map được author
 * trong Tiled (ADR-005) thì thay bằng tile cột/hố thật; rect là thứ duy nhất phải sửa.
 */
export const OBSTACLE_SHEET = 'resources/art/tilesets/TilesetHouse.png';

/** Một ô pixel trong sheet, gốc **trên-trái** (cùng quy ước với `manifest.frameRect`). */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const OBSTACLE_RECTS: Readonly<Record<ObstacleKind, TileRect>> = {
  pillar: { x: 352, y: 0, width: 16, height: 16 },
  wall: { x: 336, y: 0, width: 16, height: 16 },
  pit: { x: 432, y: 32, width: 16, height: 16 },
};

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
  obstacleSheet: string,
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

  void buildObstacles(root, level, obstacleSheet).catch((error: unknown) => {
    reportLoadFailure('vật cản', obstacleSheet, error);
  });

  return root;
}

/** Vật cản: một sprite cho mỗi `Obstacle`, kéo giãn đúng kích thước tile của nó. */
async function buildObstacles(root: Node, level: LevelData, sheet: string): Promise<void> {
  const texture = await loadTexture(sheet);
  if (!root.isValid) return;
  const frames = new Map<ObstacleKind, SpriteFrame>();
  for (const kind of ['pillar', 'wall', 'pit'] as const) {
    const rect = OBSTACLE_RECTS[kind];
    frames.set(kind, sliceFrame(texture, rect));
  }

  const obstacles = new CocosNode('obstacles');
  obstacles.parent = root;

  level.obstacles.forEach((obstacle, index) => {
    const frame = frames.get(obstacle.kind);
    if (frame === undefined) return;

    const rect = obstacleWorldRect(obstacle);
    const node = makeTileNode(
      `obstacle-${index}-${obstacle.kind}`,
      frame,
      rect.width * TILE_SIZE_PX,
      rect.height * TILE_SIZE_PX,
      TILE_WORLD_UNITS / TILE_SIZE_PX,
    );
    node.parent = obstacles;
    node.setPosition(rect.x + rect.width / 2, rect.y + rect.height / 2, 0);
  });
}

/**
 * Node 1 sprite với `sizeMode = CUSTOM` (node giữ đúng kích thước ta đặt, không bị
 * frame tự resize) — cần cho vật cản nhiều tile.
 */
function makeTileNode(
  name: string,
  frame: SpriteFrame,
  widthPx: number,
  heightPx: number,
  scale: number,
): Node {
  const node = new CocosNode(name);

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
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
