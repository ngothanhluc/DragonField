/**
 * Nhạc nền + SFX bằng `AudioSource` của engine, một node cho music và một cho
 * SFX (pool do engine lo, không tạo node mỗi tiếng).
 *
 * Hai điểm quan trọng:
 * - **Autoplay**: Chrome chặn audio trước input đầu tiên. Manager giữ track
 *   đang chờ và chỉ `play()` sau `pointerdown`/`keydown` đầu tiên.
 * - **Volume sống**: master volume lấy từ save; đổi ở Settings/Pause áp ngay
 *   cho cả music lẫn SFX, không cần restart run.
 */
import {
  AudioClip as CocosAudioClip,
  AudioSource as CocosAudioSource,
  Node as CocosNode,
  resources,
  warn,
} from 'cc';
import { SFX_IDS, setSfxSink, type SfxId } from './sfx';

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

const SFX_PATH: Readonly<Record<SfxId, string>> = {
  shoot: 'audio/sfx/shoot',
  'enemy-hit': 'audio/sfx/enemy-hit',
  'player-hurt': 'audio/sfx/player-hurt',
  'enemy-death': 'audio/sfx/enemy-death',
  explosion: 'audio/sfx/explosion',
  'boss-phase': 'audio/sfx/boss-phase',
  'skill-pick': 'audio/sfx/skill-pick',
  'ui-move': 'audio/sfx/ui-move',
  'ui-confirm': 'audio/sfx/ui-confirm',
  gold: 'audio/sfx/gold',
  'chapter-clear': 'audio/sfx/chapter-clear',
  'game-over': 'audio/sfx/game-over',
  shield: 'audio/sfx/shield',
  freeze: 'audio/sfx/freeze',
  poison: 'audio/sfx/poison',
};

/** Chỉ giữ 12 tiếng gần nhất cho `audio()` debug (không phình theo thời gian chơi). */
const SFX_HISTORY = 12;
/** Nhạc nền nhỏ hơn SFX để tiếng bắn/hit vẫn nổi. */
const MUSIC_LEVEL = 0.55;

const clipCache = new Map<string, Promise<AudioClip>>();

function loadClip(path: string): Promise<AudioClip> {
  const cached = clipCache.get(path);
  if (cached !== undefined) return cached;

  const task = new Promise<AudioClip>((resolve, reject) => {
    resources.load(path, CocosAudioClip, (err: Error | null, clip: AudioClip | null) => {
      // Cocos gọi `null` hoặc `undefined` khi thành công — kiểm bằng truthiness.
      if (err || !clip) {
        reject(new Error(`Không load được audio "${path}": ${err?.message ?? 'clip rỗng'}`));
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
  /** Lần lượt các SFX đã phát, mới nhất ở cuối. */
  readonly lastSfx: readonly SfxId[];
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

  /** Track đang chờ (trước unlock) hoặc đang phát. */
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

  /** Đổi nhạc; gọi lại cùng track đang phát là no-op. */
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
    this.lastSfx.push(id);
    if (this.lastSfx.length > SFX_HISTORY) this.lastSfx.shift();
    if (!this.unlocked || this.destroyed) return;

    loadClip(SFX_PATH[id])
      .then((clip) => {
        if (!this.destroyed) this.sfx.playOneShot(clip, 1);
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
    };
  }

  /** Preload mọi clip để lần phát đầu không trễ; lỗi chỉ warn. */
  preload(): void {
    const paths = [...Object.values(MUSIC_PATH), ...Object.values(SFX_PATH)];
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

  /** Chỉ dùng test: danh sách id để soát map path. */
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
