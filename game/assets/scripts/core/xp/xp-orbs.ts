/**
 * Pooled XP orb physics: scatter on drop, magnetic pull, pickup collection, and room-clear
 * full-room auto-vacuum (M12, ADR-021).
 *
 * Zero `cc` imports, zero `new` per drop: every orb slot is pre-allocated in the constructor
 * and reused via `recycled`, and `position`/`velocity` are mutated in place with no per-frame
 * object allocations. When the pool reaches `capacity`, the oldest orb's XP is merged into the
 * next-oldest live orb before reclaiming its slot so total XP is never lost and memory never grows.
 */
import { XP_TUNING, type XpOrbsTuning } from '../enemies/tuning';
import type { Vec2 } from '../math/vec2';

export type XpOrbPhase = 'scatter' | 'idle' | 'magnet' | 'vacuum';

export interface XpOrb {
  id: number;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  /** XP carried by this orb (always > 0 while active). */
  value: number;
  /** Remaining outward scatter glide, seconds. */
  scatterRemainingSec: number;
  /** Current acceleration-driven speed toward the player during magnet/vacuum, tiles/s. */
  pullSpeed: number;
  /** Current lifecycle phase. */
  phase: XpOrbPhase;
}

export interface XpOrbSpawnArgs {
  readonly position: Vec2;
  /** XP carried by the orb; `<= 0` or non-finite is a no-op returning `null`. */
  readonly value: number;
  /**
   * Optional outward scatter direction vector (does not need to be unit length).
   * Omit to use a deterministic golden-angle spread derived from the orb id.
   */
  readonly scatterDir?: Vec2;
}

/** Golden angle (radians) for deterministic multi-drop circular scatter without RNG. */
const GOLDEN_ANGLE_RAD = 2.399963229728653;
const MIN_DIRECTION_LEN = 1e-9;

function createEmptyOrb(): XpOrb {
  return {
    id: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    value: 0,
    scatterRemainingSec: 0,
    pullSpeed: 0,
    phase: 'idle',
  };
}

/**
 * Fixed-capacity XP orb pool.
 *
 * Invariant: `size + recycledCount === capacity` at all times after construction — zero allocations
 * in `spawn`, `step`, or `clear`.
 */
export class XpOrbPool {
  private readonly live: XpOrb[] = [];
  private readonly recycled: XpOrb[] = [];
  private nextId = 1;
  private collectedLastStep = 0;
  readonly capacity: number;

  constructor(private readonly tuning: XpOrbsTuning = XP_TUNING.orbs) {
    const cap = tuning.poolCapacity;
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`XpOrbPool needs poolCapacity to be an integer >= 1, got ${cap}`);
    }
    this.capacity = cap;
    for (let i = 0; i < cap; i += 1) {
      this.recycled.push(createEmptyOrb());
    }
  }

  /** Live orbs currently in the room, oldest first. Read-only view — do not mutate elements. */
  get activeOrbs(): readonly XpOrb[] {
    return this.live;
  }

  get size(): number {
    return this.live.length;
  }

  /** Pre-allocated slots waiting in the free list (`size + recycledCount === capacity`). */
  get recycledCount(): number {
    return this.recycled.length;
  }

  /** Number of individual orbs collected on the most recent `step()` call. */
  get lastCollectedCount(): number {
    return this.collectedLastStep;
  }

  /**
   * Spawn an XP orb at `args.position` carrying `args.value` XP.
   * Returns `null` when `value <= 0` or non-finite (e.g. 0-XP splitling).
   * Never allocates: reuses a pre-allocated slot, merging oldest XP if at hard capacity.
   */
  spawn(args: XpOrbSpawnArgs): XpOrb | null {
    const value = Number.isFinite(args.value) ? Math.floor(args.value) : 0;
    if (value <= 0) return null;

    if (this.capacity === 1 && this.live.length === 1) {
      const only = this.live[0];
      if (only !== undefined) {
        only.value += value;
        return only;
      }
    }

    const orb = this.takeSlot();
    const id = this.nextId;
    this.nextId += 1;

    orb.id = id;
    orb.position.x = args.position.x;
    orb.position.y = args.position.y;
    orb.value = value;
    orb.pullSpeed = 0;

    const scatterSec = Math.max(0, this.tuning.scatterDurationMs / 1000);
    const scatterSpeed = Math.max(0, this.tuning.scatterSpeedTilesPerSecond);
    if (scatterSec > 0 && scatterSpeed > 0) {
      let dirX: number;
      let dirY: number;
      if (args.scatterDir !== undefined) {
        const len = Math.hypot(args.scatterDir.x, args.scatterDir.y);
        if (Number.isFinite(len) && len >= MIN_DIRECTION_LEN) {
          dirX = args.scatterDir.x / len;
          dirY = args.scatterDir.y / len;
        } else {
          const angle = id * GOLDEN_ANGLE_RAD;
          dirX = Math.cos(angle);
          dirY = Math.sin(angle);
        }
      } else {
        const angle = id * GOLDEN_ANGLE_RAD;
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
      }
      orb.velocity.x = dirX * scatterSpeed;
      orb.velocity.y = dirY * scatterSpeed;
      orb.scatterRemainingSec = scatterSec;
      orb.phase = 'scatter';
    } else {
      orb.velocity.x = 0;
      orb.velocity.y = 0;
      orb.scatterRemainingSec = 0;
      orb.phase = 'idle';
    }

    this.live.push(orb);
    return orb;
  }

  /**
   * Advance all active orbs by `dt` seconds toward `playerPos`, returning the total XP collected
   * on this step.
   *
   * - While `roomCleared` is `false`: orbs finish their brief scatter glide, remain idle until
   *   entering `magnetRadiusTiles * magnetRadiusMultiplier`, then accelerate smoothly toward
   *   `playerPos` and collect within `pickupRadiusTiles`.
   * - When `roomCleared` is `true`: every orb across the entire room immediately switches to
   *   `vacuum` mode and accelerates rapidly toward `playerPos` regardless of distance.
   */
  step(dt: number, playerPos: Vec2, roomCleared: boolean, magnetRadiusMultiplier = 1): number {
    this.collectedLastStep = 0;
    if (!Number.isFinite(dt) || dt <= 0 || this.live.length === 0) return 0;

    const pickupRadius = this.tuning.pickupRadiusTiles;
    const pickupRadiusSq = pickupRadius * pickupRadius;
    const safeMagnetMult =
      Number.isFinite(magnetRadiusMultiplier) && magnetRadiusMultiplier > 0
        ? magnetRadiusMultiplier
        : 1;
    const effectiveMagnetRadius = this.tuning.magnetRadiusTiles * safeMagnetMult;
    const magnetRadiusSq = effectiveMagnetRadius * effectiveMagnetRadius;
    const magnetAccel = this.tuning.magnetAccelTilesPerSecondSq;
    const magnetMaxSpeed = this.tuning.magnetMaxSpeedTilesPerSecond;
    const vacuumAccel = this.tuning.vacuumAccelTilesPerSecondSq;
    const vacuumMaxSpeed = this.tuning.vacuumMaxSpeedTilesPerSecond;

    let collectedXp = 0;
    let collectedCount = 0;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < this.live.length; readIndex += 1) {
      const orb = this.live[readIndex];
      if (orb === undefined) continue;

      if (roomCleared) {
        orb.scatterRemainingSec = 0;
        orb.phase = 'vacuum';
      } else if (orb.scatterRemainingSec > 0) {
        const glideSec = Math.min(dt, orb.scatterRemainingSec);
        // Linear ease-out glide: smoothly decelerates to rest by the end of scatterDurationMs.
        const totalScatterSec = Math.max(glideSec, this.tuning.scatterDurationMs / 1000);
        const damp = orb.scatterRemainingSec / totalScatterSec;
        orb.position.x += orb.velocity.x * damp * glideSec;
        orb.position.y += orb.velocity.y * damp * glideSec;
        orb.scatterRemainingSec -= dt;
        if (orb.scatterRemainingSec <= 0) {
          orb.scatterRemainingSec = 0;
          orb.velocity.x = 0;
          orb.velocity.y = 0;
          orb.phase = 'idle';
        }
      }

      const dx = playerPos.x - orb.position.x;
      const dy = playerPos.y - orb.position.y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= pickupRadiusSq) {
        collectedXp += orb.value;
        collectedCount += 1;
        this.recycled.push(orb);
        continue;
      }

      if (!roomCleared && orb.scatterRemainingSec <= 0 && orb.phase !== 'vacuum') {
        if (orb.phase === 'magnet' || distSq <= magnetRadiusSq) {
          orb.phase = 'magnet';
        } else {
          orb.phase = 'idle';
          orb.pullSpeed = 0;
        }
      }

      if (orb.phase === 'magnet' || orb.phase === 'vacuum') {
        const accel = orb.phase === 'vacuum' ? vacuumAccel : magnetAccel;
        const maxSpeed = orb.phase === 'vacuum' ? vacuumMaxSpeed : magnetMaxSpeed;
        orb.pullSpeed = Math.min(maxSpeed, orb.pullSpeed + accel * dt);

        const dist = Math.sqrt(distSq);
        const moveDist = orb.pullSpeed * dt;
        if (moveDist >= dist - pickupRadius) {
          collectedXp += orb.value;
          collectedCount += 1;
          this.recycled.push(orb);
          continue;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        orb.velocity.x = nx * orb.pullSpeed;
        orb.velocity.y = ny * orb.pullSpeed;
        orb.position.x += nx * moveDist;
        orb.position.y += ny * moveDist;
      }

      this.live[writeIndex] = orb;
      writeIndex += 1;
    }

    this.live.length = writeIndex;
    this.collectedLastStep = collectedCount;
    return collectedXp;
  }

  /** Recycle every active orb (e.g. on room exit or run reset). Zero allocations. */
  clear(): void {
    for (let i = 0; i < this.live.length; i += 1) {
      const orb = this.live[i];
      if (orb !== undefined) this.recycled.push(orb);
    }
    this.live.length = 0;
    this.collectedLastStep = 0;
  }

  /**
   * Reclaim a slot from `recycled`, or when full merge the oldest orb's XP into the next-oldest
   * orb and reuse the oldest slot so zero XP is ever discarded and capacity is never exceeded.
   */
  private takeSlot(): XpOrb {
    const reused = this.recycled.pop();
    if (reused !== undefined) return reused;

    const oldest = this.live.shift();
    if (oldest === undefined) {
      // Unreachable given capacity >= 1 and pre-allocation, kept for strict TS narrowing.
      return createEmptyOrb();
    }
    const survivor = this.live[0];
    if (survivor !== undefined) {
      survivor.value += oldest.value;
    }
    return oldest;
  }
}
