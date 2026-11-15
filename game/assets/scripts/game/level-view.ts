/**
 * Dựng một phòng bằng code: sàn + vật cản. Không prefab, không sửa scene.
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
 * Vì sao helper toạ độ nằm ở đây: danh sách file của milestone chỉ có 6 file adapter,
 * không có chỗ cho một `util/coordinates.ts` riêng — file này là nơi duy nhất biết
 * hình học của phòng, nên nó sở hữu luôn phép đổi hệ trục.
 */
import {
  Node as CocosNode,
  Rect,
  Size,
  Sprite as CocosSprite,
  SpriteFrame as CocosSpriteFrame,
  UITransform as CocosUITransform,
  Vec2 as EngineVec2,
} from 'cc';
import type { AnimationManifest } from '../core/art/manifest';
import type { LevelData, Obstacle, ObstacleKind } from '../core/level/level-data';
import { ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
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
type UITransform = InstanceType<typeof CocosUITransform>;

/** 1 tile = 1 world unit (world convention của milestone). */
export const TILE_WORLD_UNITS = 1;

/**
 * Sheet sàn: `TilesetField.png` (80×240 px = 5×15 tile 16 px).
 *
 * Ô được chọn là **tile (col = 1, row = 4)** — px `(16, 64, 16, 16)`.
 * Đo trên file thật: ô này **đủ 256/256 px đục**, 98% số px cùng một màu cỏ
 * `#ADBC3A`, không có viền/hoa văn ở mép ⇒ ghép 32×18 ô không thấy đường nối.
 * `TilesetField` là tileset duy nhất trong pack có mảng màu phẳng như vậy;
 * `TilesetNature`/`VillageAbandoned` toàn cây/đá/nhà (không có ô nền),
 * `TilesetFloor.png` thì cố tình không được stage (lệch 1 px).
 */
export const FLOOR_SHEET = 'resources/art/tilesets/TilesetField.png';

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

/** Ô sàn đã chọn — xem ghi chú ở `FLOOR_SHEET`. */
const FLOOR_RECT: TileRect = { x: 16, y: 64, width: 16, height: 16 };

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

/** Tâm ô `(col, row)` (row đếm từ trên) trong world. */
export function tileCenterToWorld(col: number, row: number): Vec2 {
  return { x: col + 0.5, y: ROOM_ROWS - row - 0.5 };
}

/** Hình chữ nhật world của một vật cản: góc dưới-trái + kích thước, cả hai theo unit. */
export function obstacleWorldRect(obstacle: Obstacle): {
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
 * Dựng phòng từ `LevelData` và trả về **root node** (huỷ phòng = `root.destroy()`,
 * engine tự dọn hết node con).
 *
 * Texture load bất đồng bộ nên node được tạo ngay, sprite gắn vào khi texture về.
 * Lỗi load chỉ log ra console kèm đường dẫn resources; bootstrap đã `preloadSheets`
 * trước nên trường hợp này không xảy ra lúc chạy bình thường, còn nếu có thì lỗi
 * thật đã nổi ở bước preload với thông báo đầy đủ hơn.
 */
export function buildRoom(
  parent: Node,
  level: LevelData,
  manifest: AnimationManifest,
  floorSheet: string,
  obstacleSheet: string,
): Node {
  // Tile chưa có key trong manifest (import-checklist §6.2: 15 tileset + 39 file UI
  // không có key), nên sheet phải truyền vào. Giữ tham số để chữ ký không đổi khi
  // tile có schema riêng.
  void manifest;

  const root = new CocosNode(`room-${level.id}`);
  root.parent = parent;

  void buildFloor(root, level, floorSheet).catch((error: unknown) => {
    reportLoadFailure('sàn', floorSheet, error);
  });
  void buildObstacles(root, level, obstacleSheet).catch((error: unknown) => {
    reportLoadFailure('vật cản', obstacleSheet, error);
  });

  return root;
}

/**
 * Sàn: một node `floor` giữ lưới 32×18 sprite.
 *
 * `Sprite` của Cocos không lặp texture được (không có `wrapMode REPEAT` cho sprite
 * thường, muốn lặp phải viết shader riêng), nên "một sàn trải 32×18" ở đây là **một
 * node cha** + 576 quad 1×1 unit. Toàn bộ nằm cùng một texture và cùng material nên
 * batcher gộp thành một draw call, và nhờ vậy sau này thay tile theo ô (viền, trang
 * trí) không phải đổi cấu trúc.
 */
async function buildFloor(root: Node, level: LevelData, sheet: string): Promise<void> {
  const texture = await loadTexture(sheet);
  // Phòng có thể đã bị huỷ trong lúc chờ texture (đổi phòng) — đừng gắn vào node chết.
  if (!root.isValid) return;
  const frame = sliceFrame(texture, FLOOR_RECT);

  const floor = new CocosNode('floor');
  floor.parent = root;

  const scale = TILE_WORLD_UNITS / TILE_SIZE_PX;
  for (let row = 0; row < level.size.rows; row += 1) {
    for (let col = 0; col < level.size.cols; col += 1) {
      const tile = makeTileNode(`tile-${col}-${row}`, frame, TILE_SIZE_PX, TILE_SIZE_PX, scale);
      tile.parent = floor;
      const at = tileCenterToWorld(col, row);
      tile.setPosition(at.x, at.y, 0);
    }
  }
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
 * frame tự resize) — cần cho cả tile 1×1 và vật cản 3×3.
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
