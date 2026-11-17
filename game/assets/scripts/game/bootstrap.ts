/**
 * Điểm vào duy nhất của scene: gắn component này lên **một** node là game chạy.
 *
 * Dựng toàn bộ bằng code (không prefab, không sửa `.scene` — quy tắc 5 trong AGENTS.md):
 *
 * ```text
 * animations.json (validate) ─┐
 * save (localStorage)        ─┼─> chapter select ─> loadDir .tmx ─> parse TMX ─> room + player + HUD ─> wave 1
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
 * Boss M2 là **placeholder**: một `EnemyView` dùng art boss thật (`TenguBlue`) với
 * máu/hitbox từ `core/boss/boss-defs.ts`, hành vi tank có sẵn (telegraph + charge).
 * Dọn sạch phòng boss ⇒ CHAPTER CLEAR ⇒ về chapter select.
 */
import {
  _decorator,
  Camera as CocosCamera,
  Canvas as CocosCanvas,
  Color as CocosColor,
  Component,
  Input,
  JsonAsset as CocosJsonAsset,
  KeyCode,
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  Rect as CocosRect,
  RenderRoot2D,
  ResolutionPolicy,
  Sprite as CocosSprite,
  TiledMapAsset as CocosTiledMapAsset,
  UITransform as CocosUITransform,
  director,
  input,
  resources,
  screen,
  view,
} from 'cc';
import { resolve, validateManifest } from '../core/art/manifest';
import type { AnimationManifest } from '../core/art/manifest';
import { bossForSpriteName } from '../core/boss/boss-defs';
import { DEFAULT_COMBAT } from '../core/config';
import type { EnemyState } from '../core/enemies/behaviours';
import { nextWaveIndex } from '../core/enemies/waves';
import { chapterFromLevels } from '../core/level/chapter';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
import type { ChapterData, EnemyRole, LevelData } from '../core/level/level-data';
import { parseTmxLevel } from '../core/level/tmx';
import type { Vec2 } from '../core/math/vec2';
import { RunState } from '../core/run/run-state';
import { withBest } from '../core/save/save-data';
import type { SaveData } from '../core/save/save-data';
import type { SaveRepository } from '../core/save/storage';
import { letterboxRect } from '../core/view/letterbox';
import { SpriteAnimator } from './anim/sprite-animator';
import { preloadSheets } from './assets/texture-cache';
import { BulletView, ENEMY_BULLET_SHEET, PLAYER_BULLET_SHEET } from './bullet-view';
import { buildChapterSelect } from './chapter-select';
import type { ChapterButton } from './chapter-select';
import { CombatLoop, STRESS_ENEMY_BULLETS } from './combat-loop';
import { TELEGRAPH_RING_SHEET } from './enemy-view';
import { Hud, HEART_SHEET, createLabel } from './hud';
import { ACTOR_SCALE, OBSTACLE_SHEET, buildRoom } from './level-view';
import { PlayerController } from './player-controller';
import { createSaveRepository } from './save-storage';

const { ccclass } = _decorator;

/** `cc` là module any trong repo: type phải suy ra từ import value (xem `texture-cache.ts`). */
type Camera = InstanceType<typeof CocosCamera>;
type Canvas = InstanceType<typeof CocosCanvas>;
type Color = InstanceType<typeof CocosColor>;
type JsonAsset = InstanceType<typeof CocosJsonAsset>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type TiledMapAsset = InstanceType<typeof CocosTiledMapAsset>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** Đường dẫn resources (không có `resources/`, không có phần mở rộng). */
const MANIFEST_PATH = 'data/animations';

/**
 * Thư mục TMX của từng chapter **có dữ liệu trong build này**. M2 chỉ author chapter 1;
 * chapter 2–3 hiện trên chapter select nhưng khoá vì chưa có file (không đoán layout).
 */
const CHAPTER_FOLDERS: Readonly<Record<number, string>> = {
  1: 'data/levels/chapter-1',
};

/** GDD §1: 3 chapter mỗi run. Chapter select luôn hiện đủ 3 nút. */
const CHAPTER_COUNT = 3;

/** Chỗ boss đứng khi TMX không có object `bossStart` (tile unit, y hướng xuống). */
const BOSS_START_FALLBACK: Vec2 = { x: 16, y: 5 };

/**
 * Trần thời gian một frame. Tab bị ẩn vài giây rồi quay lại sẽ có `dt` rất lớn; kẹp lại
 * để enemy không nhảy xuyên phòng và i-frame không bị "ăn" hết trong một frame.
 */
const MAX_STEP_MS = 50;

/** Số frame giữ lại cho `fps()` debug (2 s ở 60 fps). */
const FRAME_SAMPLE_COUNT = 120;

/** Camera world: `orthoHeight = 9` và đứng ở tâm phòng (16, 9). */
const CAMERA_ORTHO_HEIGHT = ROOM_ROWS / 2;
const ROOM_CENTER: Vec2 = { x: ROOM_COLS / 2, y: ROOM_ROWS / 2 };

/**
 * Design resolution đúng bằng một phòng: 32×18 tile 16 px = 512×288 (16:9). Canvas
 * tỉ lệ khác thì giữ nguyên khung này và letterbox — xem `applyViewport`.
 */
const DESIGN_WIDTH = ROOM_COLS * TILE_SIZE_PX;
const DESIGN_HEIGHT = ROOM_ROWS * TILE_SIZE_PX;

/**
 * Camera ortho nhìn theo -Z với `near = 1`, nên sprite ở z = 0 **bị cắt** nếu camera
 * cũng đứng ở z = 0. Đặt camera lùi về z = 1000 (chuẩn 2D của Cocos) rồi khai near/far.
 */
const CAMERA_Z = 1000;
const CAMERA_NEAR = 1;
const CAMERA_FAR = 2000;

const END_LOSS_COLOR = new CocosColor(255, 96, 96, 255);
const END_WIN_COLOR = new CocosColor(255, 230, 120, 255);

/** Màu bar letterbox / nền ngoài phòng và nền chapter select. */
const BACKDROP_COLOR = new CocosColor(14, 12, 20, 255);

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
export type BootstrapStatus =
  | 'loading'
  | 'menu'
  | 'playing'
  | 'room-clear'
  | 'lost'
  | 'won'
  | 'error';

/**
 * API debug khi URL có `?debug=1` (headless acceptance không chơi bằng tay được).
 *
 * `killAll()` trừ máu mọi enemy/boss còn sống **qua `EnemyView.takeDamage`** — đúng
 * đường damage của đạn, nên clear/transition chạy như chơi thật.
 *
 * `spawn`/`stress`/`fps`/`godMode` là hook M3; chúng chỉ tồn tại khi có `?debug=1`.
 */
export interface YokaiDebugApi {
  readonly status: BootstrapStatus;
  readonly chapter: number;
  readonly room: number;
  readonly roomTotal: number;
  killAll(): number;
  /** Spawn một enemy ở phòng hiện tại; trả id (rỗng khi chưa vào phòng). */
  spawn(role: EnemyRole, elite?: boolean, at?: { readonly x: number; readonly y: number }): string;
  /** 8 enemy + >= 40 đạn trên màn, player bất tử — để đo fps. */
  stress(): boolean;
  /** fps trung bình / frame time trên N frame gần nhất, đo trong vòng lặp game. */
  fps(): { readonly fps: number; readonly frameMs: number; readonly samples: number };
  /** Bật/tắt bất tử; trả trạng thái sau khi đặt. */
  godMode(on: boolean): boolean;
  /** Snapshot enemy (vai trò, elite, action, máu) — dùng cho ảnh nghiệm thu. */
  enemies(): ReadonlyArray<{
    readonly id: string;
    readonly role: EnemyRole | null;
    readonly elite: boolean;
    readonly health: number;
    readonly maxHealth: number;
    readonly action: string;
    readonly x: number;
    readonly y: number;
  }>;
  /** Số đạn enemy đang sống (kiểm tra `stress()` giữ đủ 40). */
  bulletCount(): number;
}

interface LoadedChapter {
  readonly chapter: ChapterData;
  /** TiledMapAsset theo số phòng, dùng lại cho `buildRoom`. */
  readonly assets: ReadonlyMap<number, TiledMapAsset>;
}

@ccclass('Bootstrap')
export class Bootstrap extends Component {
  private manifest: AnimationManifest | null = null;
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
  private roomRoot: Node | null = null;
  private uiRoot: Node | null = null;
  private menuRoot: Node | null = null;
  private worldCamera: Camera | null = null;

  private player: PlayerController | null = null;
  private bulletView: BulletView | null = null;
  private combat: CombatLoop | null = null;
  private hud: Hud | null = null;
  private roomClearBanner: Node | null = null;
  private endBanner: Node | null = null;

  private currentLevel: LevelData | null = null;
  /** Thời gian thật (ms) của N frame gần nhất — `fps()` debug đọc từ đây. */
  private readonly frameTimesMs: number[] = [];
  private status: BootstrapStatus = 'loading';

  start(): void {
    void this.boot().catch((error: unknown) => {
      this.fail(error);
    });
  }

  update(deltaTime: number): void {
    if (this.status !== 'playing') return;

    const player = this.player;
    const combat = this.combat;
    if (player === null || combat === null) return;

    // Đo frame thật (chưa kẹp trần): `fps()` phải phản ánh cả frame dài, không
    // được "đẹp hoá" bằng `MAX_STEP_MS`.
    this.recordFrame(Math.max(deltaTime, 0) * 1000);
    const deltaMs = Math.min(Math.max(deltaTime, 0) * 1000, MAX_STEP_MS);

    const result = combat.update(deltaMs);
    if (result.frozen) return;

    this.hud?.setHearts(player.hearts);

    if (result.playerDied) {
      this.finishLoss();
      return;
    }
    if (result.cleared) {
      this.onWaveCleared();
    }
  }

  /** Giữ N frame gần nhất để `fps()` debug báo số đo thật của vòng lặp game. */
  private recordFrame(frameMs: number): void {
    this.frameTimesMs.push(frameMs);
    if (this.frameTimesMs.length > FRAME_SAMPLE_COUNT) this.frameTimesMs.shift();
  }

  private fpsInfo(): { fps: number; frameMs: number; samples: number } {
    const samples = this.frameTimesMs.length;
    if (samples === 0) return { fps: 0, frameMs: 0, samples: 0 };

    let total = 0;
    for (const frameMs of this.frameTimesMs) total += frameMs;
    const frameMs = total / samples;
    return { fps: frameMs > 0 ? 1000 / frameMs : 0, frameMs, samples };
  }

  // -------------------------------------------------------------------------
  // Boot → chapter select
  // -------------------------------------------------------------------------

  private async boot(): Promise<void> {
    // 512×288 = 32×18 tile 16 px. Đặt trong code để không phụ thuộc Project Settings.
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
    // `SHOW_ALL` tính lại band mỗi lần canvas đổi kích thước, nên camera world phải bám
    // theo đúng band đó; nếu không phòng bị cắt ở 4:3 và lệch ở 21:9 (xem applyViewport).
    view.on('canvas-resize', this.onCanvasResize, this);
    // Cocos chỉ nghe phím trên #GameCanvas: chưa focus thì WASD/R không ăn cho tới khi click.
    document.getElementById('GameCanvas')?.focus();

    this.saveRepo = createSaveRepository();
    this.save = this.saveRepo.load();
    if (this.saveRepo.lastLoadError !== null) {
      console.warn(`[YokaiField] Save hỏng, dùng save mặc định: ${this.saveRepo.lastLoadError}`);
    }
    this.installDebugHook();

    this.manifest = await this.loadManifest();
    this.prepareCamera();
    this.createWorldLayers();
    await this.showChapterSelect();
  }

  private async showChapterSelect(): Promise<void> {
    const save = this.save;
    if (save === null) throw new Error('Bootstrap: chưa load save');

    const chapters: ChapterButton[] = [];
    for (let chapter = 1; chapter <= CHAPTER_COUNT; chapter += 1) {
      const hasData = CHAPTER_FOLDERS[chapter] !== undefined;
      chapters.push({
        chapter,
        hasData,
        playable: hasData && chapter <= save.chaptersUnlocked,
      });
    }

    const canvas = this.ensureUiRoot();
    this.menuRoot?.destroy();
    this.menuRoot = await buildChapterSelect(canvas, {
      chapters,
      best: save.best,
      onSelect: (chapter) => {
        void this.startChapter(chapter);
      },
    });

    // Chỉ báo 'menu' sau khi nút đã dựng xong: debug/headless click ngay khi thấy
    // status 'menu' thì nút phải tồn tại rồi (nếu không click rơi vào hư không).
    this.status = 'menu';

    console.log(
      `[YokaiField] Chapter select: best chapter ${save.best.chapter} · room ${save.best.room}, ` +
        `unlocked ${save.chaptersUnlocked}/${CHAPTER_COUNT}.`,
    );
  }

  /** Load toàn bộ `.tmx` của chapter rồi bắt đầu run ở phòng 1. */
  private async startChapter(chapterNumber: number): Promise<void> {
    if (this.status !== 'menu') return;

    const folder = CHAPTER_FOLDERS[chapterNumber];
    if (folder === undefined) {
      console.warn(`[YokaiField] Chapter ${chapterNumber} chưa có dữ liệu .tmx — không mở.`);
      return;
    }

    this.status = 'loading';
    this.menuRoot?.destroy();
    this.menuRoot = null;

    try {
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

      const player = this.createPlayer(firstRoom.playerStart);
      this.createRoom(firstRoom);

      await this.createBullets(player);
      await this.createHud();

      const actorLayer = this.actorLayer;
      if (actorLayer === null) throw new Error('Bootstrap: chưa có actor-layer');

      this.combat = new CombatLoop({
        player,
        bulletView: this.bulletView,
        manifest,
        actorLayer,
        level: firstRoom,
        monsterFor: (role) => this.monsterFor(firstRoom.chapter, role),
      });

      this.status = 'playing';
      this.persistBest(firstRoom.room);
      this.combat.startWave(0);
      console.log(
        `[YokaiField] Chapter ${loaded.chapter.chapter}: ${loaded.chapter.rooms.length} phòng từ ` +
          `resources/${folder}. Bắt đầu phòng ${run.roomLabel} ` +
          `(${firstRoom.waves.length} wave). player=${JSON.stringify(player.position)}`,
      );
    } catch (error: unknown) {
      this.fail(error);
    }
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

    sheets.add(OBSTACLE_SHEET);
    sheets.add(PLAYER_BULLET_SHEET);
    sheets.add(ENEMY_BULLET_SHEET);
    sheets.add(TELEGRAPH_RING_SHEET);
    sheets.add(HEART_SHEET);

    return Array.from(sheets);
  }

  /**
   * Camera world: ép đúng world convention (ortho, `orthoHeight = 9`, đứng ở tâm phòng).
   * Làm trong code để scene dựng tay sai thông số vẫn chạy đúng; scene không có camera thì
   * báo lỗi rõ ràng thay vì màn hình đen.
   */
  private prepareCamera(): void {
    const camera = this.pickWorldCamera();

    camera.projection = CocosCamera.ProjectionType.ORTHO;
    camera.orthoHeight = CAMERA_ORTHO_HEIGHT;
    // Camera world phải thấy layer DEFAULT. Camera của scene 2D template là camera UI
    // (`visibility = UI_2D`), dùng nhầm thì sprite world vô hình dù code vẫn chạy.
    camera.visibility = Layers.Enum.DEFAULT;
    camera.priority = 0;
    camera.clearFlags = CocosCamera.ClearFlag.SOLID_COLOR;
    camera.clearColor = BACKDROP_COLOR;
    camera.near = CAMERA_NEAR;
    camera.far = CAMERA_FAR;

    const node = camera.node;
    node.setPosition(ROOM_CENTER.x, ROOM_CENTER.y, CAMERA_Z);

    this.worldCamera = camera;
    this.createBackdropCamera();
    this.applyViewport();
  }

  /**
   * Camera nền cho bar letterbox. Camera thường chỉ clear trong viewport của nó, nên phần
   * ngoài band 16:9 là backbuffer (màu không đảm bảo); camera này phủ cả canvas nhưng
   * `visibility = 0` (không vẽ layer nào) để chỉ tô `BACKDROP_COLOR` phía sau mọi thứ.
   */
  private createBackdropCamera(): void {
    const node = new CocosNode('letterbox-camera');
    node.layer = Layers.Enum.DEFAULT;
    node.parent = this.node;

    const camera: Camera = node.addComponent(CocosCamera);
    camera.projection = CocosCamera.ProjectionType.ORTHO;
    camera.visibility = 0;
    // Vẽ trước camera world (priority 0) và camera UI (priority 1).
    camera.priority = -1;
    camera.clearFlags = CocosCamera.ClearFlag.SOLID_COLOR;
    camera.clearColor = BACKDROP_COLOR;
    camera.near = CAMERA_NEAR;
    camera.far = CAMERA_FAR;
    node.setPosition(ROOM_CENTER.x, ROOM_CENTER.y, CAMERA_Z);
  }

  /**
   * Letterbox: camera world chỉ vẽ đúng band 16:9 mà `SHOW_ALL` dành cho design
   * resolution (xem `core/view/letterbox.ts`), nên phòng 32×18 luôn vừa khít và canh
   * giữa; phần thừa của canvas do camera nền tô màu tối (xem `createBackdropCamera`).
   *
   * HUD không phải chỉnh: camera UI của Canvas đã vẽ design unit đúng 1:1 với band
   * (orthoHeight = nửa chiều cao canvas / scaleY), nên HUD tự dán mép phòng.
   */
  private applyViewport(): void {
    const canvas = screen.windowSize;
    const band = letterboxRect(canvas.width, canvas.height, DESIGN_WIDTH, DESIGN_HEIGHT);

    const world = this.worldCamera;
    if (world !== null) {
      world.rect = new CocosRect(band.x, band.y, band.width, band.height);
    }
  }

  private onCanvasResize(): void {
    this.applyViewport();
  }

  /**
   * Camera dùng để vẽ world.
   *
   * Scene 2D mặc định có `Canvas > Camera` — camera đó thuộc Canvas và chỉ thấy UI_2D.
   * Ta ưu tiên camera **không** nằm dưới Canvas; nếu scene chỉ có camera UI thì tự tạo
   * camera world để người dùng không phải sửa lại cấu trúc scene.
   */
  private pickWorldCamera(): Camera {
    const scene = director.getScene();
    const candidates: Camera[] = scene === null ? [] : scene.getComponentsInChildren(CocosCamera);
    const world = candidates.find((candidate) => !hasCanvasAncestor(candidate.node));
    if (world !== undefined) return world;

    const node = new CocosNode('world-camera');
    node.layer = Layers.Enum.DEFAULT;
    node.parent = this.node;
    const created: Camera = node.addComponent(CocosCamera);
    return created;
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
    this.roomRoot = buildRoom(roomLayer, level, asset, OBSTACLE_SHEET);
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
    // TRIMMED: node size = đúng frame, nên đổi sheet (Dead.png cao 64 px) không bị kéo giãn.
    sprite.sizeMode = CocosSprite.SizeMode.TRIMMED;
    sprite.trim = false;

    // 1 texture px = 1/16 unit. Player frame 32 px → 2 unit, art thật ~1 tile.
    const scale = ACTOR_SCALE;
    node.setScale(scale, scale, 1);

    node.addComponent(SpriteAnimator);
    const player: PlayerController = node.addComponent(PlayerController);
    player.init({ manifest, startAt });

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
   * Bootstrap chỉ còn lo run flow: wave → phòng → chapter.
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
    console.log(`[YokaiField] Phòng ${run.roomLabel} sạch.`);

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
        current.markWon();
        this.finishWin();
        return;
      }

      this.status = 'playing';
      current.advanceToNextRoom();
      this.enterRoom(current.room);
    }, ROOM_CLEAR_BANNER_SECONDS);
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
    this.persistBest(roomNumber);

    if (level.isBossRoom) this.spawnBoss(level);
    this.combat?.startWave(0);

    console.log(
      `[YokaiField] Vào phòng ${run.roomLabel} (${level.waves.length} wave` +
        `${level.isBossRoom ? ', boss' : ''}).`,
    );
  }

  /**
   * Boss placeholder (M2): art boss thật + hành vi tank có sẵn (telegraph → charge),
   * máu/hitbox lấy từ `core/boss/boss-defs.ts` (GDD §5: Tengu 60 máu).
   *
   * Chưa có pattern 3 phase / đạn boss — đó là M4. Ở đây chỉ cần một mục tiêu to, khoẻ,
   * phải giết thì phòng mới sạch, để chứng minh run flow tới CHAPTER CLEAR.
   */
  private spawnBoss(level: LevelData): void {
    const bossName = level.boss?.name;
    if (bossName === undefined) {
      throw new Error(`Phòng ${level.room} là boss room nhưng thiếu map property "boss"`);
    }

    const def = bossForSpriteName(bossName);
    if (def === undefined) {
      throw new Error(
        `Không có boss "${bossName}" trong BOSSES (TMX room-${level.room}); ` +
          'map property "boss" phải là spriteName, ví dụ TenguBlue.',
      );
    }

    const start = level.bossStart ?? BOSS_START_FALLBACK;
    const state: EnemyState = {
      id: `boss-${level.room}`,
      // Tank: telegraph rồi charge — placeholder đọc được đòn mà không cần AI mới.
      role: 'tank',
      elite: false,
      position: { x: start.x, y: start.y },
      health: def.maxHealth,
      maxHealth: def.maxHealth,
      action: { kind: 'idle' },
      actionStartedMs: 0,
    };

    const combat = this.combat;
    if (combat === null) throw new Error('Bootstrap: chưa có CombatLoop');

    combat.addEnemy(state, {
      monster: def.id,
      walkKey: `${def.id}.walk`,
      radiusTiles: def.hitboxRadiusTiles,
      // Thân boss ~3.5 tile: cho tầm chạm rộng hơn chaser để "đứng sát" là trúng.
      contactRangeTiles: def.hitboxRadiusTiles + 0.5,
      // Art boss đã to sẵn; hệ số silhouette của role tank không áp cho boss.
      roleScale: 1,
    });

    console.log(
      `[YokaiField] Boss placeholder ${def.displayName} (${def.maxHealth} HP) tại ` +
        `${start.x},${start.y} — dùng hành vi tank, pattern thật ở M4.`,
    );
  }

  private finishLoss(): void {
    const run = this.run;
    if (run === null) return;

    this.status = 'lost';
    run.markLost();
    console.log(`[YokaiField] Thua ở phòng ${run.roomLabel} (0 tim).`);
    this.showEndScreen(
      `GAME OVER\nPhòng ${run.roomLabel}\nNhấn R hoặc click để về chọn chapter`,
      END_LOSS_COLOR,
    );
  }

  private finishWin(): void {
    const run = this.run;
    this.status = 'won';
    const label = run?.roomLabel ?? '?/?';
    console.log(`[YokaiField] CHAPTER CLEAR — chapter ${run?.chapter ?? '?'}, phòng ${label}.`);
    this.showEndScreen(
      `CHAPTER CLEAR\nChapter ${run?.chapter ?? '?'} · ${label}\nNhấn R hoặc click để về chọn chapter`,
      END_WIN_COLOR,
    );
  }

  private showEndScreen(text: string, color: Color): void {
    this.endBanner?.destroy();
    this.endBanner = this.showBanner('end-screen', text, color);
    input.on(Input.EventType.KEY_DOWN, this.onEndKey, this);
    input.on(Input.EventType.MOUSE_DOWN, this.onEndClick, this);
  }

  /** R hoặc click ở màn kết thúc → dọn run và về chapter select (không reload scene). */
  private onEndKey(event: { readonly keyCode: number }): void {
    if (event.keyCode !== KeyCode.KEY_R) return;
    void this.returnToChapterSelect().catch((error: unknown) => this.fail(error));
  }

  private onEndClick(): void {
    void this.returnToChapterSelect().catch((error: unknown) => this.fail(error));
  }

  private async returnToChapterSelect(): Promise<void> {
    input.off(Input.EventType.KEY_DOWN, this.onEndKey, this);
    input.off(Input.EventType.MOUSE_DOWN, this.onEndClick, this);

    this.teardownRun();
    this.status = 'loading';
    await this.showChapterSelect();
  }

  /**
   * Dọn sạch một run khỏi scene. Huỷ từng nhóm node thay vì reload scene: reload sẽ
   * huỷ các load ảnh đang bay và devtools ghi `net::ERR_CONNECTION_RESET` (vô hại
   * nhưng làm bẩn cổng "không lỗi console"), còn teardown này chỉ bỏ đúng node của run.
   */
  private teardownRun(): void {
    this.roomClearBanner?.destroy();
    this.roomClearBanner = null;
    this.endBanner?.destroy();
    this.endBanner = null;

    this.combat?.destroy();
    this.combat = null;
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
    this.frameTimesMs.length = 0;
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
    if (!isDebugEnabled()) return;

    // Getter dạng arrow để đọc trạng thái sống của bootstrap; không alias `this`
    // (eslint `no-this-alias`) và không expose field nội bộ.
    const api: YokaiDebugApi = Object.defineProperties({} as YokaiDebugApi, {
      status: { get: () => this.status, enumerable: true },
      chapter: { get: () => this.run?.chapter ?? 0, enumerable: true },
      room: { get: () => this.run?.room ?? 0, enumerable: true },
      roomTotal: { get: () => this.run?.roomsTotal ?? 0, enumerable: true },
      killAll: { value: () => this.killAllEnemies(), enumerable: true },
      spawn: {
        value: (role: EnemyRole, elite?: boolean, at?: Vec2) => this.debugSpawn(role, elite, at),
        enumerable: true,
      },
      stress: { value: () => this.debugStress(), enumerable: true },
      fps: { value: () => this.fpsInfo(), enumerable: true },
      godMode: {
        value: (on: boolean) => {
          this.combat?.setGodMode(on);
          return this.combat?.isGodMode ?? false;
        },
        enumerable: true,
      },
      enemies: { value: () => this.combat?.snapshotEnemies() ?? [], enumerable: true },
      bulletCount: { value: () => this.combat?.enemyBulletCount() ?? 0, enumerable: true },
    });

    (window as unknown as { __yokai?: YokaiDebugApi }).__yokai = api;
    console.log(
      '[YokaiField] debug=1: window.__yokai sẵn sàng ' +
        '(status, chapter, room, roomTotal, killAll, spawn, stress, fps, godMode, enemies, bulletCount).',
    );
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

  protected onDestroy(): void {
    input.off(Input.EventType.KEY_DOWN, this.onEndKey, this);
    input.off(Input.EventType.MOUSE_DOWN, this.onEndClick, this);
    view.off('canvas-resize', this.onCanvasResize, this);
  }

  // -------------------------------------------------------------------------
  // Lỗi
  // -------------------------------------------------------------------------

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

  /** Chữ to giữa màn hình (lỗi load, game over, thắng chapter, room clear). */
  private showBanner(name: string, text: string, color: Color, fontSize = 13): Node {
    const canvas = this.ensureUiRoot();
    const label = createLabel(canvas, name, text);
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 4;
    label.color = color;
    label.enableWrapText = true;
    // RESIZE_HEIGHT + bề rộng cố định = xuống dòng theo màn hình thay vì tràn ra ngoài.
    label.overflow = CocosLabel.Overflow.RESIZE_HEIGHT;

    const transform: UITransform | null = label.node.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setContentSize(view.getVisibleSize().width - 16, 80);
    }
    label.node.setPosition(0, 0, 0);
    return label.node;
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

/** Bật API debug khi URL có `?debug=1` (acceptance tự động của milestone). */
function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

/** true nếu node nằm dưới một node có component Canvas (tức camera UI, không phải camera world). */
function hasCanvasAncestor(node: Node): boolean {
  let current: Node | null = node;
  while (current !== null) {
    if (current.getComponent(CocosCanvas) !== null) return true;
    current = current.parent;
  }
  return false;
}
