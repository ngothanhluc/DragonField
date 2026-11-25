/**
 * Pure-TS attachment node state & controller for M10 (GDD §14).
 *
 * Sits between `core/art/attachments.ts` (`placeAttachment`) and the thin Cocos child-node
 * adapter in `game/`:
 * - decides whether an attachment node should exist/be active (`false` for projectile
 *   weapons, unequipped loadouts, or non-rigged / baked-weapon characters & giants);
 * - resolves the directional manifest sprite key (`<item.sprite>.<direction>`), draw order
 *   (`behind`), and local offset (both raw image-frame pixels and Cocos y-up local coordinates
 *   relative to the body node's anchor, including per-frame bob);
 * - exposes manual and skill-scoped hide/show state so overlapping skill effects (e.g.
 *   Cultivator's "Ten Thousand Swords") hide the worn item and cleanly restore the exact
 *   current offset and draw order when finished.
 *
 * Pure TS: must NOT import `cc`.
 */
import { TILE_SIZE_PX } from '../level/level-data';
import {
  bobOffset,
  placeAttachment,
  type AttachSlot,
  type AttachmentPlacement,
  type AttachmentsData,
} from './attachments';
import type { Direction } from './manifest';

/** How a character's weapon is represented visually (GDD §14). */
export type WeaponForm = 'projectile' | 'attachment' | 'baked';

/** 2D offset vector. */
export interface AttachmentOffset {
  readonly x: number;
  readonly y: number;
}

/** Equipment / rig configuration for an actor's attachment slot. */
export interface AttachmentConfig {
  /** Character rig id in `attachments.json`, or `null` for non-rigged / baked bodies. */
  readonly character: string | null;
  /** Equipped attachment item id in `attachments.json`, or `null` when unarmed or projectile-only. */
  readonly item: string | null;
  /**
   * Weapon form (GDD §14). `'projectile'` and `'baked'` never create an attachment node,
   * even if `character` or `item` is supplied. Defaults to `'attachment'`.
   */
  readonly weaponForm?: WeaponForm;
  /**
   * Body node vertical anchor (0..1, bottom-up, e.g. `entryAnchorY(bodyEntry)`).
   * Defaults to `0` (bottom edge / feet with `footPx: 0`).
   */
  readonly bodyAnchorY?: number;
  /**
   * Attachment node vertical anchor (0..1, bottom-up, e.g. `entryAnchorY(itemEntry)`).
   * Defaults to `0.5` (centred attachment sprites).
   */
  readonly itemAnchorY?: number;
}

/** Current body animation pose used to evaluate the attachment placement. */
export interface AttachmentPose {
  readonly animation: string;
  readonly direction: Direction;
  readonly frame: number;
}

/** Computed state consumed by the Cocos child-node adapter. */
export interface AttachmentNodeState {
  /** Whether an attachment node should exist for this character/weapon (`false` for projectile, unequipped, or baked bodies). */
  readonly active: boolean;
  /** Whether the node should be visible (`active && !hidden`). */
  readonly visible: boolean;
  /** Whether hidden by `setHidden(true)` or any active `hideForSkill(id)` token. */
  readonly hidden: boolean;
  /** Full directional manifest key (e.g. `'attachment.sword-back.down'`), or `null` when inactive. */
  readonly spriteKey: string | null;
  /** Manifest key prefix from `attachments.json` (e.g. `'attachment.sword-back'`), or `null` when inactive. */
  readonly spritePrefix: string | null;
  /** Body slot (`'hand'` or `'back'`), or `null` when inactive. */
  readonly slot: AttachSlot | null;
  /** Item frame width in texture pixels (`0` when inactive). */
  readonly frameWidth: number;
  /** Item frame height in texture pixels (`0` when inactive). */
  readonly frameHeight: number;
  /** Raw `placeAttachment` output (image-frame pixels, top-left origin, y down), or `null` when inactive. */
  readonly placement: AttachmentPlacement | null;
  /**
   * Child node local position in texture pixels (y-up, relative to body anchor `(0.5, bodyAnchorY)`).
   * Pass directly to `node.setPosition(localOffsetPx.x, localOffsetPx.y, 0)` under an `ACTOR_SCALE` player node.
   */
  readonly localOffsetPx: AttachmentOffset;
  /** Child node local position in world tiles (`localOffsetPx / TILE_SIZE_PX`). */
  readonly localOffsetTiles: AttachmentOffset;
  /** Per-frame vertical bob applied in pixels (positive = body lowered; `0` when inactive or unrecorded). */
  readonly bobPx: number;
  /** Draw order relative to the body (`true` = behind body, `false` = in front; `false` when inactive). */
  readonly behind: boolean;
}

const DEFAULT_BODY_ANCHOR_Y = 0;
const DEFAULT_ITEM_ANCHOR_Y = 0.5;
const ZERO_OFFSET: AttachmentOffset = { x: 0, y: 0 };

const DEFAULT_CONFIG: AttachmentConfig = {
  character: null,
  item: null,
};

const DEFAULT_POSE: AttachmentPose = {
  animation: 'idle',
  direction: 'down',
  frame: 0,
};

function zeroIfNegZero(value: number): number {
  return value === 0 ? 0 : value;
}

function sanitizeAnchor(anchor: number | undefined, fallback: number): number {
  if (anchor === undefined || !Number.isFinite(anchor)) return fallback;
  return Math.min(1, Math.max(0, anchor));
}

function sanitizeFrame(frame: number): number {
  return Number.isFinite(frame) ? Math.trunc(frame) : 0;
}

function inactiveState(hidden: boolean): AttachmentNodeState {
  return {
    active: false,
    visible: false,
    hidden,
    spriteKey: null,
    spritePrefix: null,
    slot: null,
    frameWidth: 0,
    frameHeight: 0,
    placement: null,
    localOffsetPx: ZERO_OFFSET,
    localOffsetTiles: ZERO_OFFSET,
    bobPx: 0,
    behind: false,
  };
}

/**
 * Pure computation of an attachment child node's state for one character, weapon config,
 * body animation pose, and hide flag.
 */
export function resolveAttachmentNode(
  data: AttachmentsData,
  config: AttachmentConfig,
  pose: AttachmentPose,
  hidden = false,
): AttachmentNodeState {
  const form = config.weaponForm ?? 'attachment';
  if (form === 'projectile' || form === 'baked') {
    return inactiveState(hidden);
  }
  if (config.character === null || config.character.length === 0) {
    return inactiveState(hidden);
  }
  if (config.item === null || config.item.length === 0) {
    return inactiveState(hidden);
  }

  const rig = data.characters[config.character];
  if (rig === undefined) {
    // Non-rigged / baked-weapon character or giant body: no separate attachment node.
    return inactiveState(hidden);
  }

  const frame = sanitizeFrame(pose.frame);
  const placement = placeAttachment(data, {
    character: config.character,
    item: config.item,
    animation: pose.animation,
    direction: pose.direction,
    frame,
  });

  const itemDef = data.items[config.item]!;
  const bobPx = zeroIfNegZero(bobOffset(rig, pose.animation, pose.direction, frame));

  const bodyAnchorY = sanitizeAnchor(config.bodyAnchorY, DEFAULT_BODY_ANCHOR_Y);
  const itemAnchorY = sanitizeAnchor(config.itemAnchorY, DEFAULT_ITEM_ANCHOR_Y);

  // Convert top-left image-pixel placement (y-down) to Cocos child-node local coords (y-up)
  // anchored at (0.5, bodyAnchorY) on the body and (0.5, itemAnchorY) on the attachment.
  const localX = zeroIfNegZero(placement.x + itemDef.frameWidth * 0.5 - rig.frameWidth * 0.5);
  const localY = zeroIfNegZero(
    rig.frameHeight * (1 - bodyAnchorY) -
      (placement.y + itemDef.frameHeight * (1 - itemAnchorY)),
  );

  return {
    active: true,
    visible: !hidden,
    hidden,
    spriteKey: `${itemDef.sprite}.${pose.direction}`,
    spritePrefix: itemDef.sprite,
    slot: itemDef.slot,
    frameWidth: itemDef.frameWidth,
    frameHeight: itemDef.frameHeight,
    placement,
    localOffsetPx: { x: localX, y: localY },
    localOffsetTiles: {
      x: zeroIfNegZero(localX / TILE_SIZE_PX),
      y: zeroIfNegZero(localY / TILE_SIZE_PX),
    },
    bobPx,
    behind: placement.behind,
  };
}

/**
 * Stateful pure-TS controller for a player/actor's single attachment child node.
 *
 * Tracks the equipped rig/item, latest animation pose, and overlapping skill hide tokens.
 * While hidden, the controller keeps evaluating placement/bob/draw-order against pose
 * updates so that showing the attachment again restores the exact current position and
 * z-order immediately.
 */
export class AttachmentNodeController {
  private readonly data: AttachmentsData;
  private config: AttachmentConfig;
  private pose: AttachmentPose;
  private manualHidden = false;
  private readonly hiddenSkills = new Set<string>();
  private currentState: AttachmentNodeState;

  constructor(
    data: AttachmentsData,
    config: AttachmentConfig = DEFAULT_CONFIG,
    initialPose: AttachmentPose = DEFAULT_POSE,
  ) {
    this.data = data;
    this.config = config;
    this.pose = initialPose;
    this.currentState = this.recompute();
  }

  /** Current immutable attachment state snapshot. */
  get state(): AttachmentNodeState {
    return this.currentState;
  }

  /** Return the current immutable attachment state snapshot. */
  getState(): AttachmentNodeState {
    return this.currentState;
  }

  /** Update the equipped character/item/weapon-form config and recompute state. */
  setEquipment(config: AttachmentConfig): AttachmentNodeState {
    this.config = config;
    this.currentState = this.recompute();
    return this.currentState;
  }

  /** Update body animation, facing direction, and frame index; recompute offset, bob, and draw order. */
  update(pose: AttachmentPose): AttachmentNodeState {
    this.pose = pose;
    this.currentState = this.recompute();
    return this.currentState;
  }

  /** Imperatively set or clear the manual hide flag. */
  setHidden(hidden: boolean): AttachmentNodeState {
    this.manualHidden = hidden;
    this.currentState = this.recompute();
    return this.currentState;
  }

  /**
   * Hide the attachment while `skillId` is active (e.g. `'ten-thousand-swords'`).
   * Multiple distinct skill ids stack safely without prematurely unhiding.
   */
  hideForSkill(skillId: string): AttachmentNodeState {
    if (skillId.length > 0) {
      this.hiddenSkills.add(skillId);
      this.currentState = this.recompute();
    }
    return this.currentState;
  }

  /**
   * End a skill's hide request for `skillId`. Visibility returns only when no other
   * skill hide token or manual hide flag remains active.
   */
  showForSkill(skillId: string): AttachmentNodeState {
    if (this.hiddenSkills.delete(skillId)) {
      this.currentState = this.recompute();
    }
    return this.currentState;
  }

  /** Clear both manual and skill-scoped hide flags (e.g. on run/room reset). */
  clearHidden(): AttachmentNodeState {
    this.manualHidden = false;
    this.hiddenSkills.clear();
    this.currentState = this.recompute();
    return this.currentState;
  }

  /** Whether any manual or skill-scoped hide flag is currently active. */
  isHidden(): boolean {
    return this.manualHidden || this.hiddenSkills.size > 0;
  }

  /** Whether an attachment node should currently be visible (`active && !isHidden()`). */
  isVisible(): boolean {
    return this.currentState.visible;
  }

  /** Whether an attachment node should exist/be active for the current character & weapon. */
  isActive(): boolean {
    return this.currentState.active;
  }

  private recompute(): AttachmentNodeState {
    return resolveAttachmentNode(this.data, this.config, this.pose, this.isHidden());
  }
}
