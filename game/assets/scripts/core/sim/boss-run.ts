/**
 * Mô phỏng **một phòng boss** headless (GDD §5) — không engine, không DOM.
 *
 * Driver nối `core/boss/*` (`boss-defs`, `patterns.stepBoss`, `summon`) với
 * đúng những module combat mà game dùng (`AutoFire`, `HealthState`,
 * `BulletPool`), để test tích hợp chứng minh được: boss chạy đủ pattern, đổi
 * phase đúng ngưỡng, summon sinh quái trong phòng, và cùng seed cho cùng kết
 * quả. Cân bằng **phòng thường** vẫn do `run-simulation.ts` đo; file này chỉ
 * lo arena boss nên hai bên không phải sửa chung một file.
 *
 * Hợp đồng mô phỏng:
 *
 * - **Boss là nguồn sát thương duy nhất.** Quái do boss gọi đứng yên tại chỗ
 *   (vẫn là mục tiêu của auto-aim, vẫn chết khi trúng đạn): AI của chúng là
 *   `core/enemies/behaviours.ts` + adapter, chưa nối vào driver này — ở đây chỉ
 *   cần chứng minh đường `summon` chạy và vị trí hợp lệ.
 * - **Không có vật cản hay tường.** Arena coi như sân trống; đạn ra khỏi phòng
 *   bị thu hồi ngay. Pillar của arena là chuyện của scene, không phải của test
 *   cân bằng boss.
 * - **Không state module-level, không `Math.random`, không `Date.now`.** Ngẫu
 *   nhiên chỉ qua `SeededRng` dựng từ `seed`; `stepBoss` và `summonedEnemies`
 *   dùng chung instance đó nên chuỗi RNG là một dòng duy nhất.
 * - **Boss event nào cũng có chỗ trong log**: `shoot` sinh đạn thật, `summon`
 *   sinh quái thật, còn `move` / `telegraph` / `play-animation` chỉ được ghi
 *   lại (adapter Cocos mới là bên chạy animation và FX).
 * - `godMode` là hook test: player không nhận sát thương.
 */
import { BOSSES, phaseFor, type BossId, type BossPhase } from '../boss/boss-defs';
import {
  bulletVelocity,
  initialBossState,
  stepBoss,
  type BossState,
  type BulletVerb,
} from '../boss/patterns';
import { summonedEnemies } from '../boss/summon';
import { AutoFire } from '../combat/auto-fire';
import { BulletPool, hitsCircle, type Bullet } from '../combat/bullets';
import { HealthState } from '../combat/health';
import { accumulateDamage } from '../combat/integer-damage';
import { firePlayerVolley } from '../combat/player-fire';
import {
  HOMING_TURN_RATE_RADIANS_PER_SECOND,
  damageAfterExecute,
  lifestealHeal,
  ricochetTarget,
  steerVelocity,
} from '../combat/shot-effects';
import { StatusEffects } from '../combat/status-effects';
import type { Targetable } from '../combat/targeting';
import { DEFAULT_COMBAT } from '../config';
import { maxHealthFor } from '../enemies/behaviours';
import { ROOM_COLS, ROOM_ROWS, type EnemyRole } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { normalizeMoveInput, velocityFromInput, type MoveInput } from '../movement/move-intent';
import { SeededRng } from '../rng';
import { computeDerivedStats, type DerivedStats } from '../skills/derived-stats';

/** Bước mô phỏng, ms. Trùng nhịp `SIM_STEP_MS` của run simulation để so số đo. */
export const BOSS_RUN_STEP_MS = 16;

/** 3 phút — dài hơn nhiều so với một pha boss thật, chỉ để chặn treo. */
export const BOSS_RUN_DEFAULT_MAX_DURATION_MS = 180_000;

/** Id của boss trong mắt auto-aim; quái được gọi dùng id riêng của `summon.ts`. */
export const BOSS_TARGET_ID = 'boss';

/** Bán kính va chạm player, tile — cùng quy ước với `run-simulation.ts`. */
const PLAYER_RADIUS_TILES = 0.25;
/** Bán kính đạn player, tile. */
const PLAYER_BULLET_RADIUS_TILES = 0.15;
/**
 * Đạn player sống 1.2 s = 14.4 tile, dài hơn tầm auto-aim
 * (`DEFAULT_COMBAT.targetingRangeTiles`) nên viên bắn ra không hết hạn giữa đường.
 */
const PLAYER_BULLET_TTL_MS = 1200;
/**
 * Đạn boss sống 10 s: đủ bay hết đường chéo arena (≈37 tile) ở tốc độ chậm
 * nhất trong pattern (4 tile/s). Hết hạn thì pool thu hồi, không cần tường.
 */
const BOSS_BULLET_TTL_MS = 10_000;
/** Bán kính quái được gọi, tile — cùng quy ước với `run-simulation.ts`. */
const SUMMONED_RADIUS_TILES = 0.4;
/** Chừa nửa tile sát tường, giống enemy, để player không dính mép phòng. */
const PLAYER_EDGE_MARGIN_TILES = 0.5;
/**
 * Khoảng cách player cố giữ với boss trong policy mặc định, tile: trong tầm
 * auto-aim 2 tile để boss không rơi khỏi tầm khi vừa lùi vừa bắn.
 */
export const BOSS_COMFORT_RANGE_TILES = Math.max(1, DEFAULT_COMBAT.targetingRangeTiles - 2);

/** Player đứng giữa sân dưới; boss ở giữa sân. */
export const DEFAULT_PLAYER_START: Vec2 = { x: ROOM_COLS / 2, y: ROOM_ROWS - 2 };
export const DEFAULT_BOSS_START: Vec2 = { x: ROOM_COLS / 2, y: ROOM_ROWS / 2 };

/**
 * Bán kính **hitbox** của boss lấy từ `BossDef.hitboxRadiusTiles` (nguồn duy
 * nhất, kèm bảng suy ra từ kích thước sprite). Chỉ đọc một lần mỗi run.
 */

export type BossRunOutcome = 'won' | 'lost' | 'timeout';

/** Quái do boss gọi, ở dạng policy nhìn thấy (chỉ đọc). */
export interface BossSummonView {
  readonly id: string;
  readonly role: EnemyRole;
  readonly position: Vec2;
  readonly health: number;
  readonly maxHealth: number;
}

/** Thế giới mà policy đọc. Chỉ đọc, không được sửa. */
export interface BossRunWorld {
  readonly nowMs: number;
  readonly player: Vec2;
  readonly boss: Vec2;
  readonly bossHealth: number;
  readonly hearts: number;
  readonly bullets: readonly Bullet[];
  readonly summoned: readonly BossSummonView[];
}

/** Input kịch bản: hàm thuần của world, trả phím WASD của frame này. */
export type BossRunPolicy = (world: BossRunWorld) => MoveInput;

/**
 * Log sự kiện của một phòng boss. Mọi `BossEvent` của `stepBoss` đều xuất hiện
 * ở đây; `shoot`/`summon` kèm thêm kết quả thật (số đạn, quái đã sinh) để test
 * đối chiếu được mà không phải tự chạy lại pattern.
 */
export type BossRunEvent =
  | { readonly kind: 'boss-shoot'; readonly nowMs: number; readonly bullets: number }
  | {
      readonly kind: 'boss-summon';
      readonly nowMs: number;
      readonly phase: BossPhase;
      readonly enemyId: string;
      readonly role: EnemyRole;
      readonly at: Vec2;
    }
  | { readonly kind: 'boss-summoned-killed'; readonly nowMs: number; readonly enemyId: string }
  | {
      readonly kind: 'boss-move';
      readonly nowMs: number;
      readonly to: Vec2;
      readonly speedTilesPerSecond: number;
    }
  | {
      readonly kind: 'boss-telegraph';
      readonly nowMs: number;
      readonly durationMs: number;
      readonly at: Vec2;
    }
  | { readonly kind: 'boss-animation'; readonly nowMs: number; readonly animation: string }
  | { readonly kind: 'boss-phase'; readonly nowMs: number; readonly phase: BossPhase }
  | { readonly kind: 'boss-hit'; readonly nowMs: number; readonly health: number }
  | { readonly kind: 'boss-defeated'; readonly nowMs: number }
  | { readonly kind: 'player-shot'; readonly nowMs: number; readonly damage: number }
  | {
      readonly kind: 'player-hit';
      readonly nowMs: number;
      readonly hearts: number;
      readonly source: 'projectile' | 'contact';
    }
  | { readonly kind: 'player-dead'; readonly nowMs: number };

export interface BossRunOptions {
  readonly bossId: BossId;
  readonly seed: number;
  /** Mặc định `BOSS_RUN_DEFAULT_MAX_DURATION_MS`; hết giờ thì trả `timeout`. */
  readonly maxDurationMs?: number;
  /** Test hook: player không nhận sát thương. */
  readonly godMode?: boolean;
  /**
   * Sát thương mỗi viên đạn player. `0` = zero-DPS (dùng để đo áp lực boss mà
   * không giết nó). Mặc định `DEFAULT_COMBAT.damage`.
   */
  readonly playerDamagePerShot?: number;
  /** Skill của run (`Map<id, stacks>`) — sim phải mô phỏng đúng như game. */
  readonly skills?: ReadonlyMap<string, number>;
  /** Bắt đầu ở một phase (test "mỗi phase buộc phải di chuyển"). 1 = đầy máu. */
  readonly bossHealthFraction?: number;
  /** Test hook: máu player lớn hơn 6 để đo nhiều phase trong một lần chạy. */
  readonly playerMaxHearts?: number;
  /** Máu đầu vào (sim chapter nối phòng boss); mặc định đầy máu. */
  readonly playerHearts?: number;
  /** Mặc định `approachBoss`: bám boss để giữ tầm auto-aim. */
  readonly policy?: BossRunPolicy;
  readonly playerStart?: Vec2;
  readonly bossStart?: Vec2;
}

export interface BossRunResult {
  readonly outcome: BossRunOutcome;
  readonly bossHealth: number;
  readonly playerHearts: number;
  /** Các phase đã bước vào, theo thứ tự — `[2, 3]` là đi đủ 3 phase. */
  readonly phaseChanges: readonly BossPhase[];
  readonly events: readonly BossRunEvent[];
  readonly durationMs: number;
}

const NO_INPUT: MoveInput = { up: false, down: false, left: false, right: false };

/** Policy "đứng yên": dùng khi test cần player ăn đòn thay vì né. */
export const holdPosition: BossRunPolicy = () => NO_INPUT;

/**
 * Policy mặc định: đi về phía boss khi xa hơn `BOSS_COMFORT_RANGE_TILES`, đủ
 * gần thì đứng yên. Nhờ vậy boss luôn nằm trong tầm auto-aim kể cả sau cú
 * teleport, mà không cần biết né đạn — né là việc của policy do test truyền.
 */
export const approachBoss: BossRunPolicy = (world) => {
  if (distance(world.player, world.boss) <= BOSS_COMFORT_RANGE_TILES) return NO_INPUT;

  const dx = world.boss.x - world.player.x;
  const dy = world.boss.y - world.player.y;
  return moveInputToward(dx, dy);
};

/**
 * Đổi vector hướng (tile unit) thành phím WASD.
 *
 * Quy ước dấu lấy đúng `normalizeMoveInput`: `right` = +x, **`up` = +y** — tức
 * ngược với trục y hướng xuống của dữ liệu tile, và adapter Cocos lo phần lật
 * trục. Vì vậy muốn đi "lên" trong dữ liệu tile (y giảm) phải bấm `down`.
 */
function moveInputToward(dx: number, dy: number): MoveInput {
  return { up: dy > 0, down: dy < 0, left: dx < 0, right: dx > 0 };
}

/** State nội bộ của quái được gọi: chỉ vị trí + máu, không AI. */
interface SummonedState {
  readonly id: string;
  readonly role: EnemyRole;
  readonly position: Vec2;
  health: number;
  readonly maxHealth: number;
}

/** Chạy một phòng boss headless. Pure: không đọc/ghi state ngoài tham số. */
export function simulateBossRun(options: BossRunOptions): BossRunResult {
  const maxDurationMs = options.maxDurationMs ?? BOSS_RUN_DEFAULT_MAX_DURATION_MS;
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new Error(`simulateBossRun cần maxDurationMs hữu hạn > 0, nhận ${maxDurationMs}`);
  }

  const baseStats = computeDerivedStats(options.skills ?? new Map<string, number>());
  const damagePerShot = options.playerDamagePerShot ?? baseStats.damage;
  if (!Number.isFinite(damagePerShot) || damagePerShot < 0) {
    throw new Error(
      `simulateBossRun cần playerDamagePerShot hữu hạn >= 0, nhận ${damagePerShot}`,
    );
  }
  const stats: DerivedStats = { ...baseStats, damage: damagePerShot };
  const maxHearts = Math.max(baseStats.maxHearts, options.playerMaxHearts ?? 0);

  const rng = new SeededRng(options.seed);
  const health = new HealthState(
    {
      playerMaxHearts: maxHearts,
      invulnerabilityMs: baseStats.invulnerabilityMs,
    },
    Math.min(options.playerHearts ?? maxHearts, maxHearts),
  );
  const autoFire = AutoFire.fromRate(stats.fireRatePerSecond);
  const bullets = new BulletPool();
  const bossStatus = new StatusEffects();
  const events: BossRunEvent[] = [];
  const phaseChanges: BossPhase[] = [];
  /** Id đạn trúng trong frame hiện tại; tái dùng để không cấp phát mỗi frame. */
  const spent = new Set<number>();
  let hitstopMs = 0;

  const hitboxRadius = BOSSES[options.bossId].hitboxRadiusTiles;
  const policy = options.policy ?? approachBoss;
  const fraction = Math.min(1, Math.max(0, options.bossHealthFraction ?? 1));

  let boss: BossState = initialBossState(options.bossId, options.bossStart ?? DEFAULT_BOSS_START);
  if (fraction < 1) {
    boss = {
      ...boss,
      health: Math.round(BOSSES[options.bossId].maxHealth * fraction),
      phase: phaseFor(options.bossId, fraction),
    };
  }
  let bossDamageCarry = 0;
  let player: Vec2 = { ...(options.playerStart ?? DEFAULT_PLAYER_START) };
  const summoned: SummonedState[] = [];
  let durationMs = 0;
  let outcome: BossRunOutcome | null = null;

  const damageBoss = (amount: number): void => {
    if (amount <= 0 || boss.health <= 0) return;
    // Máu boss nguyên: poison/crit/execute lẻ được cộng dồn qua `carry`.
    const step = accumulateDamage(bossDamageCarry, amount);
    bossDamageCarry = step.carry;
    if (step.whole <= 0) return;

    boss = { ...boss, health: Math.max(0, boss.health - step.whole) };
    events.push({ kind: 'boss-hit', nowMs: durationMs, health: boss.health });
  };

  const damagePlayer = (amount: number, source: 'projectile' | 'contact' = 'projectile'): void => {
    if (options.godMode === true) return;
    const result = health.tryDamage(amount, durationMs);
    if (!result.applied) return;
    events.push({
      kind: 'player-hit',
      nowMs: durationMs,
      hearts: result.hearts,
      source,
    });
  };

  const healPlayer = (amount: number): void => {
    if (amount > 0) health.heal(amount);
  };

  while (durationMs < maxDurationMs && outcome === null) {
    durationMs += BOSS_RUN_STEP_MS;

    // Hitstop: thời gian trôi nhưng mô phỏng đứng yên, đúng `HitstopClock` của game.
    if (hitstopMs > 0) {
      hitstopMs -= BOSS_RUN_STEP_MS;
      continue;
    }

    // --- Player: di chuyển theo policy, rồi bắn tự động -------------------
    player = movePlayer(
      player,
      policy({
        nowMs: durationMs,
        player,
        boss: boss.position,
        bossHealth: boss.health,
        hearts: health.current,
        bullets: bullets.active(),
        summoned,
      }),
      stats.moveSpeedTilesPerSecond,
    );

    const targets: Targetable[] = [
      { id: BOSS_TARGET_ID, position: boss.position, alive: boss.health > 0 },
    ];
    for (const enemy of summoned) {
      if (enemy.health <= 0) continue;
      targets.push({ id: enemy.id, position: enemy.position, alive: true });
    }

    const shot = autoFire.update({
      deltaMs: BOSS_RUN_STEP_MS,
      origin: player,
      targets,
      rangeTiles: DEFAULT_COMBAT.targetingRangeTiles,
    });
    if (shot !== null) {
      firePlayerVolley({
        pool: bullets,
        stats,
        rng,
        origin: shot.origin,
        direction: shot.direction,
        speedTilesPerSecond: DEFAULT_COMBAT.projectileSpeedTilesPerSecond,
        radiusTiles: PLAYER_BULLET_RADIUS_TILES,
        ttlMs: PLAYER_BULLET_TTL_MS,
      });
      events.push({ kind: 'player-shot', nowMs: durationMs, damage: stats.damage });
    }

    // --- Boss: pattern ---------------------------------------------------
    const stepped = stepBoss({
      state: boss,
      nowMs: durationMs,
      deltaMs: BOSS_RUN_STEP_MS,
      player,
      rng,
    });
    boss = stepped.state;

    // Thân boss lúc charge gây sát thương (xem `combat-loop.ts`).
    if (
      boss.chargeDirection !== null &&
      boss.health > 0 &&
      distance(boss.position, player) <= hitboxRadius + PLAYER_RADIUS_TILES
    ) {
      damagePlayer(DEFAULT_COMBAT.contactDamage, 'contact');
    }

    for (const event of stepped.events) {
      switch (event.kind) {
        case 'shoot':
          for (const verb of event.bullets) spawnBossBullet(bullets, verb);
          events.push({ kind: 'boss-shoot', nowMs: durationMs, bullets: event.bullets.length });
          break;

        case 'summon': {
          // `summonedEnemies` là nguồn tất định duy nhất cho vị trí quái: cùng
          // seed + cùng state cho đúng cùng danh sách.
          for (const enemy of summonedEnemies(boss, event.role, event.count, rng)) {
            const enemyMaxHealth = maxHealthFor(enemy.role, false, undefined, BOSSES[options.bossId].chapter);
            summoned.push({
              id: enemy.id,
              role: enemy.role,
              position: enemy.position,
              health: enemyMaxHealth,
              maxHealth: enemyMaxHealth,
            });
            events.push({
              kind: 'boss-summon',
              nowMs: durationMs,
              phase: boss.phase,
              enemyId: enemy.id,
              role: enemy.role,
              at: enemy.position,
            });
          }
          break;
        }

        case 'move':
          events.push({
            kind: 'boss-move',
            nowMs: durationMs,
            to: event.to,
            speedTilesPerSecond: event.speedTilesPerSecond,
          });
          break;

        case 'telegraph':
          events.push({
            kind: 'boss-telegraph',
            nowMs: durationMs,
            durationMs: event.durationMs,
            at: event.at,
          });
          break;

        case 'play-animation':
          events.push({ kind: 'boss-animation', nowMs: durationMs, animation: event.animation });
          break;

        case 'phase-change':
          phaseChanges.push(event.phase);
          events.push({ kind: 'boss-phase', nowMs: durationMs, phase: event.phase });
          break;
      }
    }

    // --- Poison trên boss (skill Poison) ---------------------------------
    const poison = bossStatus.poisonDamage(durationMs, BOSS_RUN_STEP_MS);
    if (poison > 0 && boss.health > 0) damageBoss(poison);

    // --- Homing: xoay vận tốc về mục tiêu gần nhất ------------------------
    for (const bullet of bullets.active()) {
      if (!bullet.homing || bullet.owner !== 'player') continue;
      const aim = nearestTarget(bullet.position, boss, summoned);
      if (aim === null) continue;
      const turn = (HOMING_TURN_RATE_RADIANS_PER_SECOND * BOSS_RUN_STEP_MS) / 1000;
      const next = steerVelocity(bullet.velocity, bullet.position, aim, turn);
      bullet.velocity.x = next.x;
      bullet.velocity.y = next.y;
    }

    // --- Đạn: bay, dọn viên ra khỏi phòng, rồi giải va chạm --------------
    bullets.update(BOSS_RUN_STEP_MS);
    bullets.consumeWhere((bullet) => !isInsideArena(bullet.position));

    spent.clear();
    for (const bullet of bullets.active()) {
      if (spent.has(bullet.id)) continue;
      const area = { position: bullet.position, radiusTiles: bullet.radiusTiles };

      if (bullet.owner === 'enemy') {
        if (!hitsCircle(area, { position: player, radiusTiles: PLAYER_RADIUS_TILES })) continue;
        spent.add(bullet.id);
        damagePlayer(bullet.damage);
        continue;
      }

      let consumed = false;

      // Boss là mục tiêu chính; hitbox là proxy bán kính đã ghi ở đầu file.
      if (
        boss.health > 0 &&
        !bullet.hitIds.includes(BOSS_TARGET_ID) &&
        hitsCircle(area, { position: boss.position, radiusTiles: hitboxRadius })
      ) {
        const healthBefore = boss.health;
        const damage = damageAfterExecute(
          stats,
          bullet.damage,
          healthBefore / BOSSES[options.bossId].maxHealth,
        );
        damageBoss(damage);
        bossStatus.apply(stats, durationMs);
        healPlayer(lifestealHeal(stats, Math.min(damage, healthBefore)));
        bullet.hitIds.push(BOSS_TARGET_ID);
        hitstopMs = Math.max(hitstopMs, DEFAULT_COMBAT.enemyHitstopMs);
        splashDamage(stats, bullet, boss.position, summoned, (target) => {
          target.health = Math.max(0, target.health - bullet.explosiveDamage);
          if (target.health <= 0) {
            events.push({ kind: 'boss-summoned-killed', nowMs: durationMs, enemyId: target.id });
          }
        });
        consumed = resolveBulletAfterHit(bullet, boss.position, summoned);
        if (consumed) {
          spent.add(bullet.id);
          continue;
        }
      }

      for (const victim of summoned) {
        if (victim.health <= 0) continue;
        if (bullet.hitIds.includes(victim.id)) continue;
        if (!hitsCircle(area, { position: victim.position, radiusTiles: SUMMONED_RADIUS_TILES })) {
          continue;
        }

        const damage = damageAfterExecute(stats, bullet.damage, victim.health / victim.maxHealth);
        victim.health = Math.max(0, victim.health - damage);
        healPlayer(lifestealHeal(stats, Math.min(damage, victim.maxHealth)));
        bullet.hitIds.push(victim.id);
        hitstopMs = Math.max(hitstopMs, DEFAULT_COMBAT.enemyHitstopMs);
        if (victim.health <= 0) {
          events.push({ kind: 'boss-summoned-killed', nowMs: durationMs, enemyId: victim.id });
        }
        consumed = resolveBulletAfterHit(bullet, victim.position, summoned);
        if (consumed) break;
      }

      if (consumed) spent.add(bullet.id);
    }
    if (spent.size > 0) bullets.consumeWhere((bullet) => spent.has(bullet.id));

    // --- Kết thúc --------------------------------------------------------
    if (boss.health <= 0) {
      outcome = 'won';
      events.push({ kind: 'boss-defeated', nowMs: durationMs });
      break;
    }
    if (health.isDead) {
      outcome = 'lost';
      events.push({ kind: 'player-dead', nowMs: durationMs });
      break;
    }
  }

  return {
    outcome: outcome ?? 'timeout',
    bossHealth: Math.max(0, boss.health),
    playerHearts: health.current,
    phaseChanges,
    events,
    durationMs,
  };
}

/** Mục tiêu gần nhất cho Homing: boss nếu còn sống, sau đó tới quái được gọi. */
function nearestTarget(
  from: Vec2,
  boss: BossState,
  summoned: readonly SummonedState[],
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestGap = Number.POSITIVE_INFINITY;

  if (boss.health > 0) {
    best = boss.position;
    bestGap = distance(from, boss.position);
  }
  for (const enemy of summoned) {
    if (enemy.health <= 0) continue;
    const gap = distance(from, enemy.position);
    if (gap < bestGap) {
      best = enemy.position;
      bestGap = gap;
    }
  }
  return best;
}

/** Nổ AoE quanh điểm trúng: mọi mục tiêu khác trong bán kính nhận damage phụ. */
function splashDamage(
  stats: DerivedStats,
  bullet: Bullet,
  center: Vec2,
  summoned: readonly SummonedState[],
  apply: (target: SummonedState) => void,
): void {
  if (bullet.explosiveRadiusTiles <= 0 || stats.explosive === undefined) return;
  for (const enemy of summoned) {
    if (enemy.health <= 0 || bullet.hitIds.includes(enemy.id)) continue;
    if (distance(center, enemy.position) > bullet.explosiveRadiusTiles) continue;
    apply(enemy);
  }
}

/**
 * Sau khi trúng một mục tiêu: giữ đạn nếu còn xuyên, nảy sang mục tiêu khác
 * nếu còn lượt, ngược lại thu hồi. Trả `true` khi đạn phải bị bỏ.
 */
function resolveBulletAfterHit(
  bullet: Bullet,
  from: Vec2,
  summoned: readonly SummonedState[],
): boolean {
  if (bullet.pierceRemaining > 0) {
    bullet.pierceRemaining -= 1;
    return false;
  }
  if (bullet.ricochetRemaining > 0) {
    const next = ricochetTarget(
      from,
      summoned
        .filter((enemy) => enemy.health > 0)
        .map((enemy) => ({ id: enemy.id, position: enemy.position })),
      bullet.hitIds,
    );
    if (next !== null) {
      bullet.ricochetRemaining -= 1;
      const speed = Math.hypot(bullet.velocity.x, bullet.velocity.y);
      const dx = next.position.x - from.x;
      const dy = next.position.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      bullet.velocity.x = (dx / length) * speed;
      bullet.velocity.y = (dy / length) * speed;
      return false;
    }
  }
  return true;
}

/** Di chuyển player theo phím của frame, kẹp trong phòng. */
function movePlayer(player: Vec2, input: MoveInput, speedTilesPerSecond: number): Vec2 {
  const velocity = velocityFromInput(normalizeMoveInput(input), speedTilesPerSecond);
  const seconds = BOSS_RUN_STEP_MS / 1000;
  const maxX = ROOM_COLS - PLAYER_EDGE_MARGIN_TILES;
  const maxY = ROOM_ROWS - PLAYER_EDGE_MARGIN_TILES;

  return {
    x: clamp(player.x + velocity.x * seconds, PLAYER_EDGE_MARGIN_TILES, maxX),
    y: clamp(player.y + velocity.y * seconds, PLAYER_EDGE_MARGIN_TILES, maxY),
  };
}

/**
 * Đổi `BulletVerb` thành một viên đạn thật.
 *
 * Hợp đồng góc lấy nguyên từ `patterns.BulletVerb`: `toward !== null` thì bay
 * về `toward` rồi xoay thêm `angleOffset`; `toward === null` thì `angleOffset`
 * là góc tuyệt đối, 0 = +x, `Math.PI / 2` = +y (xuống).
 */
function spawnBossBullet(bullets: BulletPool, verb: BulletVerb): void {
  const velocity = bulletVelocity(verb);
  bullets.spawn({
    position: verb.from,
    velocity,
    radiusTiles: verb.radiusTiles,
    damage: verb.damage,
    owner: 'enemy',
    ttlMs: BOSS_BULLET_TTL_MS,
  });
}

/** Hình chữ nhật đóng — điểm đúng trên biên vẫn tính là trong phòng. */
function isInsideArena(point: Vec2): boolean {
  return point.x >= 0 && point.x <= ROOM_COLS && point.y >= 0 && point.y <= ROOM_ROWS;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
