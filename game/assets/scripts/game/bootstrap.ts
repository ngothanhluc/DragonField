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
  TiledMapAsset as CocosTiledMapAsset,
  resources,
  view,
} from 'cc';
import { validateAttachments, type AttachmentsData } from '../core/art/attachments';
import { resolve, validateManifest } from '../core/art/manifest';
import type { AnimationManifest } from '../core/art/manifest';
import {
  CHARACTER_ROSTER,
  resolveCharacterAnimKey,
  type CharacterAnimKind,
  type CharacterDef,
} from '../core/characters/roster';
import { BOSSES, BOSS_IDS, type BossId } from '../core/boss/boss-defs';
import { pickBoss } from '../core/boss/boss-pool';
import { DEFAULT_COMBAT } from '../core/config';
import { DOORS_TUNING, SPECIAL_ROOMS_TUNING, XP_TUNING } from '../core/enemies/tuning';
import { edgeArrowTargets, roomEnemyTotal } from '../core/enemies/wave-scheduler';
import {
  XpTracker,
  xpDoorClearBonus,
  xpForKill,
} from '../core/xp/xp-curve';
import { XpOrbPool } from '../core/xp/xp-orbs';
import { rerollCost, spendSharedGoldForReroll } from '../core/xp/reroll';
import { hasAlternativeSkills } from '../core/skills/roll';
import { chapterFromLevels } from '../core/level/chapter';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
import type { ChapterData, EnemyRole, LevelData } from '../core/level/level-data';
import { parseTmxLevel } from '../core/level/tmx';
import { parseWaterLayout, waterAreasFor } from '../core/level/water-layout';
import type { WaterLayout } from '../core/level/water-layout';
import { chapterAtmosphere, parseAtmosphereConfig } from '../core/atmosphere/atmosphere';
import type { AtmosphereConfig } from '../core/atmosphere/atmosphere';
import { attachRoomAtmosphere } from './atmosphere-view';
import type { RoomAtmosphereParts } from './atmosphere-view';
import type { Vec2 } from '../core/math/vec2';
import { metaBaseline } from '../core/meta/run-stats';
import { SeededRng } from '../core/rng';
import { RunState } from '../core/run/run-state';
import { drawRunRooms } from '../core/run/room-draw';
import { RunRewards } from '../core/run/run-rewards';
import {
  COMBAT_REWARDS,
  DOOR_REWARDS,
  clearRewardFor,
  doorOffers,
  type DoorReward,
} from '../core/run/doors';
import {
  buyFromShop,
  chestReward,
  healHearts,
  isSpecialDoor,
  shopGold,
  shopOffers,
  specialRoomLevel,
  type ShopOffer,
  type SpecialKind,
} from '../core/run/special-rooms';
import { getSkill, type SkillDef } from '../core/skills/pool';
import { chapterGate } from '../core/save/chapter-gate';
import { withBest } from '../core/save/save-data';
import type { SaveData } from '../core/save/save-data';
import { applySettings } from '../core/save/settings';
import type { Settings } from '../core/save/settings';
import type { SaveRepository } from '../core/save/storage';
import { preloadSheets } from './assets/texture-cache';
import { createBanner } from './banner-ui';
import { BossPhaseBanner, spawnBossForRoom } from './boss-flow';
import { BulletView } from './bullet-view';
import { CombatLoop, PLAYER_RADIUS_TILES, STRESS_ENEMY_BULLETS, STRESS_ENEMY_COUNT } from './combat-loop';
import { CoverView } from './cover-view';
import type { CoverBody } from './cover-view';
import { DepthView } from './depth-view';
import { DoorView } from './door-view';
import type { DoorSpot } from './door-view';
import {
  isDebugEnabled,
  type DebugDoorSnapshot,
  type DebugSpecialSnapshot,
  type DebugStatus,
  type DebugUiText,
  type DebugVfxSnapshot,
  type DebugAtmosphereSnapshot,
  type DebugXpSnapshot,
} from './debug-api';
import { TELEGRAPH_RING_SHEET } from './enemy-view';
import { createFxPool } from './fx/effect-pool';
import type { FxPool } from './fx/effect-pool';
import {
  XP_ORB_SHEETS,
  createXpOrbView,
  spawnLevelUpBurst,
  xpOrbTierForValue,
  type XpOrbTier,
  type XpOrbView,
  type XpOrbVisual,
} from './xp-orb-view';
import {
  enemyProjectileKey,
  playerProjectileLook,
} from '../core/vfx/weapon-vfx';
import { FeelView } from './feel-view';
import { FpsMeter } from './fps-meter';
import { Hud, HEART_SHEET, MAX_EDGE_ARROWS } from './hud';
import type { DoorArrowOffset } from './hud';
import { syncCombatHud } from './hud-sync';
import { ACTOR_FEET_OFFSET_TILES, ACTOR_SCALE, buildRoom, obstacleSheets } from './level-view';
import type { PropView, RoomLayers } from './level-view';
import { PlayerController, setupPlayerVisualNodes } from './player-controller';
import { attachRoomWater } from './room-water';
import { WORLD_DRAW_LAYERS } from '../core/view/cover';
import {
  doorArrowTargets,
  doorHintVisible,
  type DoorArrowSource,
} from '../core/view/door-arrows';
import { WorldCamera } from './world-camera';
import { cullWorld } from './world-culler';
import type { CameraFocus } from './world-camera';
import { AudioManager, bossMusicId } from './audio/audio-manager';
import type { MusicId } from './audio/audio-manager';
import { playSfx } from './audio/sfx';
import { installDebugWiring } from './debug-wiring';
import { MenuBackdrop } from './menu-backdrop';
import { createSaveRepository } from './save-storage';
import { ScreenFlow } from './screen-flow';
import type { RunSnapshot } from './screen-flow';
import { SkillPreview } from './skill-preview';
import { SkillRun } from './skill-run';
import { SpecialRoomView } from './special-room-view';
import { buildShopPanel, type ShopBuyResult, type ShopPanel } from './shop-panel';
import { collectUiText } from './ui-text';

const { ccclass } = _decorator;

/** `cc` is an any module in this repo: types must be derived from the import value (see `texture-cache.ts`). */
type Camera = InstanceType<typeof CocosCamera>;
type Canvas = InstanceType<typeof CocosCanvas>;
type Color = InstanceType<typeof CocosColor>;
type JsonAsset = InstanceType<typeof CocosJsonAsset>;
type Node = InstanceType<typeof CocosNode>;
type TiledMapAsset = InstanceType<typeof CocosTiledMapAsset>;

/** Resources paths (no `resources/` prefix, no file extension). */
const MANIFEST_PATH = 'data/animations';
const ATTACHMENTS_PATH = 'data/attachments';

/**
 * TMX folder of each chapter **that has data in this build** (M4: all 3, #45 adds the desert).
 * To add a chapter, add the folder + one line here; chapter select picks it up.
 */
const CHAPTER_FOLDERS: Readonly<Record<number, string>> = {
  1: 'data/levels/chapter-1',
  2: 'data/levels/chapter-2',
  3: 'data/levels/chapter-3',
  4: 'data/levels/chapter-4',
};

/**
 * Standalone rooms for the browser proof (`?debug=1`, `__yokai.loadRoom(id)`), **not** part of
 * any chapter: `data/levels/dev/` is never in `CHAPTER_FOLDERS`, so no run can load them.
 */
const DEV_ROOMS: Readonly<Record<string, string>> = {
  'dev-big': 'data/levels/dev/room-big',
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

/** Minimum gap between XP pickup SFX plays so room-clear vacuum sounds crisp. */
const XP_PICKUP_SFX_COOLDOWN_MS = 65;

/** How close (tiles) the player must get to a door for walking into it to count. */
const DOOR_ENTER_TILES = 1;

/** How close (tiles) the player must get to the heal/shop NPC or the chest to use it. */
const SPECIAL_USE_TILES = 1;

/** Special-room art: preloaded at chapter launch so the NPC/chest never pops in. */
const SPECIAL_ACTOR_KEYS = ['npc.heal', 'npc.shop', 'npc.chest'] as const;

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
  1: {
    chaser: 'bluebat',
    caster: 'greenoctopus',
    tank: 'bear',
    sniper: 'kappagreen',
    splitter: 'slimegreen',
    splitling: 'slimegreen',
  },
  2: {
    chaser: 'spiderred',
    caster: 'greenoctopus',
    tank: 'trex',
    sniper: 'kappared',
    splitter: 'slime2',
    splitling: 'slime2',
  },
  // Chapter 4 — desert (#45): a snake chaser, the pack's unused floating eye as the caster,
  // the tyrant lizard as the brute, bones (skull) as the sniper and a slime as the splitter.
  4: {
    chaser: 'snake3',
    caster: 'eye',
    tank: 'trex',
    sniper: 'skullblue',
    splitter: 'slime3',
    splitling: 'slime3',
  },
  3: {
    chaser: 'snake3',
    caster: 'lanternred',
    tank: 'cyclope',
    sniper: 'skullblue',
    splitter: 'slime3',
    splitling: 'slime3',
  },
};

/** Logical player animations whose sheets must be ready before the first frame (`roll` unused). */
const CHARACTER_ANIM_KINDS: readonly CharacterAnimKind[] = ['idle', 'walk', 'attack', 'hit', 'dead'];
const CARDINAL_DIRECTIONS = ['down', 'up', 'left', 'right'] as const;

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
  private attachments: AttachmentsData | null = null;
  private waterLayout: WaterLayout | null = null;
  private atmosphereConfig: AtmosphereConfig | null = null;
  private chapter: ChapterData | null = null;
  private chapterAssets: ReadonlyMap<number, TiledMapAsset> = new Map();
  /**
   * The rooms of the current run, in play order: 8 normal rooms drawn from the chapter's pool by
   * the run seed + the boss (#38). `RunState.room` is a position in this list (1..9), not a
   * `.tmx` room number; `levelFor` does that lookup.
   */
  private runRooms: LevelData[] = [];
  private run: RunState | null = null;
  /** Doors drawn in the cleared room (#39); `null` outside the door phase. */
  private doorView: DoorView | null = null;
  /** Rewards currently offered by the doors, index-matched to `doorView.doors`. */
  private doorOfferList: readonly DoorReward[] = [];
  /** True while the room is cleared and the player walks to a door instead of fighting. */
  private doorPhase = false;
  /** Reward carried by the door taken after the previous room; decides this room's clear reward. */
  private roomReward: DoorReward | null = null;
  /** This room's clear reward, decided on clear and consumed after the banner. */
  private clearReward: DoorReward | null = null;
  /** Clock for the door phase: `CombatLoop` stops advancing once the room is cleared. */
  private doorClockMs = 0;
  /** Time since the doors opened, ms — drives the "choose a door" hint (#63). */
  private doorHintElapsedMs = 0;
  /** Door reward of the special slot the run just entered; consumed by `enterRoom`. */
  private pendingSpecial: SpecialKind | null = null;
  /** Live special room (#40): kind, its NPC/chest view and whether it was used. */
  private specialRoom: SpecialKind | null = null;
  private specialView: SpecialRoomView | null = null;
  private specialUsed = false;
  private specialFinished = false;
  private specialClockMs = 0;
  /** Open mid-run shop panel and its offers (index-matched to the cards). */
  private shopPanel: ShopPanel | null = null;
  private shopOfferList: readonly ShopOffer[] = [];
  private save: SaveData | null = null;
  private saveRepo: SaveRepository | null = null;

  /**
   * Child layers of the `world` node, created exactly once in draw order
   * (`WORLD_DRAW_LAYERS`): ground → actors → overlays → bullets, then FX and atmosphere.
   * Separate layers instead of piling everything into `worldRoot`, so a room change
   * (destroy + rebuild) does not paint the new floor over the player/enemies.
   */
  private roomLayer: Node | null = null;
  private actorLayer: Node | null = null;
  private overlayLayer: Node | null = null;
  private bulletLayer: Node | null = null;
  private fxLayer: Node | null = null;
  /** #36: y-sorts the actors layer (prop bases + actors) and fades canopies/grass. */
  private depth: DepthView | null = null;
  private cover: CoverView | null = null;
  /** Reused body list for the depth/cover pass (one frame, no per-frame array). */
  private readonly coverBodies: CoverBody[] = [];
  private roomRoot: Node | null = null;
  private uiRoot: Node | null = null;
  private camera: WorldCamera | null = null;
  /** Ticket #6: over-actor atmosphere sits above `fx-layer`, still below the HUD. */
  private atmosphereLayer: Node | null = null;
  /** Per-room atmosphere/decor nodes of the current room (destroyed on room change/effects toggle). */
  private roomAtmosphere: RoomAtmosphereParts | null = null;
  /** What the current room really draws (debug `atmosphere()` for the browser proof). */
  private atmosphereSnapshot: DebugAtmosphereSnapshot = { chapter: 0, layers: [], animals: 0, props: 0 };
  /** Seed of the running run: decor is placed from it so a room looks the same on re-entry. */
  private runSeed = 1;
  /** Living title / chapter-select room (#8); `null` before boot creates it. */
  private menuBackdrop: MenuBackdrop | null = null;

  private player: PlayerController | null = null;
  /** Playable character locked for the active run (M10: one character per run, no mid-run swap). */
  private runCharacter: CharacterDef | null = null;
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
  /** Pooled XP orbs + level-up progression for the active run (M12, ADR-021). */
  private readonly xpPool = new XpOrbPool();
  private xpOrbView: XpOrbView | null = null;
  private xpTracker: XpTracker | null = null;
  private readonly xpVisuals: Array<{
    x: number;
    y: number;
    tier: XpOrbTier;
    vacuuming: boolean;
  }> = [];
  private readonly xpHudCache: { level: number; current: number; required: number } = {
    level: 1,
    current: 0,
    required: 0,
  };
  private xpOrbElapsedSec = 0;
  private lastXpPickupSfxMs = Number.NEGATIVE_INFINITY;
  /** True when the current room was entered through an `'xp'` / Elite challenge door. */
  private isXpDoorRoom = false;
  /** True after combat clears while remaining XP orbs vacuum in and banner finishes. */
  private roomClearPending = false;
  private roomClearElapsedMs = 0;
  private clearClockMs = 0;
  private readonly bossPhases = new BossPhaseBanner({
    showBanner: (name, text, color, fontSize) => this.showBanner(name, text, color, fontSize),
    schedule: (callback, delaySeconds) => this.scheduleOnce(callback, delaySeconds),
    winColor: END_WIN_COLOR,
    lossColor: END_LOSS_COLOR,
  });

  private currentLevel: LevelData | null = null;
  /** Player position of the previous frame, for the follow camera's velocity (tiles/s). */
  private lastFocus: Vec2 | null = null;
  /** Reused buffers of the HUD edge-arrow pass (#41): no array allocation per frame. */
  private readonly arrowTargets: Vec2[] = [];
  private readonly arrowOffsets: Vec2[] = [];
  /** #63: drawn doors + their reward, and the door-arrow offsets built from them. */
  private readonly doorArrowSource: DoorArrowSource[] = [];
  private readonly doorArrowOffsets: DoorArrowOffset[] = [];
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
    showMenuBackdrop: (chapter) => {
      void this.menuBackdrop?.show(chapter);
    },
    clearMenuBackdrop: () => {
      this.menuBackdrop?.clear();
    },
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
    onCharacterChanged: (character) => {
      this.menuBackdrop?.setCharacter(character, this.attachments);
    },
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
    // would stay offset. The follow itself uses the player's last known position.
    this.camera?.update(rawDeltaMs, this.cameraFocus(rawDeltaMs));
    this.cullWorldToView();
    this.feel?.update(rawDeltaMs);

    // Death: the sim stands still but death FX keep running until result opens.
    if (this.status === 'dying') {
      this.fx?.update(rawDeltaMs);
      this.updateDepthAndCover(rawDeltaMs);
      return;
    }
    if (this.status !== 'playing') return;

    // The room is cleared and the doors are open: the player walks to one. `CombatLoop` would
    // report `cleared` forever here, so this phase steps the player alone.
    if (this.doorPhase) {
      this.updateDoorPhase(rawDeltaMs);
      return;
    }

    // A special room (#40) has no enemies: step the player alone and watch for the NPC/chest.
    if (this.specialRoom !== null) {
      this.updateSpecialPhase(rawDeltaMs);
      return;
    }

    // Room cleared: keep player movement and XP orb vacuum running until all orbs & queued
    // level-up modals resolve and the clear banner finishes before opening doors.
    if (this.roomClearPending) {
      this.updateRoomClearVacuum(rawDeltaMs);
      return;
    }

    const player = this.player;
    const combat = this.combat;
    if (player === null || combat === null) return;

    // Measure the real frame (before the cap): `fps()` must reflect long frames too,
    // not be prettified by `MAX_STEP_MS`.
    this.fpsMeter.record(Math.max(deltaTime, 0) * 1000);
    const deltaMs = rawDeltaMs;

    const result = combat.update(deltaMs);
    // After the combat step: the actors moved, and their tint was just rewritten — the cover
    // alpha must be the last word on the sprite colour for the frame (#36).
    this.updateDepthAndCover(rawDeltaMs);
    if (result.frozen) return;

    const leveledUp = this.stepXpOrbs(deltaMs, false);
    this.syncHud();
    this.updateHudArrows();

    if (result.playerDied) {
      this.beginDeath();
      return;
    }
    if (result.cleared) {
      this.beginRoomClear(leveledUp);
      return;
    }
    if (leveledUp) {
      this.openLevelUpSkillPick();
    }
  }

  /**
   * What the follow camera should track this frame: the player (tile units) and its velocity
   * derived from the previous frame, so the camera can look ahead of the motion.
   */
  private cameraFocus(deltaMs: number): CameraFocus | null {
    const player = this.player;
    if (player === null) return null;

    const position = player.position;
    const seconds = Math.max(0, deltaMs) / 1000;
    const previous = this.lastFocus;
    this.lastFocus = { x: position.x, y: position.y };

    if (previous === null || seconds <= 0) {
      return { target: position, velocity: { x: 0, y: 0 } };
    }
    return {
      target: position,
      velocity: {
        x: (position.x - previous.x) / seconds,
        y: (position.y - previous.y) / seconds,
      },
    };
  }

  /**
   * Keep only the room sprites the camera can see (big rooms only). A 32×18 room needs no
   * culling: everything is inside the view, and the pass would be pure overhead.
   *
   * Since #36/#41 this also culls what left the room tree: prop bases/overlays and grass tips
   * (parented to the actor/overlay layers) and the enemy sprites (by `Sprite.enabled`).
   */
  private cullWorldToView(): void {
    const camera = this.camera;
    const level = this.currentLevel;
    const root = this.roomRoot;
    if (camera === null || level === null || root === null) return;
    if (level.size.cols <= ROOM_COLS && level.size.rows <= ROOM_ROWS) return;

    const view = camera.worldViewRect();
    cullWorld(root, view);
    this.cover?.cullToView(view);
    this.combat?.cullToView(view);
  }

  /**
   * Border arrows for what the player cannot see (#41): the nearest off-screen enemies while the
   * room is not cleared. Once the doors are open (#63) the arrows point at the **drawn** doors
   * only — each with its offered reward — so the HUD can show the same icon and a door colour.
   * Target selection is core (`doorArrowTargets` for doors, `edgeArrowTargets` for enemies, both
   * tested); here it is only turned into offsets from the camera centre.
   */
  private updateHudArrows(): void {
    const hud = this.hud;
    const camera = this.camera;
    const player = this.player;
    const combat = this.combat;
    if (hud === null || camera === null || player === null || combat === null) return;

    const view = camera.tileViewRect();
    const centre = camera.position;

    // Doors are drawn from `doorOfferList` (not `level.doors`): the last normal room offers one
    // boss door, and pointing at a door that is not drawn sends the player to an empty spot.
    const doors = this.doorView?.doors ?? [];
    if (doors.length > 0) {
      this.doorArrowSource.length = 0;
      for (const door of doors) {
        this.doorArrowSource.push({ at: { x: door.x, y: door.y }, reward: door.reward });
      }
      const doorTargets = doorArrowTargets(
        player.position,
        view,
        this.doorArrowSource,
        MAX_EDGE_ARROWS,
      );
      this.doorArrowOffsets.length = 0;
      for (const target of doorTargets) {
        this.doorArrowOffsets.push({
          x: target.x - centre.x,
          y: target.y - centre.y,
          reward: target.reward,
        });
      }
      hud.setDoorArrows(this.doorArrowOffsets);
      return;
    }

    this.arrowTargets.length = 0;
    combat.collectAlivePositions(this.arrowTargets);
    const targets = edgeArrowTargets(
      player.position,
      view,
      this.arrowTargets,
      [],
      false,
      MAX_EDGE_ARROWS,
    );

    this.arrowOffsets.length = 0;
    for (const target of targets) {
      this.arrowOffsets.push({ x: target.x - centre.x, y: target.y - centre.y });
    }
    hud.setArrows(this.arrowOffsets);
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
    this.attachments = await this.loadAttachments();
    this.waterLayout = await this.loadWaterLayout();
    this.atmosphereConfig = await this.loadAtmosphere();
    this.camera = new WorldCamera(this.node, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.camera.onViewportChange = (scale) => {
      this.hud?.node.setScale(scale, scale, 1);
      this.feel?.setHudScale(scale);
    };
    this.setFeelSettings(this.save.settings);
    this.createWorldLayers();
    this.menuBackdrop = new MenuBackdrop({
      roomLayer: () => this.roomLayer,
      actorLayer: () => this.actorLayer,
      atmosphereLayer: () => this.atmosphereLayer,
      manifest: () => this.manifest,
      atmosphereConfig: () => this.atmosphereConfig,
      waterLayout: () => this.waterLayout,
      effects: () => this.save?.settings.effects ?? 'full',
      worldScale: () => this.camera?.hudScale ?? 1,
      chapterFolder: (chapter) => CHAPTER_FOLDERS[chapter],
      loadChapter: (folder) => this.loadChapter(folder),
      character: () => this.screens.selectedCharacter(),
      attachments: () => this.attachments,
    });
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
    // The living menu room must be gone before the run's own room is built.
    this.menuBackdrop?.clear();
    this.skills.destroy();

    const save = this.save;
    if (save === null) throw new Error('Bootstrap: save not loaded');

    const seed =
      seedArg ?? ((Date.now() ^ (chapterNumber * 0x9e3779b1)) >>> 0);
    this.runSeed = seed;
    // Lock the playable character once when the run starts (M10: one character per run, no mid-run swap).
    this.runCharacter = this.screens.selectedCharacter();
    // Run baseline = base stats + purchased meta (hearts/damage/fire rate).
    this.skills.reset(seed, metaBaseline(DEFAULT_COMBAT, save));
    this.rewards = new RunRewards();
    // A new run starts with no door reward, clean XP state, and no doors on screen (#39).
    this.roomReward = null;
    this.clearReward = null;
    this.isXpDoorRoom = false;
    this.roomClearPending = false;
    this.roomClearElapsedMs = 0;
    this.clearClockMs = 0;
    this.xpPool.clear();
    this.xpOrbElapsedSec = 0;
    this.lastXpPickupSfxMs = Number.NEGATIVE_INFINITY;
    this.doorPhase = false;
    this.doorOfferList = [];
    this.doorView?.destroy();
    this.doorView = null;
    this.clearSpecialRoom();
    this.pendingSpecial = null;
    // The combat RNG stream is separate from skill rolls: crit/boss patterns do not
    // change with the card the player picks.
    this.combatRng = SeededRng.fromSeed((seed ^ 0x85ebca6b) >>> 0);

    const manifest = this.manifest;
    if (manifest === null) throw new Error('Bootstrap: manifest not loaded yet');

    const loaded = await this.loadChapter(folder);
    this.chapter = loaded.chapter;
    this.chapterAssets = loaded.assets;
    // The run's room list is drawn **once** from the chapter pool by the run seed (#38).
    this.runRooms = drawRunRooms(loaded.chapter, seed);
    const run = new RunState(loaded.chapter.chapter, this.runRooms.length);
    this.run = run;
    this.xpTracker = new XpTracker(loaded.chapter.chapter);

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
    // The room build sets the tile → world flip for this room's height (a room may be > one screen).
    player.teleport(firstRoom.playerStart);

    const bulletLayer = this.bulletLayer ?? this.node;
    this.xpOrbView = await createXpOrbView(bulletLayer, XP_TUNING.orbs.poolCapacity);
    await this.createBullets(player);
    await this.createHud();
    const actorLayer = this.actorLayer;

    if (actorLayer === null) throw new Error('Bootstrap: no actor-layer');

    this.audio?.playMusic(chapterMusic(firstRoom.chapter));

    const combat = new CombatLoop({
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
      // #41: enemies refuse to attack from outside what the player can actually see.
      view: () => this.camera?.tileViewRect() ?? null,
    });

    this.combat = combat;
    combat.setEffectsMode(save.settings.effects);
    this.status = 'playing';
    this.screens.setScreen('playing');
    this.persistBest(run.room);
    this.combat.startWaves(this.waveSeed(firstRoom), run.room);
    this.syncHud();
    this.hud?.setSkills(this.skills.entries);
    this.displayedGold = 0;
    // The HUD shows the gold the player can actually spend: meta gold + this run's banked gold.
    this.hud?.setGold(this.hudGoldTotal());
    console.log(
      `[YokaiField] Chapter ${loaded.chapter.chapter}: ${loaded.chapter.rooms.length} rooms in the ` +
        `pool, playing 9 from resources/${folder}. Starting room ${run.roomLabel} ` +
        `(${firstRoom.waves.length} waves, pool room ${firstRoom.room}). seed=${seed} ` +
        `player=${JSON.stringify(player.position)}`,
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

  /** Playable character attach points and per-frame bob (M10). */
  private loadAttachments(): Promise<AttachmentsData> {
    return this.loadJson(ATTACHMENTS_PATH).then((json) => {
      try {
        return validateAttachments(json);
      } catch (error: unknown) {
        throw new Error(`"resources/${ATTACHMENTS_PATH}.json" is invalid: ${errorMessage(error)}`);
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

  /** Chapter atmosphere + living decor (#6); numbers live in the JSON, not in `tuning.json`. */
  private loadAtmosphere(): Promise<AtmosphereConfig> {
    return this.loadJson('data/atmosphere').then((json) => {
      try {
        return parseAtmosphereConfig(json);
      } catch (error: unknown) {
        throw new Error(`"resources/data/atmosphere.json" is invalid: ${errorMessage(error)}`);
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

  /** `resources.load` of one `TiledMapAsset`, naming the path in the error like `loadJson`. */
  private loadTiledMap(path: string): Promise<TiledMapAsset> {
    return new Promise<TiledMapAsset>((onLoad, onFail) => {
      resources.load(
        path,
        CocosTiledMapAsset,
        (error: Error | null | undefined, asset: TiledMapAsset | null | undefined) => {
          if (error || !asset) {
            const cause = error ? error.message : 'asset came back empty';
            onFail(new Error(`Could not load "resources/${path}.tmx". Cause: ${cause}`));
            return;
          }
          onLoad(asset);
        },
      );
    });
  }

  /**
   * Debug: load a standalone dev room (`data/levels/dev/`) into the live world so the browser
   * proof can run along its walls and into its corners. Hosted by a chapter-1 run when none is
   * active, because the player/combat/HUD already exist there.
   */
  private async loadRoom(id: string): Promise<boolean> {
    const path = DEV_ROOMS[id];
    if (path === undefined || this.status === 'loading') return false;

    try {
      if (this.run === null || this.currentLevel === null) {
        await this.launchChapter(1);
      }

      const asset = await this.loadTiledMap(path);
      const level = parseTmxLevel(asset.tmxXmlStr, { source: `resources/${path}.tmx` });

      this.status = 'playing';
      this.screens.setScreen('playing');
      this.xpPool.clear();
      this.xpOrbView?.clear();
      this.isXpDoorRoom = false;
      this.roomClearPending = false;
      this.roomClearElapsedMs = 0;
      this.createRoom(level, asset);
      this.combat?.enterRoom(level);
      this.player?.teleport(level.playerStart);
      // A dev room is inspected on its own: treat it as the run's first slot (smallest crowd).
      this.combat?.startWaves(this.waveSeed(level), 1);
      this.syncHud();

      console.log(
        `[YokaiField] Dev room '${id}': ${level.size.cols}×${level.size.rows} tiles, ` +
          `${level.waves.length} wave(s), ${level.obstacles.length} obstacle(s).`,
      );
      return true;
    } catch (error: unknown) {
      this.fail(error);
      return false;
    }
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

    for (const character of CHARACTER_ROSTER) {
      for (const kind of CHARACTER_ANIM_KINDS) {
        const key = resolveCharacterAnimKey(manifest, character, kind, 'down');
        sheets.add(resolve(manifest, key).sheet);
      }
      if (
        character.defaultLoadout.weaponForm === 'attachment' &&
        character.defaultLoadout.attachmentItemId !== null
      ) {
        const itemDef = this.attachments?.items[character.defaultLoadout.attachmentItemId];
        const spritePrefix =
          itemDef !== undefined
            ? itemDef.sprite
            : `attachment.${character.defaultLoadout.attachmentItemId}`;
        for (const dir of CARDINAL_DIRECTIONS) {
          const entry = manifest.sprites[`${spritePrefix}.${dir}`];
          if (entry !== undefined) sheets.add(entry.sheet);
        }
      }
    }

    for (const room of chapter.rooms) {
      for (const wave of room.waves) {
        for (const spawn of wave.enemies) {
          const monster = this.monsterFor(room.chapter, spawn.role);
          sheets.add(resolve(manifest, `${monster}.walk.down`).sheet);
          // Elites are a separate generated PNG (ADR-015); preload both so a debug
          // `spawn(role, true)` renders immediately in any room of the chapter.
          sheets.add(resolve(manifest, `${monster}.elite.walk.down`).sheet);
          // #42: splitlings use a palette-remapped variant of the splitter sheet.
          if (spawn.role === 'splitter' || spawn.role === 'splitling') {
            sheets.add(resolve(manifest, `${monster}.splitling.walk.down`).sheet);
          }
        }
      }

      if (room.isBossRoom) {
        // The run's pick (#43), not the TMX label: preload exactly the boss that will spawn.
        const def = BOSSES[this.chapterBoss(room.chapter)];
        for (const key of def.animations) {
          sheets.add(resolve(manifest, key).sheet);
        }
      }
    }

    // Bullet sheets are loaded by `BulletView.init` from the manifest (one per loadout/chapter).
    sheets.add(TELEGRAPH_RING_SHEET);
    sheets.add(HEART_SHEET);
    for (const sheet of XP_ORB_SHEETS) sheets.add(sheet);
    // Special rooms (#40): the NPC/chest sheets, so the first frame of the room has no pop.
    for (const key of SPECIAL_ACTOR_KEYS) sheets.add(resolve(manifest, key).sheet);
    for (const sheet of obstacleSheets(chapter.chapter)) sheets.add(sheet);

    // Chapter atmosphere + living decor (#6): preload so the first frame of a room has no pop.
    const atmosphere =
      this.atmosphereConfig === null ? null : chapterAtmosphere(this.atmosphereConfig, chapter.chapter);
    if (atmosphere !== null) {
      for (const layer of atmosphere.layers) {
        if (layer.sprite !== null) sheets.add(resolve(manifest, layer.sprite).sheet);
      }
      for (const key of [...atmosphere.decor.animals, ...atmosphere.decor.props]) {
        sheets.add(resolve(manifest, key).sheet);
      }
    }

    return Array.from(sheets);
  }

  /**
   * Boss of this run for `chapter` (#43): a debug URL override wins, then the run seed's pick
   * from the chapter pool. The same call decides preload, spawn and music, so they never disagree.
   */
  private chapterBoss(chapter: number): BossId {
    const forced = this.forcedBoss();
    if (forced !== null) return forced;
    return pickBoss(chapter, this.runSeed);
  }

  /** `?debug=1&boss=<id>` forces the pick so the browser proof can replay a specific boss. */
  private forcedBoss(): BossId | null {
    if (!isDebugEnabled() || typeof window === 'undefined') return null;
    try {
      const raw = new URLSearchParams(window.location.search).get('boss');
      return BOSS_IDS.find((id) => id === raw) ?? null;
    } catch {
      // A malformed query string is not a run-stopping error.
      return null;
    }
  }

  /** world → ground/actors/overlays/bullets/fx; this order is the Cocos 2D draw order. */
  private createWorldLayers(): void {
    const worldRoot = new CocosNode('world');
    // Cocos only draws a Sprite under a RenderRoot2D (Canvas is one); world is not under Canvas.
    worldRoot.addComponent(RenderRoot2D);
    worldRoot.parent = this.node;

    // One node per `WORLD_DRAW_LAYERS` entry, back to front: the list in core and the scene
    // graph cannot drift apart. Overlays sit between actors and bullets (#36).
    for (const name of WORLD_DRAW_LAYERS) this.addLayer(name, worldRoot);

    this.roomLayer = worldRoot.getChildByName('ground');
    this.actorLayer = worldRoot.getChildByName('actors');
    this.overlayLayer = worldRoot.getChildByName('overlays');
    this.bulletLayer = worldRoot.getChildByName('bullets');
    // FX above actors + bullets: explosions/impacts are not painted over by enemies, and the
    // yield/telegraph sprites stay readable on top of a faded canopy.
    this.fxLayer = this.addLayer('fx', worldRoot);
    // Chapter atmosphere that draws over actors (#6) stays below the HUD and at low alpha,
    // so telegraphs and bullets always read on top of it.
    this.atmosphereLayer = this.addLayer('atmosphere', worldRoot);

    const actors = this.actorLayer;
    this.depth = actors === null ? null : new DepthView(actors);
  }

  private addLayer(name: string, parent: Node): Node {
    const node = new CocosNode(name);
    node.parent = parent;
    return node;
  }

  /** Prop layers for a run room (#36): bases sort with actors, canopies/roofs above them. */
  private roomLayers(): RoomLayers | undefined {
    const props = this.actorLayer;
    const overlays = this.overlayLayer;
    if (props === null || overlays === null) return undefined;

    return {
      props,
      overlays,
      onProps: (views) => this.attachProps(views),
    };
  }

  /**
   * The room's props finished loading: register them with the depth sort and start fading
   * canopies/roofs (the nodes themselves are already parented by `buildProps`).
   */
  private attachProps(views: readonly PropView[]): void {
    if (!this.isValid) return;
    this.cover?.destroy();
    const cover = new CoverView();
    cover.setProps(views);
    this.cover = cover;
    this.depth?.setProps(views);
  }

  /**
   * One visual frame for #36: y-sort the actors layer and fade canopies/roofs/grass. Runs on
   * real time after the combat step (so positions and tints are final for the frame), and also
   * while dying, so a fade keeps moving when the simulation stands still.
   */
  private updateDepthAndCover(deltaMs: number): void {
    const player = this.player;
    const depth = this.depth;
    if (player === null || depth === null) return;

    const bodies = this.coverBodies;
    bodies.length = 0;
    bodies.push({
      node: player.node,
      position: player.position,
      radiusTiles: PLAYER_RADIUS_TILES,
      footY: player.position.y + ACTOR_FEET_OFFSET_TILES,
    });
    this.combat?.collectEnemyBodies(bodies);

    depth.update(bodies);
    this.cover?.update(deltaMs, bodies);
  }

  /** Build the new room and replace the old one (old node `destroy()` lets the engine clean children). */
  private createRoom(level: LevelData, assetOverride?: TiledMapAsset): void {
    const roomLayer = this.roomLayer;
    if (roomLayer === null) throw new Error('Bootstrap: no room-layer');

    const asset = assetOverride ?? this.chapterAssets.get(level.room);
    if (asset === undefined) {
      throw new Error(`TiledMapAsset not loaded for room ${level.room} (${level.id})`);
    }

    this.roomRoot?.destroy();
    // Prop sprites of the old room live on the shared actor/overlay layers, not under `roomRoot`
    // (#36), so they must be destroyed explicitly before the new room's props are built.
    this.cover?.destroy();
    this.cover = null;
    this.depth?.clearProps();
    this.roomRoot = buildRoom(roomLayer, level, asset, this.roomLayers());
    const water = this.waterLayout;
    if (water !== null) {
      attachRoomWater(
        this.roomRoot,
        waterAreasFor(water, level.chapter, level.room),
        level.size.rows,
      );
    }
    // Atmosphere and living decor are rebuilt with the room; their nodes die with `roomRoot`.
    this.rebuildRoomAtmosphere(level);
    this.currentLevel = level;
    // Hard cut on room entry: the new room's size, centred on the player's start.
    this.camera?.enterRoom(level);
    this.lastFocus = null;
  }

  /**
   * Build/replace the atmosphere layers (#6) and this room's animals/props.
   *
   * Called on every room build and when the Effects setting changes while paused (Reduced drops
   * secondary layers, animals and animated props, so the current room is rebuilt from
   * `visibleAtmosphere` rather than patched piecemeal).
   */
  private rebuildRoomAtmosphere(level: LevelData): void {
    this.roomAtmosphere?.destroy();
    this.roomAtmosphere = null;
    // The old over-actors node is gone (or about to be replaced): stop pinning it first.
    this.camera?.setScreenSpaceNode(null);

    const config = this.atmosphereConfig;
    const manifest = this.manifest;
    const save = this.save;
    const roomRoot = this.roomRoot;
    this.atmosphereSnapshot = { chapter: level.chapter, layers: [], animals: 0, props: 0 };
    if (config === null || manifest === null || save === null || roomRoot === null) return;

    // Same run seed + room → identical placement on re-entry, different from other rooms.
    const seed = (this.runSeed ^ (level.chapter * 0x9e3779b1) ^ (level.room * 0x85ebca6b)) >>> 0;

    const parts = attachRoomAtmosphere({
      roomRoot,
      overLayer: this.atmosphereLayer,
      level,
      config,
      manifest,
      effects: save.settings.effects,
      seed,
      // Chapter 2 ripples belong on the river/waterfall, not on dry grass.
      rippleAreas:
        this.waterLayout === null ? [] : waterAreasFor(this.waterLayout, level.chapter, level.room),
      playerOf: () => this.player?.position ?? null,
    });
    if (parts === null) return;

    this.roomAtmosphere = parts;
    this.atmosphereSnapshot = parts.snapshot;
    // Raylight/fog/ashes/vignette are screen-space: they follow the camera instead of scrolling.
    this.camera?.setScreenSpaceNode(parts.atmosphere.over);
  }

  private createPlayer(startAt: Vec2): PlayerController {
    const manifest = this.manifest;
    const actorLayer = this.actorLayer;
    if (manifest === null || actorLayer === null) {
      throw new Error('Bootstrap: no manifest/actor-layer — cannot build the player');
    }

    // Keep `player` sprite-free so `player-body` and `player-attachment` sit as sibling children
    // and `setSiblingIndex` draws attachments behind or in front of the body (M10).
    const node = new CocosNode('player');
    node.parent = actorLayer;

    // 1 texture px = 1/16 unit. Player frame 32 px → 2 units, Cultivator 16 px → 1 unit.
    const scale = ACTOR_SCALE;
    node.setScale(scale, scale, 1);

    const { bodyNode } = setupPlayerVisualNodes(node);
    const character = this.runCharacter ?? this.screens.selectedCharacter();
    const player: PlayerController = node.addComponent(PlayerController);
    player.init({
      manifest,
      startAt,
      rng: this.combatRng,
      ...(this.fx !== null ? { fx: this.fx } : {}),
      character,
      attachments: this.attachments,
      bodyNode,
    });

    this.player = player;
    return player;
  }

  private async createBullets(player: PlayerController): Promise<void> {
    const node = new CocosNode('bullets');
    node.parent = this.bulletLayer ?? this.node;

    const bulletView: BulletView = node.addComponent(BulletView);
    await bulletView.init(player.bullets, { chapter: () => this.run?.chapter ?? 1 });
    // Push the look once; `applyLoadout`/`setFeelSettings` push it again when it really changes,
    // so the per-frame sync never builds a loadout map.
    bulletView.setLoadout(this.skills.snapshot());
    bulletView.setEffectsMode(this.save?.settings.effects ?? 'full');
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
      cameraCentre: () => this.camera?.position ?? { x: ROOM_COLS / 2, y: ROOM_ROWS / 2 },
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
   * Room cleared: pay clear gold + Second Wind, spawn `'xp'` door bonus orbs if applicable,
   * show the clear banner, and vacuum every remaining XP orb before opening doors.
   * Unified XP-only skill acquisition (ADR-021): clearing a room no longer grants a free pick.
   */
  private beginRoomClear(pendingLevelUp: boolean): void {
    const run = this.run;
    const level = this.currentLevel;
    const combat = this.combat;
    if (run === null || level === null || combat === null) return;

    run.onRoomCleared();
    this.persistBest(run.room);

    // Room-clear reward (GDD §7): boss 50, normal room 5, times Greed.
    const roomGold = this.rewards.awardRoomClear(
      level.isBossRoom,
      this.player?.derivedStats.goldMultiplier ?? 1,
    );
    const playerPos = this.player?.position ?? { x: level.size.cols / 2, y: level.size.rows / 2 };
    this.flyGold(roomGold, playerPos);

    // Second Wind: heal hearts on every room clear (GDD §6).
    const healPerRoom = this.player?.derivedStats.healPerRoom ?? 0;
    if (healPerRoom > 0) this.player?.heal(healPerRoom);

    const finalRoom = run.room >= run.roomsTotal;
    this.clearReward = finalRoom ? null : clearRewardFor(run.room, this.roomReward);
    this.roomReward = null;
    if (this.clearReward === 'gold') this.payDoorGold();

    if (this.isXpDoorRoom && !level.isBossRoom) {
      const bonus = xpDoorClearBonus(run.chapter);
      if (bonus > 0) this.spawnXpBonusBurst(bonus, playerPos, level);
    }

    combat.clearBullets();
    this.syncHud();
    this.hud?.setSkills(this.skills.entries);
    console.log(`[YokaiField] Room ${run.roomLabel} clear (+${roomGold} gold).`);

    this.roomClearPending = true;
    this.roomClearElapsedMs = 0;
    this.clearClockMs = combat.clockMs;
    this.roomClearBanner?.destroy();
    this.roomClearBanner = this.showBanner('room-clear', 'ROOM CLEAR', END_WIN_COLOR, 20);
    // Celebrate the clear — except on the chapter's last room, where `chapter-clear` plays
    // ~1 s later from `finishWin()`.
    if (!finalRoom) playSfx('room-clear');

    if (!finalRoom && (pendingLevelUp || (this.xpTracker?.pendingLevelUps ?? 0) > 0)) {
      this.openLevelUpSkillPick();
    }
  }

  /** Step player movement + room-clear XP auto-vacuum until orbs, modals, and banner finish. */
  private updateRoomClearVacuum(deltaMs: number): void {
    const run = this.run;
    const player = this.player;
    const level = this.currentLevel;
    if (run === null || player === null || level === null) return;

    this.roomClearElapsedMs += deltaMs;
    this.clearClockMs += deltaMs;
    player.step(this.clearClockMs, deltaMs, [], level);
    this.fx?.update(deltaMs);
    this.updateDepthAndCover(deltaMs);

    const leveledUp = this.stepXpOrbs(deltaMs, true);
    this.syncHud();

    const finalRoom = run.room >= run.roomsTotal;
    if (!finalRoom && (leveledUp || (this.xpTracker?.pendingLevelUps ?? 0) > 0)) {
      this.openLevelUpSkillPick();
      return;
    }

    const orbsDone = this.xpPool.size === 0;
    const picksDone = finalRoom || (this.xpTracker?.pendingLevelUps ?? 0) === 0;
    const bannerDone = this.roomClearElapsedMs >= ROOM_CLEAR_BANNER_SECONDS * 1000;
    if (orbsDone && picksDone && bannerDone) {
      this.finishRoomClear();
    }
  }

  private finishRoomClear(): void {
    const run = this.run;
    this.roomClearPending = false;
    this.roomClearBanner?.destroy();
    this.roomClearBanner = null;
    if (run === null) return;

    // The last room of the chapter (count taken from data) = this chapter's run is over.
    // Do not use `RunState.isBossRoom`: a chapter may have normal rooms after the boss.
    if (run.room >= run.roomsTotal) {
      this.finishWin();
      return;
    }
    this.openDoors();
  }

  /** Advance pooled XP orbs, grant collected XP, and return whether a level-up pick is queued. */
  private stepXpOrbs(deltaMs: number, roomCleared: boolean): boolean {
    const player = this.player;
    const tracker = this.xpTracker;
    if (player === null || tracker === null) return false;

    const dtSec = Math.max(0, deltaMs) / 1000;
    this.xpOrbElapsedSec += dtSec;
    const collectedXp = this.xpPool.step(dtSec, player.position, roomCleared);
    this.syncXpOrbView();

    if (collectedXp > 0) {
      const nowWallMs = performance.now();
      if (nowWallMs - this.lastXpPickupSfxMs >= XP_PICKUP_SFX_COOLDOWN_MS) {
        this.lastXpPickupSfxMs = nowWallMs;
        playSfx('xp-pickup');
      }
      tracker.grant(collectedXp);
    }
    return tracker.pendingLevelUps > 0;
  }

  /** Sync pooled `XpOrbView` without allocating new visual wrapper objects per frame. */
  private syncXpOrbView(): void {
    const view = this.xpOrbView;
    if (view === null) return;

    const orbs = this.xpPool.activeOrbs;
    const count = orbs.length;
    for (let index = 0; index < count; index += 1) {
      const orb = orbs[index];
      if (orb === undefined) continue;
      let visual = this.xpVisuals[index];
      if (visual === undefined) {
        visual = {
          x: orb.position.x,
          y: orb.position.y,
          tier: xpOrbTierForValue(orb.value),
          vacuuming: orb.phase === 'vacuum' || orb.phase === 'magnet',
        };
        this.xpVisuals[index] = visual;
      } else {
        visual.x = orb.position.x;
        visual.y = orb.position.y;
        visual.tier = xpOrbTierForValue(orb.value);
        visual.vacuuming = orb.phase === 'vacuum' || orb.phase === 'magnet';
      }
    }
    this.xpVisuals.length = count;
    view.sync(this.xpVisuals as readonly XpOrbVisual[], this.xpOrbElapsedSec);
  }

  /** Split `'xp'` door room-clear bonus into 3–5 large diamond orbs around `center`. */
  private spawnXpBonusBurst(totalBonus: number, center: Vec2, level: LevelData): void {
    const count = Math.min(5, Math.max(3, Math.floor(totalBonus / 25)));
    const base = Math.floor(totalBonus / count);
    let remainder = totalBonus - base * count;
    const radius = 2.2;
    const maxX = Math.max(1, level.size.cols - 1);
    const maxY = Math.max(1, level.size.rows - 1);

    for (let index = 0; index < count; index += 1) {
      const value = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      const angle = (index / count) * Math.PI * 2;
      const x = Math.min(maxX, Math.max(1, center.x + Math.cos(angle) * radius));
      const y = Math.min(maxY, Math.max(1, center.y + Math.sin(angle) * radius));
      this.xpPool.spawn({
        position: { x, y },
        value,
        scatterDir: { x: Math.cos(angle), y: Math.sin(angle) },
      });
    }
    this.syncXpOrbView();
  }

  /** Pause combat cleanly and open the 1-of-3 skill modal for a queued `XpTracker` level-up. */
  private openLevelUpSkillPick(): void {
    const tracker = this.xpTracker;
    if (tracker === null || tracker.pendingLevelUps <= 0) return;

    const choices = this.skills.roll();
    if (choices.length === 0) {
      console.log('[YokaiField] Skill pool exhausted — clearing queued level-up picks.');
      while (tracker.consumeLevelUp()) {
        // Pool exhausted; nothing left to offer.
      }
      this.syncHud();
      return;
    }

    // Clear any transient room-clear banner so it never overlaps `CHOOSE A SKILL`.
    this.roomClearBanner?.destroy();
    this.roomClearBanner = null;
    this.status = 'skill-pick';
    this.screens.setScreen('skill-pick');
    this.player?.resetInput();
    playSfx('level-up');
    this.openLevelUpModal(choices);
  }

  private openLevelUpModal(choices: readonly SkillDef[]): void {
    const canvas = this.ensureUiRoot();
    const availableGold = this.shopGoldTotal();
    const cost = rerollCost(this.skills.rerollsUsed);
    const hasAlternatives = hasAlternativeSkills(this.skills.snapshot(), choices);

    void this.skills
      .open(
        canvas,
        choices,
        (index) => this.chooseSkill(index),
        {
          cost,
          availableGold,
          hasAlternatives,
          onReroll: () => this.rerollActiveSkillPick(),
        },
      )
      .then(() => {
        if (this.status !== 'skill-pick') return;
        console.log(
          `[YokaiField] Level-up pick (LV ${this.xpTracker?.level ?? 1}): ` +
            `${choices.map((skill) => `${skill.id}(${skill.rarity})`).join(', ')}`,
        );
      })
      .catch((error: unknown) => this.fail(error));
  }

  /** Spend shared gold (run first, then meta bank) to reroll the active level-up cards. */
  private rerollActiveSkillPick(): boolean {
    if (this.status !== 'skill-pick' || this.specialRoom !== null) return false;
    const currentChoices = this.skills.choices;
    if (currentChoices === null || !hasAlternativeSkills(this.skills.snapshot(), currentChoices)) {
      return false;
    }

    const save = this.save;
    const repo = this.saveRepo;
    if (save !== null && repo !== null) {
      const spend = spendSharedGoldForReroll(
        save,
        this.rewards.goldEarned,
        this.skills.rerollsUsed,
      );
      if (!spend.ok) return false;

      if (spend.save !== save) {
        try {
          repo.save(spend.save);
        } catch (error: unknown) {
          console.warn(`[YokaiField] Could not persist reroll gold: ${errorMessage(error)}`);
          return false;
        }
        this.save = spend.save;
      }

      const spentFromRun = this.rewards.spend(this.rewards.goldEarned - spend.runGold);
      this.displayedGold = Math.max(0, this.displayedGold - spentFromRun);
      this.hud?.setGold(this.hudGoldTotal());
    } else {
      const cost = rerollCost(this.skills.rerollsUsed);
      if (this.rewards.goldEarned < cost) return false;
      const spent = this.rewards.spend(cost);
      this.displayedGold = Math.max(0, this.displayedGold - spent);
      this.hud?.setGold(this.hudGoldTotal());
    }

    const nextChoices = this.skills.reroll();
    if (nextChoices === null || nextChoices.length === 0) return false;

    playSfx('ui-confirm');
    console.log(
      `[YokaiField] Rerolled skill choices (#${this.skills.rerollsUsed}): ` +
        `${nextChoices.map((skill) => skill.id).join(', ')}.`,
    );
    this.openLevelUpModal(nextChoices);
    return true;
  }

  /**
   * Pick a card by index or id. Shared by clicks, keys 1/2/3, chest picks, and debug.
   * `false` when there is no picker or the card is invalid.
   */
  private chooseSkill(indexOrId: number | string): boolean {
    if (this.status !== 'skill-pick') return false;
    if (this.specialRoom !== null) return this.chooseChestSkill(indexOrId);

    const picked = this.skills.choose(indexOrId);
    if (picked === null) return false;

    const { def, result } = picked;
    this.applyLoadout(result.healNow);
    this.xpTracker?.consumeLevelUp();
    this.syncHud();
    console.log(
      `[YokaiField] Took ${def.name} → stack ${result.stacks}/${def.maxStacks}` +
        `${result.healNow > 0 ? `, healed ${result.healNow} hearts` : ''}.`,
    );

    const remaining = this.xpTracker?.pendingLevelUps ?? 0;
    if (remaining > 0) {
      const nextChoices = this.skills.roll();
      if (nextChoices.length > 0) {
        playSfx('level-up');
        this.openLevelUpModal(nextChoices);
        return true;
      }
      while (this.xpTracker?.consumeLevelUp()) {
        // Pool exhausted; clear remaining queued picks.
      }
      this.syncHud();
    }

    this.status = 'playing';
    this.screens.setScreen('playing');
    this.player?.resetInput();

    if (this.roomClearPending) {
      const pos = this.player?.position;
      if (pos !== undefined) {
        spawnLevelUpBurst(this.fx, pos, this.save?.settings.effects ?? 'full', {
          radiusTiles: XP_TUNING.levelUpWave.knockbackRadiusTiles,
        });
      }
    } else {
      this.combat?.applyLevelUpResumeWave();
    }
    return true;
  }

  /** Apply the new loadout to player + HUD. `healNow` is Vitality's one-off heal. */
  private applyLoadout(healNow = 0): void {
    const player = this.player;
    const stats = this.skills.stats();
    player?.applyStats(stats, healNow);
    const owned = this.skills.snapshot();
    player?.setLoadout(owned);
    this.bulletView?.setLoadout(owned);
    this.hud?.setSkills(this.skills.entries);
    if (player !== null) this.hud?.setMaxHearts(player.maxHearts);
    this.hud?.setHearts(player?.hearts ?? 0);
  }

  /** Pay the `gold` door's bonus instead of a skill pick (#39): coin fly + gold SFX. */
  private payDoorGold(): void {
    const bonus = Math.max(0, Math.round(DOORS_TUNING.goldBonus));
    if (!(bonus > 0)) return;

    this.rewards.awardBonus(bonus);
    const level = this.currentLevel;
    this.flyGold(
      bonus,
      this.player?.position ?? {
        x: level?.size.cols ?? ROOM_COLS / 2,
        y: level?.size.rows ?? ROOM_ROWS / 2,
      },
    );
    playSfx('gold');
    console.log(`[YokaiField] Gold door: +${bonus} gold instead of a skill pick.`);
  }

  /** Normal rooms in this run: the door count that ends with the boss door. */
  private drawnNormalRooms(): number {
    return this.runRooms.filter((room) => !room.isBossRoom).length;
  }

  /** Special doors stay off until #40 ships the rooms behind them. */
  private enabledDoorRewards(): readonly DoorReward[] {
    return DOORS_TUNING.specialRoomsEnabled ? DOOR_REWARDS : COMBAT_REWARDS;
  }

  /**
   * Open the doors of the room just cleared (#39). The reward taken here decides the **next**
   * room's clear reward; walking into a door advances the run (no extra modal).
   */
  private openDoors(): void {
    const run = this.run;
    const level = this.currentLevel;
    const parent = this.overlayLayer;
    if (run === null || level === null || parent === null) return;

    const offers = doorOffers(
      this.runSeed,
      run.room,
      this.drawnNormalRooms(),
      this.enabledDoorRewards(),
    );
    const spots: DoorSpot[] = offers.map((reward, index) => ({
      reward,
      at: this.doorPosition(level, index),
    }));

    this.doorView?.destroy();
    this.doorView = new DoorView(parent, spots);
    this.doorOfferList = offers;
    this.doorClockMs = this.combat?.clockMs ?? 0;
    // #63: fresh hint window; the arrows for these doors are drawn by `updateDoorPhase`.
    this.doorHintElapsedMs = 0;
    this.hud?.setDoorHint(doorHintVisible(this.doorHintElapsedMs));
    // The fight is over: drop leftover bullets (the enemy is gone, but a shot may be mid-flight)
    // so nothing frozen hangs on screen while the player walks to a door.
    this.combat?.clear();
    this.bulletView?.sync();
    this.doorPhase = true;
    this.status = 'playing';
    this.screens.setScreen('playing');
    this.roomClearBanner?.destroy();
    this.roomClearBanner = null;
    // Draw the door arrows on the frame the doors open, instead of one frame later.
    this.updateHudArrows();
    console.log(
      `[YokaiField] Doors after room ${run.roomLabel}: ${offers.join(', ')}.`,
    );
  }

  /**
   * Where door `index` stands, in tile space. `#38` draws 2 door points per room; the fallbacks
   * keep a hand-built/degenerate room playable instead of dropping the choice.
   */
  private doorPosition(level: LevelData, index: number): Vec2 {
    const door = level.doors[index];
    if (door !== undefined) return { x: door.at.x, y: door.at.y };

    const first = level.doors[0];
    const base = first?.at ?? { x: level.size.cols / 2, y: level.size.rows - 1 };
    if (index === 0) return { x: base.x, y: base.y };

    const inset = 2.5 * index;
    return {
      x: Math.min(level.size.cols - 1, Math.max(1, base.x + inset)),
      y: Math.min(level.size.rows - 1, Math.max(1, base.y - inset)),
    };
  }

  /** Door phase: the player walks to a door; enemies are already gone and the sim is idle. */
  private updateDoorPhase(deltaMs: number): void {
    const player = this.player;
    const level = this.currentLevel;
    const view = this.doorView;
    if (player === null || level === null || view === null) return;

    this.doorClockMs += deltaMs;
    this.doorHintElapsedMs += deltaMs;
    player.step(this.doorClockMs, deltaMs, [], level);
    this.fx?.update(deltaMs);
    this.updateDepthAndCover(deltaMs);
    // The player walks while the doors are open, so the edge arrows must follow the camera and the
    // hint must expire (#63) — neither is updated by the cleared combat loop any more.
    this.hud?.setDoorHint(doorHintVisible(this.doorHintElapsedMs));
    this.updateHudArrows();

    const doors = view.doors;
    for (let index = 0; index < doors.length; index += 1) {
      const door = doors[index];
      if (door === undefined) continue;
      const gap = Math.hypot(player.position.x - door.x, player.position.y - door.y);
      if (gap > DOOR_ENTER_TILES) continue;
      this.takeDoor(index);
      return;
    }
  }

  /** Walk through door `index`: the other door closes and the run advances to the next room. */
  private takeDoor(index: number): boolean {
    if (!this.doorPhase) return false;
    const chosen = this.doorOfferList[index];
    if (chosen === undefined) return false;

    this.doorPhase = false;
    this.doorView?.destroy();
    this.doorView = null;
    this.doorOfferList = [];
    this.hud?.setDoorHint(false);
    // `boss` carries no clear reward; the next room is the boss arena. A special door replaces
    // the next slot with a heal/shop/chest room (`enterRoom` reads `pendingSpecial`).
    this.roomReward = chosen === 'boss' ? null : chosen;
    if (isSpecialDoor(chosen)) {
      this.pendingSpecial = chosen;
      this.roomReward = null;
    }
    playSfx('ui-confirm');
    console.log(`[YokaiField] Took the ${chosen} door.`);
    this.advanceRoom();
    return true;
  }

  /** Move to the next room through the chosen door. */
  private advanceRoom(): void {
    const run = this.run;
    if (run === null) return;

    this.status = 'playing';
    this.screens.setScreen('playing');
    this.doorPhase = false;
    run.advanceToNextRoom();
    this.enterRoom(run.room);
  }

  /**
   * Seed of one room's `WaveScheduler` (#41): the run seed mixed with chapter and room, so the
   * same run draws the same waves and a different seed varies the totals and spawn spots.
   */
  private waveSeed(level: LevelData): number {
    return (
      (Math.imul(this.runSeed | 0, 0x9e3779b1) ^
        Math.imul(level.chapter, 0x85ebca6b) ^
        Math.imul(level.room, 0xc2b2ae35)) >>>
      0
    );
  }

  private enterRoom(roomNumber: number): void {
    const run = this.run;
    if (run === null) return;

    const level = this.levelFor(roomNumber);
    if (level === null) {
      this.fail(new Error(`Chapter ${run.chapter} is missing room ${roomNumber} (RunState ${run.roomLabel})`));
      return;
    }

    this.clearSpecialRoom();
    this.xpPool.clear();
    this.xpOrbView?.clear();
    this.roomClearPending = false;
    this.roomClearElapsedMs = 0;

    const specialKind = this.pendingSpecial;
    this.pendingSpecial = null;
    if (specialKind !== null) {
      this.isXpDoorRoom = false;
      this.enterSpecialRoom(roomNumber, specialKind);
      return;
    }

    this.isXpDoorRoom = !level.isBossRoom && this.roomReward === 'xp';
    const extraElites = this.isXpDoorRoom ? DOORS_TUNING.xpRoomExtraElites : 0;

    this.createRoom(level);
    this.combat?.enterRoom(level);
    this.player?.teleport(level.playerStart);
    this.hud?.setRoomLabel(run.roomLabel);
    this.hud?.setBoss(null);
    this.persistBest(roomNumber);

    if (level.isBossRoom) {
      const combat = this.combat;
      if (combat === null) throw new Error('Bootstrap: no CombatLoop');
      const def = spawnBossForRoom(combat, level, this.chapterBoss(level.chapter));
      this.audio?.playMusic(bossMusicId(def.id));
    } else {
      this.audio?.playMusic(chapterMusic(level.chapter));
    }
    this.combat?.startWaves(this.waveSeed(level), run.room, extraElites);
    this.syncHud();

    console.log(
      `[YokaiField] Entering room ${run.roomLabel} (` +
        (level.isBossRoom
          ? 'boss'
          : `${roomEnemyTotal(level, this.waveSeed(level))} enemies in waves${
              this.isXpDoorRoom ? `, XP challenge +${extraElites} elites` : ''
            }`) +
        ').',
    );
  }

  // -------------------------------------------------------------------------
  // Special rooms (#40)
  // -------------------------------------------------------------------------

  /** Drop the live special room state (room change, teardown, new run). */
  private clearSpecialRoom(): void {
    this.specialView?.destroy();
    this.specialView = null;
    this.shopPanel?.destroy();
    this.shopPanel = null;
    this.shopOfferList = [];
    this.specialRoom = null;
    this.specialUsed = false;
    this.specialFinished = false;
    this.specialClockMs = 0;
  }

  /**
   * Enter a special slot: 32×18 of the **chapter's own** floor, no enemies, one NPC/chest and
   * one door out.
   *
   * The floor comes from the chapter's **boss room**, not from the drawn normal room: normal
   * rooms are 64×36 (ADR-018), and `buildRoom` draws a one-screen `LevelData` through a single
   * `TiledMap`, which overflows the 2D batcher on a multi-screen asset (Error 9004, #37). The boss
   * room is exactly 32×18, so its asset is safe in the one-screen path.
   */
  private enterSpecialRoom(roomNumber: number, kind: SpecialKind): void {
    const run = this.run;
    const chapter = this.chapter;
    if (run === null || chapter === null) return;

    const bossRoom = chapter.rooms.find((room) => room.isBossRoom);
    const asset = bossRoom === undefined ? undefined : this.chapterAssets.get(bossRoom.room);
    if (asset === undefined) {
      this.fail(new Error(`TiledMapAsset not loaded for the ${kind} room's 32×18 floor`));
      return;
    }

    const level = specialRoomLevel(run.chapter, kind, 100 + roomNumber);
    this.createRoom(level, asset);
    this.combat?.enterRoom(level);
    this.player?.teleport(level.playerStart);
    this.hud?.setRoomLabel(run.roomLabel);
    this.hud?.setBoss(null);
    this.persistBest(roomNumber);
    this.audio?.playMusic(chapterMusic(level.chapter));

    this.specialRoom = kind;
    this.specialUsed = false;
    this.specialFinished = false;
    this.specialClockMs = 0;

    const actorLayer = this.actorLayer;
    const manifest = this.manifest;
    if (actorLayer !== null && manifest !== null) {
      this.specialView = new SpecialRoomView(actorLayer, kind, manifest);
    }

    this.status = 'playing';
    this.screens.setScreen('playing');
    this.syncHud();
    console.log(
      `[YokaiField] Entering the ${kind} room in slot ${run.roomLabel} ` +
        `(32×18 chapter floor, no enemies).`,
    );
  }

  /** Step the player alone in a special room and use the NPC/chest when walked into. */
  private updateSpecialPhase(deltaMs: number): void {
    const player = this.player;
    const level = this.currentLevel;
    const view = this.specialView;
    if (player === null || level === null || view === null) return;

    this.specialClockMs += deltaMs;
    player.step(this.specialClockMs, deltaMs, [], level);
    this.fx?.update(deltaMs);
    this.updateDepthAndCover(deltaMs);
    this.syncHud();

    if (this.specialUsed) return;
    const gap = Math.hypot(
      player.position.x - view.position.x,
      player.position.y - view.position.y,
    );
    if (gap <= SPECIAL_USE_TILES) this.useSpecialRoom();
  }

  /** Run the interaction of the current special room (also the debug `useSpecial()` hook). */
  private useSpecialRoom(): boolean {
    const kind = this.specialRoom;
    if (kind === null || this.specialUsed) return false;

    if (kind === 'heal') this.useHealNpc();
    else if (kind === 'chest') this.useChest();
    else this.openMidRunShop();
    return true;
  }

  /** Heal NPC: restore the tuned hearts once, then open the exit door. */
  private useHealNpc(): void {
    this.specialUsed = true;
    const player = this.player;
    if (player !== null) {
      const hearts = healHearts(
        player.hearts,
        player.maxHearts,
        SPECIAL_ROOMS_TUNING.healHearts,
      );
      player.heal(hearts - player.hearts);
      this.hud?.setHearts(player.hearts);
    }
    const position = this.specialView?.position;
    if (position !== undefined) {
      this.fx?.spawn('fx.boost', position, { drawUnits: 2, lifetimeMs: 600 });
    }
    playSfx('skill-acquired');
    console.log(
      `[YokaiField] Heal room: +${SPECIAL_ROOMS_TUNING.healHearts} hearts ` +
        `(now ${player?.hearts ?? 0}/${player?.maxHearts ?? 0}).`,
    );
    this.finishSpecialRoom();
  }

  /** Chest: the seeded reward is a free skill pick or run gold. */
  private useChest(): void {
    this.specialUsed = true;
    this.specialView?.markUsed();
    const run = this.run;
    if (run === null) return;

    const reward = chestReward(this.runSeed, run.room);
    if (reward.kind === 'gold') {
      this.rewards.awardBonus(reward.amount);
      this.flyGold(reward.amount, this.specialView?.position ?? { x: ROOM_COLS / 2, y: ROOM_ROWS / 2 });
      playSfx('gold');
      console.log(`[YokaiField] Chest: +${reward.amount} gold.`);
      this.finishSpecialRoom();
      return;
    }

    console.log('[YokaiField] Chest: a free skill pick.');
    const choices = this.skills.roll();
    if (choices.length === 0) {
      this.finishSpecialRoom();
      return;
    }
    this.status = 'skill-pick';
    this.screens.setScreen('skill-pick');
    const canvas = this.ensureUiRoot();
    void this.skills
      .open(canvas, choices, (index) => this.chooseChestSkill(index))
      .catch((error: unknown) => this.fail(error));
  }

  /** Free pick from a chest: no door is opened here, `finishSpecialRoom` does that. */
  private chooseChestSkill(indexOrId: number | string): boolean {
    if (this.status !== 'skill-pick' || this.specialRoom === null) return false;
    const picked = this.skills.choose(indexOrId);
    if (picked === null) return false;

    this.applyLoadout(picked.result.healNow);
    this.player?.playSkillBoost();
    console.log(`[YokaiField] Chest skill: ${picked.def.name} → stack ${picked.result.stacks}.`);
    this.finishSpecialRoom();
    return true;
  }

  /** Shop NPC: build the panel; each purchase writes the save before the reward is applied. */
  private openMidRunShop(): void {
    this.specialUsed = true;
    const run = this.run;
    if (run === null) return;

    const offers = shopOffers(this.runSeed, run.room, this.skills.snapshot());
    this.shopOfferList = offers;
    this.status = 'special';
    this.screens.setScreen('playing');

    const canvas = this.ensureUiRoot();
    void buildShopPanel({
      parent: canvas,
      offers,
      owned: this.skills.snapshot(),
      gold: this.shopGoldTotal(),
      onBuy: (index) => this.buyShopOffer(index),
      onClose: () => this.closeMidRunShop(),
    })
      .then((panel) => {
        // Esc during the texture load already closed the shop: drop the late panel.
        if (this.status === 'special') this.shopPanel = panel;
        else panel.destroy();
      })
      .catch((error: unknown) => this.fail(error));
    console.log(`[YokaiField] Shop room: ${offers.map((offer) => offer.item).join(', ')}.`);
  }

  /**
   * Buy one shop offer. **Sole** writer of the mid-run shop's gold: `buyFromShop` decides, then
   * the save is written before the skill/refill is applied, so a quit keeps the purchase.
   */
  private buyShopOffer(index: number): ShopBuyResult {
    const save = this.save;
    const repo = this.saveRepo;
    const offer = this.shopOfferList[index];
    if (save === null || repo === null || offer === undefined) {
      return { ok: false, gold: this.shopGoldTotal(), message: 'SHOP UNAVAILABLE' };
    }

    if (offer.item !== 'heart-refill') {
      const def = safeSkill(offer.item);
      if (def === null || this.skills.stacks(def.id) >= def.maxStacks) {
        return { ok: false, gold: this.shopGoldTotal(), message: 'ALREADY MAXED' };
      }
    }

    const result = buyFromShop(save, this.rewards.goldEarned, offer);
    if (!result.ok) {
      return { ok: false, gold: shopGold(result.save, result.runGold), message: 'NOT ENOUGH GOLD' };
    }

    try {
      repo.save(result.save);
    } catch (error: unknown) {
      console.warn(`[YokaiField] Could not write the shop purchase: ${errorMessage(error)}`);
      return { ok: false, gold: this.shopGoldTotal(), message: 'COULD NOT SAVE' };
    }
    this.save = result.save;

    // Take the run part of the price out of the run's ledger, so death/win/quit bank only what
    // is left; drop the same amount from the HUD's arrived coins to keep both totals equal.
    const spent = this.rewards.spend(this.rewards.goldEarned - result.runGold);
    this.displayedGold = Math.max(0, this.displayedGold - spent);

    if (offer.item === 'heart-refill') {
      const player = this.player;
      if (player !== null) {
        player.heal(player.maxHearts);
        this.hud?.setHearts(player.hearts);
      }
    } else {
      const grant = this.skills.grant(offer.item);
      this.applyLoadout(grant.healNow);
      this.player?.playSkillBoost();
    }
    const total = this.shopGoldTotal();
    this.hud?.setGold(this.hudGoldTotal());
    console.log(`[YokaiField] Bought ${offer.item} for ${offer.price} gold (${total} left).`);
    return { ok: true, gold: total, message: null };
  }

  /** Leave the shop (Esc / a successful purchase): back to the room, then the exit door. */
  private closeMidRunShop(): void {
    if (this.shopPanel !== null) {
      this.shopPanel.destroy();
      this.shopPanel = null;
    }
    this.shopOfferList = [];
    if (this.status === 'special') this.status = 'playing';
    this.finishSpecialRoom();
  }

  /** The special room is used: pay the slot's clear gold, mark it cleared and open one door out. */
  private finishSpecialRoom(): void {
    if (this.specialFinished || this.specialRoom === null) return;
    this.specialFinished = true;

    const run = this.run;
    if (run === null) return;

    this.specialView?.markUsed();
    run.onRoomCleared();
    this.persistBest(run.room);

    const gold = this.rewards.awardRoomClear(
      false,
      this.player?.derivedStats.goldMultiplier ?? 1,
    );
    this.flyGold(gold, this.specialView?.position ?? { x: ROOM_COLS / 2, y: ROOM_ROWS / 2 });
    this.syncHud();
    this.hud?.setSkills(this.skills.entries);
    this.openSpecialExit();
  }

  /** One door out of a special room: the boss door on the last slot, a plain exit otherwise. */
  private openSpecialExit(): void {
    const run = this.run;
    const level = this.currentLevel;
    const parent = this.overlayLayer;
    if (run === null || level === null || parent === null) return;

    const offers: readonly DoorReward[] =
      run.room >= run.roomsTotal - 1 ? ['boss'] : ['xp'];
    const spots: DoorSpot[] = offers.map((reward, index) => ({
      reward,
      at: this.doorPosition(level, index),
    }));

    this.doorView?.destroy();
    this.doorView = new DoorView(parent, spots);
    this.doorOfferList = offers;
    this.doorClockMs = this.specialClockMs;
    // A special room has one exit, not a choice: no "choose a door" hint (#63).
    this.doorHintElapsedMs = DOORS_TUNING.hintMs;
    this.hud?.setDoorHint(false);
    this.combat?.clear();
    this.bulletView?.sync();
    this.doorPhase = true;
    this.status = 'playing';
    this.screens.setScreen('playing');
    this.roomClearBanner?.destroy();
    this.roomClearBanner = null;
    console.log(`[YokaiField] Special room exit: ${offers.join(', ')}.`);
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

  /** Credit gold and drop a pooled XP orb at the kill spot (`splitling` yields 0 XP → no orb). */
  private awardKill(role: EnemyRole, elite: boolean, position: Vec2): void {
    const multiplier = this.player?.derivedStats.goldMultiplier ?? 1;
    const amount = this.rewards.awardKill(role, elite, multiplier);
    this.flyGold(amount, position);

    const roomMultiplier = this.isXpDoorRoom ? DOORS_TUNING.xpRoomXpMultiplier : 1;
    const xpValue = xpForKill(role, elite, XP_TUNING, roomMultiplier);
    if (xpValue > 0) {
      this.xpPool.spawn({ position, value: xpValue });
      this.syncXpOrbView();
    }
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
    this.hud?.setGold(this.hudGoldTotal());
  }

  /** Spendable gold shown on the HUD: the save's meta gold plus this run's arrived coins. */
  private hudGoldTotal(): number {
    const save = this.save?.gold ?? 0;
    // A shop purchase spends from the ledger while some coins may still be in flight; never let
    // those late coins show more than the run still holds (the ledger is the source of truth).
    const arrived = Math.min(this.displayedGold, this.rewards.goldEarned);
    return Math.min(Number.MAX_SAFE_INTEGER, save + arrived);
  }

  /** Spendable gold the shop shows: the save's gold plus the run's earned gold (the HUD total). */
  private shopGoldTotal(): number {
    const save = this.save;
    // No save loaded: the only spendable gold is this run's (a purchase is refused anyway).
    return save === null ? this.rewards.goldEarned : shopGold(save, this.rewards.goldEarned);
  }

  /** Accessibility flags (shake, damage numbers) + effects mode applied immediately. */
  private setFeelSettings(settings: Settings): void {
    if (this.camera !== null) this.camera.shake.enabled = settings.screenShake;
    if (this.feel !== null) this.feel.damageNumbersEnabled = settings.damageNumbers;
    this.player?.setEffectsMode(settings.effects);
    this.combat?.setEffectsMode(settings.effects);
    this.bulletView?.setEffectsMode(settings.effects);
    // Effects Reduced also turns off the secondary atmosphere layers, animals and animated props.
    const level = this.currentLevel;
    if (level !== null && this.roomRoot !== null) this.rebuildRoomAtmosphere(level);
    // The living menu room follows the same Effects mode (#8).
    this.menuBackdrop?.refresh();
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
    this.xpPool.clear();
    this.xpOrbView?.destroy();
    this.xpOrbView = null;
    this.xpTracker = null;
    this.xpVisuals.length = 0;
    this.xpOrbElapsedSec = 0;
    this.lastXpPickupSfxMs = Number.NEGATIVE_INFINITY;
    this.isXpDoorRoom = false;
    this.roomClearPending = false;
    this.roomClearElapsedMs = 0;
    this.clearClockMs = 0;
    this.roomClearBanner?.destroy();
    this.roomClearBanner = null;
    this.doorView?.destroy();
    this.doorView = null;
    this.doorOfferList = [];
    this.doorPhase = false;
    this.roomReward = null;
    this.clearReward = null;
    this.pendingSpecial = null;
    this.clearSpecialRoom();
    this.bossPhases.destroy();

    this.combat?.destroy();
    this.combat = null;
    this.fx?.destroy();
    this.fx = null;
    this.player?.node.destroy();
    this.player = null;
    this.runCharacter = null;
    this.bulletView?.node.destroy();
    this.bulletView = null;
    this.hud?.node.destroy();
    this.hud = null;
    this.feel?.destroy();
    this.feel = null;
    this.displayedGold = 0;

    this.roomRoot?.destroy();
    this.roomRoot = null;
    // Prop bases and overlays (#36) live on the shared actor/overlay layers, not on `roomRoot`.
    this.cover?.destroy();
    this.cover = null;
    this.depth?.clearProps();
    // The over-actors atmosphere node lives on the world `atmosphere-layer`, not on `roomRoot`:
    // destroying the room does not take it with it, so the shared handle must be torn down
    // explicitly (otherwise ch1 shafts/leaves stay drawn over the next chapter and the menus).
    this.roomAtmosphere?.destroy();
    this.roomAtmosphere = null;
    this.camera?.setScreenSpaceNode(null);
    // Menus draw a one-screen room: put the camera back at its static centre.
    this.camera?.showScreen();
    this.atmosphereSnapshot = { chapter: 0, layers: [], animals: 0, props: 0 };
    this.currentLevel = null;
    this.lastFocus = null;
    this.chapter = null;
    this.chapterAssets = new Map();
    this.runRooms = [];
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
        this.menuBackdrop?.clear();
        this.teardownRun();
        try {
          await this.launchChapter(chapter, seed);
          return true;
        } catch (error: unknown) {
          this.fail(error);
          return false;
        }
      },
      loadRoom: (id) => this.loadRoom(id),
      screen: () => this.screens.screenId,
      save: () => this.save,
      setGold: (gold) => this.screens.setGold(gold),
      markChapterCleared: (chapter) => this.screens.markChapterCleared(chapter),
      uiText: () => this.uiText(),
      skillPreview: (ids) => this.skillPreview.show(ids),
      closeSkillPreview: () => this.skillPreview.close(),
      roomRoot: () => this.roomRoot,
      actorLayer: () => this.actorLayer,
      bulletLayer: () => this.bulletLayer,
      fxLayer: () => this.fxLayer,
      uiRoot: () => this.uiRoot,
      audioManager: () => this.audio,
      setEffects: (mode) => this.debugSetEffects(mode),
      vfx: () => this.debugVfx(),
      atmosphere: () => this.atmosphereSnapshot,
      menuBackdrop: () => this.menuBackdrop?.snapshot() ?? null,
      doors: () => this.debugDoors(),
      takeDoor: (index) => this.debugTakeDoor(index),
      special: () => this.debugSpecial(),
      useSpecial: () => this.debugUseSpecial(),
      character: () => {
        const snap = this.screens.characterSnapshot();
        const active = this.runCharacter;
        return active === null ? snap : { ...snap, id: active.id, name: active.name };
      },
      selectCharacter: (id) => this.screens.selectCharacter(id),
      setCultivatorEnabled: (enabled) => this.screens.setCultivatorEnabled(enabled),
      playerAttachment: () => this.player?.getAttachmentSnapshot() ?? null,
      setAttachmentHidden: (hidden) => {
        if (this.player === null) return false;
        this.player.setAttachmentHidden(hidden);
        return true;
      },
      hideAttachmentForSkill: (skillId) => {
        if (this.player === null) return false;
        this.player.hideAttachmentForSkill(skillId);
        return true;
      },
      showAttachmentForSkill: (skillId) => {
        if (this.player === null) return false;
        this.player.showAttachmentForSkill(skillId);
        return true;
      },
      xp: () => this.debugXpSnapshot(),
      grantXp: (amount) => this.debugGrantXp(amount),
      rerollSkill: () => this.rerollActiveSkillPick(),
      playerIframeMs: () =>
        this.player !== null && this.combat !== null
          ? this.player.remainingInvulnerabilityMs(this.combat.clockMs)
          : 0,
    });
  }

  /** Sync HUD hearts, enemy counter, boss bar, and live XP bar without allocating per frame. */
  private syncHud(): void {
    const hud = this.hud;
    const player = this.player;
    if (hud === null || player === null) return;

    const tracker = this.xpTracker;
    if (tracker === null) {
      syncCombatHud(hud, player, this.combat);
      return;
    }
    this.xpHudCache.level = tracker.level;
    this.xpHudCache.current = tracker.currentXp;
    this.xpHudCache.required = tracker.nextLevelXp;
    syncCombatHud(hud, player, this.combat, this.xpHudCache);
  }

  private debugXpSnapshot(): DebugXpSnapshot {
    const tracker = this.xpTracker;
    const orbs = this.xpPool.activeOrbs.map((orb) => ({
      id: orb.id,
      x: orb.position.x,
      y: orb.position.y,
      value: orb.value,
      phase: orb.phase,
    }));
    return {
      level: tracker?.level ?? 1,
      currentXp: tracker?.currentXp ?? 0,
      nextLevelXp: tracker?.nextLevelXp ?? 0,
      totalXp: tracker?.totalXp ?? 0,
      pendingLevelUps: tracker?.pendingLevelUps ?? 0,
      activeOrbs: orbs.length,
      orbs,
      rerollsUsed: this.skills.rerollsUsed,
      rerollCost: rerollCost(this.skills.rerollsUsed),
      sharedGold: this.shopGoldTotal(),
      isXpDoorRoom: this.isXpDoorRoom,
    };
  }

  private debugGrantXp(amount: number): DebugXpSnapshot {
    const tracker = this.xpTracker;
    if (tracker === null || !Number.isFinite(amount) || amount <= 0) {
      return this.debugXpSnapshot();
    }
    tracker.grant(amount);
    this.syncHud();
    if (
      tracker.pendingLevelUps > 0 &&
      this.status === 'playing' &&
      !this.doorPhase &&
      this.specialRoom === null
    ) {
      this.openLevelUpSkillPick();
    }
    return this.debugXpSnapshot();
  }

  /** Debug `doors()`: the live offer, the door positions and the reward this room will pay. */
  private debugDoors(): DebugDoorSnapshot {
    return {
      active: this.doorPhase,
      offers: this.doorOfferList.slice(),
      doors: this.doorView?.doors ?? [],
      roomReward: this.roomReward,
    };
  }

  /** Debug `takeDoor(i)`: teleport into door `i`, then take it (scriptable browser proof). */
  private debugTakeDoor(index: number): boolean {
    if (!this.doorPhase) return false;
    const door = this.doorView?.doors[index];
    if (door === undefined) return false;

    this.player?.teleport({ x: door.x, y: door.y });
    return this.takeDoor(index);
  }

  /** Debug `special()`: the live special room, its interaction point and used flags. */
  private debugSpecial(): DebugSpecialSnapshot {
    const view = this.specialView;
    return {
      kind: this.specialRoom,
      x: view?.position.x ?? null,
      y: view?.position.y ?? null,
      used: this.specialUsed,
      finished: this.specialFinished,
    };
  }

  /** Debug `useSpecial()`: walk onto the NPC/chest and use it (shop opens its panel). */
  private debugUseSpecial(): boolean {
    if (this.specialRoom === null) return false;
    const view = this.specialView;
    if (view !== null) this.player?.teleport(view.position);
    return this.useSpecialRoom();
  }


  /** Debug: flip Effects Full/Reduced through the same save path the Settings screen uses. */
  private debugSetEffects(mode: 'full' | 'reduced'): boolean {
    if (mode !== 'full' && mode !== 'reduced') return false;
    const save = this.save;
    const repo = this.saveRepo;
    if (save === null || repo === null) return false;

    try {
      const next: SaveData = {
        ...save,
        settings: applySettings({ ...save.settings, effects: mode }),
      };
      repo.save(next);
      this.save = next;
      this.setFeelSettings(next.settings);
      return true;
    } catch (error: unknown) {
      console.warn(`[YokaiField] Could not set effects: ${errorMessage(error)}`);
      return false;
    }
  }

  /**
   * Debug `vfx()`: what the weapon layer is actually showing. Read from the live adapters,
   * not recomputed, so a broken bullet view shows up in the proof instead of hiding behind it.
   */
  private debugVfx(): DebugVfxSnapshot {
    const owned = this.skills.snapshot();
    const chapter = this.run?.chapter ?? 1;
    return {
      effects: this.save?.settings.effects ?? 'full',
      projectileKey: this.bulletView?.projectileKey ?? playerProjectileLook(owned).key,
      trailGhostsActive: this.bulletView?.trailGhostsActive ?? 0,
      auraVisible: this.fx?.auraVisible ?? false,
      enemyProjectileKey: this.bulletView?.enemyProjectileKey ?? enemyProjectileKey(chapter),
    };
  }

  /** Debug: take a skill outside the picker; returns the stack count after (0 for an unknown id). */
  private debugGrantSkill(id: string, stacks: number): number {
    const grant = this.skills.grant(id, stacks);
    if (grant.acquired) {
      this.applyLoadout(grant.healNow);
      this.player?.playSkillBoost();
    }
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
      `[YokaiField] debug stress: ${STRESS_ENEMY_COUNT} enemies + ${STRESS_ENEMY_BULLETS} bullets (M9 alive cap), godMode on.`,
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
    this.menuBackdrop?.destroy();
    this.menuBackdrop = null;
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
    const level = this.runRooms[roomNumber - 1];
    if (level !== undefined) return level;
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

/** `getSkill` throws on an unknown id; a stale shop offer must not crash the panel. */
function safeSkill(id: string): ReturnType<typeof getSkill> | null {
  try {
    return getSkill(id);
  } catch {
    return null;
  }
}

function chapterMusic(chapter: number): MusicId {
  if (chapter === 2) return 'chapter-2';
  if (chapter === 3) return 'chapter-3';
  return 'chapter-1';
}
