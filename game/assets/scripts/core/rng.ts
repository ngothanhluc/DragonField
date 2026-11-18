/**
 * Deterministic RNG for everything random in a run (skill rolls, loot, …).
 *
 * Never use `Math.random()` anywhere in `core/`: tests need the same seed to give
 * the same result, and save/replay must be reproducible. The game's only source
 * of randomness is the `SeededRng` instance created from the run seed.
 *
 * Algorithm: **mulberry32** (Tommy Ettinger) — a single 32-bit register:
 *
 * ```text
 * state = (state + 0x6D2B79F5) | 0
 * t     = state
 * t     = imul(t ^ (t >>> 15), t | 1)
 * t     = t ^ (t + imul(t ^ (t >>> 7), t | 61))
 * out   = ((t ^ (t >>> 14)) >>> 0) / 2^32
 * ```
 *
 * Period 2^32, far more quality than picking 1 of 20 skills needs; in exchange it
 * needs only 4 bytes of state, so serializing and restoring a run is cheap.
 */
export class SeededRng {
  /** 32-bit state; every assignment goes through `| 0` to keep the int32 type. */
  private state: number;

  constructor(seed: number) {
    this.state = normalizeSeed(seed);
  }

  static fromSeed(seed: number): SeededRng {
    return new SeededRng(seed);
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`SeededRng.int needs maxExclusive to be an integer > 0, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  /** Random element; throws on an empty array (no implicit "undefined"). */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('SeededRng.pick needs a non-empty array');
    }

    const chosen = items[this.int(items.length)];
    // Check is only here to satisfy `noUncheckedIndexedAccess`; int() always returns a valid index.
    if (chosen === undefined) {
      throw new Error('SeededRng.pick: index out of array bounds');
    }
    return chosen;
  }

  /**
   * Pick an index by weight (roulette). Weight 0 = never picked.
   *
   * Throws on an empty array, negative/NaN weight, or a total weight of 0 —
   * silently returning 0 in those cases would hide a config bug.
   */
  weightedIndex(weights: readonly number[]): number {
    if (weights.length === 0) {
      throw new Error('SeededRng.weightedIndex needs at least 1 weight');
    }

    let total = 0;
    for (const weight of weights) {
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`SeededRng.weightedIndex got an invalid weight: ${weight}`);
      }
      total += weight;
    }

    if (total <= 0) {
      throw new Error('SeededRng.weightedIndex: total weight must be > 0');
    }

    // Multiply by total instead of dividing each weight: avoids accumulating rounding error.
    const roll = this.next() * total;

    let cumulative = 0;
    let lastPositive = 0;
    for (let i = 0; i < weights.length; i += 1) {
      const weight = weights[i] ?? 0;
      if (weight > 0) lastPositive = i;
      cumulative += weight;
      if (roll < cumulative) return i;
    }

    // Only reached when floating-point error pushes roll past the total; return the last weighted slot.
    return lastPositive;
  }
}

/** Coerce the seed to uint32 so seeds differing in sign/fraction still stay stable. */
function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new Error(`SeededRng needs a finite seed, got ${seed}`);
  }
  return Math.trunc(seed) >>> 0;
}
