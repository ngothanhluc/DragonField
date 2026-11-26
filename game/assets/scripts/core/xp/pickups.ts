/**
 * Pooled physical world pickups: Gold Coins & Health Potions (M17, ADR-025).
 *
 * Pure TypeScript — zero `cc` imports, zero runtime allocations per kill/step:
 * - **Gold Coin**: dropped on enemy kills, scatter glide → idle glow → magnet pull →
 *   room-clear auto-vacuum.
 * - **Health Potion** (*Bình Hồi Máu*): rare drop (`3.5%` normal, `14%` Elite from `tuning.json`),
 *   magnet-pulled & collected only while `playerHp < playerMaxHp` (healing `25%` max HP).
 *   On room-clear auto-vacuum, any potion collected while already at full HP converts cleanly to
 *   `+5g` (`fullHpGoldBonus`) bonus gold so nothing is wasted.
 */
import {
  PICKUPS_TUNING,
  XP_TUNING,
  type HealthPotionTuning,
  type PickupsTuning,
  type XpOrbsTuning,
} from '../enemies/tuning';
import type { Vec2 } from '../math/vec2';

export type WorldPickupKind = 'gold' | 'health-potion';
export type WorldPickupPhase = 'scatter' | 'idle' | 'magnet' | 'vacuum';

export interface WorldPickup {
  id: number;
  kind: WorldPickupKind;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  /** Gold amount for `'gold'`; `0` for `'health-potion'`. */
  value: number;
  scatterRemainingSec: number;
  pullSpeed: number;
  phase: WorldPickupPhase;
}

export interface WorldPickupStepContext {
  readonly roomCleared: boolean;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly magnetRadiusMultiplier?: number;
}

export interface WorldPickupStepResult {
  /** Gold collected directly from world Gold Coins on this step. */
  goldCollected: number;
  /** Bonus gold converted from Health Potions vacuumed at full HP on this step. */
  potionGoldBonus: number;
  /** Total HP healed by Health Potions collected on this step. */
  hpHealed: number;
  /** Number of Gold Coins collected on this step. */
  coinsCollected: number;
  /** Number of Health Potions that healed the player on this step. */
  potionsHealed: number;
  /** Number of Health Potions converted to gold at full HP on this step. */
  potionsConvertedToGold: number;
}

const GOLDEN_ANGLE_RAD = 2.399963229728653;
const MIN_DIRECTION_LEN = 1e-9;

function createEmptyPickup(): WorldPickup {
  return {
    id: 0,
    kind: 'gold',
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    value: 0,
    scatterRemainingSec: 0,
    pullSpeed: 0,
    phase: 'idle',
  };
}

/** Deterministic Health Potion drop check (`3.5%` normal / `14%` Elite in `config/tuning.json`). */
export function shouldDropHealthPotion(
  elite: boolean,
  roll01: number,
  tuning: HealthPotionTuning = PICKUPS_TUNING.healthPotion,
): boolean {
  if (!Number.isFinite(roll01) || roll01 < 0 || roll01 >= 1) return false;
  const chance = elite ? tuning.dropChanceElite : tuning.dropChanceNormal;
  return chance > 0 && roll01 < chance;
}

/** HP restored by one Health Potion (`25%` of `maxHp`, rounded to >= 1 HP). */
export function healthPotionHealAmount(
  maxHp: number,
  tuning: HealthPotionTuning = PICKUPS_TUNING.healthPotion,
): number {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return 0;
  if (!Number.isFinite(tuning.healFraction) || tuning.healFraction <= 0) return 0;
  return Math.max(1, Math.round(maxHp * tuning.healFraction));
}

/**
 * Fixed-capacity pooled manager for world Gold Coins and Health Potions.
 *
 * Invariant: `size + recycledCount === capacity` at all times after construction — zero allocations
 * during `spawnGold`, `spawnHealthPotion`, `step`, or `clear`.
 */
export class WorldPickupPool {
  private readonly live: WorldPickup[] = [];
  private readonly recycled: WorldPickup[] = [];
  private nextId = 1;
  readonly capacity: number;
  readonly goldCapacity: number;
  readonly potionCapacity: number;
  private liveGoldCount = 0;
  private livePotionCount = 0;
  private readonly resultScratch: WorldPickupStepResult = {
    goldCollected: 0,
    potionGoldBonus: 0,
    hpHealed: 0,
    coinsCollected: 0,
    potionsHealed: 0,
    potionsConvertedToGold: 0,
  };

  constructor(
    private readonly pickupsTuning: PickupsTuning = PICKUPS_TUNING,
    private readonly orbPhysics: XpOrbsTuning = XP_TUNING.orbs,
  ) {
    const goldCap = pickupsTuning.goldCoinPoolCapacity;
    const potionCap = pickupsTuning.healthPotion.poolCapacity;
    if (!Number.isInteger(goldCap) || goldCap < 1) {
      throw new Error(`WorldPickupPool needs goldCoinPoolCapacity >= 1, got ${goldCap}`);
    }
    if (!Number.isInteger(potionCap) || potionCap < 1) {
      throw new Error(`WorldPickupPool needs healthPotion.poolCapacity >= 1, got ${potionCap}`);
    }
    this.goldCapacity = goldCap;
    this.potionCapacity = potionCap;
    this.capacity = goldCap + potionCap;
    for (let i = 0; i < this.capacity; i += 1) {
      this.recycled.push(createEmptyPickup());
    }
  }

  get activePickups(): readonly WorldPickup[] {
    return this.live;
  }

  get size(): number {
    return this.live.length;
  }

  get goldCount(): number {
    return this.liveGoldCount;
  }

  get potionCount(): number {
    return this.livePotionCount;
  }

  get recycledCount(): number {
    return this.recycled.length;
  }

  /** Spawn a physical Gold Coin carrying `value` gold. Returns `null` if `value <= 0`. */
  spawnGold(position: Vec2, value: number, scatterDir?: Vec2): WorldPickup | null {
    const amount = Number.isFinite(value) ? Math.floor(value) : 0;
    if (amount <= 0) return null;

    if (this.liveGoldCount >= this.goldCapacity) {
      const oldest = this.findOldestByKind('gold');
      if (oldest !== null) {
        oldest.value += amount;
        return oldest;
      }
    }

    const slot = this.recycled.pop();
    if (slot === undefined) return null;

    this.initPickup(slot, 'gold', position, amount, scatterDir);
    this.live.push(slot);
    this.liveGoldCount += 1;
    return slot;
  }

  /** Spawn a Health Potion (*Bình Hồi Máu*) at `position`. */
  spawnHealthPotion(position: Vec2, scatterDir?: Vec2): WorldPickup | null {
    if (this.livePotionCount >= this.potionCapacity) {
      const oldest = this.findOldestByKind('health-potion');
      if (oldest !== null) {
        this.initPickup(oldest, 'health-potion', position, 0, scatterDir);
        return oldest;
      }
    }

    const slot = this.recycled.pop();
    if (slot === undefined) return null;

    this.initPickup(slot, 'health-potion', position, 0, scatterDir);
    this.live.push(slot);
    this.livePotionCount += 1;
    return slot;
  }

  /**
   * Advance all active Gold Coins and Health Potions by `dtSec`.
   * Reuses an internal result object so hot combat loops perform zero allocations per frame.
   */
  step(dtSec: number, playerPos: Vec2, context: WorldPickupStepContext): WorldPickupStepResult {
    const out = this.resultScratch;
    out.goldCollected = 0;
    out.potionGoldBonus = 0;
    out.hpHealed = 0;
    out.coinsCollected = 0;
    out.potionsHealed = 0;
    out.potionsConvertedToGold = 0;

    if (!Number.isFinite(dtSec) || dtSec <= 0 || this.live.length === 0) return out;

    const pickupRadius = this.orbPhysics.pickupRadiusTiles;
    const pickupRadiusSq = pickupRadius * pickupRadius;
    const safeMagnetMult =
      context.magnetRadiusMultiplier !== undefined &&
      Number.isFinite(context.magnetRadiusMultiplier) &&
      context.magnetRadiusMultiplier > 0
        ? context.magnetRadiusMultiplier
        : 1;
    const effectiveMagnetRadius = this.orbPhysics.magnetRadiusTiles * safeMagnetMult;
    const magnetRadiusSq = effectiveMagnetRadius * effectiveMagnetRadius;
    const magnetAccel = this.orbPhysics.magnetAccelTilesPerSecondSq;
    const magnetMaxSpeed = this.orbPhysics.magnetMaxSpeedTilesPerSecond;
    const vacuumAccel = this.orbPhysics.vacuumAccelTilesPerSecondSq;
    const vacuumMaxSpeed = this.orbPhysics.vacuumMaxSpeedTilesPerSecond;
    const totalScatterSec = Math.max(1e-6, this.orbPhysics.scatterDurationMs / 1000);

    const maxHp = Number.isFinite(context.playerMaxHp) ? Math.max(1, Math.floor(context.playerMaxHp)) : 100;
    let effectiveHp = Number.isFinite(context.playerHp)
      ? Math.max(0, Math.min(maxHp, Math.floor(context.playerHp)))
      : maxHp;
    const potionHeal = healthPotionHealAmount(maxHp, this.pickupsTuning.healthPotion);
    const fullHpBonus = Math.max(0, Math.floor(this.pickupsTuning.healthPotion.fullHpGoldBonus));

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.live.length; readIndex += 1) {
      const item = this.live[readIndex];
      if (item === undefined) continue;

      const isPotion = item.kind === 'health-potion';
      const needsHeal = effectiveHp < maxHp;

      if (context.roomCleared) {
        item.scatterRemainingSec = 0;
        item.phase = 'vacuum';
      } else if (item.scatterRemainingSec > 0) {
        const glideSec = Math.min(dtSec, item.scatterRemainingSec);
        const damp = item.scatterRemainingSec / Math.max(glideSec, totalScatterSec);
        item.position.x += item.velocity.x * damp * glideSec;
        item.position.y += item.velocity.y * damp * glideSec;
        item.scatterRemainingSec -= dtSec;
        if (item.scatterRemainingSec <= 0) {
          item.scatterRemainingSec = 0;
          item.velocity.x = 0;
          item.velocity.y = 0;
          item.phase = 'idle';
        }
      }

      const dx = playerPos.x - item.position.x;
      const dy = playerPos.y - item.position.y;
      const distSq = dx * dx + dy * dy;

      const canCollectNow = !isPotion || needsHeal || context.roomCleared;

      if (canCollectNow && distSq <= pickupRadiusSq) {
        this.collect(item, maxHp, effectiveHp, potionHeal, fullHpBonus, out);
        if (isPotion && effectiveHp < maxHp) {
          effectiveHp = Math.min(maxHp, effectiveHp + potionHeal);
        }
        this.recycle(item);
        continue;
      }

      if (!context.roomCleared && item.scatterRemainingSec <= 0 && item.phase !== 'vacuum') {
        const canMagnet = !isPotion || needsHeal;
        if (canMagnet && (item.phase === 'magnet' || distSq <= magnetRadiusSq)) {
          item.phase = 'magnet';
        } else {
          item.phase = 'idle';
          item.pullSpeed = 0;
        }
      }

      if (item.phase === 'magnet' || item.phase === 'vacuum') {
        const accel = item.phase === 'vacuum' ? vacuumAccel : magnetAccel;
        const maxSpeed = item.phase === 'vacuum' ? vacuumMaxSpeed : magnetMaxSpeed;
        item.pullSpeed = Math.min(maxSpeed, item.pullSpeed + accel * dtSec);

        const dist = Math.sqrt(distSq);
        const moveDist = item.pullSpeed * dtSec;
        if (canCollectNow && moveDist >= dist - pickupRadius) {
          this.collect(item, maxHp, effectiveHp, potionHeal, fullHpBonus, out);
          if (isPotion && effectiveHp < maxHp) {
            effectiveHp = Math.min(maxHp, effectiveHp + potionHeal);
          }
          this.recycle(item);
          continue;
        }

        if (dist > MIN_DIRECTION_LEN) {
          const nx = dx / dist;
          const ny = dy / dist;
          item.velocity.x = nx * item.pullSpeed;
          item.velocity.y = ny * item.pullSpeed;
          item.position.x += nx * moveDist;
          item.position.y += ny * moveDist;
        }
      }

      this.live[writeIndex] = item;
      writeIndex += 1;
    }

    this.live.length = writeIndex;
    return out;
  }

  /** Recycle all active pickups cleanly (zero allocations). */
  clear(): void {
    for (let i = 0; i < this.live.length; i += 1) {
      const item = this.live[i];
      if (item !== undefined) this.recycled.push(item);
    }
    this.live.length = 0;
    this.liveGoldCount = 0;
    this.livePotionCount = 0;
  }

  private collect(
    item: WorldPickup,
    maxHp: number,
    effectiveHp: number,
    potionHeal: number,
    fullHpBonus: number,
    out: WorldPickupStepResult,
  ): void {
    if (item.kind === 'gold') {
      out.goldCollected += item.value;
      out.coinsCollected += 1;
      return;
    }
    if (effectiveHp < maxHp) {
      const actualHeal = Math.min(maxHp - effectiveHp, potionHeal);
      out.hpHealed += actualHeal;
      out.potionsHealed += 1;
    } else {
      out.potionGoldBonus += fullHpBonus;
      out.potionsConvertedToGold += 1;
    }
  }

  private recycle(item: WorldPickup): void {
    if (item.kind === 'gold') this.liveGoldCount = Math.max(0, this.liveGoldCount - 1);
    else this.livePotionCount = Math.max(0, this.livePotionCount - 1);
    this.recycled.push(item);
  }

  private findOldestByKind(kind: WorldPickupKind): WorldPickup | null {
    for (let i = 0; i < this.live.length; i += 1) {
      const candidate = this.live[i];
      if (candidate !== undefined && candidate.kind === kind) return candidate;
    }
    return null;
  }

  private initPickup(
    slot: WorldPickup,
    kind: WorldPickupKind,
    position: Vec2,
    value: number,
    scatterDir?: Vec2,
  ): void {
    const id = this.nextId;
    this.nextId += 1;

    slot.id = id;
    slot.kind = kind;
    slot.position.x = position.x;
    slot.position.y = position.y;
    slot.value = value;
    slot.pullSpeed = 0;

    const scatterSec = Math.max(0, this.orbPhysics.scatterDurationMs / 1000);
    const scatterSpeed = Math.max(0, this.orbPhysics.scatterSpeedTilesPerSecond);
    if (scatterSec > 0 && scatterSpeed > 0) {
      let dirX: number;
      let dirY: number;
      if (scatterDir !== undefined) {
        const len = Math.hypot(scatterDir.x, scatterDir.y);
        if (Number.isFinite(len) && len >= MIN_DIRECTION_LEN) {
          dirX = scatterDir.x / len;
          dirY = scatterDir.y / len;
        } else {
          const angle = id * GOLDEN_ANGLE_RAD + (kind === 'gold' ? 0.6 : 1.7);
          dirX = Math.cos(angle);
          dirY = Math.sin(angle);
        }
      } else {
        const angle = id * GOLDEN_ANGLE_RAD + (kind === 'gold' ? 0.6 : 1.7);
        dirX = Math.cos(angle);
        dirY = Math.sin(angle);
      }
      slot.velocity.x = dirX * scatterSpeed;
      slot.velocity.y = dirY * scatterSpeed;
      slot.scatterRemainingSec = scatterSec;
      slot.phase = 'scatter';
    } else {
      slot.velocity.x = 0;
      slot.velocity.y = 0;
      slot.scatterRemainingSec = 0;
      slot.phase = 'idle';
    }
  }
}
