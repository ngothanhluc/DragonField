/**
 * Combat numbers. This is the only source; never hardcode numbers in a component.
 * See docs/gdd.md §3.
 *
 * The real numbers live in `game/config/tuning.json`, which `scripts/gen-tuning.ts`
 * compiles into `enemies/tuning.generated.ts` and `enemies/tuning.ts` validates;
 * this file only keeps **names + types** so the rest of the code imports a stable
 * interface. Changing balance = edit the JSON + `bun run gen`, not this file.
 */
import { COMBAT_TUNING } from './enemies/tuning';

export interface CombatConfig {
  /** Shots per second in the base state. */
  readonly fireRatePerSecond: number;
  /** Projectile speed, in tiles/second (1 tile = 16 px). */
  readonly projectileSpeedTilesPerSecond: number;
  /** Damage per base projectile. */
  readonly damage: number;
  /** Projectiles per shot in the base state. */
  readonly projectiles: number;
  /** Base movement speed, tiles/second. */
  readonly moveSpeedTilesPerSecond: number;
  /** Out-of-combat room-clear movement speed multiplier (M17: 1.45 = +45%). */
  readonly roomClearSpeedMultiplier: number;
  /** Player's base maximum HP (M17 RPG 100 HP scale, ADR-025). */
  readonly playerBaseMaxHp: number;
  /** Invulnerability time after taking a hit, ms. */
  readonly invulnerabilityMs: number;
  /** Damage when an enemy touches the player. */
  readonly contactDamage: number;
  /** Auto-aim range, in tiles. */
  readonly targetingRangeTiles: number;
  /** Player knockback distance when hit, tiles. */
  readonly playerKnockbackDistanceTiles: number;
  /** Time to travel the full player knockback distance, ms. */
  readonly playerKnockbackDurationMs: number;
  /** Enemy knockback distance when hit by a projectile, tiles. */
  readonly enemyKnockbackDistanceTiles: number;
  /** Time to travel the full enemy knockback distance, ms. */
  readonly enemyKnockbackDurationMs: number;
  /** Global hitstop when a player projectile hits an enemy, ms (ADR-008: 70). */
  readonly enemyHitstopMs: number;
  /** Time an enemy stands still after being hit by a projectile, ms (ADR-008: 150). */
  readonly enemyStaggerMs: number;
}

/** Base combat numbers, read from `config/tuning.json` (never duplicate the numbers). */
export const DEFAULT_COMBAT: CombatConfig = COMBAT_TUNING;
