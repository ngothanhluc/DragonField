/**
 * Pure Signature Active Skill recharge model & Ninja's *Shadow Barrage* volley (M13, ADR-022).
 *
 * Signature Active skills (`E` / Right-Click) recharge through **three complementary channels**:
 * 1. Base simulation-time cooldown (`stepActiveSkill(state, dtMs)` — ~10 s baseline);
 * 2. Cooldown reduction per enemy/boss hit landed (`onActiveHit` — keeps active uptime high in
 *    single-target boss arenas where no minions die);
 * 3. Cooldown reduction per enemy kill (`onActiveKill` — rewards aggressive clearing in wave rooms).
 *
 * Also defines Ninja's Signature Active spec **`SHADOW_BARRAGE`** and pure burst-geometry planner
 * `computeShadowBarrageVolley(origin, aimDir, powerMult)` producing pointed, high-velocity
 * piercing + homing shadow shurikens ready for `BulletPool.spawn` (ADR-016).
 *
 * Pure TypeScript — zero `cc` imports.
 */
import type { Vec2 } from '../math/vec2';

export interface ActiveSkillConfig {
  /** Base time cooldown before `cooldownMult`, milliseconds (~10 000 ms). */
  readonly cooldownMs: number;
  /** Cooldown shaved off per hit landed on any enemy or boss, milliseconds. */
  readonly hitCooldownReductionMs: number;
  /** Cooldown shaved off per enemy killed, milliseconds. */
  readonly killCooldownReductionMs: number;
}

export const DEFAULT_ACTIVE_SKILL_CONFIG: ActiveSkillConfig = {
  cooldownMs: 10_000,
  hitCooldownReductionMs: 200,
  killCooldownReductionMs: 650,
};

export interface ActiveSkillState {
  /** Remaining cooldown in milliseconds (`0` when ready to cast). */
  readonly cooldownRemainingMs: number;
  /** Effective total cooldown applied on the most recent cast (`cooldownMs * cooldownMult`), ms. */
  readonly cooldownTotalMs: number;
  /** Number of times the active skill has been triggered in the current run/room. */
  readonly activations: number;
}

export interface TriggerActiveResult {
  readonly triggered: boolean;
  readonly state: ActiveSkillState;
}

export interface SignatureActiveSpec {
  readonly id: 'shadow-barrage';
  readonly name: string;
  readonly cooldownMs: number;
  readonly hitCooldownReductionMs: number;
  readonly killCooldownReductionMs: number;
  /** Baseline projectile count at `powerMult = 1` (`10` shadow shurikens). */
  readonly projectileCount: number;
  /** Maximum projectile count when boosted by `activePowerMult` (`12`). */
  readonly maxProjectileCount: number;
  /** Total angular spread of the crescent fan in radians (`72°`). */
  readonly fanArcRadians: number;
  /** Launch speed in tiles/second (faster than standard auto-fire shurikens). */
  readonly speedTilesPerSecond: number;
  /** Collision radius in tiles (pointed player projectile per ADR-016). */
  readonly radiusTiles: number;
  /** Lifetime in milliseconds so blades cross full 32×18 camera views cleanly. */
  readonly ttlMs: number;
  /** Base damage multiplier relative to player shot damage (`1.5×`). */
  readonly damageMultiplier: number;
  /** Built-in enemy pierce count per shadow shuriken. */
  readonly pierceCount: number;
  /** Built-in homing guidance so outer fan blades curve onto nearby yokai/bosses. */
  readonly homing: boolean;
}

/** Ninja's Signature Active skill specification (*Shadow Barrage*, GDD §15.3 / §15.4). */
export const SHADOW_BARRAGE: SignatureActiveSpec = {
  id: 'shadow-barrage',
  name: 'Shadow Barrage',
  cooldownMs: DEFAULT_ACTIVE_SKILL_CONFIG.cooldownMs,
  hitCooldownReductionMs: DEFAULT_ACTIVE_SKILL_CONFIG.hitCooldownReductionMs,
  killCooldownReductionMs: DEFAULT_ACTIVE_SKILL_CONFIG.killCooldownReductionMs,
  projectileCount: 10,
  maxProjectileCount: 12,
  fanArcRadians: (72 * Math.PI) / 180,
  speedTilesPerSecond: 13.5,
  radiusTiles: 0.18,
  ttlMs: 1400,
  damageMultiplier: 1.5,
  pierceCount: 2,
  homing: true,
};

export interface ShadowBarrageVolleyOptions {
  /** Override base projectile count before `powerMult` bonus (`>= 1`). */
  readonly projectileCount?: number;
  /** Player base damage multiplied by `damageMultiplier * powerMult` (defaults to `1`). */
  readonly baseDamage?: number;
  /** Override spec `damageMultiplier` (defaults to `SHADOW_BARRAGE.damageMultiplier`). */
  readonly damageMultiplier?: number;
  /** Override total fan spread in radians (defaults to `SHADOW_BARRAGE.fanArcRadians`). */
  readonly fanArcRadians?: number;
  /** Override launch speed in tiles/second (defaults to `SHADOW_BARRAGE.speedTilesPerSecond`). */
  readonly speedTilesPerSecond?: number;
  /** Forward crescent spawn offset in tiles along each blade's launch ray (defaults to `0.35`). */
  readonly muzzleOffsetTiles?: number;
}

/**
 * One planned projectile in a *Shadow Barrage* burst.
 *
 * Directly compatible with `BulletPool.spawn(BulletSpawnArgs)` while also carrying normalized
 * `direction`, `angleRadians`, and `angleOffsetRadians` for VFX trails and unit tests.
 */
export interface ShadowBarrageProjectile {
  readonly position: Vec2;
  readonly direction: Vec2;
  readonly velocity: Vec2;
  readonly angleRadians: number;
  readonly angleOffsetRadians: number;
  readonly speedTilesPerSecond: number;
  readonly radiusTiles: number;
  readonly damage: number;
  readonly damageMultiplier: number;
  readonly ttlMs: number;
  readonly pierceRemaining: number;
  readonly homing: boolean;
  readonly owner: 'player';
}

const MIN_AIM_LENGTH = 1e-6;
const DEFAULT_AIM_DIR: Vec2 = { x: 1, y: 0 };

/** Construct an `ActiveSkillState` (ready immediately by default so Room 1 allows instant use). */
export function createActiveSkillState(
  startReady = true,
  initialCooldownMs: number = DEFAULT_ACTIVE_SKILL_CONFIG.cooldownMs,
): ActiveSkillState {
  const safeTotal = Number.isFinite(initialCooldownMs) ? Math.max(0, initialCooldownMs) : 0;
  if (startReady) {
    return {
      cooldownRemainingMs: 0,
      cooldownTotalMs: safeTotal,
      activations: 0,
    };
  }
  return {
    cooldownRemainingMs: safeTotal,
    cooldownTotalMs: safeTotal,
    activations: 0,
  };
}

export const initialActiveSkillState = createActiveSkillState;

/** True when the Signature Active skill is off cooldown and ready to fire. */
export function isActiveSkillReady(state: ActiveSkillState): boolean {
  return state.cooldownRemainingMs <= 0;
}

/**
 * Attempt to trigger the Signature Active skill, starting its `cooldownMs * cooldownMult` timer.
 *
 * Returns `{ triggered: false, state }` without resetting progress if still cooling down.
 */
export function tryActivateSkill(
  state: ActiveSkillState,
  config: ActiveSkillConfig = DEFAULT_ACTIVE_SKILL_CONFIG,
  cooldownMult = 1,
): TriggerActiveResult {
  if (!isActiveSkillReady(state)) {
    return { triggered: false, state };
  }

  const safeBase = Number.isFinite(config.cooldownMs) ? Math.max(0, config.cooldownMs) : 0;
  const safeMult = Number.isFinite(cooldownMult) ? Math.max(0, cooldownMult) : 1;
  const effectiveCooldownMs = safeBase * safeMult;

  return {
    triggered: true,
    state: {
      cooldownRemainingMs: effectiveCooldownMs,
      cooldownTotalMs: effectiveCooldownMs,
      activations: state.activations + 1,
    },
  };
}

export const tryTriggerActiveSkill = tryActivateSkill;

/**
 * Advance base time recharge by `dtMs` of simulation time.
 *
 * Freezes automatically when `dtMs === 0` (pause / hitstop) and clamps cleanly at `0`.
 */
export function stepActiveSkill(state: ActiveSkillState, dtMs: number): ActiveSkillState {
  if (!Number.isFinite(dtMs) || dtMs < 0) {
    throw new Error(`stepActiveSkill needs a finite dtMs >= 0, got ${dtMs}`);
  }
  if (dtMs === 0 || state.cooldownRemainingMs <= 0) {
    return state;
  }

  return {
    ...state,
    cooldownRemainingMs: Math.max(0, state.cooldownRemainingMs - dtMs),
  };
}

/**
 * Reduce remaining cooldown when player attacks hit an enemy or boss (`hitCooldownReductionMs`).
 * Ensures active skills recharge briskly during single-boss fights with zero minion kills.
 */
export function onActiveHit(
  state: ActiveSkillState,
  config: ActiveSkillConfig = DEFAULT_ACTIVE_SKILL_CONFIG,
  hits = 1,
): ActiveSkillState {
  if (state.cooldownRemainingMs <= 0 || !Number.isFinite(hits) || hits <= 0) {
    return state;
  }
  const perHit = Number.isFinite(config.hitCooldownReductionMs)
    ? Math.max(0, config.hitCooldownReductionMs)
    : 0;
  const reduction = perHit * hits;
  if (reduction <= 0) return state;

  return {
    ...state,
    cooldownRemainingMs: Math.max(0, state.cooldownRemainingMs - reduction),
  };
}

/**
 * Reduce remaining cooldown when enemies die (`killCooldownReductionMs`).
 * Rewards aggressive wave clearing without letting cooldown go negative.
 */
export function onActiveKill(
  state: ActiveSkillState,
  config: ActiveSkillConfig = DEFAULT_ACTIVE_SKILL_CONFIG,
  kills = 1,
): ActiveSkillState {
  if (state.cooldownRemainingMs <= 0 || !Number.isFinite(kills) || kills <= 0) {
    return state;
  }
  const perKill = Number.isFinite(config.killCooldownReductionMs)
    ? Math.max(0, config.killCooldownReductionMs)
    : 0;
  const reduction = perKill * kills;
  if (reduction <= 0) return state;

  return {
    ...state,
    cooldownRemainingMs: Math.max(0, state.cooldownRemainingMs - reduction),
  };
}

/** Readiness progress in `[0, 1]` (`1` when ready to cast, `0 → 1` while recharging). */
export function activeReadyRatio(state: ActiveSkillState): number {
  if (!Number.isFinite(state.cooldownRemainingMs) || state.cooldownRemainingMs <= 0) {
    return 1;
  }
  if (!Number.isFinite(state.cooldownTotalMs) || state.cooldownTotalMs <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, 1 - state.cooldownRemainingMs / state.cooldownTotalMs));
}

/** Remaining active skill cooldown in seconds (`0` when ready). */
export function activeCooldownSeconds(state: ActiveSkillState): number {
  if (!Number.isFinite(state.cooldownRemainingMs) || state.cooldownRemainingMs <= 0) {
    return 0;
  }
  return state.cooldownRemainingMs / 1000;
}

function normalizeAimDirection(aimDir: Vec2): Vec2 {
  if (!Number.isFinite(aimDir.x) || !Number.isFinite(aimDir.y)) {
    return DEFAULT_AIM_DIR;
  }
  const length = Math.hypot(aimDir.x, aimDir.y);
  if (!Number.isFinite(length) || length < MIN_AIM_LENGTH) {
    return DEFAULT_AIM_DIR;
  }
  return { x: aimDir.x / length, y: aimDir.y / length };
}

/**
 * Compute Ninja's *Shadow Barrage* crescent fan-volley around `aimDir` from `origin`.
 *
 * - Spawns `10` high-speed piercing + homing shadow shurikens at `powerMult = 1` (scaling up to
 *   `12` blades and higher per-blade damage as `powerMult` rises via `Arcane Surge` / Evolutions).
 * - Fan angles are strictly symmetric around `aimDir`, with a subtle crescent lead offset so the
 *   burst reads unmistakably as a signature ninja throw on frame 1.
 */
export function computeShadowBarrageVolley(
  origin: Vec2,
  aimDir: Vec2,
  powerMult = 1,
  options: ShadowBarrageVolleyOptions = {},
): ShadowBarrageProjectile[] {
  const safePower = Number.isFinite(powerMult) && powerMult > 0 ? powerMult : 1;
  const baseCount =
    options.projectileCount !== undefined && Number.isFinite(options.projectileCount)
      ? Math.max(1, Math.floor(options.projectileCount))
      : SHADOW_BARRAGE.projectileCount;
  const bonusBlades = safePower > 1 ? Math.floor((safePower - 1) * 4 + 1e-9) : 0;
  const maxCount = Math.max(baseCount, SHADOW_BARRAGE.maxProjectileCount);
  const count = Math.min(maxCount, baseCount + Math.max(0, bonusBlades));

  const baseDamage =
    options.baseDamage !== undefined && Number.isFinite(options.baseDamage)
      ? Math.max(0, options.baseDamage)
      : 1;
  const specDamageMult =
    options.damageMultiplier !== undefined && Number.isFinite(options.damageMultiplier)
      ? Math.max(0, options.damageMultiplier)
      : SHADOW_BARRAGE.damageMultiplier;
  const effectiveDamageMult = specDamageMult * safePower;
  const damage = baseDamage * effectiveDamageMult;

  const fanArc =
    options.fanArcRadians !== undefined && Number.isFinite(options.fanArcRadians)
      ? Math.max(0, options.fanArcRadians)
      : SHADOW_BARRAGE.fanArcRadians;
  const speed =
    options.speedTilesPerSecond !== undefined &&
    Number.isFinite(options.speedTilesPerSecond) &&
    options.speedTilesPerSecond > 0
      ? options.speedTilesPerSecond
      : SHADOW_BARRAGE.speedTilesPerSecond;
  const baseOffset =
    options.muzzleOffsetTiles !== undefined && Number.isFinite(options.muzzleOffsetTiles)
      ? Math.max(0, options.muzzleOffsetTiles)
      : 0.35;

  const unitAim = normalizeAimDirection(aimDir);
  const centerAngle = Math.atan2(unitAim.y, unitAim.x);
  const safeOriginX = Number.isFinite(origin.x) ? origin.x : 0;
  const safeOriginY = Number.isFinite(origin.y) ? origin.y : 0;

  const volley: ShadowBarrageProjectile[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const angleOffsetRadians = count === 1 ? 0 : (t - 0.5) * fanArc;
    const angleRadians = centerAngle + angleOffsetRadians;
    const dx = Math.cos(angleRadians);
    const dy = Math.sin(angleRadians);

    // Subtle crescent tip: central blades lead slightly ahead of outer flank blades.
    const centerWeight = count === 1 ? 1 : 1 - Math.abs(t * 2 - 1);
    const leadTiles = baseOffset * (0.85 + 0.3 * centerWeight);

    volley.push({
      position: {
        x: safeOriginX + dx * leadTiles,
        y: safeOriginY + dy * leadTiles,
      },
      direction: { x: dx, y: dy },
      velocity: {
        x: dx * speed,
        y: dy * speed,
      },
      angleRadians,
      angleOffsetRadians,
      speedTilesPerSecond: speed,
      radiusTiles: SHADOW_BARRAGE.radiusTiles,
      damage,
      damageMultiplier: effectiveDamageMult,
      ttlMs: SHADOW_BARRAGE.ttlMs,
      pierceRemaining: SHADOW_BARRAGE.pierceCount,
      homing: SHADOW_BARRAGE.homing,
      owner: 'player',
    });
  }

  return volley;
}
