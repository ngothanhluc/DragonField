/**
 * Depth, see-through canopies/roofs and walk-in grass cover (M9, ticket #36). Visual only:
 * nothing here changes targeting, collision or damage (owner decision: no stealth).
 *
 * STUB written with the red acceptance test. The executor replaces the bodies; the exported names
 * and signatures are the agreed seam.
 */
import type { Vec2 } from '../math/vec2';
import type { PropDef } from '../level/props';

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
export const WORLD_DRAW_LAYERS: readonly string[] = [];

/** Ids in draw order, back to front: a larger foot y draws later (in front). Stable for ties. */
export function drawOrder(items: readonly DepthItem[]): string[] {
  return items.map((item) => item.id);
}

/** The canopy/roof area of a placed prop in tiles, or `null` when the prop has no overlay. */
export function propOverlayArea(placed: Vec2, def: PropDef): TileArea | null {
  void placed;
  void def;
  return null;
}

/** The walk-in area of a cover prop (tall grass, bush) in tiles, or `null` when it is not cover. */
export function propCoverArea(placed: Vec2, def: PropDef): TileArea | null {
  void placed;
  void def;
  return null;
}

/** Target opacity of an overlay: `fadedAlpha` while any body overlaps it, 1 otherwise. */
export function overlayAlphaTarget(area: TileArea, bodies: readonly Body[], fadedAlpha: number): number {
  void area;
  void bodies;
  void fadedAlpha;
  return 1;
}

/** Opacity of an actor: `coverAlpha` while its feet are inside any cover area, 1 otherwise. */
export function actorCoverAlpha(feet: Vec2, coverAreas: readonly TileArea[], coverAlpha: number): number {
  void feet;
  void coverAreas;
  void coverAlpha;
  return 1;
}

/** Ease `current` toward `target` frame-rate independently: `1 - exp(-rate * dt)`. */
export function easeAlpha(current: number, target: number, dtSeconds: number, rate: number): number {
  void target;
  void dtSeconds;
  void rate;
  return current;
}
