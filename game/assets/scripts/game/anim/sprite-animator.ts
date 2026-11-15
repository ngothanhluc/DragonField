/**
 * Phát animation manifest lên một `Sprite`.
 *
 * Adapter mỏng: frame/hướng do `core/art/runtime.ts` quyết, cắt frame do `sprite-frame-cache.ts`
 * làm. Ở đây chỉ giữ trạng thái và chống ghi đè frame cũ khi `play()` được gọi lại lúc texture
 * còn đang load.
 */
import {
  _decorator,
  Component,
  JsonAsset as CocosJsonAsset,
  Sprite as CocosSprite,
  resources,
  warn,
} from 'cc';
import {
  resolve,
  validateManifest,
  type AnimationManifest,
  type Direction,
  type SpriteEntry,
} from '../../core/art/manifest';
import { frameIndexAt } from '../../core/art/runtime';
import { getFrame } from '../assets/sprite-frame-cache';

/** Stub `cc` chỉ cho dùng tên import ở vị trí value; xem `texture-cache.ts`. */
type JsonAsset = InstanceType<typeof CocosJsonAsset>;
type Sprite = InstanceType<typeof CocosSprite>;

const { ccclass } = _decorator;

const MANIFEST_PATH = 'data/animations';

let manifestPromise: Promise<AnimationManifest> | null = null;

/** Load + validate `resources/data/animations.json` một lần cho cả scene. */
function loadManifest(): Promise<AnimationManifest> {
  if (manifestPromise !== null) return manifestPromise;

  manifestPromise = new Promise<AnimationManifest>((onLoad, onFail) => {
    resources.load(MANIFEST_PATH, CocosJsonAsset, (err: Error | null, asset: JsonAsset | null) => {
      if (err || !asset) {
        onFail(new Error(`Không load được ${MANIFEST_PATH}.json: ${err?.message ?? 'asset rỗng'}`));
        return;
      }
      try {
        onLoad(validateManifest(asset.json));
      } catch (error) {
        onFail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
  // Hỏng thì cho lần play sau thử lại thay vì cache promise rejected.
  manifestPromise.catch(() => {
    manifestPromise = null;
  });
  return manifestPromise;
}

@ccclass('SpriteAnimator')
export class SpriteAnimator extends Component {
  /** Gọi đúng một lần khi clip không loop chạy tới frame cuối. */
  onFinished?: () => void;

  private entry: SpriteEntry | null = null;
  private entryKey = '';
  private facing: Direction = 'down';
  private elapsedMs = 0;
  private requestedIndex = -1;
  private token = 0;
  private finished = false;
  private sprite: Sprite | null = null;

  /** Key đang phát; rỗng khi chưa play hoặc đã stop. */
  get key(): string {
    return this.entryKey;
  }

  /** Hướng dùng để chọn cột của sheet. */
  get direction(): Direction {
    return this.facing;
  }

  /** Phát `key` (vd `player.walk.left`). Không truyền `direction` thì giữ hướng hiện tại. */
  play(key: string, direction?: Direction): void {
    this.entryKey = key;
    this.facing = direction ?? this.facing;
    this.entry = null;
    this.reset();

    loadManifest()
      .then((manifest) => {
        if (this.entryKey !== key || !this.isValid) return; // đã play clip khác
        let found: SpriteEntry;
        try {
          found = resolve(manifest, key);
        } catch (error) {
          warn(error instanceof Error ? error.message : String(error));
          return;
        }
        this.entry = found;
        this.requestFrame(found, 0);
      })
      .catch((error: unknown) => warn(error instanceof Error ? error.message : String(error)));
  }

  /** Đổi hướng; chỉ restart khi hướng thật sự đổi và sheet có cột cho hướng đó. */
  setDirection(dir: Direction): void {
    if (dir === this.facing) return;
    this.facing = dir;

    const entry = this.entry;
    if (entry === null || entry.directions.length === 0) return;

    this.reset();
    this.requestFrame(entry, 0);
  }

  /** Dừng tiến thời gian, giữ frame đang hiển thị. */
  stop(): void {
    this.reset();
    this.entry = null;
    this.entryKey = '';
  }

  update(dt: number): void {
    const entry = this.entry;
    if (entry === null || (!entry.loop && this.finished)) return;

    this.elapsedMs += dt * 1000;
    const index = frameIndexAt(entry, this.elapsedMs);
    if (index !== this.requestedIndex) this.requestFrame(entry, index);

    // Bắn onFinished sau khi đã xin frame cuối: callback thường gọi play() clip kế tiếp, và việc
    // đó tăng token nên request vừa rồi tự bị bỏ — không ghi đè frame của clip mới.
    if (!entry.loop && index === entry.frames - 1) {
      this.finished = true;
      this.onFinished?.();
    }
  }

  /** Quên thời gian đã chạy và mọi frame đang bay; entry do caller quyết định giữ hay bỏ. */
  private reset(): void {
    this.token += 1;
    this.elapsedMs = 0;
    this.requestedIndex = -1;
    this.finished = false;
  }

  /** Frame có thể về sau khi đã `play()` clip khác: so token để bỏ kết quả cũ. */
  private requestFrame(entry: SpriteEntry, index: number): void {
    this.requestedIndex = index;
    const token = this.token;
    getFrame(entry, this.pickDirection(entry), index)
      .then((frame) => {
        if (token !== this.token || !this.isValid) return;
        this.getSprite().spriteFrame = frame;
      })
      .catch((error: unknown) => warn(error instanceof Error ? error.message : String(error)));
  }

  /** Animation 3 hướng (Jump) không có `right`: rơi về cột đầu thay vì để `frameRect` ném lỗi. */
  private pickDirection(entry: SpriteEntry): Direction {
    if (entry.directions.length > 0 && !entry.directions.includes(this.facing)) {
      this.facing = entry.directions[0] ?? this.facing;
    }
    return this.facing;
  }

  /** Sprite có sẵn thì dùng; chưa có thì thêm và tắt auto-resize để scale do scene quyết định. */
  private getSprite(): Sprite {
    if (this.sprite !== null) return this.sprite;

    const existing = this.getComponent(CocosSprite);
    if (existing) {
      this.sprite = existing;
      return existing;
    }

    const created = this.addComponent(CocosSprite);
    created.sizeMode = CocosSprite.SizeMode.CUSTOM;
    created.trim = false;
    this.sprite = created;
    return created;
  }
}
