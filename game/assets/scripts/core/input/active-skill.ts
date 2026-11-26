/**
 * Pure Signature Active Skill recharge model & 4-class Signature Active specs (M13/M14, ADR-022).
 *
 * Signature Active skills (`E` / Right-Click) recharge through **three complementary channels**:
 * 1. Base simulation-time cooldown (`stepActiveSkill(state, dtMs)` — ~9.5–11 s per class);
 * 2. Cooldown reduction per enemy/boss hit landed (`onActiveHit` — keeps active uptime high in
 *    single-target boss arenas where no minions die);
 * 3. Cooldown reduction per enemy kill (`onActiveKill` — rewards aggressive clearing in wave rooms).
 *
 * Defines all 4 playable classes' Signature Actives driven by `CHARACTERS_TUNING`:
 * - **Ninja**: `SHADOW_BARRAGE` (`'shadow-barrage'`) + `computeShadowBarrageVolley`
 * - **Archer**: `PIERCING_VOLLEY` (`'piercing-volley'`) + `computePiercingVolley`
 * - **Mage**: `ARCANE_NOVA` (`'arcane-nova'`) + `computeArcaneNovaSpec`
 * - **Cultivator**: `TEN_THOUSAND_SWORDS` (`'ten-thousand-swords'`) + `computeTenThousandSwordsVolley`
 *
 * Pure TypeScript — zero `cc` imports.
 */
import { CHARACTERS_TUNING } from '../enemies/tuning';
import type { Vec2 } from '../math/vec2';

/** All 4 Signature Active Skill identifiers (M14). */
export const SIGNATURE_SKILL_IDS = [
  'shadow-barrage',
  'piercing-volley',
  'arcane-nova',
  'ten-thousand-swords',
] as const;

export type SignatureSkillId = (typeof SIGNATURE_SKILL_IDS)[number];

export interface ActiveSkillConfig {
  /** Base time cooldown before `cooldownMult`, milliseconds (~10 000 ms). */
  readonly cooldownMs: number;
  /** Cooldown shaved off per hit landed on any enemy or boss, milliseconds. */
  readonly hitCooldownReductionMs: number;
  /** Cooldown shaved off per enemy killed, milliseconds. */
  readonly killCooldownReductionMs: number;
}

export const DEFAULT_ACTIVE_SKILL_CONFIG: ActiveSkillConfig = {
  cooldownMs: CHARACTERS_TUNING.ninja.signature.cooldownMs,
  hitCooldownReductionMs: CHARACTERS_TUNING.ninja.signature.hitCooldownReductionMs,
  killCooldownReductionMs: CHARACTERS_TUNING.ninja.signature.killCooldownReductionMs,
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
  readonly id: SignatureSkillId;
  readonly name: string;
  readonly cooldownMs: number;
  readonly hitCooldownReductionMs: number;
  readonly killCooldownReductionMs: number;
  /** Baseline projectile count at `powerMult = 1`. */
  readonly projectileCount: number;
  /** Maximum projectile count when boosted by `activePowerMult`. */
  readonly maxProjectileCount: number;
  /** Total angular spread of the fan in radians. */
  readonly fanArcRadians: number;
  /** Launch speed in tiles/second. */
  readonly speedTilesPerSecond: number;
  /** Collision radius in tiles (pointed player projectile per ADR-016). */
  readonly radiusTiles: number;
  /** Lifetime in milliseconds. */
  readonly ttlMs: number;
  /** Base damage multiplier relative to player shot damage. */
  readonly damageMultiplier: number;
  /** Built-in enemy pierce count per projectile. */
  readonly pierceCount: number;
  /** Built-in homing guidance. */
  readonly homing: boolean;
}

export interface ArcaneNovaSpec extends SignatureActiveSpec {
  readonly id: 'arcane-nova';
  /** Base radial AoE ring radius in tiles around the player. */
  readonly radiusTilesNova: number;
  /** Base radial AoE damage multiplier relative to player shot damage. */
  readonly novaDamageMultiplier: number;
  /** Remaining enemy speed factor during chill/freeze (`0..1`, e.g. `0.35`). */
  readonly slowFactor: number;
  /** Chill/freeze duration applied to enemies hit by the nova ring, ms. */
  readonly slowDurationMs: number;
}

export interface TenThousandSwordsSpec extends SignatureActiveSpec {
  readonly id: 'ten-thousand-swords';
  /** Duration in ms to hide Cultivator's `sword-back` attachment during the sword storm. */
  readonly hideAttachmentMs: number;
  /** Attachment hide token matching `CHARACTERS.cultivator.defaultLoadout.attachmentSkillId`. */
  readonly attachmentSkillId: 'ten-thousand-swords';
}

const DEG_TO_RAD = Math.PI / 180;

const NINJA_SIG = CHARACTERS_TUNING.ninja.signature;
const ARCHER_SIG = CHARACTERS_TUNING.archer.signature;
const MAGE_SIG = CHARACTERS_TUNING.mage.signature;
const CULTIVATOR_SIG = CHARACTERS_TUNING.cultivator.signature;

/** Ninja's Signature Active skill specification (*Shadow Barrage*, GDD §15.3 / §15.4). */
export const SHADOW_BARRAGE: SignatureActiveSpec = {
  id: 'shadow-barrage',
  name: 'Shadow Barrage',
  cooldownMs: NINJA_SIG.cooldownMs,
  hitCooldownReductionMs: NINJA_SIG.hitCooldownReductionMs,
  killCooldownReductionMs: NINJA_SIG.killCooldownReductionMs,
  projectileCount: NINJA_SIG.projectileCount,
  maxProjectileCount: NINJA_SIG.maxProjectileCount,
  fanArcRadians: NINJA_SIG.fanArcDegrees * DEG_TO_RAD,
  speedTilesPerSecond: NINJA_SIG.speedTilesPerSecond,
  radiusTiles: NINJA_SIG.radiusTiles,
  ttlMs: NINJA_SIG.ttlMs,
  damageMultiplier: NINJA_SIG.damageMultiplier,
  pierceCount: NINJA_SIG.pierceCount,
  homing: NINJA_SIG.homing,
};

/** Archer's Signature Active skill specification (*Piercing Volley*, GDD §15.4). */
export const PIERCING_VOLLEY: SignatureActiveSpec = {
  id: 'piercing-volley',
  name: 'Piercing Volley',
  cooldownMs: ARCHER_SIG.cooldownMs,
  hitCooldownReductionMs: ARCHER_SIG.hitCooldownReductionMs,
  killCooldownReductionMs: ARCHER_SIG.killCooldownReductionMs,
  projectileCount: ARCHER_SIG.projectileCount,
  maxProjectileCount: ARCHER_SIG.maxProjectileCount,
  fanArcRadians: ARCHER_SIG.fanArcDegrees * DEG_TO_RAD,
  speedTilesPerSecond: ARCHER_SIG.speedTilesPerSecond,
  radiusTiles: ARCHER_SIG.radiusTiles,
  ttlMs: ARCHER_SIG.ttlMs,
  damageMultiplier: ARCHER_SIG.damageMultiplier,
  pierceCount: ARCHER_SIG.pierceCount,
  homing: ARCHER_SIG.homing,
};

/** Mage's Signature Active skill specification (*Arcane Nova*, GDD §15.4). */
export const ARCANE_NOVA: ArcaneNovaSpec = {
  id: 'arcane-nova',
  name: 'Arcane Nova',
  cooldownMs: MAGE_SIG.cooldownMs,
  hitCooldownReductionMs: MAGE_SIG.hitCooldownReductionMs,
  killCooldownReductionMs: MAGE_SIG.killCooldownReductionMs,
  projectileCount: MAGE_SIG.projectileCount,
  maxProjectileCount: MAGE_SIG.maxProjectileCount,
  fanArcRadians: MAGE_SIG.fanArcDegrees * DEG_TO_RAD,
  speedTilesPerSecond: MAGE_SIG.speedTilesPerSecond,
  radiusTiles: MAGE_SIG.radiusTiles,
  ttlMs: MAGE_SIG.ttlMs,
  damageMultiplier: MAGE_SIG.damageMultiplier,
  pierceCount: MAGE_SIG.pierceCount,
  homing: MAGE_SIG.homing,
  radiusTilesNova: MAGE_SIG.novaRadiusTiles,
  novaDamageMultiplier: MAGE_SIG.novaDamageMultiplier,
  slowFactor: MAGE_SIG.novaSlowFactor,
  slowDurationMs: MAGE_SIG.novaSlowDurationMs,
};

/** Cultivator's Signature Active skill specification (*Ten Thousand Swords*, GDD §14 / §15.4). */
export const TEN_THOUSAND_SWORDS: TenThousandSwordsSpec = {
  id: 'ten-thousand-swords',
  name: 'Ten Thousand Swords',
  cooldownMs: CULTIVATOR_SIG.cooldownMs,
  hitCooldownReductionMs: CULTIVATOR_SIG.hitCooldownReductionMs,
  killCooldownReductionMs: CULTIVATOR_SIG.killCooldownReductionMs,
  projectileCount: CULTIVATOR_SIG.projectileCount,
  maxProjectileCount: CULTIVATOR_SIG.maxProjectileCount,
  fanArcRadians: CULTIVATOR_SIG.fanArcDegrees * DEG_TO_RAD,
  speedTilesPerSecond: CULTIVATOR_SIG.speedTilesPerSecond,
  radiusTiles: CULTIVATOR_SIG.radiusTiles,
  ttlMs: CULTIVATOR_SIG.ttlMs,
  damageMultiplier: CULTIVATOR_SIG.damageMultiplier,
  pierceCount: CULTIVATOR_SIG.pierceCount,
  homing: CULTIVATOR_SIG.homing,
  hideAttachmentMs: CULTIVATOR_SIG.hideAttachmentMs,
  attachmentSkillId: 'ten-thousand-swords',
};

/** Indexed lookup of all 4 Signature Active specifications. */
export const SIGNATURE_SPECS: Readonly<Record<SignatureSkillId, SignatureActiveSpec>> = {
  'shadow-barrage': SHADOW_BARRAGE,
  'piercing-volley': PIERCING_VOLLEY,
  'arcane-nova': ARCANE_NOVA,
  'ten-thousand-swords': TEN_THOUSAND_SWORDS,
};

/** Look up a Signature Active spec by id. */
export function getSignatureSpec(id: SignatureSkillId): SignatureActiveSpec {
  return SIGNATURE_SPECS[id];
}

/** Extract the recharge config (`cooldownMs`, hit/kill CDR) for a Signature Active id. */
export function activeSkillConfigFor(id: SignatureSkillId): ActiveSkillConfig {
  const spec = SIGNATURE_SPECS[id];
  return {
    cooldownMs: spec.cooldownMs,
    hitCooldownReductionMs: spec.hitCooldownReductionMs,
    killCooldownReductionMs: spec.killCooldownReductionMs,
  };
}

export interface ShadowBarrageVolleyOptions {
  /** Override base projectile count before `powerMult` bonus (`>= 1`). */
  readonly projectileCount?: number;
  /** Player base damage multiplied by `damageMultiplier * powerMult` (defaults to `1`). */
  readonly baseDamage?: number;
  /** Override spec `damageMultiplier`. */
  readonly damageMultiplier?: number;
  /** Override total fan spread in radians. */
  readonly fanArcRadians?: number;
  /** Override launch speed in tiles/second. */
  readonly speedTilesPerSecond?: number;
  /** Forward crescent spawn offset in tiles along each projectile's launch ray (defaults to `0.35`). */
  readonly muzzleOffsetTiles?: number;
}

export type SignatureVolleyOptions = ShadowBarrageVolleyOptions;

export interface ArcaneNovaOptions {
  /** Player base damage multiplied by nova / bolt multipliers and `powerMult` (defaults to `1`). */
  readonly baseDamage?: number;
  /** Optional additional AoE radius multiplier (e.g. Mage's passive `aoePowerMult`, defaults to `1`). */
  readonly aoePowerMult?: number;
  /** Override base radial nova radius in tiles. */
  readonly radiusTiles?: number;
  /** Override outward arcane bolt count before `powerMult` bonus. */
  readonly boltCount?: number;
  /** Starting angle in radians for the radial bolt ring (defaults to `0`). */
  readonly startAngleRadians?: number;
  /** Forward spawn offset in tiles for outward arcane bolts (defaults to `0.4`). */
  readonly muzzleOffsetTiles?: number;
}

export interface TenThousandSwordsOptions extends ShadowBarrageVolleyOptions {
  /** Override duration in ms to hide `sword-back` during the cast (defaults to `1200`). */
  readonly hideAttachmentMs?: number;
}

/**
 * One planned projectile in a Signature Active volley.
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

export type SignatureProjectile = ShadowBarrageProjectile;

/** Computed cast plan for Mage's *Arcane Nova*: radial AoE ring + freeze/slow + outward bolts. */
export interface ArcaneNovaCast {
  readonly id: 'arcane-nova';
  readonly origin: Vec2;
  readonly radiusTiles: number;
  readonly damage: number;
  readonly damageMultiplier: number;
  readonly slowFactor: number;
  readonly slowDurationMs: number;
  readonly bolts: readonly SignatureProjectile[];
}

/** Computed cast plan for Cultivator's *Ten Thousand Swords*: homing spirit blades + back-sword hide timer. */
export interface TenThousandSwordsCast {
  readonly id: 'ten-thousand-swords';
  readonly projectiles: readonly SignatureProjectile[];
  readonly hideAttachmentMs: number;
  readonly attachmentSkillId: 'ten-thousand-swords';
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

function computeFanVolley(
  spec: SignatureActiveSpec,
  origin: Vec2,
  aimDir: Vec2,
  powerMult: number,
  options: SignatureVolleyOptions,
  defaultMuzzleOffset: number,
  crescentLeadRatio: number,
): SignatureProjectile[] {
  const safePower = Number.isFinite(powerMult) && powerMult > 0 ? powerMult : 1;
  const baseCount =
    options.projectileCount !== undefined && Number.isFinite(options.projectileCount)
      ? Math.max(1, Math.floor(options.projectileCount))
      : spec.projectileCount;
  const bonusProjectiles = safePower > 1 ? Math.floor((safePower - 1) * 4 + 1e-9) : 0;
  const maxCount = Math.max(baseCount, spec.maxProjectileCount);
  const count = Math.min(maxCount, baseCount + Math.max(0, bonusProjectiles));

  const baseDamage =
    options.baseDamage !== undefined && Number.isFinite(options.baseDamage)
      ? Math.max(0, options.baseDamage)
      : 1;
  const specDamageMult =
    options.damageMultiplier !== undefined && Number.isFinite(options.damageMultiplier)
      ? Math.max(0, options.damageMultiplier)
      : spec.damageMultiplier;
  const effectiveDamageMult = specDamageMult * safePower;
  const damage = baseDamage * effectiveDamageMult;

  const fanArc =
    options.fanArcRadians !== undefined && Number.isFinite(options.fanArcRadians)
      ? Math.max(0, options.fanArcRadians)
      : spec.fanArcRadians;
  const speed =
    options.speedTilesPerSecond !== undefined &&
    Number.isFinite(options.speedTilesPerSecond) &&
    options.speedTilesPerSecond > 0
      ? options.speedTilesPerSecond
      : spec.speedTilesPerSecond;
  const baseOffset =
    options.muzzleOffsetTiles !== undefined && Number.isFinite(options.muzzleOffsetTiles)
      ? Math.max(0, options.muzzleOffsetTiles)
      : defaultMuzzleOffset;

  const unitAim = normalizeAimDirection(aimDir);
  const centerAngle = Math.atan2(unitAim.y, unitAim.x);
  const safeOriginX = Number.isFinite(origin.x) ? origin.x : 0;
  const safeOriginY = Number.isFinite(origin.y) ? origin.y : 0;

  const volley: SignatureProjectile[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = count === 1 ? 0.5 : index / (count - 1);
    const angleOffsetRadians = count === 1 ? 0 : (t - 0.5) * fanArc;
    const angleRadians = centerAngle + angleOffsetRadians;
    const dx = Math.cos(angleRadians);
    const dy = Math.sin(angleRadians);

    const centerWeight = count === 1 ? 1 : 1 - Math.abs(t * 2 - 1);
    const leadTiles = baseOffset * (1 - crescentLeadRatio / 2 + crescentLeadRatio * centerWeight);

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
      radiusTiles: spec.radiusTiles,
      damage,
      damageMultiplier: effectiveDamageMult,
      ttlMs: spec.ttlMs,
      pierceRemaining: spec.pierceCount,
      homing: spec.homing,
      owner: 'player',
    });
  }

  return volley;
}

/**
 * Compute Ninja's *Shadow Barrage* crescent fan-volley around `aimDir` from `origin`.
 *
 * - Spawns `10` high-speed piercing + homing shadow shurikens at `powerMult = 1` (scaling up to
 *   `12` blades and higher per-blade damage as `powerMult` rises via `Arcane Surge` / Evolutions).
 */
export function computeShadowBarrageVolley(
  origin: Vec2,
  aimDir: Vec2,
  powerMult = 1,
  options: ShadowBarrageVolleyOptions = {},
): ShadowBarrageProjectile[] {
  return computeFanVolley(SHADOW_BARRAGE, origin, aimDir, powerMult, options, 0.35, 0.3);
}

/**
 * Compute Archer's *Piercing Volley*: a focused `36°` fan of `7` high-speed (`18` tiles/s),
 * high-pierce (`pierceRemaining = 5`) arrows scaling up to `9` arrows with `powerMult`.
 */
export function computePiercingVolley(
  origin: Vec2,
  aimDir: Vec2,
  powerMult = 1,
  options: SignatureVolleyOptions = {},
): SignatureProjectile[] {
  return computeFanVolley(PIERCING_VOLLEY, origin, aimDir, powerMult, options, 0.45, 0.25);
}

/**
 * Compute Mage's *Arcane Nova*: a radial AoE blast ring (`radiusTiles`, heavy damage,
 * freeze/slow duration) paired with an evenly spaced 360° ring of outward arcane bolts.
 */
export function computeArcaneNovaSpec(
  origin: Vec2,
  powerMult = 1,
  options: ArcaneNovaOptions = {},
): ArcaneNovaCast {
  const safePower = Number.isFinite(powerMult) && powerMult > 0 ? powerMult : 1;
  const safeAoeMult =
    options.aoePowerMult !== undefined &&
    Number.isFinite(options.aoePowerMult) &&
    options.aoePowerMult > 0
      ? options.aoePowerMult
      : 1;
  const baseDamage =
    options.baseDamage !== undefined && Number.isFinite(options.baseDamage)
      ? Math.max(0, options.baseDamage)
      : 1;
  const baseRadius =
    options.radiusTiles !== undefined &&
    Number.isFinite(options.radiusTiles) &&
    options.radiusTiles > 0
      ? options.radiusTiles
      : ARCANE_NOVA.radiusTilesNova;

  const radiusScale = 1 + (safePower - 1) * 0.25;
  const radiusTiles = baseRadius * Math.max(1, radiusScale) * safeAoeMult;
  const novaDamageMult = ARCANE_NOVA.novaDamageMultiplier * safePower;
  const damage = baseDamage * novaDamageMult;

  const baseBoltCount =
    options.boltCount !== undefined && Number.isFinite(options.boltCount)
      ? Math.max(1, Math.floor(options.boltCount))
      : ARCANE_NOVA.projectileCount;
  const bonusBolts = safePower > 1 ? Math.floor((safePower - 1) * 4 + 1e-9) : 0;
  const maxBolts = Math.max(baseBoltCount, ARCANE_NOVA.maxProjectileCount);
  const boltCount = Math.min(maxBolts, baseBoltCount + Math.max(0, bonusBolts));

  const boltDamageMult = ARCANE_NOVA.damageMultiplier * safePower;
  const boltDamage = baseDamage * boltDamageMult;
  const startAngle =
    options.startAngleRadians !== undefined && Number.isFinite(options.startAngleRadians)
      ? options.startAngleRadians
      : 0;
  const muzzleOffset =
    options.muzzleOffsetTiles !== undefined && Number.isFinite(options.muzzleOffsetTiles)
      ? Math.max(0, options.muzzleOffsetTiles)
      : 0.4;

  const safeOriginX = Number.isFinite(origin.x) ? origin.x : 0;
  const safeOriginY = Number.isFinite(origin.y) ? origin.y : 0;

  const bolts: SignatureProjectile[] = [];
  for (let index = 0; index < boltCount; index += 1) {
    const angleOffsetRadians = (index / boltCount) * Math.PI * 2;
    const angleRadians = startAngle + angleOffsetRadians;
    const dx = Math.cos(angleRadians);
    const dy = Math.sin(angleRadians);

    bolts.push({
      position: {
        x: safeOriginX + dx * muzzleOffset,
        y: safeOriginY + dy * muzzleOffset,
      },
      direction: { x: dx, y: dy },
      velocity: {
        x: dx * ARCANE_NOVA.speedTilesPerSecond,
        y: dy * ARCANE_NOVA.speedTilesPerSecond,
      },
      angleRadians,
      angleOffsetRadians,
      speedTilesPerSecond: ARCANE_NOVA.speedTilesPerSecond,
      radiusTiles: ARCANE_NOVA.radiusTiles,
      damage: boltDamage,
      damageMultiplier: boltDamageMult,
      ttlMs: ARCANE_NOVA.ttlMs,
      pierceRemaining: ARCANE_NOVA.pierceCount,
      homing: ARCANE_NOVA.homing,
      owner: 'player',
    });
  }

  return {
    id: 'arcane-nova',
    origin: { x: safeOriginX, y: safeOriginY },
    radiusTiles,
    damage,
    damageMultiplier: novaDamageMult,
    slowFactor: ARCANE_NOVA.slowFactor,
    slowDurationMs: ARCANE_NOVA.slowDurationMs,
    bolts,
  };
}

/**
 * Compute Cultivator's *Ten Thousand Swords*: `14–16` sweeping homing spirit blades around
 * `aimDir`, plus `hideAttachmentMs: 1200` so `sword-back` hides while the storm flies and
 * restores cleanly once the blades disperse (GDD §14 / §15.4).
 */
export function computeTenThousandSwordsVolley(
  origin: Vec2,
  aimDir: Vec2,
  powerMult = 1,
  options: TenThousandSwordsOptions = {},
): TenThousandSwordsCast {
  const projectiles = computeFanVolley(
    TEN_THOUSAND_SWORDS,
    origin,
    aimDir,
    powerMult,
    options,
    0.45,
    0.4,
  );
  const hideAttachmentMs =
    options.hideAttachmentMs !== undefined && Number.isFinite(options.hideAttachmentMs)
      ? Math.max(0, Math.round(options.hideAttachmentMs))
      : TEN_THOUSAND_SWORDS.hideAttachmentMs;

  return {
    id: 'ten-thousand-swords',
    projectiles,
    hideAttachmentMs,
    attachmentSkillId: TEN_THOUSAND_SWORDS.attachmentSkillId,
  };
}
