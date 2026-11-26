import { DEFAULT_COMBAT } from '../config';
import { resolveOwnedEvolutions } from './evolutions';
import { resolveOwnedSkills, type SkillTag } from './pool';

/**
 * Combat stats after stacking every owned skill and Legendary Evolution.
 *
 * Every field is the **final number** the engine uses directly (damage per shot,
 * shots per second, dash/active multipliers, …), not a raw delta. That way a component
 * reads one object and does not have to remember the multiply/add order.
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
  /** Fixed at 1 in combat skills (`Greed` removed in M13); preserved for reward callers. */
  readonly goldMultiplier: number;
  /** 0 = no Executioner. */
  readonly executeThreshold: number;
  readonly executeBonus: number;

  /** Dash cooldown multiplier (< 1 = faster cooldown, 1 = base). */
  readonly dashCooldownMult: number;
  /** Dash speed multiplier (>= 1, 1 = base). */
  readonly dashSpeedMult: number;
  /** Signature Active cooldown multiplier (< 1 = faster cooldown, 1 = base). */
  readonly activeCooldownMult: number;
  /** Signature Active power/damage multiplier (>= 1, 1 = base). */
  readonly activePowerMult: number;
  /** AoE radius / blast power multiplier (>= 1, 1 = base; boosted by Mage's Arcane Attunement). */
  readonly aoePowerMult: number;
  /** Auto-fire projectile speed, tiles/second (scaled by class Layer 1 stats). */
  readonly projectileSpeedTilesPerSecond: number;
  /** Auto-aim targeting range, tiles (scaled by class Layer 1 stats). */
  readonly targetingRangeTiles: number;
  /** Shield recharge cooldown multiplier (< 1 = faster recharge, 1 = base). */
  readonly shieldCooldownMult: number;
  /** Chance (0..0.6) to ward off incoming hit damage (`Iron Skin`). */
  readonly damageReductionChance: number;
  /** Bonus damage ratio against status-afflicted enemies (`Corrosive` / `Blightfrost`). */
  readonly statusDamageBonus: number;
  /** Active Legendary Evolution ids in deterministic order. */
  readonly activeEvolutions: readonly string[];

  /** Bounces to another enemy; absent = no bounce. */
  readonly ricochetBounces?: number;
  /** Absent = the bullet does not explode. */
  readonly explosive?: ExplosiveStat;
  /** Absent = the bullet does not track. */
  readonly homing?: boolean;
  readonly slowOnHit?: SlowOnHit;
  readonly poisonOnHit?: PoisonOnHit;
  readonly burnOnHit?: BurnOnHit;
  readonly shockOnHit?: ShockOnHit;
  readonly shield?: ShieldStat;
  readonly thorns?: ThornsStat;
  /** Hearts healed after each room; absent = no heal. */
  readonly healPerRoom?: number;
  /** Radial damage burst emitted on Dash; absent = no nova. */
  readonly dashNova?: DashNovaStat;
  /** Temporary fire-rate buff after dashing; absent = no buff. */
  readonly postDashFireRate?: PostDashFireRateStat;
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

export interface BurnOnHit {
  readonly dps: number;
  readonly durationMs: number;
}

export interface ShockOnHit {
  readonly arcs: number;
  readonly damageRatio: number;
  readonly rangeTiles: number;
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

export interface DashNovaStat {
  readonly radiusTiles: number;
  readonly damage: number;
}

export interface PostDashFireRateStat {
  readonly bonus: number;
  readonly durationMs: number;
}

/**
 * Static input of `computeDerivedStats`.
 *
 * `DEFAULT_COMBAT` (assets/scripts/core/config.ts) already has all base combat numbers, so
 * every field here is **required** — no implicit fallback when something is missing.
 */
export interface StatsBaseline {
  readonly fireRatePerSecond: number;
  readonly damage: number;
  readonly projectiles: number;
  readonly playerMaxHearts: number;
  readonly invulnerabilityMs: number;
  readonly moveSpeedTilesPerSecond: number;
  /** Optional class Layer 1 projectile speed override (defaults to `DEFAULT_COMBAT`). */
  readonly projectileSpeedTilesPerSecond?: number;
  /** Optional class Layer 1 targeting range override (defaults to `DEFAULT_COMBAT`). */
  readonly targetingRangeTiles?: number;
  /** Optional class Layer 2 starting pierce count (defaults to `0`). */
  readonly pierce?: number;
  /** Optional class Layer 2 starting crit chance in `0..1` (defaults to `0`). */
  readonly critChance?: number;
  /** Optional class Layer 2 starting crit multiplier `>= 1` (defaults to `1`). */
  readonly critMultiplier?: number;
  /** Optional class Layer 2 starting execute threshold in `0..1` (defaults to `0`). */
  readonly executeThreshold?: number;
  /** Optional class Layer 2 starting execute bonus ratio (defaults to `0`). */
  readonly executeBonus?: number;
  /** Optional class Layer 2 starting Dash cooldown multiplier (defaults to `1`). */
  readonly dashCooldownMult?: number;
  /** Optional class Layer 2 starting Signature Active cooldown multiplier (defaults to `1`). */
  readonly activeCooldownMult?: number;
  /** Optional class Layer 2 starting Signature Active power multiplier (defaults to `1`). */
  readonly activePowerMult?: number;
  /** Optional class Layer 2 starting AoE power multiplier (defaults to `1`). */
  readonly aoePowerMult?: number;
}

/**
 * Stack base skills and Legendary Evolutions into the final stats.
 *
 * Fixed order:
 * 1. Normalise stacks: floor, clamp [0, maxStacks], iterate in deterministic `SKILLS` + `EVOLUTIONS` order.
 * 2. Accumulate additive and multiplicative tag contributions.
 * 3. Apply multipliers once on the base value so skill order in `owned` never matters.
 * 4. Clamp and sanitise: every number finite, non-negative; ratios within safe bounds.
 */
export function computeDerivedStats(
  owned: ReadonlyMap<string, number>,
  base: StatsBaseline = DEFAULT_COMBAT,
): DerivedStats {
  let damageAdd = 0;
  let fireRateAdd = 0;
  let projectileAdd = 0;
  let pierce = sanitize(base.pierce ?? 0);
  let critChance = clamp01(sanitize(base.critChance ?? 0));
  let critMultiplier = Math.max(1, sanitize(base.critMultiplier ?? 1));
  let heartsAdd = 0;
  let moveSpeedAdd = 0;
  let iframeMultiplier = 1;
  let lifestealPercent = 0;
  let executeThreshold = clamp01(sanitize(base.executeThreshold ?? 0));
  let executeBonus = sanitize(base.executeBonus ?? 0);
  let ricochetBounces = 0;
  let homing = false;
  let explosiveRadius = 0;
  let explosiveRatio = 0;
  let slowFactor = 1;
  let slowDurationMs = 0;
  let poisonDps = 0;
  let poisonDurationMs = 0;
  let burnDps = 0;
  let burnDurationMs = 0;
  let shockArcs = 0;
  let shockDamageRatio = 0;
  let shockRangeTiles = 0;
  let statusDamageBonus = 0;
  let shieldCharges = 0;
  let shieldCooldownMs = Number.POSITIVE_INFINITY;
  let shieldCooldownMult = 1;
  let thornsDamage = 0;
  let healPerRoom = 0;
  let damageReductionChance = 0;
  let dashCooldownMult = base.dashCooldownMult !== undefined ? sanitize(base.dashCooldownMult) : 1;
  let dashSpeedAdd = 0;
  let dashNovaRadius = 0;
  let dashNovaDamage = 0;
  let postDashFireBonus = 0;
  let postDashFireDurationMs = 0;
  let activeCooldownMult =
    base.activeCooldownMult !== undefined ? sanitize(base.activeCooldownMult) : 1;
  const activePowerBase = base.activePowerMult !== undefined ? sanitize(base.activePowerMult) : 1;
  let activePowerAdd = 0;
  const aoePowerMult = Math.max(1, sanitize(base.aoePowerMult ?? 1));

  const applyTag = (tag: SkillTag, stacks: number): void => {
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
        pierce += (tag.amount ?? 1) * stacks;
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
      case 'shield-recharge-mult':
        shieldCooldownMult *= Math.pow(tag.factor, stacks);
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
        slowFactor = Math.min(slowFactor, tag.factor);
        slowDurationMs += tag.durationMs * stacks;
        break;
      case 'poison':
        poisonDps += tag.dps * stacks;
        poisonDurationMs = Math.max(poisonDurationMs, tag.durationMs);
        break;
      case 'burn':
        burnDps += tag.dps * stacks;
        burnDurationMs = Math.max(burnDurationMs, tag.durationMs);
        break;
      case 'shock-arc':
        shockArcs += tag.arcs * stacks;
        shockDamageRatio = Math.max(shockDamageRatio, tag.damageRatio);
        shockRangeTiles = Math.max(shockRangeTiles, tag.rangeTiles);
        break;
      case 'status-amp':
        statusDamageBonus += tag.bonusRatio * stacks;
        break;
      case 'lifesteal':
        lifestealPercent += tag.percent * stacks;
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
        explosiveRatio = Math.min(1, explosiveRatio + tag.damageRatio * stacks);
        break;
      case 'damage-reduction':
        damageReductionChance += tag.chance * stacks;
        break;
      case 'dash-cooldown-mult':
        dashCooldownMult *= Math.pow(tag.factor, stacks);
        break;
      case 'dash-speed-mult':
        dashSpeedAdd += tag.amount * stacks;
        break;
      case 'dash-nova':
        dashNovaRadius = Math.max(dashNovaRadius, tag.radiusTiles);
        dashNovaDamage += tag.damage * stacks;
        break;
      case 'post-dash-fire-rate':
        postDashFireBonus += tag.bonus * stacks;
        postDashFireDurationMs = Math.max(postDashFireDurationMs, tag.durationMs);
        break;
      case 'active-cooldown-mult':
        activeCooldownMult *= Math.pow(tag.factor, stacks);
        break;
      case 'active-power-mult':
        activePowerAdd += tag.amount * stacks;
        break;
    }
  };

  for (const skill of resolveOwnedSkills(owned)) {
    for (const tag of skill.def.tags) applyTag(tag, skill.stacks);
  }

  const ownedEvos = resolveOwnedEvolutions(owned);
  for (const evo of ownedEvos) {
    for (const tag of evo.def.tags) applyTag(tag, evo.stacks);
  }

  const safeShieldMult = clampMin(sanitize(shieldCooldownMult), 0.25);

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
    goldMultiplier: 1,
    executeThreshold: clamp01(sanitize(executeThreshold)),
    executeBonus: sanitize(executeBonus),
    dashCooldownMult: clampMin(sanitize(dashCooldownMult), 0.25),
    dashSpeedMult: sanitize(1 + dashSpeedAdd),
    activeCooldownMult: clampMin(sanitize(activeCooldownMult), 0.25),
    activePowerMult: sanitize(activePowerBase + activePowerAdd),
    aoePowerMult,
    projectileSpeedTilesPerSecond: sanitize(
      base.projectileSpeedTilesPerSecond ?? DEFAULT_COMBAT.projectileSpeedTilesPerSecond,
    ),
    targetingRangeTiles: sanitize(base.targetingRangeTiles ?? DEFAULT_COMBAT.targetingRangeTiles),
    shieldCooldownMult: safeShieldMult,
    damageReductionChance: Math.min(0.6, sanitize(damageReductionChance)),
    statusDamageBonus: sanitize(statusDamageBonus),
    activeEvolutions: ownedEvos.map((evo) => evo.def.id),
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
    ...(burnDps > 0
      ? {
          burnOnHit: {
            dps: sanitize(burnDps),
            durationMs: sanitize(burnDurationMs),
          },
        }
      : {}),
    ...(shockArcs > 0
      ? {
          shockOnHit: {
            arcs: Math.floor(shockArcs),
            damageRatio: clamp01(sanitize(shockDamageRatio)),
            rangeTiles: sanitize(shockRangeTiles),
          },
        }
      : {}),
    ...(shieldCharges > 0
      ? {
          shield: {
            charges: Math.floor(shieldCharges),
            cooldownMs: Number.isFinite(shieldCooldownMs)
              ? Math.max(0, Math.round(shieldCooldownMs * safeShieldMult))
              : 0,
          },
        }
      : {}),
    ...(thornsDamage > 0 ? { thorns: { damage: sanitize(thornsDamage) } } : {}),
    ...(healPerRoom > 0 ? { healPerRoom: sanitize(healPerRoom) } : {}),
    ...(dashNovaDamage > 0
      ? {
          dashNova: {
            radiusTiles: sanitize(dashNovaRadius),
            damage: sanitize(dashNovaDamage),
          },
        }
      : {}),
    ...(postDashFireBonus > 0
      ? {
          postDashFireRate: {
            bonus: sanitize(postDashFireBonus),
            durationMs: sanitize(postDashFireDurationMs),
          },
        }
      : {}),
  };
}

/**
 * Theoretical DPS against **one target**, used by balance tests and tooltips:
 *
 * ```text
 * dps = damage × projectiles × rate × (1 + critChance × (critMultiplier − 1))
 * ```
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

function clampMin(value: number, floor: number): number {
  return Math.max(floor, value);
}
