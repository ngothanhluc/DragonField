/**
 * Điểm vào duy nhất của scene: gắn component này lên **một** node là game chạy.
 *
 * Dựng toàn bộ bằng code (không prefab, không sửa `.scene` — quy tắc 5 trong AGENTS.md):
 *
 * ```text
 * animations.json (validate) ─┐
 * save (localStorage)        ─┼─> title ─> chapter select ─> loadDir .tmx ─> parse TMX ─> room + player + HUD ─> wave 1
 * ```
 *
 * Phòng là **dữ liệu**: bootstrap load mọi `.tmx` trong `data/levels/chapter-<n>/`
 * (`resources.loadDir`), parse bằng đúng parser mà vitest dùng
 * (`core/level/tmx.ts`), sắp theo property `room` (`core/level/chapter.ts`) rồi tạo
 * `RunState` với **tổng số phòng lấy từ dữ liệu** — thêm `room-10.tmx` là HUD hiện
 * `x/10`, không sửa code.
 *
 * Vòng chạy nằm trong `update()` và gọi tuần tự player → enemy → đạn → va chạm, đúng thứ
 * tự `core/sim/run-simulation.ts`, để hành vi trong engine khớp với thứ đã được đo
 * balance ở sim.
 *
 * Boss thật của GDD §5 (`core/boss/boss-defs.ts`): 3 phase, pattern đọc được.
 * Dọn sạch phòng boss ⇒ CHAPTER CLEAR ⇒ result (thắng) ⇒ chapter select.
 */
import {
  _decorator,
  Camera as CocosCamera,
  Canvas as CocosCanvas,
  Color as CocosColor,
  Component,
  JsonAsset as CocosJsonAsset,
  Layers,
  Node as CocosNode,
  RenderRoot2D,
  ResolutionPolicy,
  Sprite as CocosSprite,
  TiledMapAsset as CocosTiledMapAsset,
  resources,
  view,
} from 'cc';
import { resolve, validateManifest } from '../core/art/manifest';
import type { AnimationManifest } from '../core/art/manifest';
import { bossForSpriteName } from '../core/boss/boss-defs';
import { DEFAULT_COMBAT } from '../core/config';
import { nextWaveIndex } from '../core/enemies/waves';
import { chapterFromLevels } from '../core/level/chapter';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
import type { ChapterData, EnemyRole, LevelData } from '../core/level/level-data';
import { parseTmxLevel } from '../core/level/tmx';
import { parseWaterLayout, waterAreasFor } from '../core/level/water-layout';
import type { WaterLayout } from '../core/level/water-layout';
import type { Vec2 } from '../core/math/vec2';
import { metaBaseline } from '../core/meta/run-stats';
import { SeededRng } from '../core/rng';
import { RunState } from '../core/run/run-state';
import { RunRewards } from '../core/run/run-rewards';
import { chapterGate } from '../core/save/chapter-gate';
import { withBest } from '../core/save/save-data';
import type { SaveData } from '../core/save/save-data';
import type { SaveRepository } from '../core/save/storage';
import { SpriteAnimator } from './anim/sprite-animator';
import { preloadSheets } from './assets/texture-cache';
import { createBanner } from './banner-ui';
import { BossPhaseBanner, spawnBossForRoom } from './boss-flow';
import { BulletView, ENEMY_BULLET_SHEET, PLAYER_BULLET_SHEET } from './bullet-view';
import { CombatLoop, STRESS_ENEMY_BULLETS } from './combat-loop';
import type { DebugStatus, DebugUiText } from './debug-api';
import { TELEGRAPH_RING_SHEET } from './enemy-view';
import { createFxPool } from './fx/effect-pool';
import type { FxPool } from './fx/effect-pool';
import { FpsMeter } from './fps-meter';
import { Hud, HEART_SHEET } from './hud';
import { syncCombatHud } from './hud-sync';
import { ACTOR_SCALE, buildRoom, obstacleSheets } from './level-view';
import { PlayerController } from './player-controller';
import { attachRoomWater } from './room-water';
import { WorldCamera } from './world-camera';
import { AudioManager } from './audio/audio-manager';
import type { MusicId } from './audio/audio-manager';
import { playSfx } from './audio/sfx';
import { installDebugWiring } from './debug-wiring';
import { createSaveRepository } from './save-storage';
import { ScreenFlow } from './screen-flow';
import type { RunSnapshot } from './screen-flow';
import { SkillPreview } from './skill-preview';
import { SkillRun } from './skill-run';
import { collectUiText } from './ui-text';

const { ccclass } = _decorator;

/** `cc` là module any trong repo: type phải suy ra từ import value (xem `texture-cache.ts`). */
type Camera = InstanceType<typeof CocosCamera>;
type Canvas = InstanceType<typeof CocosCanvas>;
type Color = InstanceType<typeof CocosColor>;
type JsonAsset = InstanceType<typeof CocosJsonAsset>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type TiledMapAsset = InstanceType<typeof CocosTiledMapAsset>;

/** Đường dẫn resources (không có `resources/`, không có phần mở rộng). */
const MANIFEST_PATH = 'data/animations';

/**
 * Thư mục TMX của từng chapter **có dữ liệu trong build này** (M4: cả 3).
 * Thêm chapter = thêm folder + một dòng ở đây; chapter select tự hiện.
 */
const CHAPTER_FOLDERS: Readonly<Record<number, string>> = {
  1: 'data/levels/chapter-1',
  2: 'data/levels/chapter-2',
  3: 'data/levels/chapter-3',
};

/**
 * Trần thời gian một frame. Tab bị ẩn vài giây rồi quay lại sẽ có `dt` rất lớn; kẹp lại
 * để enemy không nhảy xuyên phòng và i-frame không bị "ăn" hết trong một frame.
 */
const MAX_STEP_MS = 50;

const END_LOSS_COLOR = new CocosColor(255, 96, 96, 255);
const END_WIN_COLOR = new CocosColor(255, 230, 120, 255);

/** Design resolution = đúng một phòng 32×18 tile 16 px (512×288). */
const DESIGN_WIDTH = ROOM_COLS * TILE_SIZE_PX;
const DESIGN_HEIGHT = ROOM_ROWS * TILE_SIZE_PX;

/** Thời gian giữ chữ "ROOM CLEAR" trước khi sang phòng kế, giây. */
const ROOM_CLEAR_BANNER_SECONDS = 1;

/**
 * Monster theo vai trò của từng chapter (GDD §4). Key phải khớp manifest — không có
 * gạch nối (`bluebat`, không phải `blue-bat`).
 *
 * Chapter 1 dùng `greenoctopus` cho caster thay `eye`: eye xanh cùng tông với
 * bluebat nên hai vai trò đọc như nhau trong 2 giây đầu (yêu cầu M3). Octopus
 * xanh lá + silhouette tua khác hẳn dơi; đạn của nó được tint cam (xem
 * `bullet-view.ts`) nên cũng không lẫn với thân enemy.
 */
const MONSTERS_BY_CHAPTER: Readonly<Record<number, Readonly<Record<EnemyRole, string>>>> = {
  1: { chaser: 'bluebat', caster: 'greenoctopus', tank: 'bear' },
  2: { chaser: 'spiderred', caster: 'greenoctopus', tank: 'trex' },
  3: { chaser: 'snake3', caster: 'lanternred', tank: 'cyclope' },
};

/** Animation player cần có sheet sẵn trước frame đầu (`roll` chưa dùng ở M1). */
const PLAYER_KEYS = [
  'player.idle.down',
  'player.walk.down',
  'player.attack.down',
  'player.hit.down',
  'player.dead',
] as const;

/** Trạng thái của bootstrap — không phải trạng thái của `RunState`. */
export type BootstrapStatus = DebugStatus;

interface LoadedChapter {
  readonly chapter: ChapterData;
  /** TiledMapAsset theo số phòng, dùng lại cho `buildRoom`. */
  readonly assets: ReadonlyMap<number, TiledMapAsset>;
}

@ccclass('Bootstrap')
export class Bootstrap extends Component {
  private manifest: AnimationManifest | null = null;
  private waterLayout: WaterLayout | null = null;
  private chapter: ChapterData | null = null;
  private chapterAssets: ReadonlyMap<number, TiledMapAsset> = new Map();
  private run: RunState | null = null;
  private save: SaveData | null = null;
  private saveRepo: SaveRepository | null = null;

  /**
   * Ba lớp con của node `world`, tạo đúng một lần theo thứ tự vẽ: sàn → actor → đạn.
   * Tách lớp thay vì nhét tất cả vào `worldRoot` để đổi phòng (huỷ + dựng lại room) không
   * làm sàn mới bị vẽ đè lên player/enemy.
   */
  private roomLayer: Node | null = null;
  private actorLayer: Node | null = null;
  private bulletLayer: Node | null = null;
  private fxLayer: Node | null = null;
  private roomRoot: Node | null = null;
  private uiRoot: Node | null = null;
  private camera: WorldCamera | null = null;

  private player: PlayerController | null = null;
  private bulletView: BulletView | null = null;
  private combat: CombatLoop | null = null;
  private hud: Hud | null = null;
  private fx: FxPool | null = null;
  private audio: AudioManager | null = null;
  private roomClearBanner: Node | null = null;
  /** Overlay debug: xem trước card skill mà không grant (M5 round 3). */
  private readonly skillPreview = new SkillPreview(() => this.ensureUiRoot());

  /** Vàng/kill của run hiện tại — ghi vào save ở cuối run (M5). */
  private rewards = new RunRewards();

  /** Skill của run hiện tại (loadout, RNG roll, màn chọn 1/3). */
  private readonly skills = new SkillRun();
  private combatRng = SeededRng.fromSeed(1);
  private readonly bossPhases = new BossPhaseBanner({
    showBanner: (name, text, color, fontSize) => this.showBanner(name, text, color, fontSize),
    schedule: (callback, delaySeconds) => this.scheduleOnce(callback, delaySeconds),
    winColor: END_WIN_COLOR,
    lossColor: END_LOSS_COLOR,
  });

  private currentLevel: LevelData | null = null;
  /** Frame time thật của N frame gần nhất — `fps()` debug đọc từ đây. */
  private readonly fpsMeter = new FpsMeter();
  private status: BootstrapStatus = 'loading';

  /** Toàn bộ routing/màn M5 nằm ở đây để bootstrap chỉ còn boot + run + render. */
  private readonly screens = new ScreenFlow({
    uiRoot: () => this.ensureUiRoot(),
    save: () => this.save,
    repository: () => this.saveRepo,
    setSave: (save) => {
      this.save = save;
    },
    status: () => this.status,
    setStatus: (status) => {
      this.status = status;
    },
    chapterAvailable: (chapter) => CHAPTER_FOLDERS[chapter] !== undefined,
    startChapter: (chapter) => {
      void this.startChapter(chapter);
    },
    runSnapshot: () => this.runSnapshot(),
    launchChapter: (chapter) => this.launchChapter(chapter),
    teardownRun: () => this.teardownRun(),
    setMusic: (id) => {
      if (id === null) this.audio?.stopMusic();
      else this.audio?.playMusic(id);
    },
    setVolume: (volume) => this.audio?.setVolume(volume),
    fail: (error) => this.fail(error),
  });

  start(): void {
    void this.boot().catch((error: unknown) => {
      this.fail(error);
    });
  }

  update(deltaTime: number): void {
    const rawDeltaMs = Math.min(Math.max(deltaTime, 0) * 1000, MAX_STEP_MS);
    // Chết: sim đứng yên nhưng FX chết vẫn chạy cho tới khi result mở.
    if (this.status === 'dying') {
      this.fx?.update(rawDeltaMs);
      return;
    }
    if (this.status !== 'playing') return;

    const player = this.player;
    const combat = this.combat;
    if (player === null || combat === null) return;

    // Đo frame thật (chưa kẹp trần): `fps()` phải phản ánh cả frame dài, không
    // được "đẹp hoá" bằng `MAX_STEP_MS`.
    this.fpsMeter.record(Math.max(deltaTime, 0) * 1000);
    const deltaMs = rawDeltaMs;

    const result = combat.update(deltaMs);
    if (result.frozen) return;

    if (this.hud !== null) syncCombatHud(this.hud, player, combat);

    if (result.playerDied) {
      this.beginDeath();
      return;
    }
    if (result.cleared) {
      this.onWaveCleared();
    }
  }

  /** Chết: FX tại chỗ + giữ player.dead ~1.4 s rồi mở result (GDD §9). */
  private beginDeath(): void {
    if (this.status !== 'playing') return;
    this.status = 'dying';
    this.screens.setScreen('playing');
    const player = this.player;
    if (player !== null) {
      this.fx?.spawn('fx.smoke', player.position, { drawUnits: 2.2, lifetimeMs: 1000 });
      this.fx?.spawn('fx.explosion', player.position, { drawUnits: 2.4, lifetimeMs: 900 });
    }
    playSfx('explosion');
    this.scheduleOnce(() => {
      if (!this.isValid || this.status !== 'dying') return;
      this.finishLoss();
    }, 1.4);
  }

  // -------------------------------------------------------------------------
  // Boot → title
  // -------------------------------------------------------------------------

  private async boot(): Promise<void> {
    // 512×288 = 32×18 tile 16 px. Đặt trong code để không phụ thuộc Project Settings.
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
    // `SHOW_ALL` tính lại band mỗi lần canvas đổi kích thước, nên camera world phải bám
    // theo đúng band đó; nếu không phòng bị cắt ở 4:3 và lệch ở 21:9 (xem applyViewport).
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    // Cocos chỉ nghe phím trên #GameCanvas: chưa focus thì WASD/R không ăn cho tới khi click.
    document.getElementById('GameCanvas')?.focus();

    this.saveRepo = createSaveRepository();
    this.save = this.saveRepo.load();
    if (this.saveRepo.lastLoadError !== null) {
      console.warn(`[YokaiField] Save hỏng, dùng save mặc định: ${this.saveRepo.lastLoadError}`);
    }

    this.audio = new AudioManager(this.node);
    this.audio.setVolume(this.save.settings.volume);
    this.audio.preload();
    this.audio.playMusic('title');
    this.installDebugHook();

    this.manifest = await this.loadManifest();
    this.waterLayout = await this.loadWaterLayout();
    this.camera = new WorldCamera(this.node, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.camera.onViewportChange = (scale) => this.hud?.node.setScale(scale, scale, 1);
    this.createWorldLayers();
    await this.screens.showTitle();
  }

  /** Load toàn bộ `.tmx` của chapter rồi bắt đầu run ở phòng 1. Chỉ từ menu. */
  private async startChapter(chapterNumber: number): Promise<void> {
    const save = this.save;
    if (save === null) return;
    if (this.status !== 'menu') return;

    // Cổng thật: nút disabled chỉ là hình, đây mới là chỗ chặn chapter chưa mở.
    const gate = chapterGate(save, chapterNumber, CHAPTER_FOLDERS[chapterNumber] !== undefined);
    if (!gate.allowed) {
      console.warn(`[YokaiField] Không mở được chapter ${chapterNumber}: ${gate.reason}`);
      return;
    }

    try {
      await this.launchChapter(chapterNumber);
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  /**
   * Bắt đầu run ở `chapterNumber`, bỏ qua guard menu (debug `startChapter`).
   * Seed cho RNG của run; `undefined` = lấy từ đồng hồ (mỗi run khác nhau).
   */
  private async launchChapter(chapterNumber: number, seedArg?: number): Promise<void> {
    const folder = CHAPTER_FOLDERS[chapterNumber];
    if (folder === undefined) {
      console.warn(`[YokaiField] Chapter ${chapterNumber} chưa có dữ liệu .tmx — không mở.`);
      return;
    }

    this.status = 'loading';
    this.screens.setScreen('playing');
    this.screens.clearMenu();
    this.skills.destroy();

    const save = this.save;
    if (save === null) throw new Error('Bootstrap: chưa load save');

    const seed =
      seedArg ?? ((Date.now() ^ (chapterNumber * 0x9e3779b1)) >>> 0);
    // Baseline của run = chỉ số gốc + meta đã mua (tim/damage/nhịp bắn).
    this.skills.reset(seed, metaBaseline(DEFAULT_COMBAT, save));
    this.rewards = new RunRewards();
    // Dòng RNG chiến đấu tách khỏi roll skill: crit/boss pattern không đổi khi
    // người chơi chọn thẻ khác.
    this.combatRng = SeededRng.fromSeed((seed ^ 0x85ebca6b) >>> 0);

    const manifest = this.manifest;
    if (manifest === null) throw new Error('Bootstrap: manifest chưa load xong');

    const loaded = await this.loadChapter(folder);
    this.chapter = loaded.chapter;
    this.chapterAssets = loaded.assets;
    const run = new RunState(loaded.chapter.chapter, loaded.chapter.rooms.length);
    this.run = run;

    // Preload **trước** khi dựng gì: mọi lỗi art/JSON nổi ở một chỗ, với path đầy đủ.
    await preloadSheets(this.collectSheets(manifest, loaded.chapter));

    const firstRoom = this.levelFor(1);
    if (firstRoom === null) {
      throw new Error(`"resources/${folder}" không có phòng 1`);
    }

    const fxLayer = this.fxLayer;
    if (fxLayer === null) throw new Error('Bootstrap: chưa có fx-layer');
    this.fx = await createFxPool(fxLayer);

    const player = this.createPlayer(firstRoom.playerStart);
    player.applyStats(this.skills.stats());
    // Trần máu meta cao hơn 6: vào run phải đầy tim, không phải 6/7.
    player.heal(player.maxHearts);
    this.createRoom(firstRoom);

    await this.createBullets(player);
    await this.createHud();
    const actorLayer = this.actorLayer;

    if (actorLayer === null) throw new Error('Bootstrap: chưa có actor-layer');

    this.audio?.playMusic(chapterMusic(firstRoom.chapter));

    this.combat = new CombatLoop({
      player,
      bulletView: this.bulletView,
      manifest,
      actorLayer,
      level: firstRoom,
      monsterFor: (role) => this.monsterFor(firstRoom.chapter, role),
      rng: this.combatRng,
      onBossPhase: (phase) => this.bossPhases.show(phase),
      onKill: (role, elite) => this.awardKill(role, elite),
      ...(this.fx !== null ? { fx: this.fx } : {}),
    });

    this.status = 'playing';
    this.screens.setScreen('playing');
    this.persistBest(firstRoom.room);
    this.combat.startWave(0);
    if (this.hud !== null) syncCombatHud(this.hud, player, this.combat);
    this.hud?.setSkills(this.skills.entries);
    this.hud?.setGold(0);
    console.log(
      `[YokaiField] Chapter ${loaded.chapter.chapter}: ${loaded.chapter.rooms.length} phòng từ ` +
        `resources/${folder}. Bắt đầu phòng ${run.roomLabel} ` +
        `(${firstRoom.waves.length} wave). seed=${seed} player=${JSON.stringify(player.position)}`,
    );
  }

  private loadManifest(): Promise<AnimationManifest> {
    return this.loadJson(MANIFEST_PATH).then((json) => {
      try {
        return validateManifest(json);
      } catch (error: unknown) {
        throw new Error(`"resources/${MANIFEST_PATH}.json" không hợp lệ: ${errorMessage(error)}`);
      }
    });
  }

  /** Layout nước động (ch2); file do `scripts/dress-rooms.ts` sinh. */
  private loadWaterLayout(): Promise<WaterLayout> {
    return this.loadJson('data/water-layout').then((json) => {
      try {
        return parseWaterLayout(json);
      } catch (error: unknown) {
        throw new Error(`"resources/data/water-layout.json" không hợp lệ: ${errorMessage(error)}`);
      }
    });
  }

  /**
   * Load mọi `TiledMapAsset` trong thư mục chapter (thứ tự engine trả về không đảm bảo),
   * parse từng file bằng parser của core, sắp theo `room` rồi validate cả chapter.
   */
  private loadChapter(folder: string): Promise<LoadedChapter> {
    return new Promise<LoadedChapter>((onLoad, onFail) => {
      resources.loadDir(
        folder,
        CocosTiledMapAsset,
        (error: Error | null | undefined, assets: TiledMapAsset[] | null | undefined) => {
          // Cocos gọi callback với `null` **hoặc `undefined`** khi thành công.
          if (error || !assets || assets.length === 0) {
            const cause = error ? error.message : 'không có TiledMapAsset nào';
            onFail(
              new Error(
                `Không load được phòng nào trong "resources/${folder}". ` +
                  `Kiểm tra .tmx đã import chưa (Type = tiled-map). Nguyên nhân: ${cause}`,
              ),
            );
            return;
          }

          try {
            const levels: LevelData[] = [];
            const byRoom = new Map<number, TiledMapAsset>();

            for (const asset of assets) {
              const source = `resources/${folder}/${asset.name}.tmx`;
              const level = parseTmxLevel(asset.tmxXmlStr, { source });
              if (byRoom.has(level.room)) {
                throw new Error(`${source}: phòng ${level.room} bị trùng với một .tmx khác`);
              }
              byRoom.set(level.room, asset);
              levels.push(level);
            }

            onLoad({ chapter: chapterFromLevels(levels), assets: byRoom });
          } catch (parseError: unknown) {
            onFail(parseError instanceof Error ? parseError : new Error(String(parseError)));
          }
        },
      );
    });
  }

  /**
   * `resources.load` với type tường minh, gói thành Promise và **nêu path** trong lỗi —
   * path là thứ duy nhất giúp phân biệt "quên import" với "sai schema".
   */
  private loadJson(path: string): Promise<unknown> {
    return new Promise<unknown>((onLoad, onFail) => {
      resources.load(
        path,
        CocosJsonAsset,
        (error: Error | null | undefined, asset: JsonAsset | null | undefined) => {
          // Cocos gọi callback với `null` **hoặc `undefined`** khi thành công. So sánh
          // `=== null` sẽ coi `undefined` là lỗi rồi đọc `.message` trên undefined —
          // chính là lỗi runtime "Cannot read properties of undefined (reading 'message')".
          if (error || !asset) {
            const cause = error ? error.message : 'asset trả về rỗng';
            onFail(new Error(`Không load được "resources/${path}.json". Nguyên nhân: ${cause}`));
            return;
          }
          onLoad(asset.json);
        },
      );
    });
  }

  /**
   * Gom sheet cần preload: animation player, walk của mọi monster chapter này dùng, mọi
   * animation boss (nếu có phòng boss), cộng sheet vật cản/đạn/tim. Preload một lần để
   * frame đầu không có sprite trắng.
   */
  private collectSheets(manifest: AnimationManifest, chapter: ChapterData): string[] {
    const sheets = new Set<string>();

    for (const key of PLAYER_KEYS) {
      sheets.add(resolve(manifest, key).sheet);
    }

    for (const room of chapter.rooms) {
      for (const wave of room.waves) {
        for (const spawn of wave.enemies) {
          const monster = this.monsterFor(room.chapter, spawn.role);
          sheets.add(resolve(manifest, `${monster}.walk.down`).sheet);
        }
      }

      if (room.isBossRoom) {
        const def = room.boss === undefined ? undefined : bossForSpriteName(room.boss.name);
        if (def !== undefined) {
          for (const key of def.animations) {
            sheets.add(resolve(manifest, key).sheet);
          }
        }
      }
    }

    sheets.add(PLAYER_BULLET_SHEET);
    sheets.add(ENEMY_BULLET_SHEET);
    sheets.add(TELEGRAPH_RING_SHEET);
    sheets.add(HEART_SHEET);
    for (const sheet of obstacleSheets(chapter.chapter)) sheets.add(sheet);

    return Array.from(sheets);
  }

  /** world → room/actor/bullet, thứ tự này là thứ tự vẽ của Cocos 2D. */
  private createWorldLayers(): void {
    const worldRoot = new CocosNode('world');
    // Cocos chỉ vẽ Sprite nằm dưới một RenderRoot2D (Canvas là một); world không nằm dưới Canvas.
    worldRoot.addComponent(RenderRoot2D);
    worldRoot.parent = this.node;

    this.roomLayer = this.addLayer('room-layer', worldRoot);
    this.actorLayer = this.addLayer('actor-layer', worldRoot);
    this.bulletLayer = this.addLayer('bullet-layer', worldRoot);
    // FX trên actor + đạn: nổ/impact không bị enemy vẽ đè.
    this.fxLayer = this.addLayer('fx-layer', worldRoot);
  }

  private addLayer(name: string, parent: Node): Node {
    const node = new CocosNode(name);
    node.parent = parent;
    return node;
  }

  /** Dựng room mới và thay room cũ (node cũ `destroy()` là engine dọn hết con). */
  private createRoom(level: LevelData): void {
    const roomLayer = this.roomLayer;
    if (roomLayer === null) throw new Error('Bootstrap: chưa có room-layer');

    const asset = this.chapterAssets.get(level.room);
    if (asset === undefined) {
      throw new Error(`Chưa load TiledMapAsset cho phòng ${level.room} (${level.id})`);
    }

    this.roomRoot?.destroy();
    this.roomRoot = buildRoom(roomLayer, level, asset);
    const water = this.waterLayout;
    if (water !== null) {
      attachRoomWater(this.roomRoot, waterAreasFor(water, level.chapter, level.room));
    }
    this.currentLevel = level;
  }

  private createPlayer(startAt: Vec2): PlayerController {
    const manifest = this.manifest;
    const actorLayer = this.actorLayer;
    if (manifest === null || actorLayer === null) {
      throw new Error('Bootstrap: chưa có manifest/actor-layer — không dựng được player');
    }

    const node = new CocosNode('player');
    node.parent = actorLayer;

    const sprite: Sprite = node.addComponent(CocosSprite);
    // CUSTOM: animator đặt contentSize/anchor theo frame (Idle 32×32, Dead 32×64).
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;

    // 1 texture px = 1/16 unit. Player frame 32 px → 2 unit, art thật ~1 tile.
    const scale = ACTOR_SCALE;
    node.setScale(scale, scale, 1);

    node.addComponent(SpriteAnimator);
    const player: PlayerController = node.addComponent(PlayerController);
    player.init({
      manifest,
      startAt,
      rng: this.combatRng,
      ...(this.fx !== null ? { fx: this.fx } : {}),
    });

    this.player = player;
    return player;
  }

  private async createBullets(player: PlayerController): Promise<void> {
    const node = new CocosNode('bullets');
    node.parent = this.bulletLayer ?? this.node;

    const bulletView: BulletView = node.addComponent(BulletView);
    await bulletView.init(player.bullets);
    this.bulletView = bulletView;
  }

  private async createHud(): Promise<void> {
    const run = this.run;
    if (run === null) return;

    const canvas = this.ensureUiRoot();
    const node = new CocosNode('hud');
    node.layer = Layers.Enum.UI_2D;
    node.parent = canvas;

    const hud: Hud = node.addComponent(Hud);
    await hud.init(this.player?.maxHearts ?? DEFAULT_COMBAT.playerMaxHearts, run.roomLabel);
    // World vẽ ở bội số nguyên nên có thể nhỏ hơn band UI; thu HUD để bám mép phòng.
    const hudScale = this.camera?.hudScale ?? 1;
    node.setScale(hudScale, hudScale, 1);
    this.hud = hud;
  }

  /**
   * Canvas + camera UI riêng, tạo bằng code.
   *
   * Camera world mặc định **không thấy layer `UI_2D`** (`CAMERA_DEFAULT_MASK` loại nó ra),
   * nên HUD cần camera riêng với `visibility = UI_2D`. Canvas neo camera đó vào tâm màn
   * hình và tự set `orthoHeight` theo design resolution.
   */
  private ensureUiRoot(): Node {
    const existing = this.uiRoot;
    if (existing !== null && existing.isValid) return existing;

    const canvasNode = new CocosNode('ui-canvas');
    canvasNode.layer = Layers.Enum.UI_2D;
    canvasNode.parent = this.node;

    const canvas: Canvas = canvasNode.addComponent(CocosCanvas);

    const cameraNode = new CocosNode('ui-camera');
    cameraNode.layer = Layers.Enum.UI_2D;
    cameraNode.parent = canvasNode;
    cameraNode.setPosition(0, 0, 1000);

    const camera: Camera = cameraNode.addComponent(CocosCamera);
    camera.projection = CocosCamera.ProjectionType.ORTHO;
    // World camera đã vẽ nền; UI camera chỉ vẽ chồng lên, không xoá màu.
    camera.clearFlags = CocosCamera.ClearFlag.DEPTH_ONLY;
    camera.visibility = Layers.Enum.UI_2D;
    camera.priority = 1;
    camera.near = 1;
    // Canvas đặt camera ở z = 1000 nên `far` phải > 1000 mới không cắt mất HUD.
    camera.far = 2000;

    canvas.cameraComponent = camera;

    this.uiRoot = canvasNode;
    return canvasNode;
  }

  // -------------------------------------------------------------------------
  // Vòng chạy
  // -------------------------------------------------------------------------

  /**
   * Sát thương khi chạm, đạn enemy và hitstop đã chuyển sang `CombatLoop` (M3).
   * Bootstrap chỉ còn lo run flow: wave → phòng → skill → chapter.
   */
  private onWaveCleared(): void {
    const run = this.run;
    const level = this.currentLevel;
    const combat = this.combat;
    if (run === null || level === null || combat === null) return;

    const nextWave = nextWaveIndex(combat.currentWaveIndex, level);
    if (nextWave !== null) {
      run.nextWave(level.waves.length);
      combat.startWave(nextWave);
      return;
    }

    run.onRoomCleared();
    this.persistBest(level.room);

    // Thưởng dọn phòng (GDD §7): boss 50, phòng thường 5, nhân Greed.
    const roomGold = this.rewards.awardRoomClear(
      level.isBossRoom,
      this.player?.derivedStats.goldMultiplier ?? 1,
    );
    this.hud?.setGold(this.rewards.goldEarned);

    // Second Wind: hồi tim mỗi khi dọn phòng (GDD §6).
    const healPerRoom = this.player?.derivedStats.healPerRoom ?? 0;
    if (healPerRoom > 0) this.player?.heal(healPerRoom);
    if (this.hud !== null && this.player !== null) {
      syncCombatHud(this.hud, this.player, this.combat);
    }
    this.hud?.setSkills(this.skills.entries);
    console.log(`[YokaiField] Phòng ${run.roomLabel} sạch (+${roomGold} vàng).`);

    // Dừng sim (update() return khi status khác 'playing') và giữ chữ ~1 s để
    // người chơi đọc được "phòng sạch" trước khi màn hình đổi. Hẹn giờ bằng
    // scheduler của Cocos, không dùng setTimeout — callback tự bị huỷ khi scene reload.
    this.status = 'room-clear';
    this.roomClearBanner?.destroy();
    this.roomClearBanner = this.showBanner('room-clear', 'ROOM CLEAR', END_WIN_COLOR, 20);

    this.scheduleOnce(() => {
      const current = this.run;
      if (!this.isValid || current === null || this.status !== 'room-clear') return;

      this.roomClearBanner?.destroy();
      this.roomClearBanner = null;

      // Phòng cuối của chapter (số phòng lấy từ dữ liệu) = hết run của chapter này.
      // Không dùng `RunState.isBossRoom`: chapter có thể có phòng thường sau boss.
      if (current.room >= current.roomsTotal) {
        this.finishWin();
        return;
      }

      this.openSkillPick();
    }, ROOM_CLEAR_BANNER_SECONDS);
  }

  /** Quay 1/3 skill bằng RNG của run rồi mở màn chọn; pool cạn thì đi tiếp. */
  private openSkillPick(): void {
    const choices = this.skills.roll();

    if (choices.length === 0) {
      console.log('[YokaiField] Skill pool đã cạn — không có thẻ, sang phòng kế.');
      this.advanceRoom();
      return;
    }

    this.status = 'skill-pick';
    this.screens.setScreen('skill-pick');
    const canvas = this.ensureUiRoot();

    void this.skills
      .open(canvas, choices, (index) => this.chooseSkill(index))
      .then(() => {
        if (this.status !== 'skill-pick') return;
        console.log(
          `[YokaiField] Skill pick: ${choices.map((skill) => `${skill.id}(${skill.rarity})`).join(', ')}`,
        );
      })
      .catch((error: unknown) => this.fail(error));
  }

  /**
   * Chọn thẻ theo index hoặc id. Dùng chung cho click, phím 1/2/3 và debug.
   * `false` khi không có màn chọn hoặc thẻ không hợp lệ.
   */
  private chooseSkill(indexOrId: number | string): boolean {
    if (this.status !== 'skill-pick') return false;
    const picked = this.skills.choose(indexOrId);
    if (picked === null) return false;

    const { def, result } = picked;
    this.applyLoadout(result.healNow);
    console.log(
      `[YokaiField] Nhặt ${def.name} → stack ${result.stacks}/${def.maxStacks}` +
        `${result.healNow > 0 ? `, hồi ${result.healNow} tim` : ''}.`,
    );

    this.advanceRoom();
    return true;
  }

  /** Áp loadout mới cho player + HUD. `healNow` là hồi máu một lần của Vitality. */
  private applyLoadout(healNow = 0): void {
    const player = this.player;
    const stats = this.skills.stats();
    player?.applyStats(stats, healNow);
    this.hud?.setSkills(this.skills.entries);
    if (player !== null) this.hud?.setMaxHearts(player.maxHearts);
    this.hud?.setHearts(player?.hearts ?? 0);
  }

  /** Sang phòng kế sau khi đã chọn skill (hoặc pool cạn). */
  private advanceRoom(): void {
    const run = this.run;
    if (run === null) return;

    this.status = 'playing';
    this.screens.setScreen('playing');
    run.advanceToNextRoom();
    this.enterRoom(run.room);
  }

  private enterRoom(roomNumber: number): void {
    const run = this.run;
    if (run === null) return;

    const level = this.levelFor(roomNumber);
    if (level === null) {
      this.fail(new Error(`Chapter ${run.chapter} thiếu phòng ${roomNumber} (RunState ${run.roomLabel})`));
      return;
    }

    this.createRoom(level);
    this.combat?.enterRoom(level);
    this.player?.teleport(level.playerStart);
    this.hud?.setRoomLabel(run.roomLabel);
    this.hud?.setBoss(null);
    this.persistBest(roomNumber);

    if (level.isBossRoom) {
      const combat = this.combat;
      if (combat === null) throw new Error('Bootstrap: chưa có CombatLoop');
      spawnBossForRoom(combat, level);
      this.audio?.playMusic('boss');
    } else {
      this.audio?.playMusic(chapterMusic(level.chapter));
    }
    this.combat?.startWave(0);
    const player = this.player;
    if (this.hud !== null && player !== null) {
      syncCombatHud(this.hud, player, this.combat);
    }

    console.log(
      `[YokaiField] Vào phòng ${run.roomLabel} (${level.waves.length} wave` +
        `${level.isBossRoom ? ', boss' : ''}).`,
    );
  }

  private finishLoss(): void {
    const run = this.run;
    if (run === null) return;
    if (run.status === 'lost' || run.status === 'won') return;

    run.markLost();
    this.audio?.stopMusic();
    console.log(`[YokaiField] Thua ở phòng ${run.roomLabel} (0 tim).`);
    this.screens.finishRun(false);
  }

  private finishWin(): void {
    const run = this.run;
    if (run === null) return;
    if (run.status === 'won' || run.status === 'lost') return;

    // GDD §2: thắng chapter mở chapter kế; `commitRunEnd` ghi cả vàng lẫn unlock.
    run.markWon();
    this.audio?.stopMusic();
    playSfx('chapter-clear');
    console.log(`[YokaiField] CHAPTER CLEAR — chapter ${run.chapter}, phòng ${run.roomLabel}.`);
    this.screens.finishRun(true);
  }

  /** Cộng vàng cho một kill; HUD cập nhật ngay (GDD §9). */
  private awardKill(role: EnemyRole, elite: boolean): void {
    const multiplier = this.player?.derivedStats.goldMultiplier ?? 1;
    this.rewards.awardKill(role, elite, multiplier);
    this.hud?.setGold(this.rewards.goldEarned);
  }

  /** Chụp run cho result trước khi teardown (ScreenFlow không biết RunState/combat). */
  private runSnapshot(): RunSnapshot | null {
    const run = this.run;
    if (run === null) return null;
    return { chapter: run.chapter, room: run.room, roomsTotal: run.roomsTotal, durationMs: this.combat?.clockMs ?? 0, goldEarned: this.rewards.goldEarned, kills: this.rewards.killCount };
  }
  /**
   * Dọn sạch một run khỏi scene. Huỷ từng nhóm node thay vì reload scene: reload sẽ
   * huỷ các load ảnh đang bay và devtools ghi `net::ERR_CONNECTION_RESET` (vô hại
   * nhưng làm bẩn cổng "không lỗi console"), còn teardown này chỉ bỏ đúng node của run.
   */
  private teardownRun(): void {
    this.skills.destroy();
    this.roomClearBanner?.destroy();
    this.roomClearBanner = null;
    this.bossPhases.destroy();

    this.combat?.destroy();
    this.combat = null;
    this.fx?.destroy();
    this.fx = null;
    this.player?.node.destroy();
    this.player = null;
    this.bulletView?.node.destroy();
    this.bulletView = null;
    this.hud?.node.destroy();
    this.hud = null;

    this.roomRoot?.destroy();
    this.roomRoot = null;
    this.currentLevel = null;
    this.chapter = null;
    this.chapterAssets = new Map();
    this.run = null;
    this.rewards = new RunRewards();
    this.fpsMeter.clear();
  }

  // -------------------------------------------------------------------------
  // Save + debug hook
  // -------------------------------------------------------------------------

  /** Ghi kỷ lục khi vào phòng mới; lỗi save không được làm chết run. */
  private persistBest(room: number): void {
    const run = this.run;
    const repo = this.saveRepo;
    const save = this.save;
    if (run === null || repo === null || save === null) return;

    try {
      const next = withBest(save, run.chapter, room);
      if (next.best.chapter === save.best.chapter && next.best.room === save.best.room) return;
      this.save = next;
      repo.save(next);
      console.log(
        `[YokaiField] Best cập nhật: chapter ${next.best.chapter} · room ${next.best.room}.`,
      );
    } catch (error: unknown) {
      console.warn(`[YokaiField] Không ghi được best: ${errorMessage(error)}`);
    }
  }

  /** `?debug=1` → `window.__yokai` cho acceptance headless. Không có debug thì không có gì. */
  private installDebugHook(): void {
    installDebugWiring({
      status: () => this.status,
      chapter: () => this.run?.chapter ?? 0,
      room: () => this.run?.room ?? 0,
      roomTotal: () => this.run?.roomsTotal ?? 0,
      killAll: () => this.killAllEnemies(),
      spawn: (role, elite, at) => this.debugSpawn(role as EnemyRole, elite, at),
      stress: () => this.debugStress(),
      fps: () => this.fpsMeter.info(),
      godMode: (on) => {
        this.combat?.setGodMode(on);
        return this.combat?.isGodMode ?? false;
      },
      enemies: () => this.combat?.snapshotEnemies() ?? [],
      bulletCount: () => this.combat?.enemyBulletCount() ?? 0,
      skillChoices: () => this.skills.choices,
      pickSkill: (indexOrId) => this.chooseSkill(indexOrId),
      grantSkill: (id, stacks = 1) => this.debugGrantSkill(id, stacks),
      stats: () => this.skills.stats(),
      boss: () => {
        const boss = this.combat?.bossSnapshot() ?? null;
        return boss === null
          ? null
          : { name: boss.name, hp: boss.health, maxHp: boss.maxHealth, phase: boss.phase };
      },
      setBossHp: (fraction) => this.combat?.setBossHealthFraction(fraction) ?? false,
      startChapter: async (chapter, seed) => {
        if (this.status === 'loading') return false;
        this.screens.clearMenu();
        this.teardownRun();
        try {
          await this.launchChapter(chapter, seed);
          return true;
        } catch (error: unknown) {
          this.fail(error);
          return false;
        }
      },
      screen: () => this.screens.screenId,
      save: () => this.save,
      setGold: (gold) => this.screens.setGold(gold),
      uiText: () => this.uiText(),
      skillPreview: (ids) => this.skillPreview.show(ids),
      closeSkillPreview: () => this.skillPreview.close(),
      roomRoot: () => this.roomRoot,
      actorLayer: () => this.actorLayer,
      bulletLayer: () => this.bulletLayer,
      fxLayer: () => this.fxLayer,
      uiRoot: () => this.uiRoot,
      audioManager: () => this.audio,
    });
  }


  /** Debug: nhặt skill ngoài màn chọn; trả stack sau khi nhặt (0 nếu id lạ). */
  private debugGrantSkill(id: string, stacks: number): number {
    const grant = this.skills.grant(id, stacks);
    if (grant.acquired) this.applyLoadout(grant.healNow);
    console.log(
      `[YokaiField] debug grantSkill ${id} ×${stacks} → stack ${grant.stacks}`,
    );
    return grant.stacks;
  }

  /** Spawn debug — chỉ có ý nghĩa khi đang ở trong phòng. */
  private debugSpawn(role: EnemyRole, elite = false, at?: Vec2): string {
    const combat = this.combat;
    if (combat === null || this.status !== 'playing') {
      console.warn(`[YokaiField] debug spawn bỏ qua: chưa ở trong phòng (status ${this.status})`);
      return '';
    }
    const id = combat.spawnDebug(role, elite, at);
    console.log(`[YokaiField] debug spawn ${role}${elite ? ' elite' : ''} → ${id}`);
    return id;
  }

  /** Stress test M3: 8 enemy + >= 40 đạn, player bất tử, đo fps bằng `fps()`. */
  private debugStress(): boolean {
    const combat = this.combat;
    if (combat === null || this.status !== 'playing') {
      console.warn(`[YokaiField] debug stress bỏ qua: chưa ở trong phòng (status ${this.status})`);
      return false;
    }
    combat.startStress();
    console.log(
      `[YokaiField] debug stress: 8 enemy + ${STRESS_ENEMY_BULLETS} đạn (>= 40 như mốc M3), godMode bật.`,
    );
    return true;
  }

  /**
   * Giết mọi enemy/boss còn sống **qua đường damage chuẩn** (`EnemyView.takeDamage`),
   * nên wave/room clear chạy y như chơi thật. Trả về số mục tiêu đã giết.
   */
  private killAllEnemies(): number {
    const killed = this.combat?.killAll() ?? 0;
    console.log(
      `[YokaiField] debug killAll: ${killed} enemy ở phòng ${this.run?.roomLabel ?? '?'}.`,
    );
    return killed;
  }

  private uiText(): readonly DebugUiText[] {
    return collectUiText(this.uiRoot);
  }

  /** Debug: art tạm/key animation hỏng còn hiển thị; rỗng là sạch. */






  protected onDestroy(): void {
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.camera?.destroy();
    this.audio?.destroy();
    this.audio = null;
    this.screens.destroy();
  }

  // -------------------------------------------------------------------------
  // Lỗi
  // -------------------------------------------------------------------------

  /** Chữ to giữa màn hình (lỗi load, game over, thắng chapter, room clear). */
  private showBanner(name: string, text: string, color: Color, fontSize = 13): Node {
    return createBanner(
      this.ensureUiRoot(),
      name,
      text,
      color,
      fontSize,
      view.getVisibleSize().width,
    );
  }

  /** Hiện lỗi lên màn hình **và** console, sau đó dừng vòng chạy. */
  private fail(error: unknown): void {
    this.status = 'error';
    const message = errorMessage(error);
    console.error(`[YokaiField] Bootstrap thất bại: ${message}`);

    try {
      this.showBanner('load-error', `LOAD FAILED\n${message}`, END_LOSS_COLOR);
    } catch (nested: unknown) {
      console.error(`[YokaiField] Không dựng được màn hình lỗi: ${errorMessage(nested)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Truy vấn dữ liệu
  // -------------------------------------------------------------------------

  private levelFor(roomNumber: number): LevelData | null {
    const chapter = this.chapter;
    if (chapter === null) return null;

    for (const room of chapter.rooms) {
      if (room.room === roomNumber) return room;
    }
    return null;
  }

  private monsterFor(chapter: number, role: EnemyRole): string {
    const byRole = MONSTERS_BY_CHAPTER[chapter];
    const monster = byRole?.[role];
    if (monster === undefined) {
      throw new Error(
        `Chapter ${chapter} chưa map monster cho role "${role}" (xem MONSTERS_BY_CHAPTER)`,
      );
    }
    return monster;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chapterMusic(chapter: number): MusicId {
  if (chapter === 2) return 'chapter-2';
  if (chapter === 3) return 'chapter-3';
  return 'chapter-1';
}
