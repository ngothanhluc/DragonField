/**
 * The NPC (heal / shop) and the chest of a special room (#40).
 *
 * One world-space adapter: it owns the sprite and reports the tile-space point the player must
 * walk into. Bootstrap owns the interaction rules; this file only draws.
 */
import {
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import { resolve, type AnimationManifest, type SpriteEntry } from '../core/art/manifest';
import { SPECIAL_INTERACT, type SpecialKind } from '../core/run/special-rooms';
import type { Vec2 } from '../core/math/vec2';
import { SpriteAnimator } from './anim/sprite-animator';
import { getFrame } from './assets/sprite-frame-cache';
import { ACTOR_SCALE, tileToWorld } from './level-view';

/** `cc` is an any module: import names only work in value position. */
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** Manifest key of the NPC/chest of each special room. */
const ACTOR_KEY: Readonly<Record<SpecialKind, string>> = {
  heal: 'npc.heal',
  shop: 'npc.shop',
  chest: 'npc.chest',
};

/** Built special-room prop; `position` is in tile units (y down), like the player. */
export class SpecialRoomView {
  private readonly node: Node;
  private readonly sprite: Sprite;
  private readonly kind: SpecialKind;
  private readonly entry: SpriteEntry;
  private used = false;

  constructor(parent: Node, kind: SpecialKind, manifest: AnimationManifest) {
    this.kind = kind;
    this.entry = resolve(manifest, ACTOR_KEY[kind]);

    this.node = new CocosNode(`special-${kind}`);
    this.node.parent = parent;

    const world = tileToWorld(SPECIAL_INTERACT);
    this.node.setPosition(world.x, world.y, 0);

    const sprite: Sprite = this.node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    this.sprite = sprite;
    this.node.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);

    if (kind === 'chest') {
      // The chest is one object, not an animated actor: frame 0 closed, frame 1 opened after use.
      const transform: UITransform | null = this.node.getComponent(CocosUITransform);
      if (transform !== null) {
        transform.setContentSize(this.entry.frameWidth, this.entry.frameHeight);
        transform.setAnchorPoint(0.5, 0.1);
      }
      void getFrame(this.entry, 'down', 0)
        .then((frame) => {
          if (this.node.isValid) sprite.spriteFrame = frame;
        })
        .catch(() => undefined);
      return;
    }

    const animator: SpriteAnimator = this.node.addComponent(SpriteAnimator);
    animator.play(ACTOR_KEY[kind]);
  }

  /** Tile-space point the player must walk into (the middle of the room). */
  get position(): Vec2 {
    return SPECIAL_INTERACT;
  }

  /** Show the opened chest frame; a no-op for NPCs and repeat calls. */
  markUsed(): void {
    if (this.used || this.kind !== 'chest') return;
    this.used = true;
    void getFrame(this.entry, 'down', 1)
      .then((frame) => {
        if (this.node.isValid) this.sprite.spriteFrame = frame;
      })
      .catch(() => undefined);
  }

  destroy(): void {
    if (this.node.isValid) this.node.destroy();
  }
}
