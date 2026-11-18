/**
 * Background music + SFX through the engine's `AudioSource`: one node for music, one for
 * SFX (the engine owns the pool; no node per sound).
 *
 * Two important points:
 * - **Autoplay**: Chrome blocks audio until the first input. The manager holds the pending
 *   track and only calls `play()` after the first `pointerdown`/`keydown`.
 * - **Live volume**: master volume comes from the save; changing it in Settings/Pause applies
 *   to music and SFX immediately, without restarting the run.
 */
import {
  AudioClip as CocosAudioClip,
  AudioSource as CocosAudioSource,
  Node as CocosNode,
  resources,
  warn,
} from 'cc';
import {
  SFX_BANK,
  VariantPicker,
  sfxVolumeScale,
  type SfxId,
} from '../../core/audio/sfx-bank';
import { SeededRng } from '../../core/rng';
import { SFX_IDS, setSfxSink } from './sfx';

type AudioClip = InstanceType<typeof CocosAudioClip>;
type AudioSource = InstanceType<typeof CocosAudioSource>;
type Node = InstanceType<typeof CocosNode>;

export type MusicId = 'title' | 'chapter-1' | 'chapter-2' | 'chapter-3' | 'boss';

const MUSIC_PATH: Readonly<Record<MusicId, string>> = {
  title: 'audio/music/title',
  'chapter-1': 'audio/music/chapter-1',
  'chapter-2': 'audio/music/chapter-2',
  'chapter-3': 'audio/music/chapter-3',
  boss: 'audio/music/boss',
};

/** Keep only the 12 most recent sounds for the `audio()` debug hook (no growth over play time). */
const SFX_HISTORY = 12;
/** Music sits below SFX so shots/hits still stand out. */
const MUSIC_LEVEL = 0.55;

const clipCache = new Map<string, Promise<AudioClip>>();

function loadClip(path: string): Promise<AudioClip> {
  const cached = clipCache.get(path);
  if (cached !== undefined) return cached;

  const task = new Promise<AudioClip>((resolve, reject) => {
    resources.load(path, CocosAudioClip, (err: Error | null, clip: AudioClip | null) => {
      // Cocos calls back with `null` or `undefined` on success — check by truthiness.
      if (err || !clip) {
        reject(new Error(`Could not load audio "${path}": ${err?.message ?? 'empty clip'}`));
        return;
      }
      resolve(clip);
    });
  });
  clipCache.set(path, task);
  task.catch(() => {
    if (clipCache.get(path) === task) clipCache.delete(path);
  });
  return task;
}

export interface AudioSnapshot {
  readonly unlocked: boolean;
  readonly volume: number;
  readonly music: MusicId | null;
  /** SFX played in order, most recent last. */
  readonly lastSfx: readonly SfxId[];
  /** The full bank (event → resource paths), so headless acceptance sees every declared sound. */
  readonly bank: Readonly<Record<string, readonly string[]>>;
  /** Resource path actually chosen for each entry of `lastSfx` (same order and cap). */
  readonly lastClips: readonly string[];
}

export class AudioManager {
  private readonly node: Node;
  private readonly music: AudioSource;
  private readonly sfx: AudioSource;
  private unlocked = false;
  private volume = 0.8;
  private current: MusicId | null = null;
  private pending: MusicId | null = null;
  private token = 0;
  private readonly lastSfx: SfxId[] = [];
  private readonly lastClips: string[] = [];
  /** SFX variation (which file, how loud) — seeded from the clock, it is presentation only. */
  private readonly rng = new SeededRng(Date.now());
  private readonly variants = new VariantPicker(this.rng);
  private destroyed = false;

  constructor(parent: Node) {
    this.node = new CocosNode('audio');
    this.node.parent = parent;

    const musicNode = new CocosNode('music');
    musicNode.parent = this.node;
    this.music = musicNode.addComponent(CocosAudioSource);
    this.music.loop = true;

    const sfxNode = new CocosNode('sfx');
    sfxNode.parent = this.node;
    this.sfx = sfxNode.addComponent(CocosAudioSource);

    this.applyVolume();
    setSfxSink((id) => this.playSfx(id));
    window.addEventListener('pointerdown', this.onFirstInput, true);
    window.addEventListener('keydown', this.onFirstInput, true);
  }

  /** The pending track (before unlock) or the one playing. */
  get musicId(): MusicId | null {
    return this.current ?? this.pending;
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
    this.applyVolume();
  }

  getVolume(): number {
    return this.volume;
  }

  /** Change music; calling again with the current track is a no-op. */
  playMusic(id: MusicId): void {
    if (!this.unlocked) {
      this.pending = id;
      return;
    }
    if (this.current === id && this.music.playing) return;

    this.pending = id;
    this.token += 1;
    const token = this.token;

    loadClip(MUSIC_PATH[id])
      .then((clip) => {
        if (this.destroyed || token !== this.token || this.pending !== id) return;
        this.music.stop();
        this.music.clip = clip;
        this.music.loop = true;
        this.music.play();
        this.current = id;
      })
      .catch((error: unknown) => {
        warn(error instanceof Error ? error.message : String(error));
      });
  }

  stopMusic(): void {
    this.token += 1;
    this.current = null;
    this.pending = null;
    this.music.stop();
    this.music.clip = null;
  }

  playSfx(id: SfxId): void {
    const path = this.variants.pick(id);
    this.lastSfx.push(id);
    this.lastClips.push(path);
    if (this.lastSfx.length > SFX_HISTORY) {
      this.lastSfx.shift();
      this.lastClips.shift();
    }
    if (!this.unlocked || this.destroyed) return;

    const volumeScale = sfxVolumeScale(this.rng);
    loadClip(path)
      .then((clip) => {
        if (!this.destroyed) this.sfx.playOneShot(clip, volumeScale);
      })
      .catch((error: unknown) => {
        warn(error instanceof Error ? error.message : String(error));
      });
  }

  snapshot(): AudioSnapshot {
    return {
      unlocked: this.unlocked,
      volume: this.volume,
      music: this.current ?? this.pending,
      lastSfx: Array.from(this.lastSfx),
      bank: SFX_BANK,
      lastClips: Array.from(this.lastClips),
    };
  }

  /** Preload every clip so the first playback is not late; failures only warn. */
  preload(): void {
    const paths: string[] = Array.from(Object.values(MUSIC_PATH));
    for (const files of Object.values(SFX_BANK)) paths.push(...files);
    for (const path of paths) {
      loadClip(path).catch((error: unknown) => {
        warn(error instanceof Error ? error.message : String(error));
      });
    }
  }

  destroy(): void {
    this.destroyed = true;
    setSfxSink(null);
    window.removeEventListener('pointerdown', this.onFirstInput, true);
    window.removeEventListener('keydown', this.onFirstInput, true);
    this.music.stop();
    this.sfx.stop();
    if (this.node.isValid) this.node.destroy();
  }

  /** Test use only: the id list, to audit the path map. */
  static get sfxIds(): readonly SfxId[] {
    return SFX_IDS;
  }

  private readonly onFirstInput = (): void => {
    if (this.unlocked) return;
    this.unlocked = true;
    window.removeEventListener('pointerdown', this.onFirstInput, true);
    window.removeEventListener('keydown', this.onFirstInput, true);

    const pending = this.pending;
    if (pending !== null) {
      this.current = null;
      this.playMusic(pending);
    }
  };

  private applyVolume(): void {
    this.music.volume = this.volume * MUSIC_LEVEL;
    this.sfx.volume = this.volume;
  }
}
