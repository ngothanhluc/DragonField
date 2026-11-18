import { DEFAULT_COMBAT } from '../config';
import { resolveOwnedSkills } from './pool';

/**
 * Combat stats after stacking every owned skill.
 *
 * Every field is the **final number** the engine uses directly (damage per shot,
 * shots per second, …), not a factor. That way a component reads one object and
 * does not have to remember the multiply/add order.
 */
export interface DerivedStats {
  readonly damage: number;
  readonly fireRatePerSecond: number;
  readonly projectiles: number;
  readonly pierce: number;
  readonly critChance: number;
  readonly critMultiplier: number;
  readonly maxHearts: number;
  readonly moveSpeedTilesPerSecond: number;
  readonly invulnerabilityMs: number;
  readonly lifestealPercent: number;
  readonly goldMultiplier: number;
  /** 0 = no Executioner. */
  readonly executeThreshold: number;
  readonly executeBonus: number;

  /** Bounces to another enemy; absent = no bounce. */
  readonly ricochetBounces?: number;
  /** Absent = the bullet does not explode. */
  readonly explosive?: ExplosiveStat;
  /** Absent = the bullet does not track. */
  readonly homing?: boolean;
  readonly slowOnHit?: SlowOnHit;
  readonly poisonOnHit?: PoisonOnHit;
  readonly shield?: ShieldStat;
  readonly thorns?: ThornsStat;
  /** Hearts healed after each room; absent = no heal. */
  readonly healPerRoom?: number;
}

export interface SlowOnHit {
  /** Remaining speed factor, 0..1 (0.4 = 60% slower). */
  readonly factor: number;
  readonly durationMs: number;
}

export interface PoisonOnHit {
  readonly dps: number;
  readonly durationMs: number;
}

export interface ShieldStat {
  /** Number of hits blocked before recharging. */
  readonly charges: number;
  readonly cooldownMs: number;
}

export interface ThornsStat {
  readonly damage: number;
}

export interface ExplosiveStat {
  readonly radiusTiles: number;
  /** Share of the main bullet damage dealt by the explosion. */
  readonly damageRatio: number;
}

/**
 * Static input of `computeDerivedStats`.
 *
 * `DEFAULT_COMBAT` (assets/scripts/core/config.ts) already has all 9 combat numbers, so
 * every field here is **required** — no implicit fallback when something is missing. A caller
 * wanting another baseline (tests, meta upgrades) passes a full object.
 */
export interface StatsBaseline {
  readonly fireRatePerSecond: number;
  readonly damage: number;
  readonly projectiles: number;
  readonly playerMaxHearts: number;
  readonly invulnerabilityMs: number;
  readonly moveSpeedTilesPerSecond: number;
}

/**
 * Stack skills into the final stats.
 *
 * Fixed order:
 * 1. Normalise stacks: floor, clamp [0, maxStacks], iterate in `SKILLS` order.
 * 2. Add the **additive** effects (damage, projectile count, pierce, hearts, crit, gold,
 *    luck, lifesteal, execute, thorns, room heal).
 * 3. Apply the **multiplicative** effects exactly once on the base value:
 *    `rate = base × (1 + Σ)`, `speed = base × (1 + Σ)`,
 *    `i-frame = base × 1.375^stack` (the GDD says 0.8 → 1.1 s at 1 stack).
 * 4. Clamp and sanitise: every number finite, non-negative; critChance/lifesteal ≤ 1,
 *    critMultiplier ≥ 1, projectiles ≥ 1, maxHearts ≥ 1.
 *
 * Because step 3 multiplies only once, skill order in `owned` does not change the result.
 */
export function computeDerivedStats(
  owned: ReadonlyMap<string, number>,
  base: StatsBaseline = DEFAULT_COMBAT,
): DerivedStats {
  let damageAdd = 0;
  let fireRateAdd = 0;
  let projectileAdd = 0;
  let pierce = 0;
  let critChance = 0;
  let critMultiplier = 1;
  let heartsAdd = 0;
  let moveSpeedAdd = 0;
  let iframeMultiplier = 1;
  let lifestealPercent = 0;
  let goldAdd = 0;
  let executeThreshold = 0;
  let executeBonus = 0;
  let ricochetBounces = 0;
  let homing = false;
  let explosiveRadius = 0;
  let explosiveRatio = 0;
  let slowFactor = 1;
  let slowDurationMs = 0;
  let poisonDps = 0;
  let poisonDurationMs = 0;
  let shieldCharges = 0;
  let shieldCooldownMs = Number.POSITIVE_INFINITY;
  let thornsDamage = 0;
  let healPerRoom = 0;

  for (const skill of resolveOwnedSkills(owned)) {
    for (const tag of skill.def.tags) {
      const stacks = skill.stacks;

      switch (tag.kind) {
        case 'damage-add':
          damageAdd += tag.amount * stacks;
          break;
        case 'fire-rate-mult':
          fireRateAdd += tag.amount * stacks;
          break;
        case 'projectile-add':
          projectileAdd += tag.amount * stacks;
          break;
        case 'pierce-add':
          pierce += stacks;
          break;
        case 'crit-chance':
          critChance += tag.chance * stacks;
          critMultiplier = Math.max(critMultiplier, tag.multiplier);
          break;
        case 'max-hearts':
          heartsAdd += tag.amount * stacks;
          break;
        case 'heal-per-room':
          healPerRoom += tag.amount * stacks;
          break;
        case 'shield':
          shieldCharges += stacks;
          shieldCooldownMs = Math.min(shieldCooldownMs, tag.cooldownMs);
          break;
        case 'thorns':
          thornsDamage += tag.damage * stacks;
          break;
        case 'move-speed-mult':
          moveSpeedAdd += tag.amount * stacks;
          break;
        case 'iframe-mult':
          iframeMultiplier *= Math.pow(tag.amount, stacks);
          break;
        case 'slow-on-hit':
          // Several slow sources: take the strongest factor, stack the durations.
          slowFactor = Math.min(slowFactor, tag.factor);
          slowDurationMs += tag.durationMs * stacks;
          break;
        case 'poison':
          poisonDps += tag.dps * stacks;
          poisonDurationMs = Math.max(poisonDurationMs, tag.durationMs);
          break;
        case 'lifesteal':
          lifestealPercent += tag.percent * stacks;
          break;
        case 'gold-mult':
          goldAdd += tag.amount * stacks;
          break;
        case 'execute':
          executeThreshold = Math.max(executeThreshold, tag.threshold);
          executeBonus += tag.bonus * stacks;
          break;
        case 'ricochet-add':
          ricochetBounces += tag.bounces * stacks;
          break;
        case 'homing-add':
          homing = true;
          break;
        case 'explosive':
          explosiveRadius = Math.max(explosiveRadius, tag.radiusTiles);
          // 3 stacks = 150% damage; clamped to 1 so the explosion is never stronger than the main bullet.
          explosiveRatio = Math.min(1, explosiveRatio + tag.damageRatio * stacks);
          break;
      }
    }
  }

  return {
    damage: sanitize(base.damage + damageAdd),
    fireRatePerSecond: sanitize(base.fireRatePerSecond * (1 + fireRateAdd)),
    projectiles: Math.max(1, Math.round(sanitize(base.projectiles + projectileAdd))),
    pierce: Math.floor(sanitize(pierce)),
    critChance: clamp01(sanitize(critChance)),
    critMultiplier: Math.max(1, sanitize(critMultiplier)),
    maxHearts: Math.max(1, Math.floor(sanitize(base.playerMaxHearts + heartsAdd))),
    moveSpeedTilesPerSecond: sanitize(base.moveSpeedTilesPerSecond * (1 + moveSpeedAdd)),
    invulnerabilityMs: sanitize(base.invulnerabilityMs * iframeMultiplier),
    lifestealPercent: clamp01(sanitize(lifestealPercent)),
    goldMultiplier: 1 + sanitize(goldAdd),
    executeThreshold: clamp01(sanitize(executeThreshold)),
    executeBonus: sanitize(executeBonus),
    ...(ricochetBounces > 0 ? { ricochetBounces: Math.floor(ricochetBounces) } : {}),
    ...(explosiveRadius > 0
      ? { explosive: { radiusTiles: sanitize(explosiveRadius), damageRatio: explosiveRatio } }
      : {}),
    ...(homing ? { homing: true } : {}),
    ...(slowDurationMs > 0
      ? { slowOnHit: { factor: clamp01(sanitize(slowFactor)), durationMs: sanitize(slowDurationMs) } }
      : {}),
    ...(poisonDps > 0
      ? {
          poisonOnHit: {
            dps: sanitize(poisonDps),
            durationMs: sanitize(poisonDurationMs),
          },
        }
      : {}),
    ...(shieldCharges > 0
      ? {
          shield: {
            charges: Math.floor(shieldCharges),
            cooldownMs: Number.isFinite(shieldCooldownMs) ? Math.max(0, shieldCooldownMs) : 0,
          },
        }
      : {}),
    ...(thornsDamage > 0 ? { thorns: { damage: sanitize(thornsDamage) } } : {}),
    ...(healPerRoom > 0 ? { healPerRoom: sanitize(healPerRoom) } : {}),
  };
}

/**
 * Theoretical DPS against **one target**, used by balance tests and tooltips:
 *
 * ```text
 * dps = damage × projectiles × rate × (1 + critChance × (critMultiplier − 1))
 * ```
 *
 * Does not count pierce/ricochet/explosive/execute because they depend on enemy count and
 * enemy health — that is the combat tests' job, not an estimate's.
 */
export function estimateDps(stats: DerivedStats): number {
  const critExpectation = 1 + clamp01(stats.critChance) * (Math.max(1, stats.critMultiplier) - 1);
  const dps =
    sanitize(stats.damage) *
    Math.max(1, sanitize(stats.projectiles)) *
    sanitize(stats.fireRatePerSecond) *
    critExpectation;

  return sanitize(dps);
}

/** Finite, non-negative number. NaN/Infinity/negative all become 0 instead of leaking into combat. */
function sanitize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
