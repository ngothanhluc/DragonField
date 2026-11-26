/**
 * Living menu backdrop (#8, refined in M11 T5 & M14 T3), engine side: Title, Character Select,
 * and Chapter Select draw a cleanly framed 32×18 window of the chapter's room 1 behind the
 * `Theme Wood` plaque — tiles, water, 1:1 weather particles, wandering critters, and the idle
 * playable character (`ninja`, `archer`, `mage`, `cultivator`) with its live weapon attachment
 * (`bow-hand`, `staff-hand`, `sword-back`) via `PlayerAttachmentView`.
 *
 * Nothing here duplicates the run renderer: the room is `buildRoom`, water is `attachRoomWater`,
 * atmosphere + decor come from the shared `attachRoomAtmosphere`, and the character is a sprite-free
 * container holding `menu-actor-body` (`SpriteAnimator` playing `<prefix>.idle.down`) plus optional
 * sibling `player-attachment` managed by `PlayerAttachmentView` and synced to `animator.frameIndex`
 * every frame so breathing bob (`attachments.json`) works live in menus.
 */
import {
  _decorator,
  Component,
  JsonAsset as CocosJsonAsset,
  Node as CocosNode,
  Sprite as CocosSprite,
  resources,
} from 'cc';
import type { TiledMapAsset as CocosTiledMapAsset } from 'cc';
import { chapterAtmosphere, type AtmosphereConfig } from '../core/atmosphere/atmosphere';
import { validateAttachments, type AttachmentsData } from '../core/art/attachments';
import { resolve, type AnimationManifest } from '../core/art/manifest';
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  resolveCharacterAnimKey,
  type CharacterDef,
} from '../core/characters/roster';
import type { ChapterData, LevelData } from '../core/level/level-data';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../core/level/level-data';
import { waterAreasFor, type WaterLayout } from '../core/level/water-layout';
import type { Vec2 } from '../core/math/vec2';
import {
  MENU_BACKDROP_ROOM,
  menuBackdropFrame,
  menuFramedPlayerSpot,
  type TileRect,
} from '../core/view/menu-backdrop';
import type { EffectsMode } from '../core/vfx/weapon-vfx';
import type { DebugMenuBackdropSnapshot } from './debug-api';
import { SpriteAnimator } from './anim/sprite-animator';
import { preloadSheets } from './assets/texture-cache';
import { attachRoomAtmosphere, type RoomAtmosphereParts } from './atmosphere-view';
import {
  ACTOR_FEET_OFFSET_TILES,
  ACTOR_SCALE,
  buildRoom,
  obstacleSheets,
} from './level-view';
import { PlayerAttachmentView } from './player-attachment-view';
import { attachRoomWater } from './room-water';
import { MENU_COLUMN_WIDTH } from './screens/menu';
import { cullWorld } from './world-culler';

const { ccclass } = _decorator;

/** `cc` is an any module: types must be derived from the import value. */
type JsonAsset = InstanceType<typeof CocosJsonAsset>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type TiledMapAsset = InstanceType<typeof CocosTiledMapAsset>;

const ATTACHMENTS_PATH = 'data/attachments';

/**
 * Tiny component keeping the menu preview actor's `PlayerAttachmentView` pose synced to
 * `SpriteAnimator.frameIndex` each engine tick so `bow-hand`, `staff-hand`, and `sword-back`
 * follow per-frame idle breathing bob from `attachments.json`.
 */
@ccclass('MenuBackdropActorRig')
export class MenuBackdropActorRig extends Component {
  private animator: SpriteAnimator | null = null;
  private attachment: PlayerAttachmentView | null = null;
  private lastFrame = -1;

  bind(animator: SpriteAnimator, attachment: PlayerAttachmentView | null): void {
    this.animator = animator;
    this.attachment = attachment;
    this.lastFrame = animator.frameIndex;
    attachment?.updatePose({ animation: 'idle', direction: 'down', frame: this.lastFrame });
  }

  update(): void {
    const animator = this.animator;
    const attachment = this.attachment;
    if (animator === null || attachment === null) return;
    const frame = animator.frameIndex;
    if (frame === this.lastFrame) return;
    this.lastFrame = frame;
    attachment.updatePose({ animation: 'idle', direction: 'down', frame });
  }

  protected onDestroy(): void {
    this.attachment?.destroy();
    this.attachment = null;
    this.animator = null;
  }
}

/** One loaded chapter: parsed rooms + the `TiledMapAsset` of each room, as `bootstrap.loadChapter`. */
export interface MenuChapterData {
  readonly chapter: ChapterData;
  readonly assets: ReadonlyMap<number, TiledMapAsset>;
}

export interface MenuBackdropHost {
  readonly roomLayer: () => Node | null;
  readonly actorLayer: () => Node | null;
  readonly atmosphereLayer: () => Node | null;
  readonly manifest: () => AnimationManifest | null;
  readonly atmosphereConfig: () => AtmosphereConfig | null;
  readonly waterLayout: () => WaterLayout | null;
  readonly effects: () => EffectsMode;
  /** World band / UI band ratio (`WorldCamera.hudScale`); the panel covers more room when < 1. */
  readonly worldScale: () => number;
  readonly chapterFolder: (chapter: number) => string | undefined;
  readonly loadChapter: (folder: string) => Promise<MenuChapterData>;
  /** Selected character for the living menu actor; defaults to Ninja when omitted. */
  readonly character?: () => CharacterDef;
  /** Optional attachment rig data; loaded lazily when an attachment character is shown without it. */
  readonly attachments?: () => AttachmentsData | null;
}

/**
 * Panel footprint in view tiles (`0..ROOM_COLS × 0..ROOM_ROWS`, top-left origin, y down),
 * rounded **outward**.
 *
 * The panel is a centred column of `panelWidthPx` design px; one room tile is
 * `TILE_SIZE_PX * worldScale` UI px (the world camera is scaled to whole texels while the UI band
 * keeps design size), so the narrow column covers slightly more tiles when `worldScale < 1`.
 */
export function menuBackdropKeepOut(
  worldScale: number,
  panelWidthPx: number = MENU_COLUMN_WIDTH,
): TileRect {
  const scale = Number.isFinite(worldScale) && worldScale > 0 ? Math.min(1, worldScale) : 1;
  const widthTiles = panelWidthPx / (TILE_SIZE_PX * scale);
  const left = Math.floor(ROOM_COLS / 2 - widthTiles / 2);
  const right = Math.ceil(ROOM_COLS / 2 + widthTiles / 2);
  const x = Math.max(0, Math.min(ROOM_COLS - 1, left));
  const width = Math.max(1, Math.min(ROOM_COLS - x, right - x));
  return { x, y: 0, width, height: ROOM_ROWS };
}

/** Fixed per chapter, so the menu room always looks the same (a run uses its own run seed). */
export function menuBackdropSeed(chapter: number): number {
  return (0x9e3779b1 ^ (chapter * 0x85ebca6b)) >>> 0;
}

/** Owns the room drawn behind Title / Character Select / Chapter Select: `show(chapter)` and `clear()`. */
export class MenuBackdrop {
  private token = 0;
  private actorSwapToken = 0;
  private shownChapter: number | null = null;
  private requestedChapter: number | null = null;
  private container: Node | null = null;
  private actor: Node | null = null;
  private actorAttachment: PlayerAttachmentView | null = null;
  private actorWorldPos: Vec2 | null = null;
  private renderedCharacterId: string | null = null;
  private atmosphere: RoomAtmosphereParts | null = null;
  private playerSpot: Vec2 | null = null;
  private characterOverride: CharacterDef | null = null;
  private attachmentsOverride: AttachmentsData | null | undefined = undefined;
  private cachedAttachments: AttachmentsData | null = null;
  private attachmentsPromise: Promise<AttachmentsData | null> | null = null;
  private disposed = false;
  private readonly cache = new Map<number, MenuChapterData>();

  constructor(private readonly host: MenuBackdropHost) {}

  /** What is drawn right now; `null` when the menu has no backdrop. */
  snapshot(): DebugMenuBackdropSnapshot | null {
    if (this.container === null || this.shownChapter === null) return null;
    const atmosphere = this.atmosphere?.snapshot;
    const actor = this.actor;
    return {
      chapter: this.shownChapter,
      room: MENU_BACKDROP_ROOM,
      player: actor === null ? null : { x: actor.position.x, y: actor.position.y },
      layers: atmosphere?.layers ?? [],
      animals: atmosphere?.animals ?? 0,
      props: atmosphere?.props ?? 0,
    };
  }

  /**
   * Switch the idle character shown in the living menu room (`ninja`, `archer`, `mage`, `cultivator`).
   * When a room is already displayed, swaps ONLY the actor + `PlayerAttachmentView` in place so
   * the room tiles, water, and 1:1 weather particles never flicker during Character Select browsing.
   */
  setCharacter(character: CharacterDef, attachments?: AttachmentsData | null): void {
    const prevHasAttachments = this.resolvedAttachments() !== null;
    this.characterOverride = character;
    if (attachments !== undefined) this.attachmentsOverride = attachments;
    const nextHasAttachments = this.resolvedAttachments() !== null;

    if (this.disposed) return;

    if (this.shownChapter !== null && this.container !== null && this.actorWorldPos !== null) {
      if (
        this.renderedCharacterId === character.id &&
        prevHasAttachments === nextHasAttachments &&
        this.actor !== null
      ) {
        return;
      }
      void this.swapActorInPlace(character);
      return;
    }

    if (this.requestedChapter !== null) {
      const pending = this.requestedChapter;
      this.clear();
      void this.show(pending);
    }
  }

  /**
   * Draw `chapter`'s room 1. No-op when that chapter is already drawn (or loading): Title ↔
   * Character Select ↔ Chapter Select does not rebuild. Otherwise the new room is built first,
   * then the old one is destroyed.
   */
  async show(chapter: number): Promise<void> {
    if (this.disposed) return;
    if (this.shownChapter === chapter || this.requestedChapter === chapter) return;

    this.requestedChapter = chapter;
    const token = ++this.token;
    try {
      const data = await this.load(chapter);
      if (token !== this.token) return;

      const level = data.chapter.rooms.find((room) => room.room === MENU_BACKDROP_ROOM);
      const asset = data.assets.get(MENU_BACKDROP_ROOM);
      if (level === undefined || asset === undefined) {
        throw new Error(`chapter ${chapter} has no room ${MENU_BACKDROP_ROOM}`);
      }

      const character = this.resolvedCharacter();
      const attachments = await this.ensureAttachmentsFor(character);
      if (token !== this.token) return;

      await preloadSheets(this.sheetsFor(data.chapter, character, attachments));
      if (token !== this.token) return;

      this.build(chapter, level, asset, character, attachments);
      this.requestedChapter = null;
    } catch (error: unknown) {
      if (token !== this.token) return;
      this.requestedChapter = null;
      console.warn(
        `[YokaiField] Menu backdrop for chapter ${chapter} skipped: ${errorMessage(error)}`,
      );
    }
  }

  /** Destroy every backdrop node; idempotent, and cancels an in-flight `show` or actor swap. */
  clear(): void {
    this.token += 1;
    this.actorSwapToken += 1;
    this.requestedChapter = null;
    this.destroyNodes();
  }

  /**
   * Rebuild the same chapter in place — the Effects setting changed (Full ↔ Reduced), so the
   * atmosphere/decor set must be re-attached from `visibleAtmosphere`. No-op when nothing is drawn.
   */
  refresh(): void {
    const chapter = this.shownChapter ?? this.requestedChapter;
    if (chapter === null) return;
    this.clear();
    void this.show(chapter);
  }

  /** Bootstrap teardown: clear and refuse later `show` calls. */
  destroy(): void {
    this.disposed = true;
    this.clear();
    this.cache.clear();
  }

  private resolvedCharacter(): CharacterDef {
    return this.characterOverride ?? this.host.character?.() ?? CHARACTERS[DEFAULT_CHARACTER_ID];
  }

  private resolvedAttachments(): AttachmentsData | null {
    if (this.attachmentsOverride !== undefined) return this.attachmentsOverride;
    return this.host.attachments?.() ?? this.cachedAttachments;
  }

  private async ensureAttachmentsFor(character: CharacterDef): Promise<AttachmentsData | null> {
    const current = this.resolvedAttachments();
    if (
      current === null &&
      character.defaultLoadout.weaponForm === 'attachment' &&
      character.defaultLoadout.attachmentItemId !== null
    ) {
      return this.loadAttachments();
    }
    return current;
  }

  private async swapActorInPlace(character: CharacterDef): Promise<void> {
    const swapToken = ++this.actorSwapToken;
    const roomToken = this.token;
    try {
      const attachments = await this.ensureAttachmentsFor(character);
      if (this.disposed || swapToken !== this.actorSwapToken || roomToken !== this.token) return;

      await preloadSheets(this.actorSheetsFor(character, attachments));
      if (this.disposed || swapToken !== this.actorSwapToken || roomToken !== this.token) return;

      const actorLayer = this.host.actorLayer();
      const manifest = this.host.manifest();
      const worldPos = this.actorWorldPos;
      if (
        actorLayer === null ||
        !actorLayer.isValid ||
        manifest === null ||
        worldPos === null ||
        this.container === null
      ) {
        return;
      }

      const built = this.createActor(actorLayer, worldPos, manifest, character, attachments);
      this.destroyActor();
      this.actor = built.node;
      this.actorAttachment = built.attachment;
      this.renderedCharacterId = character.id;
    } catch (error: unknown) {
      if (swapToken !== this.actorSwapToken) return;
      console.warn(
        `[YokaiField] Menu backdrop character preview (${character.id}) failed: ${errorMessage(error)}`,
      );
    }
  }

  private loadAttachments(): Promise<AttachmentsData | null> {
    if (this.cachedAttachments !== null) return Promise.resolve(this.cachedAttachments);
    if (this.attachmentsPromise !== null) return this.attachmentsPromise;

    const task = new Promise<AttachmentsData | null>((onLoad) => {
      resources.load(
        ATTACHMENTS_PATH,
        CocosJsonAsset,
        (error: Error | null | undefined, asset: JsonAsset | null | undefined) => {
          if (error || !asset) {
            const cause = error ? error.message : 'empty asset';
            console.warn(
              `[YokaiField] Menu backdrop could not load "resources/${ATTACHMENTS_PATH}.json": ${cause}`,
            );
            onLoad(null);
            return;
          }
          try {
            const parsed = validateAttachments(asset.json);
            this.cachedAttachments = parsed;
            onLoad(parsed);
          } catch (parseError: unknown) {
            console.warn(
              `[YokaiField] Menu backdrop invalid "resources/${ATTACHMENTS_PATH}.json": ${errorMessage(parseError)}`,
            );
            onLoad(null);
          }
        },
      );
    });
    this.attachmentsPromise = task;
    return task;
  }

  private load(chapter: number): Promise<MenuChapterData> {
    const cached = this.cache.get(chapter);
    if (cached !== undefined) return Promise.resolve(cached);

    const folder = this.host.chapterFolder(chapter);
    if (folder === undefined) {
      return Promise.reject(new Error(`chapter ${chapter} has no .tmx folder`));
    }
    return this.host.loadChapter(folder).then((data) => {
      this.cache.set(chapter, data);
      return data;
    });
  }

  private actorSheetsFor(character: CharacterDef, attachments: AttachmentsData | null): string[] {
    const manifest = this.host.manifest();
    if (manifest === null) return [];

    const sheets = new Set<string>();
    const idleKey = resolveCharacterAnimKey(manifest, character, 'idle', 'down');
    sheets.add(resolve(manifest, idleKey).sheet);

    if (
      character.defaultLoadout.weaponForm === 'attachment' &&
      character.defaultLoadout.attachmentItemId !== null
    ) {
      const itemDef = attachments?.items[character.defaultLoadout.attachmentItemId];
      const itemKey =
        itemDef !== undefined
          ? `${itemDef.sprite}.down`
          : `attachment.${character.defaultLoadout.attachmentItemId}.down`;
      const itemEntry = manifest.sprites[itemKey];
      if (itemEntry !== undefined) {
        sheets.add(itemEntry.sheet);
      }
    }

    return Array.from(sheets);
  }

  /** Sheets the menu room needs: obstacles, atmosphere layers, decor, idle character + attachment. */
  private sheetsFor(
    chapter: ChapterData,
    character: CharacterDef,
    attachments: AttachmentsData | null,
  ): string[] {
    const manifest = this.host.manifest();
    if (manifest === null) return [];

    const sheets = new Set<string>(this.actorSheetsFor(character, attachments));

    for (const sheet of obstacleSheets(chapter.chapter)) sheets.add(sheet);

    const config = this.host.atmosphereConfig();
    const atmosphere = config === null ? null : chapterAtmosphere(config, chapter.chapter);
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

  private build(
    chapter: number,
    level: LevelData,
    asset: TiledMapAsset,
    character: CharacterDef,
    attachments: AttachmentsData | null,
  ): void {
    const roomLayer = this.host.roomLayer();
    const actorLayer = this.host.actorLayer();
    const manifest = this.host.manifest();
    const config = this.host.atmosphereConfig();
    if (roomLayer === null || actorLayer === null || manifest === null || config === null) {
      throw new Error('menu backdrop needs the world layers, manifest and atmosphere config');
    }
    if (!roomLayer.isValid || !actorLayer.isValid) return;

    const water = this.host.waterLayout();
    const areas = water === null ? [] : waterAreasFor(water, level.chapter, level.room);
    const localKeepOut = menuBackdropKeepOut(this.host.worldScale());
    const frame = menuBackdropFrame(level, {
      waterAreas: areas,
      columnWidthTiles: Math.max(20, localKeepOut.width),
    });
    const spot = menuFramedPlayerSpot(level, frame, localKeepOut, areas);

    // Build the room first so `roomRows` matches `level.size.rows`, then translate `container` so
    // `frame` maps onto the static world camera's `[0..32] × [0..18]` viewport.
    const container = new CocosNode('menu-room');
    container.parent = roomLayer;
    const worldBottomY = level.size.rows - frame.y - frame.height;
    container.setPosition(-frame.x, -worldBottomY, 0);

    const roomRoot = buildRoom(container, level, asset);
    attachRoomWater(roomRoot, areas, level.size.rows);
    if (level.size.cols > ROOM_COLS || level.size.rows > ROOM_ROWS) {
      cullWorld(roomRoot, {
        x: frame.x,
        y: worldBottomY,
        width: frame.width,
        height: frame.height,
      });
    }

    // `actorLayer` stays at the world origin (`[0..32] × [0..18]`): convert `spot` relative to `frame`.
    const actorWorld: Vec2 = {
      x: spot.x - frame.x,
      y: frame.y + frame.height - spot.y,
    };
    const builtActor = this.createActor(actorLayer, actorWorld, manifest, character, attachments);

    const atmosphere = attachRoomAtmosphere({
      roomRoot,
      overLayer: this.host.atmosphereLayer(),
      level,
      config,
      manifest,
      effects: this.host.effects(),
      seed: menuBackdropSeed(chapter),
      rippleAreas: areas,
      playerOf: () => spot,
    });

    // The new room exists: only now drop the previous one, so a focus change never flashes empty.
    this.destroyNodes();
    this.container = container;
    this.actor = builtActor.node;
    this.actorAttachment = builtActor.attachment;
    this.actorWorldPos = actorWorld;
    this.renderedCharacterId = character.id;
    this.atmosphere = atmosphere;
    this.playerSpot = spot;
    this.shownChapter = chapter;
  }

  /**
   * Idle character container (`menu-actor-body` + optional `player-attachment` sibling child via
   * `PlayerAttachmentView`), frame-anchored at the feet like the run's player. Projectile classes
   * (`ninja`) never create an attachment node (`PlayerAttachmentView` enforces `state.active === false`).
   */
  private createActor(
    actorLayer: Node,
    world: Vec2,
    manifest: AnimationManifest,
    character: CharacterDef,
    attachments: AttachmentsData | null,
  ): { readonly node: Node; readonly attachment: PlayerAttachmentView | null } {
    const container = new CocosNode('menu-actor');
    container.parent = actorLayer;
    container.setScale(ACTOR_SCALE, ACTOR_SCALE, 1);
    container.setPosition(world.x, world.y - ACTOR_FEET_OFFSET_TILES, 0);

    const body = new CocosNode('menu-actor-body');
    body.parent = container;
    const bodySprite: Sprite = body.addComponent(CocosSprite);
    bodySprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    bodySprite.trim = false;

    const idleKey = resolveCharacterAnimKey(manifest, character, 'idle', 'down');
    const animator: SpriteAnimator = body.addComponent(SpriteAnimator);
    animator.play(idleKey, 'down');

    // `PlayerAttachmentView` mounts `bow-hand`, `staff-hand`, or `sword-back` (and never creates a
    // node for projectile-only `ninja`). `MenuBackdropActorRig` syncs `animator.frameIndex` each tick.
    const attachmentView = new PlayerAttachmentView({
      parent: container,
      bodyNode: body,
      manifest,
      attachments,
      character,
      initialPose: { animation: 'idle', direction: 'down', frame: animator.frameIndex },
    });

    const rigSync: MenuBackdropActorRig = container.addComponent(MenuBackdropActorRig);
    rigSync.bind(animator, attachmentView);

    return { node: container, attachment: attachmentView };
  }

  private destroyActor(): void {
    this.actorAttachment?.destroy();
    this.actorAttachment = null;
    if (this.actor !== null && this.actor.isValid) this.actor.destroy();
    this.actor = null;
    this.renderedCharacterId = null;
  }

  private destroyNodes(): void {
    // The over-actors atmosphere lives on `atmosphere-layer`, not under the room: destroy the
    // handles explicitly or chapter 1 leaves/blossoms stay drawn over the next chapter and menus.
    this.atmosphere?.destroy();
    this.atmosphere = null;
    this.destroyActor();
    this.actorWorldPos = null;
    if (this.container !== null && this.container.isValid) this.container.destroy();
    this.container = null;
    this.playerSpot = null;
    this.shownChapter = null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
