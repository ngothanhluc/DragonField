/**
 * Slice SpriteFrames at runtime.
 *
 * No editor slicing (the pack has no atlas JSON and Cocos 3.8 has no grid-slice), so each PNG is
 * a single SpriteFrame. Every displayed frame is a new `SpriteFrame` pointing at the same texture,
 * with its rect from `frameRect()` in core. Cached by `sheet|direction|index` so animation changes
 * create no garbage per frame.
 */
import { Rect, Size, SpriteFrame as CocosSpriteFrame, Vec2 } from 'cc';
import { frameRect, type Direction, type SpriteEntry } from '../../core/art/manifest';
import { loadTexture } from './texture-cache';

/** See the note in `texture-cache.ts`: the `cc` stub only allows import names in value position. */
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;

const frames = new Map<string, SpriteFrame>();

/** Get the SpriteFrame for `index` at `direction`. The texture is loaded (and cached) per sheet. */
export function getFrame(
  entry: SpriteEntry,
  direction: Direction,
  index: number,
): Promise<SpriteFrame> {
  const key = `${entry.sheet}|${direction}|${index}`;
  const cached = frames.get(key);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  return loadTexture(entry.sheet).then((texture) => {
    // Two callers wait on one texture: the second reuses the frame the first created.
    const raced = frames.get(key);
    if (raced !== undefined) {
      return raced;
    }

    const rect = frameRect(entry, direction, index);
    const frame = new CocosSpriteFrame();
    // Order matters: assign the texture first so SpriteFrame initialises rect/originalSize.
    frame.texture = texture;
    frame.rect = new Rect(rect.x, rect.y, rect.width, rect.height);
    // Rect = the exact crop and a zero offset ⇒ no trimming, so every frame keeps the same size.
    frame.originalSize = new Size(rect.width, rect.height);
    frame.offset = new Vec2(0, 0);
    frame.packable = false;

    frames.set(key, frame);
    return frame;
  });
}

/** Clear the cache — test/dev only. */
export function clearFrameCache(): void {
  frames.clear();
}
