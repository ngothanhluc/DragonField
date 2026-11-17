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
  readonly enemies: EnemiesTuning;
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
    enemies: parseEnemies(raw, problems),
  };

  problems.throwIfAny();
  return deepFreeze(config);
}
