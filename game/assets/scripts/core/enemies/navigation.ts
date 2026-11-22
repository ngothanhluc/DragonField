/**
 * Enemy navigation (M9, ticket #34): nav grid, shared flow field toward the player, line of sight.
 *
 * STUB written with the red acceptance test: nothing is blocked, the field points straight at the
 * goal and every line of sight is clear. The executor replaces the bodies; the exported names and
 * signatures are the agreed seam.
 */
import type { LevelData } from '../level/level-data';
import type { Vec2 } from '../math/vec2';

/** Tile grid; a cell is blocked when a circle of the grid's radius at its centre overlaps an obstacle. */
export interface NavGrid {
  readonly cols: number;
  readonly rows: number;
  isBlocked(col: number, row: number): boolean;
}

/** Shortest-path distances (tiles) from every cell to the goal cell, 8-way, no corner cutting. */
export interface FlowField {
  readonly grid: NavGrid;
  /** Path distance in tiles from the cell to the goal; `Infinity` when unreachable or blocked. */
  distanceAt(col: number, row: number): number;
  /** Unit direction to walk from `position` toward the goal; `null` at the goal or when unreachable. */
  directionAt(position: Vec2): Vec2 | null;
}

export function buildNavGrid(level: LevelData, radiusTiles: number, marginTiles: number): NavGrid {
  void radiusTiles;
  void marginTiles;
  return { cols: level.size.cols, rows: level.size.rows, isBlocked: () => false };
}

export function buildFlowField(grid: NavGrid, goal: Vec2): FlowField {
  return {
    grid,
    distanceAt: (col, row) => Math.hypot(col + 0.5 - goal.x, row + 0.5 - goal.y),
    directionAt: (position) => {
      const dx = goal.x - position.x;
      const dy = goal.y - position.y;
      const length = Math.hypot(dx, dy);
      return length < 1e-9 ? null : { x: dx / length, y: dy / length };
    },
  };
}

/** True when the straight segment from `from` to `to` crosses no pillar or wall (pits do not block sight). */
export function hasLineOfSight(level: LevelData, from: Vec2, to: Vec2): boolean {
  void level;
  void from;
  void to;
  return true;
}

/**
 * Keeps one flow field toward the player and rebuilds it only when the player changes tile and at
 * least `minRebuildMs` has passed since the last rebuild.
 */
export class FlowFieldCache {
  private builds = 0;
  private current: FlowField | null = null;

  constructor(
    private readonly grid: NavGrid,
    private readonly minRebuildMs: number,
  ) {}

  /** Returns the current field, rebuilding it when the rule above allows. */
  update(player: Vec2, nowMs: number): FlowField {
    void nowMs;
    this.builds += 1;
    this.current = buildFlowField(this.grid, player);
    return this.current;
  }

  /** How many times the field has been built (tests and the debug overlay read it). */
  get rebuildCount(): number {
    return this.builds;
  }
}
