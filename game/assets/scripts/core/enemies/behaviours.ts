/**
 * Hành vi enemy (GDD §4). Mọi hàm ở đây là **hàm thuần** của
 * `(state, player, nowMs, level)`:
 *
 * - Không `Math.random`, không `Date.now`, không đọc/ghi biến toàn cục.
 * - Không tự sửa `state`; chỉ trả về action kế tiếp. Adapter Cocos gán action
 *   vào node và tự di chuyển theo action đó.
 * - Gọi hai lần với cùng tham số ở cùng `nowMs` phải cho cùng kết quả.
 *
 * Hợp đồng thời gian: `state.actionStartedMs` là thời điểm action hiện tại bắt
 * đầu, do **caller** cập nhật mỗi khi thay action. Enemy vừa spawn đặt
 * `action = { kind: 'idle' }` và `actionStartedMs = 0`, nên nó chờ hết một
 * cooldown trước đòn đầu tiên — đúng ý đồ "cho người chơi thở" đầu phòng.
 *
 * Elite chỉ đổi máu và sát thương, không đổi hành vi (GDD §4).
 */
import { isTelegraphComplete } from '../combat/telegraph';
import type { EnemyRole, LevelData } from '../level/level-data';
import { obstacleAt } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';

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
export const CHASER_CONTACT_RANGE_TILES = 0.75;

/** Caster giữ khoảng cách 4–6 tile (GDD §4). */
export const CASTER_MIN_RANGE_TILES = 4;
export const CASTER_MAX_RANGE_TILES = 6;

/** Tank chỉ lao khi player trong tầm này; xa hơn thì đi bộ lại gần. */
export const TANK_CHARGE_RANGE_TILES = 8;
/** Thời gian lao một đường thẳng. */
export const TANK_CHARGE_DURATION_MS = 450;
/** Tốc độ lúc lao — nhanh hơn đi bộ nhiều để đọc được đòn. */
export const TANK_CHARGE_SPEED_TILES_PER_SECOND = 7;

/** Giữ enemy trong phòng, không cho tâm chạm đúng mép tường. */
export const ROOM_EDGE_MARGIN_TILES = 0.5;

/** Elite: ×2 máu, ×2 sát thương. */
export const ELITE_HEALTH_MULTIPLIER = 2;
export const ELITE_DAMAGE_MULTIPLIER = 2;

/** Cooldown trước khi được bắt đầu telegraph tiếp theo. */
export const ATTACK_COOLDOWN_MS: Readonly<Record<EnemyRole, number>> = {
  chaser: 0,
  caster: 1200,
  tank: 900,
};

const SPEED_TILES_PER_SECOND: Readonly<Record<EnemyRole, number>> = {
  chaser: 2.4,
  caster: 1.6,
  tank: 1.1,
};

const BASE_HEALTH: Readonly<Record<EnemyRole, number>> = {
  chaser: 3,
  caster: 2,
  tank: 8,
};

const BASE_CONTACT_DAMAGE: Readonly<Record<EnemyRole, number>> = {
  chaser: 1,
  caster: 1,
  tank: 2,
};

/** Hướng dự phòng khi hai điểm trùng nhau (không có hướng xác định). */
const FALLBACK_DIRECTION: Vec2 = { x: 1, y: 0 };

/** Tốc độ đi bộ, tile/giây. */
export function speedFor(role: EnemyRole, elite: boolean): number {
  // Elite chỉ đổi máu và sát thương, không đổi tốc độ — tham số giữ cho API đối xứng.
  void elite;
  return SPEED_TILES_PER_SECOND[role];
}

/** Sát thương khi chạm người (chaser/tank) hoặc khi đạn của caster trúng. */
export function contactDamageFor(role: EnemyRole, elite: boolean): number {
  const base = BASE_CONTACT_DAMAGE[role];
  return elite ? base * ELITE_DAMAGE_MULTIPLIER : base;
}

/** Máu tối đa, đã tính scale elite. `waves.ts` dùng hàm này để spawn. */
export function maxHealthFor(role: EnemyRole, elite: boolean): number {
  const base = BASE_HEALTH[role];
  return elite ? base * ELITE_HEALTH_MULTIPLIER : base;
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
}

/** Action kế tiếp của enemy tại `nowMs`. Không sửa `state`. */
export function decideAction(args: DecideActionArgs): EnemyAction {
  const { state, player, nowMs, level } = args;

  if (state.action.kind === 'dead' || state.health <= 0) return { kind: 'dead' };

  switch (state.role) {
    case 'chaser':
      return decideChaser(state, player, level);
    case 'caster':
      return decideCaster(state, player, nowMs, level);
    case 'tank':
      return decideTank(state, player, nowMs, level);
  }
}

/**
 * Chaser: lao thẳng vào player, chạm là gây sát thương (phần sát thương do
 * adapter xử lý qua `contactDamageFor`). Trong tầm chạm thì đứng yên.
 */
function decideChaser(state: EnemyState, player: Vec2, level: LevelData): EnemyAction {
  const gap = distance(state.position, player);
  if (gap <= CHASER_CONTACT_RANGE_TILES) return { kind: 'idle' };
  return { kind: 'walk', target: clampToRoom(level, player) };
}

/**
 * Caster: giữ khoảng 4–6 tile. Gần hơn 4 thì lùi, xa hơn 6 thì tiến, trong
 * khoảng thì đứng telegraph `TELEGRAPH_MS.caster` rồi bắn.
 *
 * Đã vào telegraph thì **chạy hết**, kể cả khi player lùi ra khỏi tầm — đòn đã
 * "cam kết" nên người chơi né bằng cách di chuyển, không phải bằng cách huỷ nó.
 */
function decideCaster(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
): EnemyAction {
  const current = state.action;

  if (current.kind === 'telegraph') {
    if (!isTelegraphComplete(current.sinceMs, nowMs, 'caster')) {
      return { kind: 'telegraph', sinceMs: current.sinceMs };
    }
    return { kind: 'idle' };
  }

  const gap = distance(state.position, player);
  if (gap < CASTER_MIN_RANGE_TILES || gap > CASTER_MAX_RANGE_TILES) {
    return { kind: 'walk', target: holdRangeTarget(state, player, level) };
  }

  if (isCoolingDown(state, nowMs)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

/**
 * Tank: đi bộ chậm tới gần, telegraph `TELEGRAPH_MS.tank`, rồi lao thẳng một
 * đường trong `TANK_CHARGE_DURATION_MS`. Hướng lao chốt tại lúc telegraph
 * xong, nên người chơi né được bằng cách bước ra khỏi đường lao.
 */
function decideTank(
  state: EnemyState,
  player: Vec2,
  nowMs: number,
  level: LevelData,
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
    if (!isTelegraphComplete(current.sinceMs, nowMs, 'tank')) {
      return { kind: 'telegraph', sinceMs: current.sinceMs };
    }
    return {
      kind: 'charge',
      direction: directionBetween(state.position, player),
      untilMs: nowMs + TANK_CHARGE_DURATION_MS,
    };
  }

  const gap = distance(state.position, player);
  if (gap > TANK_CHARGE_RANGE_TILES) {
    return { kind: 'walk', target: clampToRoom(level, player) };
  }

  if (isCoolingDown(state, nowMs)) return { kind: 'idle' };
  return { kind: 'telegraph', sinceMs: nowMs };
}

function isCoolingDown(state: EnemyState, nowMs: number): boolean {
  return nowMs - state.actionStartedMs < ATTACK_COOLDOWN_MS[state.role];
}

/**
 * Điểm cách player `CASTER_MAX_RANGE_TILES` theo hướng từ player tới enemy:
 * gần quá thì đó là điểm lùi, xa quá thì đó là điểm tiến.
 *
 * Nếu điểm đó rơi vào vật cản, đứng yên tại chỗ thay vì lao vào tường.
 */
function holdRangeTarget(state: EnemyState, player: Vec2, level: LevelData): Vec2 {
  const away = directionBetween(player, state.position);
  const atRange = clampToRoom(level, {
    x: player.x + away.x * CASTER_MAX_RANGE_TILES,
    y: player.y + away.y * CASTER_MAX_RANGE_TILES,
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
