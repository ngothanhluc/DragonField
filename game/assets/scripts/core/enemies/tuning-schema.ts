/**
 * Schema + validator của số liệu tune balance (`game/config/tuning.json`).
 *
 * File này **không đọc file, không import `cc`** — nó chỉ nhận một object thô và
 * trả object đã validate. Nhờ vậy cả hai nơi dùng chung đúng một bộ luật:
 *
 * 1. `scripts/gen-tuning.ts` (bun, lúc generate) validate JSON trước khi sinh
 *    `tuning.generated.ts`.
 * 2. `tuning.ts` (lúc runtime, trong game) validate lại bản generated như một
 *    lớp phòng thủ — file generated hỏng thì nổ ngay, không lặng lẽ ra `NaN`.
 *
 * `parseTuning()` gom toàn bộ lỗi theo đường dẫn (`enemies.roles.caster.health: …`)
 * rồi ném một `Error` duy nhất, cùng kiểu `level-data.ts`.
 */
import { ENEMY_ROLES, type EnemyRole } from '../level/level-data';
import { CHAPTERS_PER_RUN } from '../run/run-state';

/** Số liệu combat của player (GDD §3). */
export interface CombatTuning {
  /** Số phát bắn mỗi giây ở trạng thái cơ bản. */
  readonly fireRatePerSecond: number;
  /** Sát thương mỗi viên đạn cơ bản. */
  readonly damage: number;
  /** Số viên đạn mỗi phát ở trạng thái cơ bản. */
  readonly projectiles: number;
  /** Tốc độ đạn, tile/giây. */
  readonly projectileSpeedTilesPerSecond: number;
  /** Tốc chạy cơ bản, tile/giây. */
  readonly moveSpeedTilesPerSecond: number;
  /** Số tim tối đa. */
  readonly playerMaxHearts: number;
  /** Bất tử sau khi trúng đòn, ms. */
  readonly invulnerabilityMs: number;
  /** Sát thương cơ bản khi enemy chạm player. */
  readonly contactDamage: number;
  /** Tầm auto-aim, tile. */
  readonly targetingRangeTiles: number;
  /** Quãng đường knockback player khi trúng đòn, tile. */
  readonly playerKnockbackDistanceTiles: number;
  /** Thời gian đi hết quãng knockback player, ms. */
  readonly playerKnockbackDurationMs: number;
  /** Quãng đường knockback enemy khi trúng đạn, tile. */
  readonly enemyKnockbackDistanceTiles: number;
  /** Thời gian đi hết quãng knockback enemy, ms. */
  readonly enemyKnockbackDurationMs: number;
  /**
   * Hitstop khi đạn player trúng enemy, ms (ADR-008: 70). Toàn bộ mô phỏng
   * đứng yên trong khoảng này — xem `core/combat/hitstop.ts`.
   */
  readonly enemyHitstopMs: number;
  /** Thời gian enemy đứng yên sau khi trúng đạn, ms (ADR-008: 150). */
  readonly enemyStaggerMs: number;
}

/**
 * Đòn thêm của elite chaser: telegraph rồi lao một quãng ngắn.
 *
 * Chaser thường không có đòn nào ngoài chạm người, nên "1 đòn thêm" của bản
 * elite chính là cú lao này.
 */
export interface EliteChaserTuning {
  /** Thời lượng telegraph trước khi lao, ms. */
  readonly pounceTelegraphMs: number;
  /** Tốc độ lúc lao, tile/giây. */
  readonly pounceSpeedTilesPerSecond: number;
  /** Thời gian lao một đường thẳng, ms. */
  readonly pounceDurationMs: number;
  /** Cooldown giữa hai cú lao, ms. */
  readonly pounceCooldownMs: number;
  /** Chỉ lao khi player trong tầm này, tile. */
  readonly pounceRangeTiles: number;
}

/** Đòn thêm của elite caster: một loạt đạn toả quạt thay vì một viên. */
export interface EliteCasterTuning {
  /** Số viên mỗi loạt; lẻ và >= 1 để có viên giữa. */
  readonly volleyShots: number;
  /** Góc lệch giữa hai viên kề, radian. */
  readonly volleySpreadRadians: number;
}

/** Đòn thêm của elite tank: lao thêm `extraCharges` lần, mỗi lần chốt hướng mới. */
export interface EliteTankTuning {
  readonly extraCharges: number;
}

/** Toàn bộ số liệu riêng của bản elite (GDD §4 + M3). */
export interface EliteTuning {
  /** Scale node so với bản thường (GDD §4: 1.15). */
  readonly scale: number;
  readonly chaser: EliteChaserTuning;
  readonly caster: EliteCasterTuning;
  readonly tank: EliteTankTuning;
}

/**
 * Số liệu của một vai trò enemy.
 *
 * Hai field cuối là 0 với vai trò không dùng: chaser/caster không lao, nên
 * `chargeSpeedTilesPerSecond` và `chargeDurationMs` = 0. Giữ schema phẳng như
 * vậy để bảng JSON đọc được như một bảng, và để validator chỉ cần một hàm thay
 * vì một union phân biệt theo `role`.
 *
 * Ý nghĩa `preferredRange*` khác nhau theo vai trò, đúng như hành vi:
 * - chaser: khoảng cách dừng lại khi đã chạm (contact range).
 * - caster: dải giữ khoảng cách (lùi khi gần hơn `min`, tiến khi xa hơn `max`).
 * - tank: `max` là tầm ra đòn — xa hơn thì đi bộ, gần hơn thì telegraph rồi lao.
 */
export interface EnemyRoleTuning {
  /** Máu cơ bản trước scale elite. */
  readonly health: number;
  /** Tốc độ đi bộ, tile/giây. Elite không đổi tốc độ. */
  readonly speedTilesPerSecond: number;
  /** Cooldown tối thiểu giữa hai đòn, ms. */
  readonly attackCooldownMs: number;
  /** Thời lượng telegraph (dấu hiệu đọc đòn), ms; 0 = không có đòn cần báo. */
  readonly telegraphMs: number;
  /** Cận dưới dải khoảng cách mong muốn, tile. */
  readonly preferredRangeMinTiles: number;
  /** Cận trên dải khoảng cách mong muốn, tile. */
  readonly preferredRangeMaxTiles: number;
  /** Sát thương khi chạm người (hoặc mỗi viên đạn của caster). */
  readonly contactDamage: number;
  /** Tốc độ lúc lao, tile/giây; 0 = vai trò không lao. */
  readonly chargeSpeedTilesPerSecond: number;
  /** Thời gian lao một đường thẳng, ms; 0 = vai trò không lao. */
  readonly chargeDurationMs: number;
  /**
   * Hệ số silhouette: scale node so với frame gốc (1 texture px = 1/16 unit).
   * Tất cả monster của pack đều là frame 16×16, nên brute chỉ "to" hơn được nhờ
   * số này (M3: 1.75; elite nhân thêm `enemies.elite.scale`).
   */
  readonly scale: number;
}

export interface EnemiesTuning {
  /** Hệ số máu của elite (GDD §4: ×2). */
  readonly eliteHealthMultiplier: number;
  /** Hệ số sát thương của elite. */
  readonly eliteDamageMultiplier: number;
  /** Lề tường để tâm enemy/player không chạm mép phòng, tile. */
  readonly roomEdgeMarginTiles: number;
  /** Số liệu riêng của bản elite: scale, đòn thêm theo vai trò. */
  readonly elite: EliteTuning;
  readonly roles: Readonly<Record<EnemyRole, EnemyRoleTuning>>;
}

export interface TuningConfig {
  /** Tăng khi đổi nghĩa của field, để save/replay cũ nhận ra. */
  readonly version: number;
  readonly combat: CombatTuning;
  /** Hệ số scale theo chapter (GDD §4): mỗi chapter khó hơn, không chỉ đông hơn. */
  readonly chapters: ChapterScalingTuning;
  readonly enemies: EnemiesTuning;
  /** Số liệu "juice" (ticket #2): rung, squash, coin, số damage, muzzle. */
  readonly feel: FeelTuning;
}

/**
 * Rung camera theo trauma (0..1, cộng dồn + kẹp). Mỗi sự kiện một lượng trauma;
 * offset tỉ lệ trauma² nên đòn nhẹ gần như không thấy, đòn nặng mới đáng kể.
 */
export interface ShakeTuning {
  /** Biên độ tối đa khi trauma = 1, tile. */
  readonly maxOffsetTiles: number;
  /** Trauma mất mỗi giây (tuyến tính). */
  readonly decayPerSecond: number;
  /** Trauma khi player trúng đòn thật (0..1). */
  readonly playerHurt: number;
  /** Trauma khi vụ nổ Explosive phát ra (0..1). */
  readonly explosion: number;
  /** Trauma khi thân boss lao vào player (0..1). */
  readonly bossCharge: number;
  /** Trauma khi một enemy chết (0..1) — nhịp "pop" nhỏ cho đám đông. */
  readonly enemyKill: number;
}

/** Squash/stretch giữ diện tích, mỗi sự kiện một cặp thời lượng + biên độ. */
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

/** Số damage bay lên. */
export interface DamageNumberTuning {
  /** Sống bao lâu trước khi mờ hẳn, ms. */
  readonly lifetimeMs: number;
  /** Bay lên bao nhiêu tile trong cả đời. */
  readonly riseTiles: number;
  /** Số label dựng sẵn trong pool (không `new` node mỗi hit). */
  readonly poolSize: number;
}

/** Coin bay về ô vàng HUD khi nhận vàng. */
export interface CoinTuning {
  /** Số coin mỗi lần nhận vàng (chia đều số tiền, coin cuối nhận phần lẻ). */
  readonly coinsPerPickup: number;
  /** Thời gian bay một coin, ms. */
  readonly durationMs: number;
  /** Coin sau xuất phát chậm hơn coin trước, ms. */
  readonly staggerMs: number;
  /** Độ cao cung so với đường thẳng, tile. */
  readonly arcHeightTiles: number;
  /** Số coin dựng sẵn trong pool. */
  readonly poolSize: number;
}

/** Muzzle flash mỗi phát bắn. */
export interface MuzzleTuning {
  /** Bề rộng FX, world unit. */
  readonly drawUnits: number;
  readonly lifetimeMs: number;
  /** Khoảng cách từ tâm player ra đầu nòng, tile. */
  readonly offsetTiles: number;
}

/** Toàn bộ số liệu juice (ticket #2). */
export interface FeelTuning {
  readonly shake: ShakeTuning;
  readonly squash: SquashTuning;
  readonly damageNumbers: DamageNumberTuning;
  readonly coin: CoinTuning;
  readonly muzzle: MuzzleTuning;
}

/**
 * Scale enemy theo chapter. Phần lớn độ khó đến từ số lượng/thành phần trong
 * `.tmx` (GDD §4); hai mảng này là phần **số** để chapter 2–3 không chỉ đông
 * hơn mà mỗi con cũng dai/đau hơn.
 */
export interface ChapterScalingTuning {
  /** Nhân máu enemy theo chapter, index 0 = chapter 1. */
  readonly enemyHealthMultipliers: readonly number[];
  /** Nhân sát thương enemy theo chapter, index 0 = chapter 1. */
  readonly enemyDamageMultipliers: readonly number[];
}

/** Nguồn số liệu, dùng trong thông báo lỗi để người sửa biết mở file nào. */
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

const FEEL_FIELDS = ['shake', 'squash', 'damageNumbers', 'coin', 'muzzle'] as const;

const SHAKE_FIELDS = [
  'maxOffsetTiles',
  'decayPerSecond',
  'playerHurt',
  'explosion',
  'bossCharge',
  'enemyKill',
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

/** Gom toàn bộ lỗi rồi ném một `Error` duy nhất (cùng kiểu `level-data.ts`). */
class ProblemList {
  private readonly items: string[] = [];

  add(path: string, message: string): void {
    this.items.push(`${path}: ${message}`);
  }

  throwIfAny(): void {
    if (this.items.length === 0) return;

    const details = this.items.map((item) => `  - ${item}`).join('\n');
    throw new Error(
      `${TUNING_SOURCE_PATH} không hợp lệ (${this.items.length} lỗi)\n${details}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined (thiếu field?)';
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
 * Đọc một field số; `options` quyết định ràng buộc. Trả `undefined` khi lỗi để
 * caller dùng giá trị mặc định an toàn (config sai thì còn một lỗi rõ ràng,
 * không có NaN lan vào combat).
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
    problems.add(fieldPath, `phải là số hữu hạn, nhận ${describe(value)}`);
    return undefined;
  }
  if (value < 0) {
    problems.add(fieldPath, `không được âm, nhận ${value}`);
    return undefined;
  }
  if (options.positive === true && value === 0) {
    problems.add(fieldPath, `phải > 0, nhận ${value}`);
    return undefined;
  }
  if (options.integer === true && !Number.isInteger(value)) {
    problems.add(fieldPath, `phải là số nguyên, nhận ${value}`);
    return undefined;
  }
  return value;
}

/** Thiếu field nào thì báo đúng field đó, kèm danh sách field mong đợi. */
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
      `phải là object { ${expected.join(', ')} }, nhận ${describe(value)}`,
    );
    return undefined;
  }

  for (const key of expected) {
    if (!(key in value))
      problems.add(joinPath(joinPath(path, field), key), 'thiếu field');
  }
  return value;
}

/** Đọc mảng số đúng `length` phần tử, mọi phần tử hữu hạn và > 0. */
function readMultiplierArray(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
): readonly number[] {
  const fieldPath = joinPath(path, field);
  const value = source[field];
  if (!Array.isArray(value)) {
    problems.add(fieldPath, `phải là mảng ${CHAPTERS_PER_RUN} số, nhận ${describe(value)}`);
    return CHAPTERS_PER_RUN_MULTIPLIERS;
  }
  if (value.length !== CHAPTERS_PER_RUN) {
    problems.add(
      fieldPath,
      `phải có đúng ${CHAPTERS_PER_RUN} phần tử (mỗi chapter một hệ số), nhận ${value.length}`,
    );
  }

  const result: number[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry <= 0) {
      problems.add(`${fieldPath}[${index}]`, `phải là số hữu hạn > 0, nhận ${describe(entry)}`);
      result.push(1);
      return;
    }
    result.push(entry);
  });
  return result;
}

/** Mặc định khi config thiếu: không scale (mọi chapter như chapter 1). */
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
    problems.add(`${path}.chaser.pounceRangeTiles`, 'không được âm');
  }
  if (chaser.pounceTelegraphMs > 0 && chaser.pounceDurationMs <= 0) {
    problems.add(
      `${path}.chaser.pounceDurationMs`,
      'phải > 0 khi có telegraph — cú lao cần thời gian bay',
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
  };

  if (tuning.preferredRangeMaxTiles < tuning.preferredRangeMinTiles) {
    problems.add(
      `${path}.preferredRangeMaxTiles`,
      `phải >= preferredRangeMinTiles (${tuning.preferredRangeMinTiles}), nhận ${tuning.preferredRangeMaxTiles}`,
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
      roles: { chaser: zeroRole(), caster: zeroRole(), tank: zeroRole() },
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

/**
 * Trauma là tỉ lệ 0..1: > 1 làm offset vượt biên độ khai báo, khó suy ra hình
 * dung khi tune. Vượt thì báo lỗi và kẹp về 1.
 */
function readTrauma(
  source: Record<string, unknown>,
  field: string,
  path: string,
  problems: ProblemList,
): number {
  const value = readNumber(source, field, path, problems);
  if (value === undefined) return 0;
  if (value > 1) {
    problems.add(joinPath(path, field), `phải nằm trong 0..1, nhận ${value}`);
    return 1;
  }
  return value;
}

function zeroFeel(): FeelTuning {
  return {
    shake: {
      maxOffsetTiles: 0,
      decayPerSecond: 0,
      playerHurt: 0,
      explosion: 0,
      bossCharge: 0,
      enemyKill: 0,
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

  const shakePath = 'feel.shake';
  const shake: ShakeTuning = {
    maxOffsetTiles: readNumber(shakeSource, 'maxOffsetTiles', shakePath, problems) ?? 0,
    decayPerSecond:
      readNumber(shakeSource, 'decayPerSecond', shakePath, problems, { positive: true }) ?? 0,
    playerHurt: readTrauma(shakeSource, 'playerHurt', shakePath, problems),
    explosion: readTrauma(shakeSource, 'explosion', shakePath, problems),
    bossCharge: readTrauma(shakeSource, 'bossCharge', shakePath, problems),
    enemyKill: readTrauma(shakeSource, 'enemyKill', shakePath, problems),
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

  return { shake, squash, damageNumbers, coin, muzzle };
}

/** Freeze sâu để không ai vô tình sửa số tune lúc runtime. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;

  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Parse + validate số liệu tune. Ném một `Error` gom đủ lỗi nếu sai cấu trúc.
 * Test dùng hàm này trên bản copy để thử số khác mà không đụng object export.
 *
 * Object trả về được freeze sâu và **giữ nguyên thứ tự field** khai báo ở trên,
 * nên `scripts/gen-tuning.ts` in thẳng nó ra file generated là tất định.
 */
export function parseTuning(raw: unknown): TuningConfig {
  if (!isRecord(raw)) {
    throw new Error(
      `${TUNING_SOURCE_PATH} không hợp lệ: gốc phải là object, nhận ${describe(raw)}`,
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
      `phải là số nguyên >= 1, nhận ${describe(raw.version)}`,
    );
  }

  const config: TuningConfig = {
    version,
    combat: parseCombat(raw, problems),
    chapters: parseChapters(raw, problems),
    enemies: parseEnemies(raw, problems),
    feel: parseFeel(raw, problems),
  };

  problems.throwIfAny();
  return deepFreeze(config);
}
