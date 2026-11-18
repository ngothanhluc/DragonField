/**
 * Hitstop: freeze the simulation for a short beat on a hit (ADR-008: 70 ms) so
 * the blow feels heavy without tuning anything inside combat.
 *
 * ## Design decision: freeze **simulation time**, not each system
 *
 * Everything in the game runs on **one** `nowMs` clock the adapter accumulates from
 * clamped `deltaMs` (telegraphs, i-frames, cooldowns, bullet TTL). So hitstop never
 * "switches off" any system individually: it returns `0` for a frozen frame, so `nowMs` **does not advance**
 * and every system ages at the same beat. A telegraph never keeps running while the
 * i-frame stands still — that is the kind of desync milestone M3 requires avoiding.
 *
 * Deliberate consequences:
 *
 * - **Real** time passes during hitstop, **simulation** time does not.
 *   A run lasts longer than the wall clock by exactly the total hitstop; balance is unaffected because
 *   everything is measured in `nowMs`.
 * - A real frame longer than the remaining hitstop is **not lost**: `step` returns the
 *   remainder so the simulation continues within that same frame.
 * - Multiple requests while frozen **do not stack** (two hits in a row would give 140 ms);
 *   the max is taken so hitstop is always "one beat".
 *
 * This file knows no engine and reads no clock: the caller passes real time.
 */
export class HitstopClock {
  private remainingMs = 0;

  constructor(readonly defaultDurationMs: number) {
    if (!Number.isFinite(defaultDurationMs) || defaultDurationMs < 0) {
      throw new Error(`HitstopClock needs a finite duration >= 0, got ${defaultDurationMs}`);
    }
  }

  /** Remaining freeze time, ms (0 = running normally). */
  get remaining(): number {
    return this.remainingMs;
  }

  get isFrozen(): boolean {
    return this.remainingMs > 0;
  }

  /**
   * Request a freeze. While frozen, take the **max** (no stacking); the parameter
   * defaults to `defaultDurationMs`.
   */
  request(durationMs: number = this.defaultDurationMs): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error(`HitstopClock.request needs finite ms >= 0, got ${durationMs}`);
    }
    if (durationMs > this.remainingMs) this.remainingMs = durationMs;
  }

  /**
   * Consume `realDeltaMs` of real time and return the **simulation time** that runs
   * in this frame (0 when the freeze just covered the whole frame).
   */
  step(realDeltaMs: number): number {
    if (!Number.isFinite(realDeltaMs) || realDeltaMs < 0) {
      throw new Error(`HitstopClock.step needs finite deltaMs >= 0, got ${realDeltaMs}`);
    }
    if (this.remainingMs <= 0) return realDeltaMs;

    const consumed = Math.min(this.remainingMs, realDeltaMs);
    this.remainingMs -= consumed;
    // Freeze for this whole frame; the next frame runs with the part not "eaten".
    return realDeltaMs - consumed;
  }

  /** Drop every pending freeze (room change, back to menu). */
  reset(): void {
    this.remainingMs = 0;
  }
}
