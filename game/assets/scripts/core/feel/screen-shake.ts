/**
 * Screen shake kiểu trauma (ticket #2). Stub — executor implement.
 * Hợp đồng: xem tests/core/juice.test.ts.
 */
import type { Vec2 } from '../math/vec2';

/** 1 texel của pack = 1/16 tile (ACTOR_SCALE). Offset shake luôn là bội số của số này. */
export const TEXEL_TILES = 1 / 16;

export interface ScreenShakeOptions {
  /** Biên độ tối đa (tile) khi trauma = 1. */
  readonly maxOffsetTiles: number;
  /** Trauma giảm bao nhiêu mỗi giây (tuyến tính). */
  readonly decayPerSecond: number;
}

export class ScreenShake {
  /** Tắt (setting Screen shake = OFF) thì offset luôn 0. */
  enabled = true;

  constructor(
    readonly options: ScreenShakeOptions,
    private readonly random: () => number,
  ) {}

  get trauma(): number {
    throw new Error('chưa implement');
  }

  addTrauma(_amount: number): void {
    throw new Error('chưa implement');
  }

  update(_deltaMs: number): void {
    throw new Error('chưa implement');
  }

  offset(): Vec2 {
    throw new Error('chưa implement');
  }
}
