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
   * Đổi trần máu và thời gian i-frame giữa run (Vitality / Long i-frame).
   *
   * Giảm trần (save hỏng, debug) kẹp luôn máu hiện tại; không tự hồi máu —
   * hiệu ứng "hồi 1 tim ngay" của Vitality là việc của run (`heal`).
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
