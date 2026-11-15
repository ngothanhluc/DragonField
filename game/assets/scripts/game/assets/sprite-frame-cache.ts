/**
 * Cắt SpriteFrame lúc runtime.
 *
 * Không slice trong editor (pack không có atlas JSON, Cocos 3.8 không có grid-slice), mỗi PNG là
 * 1 SpriteFrame duy nhất. Mỗi frame hiển thị là một `SpriteFrame` mới trỏ vào cùng texture, rect
 * lấy từ `frameRect()` trong core. Cache theo `sheet|direction|index` để đổi animation không tạo
 * rác mỗi frame.
 */
import { Rect, Size, SpriteFrame as CocosSpriteFrame, Vec2 } from 'cc';
import { frameRect, type Direction, type SpriteEntry } from '../../core/art/manifest';
import { loadTexture } from './texture-cache';

/** Xem ghi chú ở `texture-cache.ts`: stub `cc` khiến tên import chỉ dùng được ở vị trí value. */
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;

const frames = new Map<string, SpriteFrame>();

/** Lấy SpriteFrame của `index` tại `direction`. Texture được load (và cache) theo sheet. */
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
    // Hai caller cùng chờ một texture: caller thứ hai dùng frame caller đầu đã tạo.
    const raced = frames.get(key);
    if (raced !== undefined) {
      return raced;
    }

    const rect = frameRect(entry, direction, index);
    const frame = new CocosSpriteFrame();
    // Thứ tự quan trọng: gán texture trước để SpriteFrame có rect/originalSize khởi tạo.
    frame.texture = texture;
    frame.rect = new Rect(rect.x, rect.y, rect.width, rect.height);
    // Rect = đúng vùng cắt và offset 0 ⇒ frame không bị trim, mọi frame cùng kích thước.
    frame.originalSize = new Size(rect.width, rect.height);
    frame.offset = new Vec2(0, 0);
    frame.packable = false;

    frames.set(key, frame);
    return frame;
  });
}

/** Xoá cache — chỉ dùng cho test/dev. */
export function clearFrameCache(): void {
  frames.clear();
}
