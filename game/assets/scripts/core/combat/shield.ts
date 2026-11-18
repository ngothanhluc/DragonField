/**
 * Shield skill (GDD §6): blocks N hits then recharges after 20 s.
 *
 * Model: each stack is one charge. When charges run out, **all** of them refill together
 * after `cooldownMs` from the last blocked hit. Simple, readable on the HUD, and
 * no per-charge counter is needed.
 *
 * No `cc` import, no `Date.now` read: the caller passes the run's `nowMs`.
 */
export class ShieldCharger {
  private ready = 0;
  private readyAtMs = Number.POSITIVE_INFINITY;

  constructor(
    readonly maxCharges: number,
    readonly cooldownMs: number,
  ) {
    if (!Number.isInteger(maxCharges) || maxCharges < 0) {
      throw new Error(`ShieldCharger needs maxCharges to be an integer >= 0, got ${maxCharges}`);
    }
    if (!(cooldownMs >= 0)) {
      throw new Error(`ShieldCharger needs cooldownMs >= 0, got ${cooldownMs}`);
    }
    this.ready = maxCharges;
  }

  get charges(): number {
    return this.ready;
  }

  get isFull(): boolean {
    return this.ready >= this.maxCharges;
  }

  /** Refill charges once the time is up. Call each frame; idempotent. */
  update(nowMs: number): void {
    if (this.ready >= this.maxCharges) return;
    if (nowMs >= this.readyAtMs) this.ready = this.maxCharges;
  }

  /**
   * Try to block one hit. Returns `true` when the hit is blocked (and spends one charge).
   * Spending the last charge starts the recharge clock.
   */
  tryBlock(nowMs: number): boolean {
    this.update(nowMs);
    if (this.ready <= 0) return false;

    this.ready -= 1;
    if (this.ready === 0) this.readyAtMs = nowMs + this.cooldownMs;
    return true;
  }

  /** Reset to full charges (room change / picking up another stack). */
  refill(): void {
    this.ready = this.maxCharges;
  }
}
