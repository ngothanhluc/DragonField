/**
 * Background music + SFX through the engine's `AudioSource`: one node for music, one for
 * SFX (the engine owns the pool; no node per sound).
 *
 * Key points:
 * - **Autoplay**: Chrome blocks audio until the first input. The manager holds the pending
 *   track and only calls `play()` after the first `pointerdown`/`keydown`.
 * - **Perceptual channel mixing (M15)**: separate `musicVolume` and `sfxVolume` sliders map
 *   through `computeChannelGains` (squared curve + music headroom) and apply live.
 * - **Smooth ducking (M15)**: `AudioDuckDriver` steps `MusicDucker` every rendered frame on
 *   `this.node` (including while combat simulation is paused in Pause or `skill-pick`),
 *   touching `AudioSource.volume` only while the duck factor is actively changing.
 */
import {
  _decorator,
  AudioClip as CocosAudioClip,
  AudioSource as CocosAudioSource,
  Component,
  Node as CocosNode,
  resources,
  warn,
} from "cc";
import {
  DEFAULT_CHANNEL_VOLUME,
  MusicDucker,
  clampVolume01,
  computeChannelGains,
} from "../../core/audio/mixer";
import {
  SFX_BANK,
  VariantPicker,
  sfxVolumeScale,
  type SfxId,
} from "../../core/audio/sfx-bank";
import { bossMusicPath } from "../../core/boss/boss-pool";
import type { BossId } from "../../core/boss/boss-defs";
import { VILLAGE_MUSIC_PATH } from "../../core/hub/hub-tmx";
import { SeededRng } from "../../core/rng";
import { SFX_IDS, setSfxSink } from "./sfx";

const { ccclass } = _decorator;

type AudioClip = InstanceType<typeof CocosAudioClip>;
type AudioSource = InstanceType<typeof CocosAudioSource>;
type Node = InstanceType<typeof CocosNode>;

export type MusicId =
  | "title"
  | "village"
  | "chapter-1"
  | "chapter-2"
  | "chapter-3"
  | "boss"
  | "boss-squid"
  | "boss-samurai"
  | "boss-frog"
  | "boss-slime"
  | "boss-bamboo"
  | "boss-racoon"
  | "boss-redtengu";

/**
 * Boss themes (#43, #44): one track per boss, path from core so there is a single source.
 * Tengu keeps the original `boss` id ("17 - Fight").
 */
const MUSIC_PATH: Readonly<Record<MusicId, string>> = {
  title: "audio/music/title",
  village: VILLAGE_MUSIC_PATH,
  "chapter-1": "audio/music/chapter-1",
  "chapter-2": "audio/music/chapter-2",
  "chapter-3": "audio/music/chapter-3",
  boss: bossMusicPath("tengu"),
  "boss-squid": bossMusicPath("squid"),
  "boss-samurai": bossMusicPath("samurai"),
  "boss-frog": bossMusicPath("frog"),
  "boss-slime": bossMusicPath("slime"),
  "boss-bamboo": bossMusicPath("bamboo"),
  "boss-racoon": bossMusicPath("racoon"),
  "boss-redtengu": bossMusicPath("redtengu"),
};

/** Music id of a boss's own theme — the id `playMusic` wants. */
const BOSS_MUSIC_ID: Readonly<Record<BossId, MusicId>> = {
  tengu: "boss",
  squid: "boss-squid",
  samurai: "boss-samurai",
  frog: "boss-frog",
  slime: "boss-slime",
  bamboo: "boss-bamboo",
  racoon: "boss-racoon",
  redtengu: "boss-redtengu",
};

export function bossMusicId(id: BossId): MusicId {
  return BOSS_MUSIC_ID[id];
}

/** Keep only the 12 most recent sounds for the `audio()` debug hook (no growth over play time). */
const SFX_HISTORY = 12;

const clipCache = new Map<string, Promise<AudioClip>>();

function loadClip(path: string): Promise<AudioClip> {
  const cached = clipCache.get(path);
  if (cached !== undefined) return cached;

  const task = new Promise<AudioClip>((resolve, reject) => {
    resources.load(
      path,
      CocosAudioClip,
      (err: Error | null, clip: AudioClip | null) => {
        // Cocos calls back with `null` or `undefined` on success — check by truthiness.
        if (err || !clip) {
          reject(
            new Error(
              `Could not load audio "${path}": ${err?.message ?? "empty clip"}`,
            ),
          );
          return;
        }
        resolve(clip);
      },
    );
  });
  clipCache.set(path, task);
  task.catch(() => {
    if (clipCache.get(path) === task) clipCache.delete(path);
  });
  return task;
}

export interface AudioSnapshot {
  readonly unlocked: boolean;
  /** Backwards-compatible aggregate volume (`Math.max(musicVolume, sfxVolume)`). */
  readonly volume: number;
  readonly musicVolume: number;
  readonly sfxVolume: number;
  readonly musicGain: number;
  readonly sfxGain: number;
  readonly ducked: boolean;
  readonly duckFactor: number;
  readonly music: MusicId | null;
  /** SFX played in order, most recent last. */
  readonly lastSfx: readonly SfxId[];
  /** The full bank (event → resource paths), so headless acceptance sees every declared sound. */
  readonly bank: Readonly<Record<string, readonly string[]>>;
  /** Resource path actually chosen for each entry of `lastSfx` (same order and cap). */
  readonly lastClips: readonly string[];
}

/**
 * Tiny component attached to `AudioManager`'s persistent node so `stepDucking(dt)` advances
 * automatically every rendered frame, even while combat simulation is paused in Pause / Level-up.
 */
@ccclass("AudioDuckDriver")
export class AudioDuckDriver extends Component {
  private manager: AudioManager | null = null;

  bind(manager: AudioManager | null): void {
    this.manager = manager;
  }

  update(dt: number): void {
    this.manager?.stepDucking(dt);
  }
}

export class AudioManager {
  private readonly node: Node;
  private readonly music: AudioSource;
  private readonly sfx: AudioSource;
  private readonly duckDriver: AudioDuckDriver;
  private readonly ducker = new MusicDucker();
  private unlocked = false;
  private musicVolume = DEFAULT_CHANNEL_VOLUME;
  private sfxVolume = DEFAULT_CHANNEL_VOLUME;
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
    this.node = new CocosNode("audio");
    this.node.parent = parent;
    this.duckDriver = this.node.addComponent(AudioDuckDriver);
    this.duckDriver.bind(this);

    const musicNode = new CocosNode("music");
    musicNode.parent = this.node;
    this.music = musicNode.addComponent(CocosAudioSource);
    this.music.loop = true;

    const sfxNode = new CocosNode("sfx");
    sfxNode.parent = this.node;
    this.sfx = sfxNode.addComponent(CocosAudioSource);

    this.applyVolume();
    setSfxSink((id) => this.playSfx(id));
    window.addEventListener("pointerdown", this.onFirstInput, true);
    window.addEventListener("keydown", this.onFirstInput, true);
  }

  /** The pending track (before unlock) or the one playing. */
  get musicId(): MusicId | null {
    return this.current ?? this.pending;
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = clampVolume01(volume);
    this.applyVolume();
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = clampVolume01(volume);
    this.applyVolume();
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  /**
   * Backwards-compatible convenience wrapper setting both Music and SFX channels.
   * Kept so existing callers compile cleanly until separate sliders are wired.
   */
  setVolume(volume: number): void {
    const clamped = clampVolume01(volume);
    this.musicVolume = clamped;
    this.sfxVolume = clamped;
    this.applyVolume();
  }

  /** Backwards-compatible aggregate volume (`Math.max(musicVolume, sfxVolume)`). */
  getVolume(): number {
    return Math.max(this.musicVolume, this.sfxVolume);
  }

  setMusicDucked(ducked: boolean): void {
    this.ducker.setDucked(ducked);
  }

  isMusicDucked(): boolean {
    return this.ducker.isDucked;
  }

  /** Advance smooth music ducking by `dtSec`; touches `this.music.volume` only when factor changes. */
  stepDucking(dtSec: number): boolean {
    if (this.destroyed) return false;
    const changed = this.ducker.step(dtSec);
    if (changed) {
      this.applyMusicGain();
    }
    return changed;
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
        if (this.destroyed || token !== this.token || this.pending !== id)
          return;
        this.music.stop();
        this.music.clip = clip;
        this.music.loop = true;
        this.applyMusicGain();
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
    const { musicGain, sfxGain } = computeChannelGains(
      this.musicVolume,
      this.sfxVolume,
      this.ducker.factor,
    );
    return {
      unlocked: this.unlocked,
      volume: this.getVolume(),
      musicVolume: this.musicVolume,
      sfxVolume: this.sfxVolume,
      musicGain,
      sfxGain,
      ducked: this.ducker.isDucked,
      duckFactor: this.ducker.factor,
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
    this.duckDriver.bind(null);
    setSfxSink(null);
    window.removeEventListener("pointerdown", this.onFirstInput, true);
    window.removeEventListener("keydown", this.onFirstInput, true);
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
    window.removeEventListener("pointerdown", this.onFirstInput, true);
    window.removeEventListener("keydown", this.onFirstInput, true);

    const pending = this.pending;
    if (pending !== null) {
      this.current = null;
      this.playMusic(pending);
    }
  };

  private applyMusicGain(): void {
    const { musicGain } = computeChannelGains(
      this.musicVolume,
      this.sfxVolume,
      this.ducker.factor,
    );
    this.music.volume = musicGain;
  }

  private applyVolume(): void {
    const { musicGain, sfxGain } = computeChannelGains(
      this.musicVolume,
      this.sfxVolume,
      this.ducker.factor,
    );
    this.music.volume = musicGain;
    this.sfx.volume = sfxGain;
  }
}
