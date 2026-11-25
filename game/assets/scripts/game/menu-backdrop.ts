/**
 * Living menu backdrop (#8), engine side: the title and chapter select draw a real chapter room
 * behind the panel — tiles, water, the #6 atmosphere layer, wandering critters and an idle
 * NinjaGreen — dimmed by the screen's own backdrop so the menu stays readable.
 *
 * Nothing here is a copy of the run renderer: the room is `buildRoom`, water is `attachRoomWater`,
 * atmosphere + decor come from the shared `attachRoomAtmosphere` (same as `bootstrap`), and the
 * ninja is a plain `Sprite` + `SpriteAnimator` (`player.idle.down`), not a `PlayerController`
 * (no input, no firing). Which chapter is shown and where the ninja stands are decided in the
 * pure `core/view/menu-backdrop.ts`.
 *
 * All nodes live on the world layers bootstrap already owns: the room tree under `room-layer`,
 * the ninja under `actor-layer`, the over-actors atmosphere on `atmosphere-layer`. `clear()`
 * destroys every one of them (the over-actors node is **not** under the room root).
 */
import {
  JsonAsset as CocosJsonAsset,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  resources,
} from 'cc';
import type { TiledMapAsset as CocosTiledMapAsset } from 'cc';
import { chapterAtmosphere, type AtmosphereConfig } from '../core/atmosphere/atmosphere';
import { AttachmentNodeController } from '../core/art/attachment-node';
import { validateAttachments, type AttachmentsData } from '../core/art/attachments';
import { resolve, type AnimationManifest } from '../core/art/manifest';
import { entryAnchorY } from '../core/art/runtime';
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
  menuPlayerSpot,
  type TileRect,
} from '../core/view/menu-backdrop';
import type { EffectsMode } from '../core/vfx/weapon-vfx';
import type { DebugMenuBackdropSnapshot } from './debug-api';
import { SpriteAnimator } from './anim/sprite-animator';
import { getFrame } from './assets/sprite-frame-cache';
import { preloadSheets } from './assets/texture-cache';
import { attachRoomAtmosphere, type RoomAtmosphereParts } from './atmosphere-view';
import {
  ACTOR_FEET_OFFSET_TILES,
  ACTOR_SCALE,
  buildRoom,
  obstacleSheets,
  tileToWorld,
} from './level-view';
import { attachRoomWater } from './room-water';
import { MENU_COLUMN_WIDTH } from './screens/menu';

/** `cc` is an any module: types must be derived from the import value. */
type JsonAsset = InstanceType<typeof CocosJsonAsset>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type TiledMapAsset = InstanceType<typeof CocosTiledMapAsset>;
type UITransform = InstanceType<typeof CocosUITransform>;

const ATTACHMENTS_PATH = 'data/attachments';

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
 * Panel footprint in room tiles (top-left origin, y down), rounded **outward**.
 *
 * The panel is a centred column of `panelWidthPx` design px; one room tile is
 * `TILE_SIZE_PX * worldScale` UI px (the world camera is scaled down to whole texels while the
 * UI band keeps the design size), so a narrow panel covers more tiles when the room is small.
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

/** Owns the room drawn behind the title / chapter select: `show(chapter)` and `clear()`. */
export class MenuBackdrop {
  private token = 0;
  private shownChapter: number | null = null;
  private requestedChapter: number | null = null;
  private container: Node | null = null;
  private actor: Node | null = null;
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
   * Switch the idle character shown in the living menu room (e.g. Ninja ↔ Cultivator).
   * Rebuilds the currently displayed backdrop in place when the character or attachment data changes.
   */
  setCharacter(character: CharacterDef, attachments?: AttachmentsData | null): void {
    const prevId = this.resolvedCharacter().id;
    const prevHasAttachments = this.resolvedAttachments() !== null;
    this.characterOverride = character;
    if (attachments !== undefined) this.attachmentsOverride = attachments;
    const nextHasAttachments = this.resolvedAttachments() !== null;

    const chapter = this.shownChapter ?? this.requestedChapter;
    if (chapter === null) return;
    if (prevId === character.id && prevHasAttachments === nextHasAttachments && this.actor !== null) {
      return;
    }
    this.clear();
    void this.show(chapter);
  }

  /**
   * Draw `chapter`'s room 1. No-op when that chapter is already drawn (or loading): title ↔ chapter
   * select does not rebuild. Otherwise the new room is built first, then the old one is destroyed.
   * A newer `show`/`clear` bumps a token so a slow load never attaches a stale room.
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
      let attachments = this.resolvedAttachments();
      if (
        attachments === null &&
        character.defaultLoadout.weaponForm === 'attachment' &&
        character.defaultLoadout.attachmentItemId !== null
      ) {
        attachments = await this.loadAttachments();
        if (token !== this.token) return;
      }

      await preloadSheets(this.sheetsFor(data.chapter, character, attachments));
      if (token !== this.token) return;

      this.build(chapter, level, asset, character, attachments, token);
      this.requestedChapter = null;
    } catch (error: unknown) {
      if (token !== this.token) return;
      this.requestedChapter = null;
      console.warn(
        `[YokaiField] Menu backdrop for chapter ${chapter} skipped: ${errorMessage(error)}`,
      );
    }
  }

  /** Destroy every backdrop node; idempotent, and cancels an in-flight `show`. */
  clear(): void {
    this.token += 1;
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

  /** Sheets the menu room needs: obstacles, atmosphere layers, decor, idle character + attachment. */
  private sheetsFor(
    chapter: ChapterData,
    character: CharacterDef,
    attachments: AttachmentsData | null,
  ): string[] {
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
    token: number,
  ): void {
    const roomLayer = this.host.roomLayer();
    const actorLayer = this.host.actorLayer();
    const manifest = this.host.manifest();
    const config = this.host.atmosphereConfig();
    if (roomLayer === null || actorLayer === null || manifest === null || config === null) {
      throw new Error('menu backdrop needs the world layers, manifest and atmosphere config');
    }
    if (!roomLayer.isValid || !actorLayer.isValid) return;

    const spot = menuPlayerSpot(level, menuBackdropKeepOut(this.host.worldScale()));
    const world = tileToWorld(spot);
    const water = this.host.waterLayout();
    const areas = water === null ? [] : waterAreasFor(water, level.chapter, level.room);

    const container = new CocosNode('menu-room');
    container.parent = roomLayer;
    const roomRoot = buildRoom(container, level, asset);
    attachRoomWater(roomRoot, areas, level.size.rows);

    const actor = this.createActor(actorLayer, world, manifest, character, attachments, token);
    const atmosphere = attachRoomAtmosphere({
      roomRoot,
      overLayer: this.host.atmosphereLayer(),
      level,
      config,
      manifest,
      effects: this.host.effects(),
      seed: menuBackdropSeed(chapter),
      rippleAreas: areas,
      playerOf: () => this.playerSpot,
    });

    // The new room exists: only now drop the previous one, so a focus change never flashes empty.
    this.destroyNodes();
    this.container = container;
    this.actor = actor;
    this.atmosphere = atmosphere;
    this.playerSpot = spot;
    this.shownChapter = chapter;
  }

  /**
   * Idle character container (`body` + optional `attachment` sibling child), frame-anchored at the
   * feet like the run's player (no controller). Projectile characters never create an attachment node.
   */
  private createActor(
    actorLayer: Node,
    world: Vec2,
    manifest: AnimationManifest,
    character: CharacterDef,
    attachments: AttachmentsData | null,
    token: number,
  ): Node {
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

    if (
      character.defaultLoadout.weaponForm === 'attachment' &&
      character.rigId !== null &&
      character.defaultLoadout.attachmentItemId !== null &&
      attachments !== null &&
      attachments.characters[character.rigId] !== undefined &&
      attachments.items[character.defaultLoadout.attachmentItemId] !== undefined
    ) {
      const bodyEntry = resolve(manifest, idleKey);
      const itemDef = attachments.items[character.defaultLoadout.attachmentItemId]!;
      const itemKey = `${itemDef.sprite}.down`;
      const itemEntry = manifest.sprites[itemKey];
      const controller = new AttachmentNodeController(
        attachments,
        {
          character: character.rigId,
          item: character.defaultLoadout.attachmentItemId,
          weaponForm: character.defaultLoadout.weaponForm,
          bodyAnchorY: entryAnchorY(bodyEntry),
          itemAnchorY: itemEntry === undefined ? 0.5 : entryAnchorY(itemEntry),
        },
        { animation: 'idle', direction: 'down', frame: 0 },
      );

      const state = controller.state;
      if (
        state.active &&
        state.spriteKey !== null &&
        manifest.sprites[state.spriteKey] !== undefined
      ) {
        const attachmentNode = new CocosNode('menu-actor-attachment');
        attachmentNode.parent = container;
        // Keep inactive until the SpriteFrame is assigned so `placeholders()` never sees null-frame.
        attachmentNode.active = false;
        const attachSprite: Sprite = attachmentNode.addComponent(CocosSprite);
        attachSprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
        attachSprite.trim = false;

        const spriteEntry = resolve(manifest, state.spriteKey);
        void getFrame(spriteEntry, 'down', 0)
          .then((frame) => {
            if (token !== this.token || !attachmentNode.isValid || !container.isValid) return;
            attachSprite.spriteFrame = frame;
            const transform: UITransform | null = attachmentNode.getComponent(CocosUITransform);
            if (transform !== null) {
              transform.setAnchorPoint(0.5, entryAnchorY(spriteEntry));
              transform.setContentSize(state.frameWidth, state.frameHeight);
            }
            attachmentNode.setPosition(state.localOffsetPx.x, state.localOffsetPx.y, 0);
            attachmentNode.setSiblingIndex(state.behind ? 0 : 1);
            attachmentNode.active = state.visible;
          })
          .catch((error: unknown) => {
            console.warn(
              `[YokaiField] Menu backdrop attachment frame failed: ${errorMessage(error)}`,
            );
          });
      }
    }

    return container;
  }

  private destroyNodes(): void {
    // The over-actors atmosphere lives on `atmosphere-layer`, not under the room: destroy the
    // handles explicitly or chapter 1 shafts stay drawn over the next chapter and the menus.
    this.atmosphere?.destroy();
    this.atmosphere = null;
    if (this.actor !== null && this.actor.isValid) this.actor.destroy();
    this.actor = null;
    if (this.container !== null && this.container.isValid) this.container.destroy();
    this.container = null;
    this.playerSpot = null;
    this.shownChapter = null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
