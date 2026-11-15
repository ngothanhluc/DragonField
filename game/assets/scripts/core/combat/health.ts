import type { CombatConfig } from '../config';

export interface DamageResult {
  /** false khi đòn bị bỏ qua (đang i-frame hoặc đã chết). */
  readonly applied: boolean;
  readonly hearts: number;
  readonly dead: boolean;
}

/** Máu + i-frame của player. Không biết gì về engine, thời gian truyền vào từ ngoài. */
export class HealthState {
  private hearts: number;
  private invulnerableUntilMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly config: Pick<CombatConfig, 'playerMaxHearts' | 'invulnerabilityMs'>,
    hearts: number = config.playerMaxHearts,
  ) {
    this.hearts = Math.min(hearts, config.playerMaxHearts);
  }

  get current(): number {
    return this.hearts;
  }

  get max(): number {
    return this.config.playerMaxHearts;
  }

  get isDead(): boolean {
    return this.hearts <= 0;
  }

  isInvulnerable(nowMs: number): boolean {
    return nowMs < this.invulnerableUntilMs;
  }

  tryDamage(amount: number, nowMs: number): DamageResult {
    if (this.isDead || this.isInvulnerable(nowMs)) {
      return { applied: false, hearts: this.hearts, dead: this.isDead };
    }

    this.hearts = Math.max(0, this.hearts - amount);
    this.invulnerableUntilMs = nowMs + this.config.invulnerabilityMs;

    return { applied: true, hearts: this.hearts, dead: this.isDead };
  }

  heal(amount: number): number {
    if (this.isDead) return this.hearts;

    this.hearts = Math.min(this.config.playerMaxHearts, this.hearts + amount);
    return this.hearts;
  }
}
