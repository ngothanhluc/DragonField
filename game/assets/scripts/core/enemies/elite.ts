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
  if (role === 'buffer') {
    if (!elite) return [0];
    return symmetricVolleyAngles(
      tuning.elite.buffer.volleyShots,
      tuning.elite.buffer.volleySpreadRadians,
    );
  }
  if (role !== 'caster') return [];
  if (!elite) return [0];

  const { volleyShots, volleySpreadRadians } = tuning.elite.caster;
  return symmetricVolleyAngles(volleyShots, volleySpreadRadians);
}

/**
 * Chapter-aware volley angles (M13): Ch3–Ch4 regular casters fire a 2-shot burst and Ch3–Ch4
 * elite casters escalate to a wider 4-shot fan; Ch1–Ch2 keeps the M3 1-shot / 3-shot fan.
 */
export function casterVolleyAngles(
  role: EnemyRole,
  elite: boolean,
  chapter = 1,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number[] {
  if (role === 'buffer') return eliteVolleyAngles(role, elite, tuning);
  if (role !== 'caster') return [];
  if (elite) {
    const shots =
      chapter >= tuning.ai.eliteCasterLateMinChapter
        ? tuning.ai.eliteCasterLateVolleyShots
        : tuning.elite.caster.volleyShots;
    return symmetricVolleyAngles(shots, tuning.elite.caster.volleySpreadRadians);
  }
  if (chapter >= tuning.ai.casterBurstMinChapter) {
    return symmetricVolleyAngles(
      tuning.ai.casterBurstShots,
      tuning.ai.casterBurstSpreadRadians,
    );
  }
  return [0];
}

function symmetricVolleyAngles(shots: number, spreadRadians: number): number[] {
  const count = Math.max(1, Math.floor(shots));
  const half = (count - 1) / 2;
  const angles: number[] = [];
  for (let index = 0; index < count; index += 1) {
    angles.push((index - half) * spreadRadians);
  }
  return angles;
}

/** Elite node scale relative to the regular version (GDD §4: 1.15). */
export function eliteScale(tuning: EnemiesTuning = ENEMY_TUNING): number {
  return tuning.elite.scale;
}

/**
 * Manifest actor prefix for an enemy: the base monster (`bluebat`) or its generated elite
 * variant (`bluebat.elite`, ADR-015). `enemy-view` builds animation keys (`<actor>.idle.down`)
 * through this so an elite never plays the regular sheet.
 */
export function spriteActorFor(monster: string, elite: boolean): string {
  return elite ? `${monster}.elite` : monster;
}

/**
 * Manifest actor for a **role** (#42): a splitling plays its palette-remapped variant sheet
 * (`<monster>.splitling.*`), every other role keeps the regular/elite rule above.
 */
export function spriteActorForRole(monster: string, role: EnemyRole, elite: boolean): string {
  if (role === 'splitling') return `${monster}.splitling`;
  return spriteActorFor(monster, elite);
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
