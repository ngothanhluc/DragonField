/**
 * Thin Cocos adapter around `AttachmentNodeController` (`core/art/attachment-node.ts`) for M10.
 *
 * Cocos 3.8 Batcher2D trap: a parent node's own `Sprite` always renders before its children
 * regardless of sibling index. Therefore the `player` container node holds NO `Sprite`; instead,
 * `player-body` and `player-attachment` sit as sibling children under `player`, and
 * `attachmentNode.setSiblingIndex(behind ? 0 : 1)` places the attachment genuinely behind or
 * in front of the body.
 *
 * Projectile / baked-weapon characters (like Ninja) have `state.active === false` and NEVER
 * create a `player-attachment` node.
 */
import {
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import {
  AttachmentNodeController,
  type AttachmentConfig,
  type AttachmentNodeState,
  type AttachmentPose,
} from '../core/art/attachment-node';
import type { AttachmentsData } from '../core/art/attachments';
import { resolve, type AnimationManifest, type Direction } from '../core/art/manifest';
import { entryAnchorY } from '../core/art/runtime';
import { characterAnimationKeys, type CharacterDef } from '../core/characters/roster';
import { reportAnimationProblem } from './anim/sprite-animator';
import { getFrame } from './assets/sprite-frame-cache';

/** `cc` is an any module: types must be derived from the import value. */
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;

/** Canonical child node name for the player's body `Sprite` + `SpriteAnimator`. */
export const PLAYER_BODY_NODE_NAME = 'player-body';
/** Canonical child node name for the player's worn/held weapon `Sprite`. */
export const PLAYER_ATTACHMENT_NODE_NAME = 'player-attachment';

const EMPTY_ATTACHMENTS: AttachmentsData = {
  version: 1,
  characters: {},
  items: {},
};

const DEFAULT_POSE: AttachmentPose = {
  animation: 'idle',
  direction: 'down',
  frame: 0,
};

/** Read-only snapshot exposed for debugging and M10 browser verification (`window.__yokai`). */
export interface PlayerAttachmentSnapshot {
  readonly hasNode: boolean;
  readonly active: boolean;
  readonly visible: boolean;
  readonly hidden: boolean;
  readonly behind: boolean;
  readonly localX: number;
  readonly localY: number;
  readonly bobPx: number;
  readonly spriteKey: string | null;
  readonly direction: Direction;
  readonly frame: number;
}

export interface PlayerAttachmentViewArgs {
  /** Player container node (`player`, must hold no `Sprite` of its own). */
  readonly parent: Node;
  /** Sibling body node (`player-body`). */
  readonly bodyNode: Node;
  /** Validated `animations.json` manifest. */
  readonly manifest: AnimationManifest;
  /** Validated `attachments.json` rig data, or `null` when unavailable. */
  readonly attachments: AttachmentsData | null;
  /** Playable character definition. */
  readonly character: CharacterDef;
  /** Optional initial animation pose (defaults to `idle`, `down`, frame `0`). */
  readonly initialPose?: AttachmentPose;
}

function resolveBodyAnchorY(
  manifest: AnimationManifest,
  character: CharacterDef,
  direction: Direction,
): number {
  const { key, fallback } = characterAnimationKeys(character, 'idle', direction);
  const entry = manifest.sprites[key] ?? manifest.sprites[fallback];
  return entry !== undefined ? entryAnchorY(entry) : 0;
}

function resolveItemAnchorY(
  manifest: AnimationManifest,
  attachments: AttachmentsData | null,
  itemId: string | null,
  direction: Direction,
): number {
  if (attachments === null || itemId === null) return 0.5;
  const itemDef = attachments.items[itemId];
  if (itemDef === undefined) return 0.5;
  const entry =
    manifest.sprites[`${itemDef.sprite}.${direction}`] ??
    manifest.sprites[`${itemDef.sprite}.down`];
  return entry !== undefined ? entryAnchorY(entry) : 0.5;
}

/**
 * Engine adapter that manages the single optional `player-attachment` sibling node under `player`.
 */
export class PlayerAttachmentView {
  private readonly parent: Node;
  private readonly manifest: AnimationManifest;
  private readonly itemAnchorY: number;
  private readonly controller: AttachmentNodeController;
  private pose: AttachmentPose;
  private attachmentNode: Node | null = null;
  private attachmentSprite: Sprite | null = null;
  private frameReady = false;
  private loadedFrameKey = '';
  private loadToken = 0;
  private lastBehind: boolean | null = null;
  private lastWidth = -1;
  private lastHeight = -1;
  private disposed = false;

  constructor(args: PlayerAttachmentViewArgs) {
    this.parent = args.parent;
    this.manifest = args.manifest;
    this.pose = args.initialPose ?? DEFAULT_POSE;

    const bodyAnchorY = resolveBodyAnchorY(args.manifest, args.character, this.pose.direction);
    this.itemAnchorY = resolveItemAnchorY(
      args.manifest,
      args.attachments,
      args.character.defaultLoadout.attachmentItemId,
      this.pose.direction,
    );

    const config: AttachmentConfig = {
      character: args.character.rigId,
      item: args.character.defaultLoadout.attachmentItemId,
      weaponForm: args.character.defaultLoadout.weaponForm,
      bodyAnchorY,
      itemAnchorY: this.itemAnchorY,
    };

    this.controller = new AttachmentNodeController(
      args.attachments ?? EMPTY_ATTACHMENTS,
      config,
      this.pose,
    );
    this.applyState(this.controller.getState());
  }

  /** Attachment node's `Sprite`, or `null` when no attachment node exists (e.g. Ninja). */
  get sprite(): Sprite | null {
    return this.attachmentSprite !== null && this.attachmentNode !== null && this.attachmentNode.isValid
      ? this.attachmentSprite
      : null;
  }

  /** Underlying `player-attachment` node, or `null` for projectile/baked characters. */
  get node(): Node | null {
    return this.attachmentNode !== null && this.attachmentNode.isValid ? this.attachmentNode : null;
  }

  /** Update animation, facing direction, and frame index; syncs position, frame, and draw order. */
  updatePose(pose: AttachmentPose): AttachmentNodeState {
    this.pose = pose;
    const state = this.controller.update(pose);
    this.applyState(state);
    return state;
  }

  /** Imperatively hide or unhide the attachment. */
  setHidden(hidden: boolean): AttachmentNodeState {
    const state = this.controller.setHidden(hidden);
    this.applyState(state);
    return state;
  }

  /** Hide the attachment while `skillId` is active (e.g. `'ten-thousand-swords'`). */
  hideForSkill(skillId: string): AttachmentNodeState {
    const state = this.controller.hideForSkill(skillId);
    this.applyState(state);
    return state;
  }

  /** End a skill's hide request for `skillId`, restoring visibility when no hide remains. */
  showForSkill(skillId: string): AttachmentNodeState {
    const state = this.controller.showForSkill(skillId);
    this.applyState(state);
    return state;
  }

  /** Clear both manual and skill-scoped hide flags. */
  clearHidden(): AttachmentNodeState {
    const state = this.controller.clearHidden();
    this.applyState(state);
    return state;
  }

  /** Current pure `AttachmentNodeState` computed by `AttachmentNodeController`. */
  getState(): AttachmentNodeState {
    return this.controller.getState();
  }

  /** Snapshot for debug hooks and browser acceptance assertions. */
  getSnapshot(): PlayerAttachmentSnapshot {
    const state = this.controller.getState();
    const hasNode = this.attachmentNode !== null && this.attachmentNode.isValid;
    return {
      hasNode,
      active: state.active,
      visible: state.visible && hasNode && this.attachmentNode!.active,
      hidden: state.hidden,
      behind: state.behind,
      localX: state.localOffsetPx.x,
      localY: state.localOffsetPx.y,
      bobPx: state.bobPx,
      spriteKey: state.spriteKey,
      direction: this.pose.direction,
      frame: this.pose.frame,
    };
  }

  /** Destroy the attachment child node and cancel any in-flight frame load. */
  destroy(): void {
    this.disposed = true;
    this.loadToken += 1;
    this.destroyNode();
  }

  private applyState(state: AttachmentNodeState): void {
    if (this.disposed || !this.parent.isValid) return;

    // Projectile / unequipped / baked bodies must NEVER create an attachment node.
    if (!state.active) {
      this.loadToken += 1;
      this.destroyNode();
      return;
    }

    const node = this.ensureNode(state);
    if (node === null) return;

    node.setPosition(state.localOffsetPx.x, state.localOffsetPx.y, 0);

    if (state.frameWidth !== this.lastWidth || state.frameHeight !== this.lastHeight) {
      this.applyNodeGeometry(node, state.frameWidth, state.frameHeight);
    }

    if (this.lastBehind !== state.behind) {
      this.lastBehind = state.behind;
      node.setSiblingIndex(state.behind ? 0 : 1);
    }

    if (state.spriteKey !== null) {
      this.requestFrame(state.spriteKey, this.pose.direction);
    }

    this.syncActive(node, state.visible);
  }

  private ensureNode(state: AttachmentNodeState): Node | null {
    if (this.attachmentNode !== null && this.attachmentNode.isValid) {
      return this.attachmentNode;
    }
    if (!this.parent.isValid) return null;

    const node = new CocosNode(PLAYER_ATTACHMENT_NODE_NAME);
    // Keep inactive until its first SpriteFrame arrives so `placeholders()` stays empty.
    node.active = false;
    node.parent = this.parent;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;

    this.attachmentNode = node;
    this.attachmentSprite = sprite;
    this.frameReady = false;
    this.loadedFrameKey = '';
    this.lastBehind = null;
    this.lastWidth = -1;
    this.lastHeight = -1;
    this.applyNodeGeometry(node, state.frameWidth, state.frameHeight);
    return node;
  }

  private applyNodeGeometry(node: Node, width: number, height: number): void {
    this.lastWidth = width;
    this.lastHeight = height;
    const transform = node.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setAnchorPoint(0.5, this.itemAnchorY);
      transform.setContentSize(width, height);
    }
  }

  private requestFrame(spriteKey: string, direction: Direction): void {
    const requestKey = `${spriteKey}|${direction}`;
    if (requestKey === this.loadedFrameKey) return;
    this.loadedFrameKey = requestKey;

    let entry;
    try {
      entry = resolve(this.manifest, spriteKey);
    } catch (error) {
      reportAnimationProblem(error instanceof Error ? error.message : String(error));
      return;
    }

    const token = ++this.loadToken;
    getFrame(entry, direction, 0)
      .then((frame) => {
        if (
          this.disposed ||
          token !== this.loadToken ||
          this.attachmentNode === null ||
          !this.attachmentNode.isValid ||
          this.attachmentSprite === null
        ) {
          return;
        }
        this.attachmentSprite.spriteFrame = frame;
        this.frameReady = true;
        this.syncActive(this.attachmentNode, this.controller.isVisible());
      })
      .catch((error: unknown) => {
        reportAnimationProblem(error instanceof Error ? error.message : String(error));
      });
  }

  private syncActive(node: Node, visible: boolean): void {
    const hasFrame =
      this.frameReady &&
      this.attachmentSprite !== null &&
      this.attachmentSprite.spriteFrame !== null;
    const shouldBeActive = visible && hasFrame;
    if (node.active !== shouldBeActive) {
      node.active = shouldBeActive;
    }
  }

  private destroyNode(): void {
    if (this.attachmentNode !== null && this.attachmentNode.isValid) {
      this.attachmentNode.destroy();
    }
    this.attachmentNode = null;
    this.attachmentSprite = null;
    this.frameReady = false;
    this.loadedFrameKey = '';
    this.lastBehind = null;
    this.lastWidth = -1;
    this.lastHeight = -1;
  }
}
