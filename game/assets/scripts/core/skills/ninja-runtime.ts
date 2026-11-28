/**
 * Ninja exclusive-skill runtime (M20, ADR-027; #84).
 *
 * The hooks in `classes/ninja.ts` are pure and stateless: they turn one combat event into
 * `ClassSkillEffect[]` requests. This module owns everything those requests need **over time** —
 * live shadow clones, flying clone shurikens / venom shurikens / kunai, lingering poison clouds,
 * and smoke zones — and steps it deterministically.
 *
 * Why one module: both consumers must behave identically.
 * - `sim/run-simulation.ts` (headless balance sim, tests, `sim:table`)
 * - `game/combat-loop.ts` (the real Cocos run)
 *
 * The module never damages anything itself: `step()` returns `NinjaHit[]` and the caller applies
 * each hit through its normal enemy/boss damage path (so kills, gold/XP, floating numbers and
 * `onKill` attribution all stay in one place). It also holds the two area queries the consumers
 * need (enemy slow / player fire-rate bonus inside smoke).
 *
 * Determinism: no randomness at all — clone targets and kunai angles are resolved from ids and
 * indices, so a seed cannot drift between the sim and the game, and `skillRollRng` is untouched.
 *
 * Pure TS: no `cc`, no file reads.
 */
import type { NinjaClassSkillsTuning } from '../enemies/tuning';
import { distanceSquared, type Vec2 } from '../math/vec2';
import type { ClassSkillEffect } from './class-skill-hooks';

export const NINJA_CLONE_SKILL = 'ninja-shadow-clone';
export const NINJA_VENOM_SKILL = 'ninja-venom-shuriken';
export const NINJA_KUNAI_SKILL = 'ninja-kunai-burst';
export const NINJA_SMOKE_SKILL = 'ninja-smoke-bomb';

/** One thing the class runtime can hit: a living enemy, or the boss. */
export interface NinjaTarget {
  readonly id: string;
  readonly position: Vec2;
  readonly radiusTiles: number;
}

/** One damage the caller must apply now. */
export interface NinjaHit {
  readonly skillId: string;
  readonly targetId: string;
  /** Hit point in room tiles (the projectile/cloud position), for floating numbers + FX. */
  readonly position: Vec2;
  /** Damage after crit multiplication (ready to subtract). */
  readonly amount: number;
  readonly crit: boolean;
}

/** A stationary shadow decoy from *Phân Thân Ám Ảnh*. */
export interface NinjaClone {
  readonly id: number;
  readonly position: Vec2;
  /** Damage per clone shuriken (already includes the player-shot ratio + crit). */
  readonly damage: number;
  readonly crit: boolean;
  readonly expiresAtMs: number;
  nextFireAtMs: number;
}

/** A flying class projectile (clone shuriken, venom shuriken, or kunai). */
export interface NinjaProjectile {
  readonly id: number;
  readonly skillId: string;
  readonly position: { x: number; y: number };
  readonly velocity: Vec2;
  readonly damage: number;
  readonly radiusTiles: number;
  readonly crit: boolean;
  remainingMs: number;
  /** Venom shurikens leave this cloud where they land/expire. */
  readonly cloudRadiusTiles?: number;
  readonly cloudDurationMs?: number;
  readonly cloudDamage?: number;
}

/** A lingering poison cloud from *Phi Tiêu Độc Vụ*. */
export interface NinjaCloud {
  readonly id: number;
  readonly position: Vec2;
  readonly radiusTiles: number;
  /** Damage per tick. */
  readonly damage: number;
  readonly tickMs: number;
  readonly expiresAtMs: number;
  nextTickAtMs: number;
}

/** One smoke zone from *Bom Khói Ẩn Thân*: enemy slow and/or player fire-rate bonus. */
export interface NinjaSmokeZone {
  readonly id: number;
  readonly position: Vec2;
  readonly radiusTiles: number;
  readonly expiresAtMs: number;
  /** Enemy speed reduction fraction in `0..1` (`0` when this zone came from the buff effect). */
  readonly slow: number;
  /** Player fire-rate bonus fraction (`0` when this zone came from the status effect). */
  readonly fireRateBonus: number;
}

/** Values the caller knows but a stateless hook does not (player stats at trigger time). */
export interface NinjaApplyContext {
  /** Player's current shot damage (clone damage = this × effect amount). */
  readonly shotDamage: number;
  /** Player's crit multiplier (Evolution clone shurikens always crit). */
  readonly critMultiplier: number;
  /** Unit direction the venom shuriken should fly; defaults to +x when absent. */
  readonly aimDirection?: Vec2;
}

function isInside(target: NinjaTarget, point: Vec2, radiusTiles: number): boolean {
  const reach = radiusTiles + target.radiusTiles;
  return distanceSquared(point, target.position) <= reach * reach;
}

/** Point-in-zone test (the point has no radius). */
function insideZone(point: Vec2, zone: NinjaSmokeZone): boolean {
  return distanceSquared(point, zone.position) <= zone.radiusTiles * zone.radiusTiles;
}

/** Nearest living target within `rangeTiles`, ties broken by id so the choice is deterministic. */
function nearestTarget(
  from: Vec2,
  targets: readonly NinjaTarget[],
  rangeTiles: number,
): NinjaTarget | null {
  let best: NinjaTarget | null = null;
  let bestDistanceSq = rangeTiles * rangeTiles;
  for (const target of targets) {
    const distanceSq = distanceSquared(from, target.position);
    if (distanceSq > bestDistanceSq) continue;
    if (best === null || distanceSq < bestDistanceSq || target.id < best.id) {
      best = target;
      bestDistanceSq = distanceSq;
    }
  }
  return best;
}

function unitDirection(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1e-6) return null;
  return { x: dx / length, y: dy / length };
}

/**
 * Stateful Ninja skill runtime. One instance per run (or per combat room) — create it once and
 * feed it every dispatched effect, then call `step` each tick.
 */
export class NinjaSkillRuntime {
  private readonly clones: NinjaClone[] = [];
  private readonly projectiles: NinjaProjectile[] = [];
  private readonly clouds: NinjaCloud[] = [];
  private readonly smokeZones: NinjaSmokeZone[] = [];
  private nextId = 1;

  constructor(private readonly tuning: NinjaClassSkillsTuning) {}

  /** Live decoys, for the view. Read-only: do not mutate. */
  get activeClones(): readonly NinjaClone[] {
    return this.clones;
  }

  /** Live class projectiles, for the view. Read-only: do not mutate. */
  get activeProjectiles(): readonly NinjaProjectile[] {
    return this.projectiles;
  }

  /** Live poison clouds, for the view. Read-only: do not mutate. */
  get activeClouds(): readonly NinjaCloud[] {
    return this.clouds;
  }

  /** Live smoke zones, for the view. Read-only: do not mutate. */
  get activeSmokeZones(): readonly NinjaSmokeZone[] {
    return this.smokeZones;
  }

  /** True when nothing needs stepping or drawing. */
  get isEmpty(): boolean {
    return (
      this.clones.length === 0 &&
      this.projectiles.length === 0 &&
      this.clouds.length === 0 &&
      this.smokeZones.length === 0
    );
  }

  /** Drop all state (room change / run restart). */
  reset(): void {
    this.clones.length = 0;
    this.projectiles.length = 0;
    this.clouds.length = 0;
    this.smokeZones.length = 0;
  }

  /**
   * Apply the effect requests returned by one hook dispatch.
   *
   * Kunai burst effects are grouped: the hook returns one effect per kunai, and this spreads them
   * evenly over a full circle (deterministic, starting at +x).
   */
  applyEffects(
    effects: readonly ClassSkillEffect[],
    nowMs: number,
    context: NinjaApplyContext,
  ): void {
    if (effects.length === 0) return;

    let kunaiEffects: ClassSkillEffect[] | null = null;
    for (let index = 0; index < effects.length; index += 1) {
      const effect = effects[index];
      if (effect === undefined) continue;
      switch (effect.skillId) {
        case NINJA_CLONE_SKILL:
          this.spawnClone(effect, nowMs, context);
          break;
        case NINJA_VENOM_SKILL:
          this.spawnVenomShuriken(effect, context);
          break;
        case NINJA_KUNAI_SKILL:
          if (kunaiEffects === null) kunaiEffects = [];
          kunaiEffects.push(effect);
          break;
        case NINJA_SMOKE_SKILL:
          this.spawnSmokeZone(effect, nowMs);
          break;
        default:
          break;
      }
    }

    if (kunaiEffects !== null) this.spawnKunaiSpread(kunaiEffects);
  }

  /** Advance clones/projectiles/clouds/zones and return every hit the caller must apply now. */
  step(
    nowMs: number,
    deltaMs: number,
    targets: readonly NinjaTarget[],
    context: NinjaApplyContext,
  ): readonly NinjaHit[] {
    if (this.isEmpty) return EMPTY_HITS;
    const hits: NinjaHit[] = [];
    const seconds = Math.max(0, deltaMs) / 1000;

    this.stepClones(nowMs, targets, context);
    this.stepProjectiles(nowMs, seconds, deltaMs, targets, hits);
    this.stepClouds(nowMs, targets, hits);
    this.pruneSmokeZones(nowMs);
    return hits;
  }

  /** Enemy speed multiplier at `position` right now (>0, `1` when outside every smoke). */
  enemySpeedMultiplierAt(position: Vec2, nowMs: number): number {
    let slow = 0;
    for (const zone of this.smokeZones) {
      if (nowMs >= zone.expiresAtMs) continue;
      if (!insideZone(position, zone)) continue;
      if (zone.slow > slow) slow = zone.slow;
    }
    return Math.max(0, 1 - slow);
  }

  /** Player fire-rate bonus at `position` right now (`0` when outside every smoke). */
  fireRateBonusAt(position: Vec2, nowMs: number): number {
    let bonus = 0;
    for (const zone of this.smokeZones) {
      if (nowMs >= zone.expiresAtMs) continue;
      if (!insideZone(position, zone)) continue;
      if (zone.fireRateBonus > bonus) bonus = zone.fireRateBonus;
    }
    return bonus;
  }

  private spawnClone(
    effect: ClassSkillEffect,
    nowMs: number,
    context: NinjaApplyContext,
  ): void {
    const durationMs = effect.durationMs ?? 0;
    if (!(durationMs > 0)) return;
    const ratio = effect.amount ?? 0;
    if (!(ratio > 0)) return;
    const crit = effect.crit === true;
    this.clones.push({
      id: this.nextId++,
      position: { x: effect.position.x, y: effect.position.y },
      damage: context.shotDamage * ratio,
      crit,
      expiresAtMs: nowMs + durationMs,
      nextFireAtMs: nowMs,
    });
  }

  private spawnVenomShuriken(effect: ClassSkillEffect, context: NinjaApplyContext): void {
    const radiusTiles = effect.radiusTiles ?? 0;
    const durationMs = effect.durationMs ?? 0;
    const damage = effect.amount ?? 0;
    if (!(radiusTiles > 0) || !(durationMs > 0) || !(damage > 0)) return;

    const aim = context.aimDirection;
    const length = aim === undefined ? 0 : Math.hypot(aim.x, aim.y);
    const velocity: Vec2 =
      aim === undefined || !Number.isFinite(length) || length < 1e-6
        ? { x: this.tuning.venomShuriken.projectileSpeedTilesPerSecond, y: 0 }
        : {
            x: (aim.x / length) * this.tuning.venomShuriken.projectileSpeedTilesPerSecond,
            y: (aim.y / length) * this.tuning.venomShuriken.projectileSpeedTilesPerSecond,
          };

    this.projectiles.push({
      id: this.nextId++,
      skillId: NINJA_VENOM_SKILL,
      position: { x: effect.position.x, y: effect.position.y },
      velocity,
      damage: 0,
      radiusTiles: 0.35,
      crit: false,
      remainingMs: this.tuning.venomShuriken.projectileTtlMs,
      cloudRadiusTiles: radiusTiles,
      cloudDurationMs: durationMs,
      cloudDamage: damage,
    });
  }

  private spawnKunaiSpread(effects: readonly ClassSkillEffect[]): void {
    const count = effects.length;
    if (count === 0) return;
    const speed = this.tuning.kunaiBurst.speedTilesPerSecond;
    for (let index = 0; index < count; index += 1) {
      const effect = effects[index];
      if (effect === undefined) continue;
      const damage = effect.amount ?? 0;
      if (!(damage > 0)) continue;
      const angle = (Math.PI * 2 * index) / count;
      this.projectiles.push({
        id: this.nextId++,
        skillId: NINJA_KUNAI_SKILL,
        position: { x: effect.position.x, y: effect.position.y },
        velocity: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
        damage,
        radiusTiles: this.tuning.kunaiBurst.radiusTiles,
        crit: false,
        remainingMs: this.tuning.kunaiBurst.ttlMs,
      });
    }
  }

  private spawnSmokeZone(effect: ClassSkillEffect, nowMs: number): void {
    const radiusTiles = effect.radiusTiles ?? 0;
    const durationMs = effect.durationMs ?? 0;
    if (!(radiusTiles > 0) || !(durationMs > 0)) return;
    const amount = effect.amount ?? 0;
    this.smokeZones.push({
      id: this.nextId++,
      position: { x: effect.position.x, y: effect.position.y },
      radiusTiles,
      expiresAtMs: nowMs + durationMs,
      slow: effect.kind === 'status' ? amount : 0,
      fireRateBonus: effect.kind === 'buff' ? amount : 0,
    });
  }

  private stepClones(
    nowMs: number,
    targets: readonly NinjaTarget[],
    context: NinjaApplyContext,
  ): void {
    const config = this.tuning.shadowClone;
    for (let index = this.clones.length - 1; index >= 0; index -= 1) {
      const clone = this.clones[index];
      if (clone === undefined) continue;
      if (nowMs >= clone.expiresAtMs) {
        this.clones.splice(index, 1);
        continue;
      }
      if (nowMs < clone.nextFireAtMs) continue;

      const target = nearestTarget(clone.position, targets, config.rangeTiles);
      if (target === null) continue;
      const direction = unitDirection(clone.position, target.position);
      if (direction === null) continue;

      const crit = clone.crit;
      const damage = clone.damage * (crit ? Math.max(1, context.critMultiplier) : 1);
      this.projectiles.push({
        id: this.nextId++,
        skillId: NINJA_CLONE_SKILL,
        position: { x: clone.position.x, y: clone.position.y },
        velocity: {
          x: direction.x * config.projectileSpeedTilesPerSecond,
          y: direction.y * config.projectileSpeedTilesPerSecond,
        },
        damage,
        radiusTiles: 0.14,
        crit,
        remainingMs: config.projectileTtlMs,
      });
      clone.nextFireAtMs = nowMs + config.fireIntervalMs;
    }
  }

  private stepProjectiles(
    nowMs: number,
    seconds: number,
    deltaMs: number,
    targets: readonly NinjaTarget[],
    hits: NinjaHit[],
  ): void {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      if (projectile === undefined) continue;

      projectile.position.x += projectile.velocity.x * seconds;
      projectile.position.y += projectile.velocity.y * seconds;
      projectile.remainingMs -= Math.max(0, deltaMs);

      let consumed = false;
      for (const target of targets) {
        if (!isInside(target, projectile.position, projectile.radiusTiles)) continue;
        if (projectile.damage > 0) {
          hits.push({
            skillId: projectile.skillId,
            targetId: target.id,
            position: { x: projectile.position.x, y: projectile.position.y },
            amount: projectile.damage,
            crit: projectile.crit,
          });
        }
        if (projectile.cloudRadiusTiles !== undefined) {
          this.spawnCloud(projectile, nowMs);
        }
        consumed = true;
        break;
      }

      if (!consumed && projectile.remainingMs <= 0) {
        // A venom shuriken that hits nothing still bursts into its cloud where it expires.
        if (projectile.cloudRadiusTiles !== undefined) this.spawnCloud(projectile, nowMs);
        consumed = true;
      }

      if (consumed) this.projectiles.splice(index, 1);
    }
  }

  private spawnCloud(projectile: NinjaProjectile, nowMs: number): void {
    const radiusTiles = projectile.cloudRadiusTiles ?? 0;
    const durationMs = projectile.cloudDurationMs ?? 0;
    const damage = projectile.cloudDamage ?? 0;
    if (!(radiusTiles > 0) || !(durationMs > 0) || !(damage > 0)) return;
    const tickMs = Math.max(1, this.tuning.venomShuriken.damageTickMs);
    this.clouds.push({
      id: this.nextId++,
      position: { x: projectile.position.x, y: projectile.position.y },
      radiusTiles,
      damage,
      tickMs,
      expiresAtMs: nowMs + durationMs,
      nextTickAtMs: nowMs + tickMs,
    });
  }

  private stepClouds(
    nowMs: number,
    targets: readonly NinjaTarget[],
    hits: NinjaHit[],
  ): void {
    for (let index = this.clouds.length - 1; index >= 0; index -= 1) {
      const cloud = this.clouds[index];
      if (cloud === undefined) continue;
      if (nowMs >= cloud.expiresAtMs) {
        this.clouds.splice(index, 1);
        continue;
      }
      if (nowMs < cloud.nextTickAtMs) continue;

      for (const target of targets) {
        if (!isInside(target, cloud.position, cloud.radiusTiles)) continue;
        hits.push({
          skillId: NINJA_VENOM_SKILL,
          targetId: target.id,
          position: { x: cloud.position.x, y: cloud.position.y },
          amount: cloud.damage,
          crit: false,
        });
      }

      // Advance from the scheduled tick, but never fall several ticks behind (frame drops).
      cloud.nextTickAtMs += cloud.tickMs;
      if (cloud.nextTickAtMs <= nowMs) cloud.nextTickAtMs = nowMs + cloud.tickMs;
    }
  }

  private pruneSmokeZones(nowMs: number): void {
    for (let index = this.smokeZones.length - 1; index >= 0; index -= 1) {
      const zone = this.smokeZones[index];
      if (zone === undefined) continue;
      if (nowMs >= zone.expiresAtMs) this.smokeZones.splice(index, 1);
    }
  }
}

const EMPTY_HITS: readonly NinjaHit[] = [];
