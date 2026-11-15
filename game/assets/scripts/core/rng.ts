/**
 * RNG tất định cho mọi thứ ngẫu nhiên trong run (roll skill, loot, …).
 *
 * Không dùng `Math.random()` ở bất kỳ đâu trong `core/`: test cần cùng seed cho
 * cùng kết quả, và save/replay cần tái lập được. Nguồn ngẫu nhiên duy nhất của
 * game là instance `SeededRng` được tạo từ seed của run.
 *
 * Thuật toán: **mulberry32** (Tommy Ettinger) — một thanh ghi 32-bit:
 *
 * ```text
 * state = (state + 0x6D2B79F5) | 0
 * t     = state
 * t     = imul(t ^ (t >>> 15), t | 1)
 * t     = t ^ (t + imul(t ^ (t >>> 7), t | 61))
 * out   = ((t ^ (t >>> 14)) >>> 0) / 2^32
 * ```
 *
 * Chu kỳ 2^32, chất lượng thừa cho việc chọn 1 trong 20 skill; đổi lại nó chỉ
 * cần 4 byte trạng thái nên serialize/khôi phục run rất rẻ.
 */
export class SeededRng {
  /** Trạng thái 32-bit; mọi phép gán đều đi qua `| 0` để giữ kiểu int32. */
  private state: number;

  constructor(seed: number) {
    this.state = normalizeSeed(seed);
  }

  static fromSeed(seed: number): SeededRng {
    return new SeededRng(seed);
  }

  /** Số thực trong [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Số nguyên trong [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`SeededRng.int cần maxExclusive là số nguyên > 0, nhận ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  /** Phần tử ngẫu nhiên; ném lỗi khi mảng rỗng (không có "undefined" ngầm). */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('SeededRng.pick cần mảng không rỗng');
    }

    const chosen = items[this.int(items.length)];
    // Kiểm tra chỉ để thoả `noUncheckedIndexedAccess`; int() luôn trả về chỉ số hợp lệ.
    if (chosen === undefined) {
      throw new Error('SeededRng.pick: chỉ số ngoài mảng');
    }
    return chosen;
  }

  /**
   * Chọn chỉ số theo trọng số (roulette). Trọng số 0 = không bao giờ được chọn.
   *
   * Ném lỗi khi mảng rỗng, có trọng số âm/NaN, hoặc tổng trọng số bằng 0 —
   * im lặng trả về 0 trong các trường hợp đó sẽ che mất bug cấu hình.
   */
  weightedIndex(weights: readonly number[]): number {
    if (weights.length === 0) {
      throw new Error('SeededRng.weightedIndex cần ít nhất 1 trọng số');
    }

    let total = 0;
    for (const weight of weights) {
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`SeededRng.weightedIndex nhận trọng số không hợp lệ: ${weight}`);
      }
      total += weight;
    }

    if (total <= 0) {
      throw new Error('SeededRng.weightedIndex: tổng trọng số phải > 0');
    }

    // Nhân với total thay vì chia từng trọng số: tránh sai số cộng dồn.
    const roll = this.next() * total;

    let cumulative = 0;
    let lastPositive = 0;
    for (let i = 0; i < weights.length; i += 1) {
      const weight = weights[i] ?? 0;
      if (weight > 0) lastPositive = i;
      cumulative += weight;
      if (roll < cumulative) return i;
    }

    // Chỉ tới đây khi sai số dấu phẩy động đẩy roll vượt tổng; trả ô cuối có trọng số.
    return lastPositive;
  }
}

/** Ép seed về uint32 để hai seed khác nhau về dấu/thập phân vẫn ổn định. */
function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new Error(`SeededRng cần seed hữu hạn, nhận ${seed}`);
  }
  return Math.trunc(seed) >>> 0;
}
