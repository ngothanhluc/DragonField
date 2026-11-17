/**
 * Máy trạng thái pattern boss (GDD §5).
 *
 * Hợp đồng: `stepBoss({ state, nowMs, deltaMs, player, rng })` là **hàm thuần**
 * — không đọc đồng hồ, không `Math.random`, không đụng node Cocos. Cùng state +
 * cùng chuỗi input + cùng seed cho **đúng cùng** chuỗi event. `SeededRng` được
 * truyền vào từ ngoài, không bao giờ được tạo trong file này.
 *
 * Determinism: cùng state + cùng chuỗi input (`nowMs`, `deltaMs`, `player`) +
 * cùng seed cho **đúng cùng** chuỗi event. `SeededRng` được truyền vào từ
 * ngoài, không bao giờ được tạo trong file này — và nó **bị tiêu thụ**, nên
 * muốn chạy lại một đoạn phải dựng instance mới từ cùng seed.
 *
 * Thời gian: `state.step` là chỉ số bước trong script của phase hiện tại,
 * `state.stepStartedMs` là lúc bước đó bắt đầu. Caller chỉ cần gọi mỗi frame;
 * mọi việc còn lại (chuyển bước, lặp vòng, đổi phase) do `stepBoss` lo.
 *
 * Phase **chỉ tiến, không lùi**: hồi máu không kéo boss về phase trước, vì mỗi
 * ngưỡng chỉ được phát `phase-change` đúng một lần (state.phase là bộ nhớ của
 * việc đó).
 *
 * Vị trí: `state.position` là **nguồn sự thật** — `stepBoss` tự tích phân di
 * chuyển theo `deltaMs`. Event `move` chỉ là *ý đồ* cho adapter (đi tới đâu,
 * nhanh bao nhiêu) để nó chạy animation walk/charge; adapter có thể bám
 * `state.position` mỗi frame thay vì nội suy event.
 *
 * Telegraph: **mọi** bước gây sát thương (volley, spiral, vệt lửa, charge) đều
 * đứng ngay sau một bước có `telegraph`, thời lượng `TELEGRAPH_MS.boss` (800 ms).
 *
 * Toạ độ tile unit, gốc trên-trái, y hướng xuống (cùng hệ `LevelData`). Góc
 * tính bằng **radian**, 0 = +x, `Math.PI / 2` = +y (xuống).
 */
import { TELEGRAPH_MS } from '../combat/telegraph';
import { ROOM_COLS, ROOM_ROWS, type EnemyRole } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import type { SeededRng } from '../rng';
import {
  BOSSES,
  BOSS_FEET_OFFSET_TILES,
  animationFor,
  healthFraction,
  oppositeFacing,
  phaseFor,
  type BossAnimKind,
  type BossId,
  type BossPhase,
  type Facing,
} from './boss-defs';

// ---------------------------------------------------------------------------
// Trạng thái và event
// ---------------------------------------------------------------------------

/**
 * Toàn bộ trạng thái boss. **Chỉ dữ liệu phẳng** — không class, không hàm —
 * vì save/teleport sẽ snapshot nguyên object này.
 */
export interface BossState {
  id: BossId;
  position: Vec2;
  health: number;
  phase: BossPhase;
  /** Bước hiện tại trong script của `phase`. */
  step: number;
  stepStartedMs: number;
  facing: Facing;
  /** Khác `null` chỉ khi đang trong bước charge; `move` cũng đọc từ đây. */
  chargeDirection: Vec2 | null;
}

/**
 * Mô tả tối thiểu một viên đạn cho adapter: nó tự tra pool và gán ttl/owner.
 *
 * - `toward !== null`: hướng bay = `normalize(toward - from)` xoay thêm
 *   `angleOffset` radian.
 * - `toward === null`: `angleOffset` là **góc tuyệt đối** (radian).
 */
export interface BulletVerb {
  from: Vec2;
  toward: Vec2 | null;
  angleOffset: number;
  speed: number;
  damage: number;
  radiusTiles: number;
}

export type BossEvent =
  | { kind: 'play-animation'; animation: string }
  | { kind: 'shoot'; bullets: BulletVerb[] }
  | { kind: 'move'; to: Vec2; speedTilesPerSecond: number }
  | { kind: 'telegraph'; durationMs: number; at: Vec2 }
  | { kind: 'summon'; role: EnemyRole; count: number }
  | { kind: 'phase-change'; phase: BossPhase };

export interface StepBossArgs {
  readonly state: BossState;
  readonly nowMs: number;
  readonly deltaMs: number;
  readonly player: Vec2;
  /** Nguồn ngẫu nhiên duy nhất cho dịch chuyển/vị trí summon. */
  readonly rng: SeededRng;
}

/** State khởi tạo của một boss vừa spawn; `stepStartedMs = 0`. */
export function initialBossState(id: BossId, position: Vec2): BossState {
  return {
    id,
    // Spawn trong `.tmx` có thể sát tường; kéo vào để sprite không bị cắt ngay frame đầu.
    position: clampToRoom(position, bossRoomBounds(id)),
    health: BOSSES[id].maxHealth,
    phase: 1,
    step: 0,
    stepStartedMs: 0,
    facing: 'right',
    chargeDirection: null,
  };
}

/** Boss đã chết: không hành động, không bắn, không đổi phase nữa. */
export function isBossDefeated(state: BossState): boolean {
  return state.health <= 0;
}

// ---------------------------------------------------------------------------
// Dữ liệu pattern
// ---------------------------------------------------------------------------

/** Chừa 1 tile sát tường: boss không bao giờ chui vào tường hay đứng nửa người ngoài phòng. */
export const BOSS_EDGE_MARGIN_TILES = 1;

/** Tốc độ "dịch chuyển tức thời" phát ra event `move` — adapter coi như snap. */
export const TELEPORT_SNAP_SPEED_TILES_PER_SECOND = 64;

/** Dịch chuyển phải ra xa player ít nhất chừng này, nếu không thì vô nghĩa. */
export const TELEPORT_MIN_DISTANCE_FROM_PLAYER_TILES = 6;

/** Số lần thử chọn điểm dịch chuyển trước khi lấy điểm xa player nhất trong các lần thử. */
const TELEPORT_ATTEMPTS = 8;

/** Khoảng cách giữa hai viên trong sóng slash của Samurai, tile. */
const LINE_BULLET_SPACING_TILES = 0.6;

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;

/** Vùng tâm hitbox boss được phép đứng, toạ độ room (tile, y hướng xuống). */
export interface RoomBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * Vùng đứng của một boss: chừa ít nhất `BOSS_EDGE_MARGIN_TILES`, và đủ rộng để
 * **cả sprite** (`spriteExtentTiles`, tính từ chân) nằm trong phòng. Chỉ chừa
 * theo hitbox thì boss 96 px charge sát tường bị cắt mất nửa người.
 */
export function bossRoomBounds(id: BossId): RoomBounds {
  const extent = BOSSES[id].spriteExtentTiles;
  return {
    minX: Math.max(BOSS_EDGE_MARGIN_TILES, extent.left),
    maxX: ROOM_COLS - Math.max(BOSS_EDGE_MARGIN_TILES, extent.right),
    minY: Math.max(BOSS_EDGE_MARGIN_TILES, extent.up - BOSS_FEET_OFFSET_TILES),
    maxY: ROOM_ROWS - Math.max(BOSS_EDGE_MARGIN_TILES, BOSS_FEET_OFFSET_TILES),
  };
}

/** Cách boss di chuyển trong một bước. */
export type BossMotion =
  | { readonly kind: 'chase'; readonly speedTilesPerSecond: number }
  | { readonly kind: 'swim'; readonly speedTilesPerSecond: number }
  | { readonly kind: 'charge'; readonly speedTilesPerSecond: number }
  /** Đi theo trục y tới hàng của player (Samurai lấy đà ngang). */
  | { readonly kind: 'line-up'; readonly speedTilesPerSecond: number }
  | { readonly kind: 'teleport' };

/**
 * Một đợt đạn. `fan`/`spread` tự nhắm player (khác nhau ở độ mở);
 * `ring` toả đều 360°; `line` là sóng slash bay theo hướng `facing`.
 */
export type VolleyShape = 'fan' | 'spread' | 'ring' | 'line';

export interface VolleySpec {
  readonly shape: VolleyShape;
  readonly count: number;
  /** Tổng góc mở của `fan`/`spread`, radian. Bỏ qua với `ring`/`line`. */
  readonly spreadRadians: number;
  /** Góc tuyệt đối của viên đầu tiên trong `ring`, radian. Bỏ qua với shape khác. */
  readonly baseAngleRadians: number;
  /**
   * Ring có xoay sao cho viên đầu tiên nhắm thẳng player không.
   *
   * Vòng 8 viên quanh boss vẫn là vòng 8 viên; cờ này chỉ đảm bảo **một** viên
   * đi đúng đường tới player, nên đứng yên là trúng. Không có nó, ring bắn từ
   * vị trí teleport ngẫu nhiên có thể để lọt player đứng ở góc — và "pattern
   * buộc phải di chuyển" sẽ chỉ đúng trên giấy.
   */
  readonly ringAimsAtPlayer?: boolean;
  readonly speedTilesPerSecond: number;
  readonly damage: number;
  readonly radiusTiles: number;
}

/**
 * Vệt lửa Samurai để lại khi charge (phase 3).
 *
 * Lửa bùng lên **dọc cả làn charge** ngay lúc boss lao (một event `shoot` với
 * nhiều viên rải sẵn), rồi trôi chậm cùng hướng charge. Cách này giữ state
 * phẳng (không cần bộ đếm nhỏ giọt) mà vẫn đọc được: boss lao 9 tile/s, lửa
 * trôi 1.2 tile/s nên chúng nằm lại phía sau gần như ngay lập tức.
 */
export interface TrailSpec {
  readonly spacingTiles: number;
  /** Vệt lửa trôi chậm theo hướng charge, không đứng yên (đạn cần speed > 0). */
  readonly driftSpeedTilesPerSecond: number;
  readonly damage: number;
  readonly radiusTiles: number;
}

/** Xoắn ốc của Squid: phát một viên mỗi `intervalMs`, góc quay đều. */
export interface SpiralSpec {
  readonly intervalMs: number;
  readonly angleStepRadians: number;
  readonly speedTilesPerSecond: number;
  readonly damage: number;
  readonly radiusTiles: number;
}

export type BossAction =
  | { readonly kind: 'face'; readonly direction: 'player' | 'opposite' }
  | { readonly kind: 'animation'; readonly animation: BossAnimKind }
  | { readonly kind: 'telegraph' }
  | { readonly kind: 'move'; readonly motion: BossMotion }
  | { readonly kind: 'volley'; readonly volley: VolleySpec }
  | { readonly kind: 'spiral'; readonly spiral: SpiralSpec }
  | { readonly kind: 'trail'; readonly trail: TrailSpec }
  | { readonly kind: 'summon'; readonly role: EnemyRole; readonly count: number };

export interface BossStep {
  readonly durationMs: number;
  readonly actions: readonly BossAction[];
}

export interface BossPhaseScript {
  readonly steps: readonly BossStep[];
  /** Bước bắt đầu vòng lặp sau lần chạy đầu. Mặc định 0. */
  readonly loopFrom?: number;
}

export type BossScripts = Readonly<Record<BossId, Readonly<Record<BossPhase, BossPhaseScript>>>>;

/**
 * Bước này có gây sát thương không? (`volley`, `spiral`, `trail`, và `move`
 * charge vì thân boss gây sát thương khi lao.) Test dùng hàm này để bắt buộc
 * mọi bước như vậy phải đứng sau một bước telegraph.
 */
export function isDamagingStep(step: BossStep): boolean {
  return step.actions.some(
    (action) =>
      action.kind === 'volley' ||
      action.kind === 'spiral' ||
      action.kind === 'trail' ||
      (action.kind === 'move' && action.motion.kind === 'charge'),
  );
}

// --- Volley dựng sẵn -------------------------------------------------------

const TENGU_FAN: BossAction = {
  kind: 'volley',
  volley: {
    shape: 'fan',
    count: 5,
    spreadRadians: 60 * DEG,
    baseAngleRadians: 0,
    speedTilesPerSecond: 6,
    damage: 1,
    radiusTiles: 0.25,
  },
};

const TENGU_RING: BossAction = {
  kind: 'volley',
  volley: {
    shape: 'ring',
    count: 8,
    spreadRadians: 0,
    baseAngleRadians: -HALF_PI,
    ringAimsAtPlayer: true,
    speedTilesPerSecond: 5,
    damage: 1,
    radiusTiles: 0.25,
  },
};

const SQUID_SPREAD: BossAction = {
  kind: 'volley',
  volley: {
    shape: 'spread',
    count: 5,
    spreadRadians: 110 * DEG,
    baseAngleRadians: 0,
    speedTilesPerSecond: 4.5,
    damage: 1,
    radiusTiles: 0.3,
  },
};

const SAMURAI_SLASH: BossAction = {
  kind: 'volley',
  volley: {
    shape: 'line',
    count: 3,
    spreadRadians: 0,
    baseAngleRadians: 0,
    speedTilesPerSecond: 7,
    damage: 2,
    radiusTiles: 0.3,
  },
};

const SAMURAI_FIRE_TRAIL: BossAction = {
  kind: 'trail',
  trail: {
    spacingTiles: 1.5,
    driftSpeedTilesPerSecond: 1.2,
    damage: 1,
    radiusTiles: 0.35,
  },
};

/** Xoắn phase 2: chậm, đọc được nhịp. */
const SQUID_SPIRAL_SLOW: BossAction = {
  kind: 'spiral',
  spiral: {
    intervalMs: 140,
    angleStepRadians: 24 * DEG,
    speedTilesPerSecond: 4,
    damage: 1,
    radiusTiles: 0.3,
  },
};

/** Xoắn phase 3: nhanh hơn (GDD §5 "xoắn nhanh hơn"). */
const SQUID_SPIRAL_FAST: BossAction = {
  kind: 'spiral',
  spiral: {
    intervalMs: 110,
    angleStepRadians: 30 * DEG,
    speedTilesPerSecond: 4.5,
    damage: 1,
    radiusTiles: 0.3,
  },
};

const TELEGRAPH_ACTION: BossAction = { kind: 'telegraph' };

const TENGU_WALK_CHASE: BossAction = {
  kind: 'move',
  motion: { kind: 'chase', speedTilesPerSecond: 2.2 },
};

const SQUID_SWIM: BossAction = {
  kind: 'move',
  motion: { kind: 'swim', speedTilesPerSecond: 2.6 },
};

/** Phase 3 Squid "tăng tốc": bơi nhanh hơn. */
const SQUID_SWIM_FAST: BossAction = {
  kind: 'move',
  motion: { kind: 'swim', speedTilesPerSecond: 3.2 },
};

const SAMURAI_CHARGE: BossAction = {
  kind: 'move',
  motion: { kind: 'charge', speedTilesPerSecond: 9 },
};

/**
 * Lấy đà theo hàng của player trước khi charge ngang (GDD §5: charge L/R là
 * dấu hiệu đọc đòn). Nếu boss cứ charge ở hàng cũ, player đứng ở hàng khác
 * không bao giờ bị đe doạ; line-up làm cú charge có ý nghĩa mà vẫn giữ hướng
 * ngang và animation L/R.
 */
const SAMURAI_LINE_UP: BossAction = {
  kind: 'move',
  motion: { kind: 'line-up', speedTilesPerSecond: 8 },
};

/** Line-up đủ lâu để từ hàng boss tới hàng player ở arena 18 tile. */
const SAMURAI_LINE_UP_MS = 1600;

const TELEPORT: BossAction = {
  kind: 'move',
  motion: { kind: 'teleport' },
};

function anim(animation: BossAnimKind): BossAction {
  return { kind: 'animation', animation };
}

function face(direction: 'player' | 'opposite'): BossAction {
  return { kind: 'face', direction };
}

// --- Script của 3 boss -----------------------------------------------------

/**
 * Pattern theo GDD §5. Đọc theo cột: bước nào bắt đầu bằng telegraph thì bước
 * kế tiếp là đòn thật — người chơi có đúng 800 ms để né.
 */
export const BOSS_SCRIPTS: BossScripts = {
  // -------------------------------------------------------------------------
  // Ch1 — TenguBlue: đi bộ đuổi + chùm 5 viên → thêm Trans + vòng 8 viên →
  // enrage: dịch chuyển ×3, mỗi lần một chùm 5 viên.
  // -------------------------------------------------------------------------
  tengu: {
    1: {
      steps: [
        { durationMs: 600, actions: [anim('idle')] },
        { durationMs: 1400, actions: [TENGU_WALK_CHASE, anim('walk')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 650, actions: [TENGU_FAN] },
        { durationMs: 450, actions: [anim('idle')] },
      ],
    },
    2: {
      steps: [
        { durationMs: 400, actions: [TELEPORT, anim('teleport')] },
        { durationMs: 350, actions: [anim('idle')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 700, actions: [TENGU_RING] },
        { durationMs: 1200, actions: [TENGU_WALK_CHASE, anim('walk')] },
      ],
    },
    3: {
      steps: [
        { durationMs: 400, actions: [TELEPORT, anim('teleport')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [TENGU_FAN] },
        { durationMs: 250, actions: [anim('idle')] },
        { durationMs: 400, actions: [TELEPORT, anim('teleport')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [TENGU_FAN] },
        { durationMs: 250, actions: [anim('idle')] },
        { durationMs: 400, actions: [TELEPORT, anim('teleport')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [TENGU_FAN] },
        { durationMs: 700, actions: [anim('idle')] },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Ch2 — SquidGreen: bơi ngang + Shoot 5 viên toả → AttackLoop xoắn ốc →
  // gọi 2 caster rồi xoắn nhanh hơn.
  // -------------------------------------------------------------------------
  squid: {
    1: {
      steps: [
        { durationMs: 1500, actions: [SQUID_SWIM, anim('walk')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [anim('shoot'), SQUID_SPREAD] },
        { durationMs: 400, actions: [anim('idle')] },
      ],
    },
    2: {
      steps: [
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 2400, actions: [anim('loop'), SQUID_SPIRAL_SLOW] },
        { durationMs: 400, actions: [anim('idle')] },
      ],
    },
    3: {
      // Bước 0 (gọi quái) chỉ chạy một lần khi vào phase; vòng lặp bắt đầu từ 1.
      loopFrom: 1,
      steps: [
        {
          durationMs: 500,
          actions: [{ kind: 'summon', role: 'caster', count: 2 }, anim('idle')],
        },
        { durationMs: 1300, actions: [SQUID_SWIM_FAST, anim('walk')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 2600, actions: [anim('loop'), SQUID_SPIRAL_FAST] },
        { durationMs: 400, actions: [anim('idle')] },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Ch3 — GiantBlueSamurai: charge ngang + slash sóng thẳng → charge đôi đổi
  // hướng → charge để lại vệt lửa + slash đôi.
  // -------------------------------------------------------------------------
  samurai: {
    1: {
      steps: [
        { durationMs: SAMURAI_LINE_UP_MS, actions: [SAMURAI_LINE_UP, anim('walk')] },
        {
          durationMs: TELEGRAPH_MS.boss,
          actions: [face('player'), TELEGRAPH_ACTION, anim('charge')],
        },
        { durationMs: 900, actions: [SAMURAI_CHARGE, anim('charge')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [SAMURAI_SLASH] },
        { durationMs: 700, actions: [anim('idle')] },
      ],
    },
    2: {
      steps: [
        { durationMs: SAMURAI_LINE_UP_MS, actions: [SAMURAI_LINE_UP, anim('walk')] },
        {
          durationMs: TELEGRAPH_MS.boss,
          actions: [face('player'), TELEGRAPH_ACTION, anim('charge')],
        },
        { durationMs: 900, actions: [SAMURAI_CHARGE, anim('charge')] },
        {
          durationMs: TELEGRAPH_MS.boss,
          actions: [face('opposite'), TELEGRAPH_ACTION, anim('charge')],
        },
        { durationMs: 900, actions: [SAMURAI_CHARGE, anim('charge')] },
        { durationMs: TELEGRAPH_MS.boss, actions: [face('player'), TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 600, actions: [SAMURAI_SLASH] },
        { durationMs: 600, actions: [anim('idle')] },
      ],
    },
    3: {
      steps: [
        { durationMs: SAMURAI_LINE_UP_MS, actions: [SAMURAI_LINE_UP, anim('walk')] },
        {
          durationMs: TELEGRAPH_MS.boss,
          actions: [face('player'), TELEGRAPH_ACTION, anim('charge')],
        },
        { durationMs: 900, actions: [SAMURAI_CHARGE, anim('charge'), SAMURAI_FIRE_TRAIL] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 450, actions: [SAMURAI_SLASH] },
        { durationMs: TELEGRAPH_MS.boss, actions: [TELEGRAPH_ACTION, anim('attack')] },
        { durationMs: 450, actions: [SAMURAI_SLASH] },
        { durationMs: 600, actions: [anim('idle')] },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Máy trạng thái
// ---------------------------------------------------------------------------

export function stepBoss(args: StepBossArgs): { state: BossState; events: BossEvent[] } {
  const { nowMs, deltaMs, player } = args;

  if (!Number.isFinite(nowMs)) {
    throw new Error(`stepBoss cần nowMs hữu hạn, nhận ${nowMs}`);
  }
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error(`stepBoss cần deltaMs hữu hạn và >= 0, nhận ${deltaMs}`);
  }

  // Bản sao: không bao giờ sửa state của caller.
  const state: BossState = {
    ...args.state,
    position: { x: args.state.position.x, y: args.state.position.y },
    chargeDirection:
      args.state.chargeDirection === null
        ? null
        : { x: args.state.chargeDirection.x, y: args.state.chargeDirection.y },
  };
  const events: BossEvent[] = [];

  if (isBossDefeated(state)) return { state, events };

  // --- Đổi phase: mỗi ngưỡng bị vượt phát đúng một event ------------------
  const targetPhase = phaseFor(state.id, healthFraction(state.id, state.health));
  if (targetPhase > state.phase) {
    for (let next = state.phase + 1; next <= targetPhase; next += 1) {
      const phase: BossPhase = next === 2 ? 2 : 3;
      state.phase = phase;
      events.push({ kind: 'phase-change', phase });
    }
    state.step = 0;
    state.stepStartedMs = nowMs;
    state.chargeDirection = null;
  }

  const script = BOSS_SCRIPTS[state.id][state.phase];
  const windowStart = nowMs - deltaMs;
  const context: StepContext = { state, player, rng: args.rng, events };

  // Bước bắt đầu **bên trong** cửa sổ này thì phải chạy hành động mở màn ngay.
  // Bước bắt đầu đúng `nowMs` để frame sau xử lý (tránh phát hai lần ở biên frame).
  if (state.stepStartedMs >= windowStart && state.stepStartedMs < nowMs) {
    enterStep(context, stepAt(script, state.step));
  }

  let cursor = Math.max(windowStart, state.stepStartedMs);
  while (cursor < nowMs) {
    const step = stepAt(script, state.step);
    const stepEnd = state.stepStartedMs + step.durationMs;
    const chunkEnd = Math.min(nowMs, stepEnd);

    advanceMotion(context, step, cursor, chunkEnd);
    emitSpiralTicks(context, step, state.stepStartedMs, cursor, chunkEnd);
    cursor = chunkEnd;

    // Biên bước rơi đúng cuối cửa sổ: để frame sau mở bước mới, tránh phát
    // hành động mở màn hai lần ở hai bên biên frame.
    if (stepEnd >= nowMs) break;

    nextStep(state, script);
    state.stepStartedMs = stepEnd;
    enterStep(context, stepAt(script, state.step));
  }

  return { state, events };
}

// ---------------------------------------------------------------------------
// Nội bộ: chạy bước
// ---------------------------------------------------------------------------

interface StepContext {
  readonly state: BossState;
  readonly player: Vec2;
  readonly rng: SeededRng;
  readonly events: BossEvent[];
}

/** Di chuyển đã chốt cho một bước; `target` là đích mà event `move` báo. */
interface MotionPlan {
  readonly motion: BossMotion;
  readonly target: Vec2;
  readonly speedTilesPerSecond: number;
}

function stepAt(script: BossPhaseScript, index: number): BossStep {
  const steps = script.steps;
  const length = steps.length;
  if (length === 0) {
    throw new Error('Script boss phải có ít nhất một bước');
  }

  const wrapped = ((index % length) + length) % length;
  const step = steps[wrapped];
  if (step === undefined) {
    throw new Error(`Script boss thiếu bước ${wrapped}/${length}`);
  }
  // Bước 0 ms sẽ làm vòng lặp thời gian không tiến — chặn ngay ở dữ liệu.
  if (!(step.durationMs > 0)) {
    throw new Error(`Bước ${wrapped} của script boss phải có durationMs > 0`);
  }
  return step;
}

function nextStep(state: BossState, script: BossPhaseScript): void {
  const next = state.step + 1;
  state.step = next >= script.steps.length ? (script.loopFrom ?? 0) : next;
}

/** Chạy hành động của một bước vừa bắt đầu. */
function enterStep(context: StepContext, step: BossStep): void {
  const { state, player, events } = context;
  let plan = planMotion(state, step, player);

  // Dịch chuyển là bước duy nhất cần RNG, và chỉ rút **một lần** lúc vào bước.
  if (plan !== null && plan.motion.kind === 'teleport') {
    const target = pickTeleportTarget(context.rng, state.position, player, bossRoomBounds(state.id));
    state.position = { x: target.x, y: target.y };
    plan = { ...plan, target };
  }

  for (const action of step.actions) {
    switch (action.kind) {
      case 'face':
        state.facing =
          action.direction === 'player'
            ? player.x < state.position.x
              ? 'left'
              : 'right'
            : oppositeFacing(state.facing);
        break;

      case 'animation':
        events.push({
          kind: 'play-animation',
          animation: animationFor(state.id, action.animation, state.facing),
        });
        break;

      case 'telegraph':
        events.push({
          kind: 'telegraph',
          durationMs: TELEGRAPH_MS.boss,
          at: { x: state.position.x, y: state.position.y },
        });
        break;

      case 'move':
        if (plan === null) throw new Error('Bước có move nhưng không lập được kế hoạch di chuyển');
        events.push({
          kind: 'move',
          to: { x: plan.target.x, y: plan.target.y },
          speedTilesPerSecond: plan.speedTilesPerSecond,
        });
        break;

      case 'volley':
        events.push({ kind: 'shoot', bullets: buildVolley(action.volley, state, player) });
        break;

      case 'trail':
        events.push({ kind: 'shoot', bullets: buildTrail(action.trail, state, plan, step) });
        break;

      case 'summon':
        events.push({ kind: 'summon', role: action.role, count: action.count });
        break;

      case 'spiral':
        // Phát dần theo nhịp trong `emitSpiralTicks`, không phải một cục ở đây.
        break;
    }
  }
}

/**
 * Kế hoạch di chuyển của bước — **thuần**, không rút RNG. `teleport` trả về
 * đích tạm là vị trí hiện tại; `enterStep` mới thay bằng điểm RNG chọn.
 */
function planMotion(state: BossState, step: BossStep, player: Vec2): MotionPlan | null {
  const bounds = bossRoomBounds(state.id);
  const move = step.actions.find(
    (action): action is Extract<BossAction, { kind: 'move' }> => action.kind === 'move',
  );
  if (move === undefined) {
    state.chargeDirection = null;
    return null;
  }

  const motion = move.motion;
  switch (motion.kind) {
    case 'chase':
      state.chargeDirection = null;
      return {
        motion,
        target: clampToRoom(player, bounds),
        speedTilesPerSecond: motion.speedTilesPerSecond,
      };

    case 'swim': {
      state.chargeDirection = null;
      return {
        motion,
        target: travelTarget(state, motion.speedTilesPerSecond, step.durationMs),
        speedTilesPerSecond: motion.speedTilesPerSecond,
      };
    }

    case 'charge':
      state.chargeDirection = directionForFacing(state.facing);
      return {
        motion,
        target: travelTarget(state, motion.speedTilesPerSecond, step.durationMs),
        speedTilesPerSecond: motion.speedTilesPerSecond,
      };

    case 'line-up':
      state.chargeDirection = null;
      return {
        motion,
        target: {
          x: state.position.x,
          y: clamp(player.y, bounds.minY, bounds.maxY),
        },
        speedTilesPerSecond: motion.speedTilesPerSecond,
      };

    case 'teleport':
      state.chargeDirection = null;
      return {
        motion,
        target: { x: state.position.x, y: state.position.y },
        speedTilesPerSecond: TELEPORT_SNAP_SPEED_TILES_PER_SECOND,
      };
  }
}

/** Tích phân di chuyển trong đoạn `[fromMs, toMs)` của bước hiện tại. */
function advanceMotion(
  context: StepContext,
  step: BossStep,
  fromMs: number,
  toMs: number,
): void {
  if (toMs <= fromMs) return;

  const move = step.actions.find(
    (action): action is Extract<BossAction, { kind: 'move' }> => action.kind === 'move',
  );
  if (move === undefined) return;

  const { state, player, events } = context;
  const { minX, maxX, minY, maxY } = bossRoomBounds(state.id);
  const dt = (toMs - fromMs) / 1000;
  const motion = move.motion;

  switch (motion.kind) {
    case 'teleport':
      // Đã snap lúc vào bước.
      break;

    case 'chase': {
      const bounds = { minX, maxX, minY, maxY };
      const target = clampToRoom(player, bounds);
      const dir = directionBetween(state.position, target);
      const travel = Math.min(motion.speedTilesPerSecond * dt, distance(state.position, target));
      state.position = clampToRoom(
        {
          x: state.position.x + dir.x * travel,
          y: state.position.y + dir.y * travel,
        },
        bounds,
      );
      break;
    }

    case 'swim': {
      const sign = state.facing === 'right' ? 1 : -1;
      const nextX = state.position.x + sign * motion.speedTilesPerSecond * dt;
      state.position = { x: clamp(nextX, minX, maxX), y: state.position.y };

      const hitEdge = nextX <= minX || nextX >= maxX;
      if (hitEdge) {
        state.facing = oppositeFacing(state.facing);
        // Đổi hướng giữa bước: báo adapter đích mới, nếu không nó đi tiếp về tường.
        events.push({
          kind: 'move',
          to: { x: state.facing === 'right' ? maxX : minX, y: state.position.y },
          speedTilesPerSecond: motion.speedTilesPerSecond,
        });
      }
      break;
    }

    case 'charge': {
      const direction = state.chargeDirection ?? directionForFacing(state.facing);
      const nextX = state.position.x + direction.x * motion.speedTilesPerSecond * dt;
      state.position = { x: clamp(nextX, minX, maxX), y: state.position.y };
      break;
    }

    case 'line-up': {
      const targetY = clamp(player.y, minY, maxY);
      const dy = targetY - state.position.y;
      const travel = motion.speedTilesPerSecond * dt;
      const nextY =
        Math.abs(dy) <= travel ? targetY : state.position.y + Math.sign(dy) * travel;
      state.position = { x: state.position.x, y: clamp(nextY, minY, maxY) };
      break;
    }
  }
}

/**
 * Phát đạn xoắn ốc rơi vào đoạn `[fromMs, toMs)` của bước.
 *
 * Đếm tick theo **thời gian đã trôi** chứ không theo bộ đếm trong state — nhờ
 * vậy state vẫn phẳng và một frame dài (mất frame) không làm mất nhịp.
 */
function emitSpiralTicks(
  context: StepContext,
  step: BossStep,
  stepStartedMs: number,
  fromMs: number,
  toMs: number,
): void {
  const spiral = step.actions.find(
    (action): action is Extract<BossAction, { kind: 'spiral' }> => action.kind === 'spiral',
  );
  if (spiral === undefined || toMs <= fromMs) return;
  if (!(spiral.spiral.intervalMs > 0)) {
    throw new Error(`spiral.intervalMs phải > 0, nhận ${spiral.spiral.intervalMs}`);
  }

  const { state, player, events } = context;
  const interval = spiral.spiral.intervalMs;
  const fromElapsed = fromMs - stepStartedMs;
  const toElapsed = toMs - stepStartedMs;
  const firstTick = Math.max(0, Math.ceil(fromElapsed / interval));

  for (let tick = firstTick; tick * interval < toElapsed; tick += 1) {
    const base = angleBetween(state.position, player);
    events.push({
      kind: 'shoot',
      bullets: [
        {
          from: { x: state.position.x, y: state.position.y },
          toward: null,
          angleOffset: base + tick * spiral.spiral.angleStepRadians,
          speed: spiral.spiral.speedTilesPerSecond,
          damage: spiral.spiral.damage,
          radiusTiles: spiral.spiral.radiusTiles,
        },
      ],
    });
  }
}

/**
 * Vận tốc thật của một `BulletVerb` — quy ước góc nằm ở đây để game và sim
 * không tự `atan2` khác nhau. `toward !== null` thì bay về đó rồi xoay thêm
 * `angleOffset`; ngược lại `angleOffset` là góc tuyệt đối.
 */
export function bulletVelocity(verb: BulletVerb): Vec2 {
  const baseAngle =
    verb.toward === null
      ? 0
      : Math.atan2(verb.toward.y - verb.from.y, verb.toward.x - verb.from.x);
  const angle = baseAngle + verb.angleOffset;
  return {
    x: Math.cos(angle) * verb.speed,
    y: Math.sin(angle) * verb.speed,
  };
}

// ---------------------------------------------------------------------------
// Nội bộ: dựng đạn
// ---------------------------------------------------------------------------

function buildVolley(spec: VolleySpec, state: BossState, player: Vec2): BulletVerb[] {
  const from = state.position;
  const bullets: BulletVerb[] = [];

  switch (spec.shape) {
    case 'fan':
    case 'spread': {
      const aim = aimPoint(from, player, spec.baseAngleRadians);
      const stepRadians = spec.count > 1 ? spec.spreadRadians / (spec.count - 1) : 0;
      for (let index = 0; index < spec.count; index += 1) {
        bullets.push({
          from: copy(from),
          toward: aim,
          angleOffset: (index - (spec.count - 1) / 2) * stepRadians,
          speed: spec.speedTilesPerSecond,
          damage: spec.damage,
          radiusTiles: spec.radiusTiles,
        });
      }
      break;
    }

    case 'ring': {
      const startAngle =
        spec.ringAimsAtPlayer === true
          ? angleBetween(from, player)
          : spec.baseAngleRadians;
      for (let index = 0; index < spec.count; index += 1) {
        bullets.push({
          from: copy(from),
          toward: null,
          angleOffset: startAngle + (index * TWO_PI) / spec.count,
          speed: spec.speedTilesPerSecond,
          damage: spec.damage,
          radiusTiles: spec.radiusTiles,
        });
      }
      break;
    }

    case 'line': {
      // Sóng slash: các viên xếp thành hàng **vuông góc** hướng bay, nên cả
      // hàng càn qua sân như một nhát chém thay vì một chùm toả.
      const angle = state.facing === 'right' ? 0 : Math.PI;
      const perpendicular = { x: -Math.sin(angle), y: Math.cos(angle) };
      for (let index = 0; index < spec.count; index += 1) {
        const offset = (index - (spec.count - 1) / 2) * LINE_BULLET_SPACING_TILES;
        bullets.push({
          from: { x: from.x + perpendicular.x * offset, y: from.y + perpendicular.y * offset },
          toward: null,
          angleOffset: angle,
          speed: spec.speedTilesPerSecond,
          damage: spec.damage,
          radiusTiles: spec.radiusTiles,
        });
      }
      break;
    }
  }

  return bullets;
}

/** Vệt lửa rải dọc đoạn charge đã đi được (không phải cả đường tới tường). */
function buildTrail(
  spec: TrailSpec,
  state: BossState,
  plan: MotionPlan | null,
  step: BossStep,
): BulletVerb[] {
  if (plan === null || plan.motion.kind !== 'charge') {
    throw new Error('trail cần bước hiện tại là một charge');
  }

  const direction = state.chargeDirection ?? directionForFacing(state.facing);
  const angle = Math.atan2(direction.y, direction.x);
  const travelled = Math.min(
    distance(state.position, plan.target),
    (plan.motion.speedTilesPerSecond * step.durationMs) / 1000,
  );
  const count = Math.max(1, Math.floor(travelled / spec.spacingTiles));

  const bullets: BulletVerb[] = [];
  for (let index = 1; index <= count; index += 1) {
    const along = (travelled * index) / count;
    bullets.push({
      from: { x: state.position.x + direction.x * along, y: state.position.y + direction.y * along },
      toward: null,
      angleOffset: angle,
      speed: spec.driftSpeedTilesPerSecond,
      damage: spec.damage,
      radiusTiles: spec.radiusTiles,
    });
  }
  return bullets;
}

// ---------------------------------------------------------------------------
// Nội bộ: hình học
// ---------------------------------------------------------------------------

function copy(point: Vec2): Vec2 {
  return { x: point.x, y: point.y };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clampToRoom(point: Vec2, bounds: RoomBounds): Vec2 {
  return {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };
}

/** Hướng bay tương ứng `facing`; Samurai chỉ charge ngang (GDD §5). */
function directionForFacing(facing: Facing): Vec2 {
  return facing === 'right' ? { x: 1, y: 0 } : { x: -1, y: 0 };
}

/**
 * Đích **thật** của một bước bơi/charge: đi được bao nhiêu trong `durationMs`
 * thì dừng đúng ở đó, không phải ở tường. Nhờ vậy event `move` và
 * `state.position` không lệch nhau — adapter nội suy theo event cũng đúng, mà
 * đọc state mỗi frame cũng đúng.
 */
function travelTarget(state: BossState, speedTilesPerSecond: number, durationMs: number): Vec2 {
  const sign = state.facing === 'right' ? 1 : -1;
  const travel = (speedTilesPerSecond * durationMs) / 1000;
  const bounds = bossRoomBounds(state.id);
  return {
    x: clamp(state.position.x + sign * travel, bounds.minX, bounds.maxX),
    y: state.position.y,
  };
}

function angleBetween(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Điểm để nhắm: player, hoặc một điểm 1 tile theo `fallbackAngle` khi player
 * đứng đúng chỗ boss (không có hướng xác định).
 */
function aimPoint(from: Vec2, player: Vec2, fallbackAngle: number): Vec2 {
  if (distance(from, player) > 0) return copy(player);
  return { x: from.x + Math.cos(fallbackAngle), y: from.y + Math.sin(fallbackAngle) };
}

function directionBetween(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/**
 * Điểm dịch chuyển ngẫu nhiên trong phòng, ưu tiên xa player.
 *
 * Luôn tiêu đúng `TELEPORT_ATTEMPTS` lần rút (2 số mỗi lần) để chuỗi RNG không
 * phụ thuộc việc lần thử nào thành công — nếu không, determinism vẫn đúng
 * nhưng nhịp RNG sẽ nhảy theo vị trí player.
 */
function pickTeleportTarget(
  rng: SeededRng,
  from: Vec2,
  player: Vec2,
  bounds: RoomBounds,
): Vec2 {
  const { minX, maxX, minY, maxY } = bounds;
  let best = clampToRoom({ x: maxX, y: from.y }, bounds);
  let bestGap = -1;

  for (let attempt = 0; attempt < TELEPORT_ATTEMPTS; attempt += 1) {
    const candidate: Vec2 = {
      x: minX + rng.next() * (maxX - minX),
      y: minY + rng.next() * (maxY - minY),
    };
    const gap = distance(candidate, player);
    if (gap >= TELEPORT_MIN_DISTANCE_FROM_PLAYER_TILES) return candidate;
    if (gap > bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }

  return best;
}
