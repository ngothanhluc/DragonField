/**
 * Chapter 2's animated water: staggered river ripples + 3-part waterfall cascades, using the
 * pack's animated sheets (`Backgrounds/Animated/Waterfall`, `Water Ripples`).
 *
 * Water sits **below actors** and **above the tile map** (`siblingIndex = 1` under the room root).
 * In Chapter 2 normal rooms (M11 ADR-020), deep water cells carry `kind: "pit"` obstacles (blocking
 * walkers while bullets pass over) and the TMX `water`/`bridge` layers draw the grass-bordered banks,
 * lily pads, and wooden bridges; `WaterView` animates sparse staggered ripples strictly inside the
 * open-water interiors and aligns waterfall splash foam cleanly on the north plunge-pool waterline.
 *
 * Animation shares one clock for the whole room: dozens of water sprites need only one `update`.
 */
import {
  _decorator,
  Color as CocosColor,
  Component,
  Graphics as CocosGraphics,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  warn,
} from 'cc';
import {
  planRiverRipples,
  planWaterfallTiles,
  type WaterArea,
} from '../core/level/water-layout';
import { ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
import { loadTexture } from './assets/texture-cache';
import { sliceFrame } from './level-view';

const { ccclass } = _decorator;

type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type Graphics = InstanceType<typeof CocosGraphics>;
type UITransform = InstanceType<typeof CocosUITransform>;
type SpriteFrame = ReturnType<typeof sliceFrame>;

const TOP_SHEET = 'resources/art/fx/water/waterfall-top.png';
const MID_SHEET = 'resources/art/fx/water/waterfall-mid.png';
const BOTTOM_SHEET = 'resources/art/fx/water/waterfall-bottom.png';
const RIPPLE_SHEET = 'resources/art/fx/water/ripple.png';

const FRAME_PX = 16;

interface AnimatedTile {
  readonly sprite: Sprite;
  readonly frames: readonly SpriteFrame[];
  readonly fps: number;
  readonly offset: number;
  index: number;
}

@ccclass('WaterView')
export class WaterView extends Component {
  private readonly tiles: AnimatedTile[] = [];
  private elapsedMs = 0;
  /** Room height (tiles): tile y (down) → world y (up) flip. */
  private rows = ROOM_ROWS;

  init(areas: readonly WaterArea[], rows: number): void {
    this.rows = rows;
    void this.build(areas).catch((error: unknown) => {
      warn(`[YokaiField] Could not build water: ${String(error)}`);
    });
  }

  update(deltaTime: number): void {
    this.elapsedMs += Math.max(0, deltaTime) * 1000;
    for (const tile of this.tiles) {
      const index =
        Math.floor((this.elapsedMs * tile.fps) / 1000 + tile.offset) % tile.frames.length;
      if (index === tile.index) continue;
      tile.index = index;
      const frame = tile.frames[index];
      if (frame !== undefined) tile.sprite.spriteFrame = frame;
    }
  }

  private async build(areas: readonly WaterArea[]): Promise<void> {
    const [topTex, midTex, bottomTex, rippleTex] = await Promise.all([
      loadTexture(TOP_SHEET),
      loadTexture(MID_SHEET),
      loadTexture(BOTTOM_SHEET),
      loadTexture(RIPPLE_SHEET),
    ]);
    if (!this.isValid) return;

    const framesOf = (texture: typeof topTex, count: number): SpriteFrame[] =>
      Array.from({ length: count }, (_, index) =>
        sliceFrame(texture, { x: index * FRAME_PX, y: 0, width: FRAME_PX, height: FRAME_PX }),
      );

    const top = framesOf(topTex, 5);
    const mid = framesOf(midTex, 5);
    const bottom = framesOf(bottomTex, 3);
    const ripple = framesOf(rippleTex, 4);

    // Multi-screen Ch2 normal rooms already paint `#71ddee` deep water + lily pads/fish in the
    // TMX `water` layer; only single-screen legacy rooms (boss arena room-17) need a Graphics base
    // for river rectangles. Waterfalls always composite after rivers so splash foam sits on top.
    const needsRiverBase = this.rows <= ROOM_ROWS;

    for (const area of areas) {
      if (area.kind !== 'river') continue;
      if (needsRiverBase) this.addBase(area);
      for (const placement of planRiverRipples(area)) {
        this.addTile(
          placement.tileX + placement.offsetX,
          placement.tileY + placement.offsetY,
          ripple,
          placement.fps,
          placement.phase,
          1,
        );
      }
    }

    for (const area of areas) {
      if (area.kind !== 'waterfall') continue;
      this.addBase(area);
      for (const tile of planWaterfallTiles(area)) {
        const frames = tile.part === 'bottom' ? bottom : tile.part === 'top' ? top : mid;
        this.addTile(tile.tileX, tile.tileY, frames, tile.fps, tile.phase, 1);
      }
    }
  }

  /**
   * Flat water base under waterfall sprites and legacy single-screen river areas. Uses `#71ddee`
   * (`113, 221, 238`) to match `TilesetWater` deep water and `ripple.png` pixel-for-pixel.
   * Chunked into ≤4-tile segments so `world-culler` (`CULL_MARGIN_TILES = 2`) never hides a
   * wide river's base while one end of the river is still on screen.
   */
  private addBase(area: WaterArea): void {
    const color =
      area.kind === 'river'
        ? new CocosColor(113, 221, 238, 255)
        : new CocosColor(114, 196, 230, 255);
    const step = 4;
    for (let dx = 0; dx < area.width; dx += step) {
      const width = Math.min(step, area.width - dx);
      for (let dy = 0; dy < area.height; dy += step) {
        const height = Math.min(step, area.height - dy);
        const node = new CocosNode('water-base');
        node.parent = this.node;

        const graphics: Graphics = node.addComponent(CocosGraphics);
        graphics.fillColor = color;
        graphics.rect(-width / 2, -height / 2, width, height);
        graphics.fill();

        node.setPosition(area.x + dx + width / 2, this.rows - (area.y + dy) - height / 2, 0);
      }
    }
  }

  private addTile(
    tileX: number,
    tileY: number,
    frames: readonly SpriteFrame[],
    fps: number,
    offset: number,
    opacity: number,
  ): void {
    if (frames.length === 0) return;
    const initialIndex = Math.floor(offset) % frames.length;
    const node = new CocosNode(`water-${Math.round(tileX * 10)}-${Math.round(tileY * 10)}`);
    node.parent = this.node;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.spriteFrame = frames[initialIndex]!;
    sprite.color = new CocosColor(255, 255, 255, Math.round(255 * opacity));

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(FRAME_PX, FRAME_PX);

    node.setScale(1 / TILE_SIZE_PX, 1 / TILE_SIZE_PX, 1);
    node.setPosition(tileX + 0.5, this.rows - tileY - 0.5, 0);
    this.tiles.push({ sprite, frames, fps, offset, index: initialIndex });
  }
}

/**
 * Attach water to the room root. The water node sits after the tile map (`siblingIndex = 1`)
 * so obstacles/actors draw on top; destroying the room takes the water with it.
 * `rows` is the room height used to flip tile y to world y.
 */
export function attachRoomWater(roomRoot: Node, areas: readonly WaterArea[], rows: number): void {
  if (areas.length === 0) return;
  const node = new CocosNode('water');
  node.parent = roomRoot;
  node.setSiblingIndex(1);

  const view: WaterView = node.addComponent(WaterView);
  view.init(areas, rows);
}
