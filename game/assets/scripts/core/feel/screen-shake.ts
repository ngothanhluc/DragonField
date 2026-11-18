/**
 * Trauma-based screen shake (ticket #2).
 * Contract: see tests/core/juice.test.ts.
 */
import type { Vec2 } from '../math/vec2';

/** 1 texel of the pack = 1/16 tile (ACTOR_SCALE). Shake offset is always a multiple of this. */
export const TEXEL_TILES = 1 / 16;

export interface ScreenShakeOptions {
  /** Maximum amplitude (tiles) when trauma = 1. */
  readonly maxOffsetTiles: number;
  /** How much trauma decays per second (linear). */
  readonly decayPerSecond: number;
}

const ZERO: Vec2 = { x: 0, y: 0 };

export class ScreenShake {
  /** When off (Screen shake = OFF setting) the offset is always 0. */
  enabled = true;

  private traumaValue = 0;

  constructor(
    readonly options: ScreenShakeOptions,
    private readonly random: () => number,
  ) {}

  get trauma(): number {
    return this.traumaValue;
  }

  addTrauma(amount: number): void {
    if (!Number.isFinite(amount)) return;
    // Add only: a hit never "soothes" existing shake (acceptance test).
    const added = Math.max(0, amount);
    this.traumaValue = clamp(this.traumaValue + added, 0, 1);
  }

  /** Real time (ms): shake still decays during hitstop, so it never freezes off-centre. */
  update(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    const decayed = (this.options.decayPerSecond * deltaMs) / 1000;
    this.traumaValue = Math.max(0, this.traumaValue - decayed);
  }

  /**
   * Offset for this frame: `trunc(max · trauma² · (2r − 1) / texel) · texel`.
   *
   * Rounded to an integer multiple of 1 texel, so the camera only moves by pixel-art pixels —
   * no half-texel interpolation blurring sprites. Calls `random()` for the x axis then y.
   */
  offset(): Vec2 {
    if (!this.enabled || this.traumaValue <= 0) return { ...ZERO };

    const shake = this.options.maxOffsetTiles * this.traumaValue * this.traumaValue;
    const axis = (roll: number): number => {
      const texels = Math.trunc((shake * (2 * roll - 1)) / TEXEL_TILES);
      return texels * TEXEL_TILES;
    };

    return { x: axis(this.random()), y: axis(this.random()) };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
