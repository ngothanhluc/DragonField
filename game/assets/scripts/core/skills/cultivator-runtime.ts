/**
 * Cultivator exclusive-skill runtime (M20, ADR-027; #87).
 *
 * The hooks in `classes/cultivator.ts` are pure and stateless: they turn one combat event into
 * `ClassSkillEffect[]` requests. This module owns everything those requests need **over time** —
 * orbiting spirit swords and their darts, planted Sword Arrays, travelling Sword Qi crescents, and
 * the Qi gauge + shield — and steps it deterministically.
 *
 * Why one module: both consumers must behave identically.
 * - `sim/run-simulation.ts` (headless balance sim, tests, `sim:table`)
 * - `game/combat-loop.ts` (the real Cocos run)
 *
 * The module never damages anything itself: `step()` returns `CultivatorHit[]` and the caller
 * applies each hit through its normal enemy/boss damage path (so kills, gold/XP, floating numbers
 * and `onKill` attribution all stay in one place).
 *
 * Determinism: no randomness at all — dart targets and wave angles are resolved from ids and
 * indices, so a seed cannot drift between the sim and the game, and `skillRollRng` is untouched.
 *
 * Pure TS: no `cc`, no file reads.
 */
import type { CultivatorClassSkillsTuning } from '../enemies/tuning';
import { distanceSquared, type Vec2 } from '../math/vec2';
import type { ClassSkillEffect, ClassSkillStackSource } from './class-skill-hooks';
import {
  CULTIVATOR_ARRAY_ID,
  CULTIVATOR_BARRIER_ID,
  CULTIVATOR_EVOLUTION_ID,
  CULTIVATOR_ORBIT_ID,
  CULTIVATOR_QI_ID,
  cultivatorStacksOf,
} from './classes/cultivator';

/** One thing the class runtime can hit: a living enemy, or the boss. */
export interface CultivatorTarget {
  readonly id: string;
  readonly position: Vec2;
  readonly radiusTiles: number;
}

/** One damage the caller must apply now. */
export interface CultivatorHit {
  readonly skillId: string;
  readonly targetId: string;
  /** Hit point in room tiles (the projectile/array position), for floating numbers + FX. */
  readonly position: Vec2;
  /** Damage after the shot-damage ratio (ready to subtract). */
  readonly amount: number;
  readonly crit: boolean;
}

/** Values the caller knows but a stateless hook does not (player stats at trigger time). */
export interface CultivatorApplyContext {
  /** Player's current shot damage (effect `amount` is a ratio of this). */
  readonly shotDamage: number;
  /** Kept for the shared class-runtime signature; Cultivator class damage never crits. */
  readonly critMultiplier: number;
  /** Unit direction a Sword Qi wave should fly; defaults to +x when absent. */
  readonly aimDirection?: Vec2;
}

/** A sword that darts from the player toward the nearest enemy within reach and returns. */
interface SwordDart {
  readonly id: number;
  readonly origin: Vec2;
  readonly damage: number;
  readonly reachTiles: number;
}

/** A planted *Kiếm Trận*: slices every enemy inside on a fixed tick for its lifetime. */
export interface SwordArrayZone {
  readonly id: number;
  readonly position: Vec2;
  readonly radiusTiles: number;
  /** Damage per slice tick. */
  readonly damage: number;
  readonly tickMs: number;
  readonly expiresAtMs: number;
  nextTickAtMs: number;
}

/** A travelling crescent (Sword Qi, a barrier wave, or a Myriad Swords mini wave). */
export interface SwordWave {
  readonly id: number;
  readonly skillId: string;
  readonly position: { x: number; y: number };
  readonly velocity: Vec2;
  readonly radiusTiles: number;
  readonly damage: number;
  remainingMs: number;
  /** Pierce: each enemy takes the wave at most once. */
  readonly hitIds: Set<string>;
}

function isInside(target: CultivatorTarget, point: Vec2, radiusTiles: number): boolean {
  const reach = radiusTiles + target.radiusTiles;
  return distanceSquared(point, target.position) <= reach * reach;
}

/** Nearest living target within `rangeTiles` of `from`, ties broken by id (deterministic). */
function nearestTarget(
  from: Vec2,
  targets: readonly CultivatorTarget[],
  rangeTiles: number,
): CultivatorTarget | null {
  let best: CultivatorTarget | null = null;
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

/** Value for `stack` (1-based), clamped to the table length. */
function atStack(table: readonly number[], stack: number): number {
  const index = Math.max(0, Math.min(table.length - 1, stack - 1));
  return table[index] ?? 0;
}

/**
 * Stateful Cultivator skill runtime. One instance per run (or per combat room) — create it once
 * and feed it every dispatched effect, then call `step` each tick.
 */
export class CultivatorSkillRuntime {
  private readonly darts: SwordDart[] = [];
  private readonly arrays: SwordArrayZone[] = [];
  private readonly waves: SwordWave[] = [];
  /** Qi gauge in `0..1`; ignored while the shield is up. */
  private gauge = 0;
  private shield = false;
  private nextId = 1;

  constructor(
    private readonly tuning: CultivatorClassSkillsTuning,
    private readonly owned: ClassSkillStackSource,
  ) {}

  /** Live planted arrays, for the view. Read-only: do not mutate. */
  get activeArrays(): readonly SwordArrayZone[] {
    return this.arrays;
  }

  /** Live travelling crescents, for the view. Read-only: do not mutate. */
  get activeWaves(): readonly SwordWave[] {
    return this.waves;
  }

  /** Qi gauge fraction in `0..1` (0 while the shield is up). */
  get gaugeFraction(): number {
    return this.gauge;
  }

  /** True while the Qi shield can absorb the next hit. */
  get hasQiShield(): boolean {
    return this.shield;
  }

  /** Orbit sword count from the owned stacks (view-only; the hooks decide when they slash). */
  get orbitSwordCount(): number {
    const stacks = cultivatorStacksOf(this.owned, CULTIVATOR_ORBIT_ID);
    if (stacks <= 0) return 0;
    return atStack(this.tuning.orbitSwords.swordsByStack, stacks);
  }

  /** True when nothing needs stepping or drawing. */
  get isEmpty(): boolean {
    return this.darts.length === 0 && this.arrays.length === 0 && this.waves.length === 0;
  }

  /** Drop all state (room change / run restart). */
  reset(): void {
    this.darts.length = 0;
    this.arrays.length = 0;
    this.waves.length = 0;
    this.gauge = 0;
    this.shield = false;
  }

  /**
   * Absorb exactly the next hit to the player. Returns `true` when the shield took it (no heart
   * lost) and the gauge restarts at 0.
   */
  consumeQiShield(): boolean {
    if (!this.shield) return false;
    this.shield = false;
    this.gauge = 0;
    return true;
  }

  /**
   * Positions of the orbiting swords around `center` at `nowMs` (radians/second, deterministic).
   * Shared by the Cocos view and the mini-wave origin so both agree frame for frame.
   */
  orbitSwordPositions(center: Vec2, nowMs: number): Vec2[] {
    const count = this.orbitSwordCount;
    if (count <= 0) return [];
    const radius = this.tuning.orbitSwords.orbitRadiusTiles;
    const spin = (nowMs / 1000) * this.tuning.orbitSwords.orbitSpinRadiansPerSecond;
    const positions: Vec2[] = [];
    for (let index = 0; index < count; index += 1) {
      const angle = spin + (Math.PI * 2 * index) / count;
      positions.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    }
    return positions;
  }

  /** Apply the effect requests returned by one hook dispatch. */
  applyEffects(
    effects: readonly ClassSkillEffect[],
    nowMs: number,
    context: CultivatorApplyContext,
  ): void {
    if (effects.length === 0) return;

    const shotDamage = context.shotDamage;
    let orbitEffects: ClassSkillEffect[] | null = null;
    let evolutionEffects: ClassSkillEffect[] | null = null;

    for (const effect of effects) {
      switch (effect.skillId) {
        case CULTIVATOR_ORBIT_ID:
          if (orbitEffects === null) orbitEffects = [];
          orbitEffects.push(effect);
          break;
        case CULTIVATOR_EVOLUTION_ID:
          if (evolutionEffects === null) evolutionEffects = [];
          evolutionEffects.push(effect);
          break;
        case CULTIVATOR_ARRAY_ID:
          this.plantArray(effect, nowMs, shotDamage);
          break;
        case CULTIVATOR_QI_ID:
          this.spawnWave(
            CULTIVATOR_QI_ID,
            effect,
            shotDamage,
            this.tuning.swordQi.speedTilesPerSecond,
            context.aimDirection,
          );
          break;
        case CULTIVATOR_BARRIER_ID:
          this.chargeQi(effect, context);
          break;
        default:
          break;
      }
    }

    if (orbitEffects !== null) {
      for (const effect of orbitEffects) {
        const ratio = effect.amount ?? 0;
        const reachTiles = effect.radiusTiles ?? 0;
        if (!(ratio > 0) || !(reachTiles > 0)) continue;
        this.darts.push({
          id: this.nextId++,
          origin: { x: effect.position.x, y: effect.position.y },
          damage: shotDamage * ratio,
          reachTiles,
        });
      }
    }

    if (evolutionEffects !== null) {
      const origin = evolutionEffects[0]?.position;
      if (origin !== undefined) {
        const swordPositions = this.orbitSwordPositions(origin, nowMs);
        for (let index = 0; index < evolutionEffects.length; index += 1) {
          const effect = evolutionEffects[index];
          if (effect === undefined) continue;
          const from = swordPositions[index % Math.max(1, swordPositions.length)] ?? origin;
          const outward = directionBetween(origin, from);
          this.spawnWave(
            CULTIVATOR_EVOLUTION_ID,
            { ...effect, position: from },
            shotDamage,
            this.tuning.myriadSwords.miniWaveSpeedTilesPerSecond,
            outward,
          );
        }
      }
    }
  }

  /** Advance darts/arrays/waves and return every hit the caller must apply now. */
  step(
    nowMs: number,
    deltaMs: number,
    targets: readonly CultivatorTarget[],
  ): readonly CultivatorHit[] {
    if (this.isEmpty) return EMPTY_HITS;
    const hits: CultivatorHit[] = [];
    const seconds = Math.max(0, deltaMs) / 1000;

    this.stepDarts(targets, hits);
    this.stepArrays(nowMs, targets, hits);
    this.stepWaves(seconds, deltaMs, targets, hits);
    return hits;
  }

  private chargeQi(effect: ClassSkillEffect, context: CultivatorApplyContext): void {
    if (this.shield) return;
    const amount = effect.amount ?? 0;
    if (!(amount > 0)) return;
    this.gauge = Math.min(1, this.gauge + amount);
    if (this.gauge < 1 - 1e-9) return;

    // Full gauge: raise the shield and immediately blast N radial Sword Qi waves.
    this.gauge = 0;
    this.shield = true;
    const stacks = cultivatorStacksOf(this.owned, CULTIVATOR_BARRIER_ID);
    if (stacks <= 0) return;
    const count = Math.max(1, Math.floor(atStack(this.tuning.qiBarrier.wavesByStack, stacks)));
    const ratio = atStack(this.tuning.qiBarrier.waveDamageRatioByStack, stacks);
    const radiusTiles = atStack(this.tuning.qiBarrier.waveHalfWidthTilesByStack, stacks);
    const durationMs = atStack(this.tuning.qiBarrier.waveDurationMsByStack, stacks);
    const speed = this.tuning.qiBarrier.waveSpeedTilesPerSecond;
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      this.waves.push({
        id: this.nextId++,
        skillId: CULTIVATOR_BARRIER_ID,
        position: { x: effect.position.x, y: effect.position.y },
        velocity: { x: direction.x * speed, y: direction.y * speed },
        radiusTiles,
        damage: context.shotDamage * ratio,
        remainingMs: durationMs,
        hitIds: new Set<string>(),
      });
    }
  }

  private plantArray(effect: ClassSkillEffect, nowMs: number, shotDamage: number): void {
    const radiusTiles = effect.radiusTiles ?? 0;
    const durationMs = effect.durationMs ?? 0;
    const ratio = effect.amount ?? 0;
    if (!(radiusTiles > 0) || !(durationMs > 0) || !(ratio > 0)) return;
    const tickMs = Math.max(1, this.tuning.swordArray.tickMs);
    this.arrays.push({
      id: this.nextId++,
      position: { x: effect.position.x, y: effect.position.y },
      radiusTiles,
      damage: shotDamage * ratio,
      tickMs,
      expiresAtMs: nowMs + durationMs,
      nextTickAtMs: nowMs + tickMs,
    });
  }

  private spawnWave(
    skillId: string,
    effect: ClassSkillEffect,
    shotDamage: number,
    speedTilesPerSecond: number,
    direction: Vec2 | undefined,
  ): void {
    const radiusTiles = effect.radiusTiles ?? 0;
    const durationMs = effect.durationMs ?? 0;
    const ratio = effect.amount ?? 0;
    if (!(radiusTiles > 0) || !(durationMs > 0) || !(ratio > 0)) return;
    const unit = unitOrX(direction);
    this.waves.push({
      id: this.nextId++,
      skillId,
      position: { x: effect.position.x, y: effect.position.y },
      velocity: { x: unit.x * speedTilesPerSecond, y: unit.y * speedTilesPerSecond },
      radiusTiles,
      damage: shotDamage * ratio,
      remainingMs: durationMs,
      hitIds: new Set<string>(),
    });
  }

  private stepDarts(targets: readonly CultivatorTarget[], hits: CultivatorHit[]): void {
    for (let index = this.darts.length - 1; index >= 0; index -= 1) {
      const dart = this.darts[index];
      if (dart === undefined) continue;
      const target = nearestTarget(dart.origin, targets, dart.reachTiles);
      this.darts.splice(index, 1);
      if (target === null) continue;
      hits.push({
        skillId: CULTIVATOR_ORBIT_ID,
        targetId: target.id,
        position: { x: target.position.x, y: target.position.y },
        amount: dart.damage,
        crit: false,
      });
    }
  }

  private stepArrays(
    nowMs: number,
    targets: readonly CultivatorTarget[],
    hits: CultivatorHit[],
  ): void {
    for (let index = this.arrays.length - 1; index >= 0; index -= 1) {
      const array = this.arrays[index];
      if (array === undefined) continue;
      if (nowMs >= array.expiresAtMs) {
        this.arrays.splice(index, 1);
        continue;
      }
      if (nowMs < array.nextTickAtMs) continue;

      for (const target of targets) {
        if (!isInside(target, array.position, array.radiusTiles)) continue;
        hits.push({
          skillId: CULTIVATOR_ARRAY_ID,
          targetId: target.id,
          position: { x: array.position.x, y: array.position.y },
          amount: array.damage,
          crit: false,
        });
      }

      // Advance from the scheduled tick, but never fall several ticks behind (frame drops).
      array.nextTickAtMs += array.tickMs;
      if (array.nextTickAtMs <= nowMs) array.nextTickAtMs = nowMs + array.tickMs;
    }
  }

  private stepWaves(
    seconds: number,
    deltaMs: number,
    targets: readonly CultivatorTarget[],
    hits: CultivatorHit[],
  ): void {
    for (let index = this.waves.length - 1; index >= 0; index -= 1) {
      const wave = this.waves[index];
      if (wave === undefined) continue;
      wave.position.x += wave.velocity.x * seconds;
      wave.position.y += wave.velocity.y * seconds;
      wave.remainingMs -= Math.max(0, deltaMs);

      for (const target of targets) {
        if (wave.hitIds.has(target.id)) continue;
        if (!isInside(target, wave.position, wave.radiusTiles)) continue;
        wave.hitIds.add(target.id);
        hits.push({
          skillId: wave.skillId,
          targetId: target.id,
          position: { x: wave.position.x, y: wave.position.y },
          amount: wave.damage,
          crit: false,
        });
      }

      if (wave.remainingMs <= 0) this.waves.splice(index, 1);
    }
  }
}

function unitOrX(direction: Vec2 | undefined): Vec2 {
  if (direction === undefined) return { x: 1, y: 0 };
  const length = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(length) || length < 1e-6) return { x: 1, y: 0 };
  return { x: direction.x / length, y: direction.y / length };
}

/** Unit direction from `from` to `to`, or +x when they coincide. */
function directionBetween(from: Vec2, to: Vec2): Vec2 {
  return unitOrX({ x: to.x - from.x, y: to.y - from.y });
}

const EMPTY_HITS: readonly CultivatorHit[] = [];
