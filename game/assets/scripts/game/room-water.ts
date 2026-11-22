/**
 * Chapter 2's animated water: river (ripple) + 3-part waterfall, using the pack's animated
 * sheets (`Backgrounds/Animated/Waterfall`, `Water Ripples`).
 *
 * Water is a decorative layer **below actors** and **above the tile map**: the node is inserted
 * at sibling index 1 of the room root (after the map, before obstacles). There is no collision —
 * the river is shallow, so player/enemies walk through it.
 *
 * Animation shares one clock for the whole room: 60 water sprites need no 60 separate
 * `update` components.
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
import type { WaterArea } from '../core/level/water-layout';
import { TILE_SIZE_PX } from '../core/level/level-data';
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
const RIPPLE_FPS = 8;
const FALL_FPS = 10;

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
  private rows = 18;

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

    for (const area of areas) {
      // Solid blue base: the ripple/waterfall sheets are transparent overlays, not opaque water.
      this.addBase(area);

      if (area.kind === 'river') {
        for (let y = area.y; y < area.y + area.height; y += 1) {
          for (let x = area.x; x < area.x + area.width; x += 1) {
            this.addTile(x, y, ripple, RIPPLE_FPS, (x * 3 + y) % ripple.length, 1);
          }
        }
        continue;
      }

      for (let x = area.x; x < area.x + area.width; x += 1) {
        for (let y = area.y; y < area.y + area.height; y += 1) {
          const fromTop = y - area.y;
          const atBottom = y === area.y + area.height - 1;
          const frames = atBottom ? bottom : fromTop === 0 ? top : mid;
          this.addTile(x, y, frames, FALL_FPS, x % frames.length, 1);
        }
      }
    }
  }

  /** Flat water base under the ripple/waterfall sprites (Graphics, no texture needed). */
  private addBase(area: WaterArea): void {
    const node = new CocosNode('water-base');
    node.parent = this.node;

    const graphics: Graphics = node.addComponent(CocosGraphics);
    graphics.fillColor =
      area.kind === 'river'
        ? new CocosColor(58, 156, 202, 255)
        : new CocosColor(92, 190, 224, 255);
    graphics.rect(-area.width / 2, -area.height / 2, area.width, area.height);
    graphics.fill();

    node.setPosition(area.x + area.width / 2, this.rows - area.y - area.height / 2, 0);
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
    const node = new CocosNode(`water-${tileX}-${tileY}`);
    node.parent = this.node;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.spriteFrame = frames[0]!;
    sprite.color = new CocosColor(255, 255, 255, Math.round(255 * opacity));

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(FRAME_PX, FRAME_PX);

    node.setScale(1 / TILE_SIZE_PX, 1 / TILE_SIZE_PX, 1);
    node.setPosition(tileX + 0.5, this.rows - tileY - 0.5, 0);
    this.tiles.push({ sprite, frames, fps, offset, index: 0 });
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
