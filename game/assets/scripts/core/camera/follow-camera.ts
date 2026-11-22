/**
 * Follow camera for rooms larger than one screen (M9, ticket #37, ADR-018).
 *
 * STUB written with the red acceptance test: it stays at the view's centre. The executor replaces
 * the bodies; the exported names and signatures are the agreed seam.
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

export class FollowCamera {
  private centre: Vec2;

  constructor(
    readonly room: Size,
    readonly view: Size,
    readonly tuning: FollowCameraTuning,
  ) {
    this.centre = { x: view.cols / 2, y: view.rows / 2 };
  }

  /** Hard cut (room entry, respawn): centre on `target` clamped to the room, no smoothing. */
  reset(target: Vec2): Vec2 {
    void target;
    return this.position;
  }

  /**
   * One frame: deadzone + eased look-ahead + exponential smoothing, view clamped to the room,
   * snapped to whole texels **after** smoothing. `velocity` is the player's, tiles/s.
   * Returns the new camera centre (room tile units, y down).
   */
  update(target: Vec2, velocity: Vec2, dtSeconds: number): Vec2 {
    void target;
    void velocity;
    void dtSeconds;
    return this.position;
  }

  /** Current camera centre, texel-aligned. Screen shake is added by the caller, never stored. */
  get position(): Vec2 {
    return { x: this.centre.x, y: this.centre.y };
  }

  /** The visible rectangle (top-left + size), tiles. */
  viewRect(): ViewRect {
    return {
      x: this.centre.x - this.view.cols / 2,
      y: this.centre.y - this.view.rows / 2,
      width: this.view.cols,
      height: this.view.rows,
    };
  }
}
