/**
 * Hành vi enemy (GDD §4). Mọi hàm ở đây là **hàm thuần** của
 * `(state, player, nowMs, level)`:
 *
 * - Không `Math.random`, không `Date.now`, không đọc/ghi biến toàn cục.
 * - Không tự sửa `state`; chỉ trả về action kế tiếp. Adapter Cocos gán action
 *   vào node và tự di chuyển theo action đó.
 * - Gọi hai lần với cùng tham số ở cùng `nowMs` phải cho cùng kết quả.
 *
 * Số liệu (máu, tốc độ, cooldown, telegraph, dải khoảng cách, hệ số elite)
 * **không nằm ở file này** — tất cả đọc từ `enemies/tuning.ts`, tức
 * `game/config/tuning.json` (sinh sang `tuning.generated.ts` bằng `bun run gen`).
 * Các hàm nhận thêm tham số `tuning` tuỳ chọn để
 * test có thể bơm một bộ số khác và chứng minh không còn số nào bị hardcode;
 * mặc định luôn là `ENEMY_TUNING`.
 *
 * Hợp đồng thời gian: `state.actionStartedMs` là thời điểm action hiện tại bắt
 * đầu, do **caller** cập nhật mỗi khi thay action. Enemy vừa spawn đặt
 * `action = { kind: 'idle' }` và `actionStartedMs = 0`, nên nó chờ hết một
 * cooldown trước đòn đầu tiên — đúng ý đồ "cho người chơi thở" đầu phòng.
 *
 * Elite chỉ đổi máu và sát thương, không đổi hành vi (GDD §4).
 */
import { isTelegraphElapsed } from '../combat/telegraph';
import type { EnemyRole, LevelData } from '../level/level-data';
import { obstacleAt } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { ENEMY_TUNING, type EnemiesTuning, type EnemyRoleTuning } from './tuning';

export interface EnemyState {
  id: string;
  role: EnemyRole;
  elite: boolean;
  position: Vec2;
  health: number;
  maxHealth: number;
  action: EnemyAction;
  actionStartedMs: number;
}

export type EnemyAction =
  | { kind: 'idle' }
  | { kind: 'walk'; target: Vec2 }
  | { kind: 'telegraph'; sinceMs: number }
  | { kind: 'charge'; direction: Vec2; untilMs: number }
  | { kind: 'dead' };

/** Chaser gây sát thương khi chạm; trong bán kính này nó đứng yên thay vì run rẩy. */
export const CHASER_CONTACT_RANGE_TILES = ENEMY_TUNING.roles.chaser.preferredRangeMaxTiles;

/** Caster giữ khoảng cách (GDD §4 nói 4–6; số thật nằm trong `config/tuning.json`). */
export const CASTER_MIN_RANGE_TILES = ENEMY_TUNING.roles.caster.preferredRangeMinTiles;
export const CASTER_MAX_RANGE_TILES = ENEMY_TUNING.roles.caster.preferredRangeMaxTiles;

/** Tank chỉ ra đòn khi player trong tầm này; xa hơn thì đi bộ lại gần. */
export const TANK_CHARGE_RANGE_TILES = ENEMY_TUNING.roles.tank.preferredRangeMaxTiles;
/** Thời gian lao một đường thẳng. */
export const TANK_CHARGE_DURATION_MS = ENEMY_TUNING.roles.tank.chargeDurationMs;
/** Tốc độ lúc lao — nhanh hơn đi bộ nhiều để đọc được đòn. */
export const TANK_CHARGE_SPEED_TILES_PER_SECOND =
  ENEMY_TUNING.roles.tank.chargeSpeedTilesPerSecond;

/** Giữ enemy trong phòng, không cho tâm chạm đúng mép tường. */
export const ROOM_EDGE_MARGIN_TILES = ENEMY_TUNING.roomEdgeMarginTiles;

/** Elite: máu và sát thương nhân theo `config/tuning.json` (mặc định ×2). */
export const ELITE_HEALTH_MULTIPLIER = ENEMY_TUNING.eliteHealthMultiplier;
export const ELITE_DAMAGE_MULTIPLIER = ENEMY_TUNING.eliteDamageMultiplier;

/** Cooldown trước khi được bắt đầu telegraph tiếp theo. */
export const ATTACK_COOLDOWN_MS: Readonly<Record<EnemyRole, number>> = {
  chaser: ENEMY_TUNING.roles.chaser.attackCooldownMs,
  caster: ENEMY_TUNING.roles.caster.attackCooldownMs,
  tank: ENEMY_TUNING.roles.tank.attackCooldownMs,
};

/** Hướng dự phòng khi hai điểm trùng nhau (không có hướng xác định). */
const FALLBACK_DIRECTION: Vec2 = { x: 1, y: 0 };

/**
 * Dung sai khi so khoảng cách với dải mong muốn.
 *
 * Caster dừng đúng tại `preferredRangeMaxTiles`, nên phép đo khoảng cách ngay
 * sau đó có thể ra `6.000000000000001` (khác nhau giữa các engine JS). Không có
 * dung sai thì enemy "đứng trong dải mà tưởng mình ngoài dải": nó đi bộ tới
 * chính chỗ mình đang đứng và **không bao giờ ra đòn** — bug im lặng, chỉ lộ ra
 * khi đổi engine. Dung sai này lớn hơn nhiễu số học nhiều bậc.
 */
const RANGE_TOLERANCE_TILES = 1e-6;

/** Tốc độ đi bộ, tile/giây. */
export function speedFor(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number {
  // Elite chỉ đổi máu và sát thương, không đổi tốc độ — tham số giữ cho API đối xứng.
  void elite;
  return tuning.roles[role].speedTilesPerSecond;
}

/** Sát thương khi chạm người (chaser/tank) hoặc khi đạn của caster trúng. */
export function contactDamageFor(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number {
  const base = tuning.roles[role].contactDamage;
  return elite ? base * tuning.eliteDamageMultiplier : base;
}

/** Máu tối đa, đã tính scale elite. `waves.ts` dùng hàm này để spawn. */
export function maxHealthFor(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number {
  const base = tuning.roles[role].health;
  return elite ? base * tuning.eliteHealthMultiplier : base;
}

/**
 * Đòn đã ra chưa? Adapter gọi sau `decideAction` với action trước và sau:
 * telegraph -> idle = bắn đạn (caster), telegraph -> charge = lao (tank).
 * Nhờ vậy "telegraph rồi mới bắn" quan sát được mà không cần state ẩn.
 */
export function attackReleased(
  previous: EnemyAction,
  next: EnemyAction,
): 'shot' | 'charge' | null {
  if (previous.kind !== 'telegraph') return null;
  if (next.kind === 'idle') return 'shot';
  if (next.kind === 'charge') return 'charge';
  return null;
}

export interface DecideActionArgs {
  readonly state: EnemyState;
  readonly player: Vec2;
  readonly nowMs: number;
  readonly level: LevelData;
  /** Bộ số tune; mặc định `ENEMY_TUNING` (config/tuning.json). */
  readonly tuning?: EnemiesTuning;
}

/** Action kế tiếp của enemy tại `nowMs`. Không sửa `state`. */
export function decideAction(args: DecideActionArgs): EnemyAction {
  const { state, player, nowMs, level } = args;
  const tuning = args.tuning ?? ENEMY_TUNING;

  if (state.action.kind === 'dead' || state.health <= 0) return { kind: 'dead' };

  const role = tuning.roles[state.role];

  switch (state.role) {
    case 'chaser':
      return decideChaser(state, player, level, role);
    case 'caster':
      return decideCaster(state, player, nowMs, level, role);
    case 'tank':
      return decideTank(state, player, nowMs, level, role);
  }
}

/**
 * Chaser: lao thẳng vào player, chạm là gây sát thương (phần sát thương do
 * adapter xử lý qua `contactDamageFor`). Trong tầm chạm thì đứng yên.
 */
function decideChaser(
  state: EnemyState,
  player: Vec2,
  level: LevelData,
  tuning: EnemyRoleTuning,
): EnemyAction {
  const gap = distance(state.position, player);
  if (gap <= tuning.preferredRangeMaxTiles) return { kind: 'idle' };
  return { kind: 'walk', target: clampToRoom(level, player) };
}

/**
 * Caster: giữ dải `preferredRange`. Gần hơn cận dưới thì lùi, xa hơn cận trên
 * thì tiến, trong dải thì đứng telegraph `telegraphMs` rồi bắn.
 *
 * Đã vào telegraph thì **chạy hết**, kể cả khi player lùi ra khỏi tầm — đòn đã
 * "cam kết" nên người chơi né bằng cách di chuyển, không phải bằng cách huỷ nó.
 */
function decideCaster(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
): EnemyAction {
  const current = state.action;

  if (current.kind === 'telegraph') {
    if (!isTelegraphElapsed(current.sinceMs, nowMs, tuning.telegraphMs)) {
      return { kind: 'telegraph', sinceMs: current.sinceMs };
    }
    return { kind: 'idle' };
  }

  const gap = distance(state.position, player);
  const outsideBand =
    gap < tuning.preferredRangeMinTiles - RANGE_TOLERANCE_TILES ||
    gap > tuning.preferredRangeMaxTiles + RANGE_TOLERANCE_TILES;
  if (outsideBand) {
    return { kind: 'walk', target: holdRangeTarget(state, player, level, tuning) };
  }

  if (isCoolingDown(state, nowMs, tuning)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

/**
 * Tank: đi bộ chậm tới gần, telegraph, rồi lao thẳng một đường trong
 * `chargeDurationMs`. Hướng lao chốt tại lúc telegraph xong, nên người chơi né
 * được bằng cách bước ra khỏi đường lao.
 */
function decideTank(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
  tuning: EnemyRoleTuning,
): EnemyAction {
  const current = state.action;

  if (current.kind === 'charge') {
    if (nowMs < current.untilMs) {
      return {
        kind: 'charge',
        direction: { x: current.direction.x, y: current.direction.y },
        untilMs: current.untilMs,
      };
    }
    return { kind: 'idle' };
  }

  if (current.kind === 'telegraph') {
    if (!isTelegraphElapsed(current.sinceMs, nowMs, tuning.telegraphMs)) {
      return { kind: 'telegraph', sinceMs: current.sinceMs };
    }
    return {
      kind: 'charge',
      direction: directionBetween(state.position, player),
      untilMs: nowMs + tuning.chargeDurationMs,
    };
  }

  const gap = distance(state.position, player);
  if (gap > tuning.preferredRangeMaxTiles) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (isCoolingDown(state, nowMs, tuning)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

function isCoolingDown(state: EnemyState, nowMs: number, tuning: EnemyRoleTuning): boolean {
  return nowMs - state.actionStartedMs < tuning.attackCooldownMs;
}

/**
 * Điểm cách player `preferredRangeMaxTiles` theo hướng từ player tới enemy:
 * gần quá thì đó là điểm lùi, xa quá thì đó là điểm tiến.
 *
 * Nếu điểm đó rơi vào vật cản, đứng yên tại chỗ thay vì lao vào tường.
 */
function holdRangeTarget(
  state: EnemyState,
  player: Vec2,
  level: LevelData,
  tuning: EnemyRoleTuning,
): Vec2 {
  const away = directionBetween(player, state.position);
  const atRange = clampToRoom(level, {
    x: player.x + away.x * tuning.preferredRangeMaxTiles,
    y: player.y + away.y * tuning.preferredRangeMaxTiles,
  });

  if (obstacleAt(level, atRange) !== null) {
    return { x: state.position.x, y: state.position.y };
  }
  return atRange;
}

function directionBetween(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return FALLBACK_DIRECTION;
  return { x: dx / length, y: dy / length };
}

function clampToRoom(level: LevelData, point: Vec2): Vec2 {
  const maxX = level.size.cols - ROOM_EDGE_MARGIN_TILES;
  const maxY = level.size.rows - ROOM_EDGE_MARGIN_TILES;
  return {
    x: Math.min(Math.max(point.x, ROOM_EDGE_MARGIN_TILES), maxX),
    y: Math.min(Math.max(point.y, ROOM_EDGE_MARGIN_TILES), maxY),
  };
}
