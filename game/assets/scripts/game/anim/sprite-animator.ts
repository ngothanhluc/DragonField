/**
 * Play manifest animations on one `Sprite`.
 *
 * Thin adapter: `core/art/runtime.ts` decides frames/direction, `sprite-frame-cache.ts`
 * slices frames. This file only keeps state and prevents stale frames from overwriting a newer
 * clip when `play()` is called again while a texture is still loading.
 */
import {
  _decorator,
  Component,
  JsonAsset as CocosJsonAsset,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
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
import { entryAnchorY, frameIndexAt } from '../../core/art/runtime';
import { getFrame } from '../assets/sprite-frame-cache';

/** The `cc` stub only allows import names in value position; see `texture-cache.ts`. */
type JsonAsset = InstanceType<typeof CocosJsonAsset>;
type Sprite = InstanceType<typeof CocosSprite>;

const { ccclass } = _decorator;

const MANIFEST_PATH = 'data/animations';

/**
 * Animation keys that failed (missing from the manifest / bad texture). The debug
 * `placeholders()` reads this list — empty means "no placeholder art left".
 */
const animationProblems: string[] = [];

/** Record an art problem so `placeholders()` can report it instead of just `console.warn`. */
export function reportAnimationProblem(message: string): void {
  if (animationProblems.includes(message)) return;
  animationProblems.push(message);
  warn(message);
}

/** Snapshot of art problems (empty = every animation resolves). */
export function animationProblemSnapshot(): readonly string[] {
  return Array.from(animationProblems);
}

/** Clear the problem log — debug/test use only. */
export function clearAnimationProblems(): void {
  animationProblems.length = 0;
}


let manifestPromise: Promise<AnimationManifest> | null = null;

/** Load + validate `resources/data/animations.json` once per scene. */
export function loadAnimationManifest(): Promise<AnimationManifest> {
  if (manifestPromise !== null) return manifestPromise;

  manifestPromise = new Promise<AnimationManifest>((onLoad, onFail) => {
    resources.load(MANIFEST_PATH, CocosJsonAsset, (err: Error | null, asset: JsonAsset | null) => {
      if (err || !asset) {
        onFail(new Error(`Could not load ${MANIFEST_PATH}.json: ${err?.message ?? 'empty asset'}`));
        return;
      }
      try {
        onLoad(validateManifest(asset.json));
      } catch (error) {
        onFail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
  // On failure, let the next play retry instead of caching a rejected promise.
  manifestPromise.catch(() => {
    manifestPromise = null;
  });
  return manifestPromise;
}

@ccclass('SpriteAnimator')
export class SpriteAnimator extends Component {
  /** Called exactly once when a non-looping clip reaches its last frame. */
  onFinished?: () => void;

  private entry: SpriteEntry | null = null;
  private entryKey = '';
  private facing: Direction = 'down';
  private elapsedMs = 0;
  private requestedIndex = -1;
  private token = 0;
  private finished = false;
  private sprite: Sprite | null = null;
  /** Playback speed factor (player walk scales with velocity — GDD §12.2). */
  private playbackScale = 1;
  /** Vertical anchor of the current entry, kept to re-apply when the engine resets UITransform. */
  private anchorY = 0.5;
  private frameWidth = 0;
  private frameHeight = 0;

  /** Key currently playing; empty before play or after stop. */
  get key(): string {
    return this.entryKey;
  }

  /** Direction used to pick the sheet column. */
  get direction(): Direction {
    return this.facing;
  }

  /**
   * Playback time scale. `1` = the manifest fps exactly; player walk uses
   * `speed / walkSpeed` so the feet do not slide when a skill changes the speed.
   */
  setPlaybackScale(scale: number): void {
    this.playbackScale = Number.isFinite(scale) && scale > 0 ? Math.min(4, Math.max(0.1, scale)) : 1;
  }

  get currentPlaybackScale(): number {
    return this.playbackScale;
  }

  /** Current frame size (texture px) — views use it to compute the feet offset. */
  get frameSize(): { readonly width: number; readonly height: number } {
    return { width: this.frameWidth, height: this.frameHeight };
  }

  /** Current vertical anchor (0..1) — readable by debug/pivot tests. */
  get anchorYRatio(): number {
    return this.anchorY;
  }

  /** Current frame index (0-based) so attachments can track live animation bob. */
  get frameIndex(): number {
    return Math.max(0, this.requestedIndex);
  }

  /** Whether a non-looping clip has finished (holding the last frame). */
  get isFinished(): boolean {
    return this.finished;
  }

  /**
   * Play `key` (e.g. `player.walk.left`). Without `direction`, the current facing is kept.
   * When `fallbackKey` is supplied and `key` is absent from the manifest, `resolve()` falls
   * back cleanly without reporting a placeholder problem.
   */
  play(key: string, direction?: Direction, fallbackKey?: string): void {
    this.entryKey = key;
    this.facing = direction ?? this.facing;
    this.entry = null;
    this.reset();

    const playToken = this.token;
    loadAnimationManifest()
      .then((manifest) => {
        if (playToken !== this.token || !this.isValid) return; // another clip was played or stopped
        let found: SpriteEntry;
        try {
          found = resolve(manifest, key, fallbackKey);
        } catch (error) {
          reportAnimationProblem(error instanceof Error ? error.message : String(error));
          return;
        }
        if (manifest.sprites[key] === undefined && fallbackKey !== undefined) {
          this.entryKey = fallbackKey;
        }
        this.entry = found;
        this.applyFrameGeometry(found);
        this.requestFrame(found, 0);
      })
      .catch((error: unknown) => reportAnimationProblem(error instanceof Error ? error.message : String(error)));
  }

  /** Change facing; only restarts when the direction really changes and the sheet has that column. */
  setDirection(dir: Direction): void {
    if (dir === this.facing) return;
    this.facing = dir;

    const entry = this.entry;
    if (entry === null || entry.directions.length === 0) return;

    this.reset();
    this.requestFrame(entry, 0);
  }

  /** Stop advancing time, keeping the frame on screen. */
  stop(): void {
    this.reset();
    this.entry = null;
    this.entryKey = '';
  }

  update(dt: number): void {
    const entry = this.entry;
    if (entry === null || (!entry.loop && this.finished)) return;

    this.elapsedMs += dt * 1000 * this.playbackScale;
    const index = frameIndexAt(entry, this.elapsedMs);
    if (index !== this.requestedIndex) this.requestFrame(entry, index);

    // Fire onFinished after requesting the last frame: the callback usually plays the next clip,
    // which bumps the token so this request is dropped — it cannot overwrite the new clip's frame.
    if (!entry.loop && index === entry.frames - 1) {
      this.finished = true;
      this.onFinished?.();
    }
  }

  /** Forget elapsed time and any in-flight frames; the caller decides whether to keep the entry. */
  private reset(): void {
    this.token += 1;
    this.elapsedMs = 0;
    this.requestedIndex = -1;
    this.finished = false;
  }

  /** A frame may arrive after another clip was requested: compare tokens to drop stale results. */
  private requestFrame(entry: SpriteEntry, index: number): void {
    this.requestedIndex = index;
    const token = this.token;
    getFrame(entry, this.pickDirection(entry), index)
      .then((frame) => {
        if (token !== this.token || !this.isValid) return;
        this.getSprite().spriteFrame = frame;
      })
      .catch((error: unknown) =>
        reportAnimationProblem(error instanceof Error ? error.message : String(error)),
      );
  }

  /**
   * Anchor the frame by its feet (actors) or centre (FX) and set contentSize to the frame size.
   *
   * `sizeMode = CUSTOM` + UITransform decide the rendered size; without this step a
   * 96×96 samurai renders as the old 96×48, and the default anchor (0.5, 0.5) makes the
   * feet jump when switching to a sheet of a different height.
   */
  private applyFrameGeometry(entry: SpriteEntry): void {
    this.anchorY = entryAnchorY(entry);
    this.frameWidth = entry.frameWidth;
    this.frameHeight = entry.frameHeight;

    // Sprite requires UITransform — create the Sprite first so the transform definitely exists.
    this.getSprite();
    const transform = this.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setAnchorPoint(0.5, this.anchorY);
      transform.setContentSize(entry.frameWidth, entry.frameHeight);
    }
  }

  /** 3-direction animations (Jump) have no `right`: fall back to the first column instead of letting `frameRect` throw. */
  private pickDirection(entry: SpriteEntry): Direction {
    if (entry.directions.length > 0 && !entry.directions.includes(this.facing)) {
      this.facing = entry.directions[0] ?? this.facing;
    }
    return this.facing;
  }

  /** Reuse an existing Sprite; otherwise add one and turn off auto-resize so the scene owns scale. */
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
