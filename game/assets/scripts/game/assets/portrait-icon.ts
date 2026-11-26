/**
 * 64×64 Hero Portrait loading & crisp nearest-filtered UI sprite builder (M19, ADR-027).
 *
 * Resolves logical portrait keys (`icon.portrait-ninja`, `icon.portrait-archer`,
 * `icon.portrait-mage`, `icon.portrait-cultivator`) from `animations.json` (falling back to
 * `HERO_PORTRAIT_SHEETS` when standalone screen tests run without a loaded manifest), loads
 * textures via `loadPixelTexture` (`NEAREST, NEAREST` filtering), slices exact 64×64 `SpriteFrame`s,
 * and enforces `Sprite.SizeMode.CUSTOM` + `UITransform.setContentSize` so UI portraits never blur
 * or stretch to Cocos's 100×100 default (`AGENTS.md` traps).
 */
import {
  Layers,
  Node as CocosNode,
  Rect,
  Size,
  Sprite as CocosSprite,
  SpriteFrame as CocosSpriteFrame,
  UITransform as CocosUITransform,
  Vec2,
} from 'cc';
import type { AnimationManifest } from '../../core/art/manifest';
import {
  PORTRAIT_SOURCE_SIZE_PX,
  characterPortraitSheet,
  type CharacterId,
} from '../../core/characters/roster';
import { loadPixelTexture } from './texture-cache';

type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** Source texel size of every staged M19 portrait (`64×64`). */
export const HERO_PORTRAIT_SIZE_PX = PORTRAIT_SOURCE_SIZE_PX;

const frames = new Map<string, SpriteFrame>();
const inflight = new Map<string, Promise<SpriteFrame>>();

/** Load a character's 64×64 nearest-filtered portrait `SpriteFrame` (deduplicated & cached). */
export function loadCharacterPortrait(
  id: CharacterId | string | undefined,
  manifest?: AnimationManifest | null,
): Promise<SpriteFrame> {
  return loadPortraitSheet(characterPortraitSheet(id, manifest));
}

/** Return an already-cached portrait `SpriteFrame`, or `undefined` while still loading. */
export function cachedCharacterPortrait(
  id: CharacterId | string | undefined,
  manifest?: AnimationManifest | null,
): SpriteFrame | undefined {
  return frames.get(characterPortraitSheet(id, manifest));
}

/** Clear cached portrait frames — test/dev only. */
export function clearPortraitCache(): void {
  frames.clear();
  inflight.clear();
}

/**
 * Create a `UI_2D` portrait `Sprite` node with `Type.SIMPLE`, `SizeMode.CUSTOM`, `trim = false`,
 * and mandatory `UITransform.setContentSize(width, height)` (`AGENTS.md` 100×100 trap guard).
 */
export function createPortraitSpriteNode(
  parent: Node,
  name: string,
  width: number,
  height: number,
  initialFrame: SpriteFrame | null = null,
): { readonly node: Node; readonly sprite: Sprite; readonly transform: UITransform | null } {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SIMPLE;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;
  if (initialFrame !== null) {
    sprite.spriteFrame = initialFrame;
  }

  const transform: UITransform | null =
    node.getComponent(CocosUITransform) ?? node.addComponent(CocosUITransform);
  if (transform !== null) {
    transform.setContentSize(width, height);
  }

  return { node, sprite, transform };
}

function loadPortraitSheet(sheet: string): Promise<SpriteFrame> {
  const cached = frames.get(sheet);
  if (cached !== undefined) return Promise.resolve(cached);

  const running = inflight.get(sheet);
  if (running !== undefined) return running;

  const task = loadPixelTexture(sheet).then((texture) => {
    const raced = frames.get(sheet);
    if (raced !== undefined) return raced;

    const frame = new CocosSpriteFrame();
    // Assign texture first so Cocos SpriteFrame initializes rect/originalSize cleanly.
    frame.texture = texture;
    frame.rect = new Rect(0, 0, HERO_PORTRAIT_SIZE_PX, HERO_PORTRAIT_SIZE_PX);
    frame.originalSize = new Size(HERO_PORTRAIT_SIZE_PX, HERO_PORTRAIT_SIZE_PX);
    frame.offset = new Vec2(0, 0);
    frame.packable = false;

    frames.set(sheet, frame);
    return frame;
  });

  inflight.set(sheet, task);
  task
    .catch(() => {
      if (inflight.get(sheet) === task) inflight.delete(sheet);
    })
    .finally(() => {
      inflight.delete(sheet);
    });

  return task;
}
