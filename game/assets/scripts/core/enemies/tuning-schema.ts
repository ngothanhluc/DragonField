/**
 * Schema + validator for balance tuning numbers (`game/config/tuning.json`).
 *
 * This file **does not read files and does not import `cc`** — it only takes a raw object and
 * returns a validated object. That way both call sites share exactly one rule set:
 *
 * 1. `scripts/gen-tuning.ts` (bun, at generate time) validates the JSON before emitting
 *    `tuning.generated.ts`.
 * 2. `tuning.ts` (at runtime, inside the game) re-validates the generated module as a
 *    defence layer — a broken generated file blows up immediately instead of quietly producing `NaN`.
 *
 * `parseTuning()` collects every problem by path (`enemies.roles.caster.health: …`)
 * then throws a single `Error`, same shape as `level-data.ts`.
 */
import { ENEMY_ROLES, type EnemyRole } from '../level/level-data';
import { CHAPTERS_PER_RUN } from '../run/run-state';
import {
  blockField,
  booleanField,
  describe,
  isRecord,
  joinPath,
  numberField,
  numberListField,
  numberTableField,
  parseBlock,
  parseKeyedRecord,
  ratioField,
  readBoolean,
  readNumber,
  readObject,
  readRatio,
  signedIntegerField,
  type InferBlock,
  type ProblemSink,
} from './tuning-spec';

/** Player combat numbers (GDD §3). */
export const COMBAT_SPEC = {
  /** Shots per second in the base state. */
  fireRatePerSecond: numberField({ positive: true }),
  /** Damage per base projectile. */
  damage: numberField(),
  /** Projectiles per shot in the base state. */
  projectiles: numberField({ integer: true, positive: true }),
  /** Projectile speed, tiles/second. */
  projectileSpeedTilesPerSecond: numberField({ positive: true }),
  /** Base movement speed, tiles/second. */
  moveSpeedTilesPerSecond: numberField({ positive: true }),
  /** Out-of-combat room-clear movement multiplier (1.45 = +45%). */
  roomClearSpeedMultiplier: numberField({ positive: true, min: 1 }),
  /** Base player maximum HP. */
  playerBaseMaxHp: numberField({ integer: true, positive: true }),
  /** Invulnerability after taking a hit, ms. */
  invulnerabilityMs: numberField(),
  /** Base damage when an enemy touches the player. */
  contactDamage: numberField(),
  /** Auto-aim range, tiles. */
  targetingRangeTiles: numberField({ positive: true }),
  /** Player knockback distance when hit, tiles. */
  playerKnockbackDistanceTiles: numberField({ positive: true }),
  /** Time to travel the full player knockback distance, ms. */
  playerKnockbackDurationMs: numberField({ positive: true }),
  /** Enemy knockback distance when hit by a projectile, tiles. */
  enemyKnockbackDistanceTiles: numberField(),
  /** Time to travel the full enemy knockback distance, ms. */
  enemyKnockbackDurationMs: numberField(),
  /**
   * Hitstop when a player projectile hits an enemy, ms. The whole simulation stands still
   * for this long — see `core/combat/hitstop.ts`.
   */
  enemyHitstopMs: numberField(),
  /** Time an enemy stands still after being hit by a projectile, ms. */
  enemyStaggerMs: numberField(),
} as const;

export type CombatTuning = InferBlock<typeof COMBAT_SPEC>;

/**
 * Elite chaser extra attack: telegraph, then a short pounce.
 *
 * A regular chaser has no attack besides contact, so the elite's "1 extra attack" is
 * exactly this pounce.
 */
export interface EliteChaserTuning {
  /** Telegraph duration before the pounce, ms. */
  readonly pounceTelegraphMs: number;
  /** Speed during the pounce, tiles/second. */
  readonly pounceSpeedTilesPerSecond: number;
  /** Time pouncing in a straight line, ms. */
  readonly pounceDurationMs: number;
  /** Cooldown between two pounces, ms. */
  readonly pounceCooldownMs: number;
  /** Only pounce when the player is within this range, tiles. */
  readonly pounceRangeTiles: number;
}

/** Elite caster extra attack: a fan volley instead of a single projectile. */
export interface EliteCasterTuning {
  /** Projectiles per volley; odd and >= 1 so there is a centre projectile. */
  readonly volleyShots: number;
  /** Angular offset between two adjacent projectiles, radians. */
  readonly volleySpreadRadians: number;
}

/** Elite tank extra attack: charge `extraCharges` more times, each locking a new direction. */
export interface EliteTankTuning {
  readonly extraCharges: number;
}

/** Elite bomber extra attack: wider blast radius plus a delayed second shockwave pulse (M13). */
export interface EliteBomberTuning {
  /** Multiplier applied to `roles.bomber.blastRadiusTiles` on the primary blast (>= 1). */
  readonly blastRadiusMultiplier: number;
  /** Delay between primary blast and secondary pulse, ms. */
  readonly doublePulseDelayMs: number;
  /** Multiplier applied to `roles.bomber.blastRadiusTiles` on the secondary pulse (>= 1). */
  readonly doublePulseRadiusMultiplier: number;
}

/** Elite buffer extra attack: wider, stronger haste aura and 3-orb defensive spread when solo (M13). */
export interface EliteBufferTuning {
  /** Multiplier applied to `roles.buffer.buffRadiusTiles` (>= 1). */
  readonly buffRadiusMultiplier: number;
  /** Haste speed multiplier granted by elite buffer (>= 1). */
  readonly buffSpeedMultiplier: number;
  /** Defensive orbs fired when solo (odd >= 1). */
  readonly volleyShots: number;
  /** Angular spread between adjacent defensive orbs, radians. */
  readonly volleySpreadRadians: number;
}

/** Elite dasher extra attack: chains `extraCharges` follow-up dashes, re-locking onto the player (M18). */
export interface EliteDasherTuning {
  readonly extraCharges: number;
}

/** Elite gunner extra attack: fires a second staggered alternating fan volley after `staggerDelayMs` (M18). */
export interface EliteGunnerTuning {
  /** Delay before the second staggered alternating fan volley fires, ms. */
  readonly staggerDelayMs: number;
  /** Fraction of `gunnerSpreadRadians` to shift the second volley so gaps alternate (e.g. `0.5`). */
  readonly staggerAngleOffsetFactor: number;
}

/** Every number specific to the elite version (GDD §4 + M3 + M13 + M18). */
export interface EliteTuning {
  /** Node scale relative to the regular version (GDD §4: 1.15). */
  readonly scale: number;
  readonly chaser: EliteChaserTuning;
  readonly caster: EliteCasterTuning;
  readonly tank: EliteTankTuning;
  readonly bomber: EliteBomberTuning;
  readonly buffer: EliteBufferTuning;
  readonly dasher: EliteDasherTuning;
  readonly gunner: EliteGunnerTuning;
}

/** Tier-2 enemy AI escalation parameters (M13/M18, GDD §15.3): predictive aim, bursts, and flanking. */
export interface EnemyAiTuning {
  /** First chapter (1-based) where regular casters use predictive lead aim. */
  readonly predictiveMinChapter: number;
  /** Lead factor in `0..1` for regular late-chapter casters. */
  readonly predictiveLeadFactor: number;
  /** Lead factor in `0..1` for elite casters. */
  readonly elitePredictiveLeadFactor: number;
  /** Hard cap on lead offset distance, tiles (so perpendicular dodges/Dash beat it cleanly). */
  readonly predictiveMaxLeadTiles: number;
  /** First chapter (1-based) where regular casters fire a multi-shot burst. */
  readonly casterBurstMinChapter: number;
  /** Projectiles per regular late-chapter caster burst. */
  readonly casterBurstShots: number;
  /** Angular spacing between burst projectiles, radians. */
  readonly casterBurstSpreadRadians: number;
  /** First chapter (1-based) where elite casters upgrade to the wider fan volley. */
  readonly eliteCasterLateMinChapter: number;
  /** Projectiles per late-chapter elite caster fan. */
  readonly eliteCasterLateVolleyShots: number;
  /** Lateral flank approach angle for chasers/dashers, radians. */
  readonly flankAngleRadians: number;
  /** Below this distance, flanking chasers collapse directly onto the player, tiles. */
  readonly flankMinDistanceTiles: number;
  /** Above this distance, chasers approach directly without lateral offset, tiles. */
  readonly flankMaxDistanceTiles: number;
  /** Maximum lateral offset distance at mid-range, tiles. */
  readonly flankOffsetTiles: number;
  /** Projectiles per gunner fan volley in early chapters (M18: 3). */
  readonly gunnerVolleyShots: number;
  /** First chapter (1-based) where gunners escalate to the wider fan (M18: 3). */
  readonly gunnerLateMinChapter: number;
  /** Projectiles per gunner fan volley in late chapters (M18: 5). */
  readonly gunnerLateVolleyShots: number;
  /** Angular spacing between adjacent gunner fan projectiles, radians. */
  readonly gunnerSpreadRadians: number;
}

/**
 * Numbers for one enemy role.
 *
 * The last two fields are 0 for roles that do not use them: chaser/caster never charge, so
 * `chargeSpeedTilesPerSecond` and `chargeDurationMs` = 0. Keeping the schema flat like
 * this lets the JSON table read like a table, and the validator needs only one function in
 * place of a discriminated union keyed on `role`.
 *
 * The meaning of `preferredRange*` differs per role, matching behaviour:
 * - chaser: distance at which it stops once touching (contact range).
 * - caster: spacing band (back off when closer than `min`, step in when farther than `max`).
 * - tank: `max` is strike range — farther it walks, closer it telegraphs then charges.
 */
export interface EnemyRoleTuning {
  /** Base health before elite scaling. */
  readonly health: number;
  /** Walk speed, tiles/second. Elites keep the same speed. */
  readonly speedTilesPerSecond: number;
  /** Minimum cooldown between two attacks, ms. */
  readonly attackCooldownMs: number;
  /** Telegraph duration (attack tell), ms; 0 = no attack needs a tell. */
  readonly telegraphMs: number;
  /** Lower bound of the preferred range band, tiles. */
  readonly preferredRangeMinTiles: number;
  /** Upper bound of the preferred range band, tiles. */
  readonly preferredRangeMaxTiles: number;
  /** Contact damage (or damage per caster projectile). */
  readonly contactDamage: number;
  /** Charge speed, tiles/second; 0 = this role does not charge. */
  readonly chargeSpeedTilesPerSecond: number;
  /** Time charging in a straight line, ms; 0 = this role does not charge. */
  readonly chargeDurationMs: number;
  /**
   * Silhouette factor: node scale relative to the source frame (1 texture px = 1/16 unit).
   * Every monster in the pack uses a 16×16 frame, so a brute can only look "big" through
   * this number (M3: 1.75; elites multiply it by `enemies.elite.scale`).
   */
  readonly scale: number;
  /**
   * Per-role extras (#42). They are optional because the original chaser/caster/tank blocks
   * predate them and must not change: a role that does not use a number simply omits it.
   *
   * `sniper`: speed of its single shot, tiles/second (much faster than the caster bullet).
   */
  readonly projectileSpeedTilesPerSecond?: number;
  /** `splitter`: how many `splitling`s it leaves behind (2–3). */
  readonly splitCount?: number;
  /** `bomber`: radial AoE blast radius, tiles (M13). */
  readonly blastRadiusTiles?: number;
  /** `bomber`: radial AoE blast damage before chapter/elite scaling (M13). */
  readonly blastDamage?: number;
  /** `buffer`: haste aura radius, tiles (M13). */
  readonly buffRadiusTiles?: number;
  /** `buffer`: haste speed multiplier applied to nearby allies (M13). */
  readonly buffSpeedMultiplier?: number;
  /** `buffer`: haste aura duration, ms (M13). */
  readonly buffDurationMs?: number;
}

export interface EnemiesTuning {
  /** Elite health multiplier (GDD §4: ×2). */
  readonly eliteHealthMultiplier: number;
  /** Elite damage multiplier. */
  readonly eliteDamageMultiplier: number;
  /** Wall margin so an enemy/player centre never touches the room edge, tiles. */
  readonly roomEdgeMarginTiles: number;
  /** Elite-only numbers: scale, extra attack per role. */
  readonly elite: EliteTuning;
  /** Tier-2 AI numbers: predictive lead, late-chapter bursts, flanking chasers (M13). */
  readonly ai: EnemyAiTuning;
  readonly roles: Readonly<Record<EnemyRole, EnemyRoleTuning>>;
}

/** Enemy total range of one chapter's normal rooms (index 0 = chapter 1). */
export interface ChapterWaveTotal {
  /** Fewest enemies a normal room of this chapter spawns. */
  readonly min: number;
  /** Most enemies a normal room of this chapter spawns. */
  readonly max: number;
}

/**
 * Wave delivery of a normal room (#41, GDD §13.2): the 8× enemy count arrives over time under an
 * alive cap, with fair spawn/attack rules. Read by `core/enemies/wave-scheduler.ts` and by
 * `core/enemies/behaviours.ts` (aggro radius).
 */
export interface WavesTuning {
  /** Most enemies alive at once in a normal room (the ramped cap never exceeds it). */
  readonly aliveCap: number;
  /**
   * Alive cap of the **first** room of a run. A run opens with a smaller crowd and grows from room
   * to room (see `aliveCapStepPerRoom`), so a fresh chapter's room 1 is a fair fight against a
   * 0-skill player instead of the full late-room wave.
   */
  readonly aliveCapStart: number;
  /** Added to the alive cap per run slot; `cap(slot) = min(aliveCap, aliveCapStart + step·(slot-1))`. */
  readonly aliveCapStepPerRoom: number;
  /** Simulated time between two spawn batches, ms. */
  readonly spawnIntervalMs: number;
  /** Enemies per batch; the alive cap still wins when fewer slots are free. */
  readonly spawnBatchSize: number;
  /** Seeded scatter around a room's authored spawn point, tiles. */
  readonly spawnJitterTiles: number;
  /** How long an on-screen spawn shows its telegraph before it becomes active, ms. */
  readonly telegraphMs: number;
  /** A spawn is never closer to the player than this, tiles. */
  readonly minSpawnDistanceTiles: number;
  /**
   * Preferred upper bound of the spawn distance, tiles (0 = no bound): a room's authored points
   * are spread over 16 screens, so without this the far corner feeds enemies that take 20+ s to
   * walk in and the room stops responding to the player's damage. Spawns outside the band are
   * used only when no free point inside it exists.
   */
  readonly maxSpawnDistanceTiles: number;
  /** Enemies farther from the player than this idle instead of walking toward it, tiles. */
  readonly aggroRadiusTiles: number;
  /** Per chapter: the room total range (one entry per chapter). */
  readonly chapterTotals: readonly ChapterWaveTotal[];
}

/** Meteor (`mage-meteor`): periodic heavy AoE on the densest cluster. */
export const MAGE_METEOR_SPEC = {
  /** Interval at 1 stack, ms. */
  intervalMs: numberField({ positive: true }),
  /** Shorter interval per extra stack, ms (subtracted from `intervalMs`). */
  intervalStepMs: numberField(),
  /** Meteor AoE radius, tiles. */
  radiusTiles: numberField({ positive: true }),
  /** AoE damage as a multiple of the player's per-shot damage. */
  damageRatio: numberField({ positive: true }),
  /** Burn DPS as a multiple of the player's per-shot damage. */
  burnDpsRatio: numberField(),
  /** Burn duration, ms. */
  burnDurationMs: numberField({ integer: true }),
} as const;

export type MageMeteorTuning = InferBlock<typeof MAGE_METEOR_SPEC>;

/** Frost Orbs (`mage-frost-orbs`): orbiting contact spheres. */
export const MAGE_FROST_ORBS_SPEC = {
  /** Orbs at 1 stack. */
  baseCount: numberField({ integer: true }),
  /** Extra orbs per additional stack. */
  countPerStack: numberField({ integer: true }),
  /** Orbit radius around the Mage, tiles. */
  radiusTiles: numberField({ positive: true }),
  /** Orbit angular speed at base, radians/second. */
  orbitRadiansPerSecond: numberField({ positive: true }),
  /** Orbit speed multiplier while the Evolution is owned. */
  evolvedOrbitMultiplier: numberField({ positive: true }),
  /** Contact radius of one orb, tiles. */
  hitRadiusTiles: numberField({ positive: true }),
  /** Contact DPS as a multiple of the player's per-shot damage. */
  damagePerSecondRatio: numberField({ positive: true }),
  /** Heavy slow speed factor `0..1` on contact. */
  slowFactor: ratioField(),
  /** Slow duration, ms. */
  slowDurationMs: numberField({ integer: true }),
} as const;

export type MageFrostOrbsTuning = InferBlock<typeof MAGE_FROST_ORBS_SPEC>;

/** Storm Strike (`mage-storm-strike`): on-hit lightning proc. */
export const MAGE_STORM_STRIKE_SPEC = {
  /** Proc chance at 1 stack. */
  procChance: ratioField(),
  /** Extra proc chance per additional stack. */
  procChancePerStack: ratioField(),
  /** Bolt damage as a multiple of the player's per-shot damage. */
  damageRatio: numberField({ positive: true }),
} as const;

export type MageStormStrikeTuning = InferBlock<typeof MAGE_STORM_STRIKE_SPEC>;

/** Arcane Pulse (`mage-arcane-pulse`): every-Nth-shot ring. */
export const MAGE_ARCANE_PULSE_SPEC = {
  /** Ring fires on every Nth auto-fire shot. */
  shotEvery: numberField({ integer: true, positive: true }),
  /** Ring radius, tiles. */
  radiusTiles: numberField({ positive: true }),
  /** Ring damage at 1 stack, as a multiple of the player's per-shot damage. */
  damageRatio: numberField(),
  /** Extra damage ratio per additional stack. */
  damageRatioPerStack: numberField(),
} as const;

export type MageArcanePulseTuning = InferBlock<typeof MAGE_ARCANE_PULSE_SPEC>;

/** Elemental Cataclysm (`mage-elemental-cataclysm`): Evolution extras. */
export const MAGE_EVOLUTION_SPEC = {
  /** Ice-shard launch interval, ms. */
  shardIntervalMs: numberField({ integer: true, positive: true }),
  /** Shard damage as a multiple of the player's per-shot damage. */
  shardDamageRatio: numberField({ positive: true }),
  /** Orb damage multiplier against ignited (burning) foes. */
  shatterBurnMultiplier: numberField({ positive: true }),
} as const;

export type MageEvolutionTuning = InferBlock<typeof MAGE_EVOLUTION_SPEC>;

/** One class's exclusive-skill tuning block. */
export const MAGE_SPEC = {
  meteor: blockField(MAGE_METEOR_SPEC),
  frostOrbs: blockField(MAGE_FROST_ORBS_SPEC),
  stormStrike: blockField(MAGE_STORM_STRIKE_SPEC),
  arcanePulse: blockField(MAGE_ARCANE_PULSE_SPEC),
  evolution: blockField(MAGE_EVOLUTION_SPEC),
} as const;

export type MageClassSkillsTuning = InferBlock<typeof MAGE_SPEC>;

export interface TuningConfig {
  /** Bump when a field changes meaning, so old saves/replays can tell. */
  readonly version: number;
  readonly combat: CombatTuning;
  /** Per-chapter scale factors (GDD §4): each chapter is harder, not just busier. */
  readonly chapters: ChapterScalingTuning;
  readonly enemies: EnemiesTuning;
  /** Enemy navigation (#34): flow-field rebuild throttle and the stuck guard. */
  readonly navigation: NavigationTuning;
  /** Follow camera (#37): deadzone, look-ahead and smoothing rates. */
  readonly camera: CameraTuning;
  /** Wave delivery of a normal room (#41): alive cap, pacing, spawn/attack fairness. */
  readonly waves: WavesTuning;
  /** "Juice" numbers (ticket #2): shake, squash, coins, damage numbers, muzzle. */
  readonly feel: FeelTuning;
  /** Depth/see-through canopies and walk-in grass (#36). Visual only — no stealth. */
  readonly cover: CoverTuning;
  /** Door choice after each normal room (#39, ADR-014). */
  readonly doors: DoorsTuning;
  /** Heal / mid-run shop / chest rooms (#40). */
  readonly specialRooms: SpecialRoomsTuning;
  /** Pooled physical world pickups: Gold Coins & Health Potions (M17, ADR-025). */
  readonly pickups: PickupsTuning;
  /** Room composition art (#67): how many walkable details a generated room scatters. */
  readonly roomArt: RoomArtTuning;
  /** Boss entrance grace window and per-chapter max health (M11 T6). */
  readonly boss: BossTuning;
  /** XP curve, orb magnet/vacuum physics, gold reroll pricing, and level-up safety wave (M12, ADR-021). */
  readonly xp: XpTuning;
  /** Player Dash action buffer, cooldown, travel speed, and i-frame window (M13, ADR-022). */
  readonly dash: DashTuning;
  /** Signature Active Skill action buffer, base + hit/kill cooldown reduction, and barrage stats (M13, ADR-022). */
  readonly activeSkill: ActiveSkillTuning;
  /** Playable 4-class unlock milestones, gold costs, base stats, passives, and signature active parameters (M14). */
  readonly characters: CharactersTuning;
  /** Class-exclusive skill numbers (M20, ADR-027; #84–#87). */
  readonly classSkills: ClassSkillsTuning;
  /** Living Village Hub population (#92): animal yard leash and plaza keep-out. */
  readonly hub: HubTuning;
}

/** Living Village Hub population numbers (#92). */
export interface HubTuning {
  /** How far (tiles) a village animal may stray from the spot the map placed it. */
  readonly animalYardLeashTiles: number;
  /** Animals never come closer than this (tiles) to the village spawn: the plaza stays people-only. */
  readonly animalPlazaKeepOutTiles: number;
}

/** Playable character IDs validated in `config/tuning.json` (M14). */
export const TUNING_CHARACTER_IDS = ['ninja', 'archer', 'mage', 'cultivator'] as const;

export type TuningCharacterId = (typeof TUNING_CHARACTER_IDS)[number];

/** Layer 1 per-class base stat deltas & multipliers relative to the `combat` baseline. */
export const CHARACTER_BASE_STATS_SPEC = {
  /** Signed integer HP delta added to `combat.playerBaseMaxHp`. */
  maxHpDelta: signedIntegerField({ min: -80, max: 200 }),
  damageMult: numberField({ positive: true }),
  fireRateMult: numberField({ positive: true }),
  moveSpeedMult: numberField({ positive: true }),
  projectileSpeedMult: numberField({ positive: true }),
  targetingRangeMult: numberField({ positive: true }),
} as const;

export type CharacterBaseStatsTuning = InferBlock<
  typeof CHARACTER_BASE_STATS_SPEC
>;

/** Layer 2 per-class starting passive parameters. */
export const CHARACTER_PASSIVE_SPEC = {
  /** Additive move-speed bonus ratio (`0.1` = +10% move speed). */
  moveSpeedBonus: numberField(),
  /** Multiplicative Dash cooldown factor (`0.85` = -15% cooldown). */
  dashCooldownMult: numberField({ positive: true }),
  /** Additive base pierce count. */
  pierceAdd: numberField({ integer: true }),
  /** Additive crit chance in `0..1`. */
  critChanceAdd: ratioField(),
  /** Minimum crit multiplier applied when crit chance > 0 (`>= 1`). */
  critMultiplier: numberField({ positive: true, min: 1 }),
  /** Multiplicative Signature Active cooldown factor (`0.8` = -20%). */
  activeCooldownMult: numberField({ positive: true }),
  /** Additive Signature Active power bonus (`0.25` = +25%). */
  activePowerBonus: numberField(),
  /** Additive AoE power bonus (`0.25` = +25%). */
  aoePowerBonus: numberField(),
  /** Multiplicative base damage bonus ratio (`0.15` = +15%). */
  damageBonus: numberField(),
  /** Execute threshold in `0..1` (`0` = disabled; `0.3` = enemies below 30% HP). */
  executeThreshold: ratioField(),
  /** Additive execute damage bonus ratio (`0.1` = +10%). */
  executeBonus: numberField(),
} as const;

export type CharacterPassiveTuning = InferBlock<
  typeof CHARACTER_PASSIVE_SPEC
>;

/** Layer 3 per-class Signature Active parameters. */
export const CHARACTER_SIGNATURE_SPEC = {
  cooldownMs: numberField({ integer: true, positive: true }),
  hitCooldownReductionMs: numberField({ integer: true }),
  killCooldownReductionMs: numberField({ integer: true }),
  projectileCount: numberField({ integer: true, positive: true }),
  maxProjectileCount: numberField({ integer: true, positive: true }),
  fanArcDegrees: numberField({ max: 360 }),
  speedTilesPerSecond: numberField({ positive: true }),
  radiusTiles: numberField({ positive: true }),
  ttlMs: numberField({ integer: true, positive: true }),
  damageMultiplier: numberField({ positive: true }),
  pierceCount: numberField({ integer: true }),
  homing: booleanField(),
  /** Radial AoE nova radius in tiles (`0` when the signature has no radial nova). */
  novaRadiusTiles: numberField(),
  /** Radial AoE nova damage multiplier (`0` when the signature has no radial nova). */
  novaDamageMultiplier: numberField(),
  /** Radial AoE slow/freeze speed factor in `0..1` (`1` = no slow). */
  novaSlowFactor: ratioField(),
  /** Radial AoE slow/freeze duration in ms (`0` = no slow). */
  novaSlowDurationMs: numberField({ integer: true }),
  /** Duration in ms to hide the worn back attachment during the signature (`0` = do not hide). */
  hideAttachmentMs: numberField({ integer: true }),
} as const;

export type CharacterSignatureTuning = InferBlock<
  typeof CHARACTER_SIGNATURE_SPEC
>;

/**
 * The barrage can never be wider than its capped projectile count. A `maxProjectileCount` of 0
 * is the fallback for an already-reported invalid value, so the rule stays quiet then instead
 * of adding a second problem for the same field.
 */
function checkSignatureProjectiles(
  signature: CharacterSignatureTuning,
  path: string,
  problems: ProblemSink,
): void {
  if (
    signature.maxProjectileCount > 0 &&
    signature.maxProjectileCount < signature.projectileCount
  ) {
    problems.add(
      `${path}.maxProjectileCount`,
      `must be >= projectileCount (${signature.projectileCount}), got ${signature.maxProjectileCount}`,
    );
  }
}

/** Complete tuning block for one playable character class. */
export const CHARACTER_SPEC = {
  /** Chapter clear milestone for free unlock (`0` = unlocked from start, `1..3` = clear Ch1..Ch3). */
  unlockChapter: signedIntegerField({ min: 0, max: CHAPTERS_PER_RUN - 1 }),
  /** Meta gold cost for early unlock (`0` for default unlocked classes). */
  unlockGoldCost: numberField({ integer: true }),
  baseStats: blockField(CHARACTER_BASE_STATS_SPEC),
  passive: blockField(CHARACTER_PASSIVE_SPEC),
  signature: blockField(CHARACTER_SIGNATURE_SPEC, checkSignatureProjectiles),
} as const;

export type CharacterTuning = InferBlock<typeof CHARACTER_SPEC>;

/** All 4 playable character tuning blocks keyed by character id. */
export type CharactersTuning = Readonly<Record<TuningCharacterId, CharacterTuning>>;

/** Mưa Tên (`archer-arrow-rain`): every-Nth-shot volley. */
export const ARROW_RAIN_SPEC = {
  /** Auto-fire shots between two volleys (1-based counter; 5 = shots 5, 10, …). */
  everyShots: numberField({ integer: true, positive: true }),
  /** Volley AoE radius, tiles. */
  radiusTiles: numberField({ positive: true }),
  /** Damage multiplier of the shot damage, one entry per stack (index 0 = 1 stack). */
  damageRatioByStack: numberListField(),
} as const;

export type ArrowRainTuning = InferBlock<typeof ARROW_RAIN_SPEC>;

/** Tên Tách Chùm (`archer-split-arrow`): first-hit split. */
export const SPLIT_ARROW_SPEC = {
  /** Projectiles spawned per split. */
  arrows: numberField({ integer: true, positive: true }),
  /** Half-angle of each split projectile off the flight direction, degrees. */
  angleDegrees: numberField({ positive: true }),
  /** Damage multiplier of the hit damage, one entry per stack. */
  damageRatioByStack: numberListField(),
} as const;

export type SplitArrowTuning = InferBlock<typeof SPLIT_ARROW_SPEC>;

/** Ấn Ký Săn Mồi (`archer-hunters-mark`): mark, then detonate on crit. */
export const HUNTERS_MARK_SPEC = {
  /** How long a mark stays armed, ms. */
  durationMs: numberField({ positive: true }),
  /** Detonation AoE radius, tiles. */
  radiusTiles: numberField({ positive: true }),
  /** Detonation damage multiplier of the hit damage, one entry per stack. */
  damageRatioByStack: numberListField(),
} as const;

export type HuntersMarkTuning = InferBlock<typeof HUNTERS_MARK_SPEC>;

/** Phong Tiễn (`archer-wind-arrow`): hit-momentum buff. */
export const WIND_ARROW_SPEC = {
  /** Momentum cap (each hit adds 1). */
  momentumCap: numberField({ integer: true, positive: true }),
  /** Gap between hits that resets momentum, ms. */
  resetMs: numberField({ positive: true }),
  /** Buff lifetime, ms. */
  buffDurationMs: numberField({ positive: true }),
  /** Additive fire-rate bonus per momentum point per skill stack (0.01 = +1%). */
  fireRatePerMomentum: numberField(),
  /** Additive projectile-speed bonus per momentum point per skill stack (0.02 = +2%). */
  projectileSpeedPerMomentum: numberField(),
} as const;

export type WindArrowTuning = InferBlock<typeof WIND_ARROW_SPEC>;

/** Thiên Tiễn Lôi Đình (`archer-sky-tempest`): radial piercing volley on each rain. */
export const SKY_TEMPEST_SPEC = {
  /** Projectiles per radial volley. */
  arrows: numberField({ integer: true, positive: true }),
  /** Enemies every volley projectile passes through. */
  pierce: numberField({ integer: true }),
  /** Damage multiplier of the shot damage. */
  damageRatio: numberField({ positive: true }),
} as const;

export type SkyTempestTuning = InferBlock<typeof SKY_TEMPEST_SPEC>;

/** Archer class-skill numbers. */
export const ARCHER_CLASS_SKILLS_SPEC = {
  arrowRain: blockField(ARROW_RAIN_SPEC),
  splitArrow: blockField(SPLIT_ARROW_SPEC),
  huntersMark: blockField(HUNTERS_MARK_SPEC),
  windArrow: blockField(WIND_ARROW_SPEC),
  skyTempest: blockField(SKY_TEMPEST_SPEC),
} as const;

export type ArcherClassSkillTuning = InferBlock<
  typeof ARCHER_CLASS_SKILLS_SPEC
>;

/** Player dash timing, speed and i-frames (ADR-022). */
export const DASH_SPEC = {
  /** Game-time action buffer window, ms (freezes during pause/hitstop). */
  bufferMs: numberField({ integer: true }),
  /** Base cooldown between dashes, ms. */
  cooldownMs: numberField({ integer: true, positive: true }),
  /** Dash movement duration, ms. */
  durationMs: numberField({ integer: true, positive: true }),
  /** Dash speed, tiles/second. */
  speedTilesPerSecond: numberField({ positive: true }),
  /** Invulnerability window granted when starting a dash, ms. */
  invulnerabilityMs: numberField({ integer: true }),
} as const;

export type DashTuning = InferBlock<typeof DASH_SPEC>;

/** Signature Active Skill tuning. */
export const ACTIVE_SKILL_SPEC = {
  /** Game-time action buffer window, ms. */
  bufferMs: numberField({ integer: true }),
} as const;

export type ActiveSkillTuning = InferBlock<typeof ACTIVE_SKILL_SPEC>;

/** Ninja exclusive skill *Phân Thân Ám Ảnh* (shadow clone) tuning. */
export const NINJA_SHADOW_CLONE_SPEC = {
  /** Clone shuriken damage as a fraction of the player's shot damage, indexed per stack. */
  damageRatioByStack: numberTableField({
    length: 3,
    positive: true,
  }),
  /** Clone lifetime, ms. */
  durationMs: numberField({ positive: true }),
  /** Time between two clone shurikens, ms. */
  fireIntervalMs: numberField({ integer: true, positive: true }),
  /** Clone auto-aim range, tiles. */
  rangeTiles: numberField({ positive: true }),
  projectileSpeedTilesPerSecond: numberField({ positive: true }),
  projectileTtlMs: numberField({ integer: true, positive: true }),
} as const;

export type NinjaShadowCloneTuning = InferBlock<
  typeof NINJA_SHADOW_CLONE_SPEC
>;

/** Ninja exclusive skill *Phi Tiêu Độc Vụ* (venom shuriken) tuning. */
export const NINJA_VENOM_SHURIKEN_SPEC = {
  /** Throw the giant venom shuriken every N auto-fire shots. */
  everyNShots: numberField({ integer: true, positive: true }),
  /** Cloud damage per tick (not per second), indexed per stack. */
  damageByStack: numberTableField({ length: 3, positive: true }),
  /** Cloud radius, tiles, indexed per stack. */
  radiusTilesByStack: numberTableField({ length: 3, positive: true }),
  /** Cloud lifetime, ms, indexed per stack. */
  durationMsByStack: numberTableField({ length: 3, positive: true }),
  /** Time between two cloud damage ticks, ms. */
  damageTickMs: numberField({ integer: true, positive: true }),
  projectileSpeedTilesPerSecond: numberField({ positive: true }),
  projectileTtlMs: numberField({ integer: true, positive: true }),
} as const;

export type NinjaVenomShurikenTuning = InferBlock<
  typeof NINJA_VENOM_SHURIKEN_SPEC
>;

/** Ninja exclusive skill *Liên Hoàn Kunai* (kunai burst) tuning. */
export const NINJA_KUNAI_BURST_SPEC = {
  /** Kunai per kill at stack 1. */
  baseKunai: numberField({ integer: true, positive: true }),
  /** Extra kunai per additional stack. */
  kunaiPerStack: numberField({ integer: true }),
  /** Damage per kunai. */
  damage: numberField({ positive: true }),
  speedTilesPerSecond: numberField({ positive: true }),
  ttlMs: numberField({ integer: true, positive: true }),
  radiusTiles: numberField({ positive: true }),
} as const;

export type NinjaKunaiBurstTuning = InferBlock<typeof NINJA_KUNAI_BURST_SPEC>;

/** Ninja exclusive skill *Bom Khói Ẩn Thân* (smoke bomb) tuning. */
export const NINJA_SMOKE_BOMB_SPEC = {
  /** Enemy speed reduction fraction inside the smoke, indexed per stack. */
  slowByStack: numberTableField({ length: 2, positive: true }),
  /** Player fire-rate bonus fraction inside the smoke, indexed per stack. */
  fireRateBonusByStack: numberTableField({ length: 2 }),
  /** Smoke radius, tiles, indexed per stack. */
  radiusTilesByStack: numberTableField({ length: 2, positive: true }),
  /** Smoke lifetime, ms, indexed per stack. */
  durationMsByStack: numberTableField({ length: 2, positive: true }),
} as const;

export type NinjaSmokeBombTuning = InferBlock<typeof NINJA_SMOKE_BOMB_SPEC>;

/** Complete Ninja class-exclusive skill tuning block. */
export const NINJA_CLASS_SKILLS_SPEC = {
  shadowClone: blockField(NINJA_SHADOW_CLONE_SPEC),
  venomShuriken: blockField(NINJA_VENOM_SHURIKEN_SPEC),
  kunaiBurst: blockField(NINJA_KUNAI_BURST_SPEC),
  smokeBomb: blockField(NINJA_SMOKE_BOMB_SPEC),
} as const;

export type NinjaClassSkillsTuning = InferBlock<
  typeof NINJA_CLASS_SKILLS_SPEC
>;

/** Cultivator exclusive skill *Ngự Kiếm Hộ Thể* (orbit swords) tuning. */
export const CULTIVATOR_ORBIT_SWORDS_SPEC = {
  /** Sword count per stack. */
  swordsByStack: numberTableField({ length: 3, integer: true, positive: true }),
  /** Time between two slash cadences, ms. */
  slashIntervalMs: numberField({ integer: true, positive: true }),
  /** Slash damage as a fraction of the player's shot damage, indexed per stack. */
  damageRatioByStack: numberTableField({ length: 3, positive: true }),
  /** How far a sword darts from the player, tiles, indexed per stack. */
  reachTilesByStack: numberTableField({ length: 3, positive: true }),
  dartSpeedTilesPerSecond: numberField({ positive: true }),
  /** Out-and-back travel time of one dart, ms. */
  dartTravelMs: numberField({ integer: true, positive: true }),
  /** Orbit radius around the player, tiles (view + mini-wave origin). */
  orbitRadiusTiles: numberField({ positive: true }),
  /** Orbit angular speed, radians/second (view + mini-wave origin). */
  orbitSpinRadiansPerSecond: numberField({ positive: true }),
} as const;

export type CultivatorOrbitSwordsTuning = InferBlock<
  typeof CULTIVATOR_ORBIT_SWORDS_SPEC
>;

/** Cultivator exclusive skill *Kiếm Trận* (sword array) tuning. */
export const CULTIVATOR_SWORD_ARRAY_SPEC = {
  /** Array radius, tiles, indexed per stack. */
  radiusTilesByStack: numberTableField({ length: 2, positive: true }),
  /** Array lifetime, ms, indexed per stack. */
  durationMsByStack: numberTableField({ length: 2, positive: true }),
  /** Damage per slice tick as a fraction of the player's shot damage, indexed per stack. */
  damageRatioByStack: numberTableField({ length: 2, positive: true }),
  /** Time between two slice ticks, ms. */
  tickMs: numberField({ integer: true, positive: true }),
} as const;

export type CultivatorSwordArrayTuning = InferBlock<
  typeof CULTIVATOR_SWORD_ARRAY_SPEC
>;

/** Cultivator exclusive skill *Kiếm Khí Bán Nguyệt* (sword qi) tuning. */
export const CULTIVATOR_SWORD_QI_SPEC = {
  /** Unleash a crescent every N auto-fire shots. */
  everyNShots: numberField({ integer: true, positive: true }),
  /** Wave damage as a fraction of the player's shot damage, indexed per stack. */
  damageRatioByStack: numberTableField({ length: 3, positive: true }),
  /** Crescent half-width, tiles, indexed per stack. */
  halfWidthTilesByStack: numberTableField({ length: 3, positive: true }),
  /** Wave travel lifetime, ms, indexed per stack. */
  durationMsByStack: numberTableField({ length: 3, positive: true }),
  speedTilesPerSecond: numberField({ positive: true }),
} as const;

export type CultivatorSwordQiTuning = InferBlock<
  typeof CULTIVATOR_SWORD_QI_SPEC
>;

/** Cultivator exclusive skill *Hộ Tâm Linh Khí* (qi barrier) tuning. */
export const CULTIVATOR_QI_BARRIER_SPEC = {
  /** Gauge charge per damaging hit in `0..1`, indexed per stack. */
  chargeByStack: numberTableField({ length: 3, positive: true, max: 1 }),
  /** Radial sword-qi waves released when the shield is raised, indexed per stack. */
  wavesByStack: numberTableField({ length: 3, integer: true, positive: true }),
  /** Wave damage as a fraction of the player's shot damage, indexed per stack. */
  waveDamageRatioByStack: numberTableField({ length: 3, positive: true }),
  /** Wave half-width, tiles, indexed per stack. */
  waveHalfWidthTilesByStack: numberTableField({ length: 3, positive: true }),
  /** Wave travel lifetime, ms, indexed per stack. */
  waveDurationMsByStack: numberTableField({ length: 3, positive: true }),
  waveSpeedTilesPerSecond: numberField({ positive: true }),
} as const;

export type CultivatorQiBarrierTuning = InferBlock<
  typeof CULTIVATOR_QI_BARRIER_SPEC
>;

/** Cultivator Class Evolution *Vạn Kiếm Quy Tông* tuning. */
export const CULTIVATOR_MYRIAD_SWORDS_SPEC = {
  /** Period between automatic Sword Arrays, ms. */
  arrayIntervalMs: numberField({ integer: true, positive: true }),
  /** Mini wave damage as a fraction of the player's shot damage. */
  miniWaveDamageRatio: numberField({ positive: true }),
  /** Mini wave half-width, tiles. */
  miniWaveRadiusTiles: numberField({ positive: true }),
  /** Mini wave travel lifetime, ms. */
  miniWaveDurationMs: numberField({ integer: true, positive: true }),
  miniWaveSpeedTilesPerSecond: numberField({ positive: true }),
} as const;

export type CultivatorMyriadSwordsTuning = InferBlock<
  typeof CULTIVATOR_MYRIAD_SWORDS_SPEC
>;

/** Complete Cultivator class-exclusive skill tuning block. */
export const CULTIVATOR_CLASS_SKILLS_SPEC = {
  orbitSwords: blockField(CULTIVATOR_ORBIT_SWORDS_SPEC),
  swordArray: blockField(CULTIVATOR_SWORD_ARRAY_SPEC),
  swordQi: blockField(CULTIVATOR_SWORD_QI_SPEC),
  qiBarrier: blockField(CULTIVATOR_QI_BARRIER_SPEC),
  myriadSwords: blockField(CULTIVATOR_MYRIAD_SWORDS_SPEC),
} as const;

export type CultivatorClassSkillsTuning = InferBlock<
  typeof CULTIVATOR_CLASS_SKILLS_SPEC
>;

/** Class-exclusive skill tuning, one block per class. */
export const CLASS_SKILLS_SPEC = {
  ninja: blockField(NINJA_CLASS_SKILLS_SPEC),
  archer: blockField(ARCHER_CLASS_SKILLS_SPEC),
  mage: blockField(MAGE_SPEC),
  cultivator: blockField(CULTIVATOR_CLASS_SKILLS_SPEC),
} as const;

export type ClassSkillsTuning = InferBlock<typeof CLASS_SKILLS_SPEC>;

/** XP level-up threshold curve: `round((baseThreshold + linearStep·i + quadraticStep·i²) · chapterMultiplier)`. */
export interface XpCurveTuning {
  /** Base XP required for level 1 → 2 before chapter scaling. */
  readonly baseThreshold: number;
  /** Linear XP increase added per subsequent level. */
  readonly linearStep: number;
  /** Quadratic XP term per level index squared so early levels arrive quickly and late levels stay paced. */
  readonly quadraticStep: number;
  /** Per-chapter threshold multiplier (index 0 = chapter 1) matching chapter enemy volume. */
  readonly chapterMultipliers: readonly number[];
}

/** Pooled XP orb scatter, magnet acceleration, pickup, and room-clear full-room vacuum physics. */
export interface XpOrbsTuning {
  /** Hard pre-allocated pool capacity (zero `new` per drop). */
  readonly poolCapacity: number;
  /** Outward scatter speed on drop, tiles/second. */
  readonly scatterSpeedTilesPerSecond: number;
  /** Duration of the initial scatter glide before settling, ms. */
  readonly scatterDurationMs: number;
  /** Radius within which orbs accelerate toward the player, tiles. */
  readonly magnetRadiusTiles: number;
  /** Radius within which an orb is collected, tiles (`<= magnetRadiusTiles`). */
  readonly pickupRadiusTiles: number;
  /** Acceleration toward player while inside magnet radius, tiles/s². */
  readonly magnetAccelTilesPerSecondSq: number;
  /** Top speed while pulled by magnet radius, tiles/s. */
  readonly magnetMaxSpeedTilesPerSecond: number;
  /** Acceleration across the whole room once `roomCleared` triggers auto-vacuum, tiles/s². */
  readonly vacuumAccelTilesPerSecondSq: number;
  /** Top speed during room-clear auto-vacuum, tiles/s. */
  readonly vacuumMaxSpeedTilesPerSecond: number;
}

/** Escalating gold cost to reroll a 1-of-3 level-up skill offer. */
export interface XpRerollTuning {
  /** Gold cost of the first reroll (`rerollsUsed = 0`). */
  readonly baseCost: number;
  /** Additional gold added for each subsequent reroll. */
  readonly costStep: number;
}

/** Safety wave emitted when closing the mid-combat level-up modal (ADR-021). */
export interface LevelUpWaveTuning {
  /** Radial reach around the player within which enemies are pushed back, tiles. */
  readonly knockbackRadiusTiles: number;
  /** Knockback distance applied to pushed enemies, tiles. */
  readonly knockbackDistanceTiles: number;
  /** Knockback duration applied to pushed enemies, ms. */
  readonly knockbackDurationMs: number;
  /** Player invulnerability window upon resuming from the level-up modal, ms (ADR-021: 600). */
  readonly resumeInvulnerabilityMs: number;
}

/** Every XP & level-up tuning number (M12, ADR-021). */
export interface XpTuning {
  readonly curve: XpCurveTuning;
  /** Base XP dropped by each enemy role (`splitling` = 0 to prevent splitter farming). */
  readonly roles: Readonly<Record<EnemyRole, number>>;
  /** XP multiplier for elite enemies (>= 1). */
  readonly eliteMultiplier: number;
  readonly orbs: XpOrbsTuning;
  readonly reroll: XpRerollTuning;
  readonly levelUpWave: LevelUpWaveTuning;
}

/**
 * Boss tuning (M11 T6).
 *
 * `introGraceMs` holds the boss idle on room entry so entering after minutes of play never
 * attacks, teleports, or lunges on frame 1. `healthByChapter` sets each chapter's boss max HP
 * (index 0 = chapter 1), keeping all balance numbers in `config/tuning.json`.
 */
export interface BossTuning {
  /** Entrance grace window before the boss starts step 0, ms. */
  readonly introGraceMs: number;
  /** Max health for each chapter's bosses (index 0 = chapter 1), positive integers. */
  readonly healthByChapter: readonly number[];
}

/**
 * Room art density (#67). `detailDensity` is the share of a room's tiles that carry a walkable
 * detail (grass tuft, pebble, bone): 0.12 means about one tile in eight. `pathStoneDensity` is the
 * share of trail cells accented with walkable stepping-stone / cobble decals.
 */
export interface RoomArtTuning {
  readonly detailDensity: number;
  readonly pathStoneDensity: number;
}

/** One weight per door reward (`xp` and `gold` are the two combat rooms). */
export interface DoorWeightsTuning {
  readonly xp: number;
  readonly gold: number;
  readonly heal: number;
  readonly shop: number;
  readonly chest: number;
}

/**
 * Door-choice numbers (#39, M12 ADR-021): the gold a `gold` door pays, the XP/elite bonuses of
 * an `xp` challenge door, the flag that enables special rooms (#40), and relative weights.
 */
export interface DoorsTuning {
  /** Extra gold paid when a room's clear reward is `gold`. */
  readonly goldBonus: number;
  /** Base bonus XP chest awarded on clearing an `xp` / Elite challenge room (scaled by chapter). */
  readonly xpBonus: number;
  /** Kill XP multiplier inside an `xp` / Elite challenge room (>= 1). */
  readonly xpRoomXpMultiplier: number;
  /** Extra elite spawns added to an `xp` / Elite challenge room (>= 0 integer). */
  readonly xpRoomExtraElites: number;
  /** Heal/shop/chest doors exist in the offer logic; #40 ships the rooms behind them. */
  readonly specialRoomsEnabled: boolean;
  /** How long the "choose a door" hint stays up after the doors open, ms (#63). */
  readonly hintMs: number;
  /** Relative weight of each reward in a door offer; all > 0 so every enabled reward comes up. */
  readonly weights: DoorWeightsTuning;
}

/** Mid-run shop prices in **meta gold** (the save's gold, GDD §13.2). */
export interface ShopPricesTuning {
  readonly common: number;
  readonly rare: number;
  readonly epic: number;
}

/** The mid-run shop: a flat heart refill plus one price per skill rarity. */
export interface ShopTuning {
  /** Price of the `heart-refill` offer (restores every heart). */
  readonly heartRefill: number;
  readonly skillPrices: ShopPricesTuning;
}

/**
 * Special-room numbers (#40, M17). Prices are in meta gold: the shop spends the same gold the save
 * keeps, so a purchase during a run means coming home with less (GDD §13.2).
 */
export interface SpecialRoomsTuning {
  /** Fraction of max HP restored by the heal NPC and mid-run shop refill (0..1, M17: 0.5). */
  readonly healFraction: number;
  /** Gold a chest gives when its seeded reward is `gold`. */
  readonly chestGold: number;
  readonly shop: ShopTuning;
}

/** Health Potion drop & healing parameters (M17, ADR-025). */
export interface HealthPotionTuning {
  /** Hard pre-allocated pool capacity (zero `new` per drop). */
  readonly poolCapacity: number;
  /** Drop chance per normal enemy kill in `0..1` (M17: 0.035 = 3.5%). */
  readonly dropChanceNormal: number;
  /** Drop chance per elite enemy kill in `0..1` (M17: 0.14 = 14%). */
  readonly dropChanceElite: number;
  /** Fraction of max HP restored on pickup in `0..1` (M17: 0.25 = 25%). */
  readonly healFraction: number;
  /** Bonus gold granted if vacuumed at room clear while player is already at full HP (M17: 5). */
  readonly fullHpGoldBonus: number;
}

/** Pooled world pickups tuning (Gold Coins + Health Potions, M17). */
export interface PickupsTuning {
  /** Hard pre-allocated pool capacity for physical world Gold Coins. */
  readonly goldCoinPoolCapacity: number;
  readonly healthPotion: HealthPotionTuning;
}

/**
 * Canopy/roof and walk-in grass numbers (#36). Read by `game/cover-view.ts`; the pure rules
 * live in `core/view/cover.ts`, which takes them as parameters.
 */
export interface CoverTuning {
  /** Opacity of a canopy/roof while the player or an enemy is under it (0..1). */
  readonly overlayAlpha: number;
  /** Opacity of an actor standing in tall grass (0..1). */
  readonly actorInCoverAlpha: number;
  /** Exponential fade rate, 1/s — `1 - exp(-fadeRate · dt)` per frame. */
  readonly fadeRate: number;
}

/**
 * Follow camera numbers (#37, ADR-018). Read by `game/world-camera.ts` and handed to the pure
 * `core/camera/follow-camera.ts`, which takes them as parameters.
 */
export interface CameraTuning {
  /** Half extents of the box deadzone around the focus, tiles. */
  readonly deadzoneHalfTiles: { readonly x: number; readonly y: number };
  /** How far ahead of the player's motion the camera aims, tiles. */
  readonly lookAheadTiles: number;
  /** Exponential smoothing rate of the centre, 1/s. */
  readonly followRate: number;
  /** Exponential smoothing rate of the look-ahead offset, 1/s. */
  readonly lookAheadRate: number;
}

/**
 * Enemy navigation numbers (#34). Engine-neutral, read by `core/enemies/navigation.ts` callers
 * (the balance sim and the game adapter pass them in, the module itself takes parameters).
 */
export interface NavigationTuning {
  /**
   * The shared flow field toward the player is rebuilt at most this often, ms — and only when
   * the player changed tile. Keeps big rooms cheap.
   */
  readonly rebuildMinMs: number;
  /** Window used by the stuck guard: walking this long without ... */
  readonly stuckWindowMs: number;
  /** ... covering this many tiles counts as stuck. */
  readonly stuckDistanceTiles: number;
  /** How long a stuck enemy follows a detour direction before trying the field again, ms. */
  readonly detourMs: number;
}

/**
 * Camera shake by trauma (0..1, additive + clamped). Each event adds trauma;
 * offset scales with trauma² so a light hit is barely visible, a heavy hit is noticeable.
 */
export interface ShakeTuning {
  /** Maximum amplitude at trauma = 1, tiles. */
  readonly maxOffsetTiles: number;
  /** Trauma lost per second (linear). */
  readonly decayPerSecond: number;
  /** Trauma when the player takes a real hit (0..1). */
  readonly playerHurt: number;
  /** Trauma when an Explosive enemy detonates (0..1). */
  readonly explosion: number;
  /** Trauma when a boss body charges into the player (0..1). */
  readonly bossCharge: number;
}

/** Squash/stretch preserving area; each event is a duration + amplitude pair. */
export interface SquashTuning {
  readonly playerTurnMs: number;
  readonly playerTurnAmount: number;
  readonly playerHurtMs: number;
  readonly playerHurtAmount: number;
  readonly enemyHitMs: number;
  readonly enemyHitAmount: number;
  readonly bossHitMs: number;
  readonly bossHitAmount: number;
}

/** Damage numbers floating up. */
export interface DamageNumberTuning {
  /** How long it lives before fully fading, ms. */
  readonly lifetimeMs: number;
  /** How many tiles it rises over its whole life. */
  readonly riseTiles: number;
  /** Labels pre-built in the pool (no `new` node per hit). */
  readonly poolSize: number;
}

/** Coins flying to the HUD gold slot when gold is collected. */
export interface CoinTuning {
  /** Coins per gold pickup (the amount is split evenly, the last coin takes the remainder). */
  readonly coinsPerPickup: number;
  /** Flight time of one coin, ms. */
  readonly durationMs: number;
  /** Each later coin starts this much later than the previous one, ms. */
  readonly staggerMs: number;
  /** Arc height above the straight line, tiles. */
  readonly arcHeightTiles: number;
  /** Coins pre-built in the pool. */
  readonly poolSize: number;
}

/** Muzzle flash per shot. */
export interface MuzzleTuning {
  /** FX width, world units. */
  readonly drawUnits: number;
  readonly lifetimeMs: number;
  /** Distance from the player centre to the muzzle tip, tiles. */
  readonly offsetTiles: number;
}

/** Weapon VFX (ticket #3): bullet trail, crit hitstop, impact sizes, aura. */
export interface VfxTuning {
  /** Milliseconds between two ghosts of the same bullet. */
  readonly trailSpawnMs: number;
  /** Ghost lifetime, ms (ghosts × spawnMs ≈ lifetime keeps the count steady). */
  readonly trailLifetimeMs: number;
  /** Ghost nodes pre-built once (no node per frame). */
  readonly trailPoolSize: number;
  /** Hitstop on a crit, ms — slightly longer than `combat.enemyHitstopMs`, damage unchanged. */
  readonly critHitstopMs: number;
  /** Width of a normal hit impact, world units. */
  readonly impactDrawUnits: number;
  /** Width of a crit impact, world units. */
  readonly critImpactDrawUnits: number;
  /** Aura ring width at the player's feet, world units. */
  readonly auraDrawUnits: number;
  /** How far below the player centre the aura sits, tiles. */
  readonly auraOffsetTiles: number;
}

/** All juice numbers (ticket #2) + weapon VFX (#3). */
export interface FeelTuning {
  readonly shake: ShakeTuning;
  readonly squash: SquashTuning;
  readonly damageNumbers: DamageNumberTuning;
  readonly coin: CoinTuning;
  readonly muzzle: MuzzleTuning;
  readonly vfx: VfxTuning;
}

/**
 * Enemy scaling per chapter. Most of the difficulty comes from the count/composition in
 * `.tmx` (GDD §4); these two arrays are the **numeric** part so chapters 2–3 are not only
 * busier but each enemy is also tougher and hits harder.
 */
export interface ChapterScalingTuning {
  /** Enemy health multiplier per chapter, index 0 = chapter 1. */
  readonly enemyHealthMultipliers: readonly number[];
  /** Enemy damage multiplier per chapter, index 0 = chapter 1. */
  readonly enemyDamageMultipliers: readonly number[];
}

/** Data source, used in error messages so whoever fixes it knows which file to open. */
export const TUNING_SOURCE_PATH = 'config/tuning.json';

const ENEMY_GROUP_FIELDS = [
  'roles',
  'eliteHealthMultiplier',
  'eliteDamageMultiplier',
  'roomEdgeMarginTiles',
  'elite',
  'ai',
] as const;

const ELITE_CHASER_FIELDS = [
  'pounceTelegraphMs',
  'pounceSpeedTilesPerSecond',
  'pounceDurationMs',
  'pounceCooldownMs',
  'pounceRangeTiles',
] as const;

const ELITE_CASTER_FIELDS = ['volleyShots', 'volleySpreadRadians'] as const;

const ELITE_TANK_FIELDS = ['extraCharges'] as const;

const ELITE_BOMBER_FIELDS = [
  'blastRadiusMultiplier',
  'doublePulseDelayMs',
  'doublePulseRadiusMultiplier',
] as const;

const ELITE_BUFFER_FIELDS = [
  'buffRadiusMultiplier',
  'buffSpeedMultiplier',
  'volleyShots',
  'volleySpreadRadians',
] as const;

const ELITE_DASHER_FIELDS = ['extraCharges'] as const;

const ELITE_GUNNER_FIELDS = ['staggerDelayMs', 'staggerAngleOffsetFactor'] as const;

const ENEMY_AI_FIELDS = [
  'predictiveMinChapter',
  'predictiveLeadFactor',
  'elitePredictiveLeadFactor',
  'predictiveMaxLeadTiles',
  'casterBurstMinChapter',
  'casterBurstShots',
  'casterBurstSpreadRadians',
  'eliteCasterLateMinChapter',
  'eliteCasterLateVolleyShots',
  'flankAngleRadians',
  'flankMinDistanceTiles',
  'flankMaxDistanceTiles',
  'flankOffsetTiles',
  'gunnerVolleyShots',
  'gunnerLateMinChapter',
  'gunnerLateVolleyShots',
  'gunnerSpreadRadians',
] as const;

const ROLE_FIELDS = [
  'health',
  'speedTilesPerSecond',
  'attackCooldownMs',
  'telegraphMs',
  'preferredRangeMinTiles',
  'preferredRangeMaxTiles',
  'contactDamage',
  'chargeSpeedTilesPerSecond',
  'chargeDurationMs',
  'scale',
] as const;

const FEEL_FIELDS = ['shake', 'squash', 'damageNumbers', 'coin', 'muzzle', 'vfx'] as const;

const NAVIGATION_FIELDS = [
  'rebuildMinMs',
  'stuckWindowMs',
  'stuckDistanceTiles',
  'detourMs',
] as const;

const WAVES_FIELDS = [
  'aliveCap',
  'aliveCapStart',
  'aliveCapStepPerRoom',
  'spawnIntervalMs',
  'spawnBatchSize',
  'spawnJitterTiles',
  'telegraphMs',
  'minSpawnDistanceTiles',
  'maxSpawnDistanceTiles',
  'aggroRadiusTiles',
  'chapterTotals',
] as const;

const CAMERA_FIELDS = [
  'deadzoneHalfTiles',
  'lookAheadTiles',
  'followRate',
  'lookAheadRate',
] as const;

const COVER_FIELDS = ['overlayAlpha', 'actorInCoverAlpha', 'fadeRate'] as const;

const DOORS_FIELDS = [
  'goldBonus',
  'xpBonus',
  'xpRoomXpMultiplier',
  'xpRoomExtraElites',
  'specialRoomsEnabled',
  'hintMs',
  'weights',
] as const;

const DOOR_WEIGHT_FIELDS = ['xp', 'gold', 'heal', 'shop', 'chest'] as const;

const SPECIAL_ROOMS_FIELDS = ['healFraction', 'chestGold', 'shop'] as const;

const SHOP_FIELDS = ['heartRefill', 'skillPrices'] as const;

const PICKUPS_FIELDS = ['goldCoinPoolCapacity', 'healthPotion'] as const;

const HEALTH_POTION_FIELDS = [
  'poolCapacity',
  'dropChanceNormal',
  'dropChanceElite',
  'healFraction',
  'fullHpGoldBonus',
] as const;

const ROOM_ART_FIELDS = ['detailDensity', 'pathStoneDensity'] as const;

const HUB_FIELDS = ['animalYardLeashTiles', 'animalPlazaKeepOutTiles'] as const;

const BOSS_FIELDS = ['introGraceMs', 'healthByChapter'] as const;

const XP_FIELDS = ['curve', 'roles', 'eliteMultiplier', 'orbs', 'reroll', 'levelUpWave'] as const;

const XP_CURVE_FIELDS = [
  'baseThreshold',
  'linearStep',
  'quadraticStep',
  'chapterMultipliers',
] as const;

const XP_ORBS_FIELDS = [
  'poolCapacity',
  'scatterSpeedTilesPerSecond',
  'scatterDurationMs',
  'magnetRadiusTiles',
  'pickupRadiusTiles',
  'magnetAccelTilesPerSecondSq',
  'magnetMaxSpeedTilesPerSecond',
  'vacuumAccelTilesPerSecondSq',
  'vacuumMaxSpeedTilesPerSecond',
] as const;

const XP_REROLL_FIELDS = ['baseCost', 'costStep'] as const;

const LEVEL_UP_WAVE_FIELDS = [
  'knockbackRadiusTiles',
  'knockbackDistanceTiles',
  'knockbackDurationMs',
  'resumeInvulnerabilityMs',
] as const;

const SHOP_PRICE_FIELDS = ['common', 'rare', 'epic'] as const;

const SHAKE_FIELDS = [
  'maxOffsetTiles',
  'decayPerSecond',
  'playerHurt',
  'explosion',
  'bossCharge',
] as const;

const SQUASH_FIELDS = [
  'playerTurnMs',
  'playerTurnAmount',
  'playerHurtMs',
  'playerHurtAmount',
  'enemyHitMs',
  'enemyHitAmount',
  'bossHitMs',
  'bossHitAmount',
] as const;

const DAMAGE_NUMBER_FIELDS = ['lifetimeMs', 'riseTiles', 'poolSize'] as const;

const COIN_FIELDS = [
  'coinsPerPickup',
  'durationMs',
  'staggerMs',
  'arcHeightTiles',
  'poolSize',
] as const;

const MUZZLE_FIELDS = ['drawUnits', 'lifetimeMs', 'offsetTiles'] as const;

const VFX_FIELDS = [
  'trailSpawnMs',
  'trailLifetimeMs',
  'trailPoolSize',
  'critHitstopMs',
  'impactDrawUnits',
  'critImpactDrawUnits',
  'auraDrawUnits',
  'auraOffsetTiles',
] as const;

/** Collect every problem then throw a single `Error` (same shape as `level-data.ts`). */
class ProblemList {
  private readonly items: string[] = [];

  add(path: string, message: string): void {
    this.items.push(`${path}: ${message}`);
  }

  throwIfAny(): void {
    if (this.items.length === 0) return;

    const details = this.items.map((item) => `  - ${item}`).join('\n');
    throw new Error(
      `${TUNING_SOURCE_PATH} is invalid (${this.items.length} problem(s))\n${details}`,
    );
  }
}

/** Read a field only when the JSON declares it (per-role extras, #42). */
function readOptionalNumber(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
  options: { readonly integer?: boolean; readonly positive?: boolean } = {},
): number | undefined {
  if (source[field] === undefined) return undefined;
  return readNumber(source, field, path, problems, options);
}

/** Read an array of exactly `length` numbers, every element finite and > 0. */
function readMultiplierArray(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
): readonly number[] {
  const fieldPath = joinPath(path, field);
  const value = source[field];
  if (!Array.isArray(value)) {
    problems.add(fieldPath, `must be an array of ${CHAPTERS_PER_RUN} numbers, got ${describe(value)}`);
    return CHAPTERS_PER_RUN_MULTIPLIERS;
  }
  if (value.length !== CHAPTERS_PER_RUN) {
    problems.add(
      fieldPath,
      `must have exactly ${CHAPTERS_PER_RUN} elements (one factor per chapter), got ${value.length}`,
    );
  }

  const result: number[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) {
      problems.add(`${fieldPath}[${index}]`, `must be a finite number > 0, got ${describe(entry)}`);
      result.push(1);
      return;
    }
    result.push(entry);
  });
  return result;
}

/** Default when the config is missing: no scaling (every chapter behaves like chapter 1). */
const CHAPTERS_PER_RUN_MULTIPLIERS: readonly number[] = Array.from(
  { length: CHAPTERS_PER_RUN },
  () => 1,
);

function zeroElite(): EliteTuning {
  return {
    scale: 1,
    chaser: {
      pounceTelegraphMs: 0,
      pounceSpeedTilesPerSecond: 0,
      pounceDurationMs: 0,
      pounceCooldownMs: 0,
      pounceRangeTiles: 0,
    },
    caster: { volleyShots: 1, volleySpreadRadians: 0 },
    tank: { extraCharges: 0 },
    bomber: {
      blastRadiusMultiplier: 1,
      doublePulseDelayMs: 0,
      doublePulseRadiusMultiplier: 1,
    },
    buffer: {
      buffRadiusMultiplier: 1,
      buffSpeedMultiplier: 1,
      volleyShots: 1,
      volleySpreadRadians: 0,
    },
    dasher: { extraCharges: 0 },
    gunner: { staggerDelayMs: 0, staggerAngleOffsetFactor: 0.5 },
  };
}

function zeroEnemyAi(): EnemyAiTuning {
  return {
    predictiveMinChapter: 3,
    predictiveLeadFactor: 0,
    elitePredictiveLeadFactor: 0,
    predictiveMaxLeadTiles: 0,
    casterBurstMinChapter: 3,
    casterBurstShots: 1,
    casterBurstSpreadRadians: 0,
    eliteCasterLateMinChapter: 3,
    eliteCasterLateVolleyShots: 3,
    flankAngleRadians: 0,
    flankMinDistanceTiles: 0,
    flankMaxDistanceTiles: 0,
    flankOffsetTiles: 0,
    gunnerVolleyShots: 3,
    gunnerLateMinChapter: 3,
    gunnerLateVolleyShots: 5,
    gunnerSpreadRadians: 0.22,
  };
}

function zeroRole(): EnemyRoleTuning {
  return {
    health: 1,
    speedTilesPerSecond: 0,
    attackCooldownMs: 0,
    telegraphMs: 0,
    preferredRangeMinTiles: 0,
    preferredRangeMaxTiles: 0,
    contactDamage: 0,
    chargeSpeedTilesPerSecond: 0,
    chargeDurationMs: 0,
    scale: 1,
  };
}

/** One zeroed block per role, so a missing config still has every key. */
function zeroRoles(): Record<EnemyRole, EnemyRoleTuning> {
  const roles = {} as Record<EnemyRole, EnemyRoleTuning>;
  for (const role of ENEMY_ROLES) roles[role] = zeroRole();
  return roles;
}

function parseChapters(
  raw: Record<string, unknown>,
  problems: ProblemList,
): ChapterScalingTuning {
  const source = readObject(raw, 'chapters', '', problems, [
    'enemyHealthMultipliers',
    'enemyDamageMultipliers',
  ] as const);
  if (source === undefined) {
    return {
      enemyHealthMultipliers: CHAPTERS_PER_RUN_MULTIPLIERS,
      enemyDamageMultipliers: CHAPTERS_PER_RUN_MULTIPLIERS,
    };
  }

  return {
    enemyHealthMultipliers: readMultiplierArray(
      source,
      'enemyHealthMultipliers',
      'chapters',
      problems,
    ),
    enemyDamageMultipliers: readMultiplierArray(
      source,
      'enemyDamageMultipliers',
      'chapters',
      problems,
    ),
  };
}

function parseElite(
  source: Record<string, unknown>,
  problems: ProblemList,
): EliteTuning {
  const elite = readObject(source, 'elite', 'enemies', problems, [
    'scale',
    'chaser',
    'caster',
    'tank',
    'bomber',
    'buffer',
    'dasher',
    'gunner',
  ] as const);
  if (elite === undefined) return zeroElite();

  const path = 'enemies.elite';
  const chaserSource =
    readObject(elite, 'chaser', path, problems, ELITE_CHASER_FIELDS) ?? {};
  const casterSource =
    readObject(elite, 'caster', path, problems, ELITE_CASTER_FIELDS) ?? {};
  const tankSource = readObject(elite, 'tank', path, problems, ELITE_TANK_FIELDS) ?? {};
  const bomberSource =
    readObject(elite, 'bomber', path, problems, ELITE_BOMBER_FIELDS) ?? {};
  const bufferSource =
    readObject(elite, 'buffer', path, problems, ELITE_BUFFER_FIELDS) ?? {};
  const dasherSource =
    readObject(elite, 'dasher', path, problems, ELITE_DASHER_FIELDS) ?? {};
  const gunnerSource =
    readObject(elite, 'gunner', path, problems, ELITE_GUNNER_FIELDS) ?? {};

  const chaser: EliteChaserTuning = {
    pounceTelegraphMs:
      readNumber(chaserSource, 'pounceTelegraphMs', `${path}.chaser`, problems) ?? 0,
    pounceSpeedTilesPerSecond:
      readNumber(chaserSource, 'pounceSpeedTilesPerSecond', `${path}.chaser`, problems) ?? 0,
    pounceDurationMs:
      readNumber(chaserSource, 'pounceDurationMs', `${path}.chaser`, problems) ?? 0,
    pounceCooldownMs:
      readNumber(chaserSource, 'pounceCooldownMs', `${path}.chaser`, problems) ?? 0,
    pounceRangeTiles:
      readNumber(chaserSource, 'pounceRangeTiles', `${path}.chaser`, problems) ?? 0,
  };
  if (chaser.pounceRangeTiles < 0) {
    problems.add(`${path}.chaser.pounceRangeTiles`, 'must not be negative');
  }
  if (chaser.pounceTelegraphMs > 0 && chaser.pounceDurationMs <= 0) {
    problems.add(
      `${path}.chaser.pounceDurationMs`,
      'must be > 0 when there is a telegraph — a pounce needs travel time',
    );
  }

  const caster: EliteCasterTuning = {
    volleyShots:
      readNumber(casterSource, 'volleyShots', `${path}.caster`, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    volleySpreadRadians:
      readNumber(casterSource, 'volleySpreadRadians', `${path}.caster`, problems) ?? 0,
  };

  const tank: EliteTankTuning = {
    extraCharges:
      readNumber(tankSource, 'extraCharges', `${path}.tank`, problems, {
        integer: true,
      }) ?? 0,
  };

  const bomberBlastMult =
    readNumber(bomberSource, 'blastRadiusMultiplier', `${path}.bomber`, problems, {
      positive: true,
    }) ?? 1;
  if (bomberBlastMult < 1) {
    problems.add(`${path}.bomber.blastRadiusMultiplier`, `must be >= 1, got ${bomberBlastMult}`);
  }
  const bomberPulseMult =
    readNumber(bomberSource, 'doublePulseRadiusMultiplier', `${path}.bomber`, problems, {
      positive: true,
    }) ?? 1;
  if (bomberPulseMult < 1) {
    problems.add(
      `${path}.bomber.doublePulseRadiusMultiplier`,
      `must be >= 1, got ${bomberPulseMult}`,
    );
  }
  const bomber: EliteBomberTuning = {
    blastRadiusMultiplier: bomberBlastMult,
    doublePulseDelayMs:
      readNumber(bomberSource, 'doublePulseDelayMs', `${path}.bomber`, problems, {
        integer: true,
      }) ?? 0,
    doublePulseRadiusMultiplier: bomberPulseMult,
  };

  const bufferRadiusMult =
    readNumber(bufferSource, 'buffRadiusMultiplier', `${path}.buffer`, problems, {
      positive: true,
    }) ?? 1;
  if (bufferRadiusMult < 1) {
    problems.add(`${path}.buffer.buffRadiusMultiplier`, `must be >= 1, got ${bufferRadiusMult}`);
  }
  const bufferSpeedMult =
    readNumber(bufferSource, 'buffSpeedMultiplier', `${path}.buffer`, problems, {
      positive: true,
    }) ?? 1;
  if (bufferSpeedMult < 1) {
    problems.add(`${path}.buffer.buffSpeedMultiplier`, `must be >= 1, got ${bufferSpeedMult}`);
  }
  const buffer: EliteBufferTuning = {
    buffRadiusMultiplier: bufferRadiusMult,
    buffSpeedMultiplier: bufferSpeedMult,
    volleyShots:
      readNumber(bufferSource, 'volleyShots', `${path}.buffer`, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    volleySpreadRadians:
      readNumber(bufferSource, 'volleySpreadRadians', `${path}.buffer`, problems) ?? 0,
  };

  const dasher: EliteDasherTuning = {
    extraCharges:
      readNumber(dasherSource, 'extraCharges', `${path}.dasher`, problems, {
        integer: true,
      }) ?? 0,
  };

  const gunner: EliteGunnerTuning = {
    staggerDelayMs:
      readNumber(gunnerSource, 'staggerDelayMs', `${path}.gunner`, problems, {
        integer: true,
      }) ?? 0,
    staggerAngleOffsetFactor:
      readNumber(gunnerSource, 'staggerAngleOffsetFactor', `${path}.gunner`, problems) ?? 0.5,
  };

  return {
    scale:
      readNumber(elite, 'scale', path, problems, { positive: true }) ?? 1,
    chaser,
    caster,
    tank,
    bomber,
    buffer,
    dasher,
    gunner,
  };
}

function parseEnemyAi(
  source: Record<string, unknown>,
  problems: ProblemList,
): EnemyAiTuning {
  const ai = readObject(source, 'ai', 'enemies', problems, ENEMY_AI_FIELDS);
  if (ai === undefined) return zeroEnemyAi();

  const path = 'enemies.ai';
  const flankMinDistanceTiles = readNumber(ai, 'flankMinDistanceTiles', path, problems) ?? 0;
  const flankMaxDistanceTiles = readNumber(ai, 'flankMaxDistanceTiles', path, problems) ?? 0;
  if (flankMaxDistanceTiles < flankMinDistanceTiles) {
    problems.add(
      `${path}.flankMaxDistanceTiles`,
      `must be >= flankMinDistanceTiles (${flankMinDistanceTiles}), got ${flankMaxDistanceTiles}`,
    );
  }

  return {
    predictiveMinChapter:
      readNumber(ai, 'predictiveMinChapter', path, problems, { integer: true, positive: true }) ?? 1,
    predictiveLeadFactor: readRatio(ai, 'predictiveLeadFactor', path, problems),
    elitePredictiveLeadFactor: readRatio(ai, 'elitePredictiveLeadFactor', path, problems),
    predictiveMaxLeadTiles: readNumber(ai, 'predictiveMaxLeadTiles', path, problems) ?? 0,
    casterBurstMinChapter:
      readNumber(ai, 'casterBurstMinChapter', path, problems, { integer: true, positive: true }) ?? 1,
    casterBurstShots:
      readNumber(ai, 'casterBurstShots', path, problems, { integer: true, positive: true }) ?? 1,
    casterBurstSpreadRadians: readNumber(ai, 'casterBurstSpreadRadians', path, problems) ?? 0,
    eliteCasterLateMinChapter:
      readNumber(ai, 'eliteCasterLateMinChapter', path, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    eliteCasterLateVolleyShots:
      readNumber(ai, 'eliteCasterLateVolleyShots', path, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    flankAngleRadians: readNumber(ai, 'flankAngleRadians', path, problems) ?? 0,
    flankMinDistanceTiles,
    flankMaxDistanceTiles,
    flankOffsetTiles: readNumber(ai, 'flankOffsetTiles', path, problems) ?? 0,
    gunnerVolleyShots:
      readNumber(ai, 'gunnerVolleyShots', path, problems, { integer: true, positive: true }) ?? 3,
    gunnerLateMinChapter:
      readNumber(ai, 'gunnerLateMinChapter', path, problems, { integer: true, positive: true }) ?? 3,
    gunnerLateVolleyShots:
      readNumber(ai, 'gunnerLateVolleyShots', path, problems, { integer: true, positive: true }) ?? 5,
    gunnerSpreadRadians: readNumber(ai, 'gunnerSpreadRadians', path, problems) ?? 0.22,
  };
}

function parseRole(
  rolesSource: Record<string, unknown>,
  role: EnemyRole,
  problems: ProblemList,
): EnemyRoleTuning {
  const own = readObject(
    rolesSource,
    role,
    'enemies.roles',
    problems,
    ROLE_FIELDS,
  );
  if (own === undefined) return zeroRole();

  const path = `enemies.roles.${role}`;
  const projectileSpeedTilesPerSecond = readOptionalNumber(
    own,
    'projectileSpeedTilesPerSecond',
    path,
    problems,
    { positive: true },
  );
  const splitCount = readOptionalNumber(own, 'splitCount', path, problems, { integer: true });
  const blastRadiusTiles = readOptionalNumber(own, 'blastRadiusTiles', path, problems, {
    positive: true,
  });
  const blastDamage = readOptionalNumber(own, 'blastDamage', path, problems, {
    integer: true,
    positive: true,
  });
  const buffRadiusTiles = readOptionalNumber(own, 'buffRadiusTiles', path, problems, {
    positive: true,
  });
  const buffSpeedMultiplier = readOptionalNumber(own, 'buffSpeedMultiplier', path, problems, {
    positive: true,
  });
  if (buffSpeedMultiplier !== undefined && buffSpeedMultiplier < 1) {
    problems.add(`${path}.buffSpeedMultiplier`, `must be >= 1, got ${buffSpeedMultiplier}`);
  }
  const buffDurationMs = readOptionalNumber(own, 'buffDurationMs', path, problems, {
    integer: true,
    positive: true,
  });
  const tuning: EnemyRoleTuning = {
    health: readNumber(own, 'health', path, problems, { positive: true }) ?? 1,
    speedTilesPerSecond:
      readNumber(own, 'speedTilesPerSecond', path, problems) ?? 0,
    attackCooldownMs: readNumber(own, 'attackCooldownMs', path, problems) ?? 0,
    telegraphMs: readNumber(own, 'telegraphMs', path, problems) ?? 0,
    preferredRangeMinTiles:
      readNumber(own, 'preferredRangeMinTiles', path, problems) ?? 0,
    preferredRangeMaxTiles:
      readNumber(own, 'preferredRangeMaxTiles', path, problems) ?? 0,
    contactDamage: readNumber(own, 'contactDamage', path, problems) ?? 0,
    chargeSpeedTilesPerSecond:
      readNumber(own, 'chargeSpeedTilesPerSecond', path, problems) ?? 0,
    chargeDurationMs: readNumber(own, 'chargeDurationMs', path, problems) ?? 0,
    scale: readNumber(own, 'scale', path, problems, { positive: true }) ?? 1,
    ...(projectileSpeedTilesPerSecond !== undefined ? { projectileSpeedTilesPerSecond } : {}),
    ...(splitCount !== undefined ? { splitCount } : {}),
    ...(blastRadiusTiles !== undefined ? { blastRadiusTiles } : {}),
    ...(blastDamage !== undefined ? { blastDamage } : {}),
    ...(buffRadiusTiles !== undefined ? { buffRadiusTiles } : {}),
    ...(buffSpeedMultiplier !== undefined ? { buffSpeedMultiplier } : {}),
    ...(buffDurationMs !== undefined ? { buffDurationMs } : {}),
  };

  if (tuning.preferredRangeMaxTiles < tuning.preferredRangeMinTiles) {
    problems.add(
      `${path}.preferredRangeMaxTiles`,
      `must be >= preferredRangeMinTiles (${tuning.preferredRangeMinTiles}), got ${tuning.preferredRangeMaxTiles}`,
    );
  }

  return tuning;
}

function parseEnemies(
  raw: Record<string, unknown>,
  problems: ProblemList,
): EnemiesTuning {
  const source = readObject(raw, 'enemies', '', problems, ENEMY_GROUP_FIELDS);
  if (source === undefined) {
    return {
      eliteHealthMultiplier: 1,
      eliteDamageMultiplier: 1,
      roomEdgeMarginTiles: 0,
      elite: zeroElite(),
      ai: zeroEnemyAi(),
      roles: zeroRoles(),
    };
  }

  const rolesSource =
    readObject(source, 'roles', 'enemies', problems, ENEMY_ROLES) ?? {};
  const roles = {} as Record<EnemyRole, EnemyRoleTuning>;
  for (const role of ENEMY_ROLES)
    roles[role] = parseRole(rolesSource, role, problems);

  return {
    eliteHealthMultiplier:
      readNumber(source, 'eliteHealthMultiplier', 'enemies', problems, {
        positive: true,
      }) ?? 1,
    eliteDamageMultiplier:
      readNumber(source, 'eliteDamageMultiplier', 'enemies', problems, {
        positive: true,
      }) ?? 1,
    roomEdgeMarginTiles:
      readNumber(source, 'roomEdgeMarginTiles', 'enemies', problems) ?? 0,
    elite: parseElite(source, problems),
    ai: parseEnemyAi(source, problems),
    roles,
  };
}

function zeroNavigation(): NavigationTuning {
  return { rebuildMinMs: 0, stuckWindowMs: 0, stuckDistanceTiles: 0, detourMs: 0 };
}

function parseNavigation(
  raw: Record<string, unknown>,
  problems: ProblemList,
): NavigationTuning {
  const source = readObject(raw, 'navigation', '', problems, NAVIGATION_FIELDS);
  if (source === undefined) return zeroNavigation();

  const path = 'navigation';
  return {
    rebuildMinMs: readNumber(source, 'rebuildMinMs', path, problems) ?? 0,
    stuckWindowMs:
      readNumber(source, 'stuckWindowMs', path, problems, { positive: true }) ?? 1,
    stuckDistanceTiles: readNumber(source, 'stuckDistanceTiles', path, problems) ?? 0,
    detourMs: readNumber(source, 'detourMs', path, problems) ?? 0,
  };
}

/**
 * Read the per-chapter room totals: one `{ min, max }` per chapter, both whole numbers > 0.
 * A chapter whose entry is broken falls back to the first valid pair so the game still runs.
 */
function parseWaveTotals(
  value: unknown,
  problems: ProblemList,
): readonly ChapterWaveTotal[] {
  const fallback: ChapterWaveTotal[] = Array.from({ length: CHAPTERS_PER_RUN }, () => ({
    min: 1,
    max: 1,
  }));
  if (!Array.isArray(value)) {
    problems.add(
      'waves.chapterTotals',
      `must be an array of ${CHAPTERS_PER_RUN} { min, max } objects, got ${describe(value)}`,
    );
    return fallback;
  }
  if (value.length !== CHAPTERS_PER_RUN) {
    problems.add(
      'waves.chapterTotals',
      `must have exactly ${CHAPTERS_PER_RUN} entries (one per chapter), got ${value.length}`,
    );
  }

  const totals: ChapterWaveTotal[] = [];
  value.forEach((entry, index) => {
    const path = `waves.chapterTotals[${index}]`;
    if (!isRecord(entry)) {
      problems.add(path, `must be { min, max }, got ${describe(entry)}`);
      totals.push({ min: 1, max: 1 });
      return;
    }
    const min = readNumber(entry, 'min', path, problems, { integer: true, positive: true }) ?? 1;
    const max = readNumber(entry, 'max', path, problems, { integer: true, positive: true }) ?? min;
    if (max < min) {
      problems.add(`${path}.max`, `must be >= min (${min}), got ${max}`);
    }
    totals.push({ min, max: Math.max(min, max) });
  });
  return totals;
}

/**
 * Living Village Hub population (#92): the animal yard leash and the plaza keep-out circle.
 * Both must be real distances — a 0 leash pins every animal to one spot.
 */
function parseHub(raw: Record<string, unknown>, problems: ProblemList): HubTuning {
  const source = readObject(raw, 'hub', '', problems, HUB_FIELDS);
  if (source === undefined) {
    return { animalYardLeashTiles: 4, animalPlazaKeepOutTiles: 6 };
  }

  return {
    animalYardLeashTiles:
      readNumber(source, 'animalYardLeashTiles', 'hub', problems, { positive: true }) ?? 4,
    animalPlazaKeepOutTiles:
      readNumber(source, 'animalPlazaKeepOutTiles', 'hub', problems, { positive: true }) ?? 6,
  };
}

/**
 * Room art (#67): the detail density must stay a real share of the room — 0 means no scatter,
 * and above 0.3 the floor turns into a carpet of pebbles.
 */
function parseRoomArt(raw: Record<string, unknown>, problems: ProblemList): RoomArtTuning {
  const source = readObject(raw, 'roomArt', '', problems, ROOM_ART_FIELDS);
  if (source === undefined) return { detailDensity: 0.12, pathStoneDensity: 0.14 };

  const detailDensity =
    readNumber(source, 'detailDensity', 'roomArt', problems, { positive: true }) ?? 0.12;
  if (detailDensity > 0.3) {
    problems.add('roomArt.detailDensity', `must be <= 0.3, got ${detailDensity}`);
  }
  const pathStoneDensity =
    readNumber(source, 'pathStoneDensity', 'roomArt', problems, { positive: true }) ?? 0.14;
  if (pathStoneDensity > 0.5) {
    problems.add('roomArt.pathStoneDensity', `must be <= 0.5, got ${pathStoneDensity}`);
  }
  return { detailDensity, pathStoneDensity };
}

function zeroWaves(): WavesTuning {
  return {
    aliveCap: 1,
    aliveCapStart: 1,
    aliveCapStepPerRoom: 0,
    spawnIntervalMs: 0,
    spawnBatchSize: 1,
    spawnJitterTiles: 0,
    telegraphMs: 0,
    minSpawnDistanceTiles: 0,
    maxSpawnDistanceTiles: 0,
    aggroRadiusTiles: 0,
    chapterTotals: Array.from({ length: CHAPTERS_PER_RUN }, () => ({ min: 1, max: 1 })),
  };
}

function parseWaves(raw: Record<string, unknown>, problems: ProblemList): WavesTuning {
  const source = readObject(raw, 'waves', '', problems, WAVES_FIELDS);
  if (source === undefined) return zeroWaves();

  const path = 'waves';
  const aliveCap =
    readNumber(source, 'aliveCap', path, problems, { integer: true, positive: true }) ?? 1;
  const aliveCapStart =
    readNumber(source, 'aliveCapStart', path, problems, { integer: true, positive: true }) ??
    aliveCap;
  if (aliveCapStart > aliveCap) {
    problems.add(
      `${path}.aliveCapStart`,
      `must be <= aliveCap (${aliveCap}), got ${aliveCapStart}`,
    );
  }

  return {
    aliveCap,
    aliveCapStart: Math.min(aliveCapStart, aliveCap),
    aliveCapStepPerRoom:
      readNumber(source, 'aliveCapStepPerRoom', path, problems, { integer: true }) ?? 0,
    spawnIntervalMs:
      readNumber(source, 'spawnIntervalMs', path, problems, { positive: true }) ?? 0,
    spawnBatchSize:
      readNumber(source, 'spawnBatchSize', path, problems, { integer: true, positive: true }) ?? 1,
    spawnJitterTiles: readNumber(source, 'spawnJitterTiles', path, problems) ?? 0,
    telegraphMs: readNumber(source, 'telegraphMs', path, problems) ?? 0,
    minSpawnDistanceTiles:
      readNumber(source, 'minSpawnDistanceTiles', path, problems) ?? 0,
    maxSpawnDistanceTiles:
      readNumber(source, 'maxSpawnDistanceTiles', path, problems) ?? 0,
    aggroRadiusTiles:
      readNumber(source, 'aggroRadiusTiles', path, problems, { positive: true }) ?? 1,
    chapterTotals: parseWaveTotals(source.chapterTotals, problems),
  };
}

/**
 * Trauma is a 0..1 ratio: > 1 makes the offset exceed the declared amplitude, which is hard
 * to reason about while tuning. Going over is reported and clamped to 1.
 */
function readTrauma(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
): number {
  return readRatio(source, field, path, problems);
}

function zeroCamera(): CameraTuning {
  return {
    deadzoneHalfTiles: { x: 0, y: 0 },
    lookAheadTiles: 0,
    followRate: 0,
    lookAheadRate: 0,
  };
}

function parseCamera(raw: Record<string, unknown>, problems: ProblemList): CameraTuning {
  const source = readObject(raw, 'camera', '', problems, CAMERA_FIELDS);
  if (source === undefined) return zeroCamera();

  const path = 'camera';
  const deadzoneSource =
    readObject(source, 'deadzoneHalfTiles', path, problems, ['x', 'y']) ?? {};

  return {
    deadzoneHalfTiles: {
      x: readNumber(deadzoneSource, 'x', `${path}.deadzoneHalfTiles`, problems) ?? 0,
      y: readNumber(deadzoneSource, 'y', `${path}.deadzoneHalfTiles`, problems) ?? 0,
    },
    lookAheadTiles: readNumber(source, 'lookAheadTiles', path, problems) ?? 0,
    followRate: readNumber(source, 'followRate', path, problems, { positive: true }) ?? 0,
    lookAheadRate: readNumber(source, 'lookAheadRate', path, problems, { positive: true }) ?? 0,
  };
}

function zeroFeel(): FeelTuning {  return {
    shake: {
      maxOffsetTiles: 0,
      decayPerSecond: 0,
      playerHurt: 0,
      explosion: 0,
      bossCharge: 0,
    },
    squash: {
      playerTurnMs: 0,
      playerTurnAmount: 0,
      playerHurtMs: 0,
      playerHurtAmount: 0,
      enemyHitMs: 0,
      enemyHitAmount: 0,
      bossHitMs: 0,
      bossHitAmount: 0,
    },
    damageNumbers: { lifetimeMs: 0, riseTiles: 0, poolSize: 1 },
    coin: { coinsPerPickup: 1, durationMs: 0, staggerMs: 0, arcHeightTiles: 0, poolSize: 1 },
    muzzle: { drawUnits: 0, lifetimeMs: 0, offsetTiles: 0 },
    vfx: {
        trailSpawnMs: 1,
      trailLifetimeMs: 1,
      trailPoolSize: 1,
      critHitstopMs: 0,
      impactDrawUnits: 0,
      critImpactDrawUnits: 0,
      auraDrawUnits: 0,
      auraOffsetTiles: 0,
    },
  };
}

function parseFeel(raw: Record<string, unknown>, problems: ProblemList): FeelTuning {
  const source = readObject(raw, 'feel', '', problems, FEEL_FIELDS);
  if (source === undefined) return zeroFeel();

  const shakeSource = readObject(source, 'shake', 'feel', problems, SHAKE_FIELDS) ?? {};
  const squashSource = readObject(source, 'squash', 'feel', problems, SQUASH_FIELDS) ?? {};
  const numbersSource =
    readObject(source, 'damageNumbers', 'feel', problems, DAMAGE_NUMBER_FIELDS) ?? {};
  const coinSource = readObject(source, 'coin', 'feel', problems, COIN_FIELDS) ?? {};
  const muzzleSource = readObject(source, 'muzzle', 'feel', problems, MUZZLE_FIELDS) ?? {};
  const vfxSource = readObject(source, 'vfx', 'feel', problems, VFX_FIELDS) ?? {};

  const shakePath = 'feel.shake';
  const shake: ShakeTuning = {
    maxOffsetTiles: readNumber(shakeSource, 'maxOffsetTiles', shakePath, problems) ?? 0,
    decayPerSecond:
      readNumber(shakeSource, 'decayPerSecond', shakePath, problems, { positive: true }) ?? 0,
    playerHurt: readTrauma(shakeSource, 'playerHurt', shakePath, problems),
    explosion: readTrauma(shakeSource, 'explosion', shakePath, problems),
    bossCharge: readTrauma(shakeSource, 'bossCharge', shakePath, problems),
  };
  const squashPath = 'feel.squash';
  const squash: SquashTuning = {
    playerTurnMs: readNumber(squashSource, 'playerTurnMs', squashPath, problems) ?? 0,
    playerTurnAmount: readNumber(squashSource, 'playerTurnAmount', squashPath, problems) ?? 0,
    playerHurtMs: readNumber(squashSource, 'playerHurtMs', squashPath, problems) ?? 0,
    playerHurtAmount: readNumber(squashSource, 'playerHurtAmount', squashPath, problems) ?? 0,
    enemyHitMs: readNumber(squashSource, 'enemyHitMs', squashPath, problems) ?? 0,
    enemyHitAmount: readNumber(squashSource, 'enemyHitAmount', squashPath, problems) ?? 0,
    bossHitMs: readNumber(squashSource, 'bossHitMs', squashPath, problems) ?? 0,
    bossHitAmount: readNumber(squashSource, 'bossHitAmount', squashPath, problems) ?? 0,
  };

  const numbersPath = 'feel.damageNumbers';
  const damageNumbers: DamageNumberTuning = {
    lifetimeMs:
      readNumber(numbersSource, 'lifetimeMs', numbersPath, problems, { positive: true }) ?? 0,
    riseTiles: readNumber(numbersSource, 'riseTiles', numbersPath, problems) ?? 0,
    poolSize:
      readNumber(numbersSource, 'poolSize', numbersPath, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
  };

  const coinPath = 'feel.coin';
  const coin: CoinTuning = {
    coinsPerPickup:
      readNumber(coinSource, 'coinsPerPickup', coinPath, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    durationMs:
      readNumber(coinSource, 'durationMs', coinPath, problems, { positive: true }) ?? 0,
    staggerMs: readNumber(coinSource, 'staggerMs', coinPath, problems) ?? 0,
    arcHeightTiles: readNumber(coinSource, 'arcHeightTiles', coinPath, problems) ?? 0,
    poolSize:
      readNumber(coinSource, 'poolSize', coinPath, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
  };

  const muzzlePath = 'feel.muzzle';
  const muzzle: MuzzleTuning = {
    drawUnits:
      readNumber(muzzleSource, 'drawUnits', muzzlePath, problems, { positive: true }) ?? 0,
    lifetimeMs:
      readNumber(muzzleSource, 'lifetimeMs', muzzlePath, problems, { positive: true }) ?? 0,
    offsetTiles: readNumber(muzzleSource, 'offsetTiles', muzzlePath, problems) ?? 0,
  };

  const vfxPath = 'feel.vfx';
  const vfx: VfxTuning = {
    trailSpawnMs:
      readNumber(vfxSource, 'trailSpawnMs', vfxPath, problems, { positive: true }) ?? 1,
    trailLifetimeMs:
      readNumber(vfxSource, 'trailLifetimeMs', vfxPath, problems, { positive: true }) ?? 1,
    trailPoolSize:
      readNumber(vfxSource, 'trailPoolSize', vfxPath, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    critHitstopMs:
      readNumber(vfxSource, 'critHitstopMs', vfxPath, problems, { positive: true }) ?? 0,
    impactDrawUnits:
      readNumber(vfxSource, 'impactDrawUnits', vfxPath, problems, { positive: true }) ?? 0,
    critImpactDrawUnits:
      readNumber(vfxSource, 'critImpactDrawUnits', vfxPath, problems, { positive: true }) ?? 0,
    auraDrawUnits:
      readNumber(vfxSource, 'auraDrawUnits', vfxPath, problems, { positive: true }) ?? 0,
    auraOffsetTiles: readNumber(vfxSource, 'auraOffsetTiles', vfxPath, problems) ?? 0,
  };

  return { shake, squash, damageNumbers, coin, muzzle, vfx };
}

function zeroDoors(): DoorsTuning {
  return {
    goldBonus: 1,
    xpBonus: 1,
    xpRoomXpMultiplier: 1,
    xpRoomExtraElites: 0,
    specialRoomsEnabled: false,
    hintMs: 2000,
    weights: { xp: 1, gold: 1, heal: 0, shop: 0, chest: 0 },
  };
}

function parseDoors(raw: Record<string, unknown>, problems: ProblemList): DoorsTuning {
  const source = readObject(raw, 'doors', '', problems, DOORS_FIELDS);
  if (source === undefined) return zeroDoors();

  const path = 'doors';
  const weightsSource = readObject(source, 'weights', path, problems, DOOR_WEIGHT_FIELDS) ?? {};

  const weights: DoorWeightsTuning = {
    xp: readNumber(weightsSource, 'xp', `${path}.weights`, problems) ?? 0,
    gold: readNumber(weightsSource, 'gold', `${path}.weights`, problems) ?? 0,
    heal: readNumber(weightsSource, 'heal', `${path}.weights`, problems) ?? 0,
    shop: readNumber(weightsSource, 'shop', `${path}.weights`, problems) ?? 0,
    chest: readNumber(weightsSource, 'chest', `${path}.weights`, problems) ?? 0,
  };

  const xpRoomXpMultiplier =
    readNumber(source, 'xpRoomXpMultiplier', path, problems, { positive: true }) ?? 1;
  if (xpRoomXpMultiplier < 1) {
    problems.add(`${path}.xpRoomXpMultiplier`, `must be >= 1, got ${xpRoomXpMultiplier}`);
  }

  return {
    goldBonus:
      readNumber(source, 'goldBonus', path, problems, { positive: true }) ?? 1,
    xpBonus:
      readNumber(source, 'xpBonus', path, problems, { integer: true, positive: true }) ?? 1,
    xpRoomXpMultiplier,
    xpRoomExtraElites:
      readNumber(source, 'xpRoomExtraElites', path, problems, { integer: true }) ?? 0,
    specialRoomsEnabled: readBoolean(
      source,
      'specialRoomsEnabled',
      path,
      problems,
      false,
    ),
    hintMs:
      readNumber(source, 'hintMs', path, problems, { integer: true, positive: true }) ?? 2000,
    weights,
  };
}

function zeroSpecialRooms(): SpecialRoomsTuning {
  return {
    healFraction: 0.5,
    chestGold: 1,
    shop: { heartRefill: 1, skillPrices: { common: 1, rare: 1, epic: 1 } },
  };
}

function parseSpecialRooms(
  raw: Record<string, unknown>,
  problems: ProblemList,
): SpecialRoomsTuning {
  const source = readObject(raw, 'specialRooms', '', problems, SPECIAL_ROOMS_FIELDS);
  if (source === undefined) return zeroSpecialRooms();

  const path = 'specialRooms';
  const shopSource = readObject(source, 'shop', path, problems, SHOP_FIELDS) ?? {};
  const priceSource =
    readObject(shopSource, 'skillPrices', `${path}.shop`, problems, SHOP_PRICE_FIELDS) ?? {};

  const healFraction = readRatio(source, 'healFraction', path, problems);
  if (healFraction <= 0) {
    problems.add(`${path}.healFraction`, `must be > 0, got ${healFraction}`);
  }

  return {
    healFraction,
    chestGold:
      readNumber(source, 'chestGold', path, problems, { integer: true, positive: true }) ?? 1,
    shop: {
      heartRefill:
        readNumber(shopSource, 'heartRefill', `${path}.shop`, problems, {
          integer: true,
          positive: true,
        }) ?? 1,
      skillPrices: {
        common:
          readNumber(priceSource, 'common', `${path}.shop.skillPrices`, problems, {
            integer: true,
            positive: true,
          }) ?? 1,
        rare:
          readNumber(priceSource, 'rare', `${path}.shop.skillPrices`, problems, {
            integer: true,
            positive: true,
          }) ?? 1,
        epic:
          readNumber(priceSource, 'epic', `${path}.shop.skillPrices`, problems, {
            integer: true,
            positive: true,
          }) ?? 1,
      },
    },
  };
}

function zeroPickups(): PickupsTuning {
  return {
    goldCoinPoolCapacity: 128,
    healthPotion: {
      poolCapacity: 32,
      dropChanceNormal: 0.035,
      dropChanceElite: 0.14,
      healFraction: 0.25,
      fullHpGoldBonus: 5,
    },
  };
}

function parsePickups(raw: Record<string, unknown>, problems: ProblemList): PickupsTuning {
  const source = readObject(raw, 'pickups', '', problems, PICKUPS_FIELDS);
  if (source === undefined) return zeroPickups();

  const path = 'pickups';
  const potionSource =
    readObject(source, 'healthPotion', path, problems, HEALTH_POTION_FIELDS) ?? {};
  const potionPath = `${path}.healthPotion`;
  const healFraction = readRatio(potionSource, 'healFraction', potionPath, problems);
  if (healFraction <= 0) {
    problems.add(`${potionPath}.healFraction`, `must be > 0, got ${healFraction}`);
  }

  return {
    goldCoinPoolCapacity:
      readNumber(source, 'goldCoinPoolCapacity', path, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    healthPotion: {
      poolCapacity:
        readNumber(potionSource, 'poolCapacity', potionPath, problems, {
          integer: true,
          positive: true,
        }) ?? 1,
      dropChanceNormal: readRatio(potionSource, 'dropChanceNormal', potionPath, problems),
      dropChanceElite: readRatio(potionSource, 'dropChanceElite', potionPath, problems),
      healFraction,
      fullHpGoldBonus:
        readNumber(potionSource, 'fullHpGoldBonus', potionPath, problems, { integer: true }) ?? 0,
    },
  };
}

/** Default boss max health per chapter when the config block is missing. */
const DEFAULT_BOSS_HEALTH_BY_CHAPTER: readonly number[] = [60, 80, 100, 120];

function parseBossHealthArray(
  source: Record<string, unknown>,
  problems: ProblemList,
): readonly number[] {
  const fieldPath = 'boss.healthByChapter';
  const value = source.healthByChapter;
  if (!Array.isArray(value)) {
    problems.add(
      fieldPath,
      `must be an array of ${CHAPTERS_PER_RUN} positive integers, got ${describe(value)}`,
    );
    return DEFAULT_BOSS_HEALTH_BY_CHAPTER;
  }
  if (value.length !== CHAPTERS_PER_RUN) {
    problems.add(
      fieldPath,
      `must have exactly ${CHAPTERS_PER_RUN} elements (one per chapter), got ${value.length}`,
    );
  }

  const result: number[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry <= 0) {
      problems.add(`${fieldPath}[${index}]`, `must be a positive integer, got ${describe(entry)}`);
      result.push(DEFAULT_BOSS_HEALTH_BY_CHAPTER[index] ?? 60);
      return;
    }
    result.push(entry);
  });
  return result;
}

function parseBoss(raw: Record<string, unknown>, problems: ProblemList): BossTuning {
  const source = readObject(raw, 'boss', '', problems, BOSS_FIELDS);
  if (source === undefined) {
    return { introGraceMs: 1000, healthByChapter: DEFAULT_BOSS_HEALTH_BY_CHAPTER };
  }

  return {
    introGraceMs:
      readNumber(source, 'introGraceMs', 'boss', problems, { integer: true }) ?? 0,
    healthByChapter: parseBossHealthArray(source, problems),
  };
}

function zeroXpRoles(): Record<EnemyRole, number> {
  const roles = {} as Record<EnemyRole, number>;
  for (const role of ENEMY_ROLES) roles[role] = 0;
  return roles;
}

function zeroXp(): XpTuning {
  return {
    curve: {
      baseThreshold: 1,
      linearStep: 0,
      quadraticStep: 0,
      chapterMultipliers: CHAPTERS_PER_RUN_MULTIPLIERS,
    },
    roles: zeroXpRoles(),
    eliteMultiplier: 1,
    orbs: {
      poolCapacity: 1,
      scatterSpeedTilesPerSecond: 0,
      scatterDurationMs: 0,
      magnetRadiusTiles: 1,
      pickupRadiusTiles: 0.5,
      magnetAccelTilesPerSecondSq: 1,
      magnetMaxSpeedTilesPerSecond: 1,
      vacuumAccelTilesPerSecondSq: 1,
      vacuumMaxSpeedTilesPerSecond: 1,
    },
    reroll: {
      baseCost: 0,
      costStep: 0,
    },
    levelUpWave: {
      knockbackRadiusTiles: 1,
      knockbackDistanceTiles: 1,
      knockbackDurationMs: 1,
      resumeInvulnerabilityMs: 0,
    },
  };
}

function parseXp(raw: Record<string, unknown>, problems: ProblemList): XpTuning {
  const source = readObject(raw, 'xp', '', problems, XP_FIELDS);
  if (source === undefined) return zeroXp();

  const path = 'xp';
  const curveSource = readObject(source, 'curve', path, problems, XP_CURVE_FIELDS) ?? {};
  const rolesSource = readObject(source, 'roles', path, problems, ENEMY_ROLES) ?? {};
  const orbsSource = readObject(source, 'orbs', path, problems, XP_ORBS_FIELDS) ?? {};
  const rerollSource = readObject(source, 'reroll', path, problems, XP_REROLL_FIELDS) ?? {};
  const waveSource =
    readObject(source, 'levelUpWave', path, problems, LEVEL_UP_WAVE_FIELDS) ?? {};

  const curve: XpCurveTuning = {
    baseThreshold:
      readNumber(curveSource, 'baseThreshold', `${path}.curve`, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    linearStep: readNumber(curveSource, 'linearStep', `${path}.curve`, problems) ?? 0,
    quadraticStep: readNumber(curveSource, 'quadraticStep', `${path}.curve`, problems) ?? 0,
    chapterMultipliers: readMultiplierArray(
      curveSource,
      'chapterMultipliers',
      `${path}.curve`,
      problems,
    ),
  };

  const roles = {} as Record<EnemyRole, number>;
  for (const role of ENEMY_ROLES) {
    roles[role] =
      readNumber(rolesSource, role, `${path}.roles`, problems, { integer: true }) ?? 0;
  }

  const eliteMultiplier =
    readNumber(source, 'eliteMultiplier', path, problems, { positive: true }) ?? 1;
  if (eliteMultiplier < 1) {
    problems.add(`${path}.eliteMultiplier`, `must be >= 1, got ${eliteMultiplier}`);
  }

  const magnetRadiusTiles =
    readNumber(orbsSource, 'magnetRadiusTiles', `${path}.orbs`, problems, { positive: true }) ?? 1;
  const pickupRadiusTiles =
    readNumber(orbsSource, 'pickupRadiusTiles', `${path}.orbs`, problems, { positive: true }) ??
    0.5;
  if (pickupRadiusTiles > magnetRadiusTiles) {
    problems.add(
      `${path}.orbs.pickupRadiusTiles`,
      `must be <= magnetRadiusTiles (${magnetRadiusTiles}), got ${pickupRadiusTiles}`,
    );
  }

  const orbs: XpOrbsTuning = {
    poolCapacity:
      readNumber(orbsSource, 'poolCapacity', `${path}.orbs`, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    scatterSpeedTilesPerSecond:
      readNumber(orbsSource, 'scatterSpeedTilesPerSecond', `${path}.orbs`, problems) ?? 0,
    scatterDurationMs:
      readNumber(orbsSource, 'scatterDurationMs', `${path}.orbs`, problems) ?? 0,
    magnetRadiusTiles,
    pickupRadiusTiles,
    magnetAccelTilesPerSecondSq:
      readNumber(orbsSource, 'magnetAccelTilesPerSecondSq', `${path}.orbs`, problems, {
        positive: true,
      }) ?? 1,
    magnetMaxSpeedTilesPerSecond:
      readNumber(orbsSource, 'magnetMaxSpeedTilesPerSecond', `${path}.orbs`, problems, {
        positive: true,
      }) ?? 1,
    vacuumAccelTilesPerSecondSq:
      readNumber(orbsSource, 'vacuumAccelTilesPerSecondSq', `${path}.orbs`, problems, {
        positive: true,
      }) ?? 1,
    vacuumMaxSpeedTilesPerSecond:
      readNumber(orbsSource, 'vacuumMaxSpeedTilesPerSecond', `${path}.orbs`, problems, {
        positive: true,
      }) ?? 1,
  };

  const reroll: XpRerollTuning = {
    baseCost:
      readNumber(rerollSource, 'baseCost', `${path}.reroll`, problems, { integer: true }) ?? 0,
    costStep:
      readNumber(rerollSource, 'costStep', `${path}.reroll`, problems, { integer: true }) ?? 0,
  };

  const levelUpWave: LevelUpWaveTuning = {
    knockbackRadiusTiles:
      readNumber(waveSource, 'knockbackRadiusTiles', `${path}.levelUpWave`, problems, {
        positive: true,
      }) ?? 1,
    knockbackDistanceTiles:
      readNumber(waveSource, 'knockbackDistanceTiles', `${path}.levelUpWave`, problems, {
        positive: true,
      }) ?? 1,
    knockbackDurationMs:
      readNumber(waveSource, 'knockbackDurationMs', `${path}.levelUpWave`, problems, {
        positive: true,
      }) ?? 1,
    resumeInvulnerabilityMs:
      readNumber(waveSource, 'resumeInvulnerabilityMs', `${path}.levelUpWave`, problems, {
        integer: true,
      }) ?? 0,
  };

  return { curve, roles, eliteMultiplier, orbs, reroll, levelUpWave };
}

function zeroCover(): CoverTuning {
  return { overlayAlpha: 1, actorInCoverAlpha: 1, fadeRate: 1 };
}

function parseCover(raw: Record<string, unknown>, problems: ProblemList): CoverTuning {
  const source = readObject(raw, 'cover', '', problems, COVER_FIELDS);
  if (source === undefined) return zeroCover();

  const path = 'cover';
  return {
    overlayAlpha: readRatio(source, 'overlayAlpha', path, problems),
    actorInCoverAlpha: readRatio(source, 'actorInCoverAlpha', path, problems),
    fadeRate: readNumber(source, 'fadeRate', path, problems, { positive: true }) ?? 0,
  };
}

/** Deep freeze so nobody can accidentally change tuned numbers at runtime. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;

  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return Object.freeze(value);
}

export function parseTuning(raw: unknown): TuningConfig {
  if (!isRecord(raw)) {
    throw new Error(
      `${TUNING_SOURCE_PATH} is invalid: root must be an object, got ${describe(raw)}`,
    );
  }

  const problems = new ProblemList();

  let version = 1;
  if (
    typeof raw.version === 'number' &&
    Number.isInteger(raw.version) &&
    raw.version >= 1
  ) {
    version = raw.version;
  } else {
    problems.add(
      'version',
      `must be an integer >= 1, got ${describe(raw.version)}`,
    );
  }

  const config: TuningConfig = {
    version,
    combat: parseBlock(COMBAT_SPEC, raw, 'combat', '', problems),
    chapters: parseChapters(raw, problems),
    enemies: parseEnemies(raw, problems),
    navigation: parseNavigation(raw, problems),
    camera: parseCamera(raw, problems),
    waves: parseWaves(raw, problems),
    feel: parseFeel(raw, problems),
    cover: parseCover(raw, problems),
    doors: parseDoors(raw, problems),
    specialRooms: parseSpecialRooms(raw, problems),
    pickups: parsePickups(raw, problems),
    roomArt: parseRoomArt(raw, problems),
    boss: parseBoss(raw, problems),
    xp: parseXp(raw, problems),
    dash: parseBlock(DASH_SPEC, raw, 'dash', '', problems),
    activeSkill: parseBlock(ACTIVE_SKILL_SPEC, raw, 'activeSkill', '', problems),
    classSkills: parseBlock(CLASS_SKILLS_SPEC, raw, 'classSkills', '', problems),
    characters: parseKeyedRecord(
      CHARACTER_SPEC,
      TUNING_CHARACTER_IDS,
      raw,
      'characters',
      '',
      problems,
    ),
    hub: parseHub(raw, problems),
  };

  problems.throwIfAny();
  return deepFreeze(config);
}
