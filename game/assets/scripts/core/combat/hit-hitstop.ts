/**
 * Which player hit deserves a hitstop beat, and how long (#108).
 *
 * The adapter used to ask for a freeze on every bullet hit, and it decided "crit" by comparing
 * `bullet.damage` against `stats.damage * 1.01`. A Signature Active bullet is spawned at
 * `stats.damage × damageMultiplier`, so **every** blade of a volley read as a crit: a 10-blade
 * Shadow Barrage requested ten 110 ms freezes in the same frames and the game stuttered.
 *
 * The rule now:
 * - **Normal shots** keep the old behaviour: a hit freezes for `normalMs`, a real crit for
 *   `critMs`. "Real crit" means the bullet's damage is above **its own** base damage, i.e. the
 *   crit multiplier was rolled into it at fire time.
 * - **Signature Active** projectiles stop the game **once per cast** (first blade that lands),
 *   then never again for the rest of that volley — one clean beat instead of a chain of freezes.
 *
 * Pure arithmetic + a small set of cast ids; no `cc`, no clock.
 */

export interface HitstopDurations {
  /** Freeze for an ordinary hit, milliseconds. */
  readonly normalMs: number;
  /** Freeze for a real crit, milliseconds. */
  readonly critMs: number;
}

/** Relative tolerance so float noise (`12.000000001`) never turns a hit into a "crit". */
const CRIT_EPSILON = 0.01;

/** true when the bullet's damage is above its own base damage (crit multiplied at fire time). */
export function isRealCrit(damage: number, baseDamage: number): boolean {
  const dealt = Number.isFinite(damage) ? damage : 0;
  const base = Number.isFinite(baseDamage) ? Math.max(0, baseDamage) : 0;
  return dealt > base * (1 + CRIT_EPSILON);
}

export interface PlayerHit {
  /** Bullet damage as fired (crit already applied). */
  readonly damage: number;
  /** That bullet's own pre-crit damage. */
  readonly baseDamage: number;
  /** `null` = not a Signature projectile; otherwise one id per `castSignature` call. */
  readonly signatureCastId: number | null;
}

/**
 * Cast ids are monotonic, so keeping only the most recent ones is enough: a blade that is
 * still flying belongs to a recent cast, and an evicted id can no longer be hit.
 */
const MAX_TRACKED_CASTS = 16;

export class PlayerHitHitstop {
  private readonly stoppedCasts = new Set<number>();

  constructor(private readonly durations: HitstopDurations) {}

  /** ms to request from HitstopClock; 0 = request nothing. */
  hitstopFor(hit: PlayerHit): number {
    const ms = isRealCrit(hit.damage, hit.baseDamage)
      ? this.durations.critMs
      : this.durations.normalMs;

    const castId = hit.signatureCastId;
    if (castId === null) return ms;
    if (this.stoppedCasts.has(castId)) return 0;

    this.stoppedCasts.add(castId);
    if (this.stoppedCasts.size > MAX_TRACKED_CASTS) {
      // `Set` iterates in insertion order: drop the oldest casts first.
      for (const id of this.stoppedCasts) {
        this.stoppedCasts.delete(id);
        if (this.stoppedCasts.size <= MAX_TRACKED_CASTS) break;
      }
    }
    return ms;
  }

  /** forget which casts already stopped (room change / back to menu). */
  reset(): void {
    this.stoppedCasts.clear();
  }
}
