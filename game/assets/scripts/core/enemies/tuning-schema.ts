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
  /** Maximum hearts. */
  readonly playerMaxHearts: number;
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

/** Every number specific to the elite version (GDD §4 + M3). */
export interface EliteTuning {
  /** Node scale relative to the regular version (GDD §4: 1.15). */
  readonly scale: number;
  readonly chaser: EliteChaserTuning;
  readonly caster: EliteCasterTuning;
  readonly tank: EliteTankTuning;
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
  /** Room composition art (#67): how many walkable details a generated room scatters. */
  readonly roomArt: RoomArtTuning;
}

/**
 * Room art density (#67). `detailDensity` is the share of a room's tiles that carry a walkable
 * detail (grass tuft, pebble, bone): 0.12 means about one tile in eight.
 */
export interface RoomArtTuning {
  readonly detailDensity: number;
}

/** One weight per door reward (skills and gold are the two fights). */
export interface DoorWeightsTuning {
  readonly skill: number;
  readonly gold: number;
  readonly heal: number;
  readonly shop: number;
  readonly chest: number;
}

/**
 * Door-choice numbers (#39): the gold a `gold` door pays on the next room's clear, the flag that
 * enables the special rooms (#40), and how often each reward comes up in an offer.
 */
export interface DoorsTuning {
  /** Extra gold paid when a room's clear reward is `gold` instead of a skill pick. */
  readonly goldBonus: number;
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
 * Special-room numbers (#40). Prices are in meta gold: the shop spends the same gold the save
 * keeps, so a purchase during a run means coming home with less (GDD §13.2).
 */
export interface SpecialRoomsTuning {
  /** Hearts restored by the heal NPC, capped at the player's max. */
  readonly healHearts: number;
  /** Gold a chest gives when its seeded reward is `gold`. */
  readonly chestGold: number;
  readonly shop: ShopTuning;
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
  'playerMaxHearts',
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

const DOORS_FIELDS = ['goldBonus', 'specialRoomsEnabled', 'hintMs', 'weights'] as const;

const DOOR_WEIGHT_FIELDS = ['skill', 'gold', 'heal', 'shop', 'chest'] as const;

const SPECIAL_ROOMS_FIELDS = ['healHearts', 'chestGold', 'shop'] as const;

const SHOP_FIELDS = ['heartRefill', 'skillPrices'] as const;

const ROOM_ART_FIELDS = ['detailDensity'] as const;

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
    playerMaxHearts: 1,
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
    playerMaxHearts:
      readNumber(source, 'playerMaxHearts', path, problems, {
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
  ] as const);
  if (elite === undefined) return zeroElite();

  const path = 'enemies.elite';
  const chaserSource =
    readObject(elite, 'chaser', path, problems, ELITE_CHASER_FIELDS) ?? {};
  const casterSource =
    readObject(elite, 'caster', path, problems, ELITE_CASTER_FIELDS) ?? {};
  const tankSource = readObject(elite, 'tank', path, problems, ELITE_TANK_FIELDS) ?? {};

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

  return {
    scale:
      readNumber(elite, 'scale', path, problems, { positive: true }) ?? 1,
    chaser,
    caster,
    tank,
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
 * Room art (#67): the detail density must stay a real share of the room — 0 means no scatter,
 * and above 0.3 the floor turns into a carpet of pebbles.
 */
function parseRoomArt(raw: Record<string, unknown>, problems: ProblemList): RoomArtTuning {
  const source = readObject(raw, 'roomArt', '', problems, ROOM_ART_FIELDS);
  if (source === undefined) return { detailDensity: 0.12 };

  const detailDensity =
    readNumber(source, 'detailDensity', 'roomArt', problems, { positive: true }) ?? 0.12;
  if (detailDensity > 0.3) {
    problems.add('roomArt.detailDensity', `must be <= 0.3, got ${detailDensity}`);
  }
  return { detailDensity };
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
    specialRoomsEnabled: false,
    hintMs: 2000,
    weights: { skill: 1, gold: 1, heal: 0, shop: 0, chest: 0 },
  };
}

function parseDoors(raw: Record<string, unknown>, problems: ProblemList): DoorsTuning {
  const source = readObject(raw, 'doors', '', problems, DOORS_FIELDS);
  if (source === undefined) return zeroDoors();

  const path = 'doors';
  const weightsSource = readObject(source, 'weights', path, problems, DOOR_WEIGHT_FIELDS) ?? {};

  const weights: DoorWeightsTuning = {
    skill: readNumber(weightsSource, 'skill', `${path}.weights`, problems) ?? 0,
    gold: readNumber(weightsSource, 'gold', `${path}.weights`, problems) ?? 0,
    heal: readNumber(weightsSource, 'heal', `${path}.weights`, problems) ?? 0,
    shop: readNumber(weightsSource, 'shop', `${path}.weights`, problems) ?? 0,
    chest: readNumber(weightsSource, 'chest', `${path}.weights`, problems) ?? 0,
  };

  return {
    goldBonus:
      readNumber(source, 'goldBonus', path, problems, { positive: true }) ?? 1,
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
    healHearts: 1,
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

  return {
    healHearts:
      readNumber(source, 'healHearts', path, problems, { integer: true, positive: true }) ?? 1,
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

/**
 * Parse + validate tuning data. Throws one `Error` collecting every problem when the structure is wrong.
 * Tests call this on a copy to try other numbers without touching the exported object.
 *
 * The returned object is deeply frozen and **keeps the field declaration order above**,
 * so `scripts/gen-tuning.ts` printing it straight to the generated file is deterministic.
 */
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
    roomArt: parseRoomArt(raw, problems),
  };

  problems.throwIfAny();
  return deepFreeze(config);
}
