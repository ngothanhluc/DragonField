/**
 * Follow camera for rooms larger than one screen (M9, ticket #37, ADR-018).
 *
 * The camera keeps a box deadzone around the player, aims slightly ahead along the player's
 * velocity, smooths the centre with frame-rate independent easing (`1 - exp(-rate · dt)`) and
 * clamps the **view** (not the centre) to the room, so no black band ever shows past the edge.
 * A room that is exactly one view keeps today's static centre.
 *
 * The state kept here is the **unsnapped** centre; `position` snaps to whole texels, so sprite
 * edges stay on the pixel grid. Screen shake is added by the adapter on top and never fed back.
 */
import type { Vec2 } from '../math/vec2';

/** One world texel in tiles (16 px tiles): the camera snaps to whole texels. */
export const TEXEL_TILES = 1 / 16;

export interface Size {
  readonly cols: number;
  readonly rows: number;
}

export interface FollowCameraTuning {
  /** Half extents of the box deadzone around the focus, tiles. */
  readonly deadzoneHalfTiles: Vec2;
  /** How far ahead of the player's motion the camera aims, tiles. */
  readonly lookAheadTiles: number;
  /** Exponential smoothing rate (1/s) used as `1 - exp(-rate * dt)`. */
  readonly followRate: number;
  /** Smoothing rate of the look-ahead offset (1/s), so direction flips do not whip. */
  readonly lookAheadRate: number;
}

export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Easing factor for one frame: exact for any `dt`, so 30 and 144 fps feel the same. */
function ease(rate: number, dtSeconds: number): number {
  if (!(rate > 0) || !(dtSeconds > 0)) return 0;
  return 1 - Math.exp(-rate * dtSeconds);
}

/** Snap one tile value to the texel grid (rounding, not truncating, so it stays centred). */
function snapTexel(value: number): number {
  return Math.round(value / TEXEL_TILES) * TEXEL_TILES;
}

export class FollowCamera {
  /** Smoothed, **unsnapped** centre (room tile units, y down). */
  private centre: Vec2;
  /** Eased look-ahead offset (tiles), so a direction flip does not whip the camera. */
  private lookAhead: Vec2 = { x: 0, y: 0 };

  constructor(
    readonly room: Size,
    readonly view: Size,
    readonly tuning: FollowCameraTuning,
  ) {
    this.centre = { x: view.cols / 2, y: view.rows / 2 };
  }

  /** Hard cut (room entry, respawn): centre on `target` clamped to the room, no smoothing. */
  reset(target: Vec2): Vec2 {
    this.lookAhead = { x: 0, y: 0 };
    this.centre = this.clampCentre(target);
    return this.position;
  }

  /**
   * One frame: deadzone + eased look-ahead + exponential smoothing, view clamped to the room,
   * snapped to whole texels **after** smoothing. `velocity` is the player's, tiles/s.
   * Returns the new camera centre (room tile units, y down).
   */
  update(target: Vec2, velocity: Vec2, dtSeconds: number): Vec2 {
    const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;

    // Look-ahead: aim along the direction of travel, eased so a 180° turn sweeps instead of snapping.
    const speed = Math.hypot(velocity.x, velocity.y);
    const wantedAhead: Vec2 =
      speed > 1e-9 && Number.isFinite(speed)
        ? {
            x: (velocity.x / speed) * this.tuning.lookAheadTiles,
            y: (velocity.y / speed) * this.tuning.lookAheadTiles,
          }
        : { x: 0, y: 0 };
    const ahead = ease(this.tuning.lookAheadRate, dt);
    this.lookAhead = {
      x: this.lookAhead.x + (wantedAhead.x - this.lookAhead.x) * ahead,
      y: this.lookAhead.y + (wantedAhead.y - this.lookAhead.y) * ahead,
    };

    // Deadzone: only the part of the aim point that leaves the box moves the desired centre.
    const aim = { x: target.x + this.lookAhead.x, y: target.y + this.lookAhead.y };
    const desired = {
      x: this.outsideDeadzone(this.centre.x, aim.x, this.tuning.deadzoneHalfTiles.x),
      y: this.outsideDeadzone(this.centre.y, aim.y, this.tuning.deadzoneHalfTiles.y),
    };

    // Frame-rate independent smoothing toward that desired centre; the state stays unsnapped.
    const follow = ease(this.tuning.followRate, dt);
    this.centre = {
      x: this.centre.x + (desired.x - this.centre.x) * follow,
      y: this.centre.y + (desired.y - this.centre.y) * follow,
    };
    this.centre = this.clampCentre(this.centre);

    return this.position;
  }

  /** Current camera centre, texel-aligned. Screen shake is added by the caller, never stored. */
  get position(): Vec2 {
    return { x: snapTexel(this.centre.x), y: snapTexel(this.centre.y) };
  }

  /** The visible rectangle (top-left + size), tiles. */
  viewRect(): ViewRect {
    const centre = this.position;
    return {
      x: centre.x - this.view.cols / 2,
      y: centre.y - this.view.rows / 2,
      width: this.view.cols,
      height: this.view.rows,
    };
  }

  /** Move `current` only as far as needed so `aim` sits inside the deadzone box. */
  private outsideDeadzone(current: number, aim: number, halfExtent: number): number {
    const offset = aim - current;
    if (offset > halfExtent) return aim - halfExtent;
    if (offset < -halfExtent) return aim + halfExtent;
    return current;
  }

  /**
   * Clamp the **view** to the room: the centre stays `half a view` from each edge. On an axis
   * where the room is not larger than the view this pins the centre, which is exactly today's
   * static camera for a single-screen room.
   */
  private clampCentre(point: Vec2): Vec2 {
    const halfCols = this.view.cols / 2;
    const halfRows = this.view.rows / 2;
    const minX = halfCols;
    const maxX = Math.max(minX, this.room.cols - halfCols);
    const minY = halfRows;
    const maxY = Math.max(minY, this.room.rows - halfRows);
    return {
      x: Math.min(Math.max(point.x, minX), maxX),
      y: Math.min(Math.max(point.y, minY), maxY),
    };
  }
}
