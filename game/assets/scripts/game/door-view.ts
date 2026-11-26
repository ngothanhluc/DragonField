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
  Label as CocosLabel,
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
import { applyPixelFont } from './ui-font';

/** `cc` is an any module: import names only work in value position. */
type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Label = InstanceType<typeof CocosLabel>;
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
export interface IconSpec {
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
 *
 * Exported for the HUD's door arrows (#63): an arrow must show the same icon its door shows.
 */
export const ICONS: Readonly<Record<DoorReward, IconSpec>> = {
  xp: { sheet: 'resources/art/fx/xp-orb/xp-orb-large.png', x: 0, y: 0, width: 16, height: 16, tiles: 1.5 },
  gold: { sheet: 'resources/art/ui/coin/Coin2.png', x: 0, y: 0, width: 10, height: 10, tiles: 1.5 },
  heal: { sheet: 'resources/art/ui/skill-icons/Heal.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.5 },
  shop: { sheet: 'resources/art/ui/skill-icons/Alchemy.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.5 },
  chest: { sheet: 'resources/art/ui/skill-icons/LuckUpgrade.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.5 },
  boss: { sheet: 'resources/art/ui/skill-icons/Death.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.5 },
};

const TINTS: Readonly<Record<DoorReward, Color>> = {
  xp: new CocosColor(115, 228, 255, 255),
  gold: new CocosColor(255, 214, 90, 255),
  heal: new CocosColor(255, 120, 130, 255),
  shop: new CocosColor(120, 230, 150, 255),
  chest: new CocosColor(205, 150, 255, 255),
  boss: new CocosColor(255, 110, 90, 255),
};

const DOOR_LABELS: Readonly<Record<DoorReward, string>> = {
  xp: 'XP +ELITE',
  gold: 'GOLD',
  heal: 'HEAL',
  shop: 'SHOP',
  chest: 'CHEST',
  boss: 'BOSS',
};

const LABEL_OUTLINE_COLOR = new CocosColor(12, 10, 16, 255);

/** Doorway size, world units (1 unit = 1 tile). */
const DOOR_WIDTH = 1.3;
const DOOR_HEIGHT = 1.9;
/** Icon centre distance from the doorway edge, tiles. */
const ICON_LIFT = 0.95;
/** Label centre distance past the reward icon, tiles. */
const LABEL_LIFT = 0.95;
/** Doors within this many tiles of the top border (`tileY = 0`) project inward (downward) so icon + label stay inside the room. */
const TOP_EDGE_DOOR_THRESHOLD_TILES = 3.5;
/** Top padding inside the door mouth for north-edge doors so the portal hugs the top border. */
const TOP_EDGE_PORTAL_INSET = 0.4;

export interface DoorVerticalLayout {
  readonly portalBottomY: number;
  readonly iconY: number;
  readonly labelY: number;
}

/**
 * Local Y offsets (world units, y up) for a door's portal rect, reward icon, and label.
 * North-edge doors (`tileY <= 3.5`) project downward into the room so neither the icon nor the
 * `'XP +ELITE'` label clips off the top edge of the camera band.
 */
export function doorVerticalLayout(tileY: number): DoorVerticalLayout {
  if (tileY <= TOP_EDGE_DOOR_THRESHOLD_TILES) {
    const portalBottomY = -DOOR_HEIGHT + TOP_EDGE_PORTAL_INSET;
    const iconY = portalBottomY - ICON_LIFT;
    return {
      portalBottomY,
      iconY,
      labelY: iconY - LABEL_LIFT,
    };
  }
  const iconY = DOOR_HEIGHT + ICON_LIFT;
  return {
    portalBottomY: 0,
    iconY,
    labelY: iconY + LABEL_LIFT,
  };
}

/** One cached frame per icon sheet (textures are already cached by `loadPixelTexture`). */
const iconFrames = new Map<string, Promise<SpriteFrame>>();

/** Icon frame of a reward, at NEAREST filtering — shared by the door and the HUD arrows. */
export function loadRewardIconFrame(spec: IconSpec): Promise<SpriteFrame> {
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
    const layout = doorVerticalLayout(spot.at.y);

    const door = new CocosNode(`door-${spot.reward}`);
    door.parent = this.node;
    door.setPosition(world.x, world.y, 0);

    this.addGlow(door, tint, layout.portalBottomY);
    this.addFrame(door, tint, layout.portalBottomY);
    this.addIcon(door, ICONS[spot.reward], layout.iconY);
    this.addLabel(door, DOOR_LABELS[spot.reward], tint, layout.labelY);
  }

  /** World-space pixel label next to the reward icon (scaled by ACTOR_SCALE on the door's layer). */
  private addLabel(door: Node, text: string, tint: Color, localY: number): void {
    const node = new CocosNode('reward-label');
    node.layer = door.layer;
    node.parent = door;
    node.setPosition(0, localY, 0);
    node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);

    const label: Label = node.addComponent(CocosLabel);
    label.string = text;
    label.fontSize = 8;
    label.lineHeight = 10;
    label.color = tint;
    label.enableOutline = true;
    label.outlineColor = LABEL_OUTLINE_COLOR;
    label.outlineWidth = 1;
    applyPixelFont(label);
  }

  /** Translucent fill: one `Graphics` per colour (fill() repaints every sub-path still buffered). */
  private addGlow(door: Node, tint: Color, bottomY: number): void {
    const node = new CocosNode('glow');
    node.parent = door;
    const graphics: Graphics = node.addComponent(CocosGraphics);
    graphics.fillColor = new CocosColor(tint.r, tint.g, tint.b, 90);
    graphics.rect(-DOOR_WIDTH / 2, bottomY, DOOR_WIDTH, DOOR_HEIGHT);
    graphics.fill();
  }

  private addFrame(door: Node, tint: Color, bottomY: number): void {
    const node = new CocosNode('frame');
    node.parent = door;
    const graphics: Graphics = node.addComponent(CocosGraphics);
    graphics.lineWidth = 0.08;
    graphics.strokeColor = tint;
    graphics.rect(-DOOR_WIDTH / 2, bottomY, DOOR_WIDTH, DOOR_HEIGHT);
    graphics.stroke();
  }

  private addIcon(door: Node, spec: IconSpec, localY: number): void {
    const node = new CocosNode('reward-icon');
    node.parent = door;
    node.setPosition(0, localY, 0);

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.type = CocosSprite.Type.SIMPLE;
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    // CUSTOM takes its size from contentSize, not from the frame (AGENTS trap).
    if (transform !== null) transform.setContentSize(spec.tiles / ACTOR_SCALE, spec.tiles / ACTOR_SCALE);
    node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);

    // Missing art must not break the run flow: the glowing doorway still shows.
    void loadRewardIconFrame(spec)
      .then((frame) => {
        if (node.isValid) sprite.spriteFrame = frame;
      })
      .catch(() => undefined);
  }
}
