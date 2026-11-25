/**
 * Attach points for playable characters and their separate weapon/prop sprites.
 *
 * Playable characters are drawn **unarmed**; a weapon is its own sprite placed on the
 * body's `hand` or `back` point. Data lives in `assets/resources/data/attachments.json`,
 * written by staging (`attach` on a character spec, `slot`/`grip`/`behind` on an
 * attachment spec). Pure TS: no `cc` import, testable with vitest.
 *
 * A character rig records, per animation and direction, how far the body bobs on each
 * frame (`frameBob` at staging). `placeAttachment` returns the item's offset from the
 * body's origin and whether it is drawn behind the body, following that bob.
 */
import type { Direction } from './manifest';

/** Body slot an item is worn on. */
export type AttachSlot = 'hand' | 'back';

/** A point in output-frame pixels. */
export type AttachmentPoint = readonly [number, number];

/** One playable character's attach points and per-frame bob. */
export interface CharacterRig {
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Slot → direction → point on the body frame. */
  readonly points: Partial<Record<AttachSlot, Readonly<Record<string, AttachmentPoint>>>>;
  /** Animation → direction → bob per frame (0 = frame 0's top row). */
  readonly bob: Readonly<Record<string, Readonly<Record<string, readonly number[]>>>>;
}

/** One weapon/prop sprite that can be attached. */
export interface AttachmentItem {
  /** Manifest key prefix, e.g. `attachment.sword-back`. */
  readonly sprite: string;
  readonly slot: AttachSlot;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Direction → grip point inside the item frame. */
  readonly grip: Readonly<Record<string, AttachmentPoint>>;
  /** Directions drawn behind the body; absent = slot default. */
  readonly behind?: readonly string[];
}

/** Contents of `assets/resources/data/attachments.json`. */
export interface AttachmentsData {
  readonly version: 1;
  readonly characters: Readonly<Record<string, CharacterRig>>;
  readonly items: Readonly<Record<string, AttachmentItem>>;
}

export interface PlaceAttachmentQuery {
  readonly character: string;
  readonly item: string;
  readonly animation: string;
  readonly direction: string;
  readonly frame: number;
}

export interface AttachmentPlacement {
  /** Offset from the body's origin (its anchor), in output-frame pixels. */
  readonly x: number;
  readonly y: number;
  /** Draw behind the body instead of in front. */
  readonly behind: boolean;
}

/** Alias kept from the ticket #20 stub, for callers that already name the rig data. */
export type AttachmentData = AttachmentsData;
/** Alias kept from the ticket #20 stub. */
export type AttachmentQuery = PlaceAttachmentQuery;
/** Alias kept from the ticket #20 stub. */
export type Point = AttachmentPoint;

const SLOTS: ReadonlySet<string> = new Set(['hand', 'back']);
const DIRECTIONS: readonly Direction[] = ['down', 'up', 'left', 'right'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function readPoint(value: unknown, at: string, problems: string[]): AttachmentPoint | null {
  if (!Array.isArray(value) || value.length !== 2) {
    problems.push(`${at} must be [x, y]`);
    return null;
  }
  const [x, y] = value as readonly unknown[];
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    problems.push(`${at} must be [x, y] of two integers`);
    return null;
  }
  return [x as number, y as number];
}

/** Every direction must be present, each with a valid point. */
function readPointMap(value: unknown, at: string, problems: string[]): Record<string, AttachmentPoint> {
  const result: Record<string, AttachmentPoint> = {};
  if (!isRecord(value)) {
    problems.push(`${at} must map a direction to [x, y]`);
    return result;
  }
  for (const direction of DIRECTIONS) {
    if (!(direction in value)) {
      problems.push(`${at}.${direction} is missing`);
      continue;
    }
    const parsed = readPoint(value[direction], `${at}.${direction}`, problems);
    if (parsed !== null) result[direction] = parsed;
  }
  return result;
}

function readBob(
  value: unknown,
  at: string,
  problems: string[],
): Record<string, Record<string, readonly number[]>> {
  const result: Record<string, Record<string, readonly number[]>> = {};
  if (value === undefined) return result;
  if (!isRecord(value)) {
    problems.push(`${at} must map an animation to its per-direction bob`);
    return result;
  }
  for (const [animation, directions] of Object.entries(value)) {
    if (!isRecord(directions)) {
      problems.push(`${at}.${animation} must map a direction to its bob`);
      continue;
    }
    const perDirection: Record<string, readonly number[]> = {};
    for (const [direction, column] of Object.entries(directions)) {
      if (!Array.isArray(column) || column.some((bob) => !Number.isInteger(bob))) {
        problems.push(`${at}.${animation}.${direction} must be an array of integers`);
        continue;
      }
      perDirection[direction] = column as readonly number[];
    }
    result[animation] = perDirection;
  }
  return result;
}

function readCharacter(value: unknown, at: string, problems: string[]): CharacterRig | null {
  if (!isRecord(value)) {
    problems.push(`${at} must be an object`);
    return null;
  }
  let ok = true;
  const size = (field: 'frameWidth' | 'frameHeight'): number => {
    const raw = value[field];
    if (!isPositiveInteger(raw)) {
      problems.push(`${at}.${field} must be a positive integer`);
      ok = false;
      return 1;
    }
    return raw;
  };
  const frameWidth = size('frameWidth');
  const frameHeight = size('frameHeight');

  const points: Partial<Record<AttachSlot, Record<string, AttachmentPoint>>> = {};
  const rawPoints = value['points'];
  if (!isRecord(rawPoints)) {
    problems.push(`${at}.points must map a slot to its direction points`);
    ok = false;
  } else {
    for (const [slot, slotPoints] of Object.entries(rawPoints)) {
      if (!SLOTS.has(slot)) {
        problems.push(`${at}.points.${slot} must be hand or back`);
        ok = false;
        continue;
      }
      points[slot as AttachSlot] = readPointMap(slotPoints, `${at}.points.${slot}`, problems);
    }
  }
  const bob = readBob(value['bob'], `${at}.bob`, problems);
  if (!ok) return null;
  return { frameWidth, frameHeight, points, bob };
}

function readItem(value: unknown, at: string, problems: string[]): AttachmentItem | null {
  if (!isRecord(value)) {
    problems.push(`${at} must be an object`);
    return null;
  }
  let ok = true;
  const sprite = value['sprite'];
  if (typeof sprite !== 'string' || sprite.length === 0) {
    problems.push(`${at}.sprite must be a non-empty manifest key`);
    ok = false;
  }
  const slot = value['slot'];
  if (typeof slot !== 'string' || !SLOTS.has(slot)) {
    problems.push(`${at}.slot must be hand or back`);
    ok = false;
  }
  const size = (field: 'frameWidth' | 'frameHeight'): number => {
    const raw = value[field];
    if (!isPositiveInteger(raw)) {
      problems.push(`${at}.${field} must be a positive integer`);
      ok = false;
      return 1;
    }
    return raw;
  };
  const frameWidth = size('frameWidth');
  const frameHeight = size('frameHeight');
  const grip = readPointMap(value['grip'], `${at}.grip`, problems);

  let behind: readonly string[] | undefined;
  const rawBehind = value['behind'];
  if (rawBehind !== undefined) {
    if (!Array.isArray(rawBehind) || rawBehind.some((d) => typeof d !== 'string' || !DIRECTIONS.includes(d as Direction))) {
      problems.push(`${at}.behind must contain only down/up/left/right`);
      ok = false;
    } else {
      behind = rawBehind as readonly string[];
    }
  }

  if (!ok) return null;
  return {
    sprite: sprite as string,
    slot: slot as AttachSlot,
    frameWidth,
    frameHeight,
    grip,
    ...(behind === undefined ? {} : { behind }),
  };
}

/**
 * Validate `attachments.json`, collecting **every** problem and throwing one `Error`.
 */
export function validateAttachments(raw: unknown): AttachmentsData {
  const problems: string[] = [];
  if (!isRecord(raw)) throw new Error('attachments.json must be an object');
  if (raw['version'] !== 1) problems.push(`version must be 1, got ${JSON.stringify(raw['version'])}`);

  const characters: Record<string, CharacterRig> = {};
  const rawCharacters = raw['characters'] ?? {};
  if (!isRecord(rawCharacters)) {
    problems.push('characters must be an object map name → rig');
  } else {
    for (const [name, value] of Object.entries(rawCharacters)) {
      const rig = readCharacter(value, `characters.${name}`, problems);
      if (rig !== null) characters[name] = rig;
    }
  }

  const items: Record<string, AttachmentItem> = {};
  const rawItems = raw['items'] ?? {};
  if (!isRecord(rawItems)) {
    problems.push('items must be an object map name → item');
  } else {
    for (const [name, value] of Object.entries(rawItems)) {
      const item = readItem(value, `items.${name}`, problems);
      if (item !== null) items[name] = item;
    }
  }

  if (problems.length > 0) {
    throw new Error(`attachments.json is invalid — ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  return { version: 1, characters, items };
}

/**
 * Read the per-frame vertical bob (in output-frame pixels, positive = lower) for one rig frame.
 *
 * Returns `0` when the rig does not record a bob array for `animation` or `direction` (missing
 * animations are optional). Wraps `frame` safely across the recorded column length, including
 * negative frame indices.
 */
export function bobOffset(
  rig: CharacterRig,
  animation: string,
  direction: string,
  frame: number,
): number {
  const column = rig.bob[animation]?.[direction];
  if (column === undefined || column.length === 0) return 0;
  const normalizedFrame = Number.isFinite(frame) ? Math.trunc(frame) : 0;
  const index = ((normalizedFrame % column.length) + column.length) % column.length;
  return column[index] ?? 0;
}

/**
 * Place one item on one body frame.
 *
 * `x = point.x - grip.x`, `y = point.y - grip.y + bob`, where the bob comes from the
 * character's rig for this animation/direction/frame (0 when the animation has no bob).
 * An item's own `behind` list wins; otherwise a hand item is behind only when facing
 * `up` and a back item is behind for every direction except `up`.
 */
export function placeAttachment(data: AttachmentsData, query: PlaceAttachmentQuery): AttachmentPlacement {
  const character = data.characters[query.character];
  if (character === undefined) throw new Error(`unknown character "${query.character}" in attachments.json`);
  const item = data.items[query.item];
  if (item === undefined) throw new Error(`unknown item "${query.item}" in attachments.json`);

  const point = character.points[item.slot]?.[query.direction];
  if (point === undefined) {
    throw new Error(`character "${query.character}" has no ${item.slot} point for direction "${query.direction}"`);
  }
  const grip = item.grip[query.direction];
  if (grip === undefined) {
    throw new Error(`item "${query.item}" has no grip for direction "${query.direction}"`);
  }

  const bob = bobOffset(character, query.animation, query.direction, query.frame);

  const behind =
    item.behind !== undefined
      ? item.behind.includes(query.direction)
      : item.slot === 'hand'
        ? query.direction === 'up'
        : query.direction !== 'up';

  return { x: point[0] - grip[0], y: point[1] - grip[1] + bob, behind };
}
