import type { CombatConfig } from '../config';

export interface DamageResult {
  /** false when the hit is ignored (i-frame active or already dead). */
  readonly applied: boolean;
  /** Remaining HP after the hit (M17 100 HP scale). */
  readonly hp: number;
  /** Legacy alias for `hp` (preserved for existing callers/tests). */
  readonly hearts: number;
  readonly dead: boolean;
}

/** Config accepted by `HealthState`: M17 `playerBaseMaxHp` or legacy `playerMaxHearts`. */
export type HealthStateConfig = Pick<CombatConfig, 'invulnerabilityMs'> &
  (
    | { readonly playerBaseMaxHp: number; readonly playerMaxHearts?: number }
    | { readonly playerBaseMaxHp?: number; readonly playerMaxHearts: number }
  );

function resolveInitialMaxHp(config: HealthStateConfig): number {
  const raw = config.playerBaseMaxHp ?? config.playerMaxHearts ?? 100;
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/** Player health + i-frame. Knows nothing about the engine; time is passed in from outside. */
export class HealthState {
  private hp: number;
  private maxHp: number;
  private invulnerabilityMs: number;
  private invulnerableUntilMs = Number.NEGATIVE_INFINITY;

  constructor(config: HealthStateConfig, hp?: number) {
    this.maxHp = resolveInitialMaxHp(config);
    this.invulnerabilityMs = config.invulnerabilityMs;
    const initial = hp ?? this.maxHp;
    this.hp = Math.max(0, Math.min(Math.floor(initial), this.maxHp));
  }

  get current(): number {
    return this.hp;
  }

  get max(): number {
    return this.maxHp;
  }

  get isDead(): boolean {
    return this.hp <= 0;
  }

  /**
   * Change the health cap and i-frame duration mid-run (Vitality / Long i-frame).
   *
   * Lowering the cap (broken save, debug) also clamps current health; never heals on its own —
   * Vitality's immediate heal is the run's job (`heal`).
   */
  configure(maxHp: number, invulnerabilityMs: number): void {
    if (!Number.isFinite(maxHp) || maxHp < 1) return;
    if (!Number.isFinite(invulnerabilityMs) || invulnerabilityMs < 0) return;
    this.maxHp = Math.floor(maxHp);
    this.invulnerabilityMs = invulnerabilityMs;
    this.hp = Math.min(this.hp, this.maxHp);
  }

  isInvulnerable(nowMs: number): boolean {
    return nowMs < this.invulnerableUntilMs;
  }

  /**
   * Grant temporary invulnerability without dealing damage (e.g. M12 level-up resume safety).
   * Preserves any longer existing i-frame window so an active hit i-frame is never shortened.
   */
  grantInvulnerability(nowMs: number, durationMs: number): void {
    if (
      this.isDead ||
      !Number.isFinite(nowMs) ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    ) {
      return;
    }
    this.invulnerableUntilMs = Math.max(this.invulnerableUntilMs, nowMs + durationMs);
  }

  /** Remaining i-frame duration at `nowMs` in milliseconds (`0` when vulnerable or dead). */
  remainingInvulnerabilityMs(nowMs: number): number {
    if (this.isDead || !Number.isFinite(nowMs)) return 0;
    return Math.max(0, this.invulnerableUntilMs - nowMs);
  }

  tryDamage(amount: number, nowMs: number): DamageResult {
    if (this.isDead || this.isInvulnerable(nowMs)) {
      return { applied: false, hp: this.hp, hearts: this.hp, dead: this.isDead };
    }

    const damage = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
    this.hp = Math.max(0, this.hp - damage);
    this.invulnerableUntilMs = nowMs + this.invulnerabilityMs;

    return { applied: true, hp: this.hp, hearts: this.hp, dead: this.isDead };
  }

  heal(amount: number): number {
    if (this.isDead) return this.hp;

    const add = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
    this.hp = Math.min(this.maxHp, this.hp + add);
    return this.hp;
  }

  /**
   * Directly set current HP clamped into `[0, max]` (used by M15 run resume and debug
   * death trigger without triggering hit SFX or i-frames).
   */
  setHp(hp: number): number {
    if (!Number.isFinite(hp)) return this.hp;
    this.hp = Math.min(this.maxHp, Math.max(0, Math.floor(hp)));
    return this.hp;
  }

  /** Legacy alias for `setHp`. */
  setHearts(hearts: number): number {
    return this.setHp(hearts);
  }
}
