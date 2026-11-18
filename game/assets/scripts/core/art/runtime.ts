/**
 * Animation playback maths — pure TS, no `cc` import, testable with vitest.
 *
 * The Cocos adapter (`game/`) may only call these functions to decide *which frame* and *which
 * direction*; this module itself knows nothing about textures or nodes.
 */
import type { Vec2 } from '../math/vec2';
import type { Direction, SpriteEntry } from './manifest';

const RESOURCES_PREFIX = 'resources/';
const PNG_EXTENSION = '.png';

/**
 * Turn a manifest path (`resources/art/x/Idle.png`) into a resources bundle path
 * (`art/x/Idle`). Throws if the path is not under `resources/` or is not a png — both are a broken
 * manifest, not "the pack is missing art".
 */
export function toResourcesPath(sheet: string): string {
  if (!sheet.startsWith(RESOURCES_PREFIX)) {
    throw new Error(`sheet must start with "${RESOURCES_PREFIX}", got "${sheet}"`);
  }
  if (!sheet.endsWith(PNG_EXTENSION)) {
    throw new Error(`sheet must end with "${PNG_EXTENSION}", got "${sheet}"`);
  }

  const path = sheet.slice(RESOURCES_PREFIX.length, -PNG_EXTENSION.length);
  if (path.length === 0) {
    throw new Error(`sheet does not point at any file: "${sheet}"`);
  }
  return path;
}

/** Length of one clip loop, ms. Invalid fps or frames ⇒ 0 (nothing to play). */
export function loopDurationMs(entry: SpriteEntry): number {
  if (entry.fps <= 0 || entry.frames <= 0) {
    return 0;
  }
  return (entry.frames / entry.fps) * 1000;
}

/**
 * Vertical anchor (0..1, measured from the bottom of the frame) that keeps the pivot consistent
 * across animations of different sizes. Actors stand on their feet at `footPx`; FX anchor at the frame centre.
 */
export function entryAnchorY(entry: SpriteEntry): number {
  if (entry.anchor === 'center') return 0.5;
  if (entry.frameHeight <= 0) return 0.5;
  return Math.min(1, Math.max(0, entry.footPx / entry.frameHeight));
}

/**
 * The frame shown at `elapsedMs` since `play`.
 *
 * - `loop`: wraps around; exactly one loop of time returns to frame 0.
 * - not `loop`: holds the last frame, never goes past `frames - 1`.
 * - negative or non-finite `elapsedMs` ⇒ frame 0. `fps <= 0` ⇒ frame 0 (no frame can be derived).
 */
export function frameIndexAt(entry: SpriteEntry, elapsedMs: number): number {
  if (entry.fps <= 0 || entry.frames <= 0) {
    return 0;
  }

  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const advanced = Math.floor((elapsed * entry.fps) / 1000);

  if (entry.loop) {
    return advanced % entry.frames;
  }
  return Math.min(advanced, entry.frames - 1);
}

/**
 * Facing direction from a movement vector: the dominant axis wins.
 *
 * When `|x| == |y|` (including the zero vector) it returns `fallback` instead of arbitrarily
 * picking an axis — otherwise standing still would make the sprite flip direction constantly.
 */
export function directionFromVector(v: Vec2, fallback: Direction): Direction {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);

  if (ax === ay) {
    return fallback;
  }
  if (ax > ay) {
    return v.x > 0 ? 'right' : 'left';
  }
  return v.y > 0 ? 'up' : 'down';
}
