/**
 * Attachment rig (ticket #20 stub — implement): where a separate weapon/prop sprite sits
 * on a playable character. Pure TS, no `cc`.
 */
import type { Direction } from './manifest';

export type AttachSlot = 'hand' | 'back';
export type Point = readonly [number, number];

export interface CharacterRig {
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Slot → direction → point in the character frame (texture px, origin top-left). */
  readonly points: Readonly<Partial<Record<AttachSlot, Readonly<Record<Direction, Point>>>>>;
  /** Animation → direction → per-frame vertical offset of the body (texture px, + = down). */
  readonly bob: Readonly<Record<string, Readonly<Partial<Record<Direction, readonly number[]>>>>>;
}

export interface AttachmentItem {
  /** Manifest key prefix of the item's sheet. */
  readonly sprite: string;
  readonly slot: AttachSlot;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Direction → grip point in the item frame (texture px, origin top-left). */
  readonly grip: Readonly<Record<Direction, Point>>;
  /** Directions where the item is drawn behind the body; replaces the slot default. */
  readonly behind?: readonly Direction[];
}

export interface AttachmentData {
  readonly version: 1;
  readonly characters: Readonly<Record<string, CharacterRig>>;
  readonly items: Readonly<Record<string, AttachmentItem>>;
}

export interface AttachmentQuery {
  readonly character: string;
  readonly item: string;
  readonly animation: string;
  readonly direction: Direction;
  readonly frame: number;
}

/** Top-left of the item frame relative to the top-left of the character frame, and draw order. */
export interface AttachmentPlacement {
  readonly x: number;
  readonly y: number;
  readonly behind: boolean;
}

export function validateAttachments(raw: unknown): AttachmentData {
  return raw as AttachmentData;
}

export function placeAttachment(_data: AttachmentData, _query: AttachmentQuery): AttachmentPlacement {
  return { x: 0, y: 0, behind: false };
}
