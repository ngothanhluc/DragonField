/**
 * Depth, see-through canopies/roofs and walk-in grass cover (M9, ticket #36). Visual only:
 * nothing here changes targeting, collision or damage (owner decision: no stealth).
 *
 * Pure helpers only — no `cc`, no time, no rendering: the game adapter (`game/cover-view.ts`,
 * `game/depth-view.ts`) applies them to nodes. Everything here is allocation-free on the hot
 * path except `drawOrder`, which is the test/one-shot entry point (the per-frame adapter sorts
 * its own reusable array in place with `sortDepthInPlace`).
 */
import type { Vec2 } from '../math/vec2';
import type { PropDef } from '../level/props';
import { TILE_SIZE_PX } from '../level/level-data';

/** Axis-aligned rectangle in room tile units (top-left origin, y down). */
export interface TileArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DepthItem {
  readonly id: string;
  /** y of the item's feet (actors) or of its base's bottom edge (props), tiles. */
  readonly footY: number;
}

export interface Body {
  readonly position: Vec2;
  readonly radiusTiles: number;
}

/**
 * World draw layers, back to front. Overlays (canopies/roofs) sit above actors; bullets,
 * telegraphs and in-world UI (damage numbers, arrows) sit above every overlay.
 */
export const WORLD_DRAW_LAYERS: readonly string[] = [
  'ground',
  'actors',
  'overlays',
  'bullets',
  'telegraphs',
  'damage-numbers',
];

/**
 * Sort depth items in place, back to front: a larger foot y (lower on screen, closer to the
 * viewer) draws later. `Array.prototype.sort` is stable, so ties keep their input order.
 */
export function sortDepthInPlace<T extends Pick<DepthItem, 'footY'>>(items: T[]): void {
  items.sort((a, b) => a.footY - b.footY);
}

/** Ids in draw order, back to front: a larger foot y draws later (in front). Stable for ties. */
export function drawOrder(items: readonly DepthItem[]): string[] {
  const sorted = items.slice();
  sortDepthInPlace(sorted);
  return sorted.map((item) => item.id);
}

/** The canopy/roof area of a placed prop in tiles, or `null` when the prop has no overlay. */
export function propOverlayArea(placed: Vec2, def: PropDef): TileArea | null {
  const overlay = def.overlay;
  if (overlay === undefined) return null;

  return {
    x: placed.x + overlay.x / TILE_SIZE_PX,
    y: placed.y + overlay.y / TILE_SIZE_PX,
    width: overlay.width / TILE_SIZE_PX,
    height: overlay.height / TILE_SIZE_PX,
  };
}

/** The walk-in area of a cover prop (tall grass, bush) in tiles, or `null` when it is not cover. */
export function propCoverArea(placed: Vec2, def: PropDef): TileArea | null {
  if (def.cover !== true) return null;

  return {
    x: placed.x,
    y: placed.y,
    width: def.rect.width / TILE_SIZE_PX,
    height: def.rect.height / TILE_SIZE_PX,
  };
}

/** Target opacity of an overlay: `fadedAlpha` while any body overlaps it, 1 otherwise. */
export function overlayAlphaTarget(area: TileArea, bodies: readonly Body[], fadedAlpha: number): number {
  for (const body of bodies) {
    // Closest point of the rect to the body centre; the circle overlaps when that point is
    // within the radius (a body whose centre is outside the canopy still counts).
    const closestX = clamp(body.position.x, area.x, area.x + area.width);
    const closestY = clamp(body.position.y, area.y, area.y + area.height);
    const dx = body.position.x - closestX;
    const dy = body.position.y - closestY;
    if (dx * dx + dy * dy <= body.radiusTiles * body.radiusTiles) return fadedAlpha;
  }
  return 1;
}

/** Opacity of an actor: `coverAlpha` while its feet are inside any cover area, 1 otherwise. */
export function actorCoverAlpha(feet: Vec2, coverAreas: readonly TileArea[], coverAlpha: number): number {
  for (const area of coverAreas) {
    if (
      feet.x >= area.x &&
      feet.x <= area.x + area.width &&
      feet.y >= area.y &&
      feet.y <= area.y + area.height
    ) {
      return coverAlpha;
    }
  }
  return 1;
}

/** Ease `current` toward `target` frame-rate independently: `1 - exp(-rate * dt)`. */
export function easeAlpha(current: number, target: number, dtSeconds: number, rate: number): number {
  if (!(rate > 0) || !(dtSeconds > 0)) return current;
  const factor = 1 - Math.exp(-rate * dtSeconds);
  // `factor` is in [0, 1): the eased value never passes the target.
  return target === current ? target : current + (target - current) * factor;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
