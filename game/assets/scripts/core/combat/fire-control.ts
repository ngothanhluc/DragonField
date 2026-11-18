/**
 * Fire rate. `tick` is called each frame with delta ms; returns true when that frame fires.
 *
 * The remainder is kept (no hard reset), so the fire rate does not drift when frame time
 * changes — important because the game runs on the web with unstable frame times.
 */
export class FireControl {
  private remainingMs = 0;

  constructor(readonly intervalMs: number) {
    if (intervalMs <= 0) {
      throw new Error(`FireControl needs intervalMs > 0, got ${intervalMs}`);
    }
  }

  static fromRate(fireRatePerSecond: number): FireControl {
    return new FireControl(1000 / fireRatePerSecond);
  }

  tick(deltaMs: number): boolean {
    this.remainingMs -= deltaMs;
    if (this.remainingMs > 0) return false;

    this.remainingMs += this.intervalMs;
    return true;
  }

  /** Reset so the next shot happens immediately. */
  reset(): void {
    this.remainingMs = 0;
  }
}
