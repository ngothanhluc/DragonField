import type { CombatConfig } from '../config';

export interface DamageResult {
  /** false when the hit is ignored (i-frame active or already dead). */
  readonly applied: boolean;
  readonly hearts: number;
  readonly dead: boolean;
}

/** Player health + i-frame. Knows nothing about the engine; time is passed in from outside. */
export class HealthState {
  private hearts: number;
  private maxHearts: number;
  private invulnerabilityMs: number;
  private invulnerableUntilMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly config: Pick<CombatConfig, 'playerMaxHearts' | 'invulnerabilityMs'>,
    hearts: number = config.playerMaxHearts,
  ) {
    this.maxHearts = config.playerMaxHearts;
    this.invulnerabilityMs = config.invulnerabilityMs;
    this.hearts = Math.min(hearts, this.maxHearts);
  }

  get current(): number {
    return this.hearts;
  }

  get max(): number {
    return this.maxHearts;
  }

  get isDead(): boolean {
    return this.hearts <= 0;
  }

  /**
   * Change the health cap and i-frame duration mid-run (Vitality / Long i-frame).
   *
   * Lowering the cap (broken save, debug) also clamps current health; never heals on its own —
   * Vitality's "heal 1 heart now" is the run's job (`heal`).
   */
  configure(maxHearts: number, invulnerabilityMs: number): void {
    if (!Number.isFinite(maxHearts) || maxHearts < 1) return;
    if (!Number.isFinite(invulnerabilityMs) || invulnerabilityMs < 0) return;
    this.maxHearts = Math.floor(maxHearts);
    this.invulnerabilityMs = invulnerabilityMs;
    this.hearts = Math.min(this.hearts, this.maxHearts);
  }

  isInvulnerable(nowMs: number): boolean {
    return nowMs < this.invulnerableUntilMs;
  }

  tryDamage(amount: number, nowMs: number): DamageResult {
    if (this.isDead || this.isInvulnerable(nowMs)) {
      return { applied: false, hearts: this.hearts, dead: this.isDead };
    }

    this.hearts = Math.max(0, this.hearts - amount);
    this.invulnerableUntilMs = nowMs + this.invulnerabilityMs;

    return { applied: true, hearts: this.hearts, dead: this.isDead };
  }

  heal(amount: number): number {
    if (this.isDead) return this.hearts;

    this.hearts = Math.min(this.maxHearts, this.hearts + Math.max(0, amount));
    return this.hearts;
  }
}
