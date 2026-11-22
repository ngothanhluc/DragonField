/**
 * Cull the room's **static** world sprites that are off screen (ticket #37, ADR-018).
 *
 * A 64×36 room holds 4 screens of water tiles, obstacles, decor, under-actors atmosphere and
 * tile chunks. The engine draws every active `Sprite`/`TiledMap` in the scene graph whether or
 * not the camera sees it, so moving the camera over such a room would cost 4× a 32×18 room.
 * This pass deactivates what sits outside the view + a 2-tile margin, so a big room costs about
 * one screen.
 *
 * Scope is deliberately narrow:
 * - **tile chunks** (the `tile-chunk-*` nodes built by `level-view` for a multi-screen room) are
 *   toggled as a whole;
 * - the rest of the **room tree** is walked and only **leaf nodes** are toggled — those are plain
 *   static sprites (obstacles, water tiles, decor items, under-actors particles), and their
 *   parents own the `update` components, so deactivating a leaf never stops logic;
 * - actors, bullets and the FX pool are **not** touched: their node `active` flag is game state
 *   (the FX pool uses it as its lifetime flag) and their count does not grow with room area.
 *
 * Positions are local: every container of the room tree (room root, water/decor/obstacles
 * groups, the `tile-map` group) sits at the world origin with scale 1, so a leaf's local
 * position is its world position.
 */
import type { Node as CocosNode } from 'cc';
import { ROOM_COLS, ROOM_ROWS } from '../core/level/level-data';
import { TILE_CHUNK_PREFIX, TILE_MAP_NODE } from './level-view';

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

/**
 * Every tile chunk is at most one screen; using that half extent for all of them is correct
 * (chunks tile the room contiguously) and only over-includes the smaller chunks at the edges.
 */
const CHUNK_HALF_COLS = ROOM_COLS / 2;
const CHUNK_HALF_ROWS = ROOM_ROWS / 2;

/**
 * Toggle the room's static sprites and tile chunks by whether they intersect `view` + margin.
 * Returns how many leaves are currently hidden (debug/measurement only).
 */
export function cullWorld(root: Node | null, view: CullRect, marginTiles = CULL_MARGIN_TILES): number {
  if (root === null || !root.isValid) return 0;
  return cullChildren(root, view, marginTiles);
}

/**
 * Prop bases/overlays and grass tips live on the shared actor/overlay layers since #36, so the
 * room-tree walk above cannot reach them: the room owner hands them here. `active` is safe for a
 * prop (it is static art, unlike an actor node whose flag gameplay reads).
 */
export function cullNodesOutside(
  nodes: Iterable<Node>,
  view: CullRect,
  marginTiles = CULL_MARGIN_TILES,
): number {
  let hidden = 0;
  for (const node of nodes) {
    if (!node.isValid) continue;
    const position = node.position;
    const visible = intersects(position.x, position.y, 0, 0, view, marginTiles);
    if (node.active !== visible) node.active = visible;
    if (!visible) hidden += 1;
  }
  return hidden;
}

/**
 * Whether a point in **world units** (bottom-left origin, y up) is inside `view` + margin — what
 * the actor cull uses for enemy sprites before toggling `Sprite.enabled`.
 */
export function pointInCullRect(
  x: number,
  y: number,
  view: CullRect,
  marginTiles = CULL_MARGIN_TILES,
): boolean {
  return intersects(x, y, 0, 0, view, marginTiles);
}

function cullChildren(node: Node, view: CullRect, margin: number): number {
  let hidden = 0;
  for (const child of node.children) {
    if (!child.isValid) continue;

    if (child.name === TILE_MAP_NODE) {
      hidden += cullChunks(child, view, margin);
      continue;
    }

    if (child.children.length > 0) {
      hidden += cullChildren(child, view, margin);
      continue;
    }

    const position = child.position;
    const visible = intersects(
      position.x,
      position.y,
      0,
      0,
      view,
      margin,
    );
    if (child.active !== visible) child.active = visible;
    if (!visible) hidden += 1;
  }
  return hidden;
}

/** One chunk node per 32×18 screen; compare its full tile extent, not just its centre. */
function cullChunks(group: Node, view: CullRect, margin: number): number {
  let hidden = 0;
  for (const chunk of group.children) {
    if (!chunk.isValid || !chunk.name.startsWith(TILE_CHUNK_PREFIX)) continue;

    const position = chunk.position;
    const visible = intersects(
      position.x,
      position.y,
      CHUNK_HALF_COLS,
      CHUNK_HALF_ROWS,
      view,
      margin,
    );
    if (chunk.active !== visible) chunk.active = visible;
    if (!visible) hidden += 1;
  }
  return hidden;
}

/** A point (or an axis-aligned box around it) intersects the view grown by `margin`. */
function intersects(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  view: CullRect,
  margin: number,
): boolean {
  return (
    x + halfWidth >= view.x - margin &&
    x - halfWidth <= view.x + view.width + margin &&
    y + halfHeight >= view.y - margin &&
    y - halfHeight <= view.y + view.height + margin
  );
}
