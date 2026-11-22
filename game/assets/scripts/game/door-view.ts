/**
 * Doors after a cleared room (#39, ADR-014).
 *
 * World-space adapter: one glowing doorway per `LevelData.doors` spot plus the reward icon
 * above it. Walking into a door is decided by bootstrap (it owns the run flow); this file only
 * draws the offer and reports where the doors stand, in tile space.
 *
 * Icons come from the pack's UI art, loaded at NEAREST so they stay crisp at any zoom. The
 * doorway itself is `Graphics`, not a sprite: the pack has no door sheet and a code-drawn
 * portal also stays visible under Effects Reduced.
 */
import {
  Color as CocosColor,
  Graphics as CocosGraphics,
  Node as CocosNode,
  Rect,
  Size,
  Sprite as CocosSprite,
  SpriteFrame as CocosSpriteFrame,
  UITransform as CocosUITransform,
  Vec2 as EngineVec2,
} from 'cc';
import type { Vec2 } from '../core/math/vec2';
import type { DoorReward } from '../core/run/doors';
import { loadPixelTexture } from './assets/texture-cache';
import { ACTOR_SCALE, tileToWorld } from './level-view';

/** `cc` is an any module: import names only work in value position. */
type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** One door to draw: reward behind it and its `.tmx` point (tile units, y down). */
export interface DoorSpot {
  readonly reward: DoorReward;
  readonly at: Vec2;
}

export interface DoorSnapshot {
  readonly reward: DoorReward;
  /** Tile-space position (y down), same as the player position. */
  readonly x: number;
  readonly y: number;
}

/** A reward icon: resources sheet, sheet rect and displayed size in world units. */
interface IconSpec {
  readonly sheet: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Displayed size in tiles (1.5 = 24 px at 1 px = 1/16 unit). */
  readonly tiles: number;
}

/**
 * Reward → pack icon. `skill` reuses the power-up skill icon, `gold` the coin sheet, and the
 * specials map to the closest pack item; #40 owns their rooms, so they only show once the
 * `doors.specialRoomsEnabled` flag is on. `boss` gets the skull so the last door reads as danger.
 */
const ICONS: Readonly<Record<DoorReward, IconSpec>> = {
  skill: { sheet: 'resources/art/ui/skill-icons/AttackUpgrade.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.5 },
  gold: { sheet: 'resources/art/ui/coin/Coin2.png', x: 0, y: 0, width: 10, height: 10, tiles: 1.5 },
  heal: { sheet: 'resources/art/ui/skill-icons/Heal.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.5 },
  shop: { sheet: 'resources/art/ui/skill-icons/Alchemy.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.5 },
  chest: { sheet: 'resources/art/ui/skill-icons/LuckUpgrade.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.5 },
  boss: { sheet: 'resources/art/ui/skill-icons/Death.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.5 },
};

const TINTS: Readonly<Record<DoorReward, Color>> = {
  skill: new CocosColor(120, 190, 255, 255),
  gold: new CocosColor(255, 214, 90, 255),
  heal: new CocosColor(255, 120, 130, 255),
  shop: new CocosColor(120, 230, 150, 255),
  chest: new CocosColor(205, 150, 255, 255),
  boss: new CocosColor(255, 110, 90, 255),
};

/** Doorway size, world units (1 unit = 1 tile). */
const DOOR_WIDTH = 1.3;
const DOOR_HEIGHT = 1.9;
/** Icon centre above the doorway's top edge, tiles. */
const ICON_LIFT = 0.95;

/** One cached frame per icon sheet (textures are already cached by `loadPixelTexture`). */
const iconFrames = new Map<string, Promise<SpriteFrame>>();

function loadIconFrame(spec: IconSpec): Promise<SpriteFrame> {
  const cached = iconFrames.get(spec.sheet);
  if (cached !== undefined) return cached;

  const task = loadPixelTexture(spec.sheet).then((texture) => {
    const frame = new CocosSpriteFrame();
    frame.texture = texture;
    frame.rect = new Rect(spec.x, spec.y, spec.width, spec.height);
    frame.originalSize = new Size(spec.width, spec.height);
    frame.offset = new EngineVec2(0, 0);
    frame.packable = false;
    return frame;
  });
  iconFrames.set(spec.sheet, task);
  task.catch(() => {
    if (iconFrames.get(spec.sheet) === task) iconFrames.delete(spec.sheet);
  });
  return task;
}

/** Doors of the cleared room, built under `parent` (the world overlay layer). */
export class DoorView {
  private readonly node: Node;
  private readonly spots: readonly DoorSpot[];

  constructor(parent: Node, spots: readonly DoorSpot[]) {
    this.node = new CocosNode('doors');
    this.node.parent = parent;
    this.spots = spots.slice();
    for (const spot of this.spots) this.buildDoor(spot);
  }

  /** Where the doors stand, for bootstrap (walk-in check) and `__yokai.doors()`. */
  get doors(): readonly DoorSnapshot[] {
    return this.spots.map((spot) => ({ reward: spot.reward, x: spot.at.x, y: spot.at.y }));
  }

  destroy(): void {
    if (this.node.isValid) this.node.destroy();
  }

  private buildDoor(spot: DoorSpot): void {
    const world = tileToWorld(spot.at);
    const tint = TINTS[spot.reward];

    const door = new CocosNode(`door-${spot.reward}`);
    door.parent = this.node;
    door.setPosition(world.x, world.y, 0);

    this.addGlow(door, tint);
    this.addFrame(door, tint);
    this.addIcon(door, ICONS[spot.reward]);
  }

  /** Translucent fill: one `Graphics` per colour (fill() repaints every sub-path still buffered). */
  private addGlow(door: Node, tint: Color): void {
    const node = new CocosNode('glow');
    node.parent = door;
    const graphics: Graphics = node.addComponent(CocosGraphics);
    graphics.fillColor = new CocosColor(tint.r, tint.g, tint.b, 90);
    graphics.rect(-DOOR_WIDTH / 2, 0, DOOR_WIDTH, DOOR_HEIGHT);
    graphics.fill();
  }

  private addFrame(door: Node, tint: Color): void {
    const node = new CocosNode('frame');
    node.parent = door;
    const graphics: Graphics = node.addComponent(CocosGraphics);
    graphics.lineWidth = 0.08;
    graphics.strokeColor = tint;
    graphics.rect(-DOOR_WIDTH / 2, 0, DOOR_WIDTH, DOOR_HEIGHT);
    graphics.stroke();
  }

  private addIcon(door: Node, spec: IconSpec): void {
    const node = new CocosNode('reward-icon');
    node.parent = door;
    node.setPosition(0, DOOR_HEIGHT + ICON_LIFT, 0);

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.type = CocosSprite.Type.SIMPLE;
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    // CUSTOM takes its size from contentSize, not from the frame (AGENTS trap).
    if (transform !== null) transform.setContentSize(spec.tiles / ACTOR_SCALE, spec.tiles / ACTOR_SCALE);
    node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);

    // Missing art must not break the run flow: the glowing doorway still shows.
    void loadIconFrame(spec)
      .then((frame) => {
        if (node.isValid) sprite.spriteFrame = frame;
      })
      .catch(() => undefined);
  }
}
