/**
 * Elite enemy "extra attacks" (M3) and the visual multipliers of the elite version.
 *
 * GDD §4 says elites only change health/damage; milestone M3 raises that to **tint + scale +
 * 1 extra attack per role**. This file is the single place describing that extra attack
 * in pure arithmetic, so both the Cocos adapter and tests read the same definition:
 *
 * | Role   | Regular       | Elite |
 * |---|---|---|
 * | chaser | contact only  | adds a **pounce** (telegraph → short charge) |
 * | caster | 1 projectile  | a **3-projectile fan** volley |
 * | tank   | 1 charge      | **2 charges** in a row, the second locking a new direction |
 *
 * The numbers live in `config/tuning.json` (`enemies.elite.*`), never hardcoded.
 * The elite chaser pounce and the elite tank's second charge live in
 * `behaviours.ts` (they are actions, not volleys).
 */
import type { EnemyRole } from '../level/level-data';
import { ENEMY_TUNING, type EnemiesTuning } from './tuning';

/** Default angular offset between two adjacent elite caster projectiles, radians. */
export function eliteVolleyAngles(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number[] {
  if (role !== 'caster') return [];
  if (!elite) return [0];

  const { volleyShots, volleySpreadRadians } = tuning.elite.caster;
  // Odd so one projectile always flies straight at the player; even still works but is off-centre.
  const half = (volleyShots - 1) / 2;
  const angles: number[] = [];
  for (let index = 0; index < volleyShots; index += 1) {
    angles.push((index - half) * volleySpreadRadians);
  }
  return angles;
}

/** Elite node scale relative to the regular version (GDD §4: 1.15). */
export function eliteScale(tuning: EnemiesTuning = ENEMY_TUNING): number {
  return tuning.elite.scale;
}

/** Number of **extra** charges after the first for an elite tank. */
export function eliteExtraCharges(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number {
  if (!elite || role !== 'tank') return 0;
  return tuning.elite.tank.extraCharges;
}
