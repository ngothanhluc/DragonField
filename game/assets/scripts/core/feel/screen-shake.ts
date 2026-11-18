/**
 * Screen shake kiểu trauma (ticket #2).
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

const ZERO: Vec2 = { x: 0, y: 0 };

export class ScreenShake {
  /** Tắt (setting Screen shake = OFF) thì offset luôn 0. */
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
    // Chỉ cộng: đòn trúng không bao giờ "làm dịu" rung đang có (test nghiệm thu).
    const added = Math.max(0, amount);
    this.traumaValue = clamp(this.traumaValue + added, 0, 1);
  }

  /** Thời gian thật (ms): shake vẫn tàn trong hitstop, không đứng hình lệch tâm. */
  update(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    const decayed = (this.options.decayPerSecond * deltaMs) / 1000;
    this.traumaValue = Math.max(0, this.traumaValue - decayed);
  }

  /**
   * Offset của frame này: `trunc(max · trauma² · (2r − 1) / texel) · texel`.
   *
   * Làm tròn về bội số nguyên 1 texel, nên camera chỉ nhích theo pixel art —
   * không nội suy nửa texel làm sprite nhoè. Gọi `random()` cho trục x rồi y.
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
