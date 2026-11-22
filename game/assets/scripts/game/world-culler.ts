/**
 * Cull the room's **static** world sprites that are off screen (ticket #37, ADR-018).
 *
 * A 128×72 room holds ~16 screens of water tiles, obstacles, decor and under-actors atmosphere.
 * The engine draws every active `Sprite` in the scene graph whether or not the camera sees it, so
 * moving the camera over such a room would cost 16× a 32×18 room. This pass deactivates the
 * leaf sprites of the room tree that sit outside the view + a 2-tile margin, so a big room costs
 * about one screen.
 *
 * Scope is deliberately narrow:
 * - only the **room tree** (tiles are excluded: `TiledMap` keeps its own layers);
 * - only **leaf nodes**, which are plain static sprites (obstacles, water tiles, decor items,
 *   under-actors particles) — their parents own the `update` components, so deactivating a leaf
 *   never stops logic. Actors, bullets and the FX pool are **not** touched: their node `active`
 *   flag is game state (the FX pool uses it as its lifetime flag) and their count does not grow
 *   with room area.
 *
 * Positions are local: every container of the room tree (room root, water/decor/obstacles
 * groups) sits at the world origin with scale 1, so a leaf's local position is its world position.
 */
import type { Node as CocosNode } from 'cc';

type Node = InstanceType<typeof CocosNode>;

/** Visible rectangle in world units (bottom-left origin, y up). */
export interface CullRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Tiles of margin around the view: a sprite may be half off screen and still drawn. */
export const CULL_MARGIN_TILES = 2;

/** Name of the `TiledMap` child; its layers are the engine's business, never toggled here. */
const TILE_MAP_NODE = 'tile-map';

/**
 * Toggle the leaf sprites of `root` by whether they intersect `view` + margin.
 * Returns how many leaves are currently hidden (debug/measurement only).
 */
export function cullWorld(root: Node | null, view: CullRect, marginTiles = CULL_MARGIN_TILES): number {
  if (root === null || !root.isValid) return 0;
  return cullChildren(root, view, marginTiles);
}

function cullChildren(node: Node, view: CullRect, margin: number): number {
  let hidden = 0;
  for (const child of node.children) {
    if (!child.isValid) continue;
    if (child.name === TILE_MAP_NODE) continue;

    if (child.children.length > 0) {
      hidden += cullChildren(child, view, margin);
      continue;
    }

    const position = child.position;
    const visible =
      position.x >= view.x - margin &&
      position.x <= view.x + view.width + margin &&
      position.y >= view.y - margin &&
      position.y <= view.y + view.height + margin;
    if (child.active !== visible) child.active = visible;
    if (!visible) hidden += 1;
  }
  return hidden;
}
