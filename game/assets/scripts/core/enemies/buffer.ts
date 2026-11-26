/**
 * Buffer role pure logic (M13, GDD §15.3): haste/empower aura onto nearby allies, with a slow
 * defensive orb fallback (3-orb spread when elite) if no allies are within range.
 *
 * Pure TS — zero `cc` imports, no `Math.random`, no wall-clock reads.
 */
import { bufferShotPlan } from '../combat/enemy-fire';
import { distance, type Vec2 } from '../math/vec2';
import type { EnemyState } from './behaviours';
import { ENEMY_TUNING, type EnemiesTuning } from './tuning';

/** Outcome of a buffer completing its telegraph cast. */
export type BufferPulseResult =
  | {
      readonly kind: 'aura';
      readonly sourceId: string;
      readonly center: Vec2;
      readonly radiusTiles: number;
      readonly affectedIds: readonly string[];
      readonly speedMultiplier: number;
      readonly untilMs: number;
    }
  | {
      readonly kind: 'defensive-shot';
      readonly sourceId: string;
      readonly center: Vec2;
      readonly angles: readonly number[];
      readonly speedTilesPerSecond: number;
    };

/**
 * Resolve a buffer's completed telegraph cast:
 * - If at least one living non-self ally stands within `buffRadiusTiles` (expanded for elites),
 *   emits a haste aura granting `speedMultiplier` until `nowMs + buffDurationMs`.
 * - If solo (no allies in range), falls back to a slow defensive orb (or 3-orb spread when elite).
 */
export function resolveBufferPulse(
  buffer: Pick<EnemyState, 'id' | 'position' | 'elite'>,
  allies: readonly Pick<EnemyState, 'id' | 'position' | 'health' | 'action'>[],
  nowMs: number,
  tuning: EnemiesTuning = ENEMY_TUNING,
): BufferPulseResult {
  const role = tuning.roles.buffer;
  const baseRadius = role.buffRadiusTiles ?? 6;
  const baseSpeedMult = role.buffSpeedMultiplier ?? 1.3;
  const durationMs = role.buffDurationMs ?? 3500;

  const radiusTiles = buffer.elite
    ? baseRadius * tuning.elite.buffer.buffRadiusMultiplier
    : baseRadius;
  const speedMultiplier = buffer.elite
    ? Math.max(baseSpeedMult, tuning.elite.buffer.buffSpeedMultiplier)
    : baseSpeedMult;

  const affectedIds: string[] = [];
  for (const ally of allies) {
    if (ally.id === buffer.id) continue;
    if (ally.health <= 0 || ally.action.kind === 'dead') continue;
    if (distance(buffer.position, ally.position) <= radiusTiles) {
      affectedIds.push(ally.id);
    }
  }

  if (affectedIds.length > 0) {
    return {
      kind: 'aura',
      sourceId: buffer.id,
      center: { x: buffer.position.x, y: buffer.position.y },
      radiusTiles,
      affectedIds,
      speedMultiplier,
      untilMs: nowMs + durationMs,
    };
  }

  const shot = bufferShotPlan(buffer.elite, tuning);
  return {
    kind: 'defensive-shot',
    sourceId: buffer.id,
    center: { x: buffer.position.x, y: buffer.position.y },
    angles: shot.angles,
    speedTilesPerSecond: shot.speedTilesPerSecond,
  };
}

interface HasteBuff {
  speedMultiplier: number;
  untilMs: number;
}

/**
 * Pure tracker for active buffer haste auras on enemies.
 * Multiple overlapping buffers refresh duration and keep the strongest speed multiplier instead
 * of stacking multiplicatively without bound.
 */
export class EnemyBuffTracker {
  private readonly buffs = new Map<string, HasteBuff>();

  /** Apply a haste aura to every enemy id in `enemyIds`. */
  applyHaste(enemyIds: readonly string[], speedMultiplier: number, untilMs: number): void {
    if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 1) return;
    if (!Number.isFinite(untilMs)) return;

    for (const id of enemyIds) {
      const existing = this.buffs.get(id);
      if (existing === undefined) {
        this.buffs.set(id, { speedMultiplier, untilMs });
      } else {
        existing.speedMultiplier = Math.max(existing.speedMultiplier, speedMultiplier);
        existing.untilMs = Math.max(existing.untilMs, untilMs);
      }
    }
  }

  /** Speed multiplier for `enemyId` at `nowMs` (`1` when unbuffed or expired). */
  speedMultiplierFor(enemyId: string, nowMs: number): number {
    const buff = this.buffs.get(enemyId);
    if (buff === undefined) return 1;
    if (nowMs >= buff.untilMs) {
      this.buffs.delete(enemyId);
      return 1;
    }
    return buff.speedMultiplier;
  }

  /** Whether `enemyId` currently has an active haste buff at `nowMs`. */
  isBuffed(enemyId: string, nowMs: number): boolean {
    return this.speedMultiplierFor(enemyId, nowMs) > 1;
  }

  /** Drop expired entries so the map never grows across waves. */
  prune(nowMs: number): void {
    for (const [id, buff] of this.buffs) {
      if (nowMs >= buff.untilMs) this.buffs.delete(id);
    }
  }

  forget(enemyId: string): void {
    this.buffs.delete(enemyId);
  }

  clear(): void {
    this.buffs.clear();
  }
}
