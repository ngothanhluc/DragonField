/**
 * Living decor (#6), engine side: wandering animals + animated flags/flowers/plants.
 *
 * Placement (`placeDecor`) and the movement rules (`stepAnimal`) are pure and live in
 * `core/atmosphere/living-decor.ts`. This adapter only:
 * - creates one sprite per item under the room (no collider, no combat registration),
 * - calls `stepAnimal` once per animal per frame with the player's tile position,
 * - flips a sprite by `facing` and animates frames from one shared clock.
 *
 * Decor is always **under actors**: it can never cover the player, telegraphs or bullets.
 */
import {
  _decorator,
  Component,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  warn,
} from 'cc';
import type { AnimalTuning, DecorSpec, VisibleAtmosphere } from '../core/atmosphere/atmosphere';
import {
  createAnimal,
  placeDecor,
  stepAnimal,
  type AnimalState,
  type DecorItem,
} from '../core/atmosphere/living-decor';
import { resolve, type AnimationManifest, type SpriteEntry } from '../core/art/manifest';
import { entryAnchorY } from '../core/art/runtime';
import type { LevelData } from '../core/level/level-data';
import { ROOM_ROWS } from '../core/level/level-data';
import type { Vec2 } from '../core/math/vec2';
import { SeededRng } from '../core/rng';
import { getFrame } from './assets/sprite-frame-cache';
import { ACTOR_SCALE } from './level-view';

type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;
type SpriteFrame = Awaited<ReturnType<typeof getFrame>>;

const { ccclass } = _decorator;

interface AnimatedSprite {
  readonly node: Node;
  readonly sprite: Sprite;
  readonly frames: readonly SpriteFrame[];
  readonly fps: number;
  readonly phase: number;
  frameIndex: number;
}

interface AnimalView extends AnimatedSprite {
  state: AnimalState;
}

interface DecorConfig {
  readonly level: LevelData;
  readonly tuning: AnimalTuning;
  readonly manifest: AnimationManifest;
  readonly seed: number;
  readonly playerOf: () => Vec2 | null;
}

/**
 * Tile position → world position of the footprint's **bottom centre** (the sprite's feet).
 * A decor footprint is 1×1 centred on `at`, so its bottom edge is `at.y + 0.5`.
 */
function feetOf(at: Vec2): Vec2 {
  return { x: at.x, y: ROOM_ROWS - (at.y + 0.5) };
}

@ccclass('LivingDecor')
export class LivingDecor extends Component {
  private readonly animals: AnimalView[] = [];
  private readonly props: AnimatedSprite[] = [];
  private rng = new SeededRng(1);
  private elapsedMs = 0;
  private level: LevelData | null = null;
  private tuning: AnimalTuning | null = null;
  private playerOf: (() => Vec2 | null) | null = null;

  /** Create the sprites the effects mode allows; returns how many were created. */
  async init(
    items: readonly DecorItem[],
    visible: VisibleAtmosphere,
    config: DecorConfig,
  ): Promise<{ animals: number; props: number }> {
    this.level = config.level;
    this.tuning = config.tuning;
    this.playerOf = config.playerOf;
    this.rng = new SeededRng(config.seed);

    for (const item of items) {
      if (item.kind === 'animal' && !visible.animals) continue;
      if (item.kind === 'prop' && !visible.animatedProps) continue;

      let entry: SpriteEntry;
      let frames: readonly SpriteFrame[];
      try {
        entry = resolve(config.manifest, item.sprite);
        frames = await Promise.all(
          Array.from({ length: entry.frames }, (_, index) => getFrame(entry, 'down', index)),
        );
      } catch (error: unknown) {
        warn(`[YokaiField] Decor ${item.sprite} skipped: ${String(error)}`);
        continue;
      }
      if (!this.isValid) return { animals: 0, props: 0 };

      const animated = this.createSprite(item.sprite, entry, frames, item.at);
      if (item.kind === 'animal') {
        this.animals.push({ ...animated, state: createAnimal(item.at) });
      } else {
        this.props.push(animated);
      }
    }

    return { animals: this.animals.length, props: this.props.length };
  }

  update(deltaTime: number): void {
    const dtMs = Math.min(1000, Math.max(0, deltaTime) * 1000);
    if (dtMs <= 0) return;
    this.elapsedMs += dtMs;

    for (const prop of this.props) this.animateFrame(prop, 0);

    const level = this.level;
    const tuning = this.tuning;
    const playerOf = this.playerOf;
    if (level === null || tuning === null || playerOf === null) return;

    const player = playerOf();
    for (const animal of this.animals) {
      animal.state = stepAnimal(animal.state, {
        player,
        dtMs,
        level,
        tuning,
        rng: this.rng,
      });
      const feet = feetOf(animal.state.at);
      animal.node.setPosition(feet.x, feet.y, 0);
      animal.node.setScale(ACTOR_SCALE * animal.state.facing, ACTOR_SCALE, 1);
      this.animateFrame(animal, 0);
    }
  }

  /** Advance one shared-clock frame; `phase` offsets entities so they do not flip in lockstep. */
  private animateFrame(target: AnimatedSprite, extraPhase: number): void {
    if (target.frames.length <= 1) return;
    const phase = target.phase + extraPhase;
    const index =
      Math.floor((this.elapsedMs * target.fps) / 1000 + phase * target.frames.length) %
      target.frames.length;
    if (index === target.frameIndex) return;
    target.frameIndex = index;
    const frame = target.frames[index];
    if (frame !== undefined) target.sprite.spriteFrame = frame;
  }

  private createSprite(
    key: string,
    entry: SpriteEntry,
    frames: readonly SpriteFrame[],
    at: Vec2,
  ): AnimatedSprite {
    const node = new CocosNode(key);
    node.parent = this.node;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.spriteFrame = frames[0]!;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    // CUSTOM takes its size from UITransform (defaults to 100×100, ~3× too big otherwise).
    if (transform !== null) {
      transform.setContentSize(entry.frameWidth, entry.frameHeight);
      transform.setAnchorPoint(0.5, entryAnchorY(entry));
    }

    node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);
    const feet = feetOf(at);
    node.setPosition(feet.x, feet.y, 0);

    return {
      node,
      sprite,
      frames,
      fps: entry.fps,
      phase: this.rng.next(),
      frameIndex: 0,
    };
  }
}

export interface DecorAttachOptions extends DecorConfig {
  readonly visible: VisibleAtmosphere;
  readonly spec: DecorSpec;
}

export interface DecorHandle {
  /** Resolves once sprites exist; `{ animals, props }` counts what was actually created. */
  readonly ready: Promise<{ animals: number; props: number }>;
  destroy(): void;
}

/**
 * Place and attach this room's living decor. `seed` should mix the run seed with the room number
 * so re-entering a room looks the same but rooms differ.
 */
export function attachLivingDecor(roomRoot: Node, options: DecorAttachOptions): DecorHandle {
  const node = new CocosNode('living-decor');
  node.parent = roomRoot;
  // Above the tile map/water/atmosphere, below obstacles/actors: keys are popped above decor,
  // so decor stays behind the player and every bullet. `setSiblingIndex` clamps to the last child.
  node.setSiblingIndex(2);

  const items = placeDecor(options.level, options.spec, options.seed);
  const view: LivingDecor = node.addComponent(LivingDecor);
  const ready = view
    .init(items, options.visible, options)
    .catch((error: unknown) => {
      warn(`[YokaiField] Could not build the living decor: ${String(error)}`);
      return { animals: 0, props: 0 };
    });

  return {
    ready,
    destroy(): void {
      if (node.isValid) node.destroy();
    },
  };
}
