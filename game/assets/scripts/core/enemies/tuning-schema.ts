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

/** Player combat numbers (GDD §3). */
export interface CombatTuning {
  /** Shots per second in the base state. */
  readonly fireRatePerSecond: number;
  /** Damage per base projectile. */
  readonly damage: number;
  /** Projectiles per shot in the base state. */
  readonly projectiles: number;
  /** Projectile speed, tiles/second. */
  readonly projectileSpeedTilesPerSecond: number;
  /** Base movement speed, tiles/second. */
  readonly moveSpeedTilesPerSecond: number;
  /** Out-of-combat room-clear movement speed multiplier (M17: 1.45 = +45%). */
  readonly roomClearSpeedMultiplier: number;
  /** Base player maximum HP (M17 RPG 100 HP scale, ADR-025). */
  readonly playerBaseMaxHp: number;
  /** Invulnerability after taking a hit, ms. */
  readonly invulnerabilityMs: number;
  /** Base damage when an enemy touches the player. */
  readonly contactDamage: number;
  /** Auto-aim range, tiles. */
  readonly targetingRangeTiles: number;
  /** Player knockback distance when hit, tiles. */
  readonly playerKnockbackDistanceTiles: number;
  /** Time to travel the full player knockback distance, ms. */
  readonly playerKnockbackDurationMs: number;
  /** Enemy knockback distance when hit by a projectile, tiles. */
  readonly enemyKnockbackDistanceTiles: number;
  /** Time to travel the full enemy knockback distance, ms. */
  readonly enemyKnockbackDurationMs: number;
  /**
   * Hitstop when a player projectile hits an enemy, ms (ADR-008: 70). The whole simulation
   * stands still for this long — see `core/combat/hitstop.ts`.
   */
  readonly enemyHitstopMs: number;
  /** Time an enemy stands still after being hit by a projectile, ms (ADR-008: 150). */
  readonly enemyStaggerMs: number;
}

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

/** Meteor (`mage-meteor`): periodic heavy AoE on the densest cluster (M20, #86). */
export interface MageMeteorTuning {
  /** Interval at 1 stack, ms (GDD: 4.5 s). */
  readonly intervalMs: number;
  /** Shorter interval per extra stack, ms (subtracted from `intervalMs`). */
  readonly intervalStepMs: number;
  /** Meteor AoE radius, tiles. */
  readonly radiusTiles: number;
  /** AoE damage as a multiple of the player's per-shot damage. */
  readonly damageRatio: number;
  /** Burn DPS as a multiple of the player's per-shot damage. */
  readonly burnDpsRatio: number;
  /** Burn duration, ms. */
  readonly burnDurationMs: number;
}

/** Frost Orbs (`mage-frost-orbs`): orbiting contact spheres (M20, #86). */
export interface MageFrostOrbsTuning {
  /** Orbs at 1 stack (GDD: 2). */
  readonly baseCount: number;
  /** Extra orbs per additional stack (GDD: +1/stack). */
  readonly countPerStack: number;
  /** Orbit radius around the Mage, tiles. */
  readonly radiusTiles: number;
  /** Orbit angular speed at base, radians/second. */
  readonly orbitRadiansPerSecond: number;
  /** Orbit speed multiplier while the Evolution is owned. */
  readonly evolvedOrbitMultiplier: number;
  /** Contact radius of one orb, tiles. */
  readonly hitRadiusTiles: number;
  /** Contact DPS as a multiple of the player's per-shot damage. */
  readonly damagePerSecondRatio: number;
  /** Heavy slow speed factor `0..1` on contact. */
  readonly slowFactor: number;
  /** Slow duration, ms. */
  readonly slowDurationMs: number;
}

/** Storm Strike (`mage-storm-strike`): on-hit lightning proc (M20, #86). */
export interface MageStormStrikeTuning {
  /** Proc chance at 1 stack (GDD: 0.2). */
  readonly procChance: number;
  /** Extra proc chance per additional stack (GDD: +0.1/stack). */
  readonly procChancePerStack: number;
  /** Bolt damage as a multiple of the player's per-shot damage. */
  readonly damageRatio: number;
}

/** Arcane Pulse (`mage-arcane-pulse`): every-Nth-shot ring (M20, #86). */
export interface MageArcanePulseTuning {
  /** Ring fires on every Nth auto-fire shot (GDD: 4). */
  readonly shotEvery: number;
  /** Ring radius, tiles (GDD: 1.8). */
  readonly radiusTiles: number;
  /** Ring damage at 1 stack, as a multiple of the player's per-shot damage. */
  readonly damageRatio: number;
  /** Extra damage ratio per additional stack. */
  readonly damageRatioPerStack: number;
}

/** Elemental Cataclysm (`mage-elemental-cataclysm`): Evolution extras (M20, #86). */
export interface MageEvolutionTuning {
  /** Ice-shard launch interval, ms. */
  readonly shardIntervalMs: number;
  /** Shard damage as a multiple of the player's per-shot damage. */
  readonly shardDamageRatio: number;
  /** Orb damage multiplier against ignited (burning) foes. */
  readonly shatterBurnMultiplier: number;
}

/** One class's exclusive-skill tuning block (M20, ADR-027). */
export interface MageClassSkillsTuning {
  readonly meteor: MageMeteorTuning;
  readonly frostOrbs: MageFrostOrbsTuning;
  readonly stormStrike: MageStormStrikeTuning;
  readonly arcanePulse: MageArcanePulseTuning;
  readonly evolution: MageEvolutionTuning;
}

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

/** Layer 1 per-class base stat deltas & multipliers relative to `combat` baseline (M14/M17). */
export interface CharacterBaseStatsTuning {
  /** Signed integer HP delta added to `combat.playerBaseMaxHp` (e.g. 0, -15, -15, +20). */
  readonly maxHpDelta: number;
  readonly damageMult: number;
  readonly fireRateMult: number;
  readonly moveSpeedMult: number;
  readonly projectileSpeedMult: number;
  readonly targetingRangeMult: number;
}

/** Layer 2 per-class starting passive parameters (M14). */
export interface CharacterPassiveTuning {
  /** Additive move-speed bonus ratio (e.g. `0.1` = +10% move speed). */
  readonly moveSpeedBonus: number;
  /** Multiplicative Dash cooldown factor (e.g. `0.85` = -15% Dash cooldown). */
  readonly dashCooldownMult: number;
  /** Additive base pierce count (e.g. `1` for Archer's Keen Sight). */
  readonly pierceAdd: number;
  /** Additive crit chance in `0..1` (e.g. `0.12` for Archer's Keen Sight). */
  readonly critChanceAdd: number;
  /** Minimum crit multiplier applied when crit chance > 0 (`>= 1`). */
  readonly critMultiplier: number;
  /** Multiplicative Signature Active cooldown factor (e.g. `0.8` = -20% for Mage). */
  readonly activeCooldownMult: number;
  /** Additive Signature Active power bonus (e.g. `0.25` = +25% for Mage). */
  readonly activePowerBonus: number;
  /** Additive AoE power bonus (e.g. `0.25` = +25% for Mage). */
  readonly aoePowerBonus: number;
  /** Multiplicative base damage bonus ratio (e.g. `0.15` = +15% for Cultivator's Sword Heart). */
  readonly damageBonus: number;
  /** Execute threshold in `0..1` (`0` = disabled; e.g. `0.3` = enemies below 30% HP). */
  readonly executeThreshold: number;
  /** Additive execute damage bonus ratio (e.g. `0.1` = +10% for Cultivator). */
  readonly executeBonus: number;
}

/** Layer 3 per-class Signature Active parameters (M14). */
export interface CharacterSignatureTuning {
  readonly cooldownMs: number;
  readonly hitCooldownReductionMs: number;
  readonly killCooldownReductionMs: number;
  readonly projectileCount: number;
  readonly maxProjectileCount: number;
  readonly fanArcDegrees: number;
  readonly speedTilesPerSecond: number;
  readonly radiusTiles: number;
  readonly ttlMs: number;
  readonly damageMultiplier: number;
  readonly pierceCount: number;
  readonly homing: boolean;
  /** Radial AoE nova radius in tiles (`0` when the signature has no radial nova). */
  readonly novaRadiusTiles: number;
  /** Radial AoE nova damage multiplier (`0` when the signature has no radial nova). */
  readonly novaDamageMultiplier: number;
  /** Radial AoE slow/freeze speed factor in `0..1` (`1` = no slow). */
  readonly novaSlowFactor: number;
  /** Radial AoE slow/freeze duration in ms (`0` = no slow). */
  readonly novaSlowDurationMs: number;
  /** Duration in ms to hide worn back attachment during the signature (`0` = do not hide). */
  readonly hideAttachmentMs: number;
}

/** Complete M14 tuning block for one playable character class. */
export interface CharacterTuning {
  /** Chapter clear milestone for free unlock (`0` = unlocked from start, `1..3` = clear Ch1..Ch3). */
  readonly unlockChapter: number;
  /** Meta gold cost for early unlock (`0` for default unlocked classes). */
  readonly unlockGoldCost: number;
  readonly baseStats: CharacterBaseStatsTuning;
  readonly passive: CharacterPassiveTuning;
  readonly signature: CharacterSignatureTuning;
}

/** All 4 playable character tuning blocks keyed by character id (M14). */
export type CharactersTuning = Readonly<Record<TuningCharacterId, CharacterTuning>>;

/** Mưa Tên (`archer-arrow-rain`): every-Nth-shot volley, #85. */
export interface ArrowRainTuning {
  /** Auto-fire shots between two volleys (1-based counter; 5 = shots 5, 10, …). */
  readonly everyShots: number;
  /** Volley AoE radius, tiles. */
  readonly radiusTiles: number;
  /** Damage multiplier of the shot damage, one entry per stack (index 0 = 1 stack). */
  readonly damageRatioByStack: readonly number[];
}

/** Tên Tách Chùm (`archer-split-arrow`): first-hit split, #85. */
export interface SplitArrowTuning {
  /** Projectiles spawned per split. */
  readonly arrows: number;
  /** Half-angle of each split projectile off the flight direction, degrees. */
  readonly angleDegrees: number;
  /** Damage multiplier of the hit damage, one entry per stack. */
  readonly damageRatioByStack: readonly number[];
}

/** Ấn Ký Săn Mồi (`archer-hunters-mark`): mark, then detonate on crit, #85. */
export interface HuntersMarkTuning {
  /** How long a mark stays armed, ms. */
  readonly durationMs: number;
  /** Detonation AoE radius, tiles. */
  readonly radiusTiles: number;
  /** Detonation damage multiplier of the hit damage, one entry per stack. */
  readonly damageRatioByStack: readonly number[];
}

/** Phong Tiễn (`archer-wind-arrow`): hit-momentum buff, #85. */
export interface WindArrowTuning {
  /** Momentum cap (each hit adds 1). */
  readonly momentumCap: number;
  /** Gap between hits that resets momentum, ms. */
  readonly resetMs: number;
  /** Buff lifetime, ms. */
  readonly buffDurationMs: number;
  /** Additive fire-rate bonus per momentum point per skill stack (0.01 = +1%). */
  readonly fireRatePerMomentum: number;
  /** Additive projectile-speed bonus per momentum point per skill stack (0.02 = +2%). */
  readonly projectileSpeedPerMomentum: number;
}

/** Thiên Tiễn Lôi Đình (`archer-sky-tempest`): radial piercing volley on each rain, #85. */
export interface SkyTempestTuning {
  /** Projectiles per radial volley. */
  readonly arrows: number;
  /** Enemies every volley projectile passes through. */
  readonly pierce: number;
  /** Damage multiplier of the shot damage. */
  readonly damageRatio: number;
}

/** Archer class-skill numbers (M20, #85). */
export interface ArcherClassSkillTuning {
  readonly arrowRain: ArrowRainTuning;
  readonly splitArrow: SplitArrowTuning;
  readonly huntersMark: HuntersMarkTuning;
  readonly windArrow: WindArrowTuning;
  readonly skyTempest: SkyTempestTuning;
}

/** Player Dash tuning (M13, ADR-022). */
export interface DashTuning {
  /** Game-time action buffer window, ms (freezes during pause/hitstop). */
  readonly bufferMs: number;
  /** Base cooldown between dashes, ms. */
  readonly cooldownMs: number;
  /** Dash movement duration, ms. */
  readonly durationMs: number;
  /** Dash speed, tiles/second. */
  readonly speedTilesPerSecond: number;
  /** Invulnerability window granted when starting a dash, ms. */
  readonly invulnerabilityMs: number;
}

/** Signature Active Skill tuning (M13, ADR-022). */
export interface ActiveSkillTuning {
  /** Game-time action buffer window, ms. */
  readonly bufferMs: number;
  /** Base time cooldown, ms. */
  readonly cooldownMs: number;
  /** Cooldown reduction on each player projectile hit, ms. */
  readonly hitCooldownReductionMs: number;
  /** Cooldown reduction on each enemy kill, ms. */
  readonly killCooldownReductionMs: number;
  /** Projectiles emitted by Ninja's Shadow Barrage signature active. */
  readonly barrageProjectiles: number;
  /** Damage multiplier per Shadow Barrage projectile relative to player base damage. */
  readonly barrageDamageMultiplier: number;
}

/** Ninja exclusive skill *Phân Thân Ám Ảnh* (shadow clone) tuning (M20, ADR-027). */
export interface NinjaShadowCloneTuning {
  /** Clone shuriken damage as a fraction of the player's shot damage, indexed per stack. */
  readonly damageRatioByStack: readonly number[];
  /** Clone lifetime, ms (GDD: 2500). */
  readonly durationMs: number;
  /** Time between two clone shurikens, ms. */
  readonly fireIntervalMs: number;
  /** Clone auto-aim range, tiles. */
  readonly rangeTiles: number;
  readonly projectileSpeedTilesPerSecond: number;
  readonly projectileTtlMs: number;
}

/** Ninja exclusive skill *Phi Tiêu Độc Vụ* (venom shuriken) tuning (M20, ADR-027). */
export interface NinjaVenomShurikenTuning {
  /** Throw the giant venom shuriken every N auto-fire shots (GDD: 3). */
  readonly everyNShots: number;
  /** Cloud damage per tick (not per second), indexed per stack. */
  readonly damageByStack: readonly number[];
  /** Cloud radius, tiles, indexed per stack. */
  readonly radiusTilesByStack: readonly number[];
  /** Cloud lifetime, ms, indexed per stack. */
  readonly durationMsByStack: readonly number[];
  /** Time between two cloud damage ticks, ms. */
  readonly damageTickMs: number;
  readonly projectileSpeedTilesPerSecond: number;
  readonly projectileTtlMs: number;
}

/** Ninja exclusive skill *Liên Hoàn Kunai* (kunai burst) tuning (M20, ADR-027). */
export interface NinjaKunaiBurstTuning {
  /** Kunai per kill at stack 1 (GDD: 4). */
  readonly baseKunai: number;
  /** Extra kunai per additional stack (GDD: +2). */
  readonly kunaiPerStack: number;
  /** Damage per kunai. */
  readonly damage: number;
  readonly speedTilesPerSecond: number;
  readonly ttlMs: number;
  readonly radiusTiles: number;
}

/** Ninja exclusive skill *Bom Khói Ẩn Thân* (smoke bomb) tuning (M20, ADR-027). */
export interface NinjaSmokeBombTuning {
  /** Enemy speed reduction fraction inside the smoke, indexed per stack (GDD stack 1: 0.45). */
  readonly slowByStack: readonly number[];
  /** Player fire-rate bonus fraction inside the smoke, indexed per stack (GDD stack 1: 0.30). */
  readonly fireRateBonusByStack: readonly number[];
  /** Smoke radius, tiles, indexed per stack (GDD stack 1: 2.8). */
  readonly radiusTilesByStack: readonly number[];
  /** Smoke lifetime, ms, indexed per stack (GDD stack 1: 3000). */
  readonly durationMsByStack: readonly number[];
}

/** Complete Ninja class-exclusive skill tuning block. */
export interface NinjaClassSkillsTuning {
  readonly shadowClone: NinjaShadowCloneTuning;
  readonly venomShuriken: NinjaVenomShurikenTuning;
  readonly kunaiBurst: NinjaKunaiBurstTuning;
  readonly smokeBomb: NinjaSmokeBombTuning;
}

/** Cultivator exclusive skill *Ngự Kiếm Hộ Thể* (orbit swords) tuning (M20, ADR-027). */
export interface CultivatorOrbitSwordsTuning {
  /** Sword count per stack (GDD: 2, +1/stack). */
  readonly swordsByStack: readonly number[];
  /** Time between two slash cadences, ms. */
  readonly slashIntervalMs: number;
  /** Slash damage as a fraction of the player's shot damage, indexed per stack. */
  readonly damageRatioByStack: readonly number[];
  /** How far a sword darts from the player, tiles, indexed per stack. */
  readonly reachTilesByStack: readonly number[];
  readonly dartSpeedTilesPerSecond: number;
  /** Out-and-back travel time of one dart, ms. */
  readonly dartTravelMs: number;
  /** Orbit radius around the player, tiles (view + mini-wave origin). */
  readonly orbitRadiusTiles: number;
  /** Orbit angular speed, radians/second (view + mini-wave origin). */
  readonly orbitSpinRadiansPerSecond: number;
}

/** Cultivator exclusive skill *Kiếm Trận* (sword array) tuning (M20, ADR-027). */
export interface CultivatorSwordArrayTuning {
  /** Array radius, tiles, indexed per stack (GDD stack 1: 3.2). */
  readonly radiusTilesByStack: readonly number[];
  /** Array lifetime, ms, indexed per stack (GDD stack 1: 3000). */
  readonly durationMsByStack: readonly number[];
  /** Damage per slice tick as a fraction of the player's shot damage, indexed per stack. */
  readonly damageRatioByStack: readonly number[];
  /** Time between two slice ticks, ms. */
  readonly tickMs: number;
}

/** Cultivator exclusive skill *Kiếm Khí Bán Nguyệt* (sword qi) tuning (M20, ADR-027). */
export interface CultivatorSwordQiTuning {
  /** Unleash a crescent every N auto-fire shots (GDD: 3). */
  readonly everyNShots: number;
  /** Wave damage as a fraction of the player's shot damage, indexed per stack. */
  readonly damageRatioByStack: readonly number[];
  /** Crescent half-width, tiles, indexed per stack. */
  readonly halfWidthTilesByStack: readonly number[];
  /** Wave travel lifetime, ms, indexed per stack. */
  readonly durationMsByStack: readonly number[];
  readonly speedTilesPerSecond: number;
}

/** Cultivator exclusive skill *Hộ Tâm Linh Khí* (qi barrier) tuning (M20, ADR-027). */
export interface CultivatorQiBarrierTuning {
  /** Gauge charge per damaging hit in `0..1`, indexed per stack. */
  readonly chargeByStack: readonly number[];
  /** Radial sword-qi waves released when the shield is raised, indexed per stack. */
  readonly wavesByStack: readonly number[];
  /** Wave damage as a fraction of the player's shot damage, indexed per stack. */
  readonly waveDamageRatioByStack: readonly number[];
  /** Wave half-width, tiles, indexed per stack. */
  readonly waveHalfWidthTilesByStack: readonly number[];
  /** Wave travel lifetime, ms, indexed per stack. */
  readonly waveDurationMsByStack: readonly number[];
  readonly waveSpeedTilesPerSecond: number;
}

/** Cultivator Class Evolution *Vạn Kiếm Quy Tông* tuning (M20, ADR-027). */
export interface CultivatorMyriadSwordsTuning {
  /** Period between automatic Sword Arrays, ms (GDD test: <= 15000). */
  readonly arrayIntervalMs: number;
  /** Mini wave damage as a fraction of the player's shot damage. */
  readonly miniWaveDamageRatio: number;
  /** Mini wave half-width, tiles. */
  readonly miniWaveRadiusTiles: number;
  /** Mini wave travel lifetime, ms. */
  readonly miniWaveDurationMs: number;
  readonly miniWaveSpeedTilesPerSecond: number;
}

/** Complete Cultivator class-exclusive skill tuning block. */
export interface CultivatorClassSkillsTuning {
  readonly orbitSwords: CultivatorOrbitSwordsTuning;
  readonly swordArray: CultivatorSwordArrayTuning;
  readonly swordQi: CultivatorSwordQiTuning;
  readonly qiBarrier: CultivatorQiBarrierTuning;
  readonly myriadSwords: CultivatorMyriadSwordsTuning;
}

/** Class-exclusive skill tuning (M20, ADR-027), one block per class. */
export interface ClassSkillsTuning {
  readonly ninja: NinjaClassSkillsTuning;
  readonly archer: ArcherClassSkillTuning;
  readonly mage: MageClassSkillsTuning;
  readonly cultivator: CultivatorClassSkillsTuning;
}

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

const COMBAT_FIELDS = [
  'fireRatePerSecond',
  'damage',
  'projectiles',
  'projectileSpeedTilesPerSecond',
  'moveSpeedTilesPerSecond',
  'roomClearSpeedMultiplier',
  'playerBaseMaxHp',
  'invulnerabilityMs',
  'contactDamage',
  'targetingRangeTiles',
  'playerKnockbackDistanceTiles',
  'playerKnockbackDurationMs',
  'enemyKnockbackDistanceTiles',
  'enemyKnockbackDurationMs',
  'enemyHitstopMs',
  'enemyStaggerMs',
] as const;

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

const DASH_FIELDS = [
  'bufferMs',
  'cooldownMs',
  'durationMs',
  'speedTilesPerSecond',
  'invulnerabilityMs',
] as const;

const ACTIVE_SKILL_FIELDS = [
  'bufferMs',
  'cooldownMs',
  'hitCooldownReductionMs',
  'killCooldownReductionMs',
  'barrageProjectiles',
  'barrageDamageMultiplier',
] as const;

const CLASS_SKILLS_FIELDS = ['ninja', 'archer', 'mage', 'cultivator'] as const;

const NINJA_CLASS_SKILLS_FIELDS = [
  'shadowClone',
  'venomShuriken',
  'kunaiBurst',
  'smokeBomb',
] as const;

const NINJA_SHADOW_CLONE_FIELDS = [
  'damageRatioByStack',
  'durationMs',
  'fireIntervalMs',
  'rangeTiles',
  'projectileSpeedTilesPerSecond',
  'projectileTtlMs',
] as const;

const NINJA_VENOM_SHURIKEN_FIELDS = [
  'everyNShots',
  'damageByStack',
  'radiusTilesByStack',
  'durationMsByStack',
  'damageTickMs',
  'projectileSpeedTilesPerSecond',
  'projectileTtlMs',
] as const;

const NINJA_KUNAI_BURST_FIELDS = [
  'baseKunai',
  'kunaiPerStack',
  'damage',
  'speedTilesPerSecond',
  'ttlMs',
  'radiusTiles',
] as const;

const NINJA_SMOKE_BOMB_FIELDS = [
  'slowByStack',
  'fireRateBonusByStack',
  'radiusTilesByStack',
  'durationMsByStack',
] as const;

const CULTIVATOR_CLASS_SKILLS_FIELDS = [
  'orbitSwords',
  'swordArray',
  'swordQi',
  'qiBarrier',
  'myriadSwords',
] as const;

const CULTIVATOR_ORBIT_SWORDS_FIELDS = [
  'swordsByStack',
  'slashIntervalMs',
  'damageRatioByStack',
  'reachTilesByStack',
  'dartSpeedTilesPerSecond',
  'dartTravelMs',
  'orbitRadiusTiles',
  'orbitSpinRadiansPerSecond',
] as const;

const CULTIVATOR_SWORD_ARRAY_FIELDS = [
  'radiusTilesByStack',
  'durationMsByStack',
  'damageRatioByStack',
  'tickMs',
] as const;

const CULTIVATOR_SWORD_QI_FIELDS = [
  'everyNShots',
  'damageRatioByStack',
  'halfWidthTilesByStack',
  'durationMsByStack',
  'speedTilesPerSecond',
] as const;

const CULTIVATOR_QI_BARRIER_FIELDS = [
  'chargeByStack',
  'wavesByStack',
  'waveDamageRatioByStack',
  'waveHalfWidthTilesByStack',
  'waveDurationMsByStack',
  'waveSpeedTilesPerSecond',
] as const;

const CULTIVATOR_MYRIAD_SWORDS_FIELDS = [
  'arrayIntervalMs',
  'miniWaveDamageRatio',
  'miniWaveRadiusTiles',
  'miniWaveDurationMs',
  'miniWaveSpeedTilesPerSecond',
] as const;

const CHARACTER_FIELDS = [
  'unlockChapter',
  'unlockGoldCost',
  'baseStats',
  'passive',
  'signature',
] as const;

const CHARACTER_BASE_STATS_FIELDS = [
  'maxHpDelta',
  'damageMult',
  'fireRateMult',
  'moveSpeedMult',
  'projectileSpeedMult',
  'targetingRangeMult',
] as const;

const CHARACTER_PASSIVE_FIELDS = [
  'moveSpeedBonus',
  'dashCooldownMult',
  'pierceAdd',
  'critChanceAdd',
  'critMultiplier',
  'activeCooldownMult',
  'activePowerBonus',
  'aoePowerBonus',
  'damageBonus',
  'executeThreshold',
  'executeBonus',
] as const;

const CHARACTER_SIGNATURE_FIELDS = [
  'cooldownMs',
  'hitCooldownReductionMs',
  'killCooldownReductionMs',
  'projectileCount',
  'maxProjectileCount',
  'fanArcDegrees',
  'speedTilesPerSecond',
  'radiusTiles',
  'ttlMs',
  'damageMultiplier',
  'pierceCount',
  'homing',
  'novaRadiusTiles',
  'novaDamageMultiplier',
  'novaSlowFactor',
  'novaSlowDurationMs',
  'hideAttachmentMs',
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

const ARCHER_CLASS_SKILL_FIELDS = [
  'arrowRain',
  'splitArrow',
  'huntersMark',
  'windArrow',
  'skyTempest',
] as const;

const ARROW_RAIN_FIELDS = ['everyShots', 'radiusTiles', 'damageRatioByStack'] as const;

const SPLIT_ARROW_FIELDS = ['arrows', 'angleDegrees', 'damageRatioByStack'] as const;

const HUNTERS_MARK_FIELDS = ['durationMs', 'radiusTiles', 'damageRatioByStack'] as const;

const WIND_ARROW_FIELDS = [
  'momentumCap',
  'resetMs',
  'buffDurationMs',
  'fireRatePerMomentum',
  'projectileSpeedPerMomentum',
] as const;

const SKY_TEMPEST_FIELDS = ['arrows', 'pierce', 'damageRatio'] as const;

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

const MAGE_FIELDS = ['meteor', 'frostOrbs', 'stormStrike', 'arcanePulse', 'evolution'] as const;

const MAGE_METEOR_FIELDS = [
  'intervalMs',
  'intervalStepMs',
  'radiusTiles',
  'damageRatio',
  'burnDpsRatio',
  'burnDurationMs',
] as const;

const MAGE_FROST_ORBS_FIELDS = [
  'baseCount',
  'countPerStack',
  'radiusTiles',
  'orbitRadiansPerSecond',
  'evolvedOrbitMultiplier',
  'hitRadiusTiles',
  'damagePerSecondRatio',
  'slowFactor',
  'slowDurationMs',
] as const;

const MAGE_STORM_STRIKE_FIELDS = [
  'procChance',
  'procChancePerStack',
  'damageRatio',
] as const;

const MAGE_ARCANE_PULSE_FIELDS = [
  'shotEvery',
  'radiusTiles',
  'damageRatio',
  'damageRatioPerStack',
] as const;

const MAGE_EVOLUTION_FIELDS = [
  'shardIntervalMs',
  'shardDamageRatio',
  'shatterBurnMultiplier',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined (missing field?)';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function joinPath(prefix: string, key: string): string {
  return prefix === '' ? key : `${prefix}.${key}`;
}

/**
 * Read one number field; `options` decides the constraints. Returns `undefined` on error so
 * the caller can use a safe default (a bad config yields one clear error instead of
 * NaN leaking into combat).
 */
function readNumber(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
  options: { readonly integer?: boolean; readonly positive?: boolean } = {},
): number | undefined {
  const value = source[field];
  const fieldPath = joinPath(path, field);

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.add(fieldPath, `must be a finite number, got ${describe(value)}`);
    return undefined;
  }
  if (value < 0) {
    problems.add(fieldPath, `must not be negative, got ${value}`);
    return undefined;
  }
  if (options.positive === true && value === 0) {
    problems.add(fieldPath, `must be > 0, got ${value}`);
    return undefined;
  }
  if (options.integer === true && !Number.isInteger(value)) {
    problems.add(fieldPath, `must be an integer, got ${value}`);
    return undefined;
  }
  return value;
}

/**
 * Read an array of non-negative finite numbers with an exact length (per-stack tables).
 * Returns `[]` on a shape error so callers keep a safe fallback.
 */
function readNumberArray(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
  options: {
    readonly length?: number;
    readonly positive?: boolean;
    readonly integer?: boolean;
    readonly max?: number;
  } = {},
): readonly number[] {
  const fieldPath = joinPath(path, field);
  const value = source[field];
  if (!Array.isArray(value)) {
    problems.add(fieldPath, `must be an array of numbers, got ${describe(value)}`);
    return [];
  }
  if (options.length !== undefined && value.length !== options.length) {
    problems.add(
      fieldPath,
      `must have exactly ${options.length} elements (one per stack), got ${value.length}`,
    );
    return [];
  }
  const result: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      problems.add(`${fieldPath}[${index}]`, `must be a finite number, got ${describe(entry)}`);
      continue;
    }
    if (entry < 0) {
      problems.add(`${fieldPath}[${index}]`, `must not be negative, got ${entry}`);
      continue;
    }
    if (options.positive === true && entry === 0) {
      problems.add(`${fieldPath}[${index}]`, `must be > 0, got ${entry}`);
      continue;
    }
    if (options.integer === true && !Number.isInteger(entry)) {
      problems.add(`${fieldPath}[${index}]`, `must be an integer, got ${entry}`);
      continue;
    }
    if (options.max !== undefined && entry > options.max) {
      problems.add(`${fieldPath}[${index}]`, `must be <= ${options.max}, got ${entry}`);
      continue;
    }
    result.push(entry);
  }
  return result;
}

/** Read a signed integer within `[min, max]` (used for signed deltas like `maxHeartsDelta`). */
function readSignedInteger(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
  min: number,
  max: number,
  fallback = 0,
): number {
  const value = source[field];
  const fieldPath = joinPath(path, field);

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.add(fieldPath, `must be a finite number, got ${describe(value)}`);
    return fallback;
  }
  if (!Number.isInteger(value)) {
    problems.add(fieldPath, `must be an integer, got ${value}`);
    return fallback;
  }
  if (value < min || value > max) {
    problems.add(fieldPath, `must be within ${min}..${max}, got ${value}`);
    return fallback;
  }
  return value;
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

/** Report exactly the missing field, plus the list of expected fields. */
function readObject(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
  expected: readonly string[],
): Record<string, unknown> | undefined {
  const value = source[field];
  if (!isRecord(value)) {
    problems.add(
      joinPath(path, field),
      `must be an object { ${expected.join(', ')} }, got ${describe(value)}`,
    );
    return undefined;
  }

  for (const key of expected) {
    if (!(key in value))
      problems.add(joinPath(joinPath(path, field), key), 'missing field');
  }
  return value;
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

/**
 * Read a non-empty array of finite, positive numbers (per-stack multipliers). The array's
 * length is the skill's stack count; the hooks clamp a stack past the end to the last entry.
 */
function readNumberList(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
): readonly number[] {
  const fieldPath = joinPath(path, field);
  const value = source[field];
  if (!Array.isArray(value) || value.length === 0) {
    problems.add(fieldPath, `must be a non-empty array of numbers, got ${describe(value)}`);
    return [];
  }

  const result: number[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) {
      problems.add(`${fieldPath}[${index}]`, `must be a finite number > 0, got ${describe(entry)}`);
      result.push(0);
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

function zeroCombat(): CombatTuning {
  return {
    fireRatePerSecond: 0,
    damage: 0,
    projectiles: 1,
    projectileSpeedTilesPerSecond: 0,
    moveSpeedTilesPerSecond: 0,
    roomClearSpeedMultiplier: 1,
    playerBaseMaxHp: 100,
    invulnerabilityMs: 0,
    contactDamage: 0,
    targetingRangeTiles: 0,
    playerKnockbackDistanceTiles: 0,
    playerKnockbackDurationMs: 0,
    enemyKnockbackDistanceTiles: 0,
    enemyKnockbackDurationMs: 0,
    enemyHitstopMs: 0,
    enemyStaggerMs: 0,
  };
}

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

function parseCombat(
  raw: Record<string, unknown>,
  problems: ProblemList,
): CombatTuning {
  const source = readObject(raw, 'combat', '', problems, COMBAT_FIELDS);
  if (source === undefined) return zeroCombat();

  const path = 'combat';
  return {
    fireRatePerSecond:
      readNumber(source, 'fireRatePerSecond', path, problems, {
        positive: true,
      }) ?? 0,
    damage: readNumber(source, 'damage', path, problems) ?? 0,
    projectiles:
      readNumber(source, 'projectiles', path, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    projectileSpeedTilesPerSecond:
      readNumber(source, 'projectileSpeedTilesPerSecond', path, problems, {
        positive: true,
      }) ?? 0,
    moveSpeedTilesPerSecond:
      readNumber(source, 'moveSpeedTilesPerSecond', path, problems, {
        positive: true,
      }) ?? 0,
    roomClearSpeedMultiplier: (() => {
      const value =
        readNumber(source, 'roomClearSpeedMultiplier', path, problems, {
          positive: true,
        }) ?? 1;
      if (value < 1) {
        problems.add(`${path}.roomClearSpeedMultiplier`, `must be >= 1, got ${value}`);
      }
      return value;
    })(),
    playerBaseMaxHp:
      readNumber(source, 'playerBaseMaxHp', path, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    invulnerabilityMs:
      readNumber(source, 'invulnerabilityMs', path, problems) ?? 0,
    contactDamage: readNumber(source, 'contactDamage', path, problems) ?? 0,
    targetingRangeTiles:
      readNumber(source, 'targetingRangeTiles', path, problems, {
        positive: true,
      }) ?? 0,
    playerKnockbackDistanceTiles:
      readNumber(source, 'playerKnockbackDistanceTiles', path, problems, {
        positive: true,
      }) ?? 0,
    playerKnockbackDurationMs:
      readNumber(source, 'playerKnockbackDurationMs', path, problems, {
        positive: true,
      }) ?? 0,
    enemyKnockbackDistanceTiles:
      readNumber(source, 'enemyKnockbackDistanceTiles', path, problems) ?? 0,
    enemyKnockbackDurationMs:
      readNumber(source, 'enemyKnockbackDurationMs', path, problems) ?? 0,
    enemyHitstopMs: readNumber(source, 'enemyHitstopMs', path, problems) ?? 0,
    enemyStaggerMs: readNumber(source, 'enemyStaggerMs', path, problems) ?? 0,
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

/** A 0..1 opacity/ratio: a value above 1 is reported and clamped (never silently > 1). */
function readRatio(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
): number {
  const value = readNumber(source, field, path, problems);
  if (value === undefined) return 0;
  if (value > 1) {
    problems.add(joinPath(path, field), `must be within 0..1, got ${value}`);
    return 1;
  }
  return value;
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

/** Read a boolean field; missing/wrong type is reported with the expected type. */
function readBoolean(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
  fallback: boolean,
): boolean {
  const value = source[field];
  if (typeof value === 'boolean') return value;
  problems.add(joinPath(path, field), `must be a boolean, got ${describe(value)}`);
  return fallback;
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

function zeroDash(): DashTuning {
  return {
    bufferMs: 150,
    cooldownMs: 1800,
    durationMs: 180,
    speedTilesPerSecond: 14,
    invulnerabilityMs: 220,
  };
}

function parseDash(raw: Record<string, unknown>, problems: ProblemList): DashTuning {
  const source = readObject(raw, 'dash', '', problems, DASH_FIELDS);
  if (source === undefined) return zeroDash();

  const path = 'dash';
  return {
    bufferMs: readNumber(source, 'bufferMs', path, problems, { integer: true }) ?? 0,
    cooldownMs:
      readNumber(source, 'cooldownMs', path, problems, { integer: true, positive: true }) ?? 1,
    durationMs:
      readNumber(source, 'durationMs', path, problems, { integer: true, positive: true }) ?? 1,
    speedTilesPerSecond:
      readNumber(source, 'speedTilesPerSecond', path, problems, { positive: true }) ?? 1,
    invulnerabilityMs:
      readNumber(source, 'invulnerabilityMs', path, problems, { integer: true }) ?? 0,
  };
}

function zeroActiveSkill(): ActiveSkillTuning {
  return {
    bufferMs: 150,
    cooldownMs: 10000,
    hitCooldownReductionMs: 200,
    killCooldownReductionMs: 650,
    barrageProjectiles: 10,
    barrageDamageMultiplier: 1.5,
  };
}

function parseActiveSkill(raw: Record<string, unknown>, problems: ProblemList): ActiveSkillTuning {
  const source = readObject(raw, 'activeSkill', '', problems, ACTIVE_SKILL_FIELDS);
  if (source === undefined) return zeroActiveSkill();

  const path = 'activeSkill';
  return {
    bufferMs: readNumber(source, 'bufferMs', path, problems, { integer: true }) ?? 0,
    cooldownMs:
      readNumber(source, 'cooldownMs', path, problems, { integer: true, positive: true }) ?? 1,
    hitCooldownReductionMs:
      readNumber(source, 'hitCooldownReductionMs', path, problems, { integer: true }) ?? 0,
    killCooldownReductionMs:
      readNumber(source, 'killCooldownReductionMs', path, problems, { integer: true }) ?? 0,
    barrageProjectiles:
      readNumber(source, 'barrageProjectiles', path, problems, {
        integer: true,
        positive: true,
      }) ?? 1,
    barrageDamageMultiplier:
      readNumber(source, 'barrageDamageMultiplier', path, problems, { positive: true }) ?? 1,
  };
}

function zeroNinjaShadowClone(): NinjaShadowCloneTuning {
  return {
    damageRatioByStack: [],
    durationMs: 0,
    fireIntervalMs: 1,
    rangeTiles: 0,
    projectileSpeedTilesPerSecond: 0,
    projectileTtlMs: 0,
  };
}

function zeroNinjaVenomShuriken(): NinjaVenomShurikenTuning {
  return {
    everyNShots: 1,
    damageByStack: [],
    radiusTilesByStack: [],
    durationMsByStack: [],
    damageTickMs: 1,
    projectileSpeedTilesPerSecond: 0,
    projectileTtlMs: 0,
  };
}

function zeroNinjaKunaiBurst(): NinjaKunaiBurstTuning {
  return {
    baseKunai: 0,
    kunaiPerStack: 0,
    damage: 0,
    speedTilesPerSecond: 0,
    ttlMs: 0,
    radiusTiles: 0,
  };
}

function zeroNinjaSmokeBomb(): NinjaSmokeBombTuning {
  return {
    slowByStack: [],
    fireRateBonusByStack: [],
    radiusTilesByStack: [],
    durationMsByStack: [],
  };
}

function defaultArcherClassSkills(): ArcherClassSkillTuning {
  return {
    arrowRain: { everyShots: 5, radiusTiles: 2.2, damageRatioByStack: [0.8, 1.2, 1.6] },
    splitArrow: { arrows: 2, angleDegrees: 18, damageRatioByStack: [0.5, 0.7, 0.9] },
    huntersMark: { durationMs: 4000, radiusTiles: 1.6, damageRatioByStack: [1.5, 2.25] },
    windArrow: {
      momentumCap: 10,
      resetMs: 1500,
      buffDurationMs: 1500,
      fireRatePerMomentum: 0.01,
      projectileSpeedPerMomentum: 0.02,
    },
    skyTempest: { arrows: 6, pierce: 2, damageRatio: 0.5 },
  };
}

function zeroCultivatorOrbitSwords(): CultivatorOrbitSwordsTuning {
  return {
    swordsByStack: [],
    slashIntervalMs: 0,
    damageRatioByStack: [],
    reachTilesByStack: [],
    dartSpeedTilesPerSecond: 0,
    dartTravelMs: 0,
    orbitRadiusTiles: 0,
    orbitSpinRadiansPerSecond: 0,
  };
}

function zeroCultivatorSwordArray(): CultivatorSwordArrayTuning {
  return {
    radiusTilesByStack: [],
    durationMsByStack: [],
    damageRatioByStack: [],
    tickMs: 0,
  };
}

function zeroCultivatorSwordQi(): CultivatorSwordQiTuning {
  return {
    everyNShots: 1,
    damageRatioByStack: [],
    halfWidthTilesByStack: [],
    durationMsByStack: [],
    speedTilesPerSecond: 0,
  };
}

function zeroCultivatorQiBarrier(): CultivatorQiBarrierTuning {
  return {
    chargeByStack: [],
    wavesByStack: [],
    waveDamageRatioByStack: [],
    waveHalfWidthTilesByStack: [],
    waveDurationMsByStack: [],
    waveSpeedTilesPerSecond: 0,
  };
}

function zeroCultivatorMyriadSwords(): CultivatorMyriadSwordsTuning {
  return {
    arrayIntervalMs: 0,
    miniWaveDamageRatio: 0,
    miniWaveRadiusTiles: 0,
    miniWaveDurationMs: 0,
    miniWaveSpeedTilesPerSecond: 0,
  };
}

function zeroClassSkills(): ClassSkillsTuning {
  return {
    ninja: {
      shadowClone: zeroNinjaShadowClone(),
      venomShuriken: zeroNinjaVenomShuriken(),
      kunaiBurst: zeroNinjaKunaiBurst(),
      smokeBomb: zeroNinjaSmokeBomb(),
    },
    archer: defaultArcherClassSkills(),
    mage: zeroMageClassSkills(),
    cultivator: {
      orbitSwords: zeroCultivatorOrbitSwords(),
      swordArray: zeroCultivatorSwordArray(),
      swordQi: zeroCultivatorSwordQi(),
      qiBarrier: zeroCultivatorQiBarrier(),
      myriadSwords: zeroCultivatorMyriadSwords(),
    },
  };
}

function parseNinjaClassSkills(
  raw: Record<string, unknown>,
  problems: ProblemList,
): NinjaClassSkillsTuning {
  const rootPath = 'classSkills';
  const source = readObject(raw, 'ninja', rootPath, problems, NINJA_CLASS_SKILLS_FIELDS);
  if (source === undefined) return zeroClassSkills().ninja;

  const path = `${rootPath}.ninja`;

  const cloneSource = readObject(source, 'shadowClone', path, problems, NINJA_SHADOW_CLONE_FIELDS);
  const clonePath = `${path}.shadowClone`;
  const shadowClone: NinjaShadowCloneTuning =
    cloneSource === undefined
      ? zeroNinjaShadowClone()
      : {
          damageRatioByStack: readNumberArray(cloneSource, 'damageRatioByStack', clonePath, problems, {
            length: 3,
            positive: true,
          }),
          durationMs:
            readNumber(cloneSource, 'durationMs', clonePath, problems, { positive: true }) ?? 0,
          fireIntervalMs:
            readNumber(cloneSource, 'fireIntervalMs', clonePath, problems, {
              integer: true,
              positive: true,
            }) ?? 1,
          rangeTiles:
            readNumber(cloneSource, 'rangeTiles', clonePath, problems, { positive: true }) ?? 0,
          projectileSpeedTilesPerSecond:
            readNumber(cloneSource, 'projectileSpeedTilesPerSecond', clonePath, problems, {
              positive: true,
            }) ?? 0,
          projectileTtlMs:
            readNumber(cloneSource, 'projectileTtlMs', clonePath, problems, {
              integer: true,
              positive: true,
            }) ?? 0,
        };

  const venomSource = readObject(source, 'venomShuriken', path, problems, NINJA_VENOM_SHURIKEN_FIELDS);
  const venomPath = `${path}.venomShuriken`;
  const venomShuriken: NinjaVenomShurikenTuning =
    venomSource === undefined
      ? zeroNinjaVenomShuriken()
      : {
          everyNShots:
            readNumber(venomSource, 'everyNShots', venomPath, problems, {
              integer: true,
              positive: true,
            }) ?? 1,
          damageByStack: readNumberArray(venomSource, 'damageByStack', venomPath, problems, {
            length: 3,
            positive: true,
          }),
          radiusTilesByStack: readNumberArray(
            venomSource,
            'radiusTilesByStack',
            venomPath,
            problems,
            { length: 3, positive: true },
          ),
          durationMsByStack: readNumberArray(
            venomSource,
            'durationMsByStack',
            venomPath,
            problems,
            { length: 3, positive: true },
          ),
          damageTickMs:
            readNumber(venomSource, 'damageTickMs', venomPath, problems, {
              integer: true,
              positive: true,
            }) ?? 1,
          projectileSpeedTilesPerSecond:
            readNumber(venomSource, 'projectileSpeedTilesPerSecond', venomPath, problems, {
              positive: true,
            }) ?? 0,
          projectileTtlMs:
            readNumber(venomSource, 'projectileTtlMs', venomPath, problems, {
              integer: true,
              positive: true,
            }) ?? 0,
        };

  const kunaiSource = readObject(source, 'kunaiBurst', path, problems, NINJA_KUNAI_BURST_FIELDS);
  const kunaiPath = `${path}.kunaiBurst`;
  const kunaiBurst: NinjaKunaiBurstTuning =
    kunaiSource === undefined
      ? zeroNinjaKunaiBurst()
      : {
          baseKunai:
            readNumber(kunaiSource, 'baseKunai', kunaiPath, problems, {
              integer: true,
              positive: true,
            }) ?? 0,
          kunaiPerStack:
            readNumber(kunaiSource, 'kunaiPerStack', kunaiPath, problems, { integer: true }) ?? 0,
          damage:
            readNumber(kunaiSource, 'damage', kunaiPath, problems, { positive: true }) ?? 0,
          speedTilesPerSecond:
            readNumber(kunaiSource, 'speedTilesPerSecond', kunaiPath, problems, {
              positive: true,
            }) ?? 0,
          ttlMs:
            readNumber(kunaiSource, 'ttlMs', kunaiPath, problems, {
              integer: true,
              positive: true,
            }) ?? 0,
          radiusTiles:
            readNumber(kunaiSource, 'radiusTiles', kunaiPath, problems, { positive: true }) ?? 0,
        };

  const smokeSource = readObject(source, 'smokeBomb', path, problems, NINJA_SMOKE_BOMB_FIELDS);
  const smokePath = `${path}.smokeBomb`;
  const smokeBomb: NinjaSmokeBombTuning =
    smokeSource === undefined
      ? zeroNinjaSmokeBomb()
      : {
          slowByStack: readNumberArray(smokeSource, 'slowByStack', smokePath, problems, {
            length: 2,
            positive: true,
          }),
          fireRateBonusByStack: readNumberArray(
            smokeSource,
            'fireRateBonusByStack',
            smokePath,
            problems,
            { length: 2 },
          ),
          radiusTilesByStack: readNumberArray(
            smokeSource,
            'radiusTilesByStack',
            smokePath,
            problems,
            { length: 2, positive: true },
          ),
          durationMsByStack: readNumberArray(
            smokeSource,
            'durationMsByStack',
            smokePath,
            problems,
            { length: 2, positive: true },
          ),
        };

  return { shadowClone, venomShuriken, kunaiBurst, smokeBomb };
}

function parseCultivatorClassSkills(
  raw: Record<string, unknown>,
  problems: ProblemList,
): CultivatorClassSkillsTuning {
  const rootPath = 'classSkills';
  const source = readObject(raw, 'cultivator', rootPath, problems, CULTIVATOR_CLASS_SKILLS_FIELDS);
  if (source === undefined) return zeroClassSkills().cultivator;

  const path = `${rootPath}.cultivator`;

  const orbitSource = readObject(
    source,
    'orbitSwords',
    path,
    problems,
    CULTIVATOR_ORBIT_SWORDS_FIELDS,
  );
  const orbitPath = `${path}.orbitSwords`;
  const orbitSwords: CultivatorOrbitSwordsTuning =
    orbitSource === undefined
      ? zeroCultivatorOrbitSwords()
      : {
          swordsByStack: readNumberArray(orbitSource, 'swordsByStack', orbitPath, problems, {
            length: 3,
            integer: true,
            positive: true,
          }),
          slashIntervalMs:
            readNumber(orbitSource, 'slashIntervalMs', orbitPath, problems, {
              integer: true,
              positive: true,
            }) ?? 0,
          damageRatioByStack: readNumberArray(
            orbitSource,
            'damageRatioByStack',
            orbitPath,
            problems,
            { length: 3, positive: true },
          ),
          reachTilesByStack: readNumberArray(
            orbitSource,
            'reachTilesByStack',
            orbitPath,
            problems,
            { length: 3, positive: true },
          ),
          dartSpeedTilesPerSecond:
            readNumber(orbitSource, 'dartSpeedTilesPerSecond', orbitPath, problems, {
              positive: true,
            }) ?? 0,
          dartTravelMs:
            readNumber(orbitSource, 'dartTravelMs', orbitPath, problems, {
              integer: true,
              positive: true,
            }) ?? 0,
          orbitRadiusTiles:
            readNumber(orbitSource, 'orbitRadiusTiles', orbitPath, problems, {
              positive: true,
            }) ?? 0,
          orbitSpinRadiansPerSecond:
            readNumber(orbitSource, 'orbitSpinRadiansPerSecond', orbitPath, problems, {
              positive: true,
            }) ?? 0,
        };

  const arraySource = readObject(
    source,
    'swordArray',
    path,
    problems,
    CULTIVATOR_SWORD_ARRAY_FIELDS,
  );
  const arrayPath = `${path}.swordArray`;
  const swordArray: CultivatorSwordArrayTuning =
    arraySource === undefined
      ? zeroCultivatorSwordArray()
      : {
          radiusTilesByStack: readNumberArray(
            arraySource,
            'radiusTilesByStack',
            arrayPath,
            problems,
            { length: 2, positive: true },
          ),
          durationMsByStack: readNumberArray(
            arraySource,
            'durationMsByStack',
            arrayPath,
            problems,
            { length: 2, positive: true },
          ),
          damageRatioByStack: readNumberArray(
            arraySource,
            'damageRatioByStack',
            arrayPath,
            problems,
            { length: 2, positive: true },
          ),
          tickMs:
            readNumber(arraySource, 'tickMs', arrayPath, problems, {
              integer: true,
              positive: true,
            }) ?? 0,
        };

  const qiSource = readObject(source, 'swordQi', path, problems, CULTIVATOR_SWORD_QI_FIELDS);
  const qiPath = `${path}.swordQi`;
  const swordQi: CultivatorSwordQiTuning =
    qiSource === undefined
      ? zeroCultivatorSwordQi()
      : {
          everyNShots:
            readNumber(qiSource, 'everyNShots', qiPath, problems, {
              integer: true,
              positive: true,
            }) ?? 1,
          damageRatioByStack: readNumberArray(qiSource, 'damageRatioByStack', qiPath, problems, {
            length: 3,
            positive: true,
          }),
          halfWidthTilesByStack: readNumberArray(
            qiSource,
            'halfWidthTilesByStack',
            qiPath,
            problems,
            { length: 3, positive: true },
          ),
          durationMsByStack: readNumberArray(qiSource, 'durationMsByStack', qiPath, problems, {
            length: 3,
            positive: true,
          }),
          speedTilesPerSecond:
            readNumber(qiSource, 'speedTilesPerSecond', qiPath, problems, { positive: true }) ?? 0,
        };

  const barrierSource = readObject(
    source,
    'qiBarrier',
    path,
    problems,
    CULTIVATOR_QI_BARRIER_FIELDS,
  );
  const barrierPath = `${path}.qiBarrier`;
  const qiBarrier: CultivatorQiBarrierTuning =
    barrierSource === undefined
      ? zeroCultivatorQiBarrier()
      : {
          chargeByStack: readNumberArray(barrierSource, 'chargeByStack', barrierPath, problems, {
            length: 3,
            positive: true,
            max: 1,
          }),
          wavesByStack: readNumberArray(barrierSource, 'wavesByStack', barrierPath, problems, {
            length: 3,
            integer: true,
            positive: true,
          }),
          waveDamageRatioByStack: readNumberArray(
            barrierSource,
            'waveDamageRatioByStack',
            barrierPath,
            problems,
            { length: 3, positive: true },
          ),
          waveHalfWidthTilesByStack: readNumberArray(
            barrierSource,
            'waveHalfWidthTilesByStack',
            barrierPath,
            problems,
            { length: 3, positive: true },
          ),
          waveDurationMsByStack: readNumberArray(
            barrierSource,
            'waveDurationMsByStack',
            barrierPath,
            problems,
            { length: 3, positive: true },
          ),
          waveSpeedTilesPerSecond:
            readNumber(barrierSource, 'waveSpeedTilesPerSecond', barrierPath, problems, {
              positive: true,
            }) ?? 0,
        };

  const myriadSource = readObject(
    source,
    'myriadSwords',
    path,
    problems,
    CULTIVATOR_MYRIAD_SWORDS_FIELDS,
  );
  const myriadPath = `${path}.myriadSwords`;
  const myriadSwords: CultivatorMyriadSwordsTuning =
    myriadSource === undefined
      ? zeroCultivatorMyriadSwords()
      : {
          arrayIntervalMs:
            readNumber(myriadSource, 'arrayIntervalMs', myriadPath, problems, {
              integer: true,
              positive: true,
            }) ?? 0,
          miniWaveDamageRatio:
            readNumber(myriadSource, 'miniWaveDamageRatio', myriadPath, problems, {
              positive: true,
            }) ?? 0,
          miniWaveRadiusTiles:
            readNumber(myriadSource, 'miniWaveRadiusTiles', myriadPath, problems, {
              positive: true,
            }) ?? 0,
          miniWaveDurationMs:
            readNumber(myriadSource, 'miniWaveDurationMs', myriadPath, problems, {
              integer: true,
              positive: true,
            }) ?? 0,
          miniWaveSpeedTilesPerSecond:
            readNumber(myriadSource, 'miniWaveSpeedTilesPerSecond', myriadPath, problems, {
              positive: true,
            }) ?? 0,
        };

  return { orbitSwords, swordArray, swordQi, qiBarrier, myriadSwords };
}

function parseClassSkills(
  raw: Record<string, unknown>,
  problems: ProblemList,
): ClassSkillsTuning {
  const source = readObject(raw, 'classSkills', '', problems, CLASS_SKILLS_FIELDS);
  if (source === undefined) return zeroClassSkills();
  return {
    ninja: parseNinjaClassSkills(source, problems),
    archer: parseArcherClassSkills(source, problems),
    mage: parseMageClassSkills(source, problems),
    cultivator: parseCultivatorClassSkills(source, problems),
  };
}

function zeroCharacter(): CharacterTuning {
  return {
    unlockChapter: 0,
    unlockGoldCost: 0,
    baseStats: {
      maxHpDelta: 0,
      damageMult: 1,
      fireRateMult: 1,
      moveSpeedMult: 1,
      projectileSpeedMult: 1,
      targetingRangeMult: 1,
    },
    passive: {
      moveSpeedBonus: 0,
      dashCooldownMult: 1,
      pierceAdd: 0,
      critChanceAdd: 0,
      critMultiplier: 1,
      activeCooldownMult: 1,
      activePowerBonus: 0,
      aoePowerBonus: 0,
      damageBonus: 0,
      executeThreshold: 0,
      executeBonus: 0,
    },
    signature: {
      cooldownMs: 10000,
      hitCooldownReductionMs: 200,
      killCooldownReductionMs: 650,
      projectileCount: 1,
      maxProjectileCount: 1,
      fanArcDegrees: 0,
      speedTilesPerSecond: 12,
      radiusTiles: 0.18,
      ttlMs: 1200,
      damageMultiplier: 1,
      pierceCount: 0,
      homing: false,
      novaRadiusTiles: 0,
      novaDamageMultiplier: 0,
      novaSlowFactor: 1,
      novaSlowDurationMs: 0,
      hideAttachmentMs: 0,
    },
  };
}

function zeroCharacters(): CharactersTuning {
  const result = {} as Record<TuningCharacterId, CharacterTuning>;
  for (const id of TUNING_CHARACTER_IDS) result[id] = zeroCharacter();
  return result;
}

function parseCharacterEntry(
  source: Record<string, unknown>,
  id: TuningCharacterId,
  problems: ProblemList,
): CharacterTuning {
  const entry = readObject(source, id, 'characters', problems, CHARACTER_FIELDS);
  if (entry === undefined) return zeroCharacter();

  const path = `characters.${id}`;
  const unlockChapter = readSignedInteger(
    entry,
    'unlockChapter',
    path,
    problems,
    0,
    CHAPTERS_PER_RUN - 1,
    0,
  );
  const unlockGoldCost =
    readNumber(entry, 'unlockGoldCost', path, problems, { integer: true }) ?? 0;

  const baseSource = readObject(entry, 'baseStats', path, problems, CHARACTER_BASE_STATS_FIELDS) ?? {};
  const basePath = `${path}.baseStats`;
  const baseStats: CharacterBaseStatsTuning = {
    maxHpDelta: readSignedInteger(baseSource, 'maxHpDelta', basePath, problems, -80, 200, 0),
    damageMult: readNumber(baseSource, 'damageMult', basePath, problems, { positive: true }) ?? 1,
    fireRateMult:
      readNumber(baseSource, 'fireRateMult', basePath, problems, { positive: true }) ?? 1,
    moveSpeedMult:
      readNumber(baseSource, 'moveSpeedMult', basePath, problems, { positive: true }) ?? 1,
    projectileSpeedMult:
      readNumber(baseSource, 'projectileSpeedMult', basePath, problems, { positive: true }) ?? 1,
    targetingRangeMult:
      readNumber(baseSource, 'targetingRangeMult', basePath, problems, { positive: true }) ?? 1,
  };

  const passiveSource = readObject(entry, 'passive', path, problems, CHARACTER_PASSIVE_FIELDS) ?? {};
  const passivePath = `${path}.passive`;
  const critMultiplier =
    readNumber(passiveSource, 'critMultiplier', passivePath, problems, { positive: true }) ?? 1;
  if (critMultiplier < 1) {
    problems.add(`${passivePath}.critMultiplier`, `must be >= 1, got ${critMultiplier}`);
  }
  const passive: CharacterPassiveTuning = {
    moveSpeedBonus: readNumber(passiveSource, 'moveSpeedBonus', passivePath, problems) ?? 0,
    dashCooldownMult:
      readNumber(passiveSource, 'dashCooldownMult', passivePath, problems, { positive: true }) ?? 1,
    pierceAdd:
      readNumber(passiveSource, 'pierceAdd', passivePath, problems, { integer: true }) ?? 0,
    critChanceAdd: readRatio(passiveSource, 'critChanceAdd', passivePath, problems),
    critMultiplier: Math.max(1, critMultiplier),
    activeCooldownMult:
      readNumber(passiveSource, 'activeCooldownMult', passivePath, problems, { positive: true }) ??
      1,
    activePowerBonus: readNumber(passiveSource, 'activePowerBonus', passivePath, problems) ?? 0,
    aoePowerBonus: readNumber(passiveSource, 'aoePowerBonus', passivePath, problems) ?? 0,
    damageBonus: readNumber(passiveSource, 'damageBonus', passivePath, problems) ?? 0,
    executeThreshold: readRatio(passiveSource, 'executeThreshold', passivePath, problems),
    executeBonus: readNumber(passiveSource, 'executeBonus', passivePath, problems) ?? 0,
  };

  const sigSource =
    readObject(entry, 'signature', path, problems, CHARACTER_SIGNATURE_FIELDS) ?? {};
  const sigPath = `${path}.signature`;
  const projectileCount =
    readNumber(sigSource, 'projectileCount', sigPath, problems, {
      integer: true,
      positive: true,
    }) ?? 1;
  const maxProjectileCount =
    readNumber(sigSource, 'maxProjectileCount', sigPath, problems, {
      integer: true,
      positive: true,
    }) ?? projectileCount;
  if (maxProjectileCount < projectileCount) {
    problems.add(
      `${sigPath}.maxProjectileCount`,
      `must be >= projectileCount (${projectileCount}), got ${maxProjectileCount}`,
    );
  }
  const fanArcDegrees = readNumber(sigSource, 'fanArcDegrees', sigPath, problems) ?? 0;
  if (fanArcDegrees > 360) {
    problems.add(`${sigPath}.fanArcDegrees`, `must be within 0..360, got ${fanArcDegrees}`);
  }
  const signature: CharacterSignatureTuning = {
    cooldownMs:
      readNumber(sigSource, 'cooldownMs', sigPath, problems, { integer: true, positive: true }) ??
      10000,
    hitCooldownReductionMs:
      readNumber(sigSource, 'hitCooldownReductionMs', sigPath, problems, { integer: true }) ?? 0,
    killCooldownReductionMs:
      readNumber(sigSource, 'killCooldownReductionMs', sigPath, problems, { integer: true }) ?? 0,
    projectileCount,
    maxProjectileCount,
    fanArcDegrees,
    speedTilesPerSecond:
      readNumber(sigSource, 'speedTilesPerSecond', sigPath, problems, { positive: true }) ?? 12,
    radiusTiles: readNumber(sigSource, 'radiusTiles', sigPath, problems, { positive: true }) ?? 0.18,
    ttlMs: readNumber(sigSource, 'ttlMs', sigPath, problems, { integer: true, positive: true }) ?? 1000,
    damageMultiplier:
      readNumber(sigSource, 'damageMultiplier', sigPath, problems, { positive: true }) ?? 1,
    pierceCount: readNumber(sigSource, 'pierceCount', sigPath, problems, { integer: true }) ?? 0,
    homing: readBoolean(sigSource, 'homing', sigPath, problems, false),
    novaRadiusTiles: readNumber(sigSource, 'novaRadiusTiles', sigPath, problems) ?? 0,
    novaDamageMultiplier: readNumber(sigSource, 'novaDamageMultiplier', sigPath, problems) ?? 0,
    novaSlowFactor: readRatio(sigSource, 'novaSlowFactor', sigPath, problems),
    novaSlowDurationMs:
      readNumber(sigSource, 'novaSlowDurationMs', sigPath, problems, { integer: true }) ?? 0,
    hideAttachmentMs:
      readNumber(sigSource, 'hideAttachmentMs', sigPath, problems, { integer: true }) ?? 0,
  };

  return {
    unlockChapter,
    unlockGoldCost,
    baseStats,
    passive,
    signature,
  };
}

function parseCharacters(raw: Record<string, unknown>, problems: ProblemList): CharactersTuning {
  const source = readObject(raw, 'characters', '', problems, TUNING_CHARACTER_IDS);
  if (source === undefined) return zeroCharacters();

  const result = {} as Record<TuningCharacterId, CharacterTuning>;
  for (const id of TUNING_CHARACTER_IDS) {
    result[id] = parseCharacterEntry(source, id, problems);
  }
  return result;
}

function zeroMageClassSkills(): MageClassSkillsTuning {
  return {
    meteor: {
      intervalMs: 4500,
      intervalStepMs: 1000,
      radiusTiles: 2,
      damageRatio: 2.5,
      burnDpsRatio: 0.6,
      burnDurationMs: 2500,
    },
    frostOrbs: {
      baseCount: 2,
      countPerStack: 1,
      radiusTiles: 1.6,
      orbitRadiansPerSecond: 1.2,
      evolvedOrbitMultiplier: 2,
      hitRadiusTiles: 0.55,
      damagePerSecondRatio: 0.8,
      slowFactor: 0.35,
      slowDurationMs: 800,
    },
    stormStrike: { procChance: 0.2, procChancePerStack: 0.1, damageRatio: 1.6 },
    arcanePulse: {
      shotEvery: 4,
      radiusTiles: 1.8,
      damageRatio: 0.8,
      damageRatioPerStack: 0.4,
    },
    evolution: { shardIntervalMs: 900, shardDamageRatio: 0.8, shatterBurnMultiplier: 2 },
  };
}

function parseMageMeteor(
  source: Record<string, unknown>,
  problems: ProblemList,
): MageMeteorTuning {
  const block = readObject(source, 'meteor', 'classSkills.mage', problems, MAGE_METEOR_FIELDS);
  if (block === undefined) return zeroMageClassSkills().meteor;

  const path = 'classSkills.mage.meteor';
  return {
    intervalMs:
      readNumber(block, 'intervalMs', path, problems, { positive: true }) ?? 4500,
    intervalStepMs: readNumber(block, 'intervalStepMs', path, problems) ?? 0,
    radiusTiles:
      readNumber(block, 'radiusTiles', path, problems, { positive: true }) ?? 1,
    damageRatio:
      readNumber(block, 'damageRatio', path, problems, { positive: true }) ?? 1,
    burnDpsRatio: readNumber(block, 'burnDpsRatio', path, problems) ?? 0,
    burnDurationMs: readNumber(block, 'burnDurationMs', path, problems, { integer: true }) ?? 0,
  };
}

function parseMageFrostOrbs(
  source: Record<string, unknown>,
  problems: ProblemList,
): MageFrostOrbsTuning {
  const block = readObject(
    source,
    'frostOrbs',
    'classSkills.mage',
    problems,
    MAGE_FROST_ORBS_FIELDS,
  );
  if (block === undefined) return zeroMageClassSkills().frostOrbs;

  const path = 'classSkills.mage.frostOrbs';
  return {
    baseCount: readNumber(block, 'baseCount', path, problems, { integer: true }) ?? 0,
    countPerStack:
      readNumber(block, 'countPerStack', path, problems, { integer: true }) ?? 0,
    radiusTiles:
      readNumber(block, 'radiusTiles', path, problems, { positive: true }) ?? 1,
    orbitRadiansPerSecond:
      readNumber(block, 'orbitRadiansPerSecond', path, problems, { positive: true }) ?? 1,
    evolvedOrbitMultiplier:
      readNumber(block, 'evolvedOrbitMultiplier', path, problems, { positive: true }) ?? 1,
    hitRadiusTiles:
      readNumber(block, 'hitRadiusTiles', path, problems, { positive: true }) ?? 0.5,
    damagePerSecondRatio:
      readNumber(block, 'damagePerSecondRatio', path, problems, { positive: true }) ?? 1,
    slowFactor: readRatio(block, 'slowFactor', path, problems),
    slowDurationMs:
      readNumber(block, 'slowDurationMs', path, problems, { integer: true }) ?? 0,
  };
}

function parseMageStormStrike(
  source: Record<string, unknown>,
  problems: ProblemList,
): MageStormStrikeTuning {
  const block = readObject(
    source,
    'stormStrike',
    'classSkills.mage',
    problems,
    MAGE_STORM_STRIKE_FIELDS,
  );
  if (block === undefined) return zeroMageClassSkills().stormStrike;

  const path = 'classSkills.mage.stormStrike';
  return {
    procChance: readRatio(block, 'procChance', path, problems),
    procChancePerStack: readRatio(block, 'procChancePerStack', path, problems),
    damageRatio:
      readNumber(block, 'damageRatio', path, problems, { positive: true }) ?? 1,
  };
}

function parseMageArcanePulse(
  source: Record<string, unknown>,
  problems: ProblemList,
): MageArcanePulseTuning {
  const block = readObject(
    source,
    'arcanePulse',
    'classSkills.mage',
    problems,
    MAGE_ARCANE_PULSE_FIELDS,
  );
  if (block === undefined) return zeroMageClassSkills().arcanePulse;

  const path = 'classSkills.mage.arcanePulse';
  return {
    shotEvery:
      readNumber(block, 'shotEvery', path, problems, { integer: true, positive: true }) ?? 1,
    radiusTiles:
      readNumber(block, 'radiusTiles', path, problems, { positive: true }) ?? 1,
    damageRatio: readNumber(block, 'damageRatio', path, problems) ?? 0,
    damageRatioPerStack:
      readNumber(block, 'damageRatioPerStack', path, problems) ?? 0,
  };
}

function parseMageEvolution(
  source: Record<string, unknown>,
  problems: ProblemList,
): MageEvolutionTuning {
  const block = readObject(
    source,
    'evolution',
    'classSkills.mage',
    problems,
    MAGE_EVOLUTION_FIELDS,
  );
  if (block === undefined) return zeroMageClassSkills().evolution;

  const path = 'classSkills.mage.evolution';
  return {
    shardIntervalMs:
      readNumber(block, 'shardIntervalMs', path, problems, { integer: true, positive: true }) ??
      1,
    shardDamageRatio:
      readNumber(block, 'shardDamageRatio', path, problems, { positive: true }) ?? 1,
    shatterBurnMultiplier:
      readNumber(block, 'shatterBurnMultiplier', path, problems, { positive: true }) ?? 1,
  };
}

function parseMageClassSkills(
  source: Record<string, unknown>,
  problems: ProblemList,
): MageClassSkillsTuning {
  const block = readObject(source, 'mage', 'classSkills', problems, MAGE_FIELDS);
  if (block === undefined) return zeroMageClassSkills();

  return {
    meteor: parseMageMeteor(block, problems),
    frostOrbs: parseMageFrostOrbs(block, problems),
    stormStrike: parseMageStormStrike(block, problems),
    arcanePulse: parseMageArcanePulse(block, problems),
    evolution: parseMageEvolution(block, problems),
  };
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

/** Parse the Archer class-skill numbers (M20, #85; other classes add their own block). */
function parseArcherClassSkills(
  classSkills: Record<string, unknown>,
  problems: ProblemList,
): ArcherClassSkillTuning {
  const defaults = defaultArcherClassSkills();
  const archerSource = readObject(
    classSkills,
    'archer',
    'classSkills',
    problems,
    ARCHER_CLASS_SKILL_FIELDS,
  );
  if (archerSource === undefined) return defaults;

  const path = 'classSkills.archer';
  const rainSource =
    readObject(archerSource, 'arrowRain', path, problems, ARROW_RAIN_FIELDS) ?? {};
  const rainPath = `${path}.arrowRain`;
  const splitSource =
    readObject(archerSource, 'splitArrow', path, problems, SPLIT_ARROW_FIELDS) ?? {};
  const splitPath = `${path}.splitArrow`;
  const markSource =
    readObject(archerSource, 'huntersMark', path, problems, HUNTERS_MARK_FIELDS) ?? {};
  const markPath = `${path}.huntersMark`;
  const windSource =
    readObject(archerSource, 'windArrow', path, problems, WIND_ARROW_FIELDS) ?? {};
  const windPath = `${path}.windArrow`;
  const tempestSource =
    readObject(archerSource, 'skyTempest', path, problems, SKY_TEMPEST_FIELDS) ?? {};
  const tempestPath = `${path}.skyTempest`;

  const rainRatios = readNumberList(rainSource, 'damageRatioByStack', rainPath, problems);
  const splitRatios = readNumberList(splitSource, 'damageRatioByStack', splitPath, problems);
  const markRatios = readNumberList(markSource, 'damageRatioByStack', markPath, problems);

  return {
    arrowRain: {
      everyShots:
          readNumber(rainSource, 'everyShots', rainPath, problems, {
            integer: true,
            positive: true,
          }) ?? defaults.arrowRain.everyShots,
        radiusTiles:
          readNumber(rainSource, 'radiusTiles', rainPath, problems, { positive: true }) ??
          defaults.arrowRain.radiusTiles,
        damageRatioByStack:
          rainRatios.length > 0 ? rainRatios : defaults.arrowRain.damageRatioByStack,
      },
      splitArrow: {
        arrows:
          readNumber(splitSource, 'arrows', splitPath, problems, {
            integer: true,
            positive: true,
          }) ?? defaults.splitArrow.arrows,
        angleDegrees:
          readNumber(splitSource, 'angleDegrees', splitPath, problems, { positive: true }) ??
          defaults.splitArrow.angleDegrees,
        damageRatioByStack:
          splitRatios.length > 0 ? splitRatios : defaults.splitArrow.damageRatioByStack,
      },
      huntersMark: {
        durationMs:
          readNumber(markSource, 'durationMs', markPath, problems, { positive: true }) ??
          defaults.huntersMark.durationMs,
        radiusTiles:
          readNumber(markSource, 'radiusTiles', markPath, problems, { positive: true }) ??
          defaults.huntersMark.radiusTiles,
        damageRatioByStack:
          markRatios.length > 0 ? markRatios : defaults.huntersMark.damageRatioByStack,
      },
      windArrow: {
        momentumCap:
          readNumber(windSource, 'momentumCap', windPath, problems, {
            integer: true,
            positive: true,
          }) ?? defaults.windArrow.momentumCap,
        resetMs:
          readNumber(windSource, 'resetMs', windPath, problems, { positive: true }) ??
          defaults.windArrow.resetMs,
        buffDurationMs:
          readNumber(windSource, 'buffDurationMs', windPath, problems, { positive: true }) ??
          defaults.windArrow.buffDurationMs,
        fireRatePerMomentum:
          readNumber(windSource, 'fireRatePerMomentum', windPath, problems) ??
          defaults.windArrow.fireRatePerMomentum,
        projectileSpeedPerMomentum:
          readNumber(windSource, 'projectileSpeedPerMomentum', windPath, problems) ??
          defaults.windArrow.projectileSpeedPerMomentum,
      },
      skyTempest: {
        arrows:
          readNumber(tempestSource, 'arrows', tempestPath, problems, {
            integer: true,
            positive: true,
          }) ?? defaults.skyTempest.arrows,
        pierce:
          readNumber(tempestSource, 'pierce', tempestPath, problems, { integer: true }) ??
          defaults.skyTempest.pierce,
        damageRatio:
          readNumber(tempestSource, 'damageRatio', tempestPath, problems, { positive: true }) ??
          defaults.skyTempest.damageRatio,
    },
  };
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
    combat: parseCombat(raw, problems),
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
    dash: parseDash(raw, problems),
    activeSkill: parseActiveSkill(raw, problems),
    classSkills: parseClassSkills(raw, problems),
    characters: parseCharacters(raw, problems),
    hub: parseHub(raw, problems),
  };

  problems.throwIfAny();
  return deepFreeze(config);
}
