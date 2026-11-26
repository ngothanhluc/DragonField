/**
 * Bomber role pure logic (M13, GDD §15.3): radial AoE fuse blast + elite double-pulse shockwave.
 *
 * Pure TS — zero `cc` imports. Both the balance sim and the Cocos runtime read the exact same
 * blast radius, damage scaling, and follow-up pulse timing from `config/tuning.json`.
 */
import { distance, type Vec2 } from '../math/vec2';
import type { EnemyState } from './behaviours';
import { CHAPTER_TUNING, ENEMY_TUNING, type EnemiesTuning } from './tuning';

/** One radial AoE blast triggered when a bomber finishes its fuse telegraph. */
export interface BomberBlastSpec {
  readonly sourceId: string;
  readonly center: Vec2;
  readonly radiusTiles: number;
  readonly damage: number;
  /** True when the bomber was an elite variant (used for M15 death attribution). */
  readonly elite?: boolean;
  /** True for the elite bomber's secondary shockwave pulse. */
  readonly isFollowUp: boolean;
  /** Delay before an elite bomber's second pulse fires, or `null` for normal / follow-up blasts. */
  readonly followUpDelayMs: number | null;
  readonly followUpRadiusTiles: number;
}

/** Pending delayed follow-up pulse from an elite bomber (flat data, no timers). */
export interface PendingBomberBlast {
  readonly sourceId: string;
  readonly center: Vec2;
  readonly radiusTiles: number;
  readonly damage: number;
  readonly elite?: boolean;
  readonly triggerAtMs: number;
}

function chapterDamageMultiplier(chapter: number): number {
  const multipliers = CHAPTER_TUNING.enemyDamageMultipliers;
  if (!Number.isFinite(chapter) || multipliers.length === 0) return 1;
  const index = Math.min(Math.max(Math.floor(chapter), 1), multipliers.length) - 1;
  return multipliers[index] ?? 1;
}

/**
 * Compute the primary radial blast spec for a bomber completing its fuse telegraph.
 * Elite bombers detonate with a wider radius and schedule a second follow-up pulse.
 */
export function bomberBlastSpec(
  enemy: Pick<EnemyState, 'id' | 'position' | 'elite'>,
  chapter = 1,
  tuning: EnemiesTuning = ENEMY_TUNING,
  damageMult = 1,
): BomberBlastSpec {
  const role = tuning.roles.bomber;
  const baseRadius = role.blastRadiusTiles ?? 2.5;
  const baseDamage = role.blastDamage ?? Math.max(1, role.contactDamage);
  const eliteMult = enemy.elite ? tuning.eliteDamageMultiplier : 1;
  const safeMult = Number.isFinite(damageMult) && damageMult > 0 ? damageMult : 1;
  const damage = Math.max(
    1,
    Math.round(baseDamage * eliteMult * chapterDamageMultiplier(chapter) * safeMult),
  );

  if (!enemy.elite) {
    return {
      sourceId: enemy.id,
      center: { x: enemy.position.x, y: enemy.position.y },
      radiusTiles: baseRadius,
      damage,
      elite: false,
      isFollowUp: false,
      followUpDelayMs: null,
      followUpRadiusTiles: 0,
    };
  }

  const elite = tuning.elite.bomber;
  const delayMs = elite.doublePulseDelayMs > 0 ? elite.doublePulseDelayMs : null;
  return {
    sourceId: enemy.id,
    center: { x: enemy.position.x, y: enemy.position.y },
    radiusTiles: baseRadius * elite.blastRadiusMultiplier,
    damage,
    elite: true,
    isFollowUp: false,
    followUpDelayMs: delayMs,
    followUpRadiusTiles: delayMs !== null ? baseRadius * elite.doublePulseRadiusMultiplier : 0,
  };
}

/** Schedule the elite bomber's follow-up pulse if the primary blast carries one. */
export function scheduleFollowUpBlast(
  spec: BomberBlastSpec,
  nowMs: number,
): PendingBomberBlast | null {
  if (spec.followUpDelayMs === null || !(spec.followUpDelayMs > 0) || !(spec.followUpRadiusTiles > 0)) {
    return null;
  }
  return {
    sourceId: spec.sourceId,
    center: { x: spec.center.x, y: spec.center.y },
    radiusTiles: spec.followUpRadiusTiles,
    damage: spec.damage,
    elite: spec.elite === true,
    triggerAtMs: nowMs + spec.followUpDelayMs,
  };
}

/** Split pending elite bomber pulses into triggered (at `nowMs`) and remaining. Pure. */
export function stepPendingBlasts(
  pending: readonly PendingBomberBlast[],
  nowMs: number,
): { readonly triggered: BomberBlastSpec[]; readonly remaining: PendingBomberBlast[] } {
  const triggered: BomberBlastSpec[] = [];
  const remaining: PendingBomberBlast[] = [];

  for (const item of pending) {
    if (nowMs >= item.triggerAtMs) {
      triggered.push({
        sourceId: item.sourceId,
        center: { x: item.center.x, y: item.center.y },
        radiusTiles: item.radiusTiles,
        damage: item.damage,
        elite: item.elite === true,
        isFollowUp: true,
        followUpDelayMs: null,
        followUpRadiusTiles: 0,
      });
    } else {
      remaining.push(item);
    }
  }

  return { triggered, remaining };
}

/** True when a circular target (`targetPos`, `targetRadiusTiles`) overlaps the bomber blast circle. */
export function isInsideBomberBlast(
  blastCenter: Vec2,
  blastRadiusTiles: number,
  targetPos: Vec2,
  targetRadiusTiles = 0,
): boolean {
  if (!(blastRadiusTiles > 0)) return false;
  return distance(blastCenter, targetPos) <= blastRadiusTiles + Math.max(0, targetRadiusTiles);
}
