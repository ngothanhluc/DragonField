/**
 * Single entry point of the scene: attach this component to **one** node and the game runs.
 *
 * Everything is built in code (no prefabs, no `.scene` edits — rule 5 in AGENTS.md):
 *
 * ```text
 * animations.json (validate) ─┐
 * save (localStorage)        ─┼─> title ─> chapter select ─> loadDir .tmx ─> parse TMX ─> room + player + HUD ─> wave 1
 * ```
 *
 * Rooms are **data**: bootstrap loads every `.tmx` in `data/levels/chapter-<n>/`
 * (`resources.loadDir`), parses each one with the same parser vitest uses
 * (`core/level/tmx.ts`), sorts by the `room` property (`core/level/chapter.ts`), then builds
 * `RunState` with **the room total taken from data** — adding `room-10.tmx` makes the HUD show
 * `x/10`, with no code change.
 *
 * The run loop lives in `update()` and steps player → enemy → bullet → collision in the same
 * order as `core/sim/run-simulation.ts`, so engine behaviour matches what the sim balanced.
 *
 * The real GDD §5 boss (`core/boss/boss-defs.ts`): 3 phases, readable patterns.
 * Clearing the boss room ⇒ CHAPTER CLEAR ⇒ result (win) ⇒ chapter select.
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
import type { Settings } from '../core/save/settings';
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
import { FeelView } from './feel-view';
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

/** `cc` is an any module in this repo: types must be derived from the import value (see `texture-cache.ts`). */
type Camera = InstanceType<typeof CocosCamera>;
type Canvas = InstanceType<typeof CocosCanvas>;
type Color = InstanceType<typeof CocosColor>;
type JsonAsset = InstanceType<typeof CocosJsonAsset>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type TiledMapAsset = InstanceType<typeof CocosTiledMapAsset>;

/** Resources path (no `resources/` prefix, no file extension). */
const MANIFEST_PATH = 'data/animations';

/**
 * TMX folder of each chapter **that has data in this build** (M4: all 3).
 * To add a chapter, add the folder + one line here; chapter select picks it up.
 */
const CHAPTER_FOLDERS: Readonly<Record<number, string>> = {
  1: 'data/levels/chapter-1',
  2: 'data/levels/chapter-2',
  3: 'data/levels/chapter-3',
};

/**
 * Per-frame time cap. A tab hidden for a few seconds comes back with a huge `dt`; clamp it
 * so enemies do not jump across the room and i-frames are not eaten up in one frame.
 */
const MAX_STEP_MS = 50;

const END_LOSS_COLOR = new CocosColor(255, 96, 96, 255);
const END_WIN_COLOR = new CocosColor(255, 230, 120, 255);

/** Design resolution = exactly one room, 32×18 tiles of 16 px (512×288). */
const DESIGN_WIDTH = ROOM_COLS * TILE_SIZE_PX;
const DESIGN_HEIGHT = ROOM_ROWS * TILE_SIZE_PX;

/** How long "ROOM CLEAR" stays up before the next room, in seconds. */
const ROOM_CLEAR_BANNER_SECONDS = 1;

/**
 * Monster by role for each chapter (GDD §4). Keys must match the manifest — no
 * hyphen (`bluebat`, not `blue-bat`).
 *
 * Chapter 1 uses `greenoctopus` as its caster instead of `eye`: the blue eye shares
 * bluebat's palette, so both roles read the same in the first 2 seconds (M3 requirement).
 * The green octopus with its tentacled silhouette is clearly not a bat; its bullets are
 * tinted orange (see `bullet-view.ts`), so they do not blend into the enemy body either.
 */
const MONSTERS_BY_CHAPTER: Readonly<Record<number, Readonly<Record<EnemyRole, string>>>> = {
  1: { chaser: 'bluebat', caster: 'greenoctopus', tank: 'bear' },
  2: { chaser: 'spiderred', caster: 'greenoctopus', tank: 'trex' },
  3: { chaser: 'snake3', caster: 'lanternred', tank: 'cyclope' },
};

/** Player animations whose sheets must be ready before the first frame (`roll` unused in M1). */
const PLAYER_KEYS = [
  'player.idle.down',
  'player.walk.down',
  'player.attack.down',
  'player.hit.down',
  'player.dead',
] as const;

/** Bootstrap state — not `RunState` state. */
export type BootstrapStatus = DebugStatus;

interface LoadedChapter {
  readonly chapter: ChapterData;
  /** TiledMapAsset by room number, reused by `buildRoom`. */
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
   * Child layers of the `world` node, created exactly once in draw order: floor → actor → bullet.
   * Separate layers instead of piling everything into `worldRoot`, so a room change
   * (destroy + rebuild) does not paint the new floor over the player/enemies.
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
  /** Coin flight + damage numbers (UI, does not shake with the world camera). */
  private feel: FeelView | null = null;
  /** Gold shown on the HUD; credited as coins land (the real ledger is still `rewards`). */
  private displayedGold = 0;
  private fx: FxPool | null = null;
  private audio: AudioManager | null = null;
  private roomClearBanner: Node | null = null;
  /** Debug overlay: preview a skill card without granting it (M5 round 3). */
  private readonly skillPreview = new SkillPreview(() => this.ensureUiRoot());

  /** Gold/kills of the current run — written to the save at the end of the run (M5). */
  private rewards = new RunRewards();

  /** Skills of the current run (loadout, RNG roll, the 1-of-3 screen). */
  private readonly skills = new SkillRun();
  private combatRng = SeededRng.fromSeed(1);
  private readonly bossPhases = new BossPhaseBanner({
    showBanner: (name, text, color, fontSize) => this.showBanner(name, text, color, fontSize),
    schedule: (callback, delaySeconds) => this.scheduleOnce(callback, delaySeconds),
    winColor: END_WIN_COLOR,
    lossColor: END_LOSS_COLOR,
  });

  private currentLevel: LevelData | null = null;
  /** Real frame time of the last N frames — the debug `fps()` reads from here. */
  private readonly fpsMeter = new FpsMeter();
  private status: BootstrapStatus = 'loading';

  /** All M5 routing/screens live here so bootstrap is only boot + run + render. */
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
    applyFeelSettings: (settings) => this.setFeelSettings(settings),
    fail: (error) => this.fail(error),
  });

  start(): void {
    void this.boot().catch((error: unknown) => {
      this.fail(error);
    });
  }

  update(deltaTime: number): void {
    const rawDeltaMs = Math.min(Math.max(deltaTime, 0) * 1000, MAX_STEP_MS);
    // Shake/coin/damage numbers run on real time, before every status gate:
    // freezing mid-effect (hitstop/pause) looks like lag, and an offset camera
    // would stay offset.
    this.camera?.update(rawDeltaMs);
    this.feel?.update(rawDeltaMs);

    // Death: the sim stands still but death FX keep running until result opens.
    if (this.status === 'dying') {
      this.fx?.update(rawDeltaMs);
      return;
    }
    if (this.status !== 'playing') return;

    const player = this.player;
    const combat = this.combat;
    if (player === null || combat === null) return;

    // Measure the real frame (before the cap): `fps()` must reflect long frames too,
    // not be prettified by `MAX_STEP_MS`.
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

  /** Death: in-place FX + hold player.dead for ~1.4 s, then open result (GDD §9). */
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
    // 512×288 = 32×18 tiles of 16 px. Set in code so it does not depend on Project Settings.
    view.setDesignResolutionSize(DESIGN_WIDTH, DESIGN_HEIGHT, ResolutionPolicy.SHOW_ALL);
    // `SHOW_ALL` recomputes the band whenever the canvas resizes, so the world camera must
    // follow that exact band; otherwise the room is cropped at 4:3 and offset at 21:9 (see applyViewport).
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    // Cocos only listens for keys on #GameCanvas: until it is focused, WASD/R do nothing until a click.
    document.getElementById('GameCanvas')?.focus();

    this.saveRepo = createSaveRepository();
    this.save = this.saveRepo.load();
    if (this.saveRepo.lastLoadError !== null) {
      console.warn(`[YokaiField] Corrupt save, using the default save: ${this.saveRepo.lastLoadError}`);
    }

    this.audio = new AudioManager(this.node);
    this.audio.setVolume(this.save.settings.volume);
    this.audio.preload();
    this.audio.playMusic('title');
    this.installDebugHook();

    this.manifest = await this.loadManifest();
    this.waterLayout = await this.loadWaterLayout();
    this.camera = new WorldCamera(this.node, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.camera.onViewportChange = (scale) => {
      this.hud?.node.setScale(scale, scale, 1);
      this.feel?.setHudScale(scale);
    };
    this.setFeelSettings(this.save.settings);
    this.createWorldLayers();
    await this.screens.showTitle();
  }

  /** Load every `.tmx` of the chapter, then start the run at room 1. Menu entry only. */
  private async startChapter(chapterNumber: number): Promise<void> {
    const save = this.save;
    if (save === null) return;
    if (this.status !== 'menu') return;

    // The real gate: a disabled button is only visual; this is where locked chapters are blocked.
    const gate = chapterGate(save, chapterNumber, CHAPTER_FOLDERS[chapterNumber] !== undefined);
    if (!gate.allowed) {
      console.warn(`[YokaiField] Cannot open chapter ${chapterNumber}: ${gate.reason}`);
      return;
    }

    try {
      await this.launchChapter(chapterNumber);
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  /**
   * Start a run at `chapterNumber`, bypassing the menu guard (debug `startChapter`).
   * Seed for the run RNG; `undefined` = take it from the clock (different every run).
   */
  private async launchChapter(chapterNumber: number, seedArg?: number): Promise<void> {
    const folder = CHAPTER_FOLDERS[chapterNumber];
    if (folder === undefined) {
      console.warn(`[YokaiField] Chapter ${chapterNumber} has no .tmx data — not opening.`);
      return;
    }

    this.status = 'loading';
    this.screens.setScreen('playing');
    this.screens.clearMenu();
    this.skills.destroy();

    const save = this.save;
    if (save === null) throw new Error('Bootstrap: save not loaded');

    const seed =
      seedArg ?? ((Date.now() ^ (chapterNumber * 0x9e3779b1)) >>> 0);
    // Run baseline = base stats + purchased meta (hearts/damage/fire rate).
    this.skills.reset(seed, metaBaseline(DEFAULT_COMBAT, save));
    this.rewards = new RunRewards();
    // The combat RNG stream is separate from skill rolls: crit/boss patterns do not
    // change with the card the player picks.
    this.combatRng = SeededRng.fromSeed((seed ^ 0x85ebca6b) >>> 0);

    const manifest = this.manifest;
    if (manifest === null) throw new Error('Bootstrap: manifest not loaded yet');

    const loaded = await this.loadChapter(folder);
    this.chapter = loaded.chapter;
    this.chapterAssets = loaded.assets;
    const run = new RunState(loaded.chapter.chapter, loaded.chapter.rooms.length);
    this.run = run;

    // Preload **before** building anything: all art/JSON errors surface in one place, with full paths.
    await preloadSheets(this.collectSheets(manifest, loaded.chapter));

    const firstRoom = this.levelFor(1);
    if (firstRoom === null) {
      throw new Error(`"resources/${folder}" has no room 1`);
    }

    const fxLayer = this.fxLayer;
    if (fxLayer === null) throw new Error('Bootstrap: no fx-layer');
    this.fx = await createFxPool(fxLayer);

    const player = this.createPlayer(firstRoom.playerStart);
    player.applyStats(this.skills.stats());
    // Meta max HP is above 6: a run starts with full hearts, not 6/7.
    player.heal(player.maxHearts);
    this.createRoom(firstRoom);

    await this.createBullets(player);
    await this.createHud();
    const actorLayer = this.actorLayer;

    if (actorLayer === null) throw new Error('Bootstrap: no actor-layer');

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
      onKill: (role, elite, position) => this.awardKill(role, elite, position),
      onDamage: (info) => this.feel?.spawnDamage(info.position, info.amount, info.crit),
      ...(this.fx !== null ? { fx: this.fx } : {}),
      ...(this.camera !== null ? { shake: this.camera.shake } : {}),
    });

    this.status = 'playing';
    this.screens.setScreen('playing');
    this.persistBest(firstRoom.room);
    this.combat.startWave(0);
    if (this.hud !== null) syncCombatHud(this.hud, player, this.combat);
    this.hud?.setSkills(this.skills.entries);
    this.displayedGold = 0;
    this.hud?.setGold(0);
    console.log(
      `[YokaiField] Chapter ${loaded.chapter.chapter}: ${loaded.chapter.rooms.length} rooms from ` +
        `resources/${folder}. Starting room ${run.roomLabel} ` +
        `(${firstRoom.waves.length} waves). seed=${seed} player=${JSON.stringify(player.position)}`,
    );
  }

  private loadManifest(): Promise<AnimationManifest> {
    return this.loadJson(MANIFEST_PATH).then((json) => {
      try {
        return validateManifest(json);
      } catch (error: unknown) {
        throw new Error(`"resources/${MANIFEST_PATH}.json" is invalid: ${errorMessage(error)}`);
      }
    });
  }

  /** Animated water layout (ch2); the file is generated by `scripts/dress-rooms.ts`. */
  private loadWaterLayout(): Promise<WaterLayout> {
    return this.loadJson('data/water-layout').then((json) => {
      try {
        return parseWaterLayout(json);
      } catch (error: unknown) {
        throw new Error(`"resources/data/water-layout.json" is invalid: ${errorMessage(error)}`);
      }
    });
  }

  /**
   * Load every `TiledMapAsset` in the chapter folder (engine order is not guaranteed),
   * parse each file with the core parser, sort by `room`, then validate the whole chapter.
   */
  private loadChapter(folder: string): Promise<LoadedChapter> {
    return new Promise<LoadedChapter>((onLoad, onFail) => {
      resources.loadDir(
        folder,
        CocosTiledMapAsset,
        (error: Error | null | undefined, assets: TiledMapAsset[] | null | undefined) => {
          // Cocos calls the callback with `null` **or `undefined`** on success.
          if (error || !assets || assets.length === 0) {
            const cause = error ? error.message : 'no TiledMapAsset found';
            onFail(
              new Error(
                `Could not load any room in "resources/${folder}". ` +
                  `Check that the .tmx files are imported (Type = tiled-map). Cause: ${cause}`,
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
                throw new Error(`${source}: room ${level.room} duplicates another .tmx`);
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
   * `resources.load` with an explicit type, wrapped in a Promise and **naming the path** in the
   * error — the path is the only thing that tells "forgot to import" apart from "bad schema".
   */
  private loadJson(path: string): Promise<unknown> {
    return new Promise<unknown>((onLoad, onFail) => {
      resources.load(
        path,
        CocosJsonAsset,
        (error: Error | null | undefined, asset: JsonAsset | null | undefined) => {
          // Cocos calls the callback with `null` **or `undefined`** on success. Comparing
          // with `=== null` treats `undefined` as an error and then reads `.message` on
          // undefined — exactly the runtime error "Cannot read properties of undefined (reading 'message')".
          if (error || !asset) {
            const cause = error ? error.message : 'asset came back empty';
            onFail(new Error(`Could not load "resources/${path}.json". Cause: ${cause}`));
            return;
          }
          onLoad(asset.json);
        },
      );
    });
  }

  /**
   * Collect the sheets to preload: player animations, walk of every monster this chapter uses,
   * every boss animation (if there is a boss room), plus obstacle/bullet/heart sheets.
   * Preload once so the first frame has no white sprites.
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
          // Elites are a separate generated PNG (ADR-015); preload both so a debug
          // `spawn(role, true)` renders immediately in any room of the chapter.
          sheets.add(resolve(manifest, `${monster}.elite.walk.down`).sheet);
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

  /** world → room/actor/bullet; this order is the Cocos 2D draw order. */
  private createWorldLayers(): void {
    const worldRoot = new CocosNode('world');
    // Cocos only draws a Sprite under a RenderRoot2D (Canvas is one); world is not under Canvas.
    worldRoot.addComponent(RenderRoot2D);
    worldRoot.parent = this.node;

    this.roomLayer = this.addLayer('room-layer', worldRoot);
    this.actorLayer = this.addLayer('actor-layer', worldRoot);
    this.bulletLayer = this.addLayer('bullet-layer', worldRoot);
    // FX above actors + bullets: explosions/impacts are not painted over by enemies.
    this.fxLayer = this.addLayer('fx-layer', worldRoot);
  }

  private addLayer(name: string, parent: Node): Node {
    const node = new CocosNode(name);
    node.parent = parent;
    return node;
  }

  /** Build the new room and replace the old one (old node `destroy()` lets the engine clean children). */
  private createRoom(level: LevelData): void {
    const roomLayer = this.roomLayer;
    if (roomLayer === null) throw new Error('Bootstrap: no room-layer');

    const asset = this.chapterAssets.get(level.room);
    if (asset === undefined) {
      throw new Error(`TiledMapAsset not loaded for room ${level.room} (${level.id})`);
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
      throw new Error('Bootstrap: no manifest/actor-layer — cannot build the player');
    }

    const node = new CocosNode('player');
    node.parent = actorLayer;

    const sprite: Sprite = node.addComponent(CocosSprite);
    // CUSTOM: the animator sets contentSize/anchor per frame (Idle 32×32, Dead 32×64).
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;

    // 1 texture px = 1/16 unit. Player frame 32 px → 2 units, the art itself is ~1 tile.
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
    // World draws at integer multiples so it can be smaller than the UI band; shrink the HUD to hug the room edges.
    const hudScale = this.camera?.hudScale ?? 1;
    node.setScale(hudScale, hudScale, 1);
    this.hud = hud;

    // Coins/damage numbers are built after the HUD so they know where the gold cell is.
    const feel = new FeelView();
    await feel.init(canvas, {
      goldAnchor: () => this.hud?.goldAnchor() ?? { x: 0, y: 0 },
      onCoinArrive: (amount) => this.onCoinArrived(amount),
    });
    feel.setHudScale(hudScale);
    this.feel = feel;
    if (this.save !== null) this.setFeelSettings(this.save.settings);
  }

  /**
   * Dedicated UI Canvas + camera, built in code.
   *
   * The world camera does **not see the `UI_2D` layer** by default (`CAMERA_DEFAULT_MASK`
   * excludes it), so the HUD needs its own camera with `visibility = UI_2D`. Canvas anchors
   * that camera at the screen centre and sets `orthoHeight` from the design resolution.
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
    // The world camera already paints the background; the UI camera only draws on top, without clearing colour.
    camera.clearFlags = CocosCamera.ClearFlag.DEPTH_ONLY;
    camera.visibility = Layers.Enum.UI_2D;
    camera.priority = 1;
    camera.near = 1;
    // Canvas puts its camera at z = 1000, so `far` must be > 1000 to avoid clipping the HUD.
    camera.far = 2000;

    canvas.cameraComponent = camera;

    this.uiRoot = canvasNode;
    return canvasNode;
  }

  // -------------------------------------------------------------------------
  // Run loop
  // -------------------------------------------------------------------------

  /**
   * Contact damage, enemy bullets and hitstop all moved to `CombatLoop` (M3).
   * Bootstrap only handles run flow now: wave → room → skill → chapter.
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

    // Room-clear reward (GDD §7): boss 50, normal room 5, times Greed.
    const roomGold = this.rewards.awardRoomClear(
      level.isBossRoom,
      this.player?.derivedStats.goldMultiplier ?? 1,
    );
    this.flyGold(roomGold, this.player?.position ?? { x: ROOM_COLS / 2, y: ROOM_ROWS / 2 });

    // Second Wind: heal hearts on every room clear (GDD §6).
    const healPerRoom = this.player?.derivedStats.healPerRoom ?? 0;
    if (healPerRoom > 0) this.player?.heal(healPerRoom);
    if (this.hud !== null && this.player !== null) {
      syncCombatHud(this.hud, this.player, this.combat);
    }
    this.hud?.setSkills(this.skills.entries);
    console.log(`[YokaiField] Room ${run.roomLabel} clear (+${roomGold} gold).`);

    // Stop the sim (update() returns when status is not 'playing') and hold the text for ~1 s so
    // the player can read "room clear" before the screen changes. Timing uses Cocos'
    // scheduler, not setTimeout — the callback is dropped automatically when the scene reloads.
    this.status = 'room-clear';
    this.roomClearBanner?.destroy();
    this.roomClearBanner = this.showBanner('room-clear', 'ROOM CLEAR', END_WIN_COLOR, 20);
    // Celebrate the clear — except on the chapter's last room, where `chapter-clear` plays
    // ~1 s later from `finishWin()`.
    if (run.room < run.roomsTotal) playSfx('room-clear');

    this.scheduleOnce(() => {
      const current = this.run;
      if (!this.isValid || current === null || this.status !== 'room-clear') return;

      this.roomClearBanner?.destroy();
      this.roomClearBanner = null;

      // The last room of the chapter (count taken from data) = this chapter's run is over.
      // Do not use `RunState.isBossRoom`: a chapter may have normal rooms after the boss.
      if (current.room >= current.roomsTotal) {
        this.finishWin();
        return;
      }

      this.openSkillPick();
    }, ROOM_CLEAR_BANNER_SECONDS);
  }

  /** Roll a 1-of-3 skill with the run RNG and open the picker; if the pool is empty, move on. */
  private openSkillPick(): void {
    const choices = this.skills.roll();

    if (choices.length === 0) {
      console.log('[YokaiField] Skill pool exhausted — no cards, moving to the next room.');
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
   * Pick a card by index or id. Shared by clicks, keys 1/2/3 and debug.
   * `false` when there is no picker or the card is invalid.
   */
  private chooseSkill(indexOrId: number | string): boolean {
    if (this.status !== 'skill-pick') return false;
    const picked = this.skills.choose(indexOrId);
    if (picked === null) return false;

    const { def, result } = picked;
    this.applyLoadout(result.healNow);
    console.log(
      `[YokaiField] Took ${def.name} → stack ${result.stacks}/${def.maxStacks}` +
        `${result.healNow > 0 ? `, healed ${result.healNow} hearts` : ''}.`,
    );

    this.advanceRoom();
    return true;
  }

  /** Apply the new loadout to player + HUD. `healNow` is Vitality's one-off heal. */
  private applyLoadout(healNow = 0): void {
    const player = this.player;
    const stats = this.skills.stats();
    player?.applyStats(stats, healNow);
    this.hud?.setSkills(this.skills.entries);
    if (player !== null) this.hud?.setMaxHearts(player.maxHearts);
    this.hud?.setHearts(player?.hearts ?? 0);
  }

  /** Move to the next room after a skill was picked (or the pool was empty). */
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
      this.fail(new Error(`Chapter ${run.chapter} is missing room ${roomNumber} (RunState ${run.roomLabel})`));
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
      if (combat === null) throw new Error('Bootstrap: no CombatLoop');
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
      `[YokaiField] Entering room ${run.roomLabel} (${level.waves.length} waves` +
        `${level.isBossRoom ? ', boss' : ''}).`,
    );
  }

  private finishLoss(): void {
    const run = this.run;
    if (run === null) return;
    if (run.status === 'lost' || run.status === 'won') return;

    run.markLost();
    this.audio?.stopMusic();
    console.log(`[YokaiField] Lost in room ${run.roomLabel} (0 hearts).`);
    this.screens.finishRun(false);
  }

  private finishWin(): void {
    const run = this.run;
    if (run === null) return;
    if (run.status === 'won' || run.status === 'lost') return;

    // GDD §2: winning a chapter unlocks the next; `commitRunEnd` writes both gold and unlocks.
    run.markWon();
    this.audio?.stopMusic();
    playSfx('chapter-clear');
    console.log(`[YokaiField] CHAPTER CLEAR — chapter ${run.chapter}, room ${run.roomLabel}.`);
    this.screens.finishRun(true);
  }

  /** Credit gold for one kill, then fly a coin from the death spot to the HUD gold cell. */
  private awardKill(role: EnemyRole, elite: boolean, position: Vec2): void {
    const multiplier = this.player?.derivedStats.goldMultiplier ?? 1;
    const amount = this.rewards.awardKill(role, elite, multiplier);
    this.flyGold(amount, position);
  }

  /** A coin flies to the gold cell; the HUD total is credited when it lands (`onCoinArrived`). */
  private flyGold(amount: number, position: Vec2): void {
    if (!(amount > 0)) return;
    const feel = this.feel;
    if (feel === null) {
      this.onCoinArrived(amount);
      return;
    }
    feel.flyGold(position, amount);
  }

  /** The HUD total always equals `rewards.goldEarned` once the last coin lands. */
  private onCoinArrived(amount: number): void {
    if (!(amount > 0)) return;
    this.displayedGold = Math.min(Number.MAX_SAFE_INTEGER, this.displayedGold + amount);
    this.hud?.setGold(this.displayedGold);
  }

  /** Accessibility flags (shake, damage numbers) applied immediately when changed in Settings. */
  private setFeelSettings(settings: Settings): void {
    if (this.camera !== null) this.camera.shake.enabled = settings.screenShake;
    if (this.feel !== null) this.feel.damageNumbersEnabled = settings.damageNumbers;
  }

  /** Snapshot the run for the result screen before teardown (ScreenFlow knows no RunState/combat). */
  private runSnapshot(): RunSnapshot | null {
    const run = this.run;
    if (run === null) return null;
    return { chapter: run.chapter, room: run.room, roomsTotal: run.roomsTotal, durationMs: this.combat?.clockMs ?? 0, goldEarned: this.rewards.goldEarned, kills: this.rewards.killCount };
  }
  /**
   * Remove a run from the scene. Destroys node groups instead of reloading the scene: a reload
   * cancels in-flight image loads and devtools logs `net::ERR_CONNECTION_RESET` (harmless but
   * pollutes the "no console errors" gate), while this teardown drops only the run's own nodes.
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
    this.feel?.destroy();
    this.feel = null;
    this.displayedGold = 0;

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

  /** Record the best room when entering a new room; a save error must not kill the run. */
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
        `[YokaiField] Best updated: chapter ${next.best.chapter} · room ${next.best.room}.`,
      );
    } catch (error: unknown) {
      console.warn(`[YokaiField] Could not write best: ${errorMessage(error)}`);
    }
  }

  /** `?debug=1` → `window.__yokai` for headless acceptance. Without debug, nothing is exposed. */
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


  /** Debug: take a skill outside the picker; returns the stack count after (0 for an unknown id). */
  private debugGrantSkill(id: string, stacks: number): number {
    const grant = this.skills.grant(id, stacks);
    if (grant.acquired) this.applyLoadout(grant.healNow);
    console.log(
      `[YokaiField] debug grantSkill ${id} ×${stacks} → stack ${grant.stacks}`,
    );
    return grant.stacks;
  }

  /** Debug spawn — only meaningful while inside a room. */
  private debugSpawn(role: EnemyRole, elite = false, at?: Vec2): string {
    const combat = this.combat;
    if (combat === null || this.status !== 'playing') {
      console.warn(`[YokaiField] debug spawn skipped: not in a room (status ${this.status})`);
      return '';
    }
    const id = combat.spawnDebug(role, elite, at);
    console.log(`[YokaiField] debug spawn ${role}${elite ? ' elite' : ''} → ${id}`);
    return id;
  }

  /** M3 stress test: 8 enemies + >= 40 bullets, invincible player, measure fps with `fps()`. */
  private debugStress(): boolean {
    const combat = this.combat;
    if (combat === null || this.status !== 'playing') {
      console.warn(`[YokaiField] debug stress skipped: not in a room (status ${this.status})`);
      return false;
    }
    combat.startStress();
    console.log(
      `[YokaiField] debug stress: 8 enemies + ${STRESS_ENEMY_BULLETS} bullets (>= 40 per the M3 milestone), godMode on.`,
    );
    return true;
  }

  /**
   * Kill every living enemy/boss **through the normal damage path** (`EnemyView.takeDamage`),
   * so wave/room clear runs exactly like real play. Returns the number of targets killed.
   */
  private killAllEnemies(): number {
    const killed = this.combat?.killAll() ?? 0;
    console.log(
      `[YokaiField] debug killAll: ${killed} enemies in room ${this.run?.roomLabel ?? '?'}.`,
    );
    return killed;
  }

  private uiText(): readonly DebugUiText[] {
    return collectUiText(this.uiRoot);
  }

  /** Debug: leftover placeholder art/broken animation keys still on screen; empty means clean. */






  protected onDestroy(): void {
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.camera?.destroy();
    this.audio?.destroy();
    this.audio = null;
    this.screens.destroy();
  }

  // -------------------------------------------------------------------------
  // Errors
  // -------------------------------------------------------------------------

  /** Big centred text (load error, game over, chapter win, room clear). */
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

  /** Show the error on screen **and** in the console, then stop the run loop. */
  private fail(error: unknown): void {
    this.status = 'error';
    const message = errorMessage(error);
    console.error(`[YokaiField] Bootstrap failed: ${message}`);

    try {
      this.showBanner('load-error', `LOAD FAILED\n${message}`, END_LOSS_COLOR);
    } catch (nested: unknown) {
      console.error(`[YokaiField] Could not build the error screen: ${errorMessage(nested)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Data queries
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
        `Chapter ${chapter} has no monster mapped for role "${role}" (see MONSTERS_BY_CHAPTER)`,
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
