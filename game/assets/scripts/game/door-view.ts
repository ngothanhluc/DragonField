/**
 * Single North Portal after a cleared room (#39, ADR-014, M17 ADR-025).
 *
 * World-space adapter: multi-layer animated portal built around the staged `fx.portal-gate`
 * archway sprite (48×48 × 4 frames), two counter-rotating energy vortex rings, a breathing ambient
 * glow halo, and `PORTAL_PARTICLE_COUNT` (10) pre-allocated upward-drifting luminous particles —
 * all color-coded by destination (`normal` jade/cyan, `special` warm gold, `boss` crimson/violet)
 * with zero per-frame allocations and full support for `Effects: Reduced`.
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
import { localizeDoorReward } from '../core/i18n';
import type { Vec2 } from '../core/math/vec2';
import { portalDestinationKind, type DoorReward, type PortalDestinationKind } from '../core/run/doors';
import type { EffectsMode } from '../core/vfx/weapon-vfx';
import {
  PORTAL_PARTICLE_COUNT,
  portalPaletteFor,
  portalParticlePose,
  portalVortexFrame,
  type PortalPalette,
  type RgbColor,
} from '../core/view/portal-vfx';
import { loadPixelTexture } from './assets/texture-cache';
import { playPortalOpenSfx } from './audio/sfx';
import type { FxPool } from './fx/effect-pool';
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

/** Staged M19/M17 portal archway sheet (4 frames of 48×48 laid out horizontally). */
export const PORTAL_GATE_SHEET = 'resources/art/generated/fx/portal-gate.png';
const PORTAL_GATE_FRAME_PX = 48;
const PORTAL_GATE_FRAMES = 4;
/** World size of the 48×48 archway sprite in tiles (`2.4` tiles = 38.4 px). */
const PORTAL_GATE_TILES = 2.4;

/** One portal to draw: reward behind it and its `.tmx` point (tile units, y down). */
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
 * Reward → pack icon. Exported for the HUD's edge arrow (#63): an arrow shows the same icon
 * its portal shows.
 */
export const ICONS: Readonly<Record<DoorReward, IconSpec>> = {
  xp: { sheet: 'resources/art/fx/xp-orb/xp-orb-large.png', x: 0, y: 0, width: 16, height: 16, tiles: 1.25 },
  gold: { sheet: 'resources/art/ui/coin/Coin2.png', x: 0, y: 0, width: 10, height: 10, tiles: 1.25 },
  heal: { sheet: 'resources/art/generated/fx/health-potion.png', x: 0, y: 0, width: 16, height: 16, tiles: 1.25 },
  shop: { sheet: 'resources/art/ui/skill-icons/Alchemy.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.25 },
  chest: { sheet: 'resources/art/ui/skill-icons/LuckUpgrade.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.25 },
  boss: { sheet: 'resources/art/ui/skill-icons/Death.png', x: 0, y: 0, width: 24, height: 24, tiles: 1.25 },
};

const LABEL_OUTLINE_COLOR = new CocosColor(12, 10, 16, 255);

/** Portal visual bounding dimensions, world units (1 unit = 1 tile). */
const DOOR_HEIGHT = 2.2;
/** Icon centre distance from the portal edge, tiles. */
const ICON_LIFT = 0.8;
/** Label centre distance past the reward icon, tiles. */
const LABEL_LIFT = 0.85;
/** Doors within this many tiles of the top border (`tileY = 0`) project inward (downward) so icon + label stay inside the room. */
const TOP_EDGE_DOOR_THRESHOLD_TILES = 3.5;
/** Top padding inside the door mouth for north-edge portals so the archway hugs the top wall. */
const TOP_EDGE_PORTAL_INSET = 0.4;

export interface DoorVerticalLayout {
  readonly portalBottomY: number;
  readonly iconY: number;
  readonly labelY: number;
}

/**
 * Local Y offsets (world units, y up) for a portal's base, destination icon, and label.
 * North-edge portals (`tileY <= 3.5`) project downward into the room so neither the icon nor the
 * label clips off the top edge of the camera band.
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
let portalGateFramesPromise: Promise<readonly SpriteFrame[]> | null = null;

/** Icon frame of a reward, at NEAREST filtering — shared by the portal and HUD edge arrow. */
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

/** Slice the 4 frames of `fx.portal-gate` (48×48 horizontal strip) once and cache them. */
function loadPortalGateFrames(): Promise<readonly SpriteFrame[]> {
  if (portalGateFramesPromise !== null) return portalGateFramesPromise;

  const task = loadPixelTexture(PORTAL_GATE_SHEET).then((texture) => {
    const frames: SpriteFrame[] = [];
    for (let index = 0; index < PORTAL_GATE_FRAMES; index += 1) {
      const frame = new CocosSpriteFrame();
      frame.texture = texture;
      frame.rect = new Rect(
        index * PORTAL_GATE_FRAME_PX,
        0,
        PORTAL_GATE_FRAME_PX,
        PORTAL_GATE_FRAME_PX,
      );
      frame.originalSize = new Size(PORTAL_GATE_FRAME_PX, PORTAL_GATE_FRAME_PX);
      frame.offset = new EngineVec2(0, 0);
      frame.packable = false;
      frames.push(frame);
    }
    return frames;
  });
  portalGateFramesPromise = task;
  task.catch(() => {
    if (portalGateFramesPromise === task) portalGateFramesPromise = null;
  });
  return task;
}

interface AnimatedPortalRig {
  readonly kind: PortalDestinationKind;
  readonly centerY: number;
  readonly auraNode: Node;
  readonly outerRingNode: Node;
  readonly innerRingNode: Node;
  readonly gateSprite: Sprite;
  readonly particles: readonly Node[];
  gateFrames: readonly SpriteFrame[] | null;
  lastGateFrame: number;
}

function toColor(rgb: RgbColor, alpha = 255): Color {
  return new CocosColor(rgb.r, rgb.g, rgb.b, alpha);
}

/** North Portal(s) of the cleared room, built under `parent` (world overlay layer). */
export class DoorView {
  private readonly node: Node;
  private readonly spots: readonly DoorSpot[];
  private readonly rigs: AnimatedPortalRig[] = [];
  private elapsedSec = 0;
  private effectsMode: EffectsMode;

  constructor(parent: Node, spots: readonly DoorSpot[], effectsMode: EffectsMode = 'full') {
    this.node = new CocosNode('doors');
    this.node.parent = parent;
    this.spots = spots.slice();
    this.effectsMode = effectsMode;
    for (const spot of this.spots) this.buildDoor(spot);
    this.applyAnimationFrame();
  }

  /** Where the portal(s) stand, for bootstrap (walk-in check) and `__yokai.doors()`. */
  get doors(): readonly DoorSnapshot[] {
    return this.spots.map((spot) => ({ reward: spot.reward, x: spot.at.x, y: spot.at.y }));
  }

  setEffectsMode(mode: EffectsMode): void {
    this.effectsMode = mode;
    this.applyAnimationFrame();
  }

  /** Step continuous portal vortex rotation, breathing aura, archway frames, and rising particles. */
  update(deltaMs: number): void {
    if (this.rigs.length === 0) return;
    this.elapsedSec += Math.max(0, deltaMs) / 1000;
    this.applyAnimationFrame();
  }

  /**
   * Fire the M17 portal-activation burst (radial flash + expanding shockwave ring + portal SFX)
   * when the North Portal opens on room clear.
   */
  spawnActivationBurst(fx: FxPool | null, effectsMode: EffectsMode = this.effectsMode): void {
    const first = this.spots[0];
    if (first === undefined) return;
    const kind = portalDestinationKind(first.reward);
    const palette = portalPaletteFor(first.reward);
    playPortalOpenSfx(kind === 'boss');

    if (fx === null) return;
    const tint = toColor(palette.primary, 255);
    fx.spawn('fx.impact', first.at, {
      drawUnits: kind === 'boss' ? 3.2 : 2.5,
      lifetimeMs: 360,
      tint,
    });
    if (effectsMode !== 'reduced') {
      fx.spawnShockwave(first.at, {
        endRadiusTiles: kind === 'boss' ? 3.2 : 2.4,
        durationMs: 420,
        tint: toColor(palette.spark, 235),
      });
    }
  }

  destroy(): void {
    this.rigs.length = 0;
    if (this.node.isValid) this.node.destroy();
  }

  private applyAnimationFrame(): void {
    const reduced = this.effectsMode === 'reduced';
    for (const rig of this.rigs) {
      const frame = portalVortexFrame(this.elapsedSec, rig.kind, reduced, PORTAL_GATE_FRAMES);
      rig.auraNode.setScale(frame.auraScale, frame.auraScale, 1);
      rig.outerRingNode.angle = frame.outerAngleDeg;
      rig.innerRingNode.angle = frame.innerAngleDeg;

      if (rig.gateFrames !== null && rig.lastGateFrame !== frame.gateFrameIndex) {
        const nextFrame = rig.gateFrames[frame.gateFrameIndex];
        if (nextFrame !== undefined && rig.gateSprite.node.isValid) {
          rig.gateSprite.spriteFrame = nextFrame;
          rig.lastGateFrame = frame.gateFrameIndex;
        }
      }

      for (let index = 0; index < rig.particles.length; index += 1) {
        const particle = rig.particles[index];
        if (particle === undefined || !particle.isValid) continue;
        if (reduced) {
          if (particle.active) particle.active = false;
          continue;
        }
        const pose = portalParticlePose(index, rig.particles.length, this.elapsedSec);
        const visible = pose.alpha > 8;
        if (particle.active !== visible) particle.active = visible;
        if (visible) {
          particle.setPosition(pose.x, rig.centerY + pose.y, 0);
          particle.setScale(pose.scale, pose.scale, 1);
        }
      }
    }
  }

  private buildDoor(spot: DoorSpot): void {
    const world = tileToWorld(spot.at);
    const kind = portalDestinationKind(spot.reward);
    const palette = portalPaletteFor(spot.reward);
    const tint = toColor(palette.primary, 255);
    const layout = doorVerticalLayout(spot.at.y);
    const centerY = layout.portalBottomY + DOOR_HEIGHT * 0.5;

    const door = new CocosNode(`door-${spot.reward}`);
    door.parent = this.node;
    door.setPosition(world.x, world.y, 0);

    const auraNode = this.addAura(door, palette, centerY);
    const outerRingNode = this.addVortexRing(door, 'vortex-outer', toColor(palette.primary, 225), 0.95, 0.09, centerY);
    const innerRingNode = this.addVortexRing(door, 'vortex-inner', toColor(palette.secondary, 215), 0.62, 0.08, centerY);
    const gateSprite = this.addGateArchway(door, tint, centerY);
    const particles = this.addParticles(door, toColor(palette.spark, 235), centerY);

    const rig: AnimatedPortalRig = {
      kind,
      centerY,
      auraNode,
      outerRingNode,
      innerRingNode,
      gateSprite,
      particles,
      gateFrames: null,
      lastGateFrame: -1,
    };
    this.rigs.push(rig);

    void loadPortalGateFrames()
      .then((frames) => {
        if (!door.isValid || frames.length === 0) return;
        rig.gateFrames = frames;
        const first = frames[0];
        if (first !== undefined) {
          gateSprite.spriteFrame = first;
          rig.lastGateFrame = 0;
        }
      })
      .catch(() => undefined);

    this.addIcon(door, ICONS[spot.reward], layout.iconY);
    this.addLabel(door, localizeDoorReward(spot.reward), tint, layout.labelY);
  }

  /** Soft glowing halo behind the vortex (one `Graphics` per colour). */
  private addAura(door: Node, palette: PortalPalette, centerY: number): Node {
    const node = new CocosNode('portal-aura');
    node.parent = door;
    node.setPosition(0, centerY, 0);
    const graphics: Graphics = node.addComponent(CocosGraphics);
    graphics.fillColor = toColor(palette.glow, 88);
    graphics.circle(0, 0, 1.15);
    graphics.fill();
    return node;
  }

  /** Segmented energy ring (3 evenly spaced arcs) so rotation reads crisply at 60 fps. */
  private addVortexRing(
    door: Node,
    name: string,
    color: Color,
    radius: number,
    lineWidth: number,
    centerY: number,
  ): Node {
    const node = new CocosNode(name);
    node.parent = door;
    node.setPosition(0, centerY, 0);
    const graphics: Graphics = node.addComponent(CocosGraphics);
    graphics.lineWidth = lineWidth;
    graphics.strokeColor = color;
    const segments = 3;
    const step = (Math.PI * 2) / segments;
    const arcLen = step * 0.62;
    for (let i = 0; i < segments; i += 1) {
      const start = i * step;
      graphics.arc(0, 0, radius, start, start + arcLen, false);
    }
    graphics.stroke();
    return node;
  }

  /** Staged `fx.portal-gate` archway sprite tinted with destination palette. */
  private addGateArchway(door: Node, tint: Color, centerY: number): Sprite {
    const node = new CocosNode('portal-gate');
    node.parent = door;
    node.setPosition(0, centerY, 0);

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.type = CocosSprite.Type.SIMPLE;
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.color = tint;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setContentSize(PORTAL_GATE_FRAME_PX, PORTAL_GATE_FRAME_PX);
    }
    const scale = PORTAL_GATE_TILES / PORTAL_GATE_FRAME_PX;
    node.setScale(scale, scale, 1);
    return sprite;
  }

  /** Pre-allocate rising luminous pixel particles (zero runtime allocations). */
  private addParticles(door: Node, color: Color, centerY: number): Node[] {
    const particles: Node[] = [];
    for (let index = 0; index < PORTAL_PARTICLE_COUNT; index += 1) {
      const node = new CocosNode(`portal-particle-${index}`);
      node.parent = door;
      node.setPosition(0, centerY, 0);
      const graphics: Graphics = node.addComponent(CocosGraphics);
      graphics.fillColor = color;
      const size = index % 2 === 0 ? 0.14 : 0.1;
      graphics.rect(-size / 2, -size / 2, size, size);
      graphics.fill();
      node.active = false;
      particles.push(node);
    }
    return particles;
  }

  /** World-space pixel label next to the destination icon (scaled by ACTOR_SCALE). */
  private addLabel(door: Node, text: string, tint: Color, localY: number): void {
    const node = new CocosNode('reward-label');
    node.layer = door.layer;
    node.parent = door;
    node.setPosition(0, localY, 0);
    node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);

    const label: Label = node.addComponent(CocosLabel);
    label.string = text;
    label.fontSize = 8;
    label.lineHeight = 12;
    label.color = tint;
    label.enableOutline = true;
    label.outlineColor = LABEL_OUTLINE_COLOR;
    label.outlineWidth = 1;
    applyPixelFont(label);
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
    if (transform !== null) transform.setContentSize(spec.tiles / ACTOR_SCALE, spec.tiles / ACTOR_SCALE);
    node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);

    void loadRewardIconFrame(spec)
      .then((frame) => {
        if (node.isValid) sprite.spriteFrame = frame;
      })
      .catch(() => undefined);
  }
}
