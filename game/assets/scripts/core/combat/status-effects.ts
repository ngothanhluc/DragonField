/**
 * Negative status on an enemy: Freeze (slow) and Poison (damage over time).
 *
 * Small mutable state, one instance per enemy. All timing rules live here so
 * the adapter only calls `apply`, `speedMultiplier`, `poisonDamage` each frame —
 * never counting time in three different places.
 *
 * Numbers come from `DerivedStats.slowOnHit` / `poisonOnHit`, i.e. stacks already included
 * (2 Poison = 2 dps; 2 Freeze = 40% slower for 2 s).
 */
import type { DerivedStats, PoisonOnHit, SlowOnHit } from '../skills/derived-stats';

/** Below this threshold the effect counts as expired. */
const EPSILON_MS = 1e-6;

export class StatusEffects {
  private slowUntilMs = Number.NEGATIVE_INFINITY;
  private slowFactor = 1;
  private poisonUntilMs = Number.NEGATIVE_INFINITY;
  private poisonDps = 0;

  /** Apply a new slow/poison. The stronger effect wins, and durations do not stack without bound. */
  apply(
    stats: Pick<DerivedStats, 'slowOnHit' | 'poisonOnHit'>,
    nowMs: number,
  ): void {
    if (stats.slowOnHit !== undefined) this.applySlow(stats.slowOnHit, nowMs);
    if (stats.poisonOnHit !== undefined) this.applyPoison(stats.poisonOnHit, nowMs);
  }

  applySlow(slow: SlowOnHit, nowMs: number): void {
    if (!(slow.durationMs > 0)) return;
    const factor = Math.max(0, Math.min(1, slow.factor));
    // At the same time: take the strongest factor, extend to the latest deadline.
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowUntilMs = Math.max(this.slowUntilMs, nowMs + slow.durationMs);
  }

  applyPoison(poison: PoisonOnHit, nowMs: number): void {
    if (!(poison.durationMs > 0) || !(poison.dps > 0)) return;
    this.poisonDps = Math.max(this.poisonDps, poison.dps);
    this.poisonUntilMs = Math.max(this.poisonUntilMs, nowMs + poison.durationMs);
  }

  /** Current speed factor: 1 = normal, 0.6 = 40% slower. */
  speedMultiplier(nowMs: number): number {
    if (nowMs >= this.slowUntilMs - EPSILON_MS) return 1;
    return this.slowFactor;
  }

  isSlowed(nowMs: number): boolean {
    return this.speedMultiplier(nowMs) < 1;
  }

  isPoisoned(nowMs: number): boolean {
    return nowMs < this.poisonUntilMs - EPSILON_MS && this.poisonDps > 0;
  }

  /**
   * Poison damage within the elapsed `deltaMs`. Never exceeds the remaining time —
   * a long frame must not "eat" extra poison after the effect has ended.
   */
  poisonDamage(nowMs: number, deltaMs: number): number {
    if (!(deltaMs > 0) || this.poisonDps <= 0) return 0;
    const endMs = Math.min(nowMs + deltaMs, this.poisonUntilMs);
    const activeMs = Math.max(0, endMs - nowMs);
    return (this.poisonDps * activeMs) / 1000;
  }

  /** Clear everything when an enemy respawns / changes room. */
  clear(): void {
    this.slowUntilMs = Number.NEGATIVE_INFINITY;
    this.slowFactor = 1;
    this.poisonUntilMs = Number.NEGATIVE_INFINITY;
    this.poisonDps = 0;
  }
}
