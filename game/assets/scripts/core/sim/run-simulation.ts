/**
 * Mô phỏng run headless — không engine, không DOM, không `SaveStorage`.
 *
 * Nối các module `core/` mà game dùng (`waves`, `behaviours`, `AutoFire`,
 * `BulletPool`, `HealthState`, `rewards`, `skills`, `boss`) thành tick loop 16 ms,
 * để test tích hợp bắt regression balance và luồng thắng/thua mà không mở Cocos.
 *
 * Đây là bản mô phỏng **của đúng những luật game đang chạy** (M4):
 *
 * - Nhịp bắn/damage/số đạn/crit/pierce/ricochet/homing/nổ/freeze/poison/
 *   lifesteal/shield/thorns đều lấy từ `DerivedStats` và các helper core mà
 *   `game/` dùng.
 * - Hitstop và stagger được mô phỏng: trúng đạn làm mô phỏng đứng yên 70 ms và
 *   enemy choáng 150 ms, cooldown không reset.
 * - Elite caster bắn loạt 3 viên, chaser elite lao, tank elite lao 2 lần; hitbox
 *   và tầm chạm scale theo silhouette vai trò.
 * - Phòng boss **không** còn là tank placeholder: nó chạy `simulateBossRun`
 *   (`core/sim/boss-run.ts`), tức `stepBoss` + phase + summon + skill.
 *
 * - Ngẫu nhiên chỉ qua `SeededRng` tạo từ `seed`; không module-level state.
 * - Vật cản **chỉ chặn đạn** (mô phỏng cân bằng, không phải collision/nav thật).
 * - `godMode` là hook test: bỏ qua sát thương lên player để đo thời gian dọn phòng.
 */
import { bossForSpriteName } from '../boss/boss-defs';
import { AutoFire } from '../combat/auto-fire';
import { BulletPool, firstHit, hitsCircle, type Bullet } from '../combat/bullets';
import { HealthState } from '../combat/health';
import { firePlayerVolley } from '../combat/player-fire';
import {
  HOMING_TURN_RATE_RADIANS_PER_SECOND,
  damageAfterExecute,
  lifestealHeal,
  ricochetTarget,
  steerVelocity,
} from '../combat/shot-effects';
import { ShieldCharger } from '../combat/shield';
import { StatusEffects } from '../combat/status-effects';
import { DEFAULT_COMBAT } from '../config';
import {
  CHASER_CONTACT_RANGE_TILES,
  ROOM_EDGE_MARGIN_TILES,
  attackReleased,
  contactDamageFor,
  decideAction,
  speedFor,
  staggerAction,
  visualScaleFor,
  type EnemyAction,
  type EnemyState,
} from '../enemies/behaviours';
import { eliteVolleyAngles } from '../enemies/elite';
import { isWaveCleared, spawnWave } from '../enemies/waves';
import type { ChapterData, EnemyRole, LevelData } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { normalizeMoveInput, velocityFromInput, type MoveInput } from '../movement/move-intent';
import { SeededRng } from '../rng';
import { goldForKill, goldForRoomClear } from '../run/rewards';
import { computeDerivedStats } from '../skills/derived-stats';
import { simulateBossRun } from './boss-run';

export const SIM_STEP_MS = 16;
/** 10 phút — dài hơn run 8–12 phút của GDD §2. */
export const SIM_DEFAULT_MAX_DURATION_MS = 600_000;

/** Bán kính va chạm, tile. */
const PLAYER_RADIUS_TILES = 0.25;
const DEFAULT_ENEMY_RADIUS_TILES = 0.4;
const BULLET_RADIUS_TILES = 0.15;
/** Chaser đứng yên đúng tại ngưỡng này, nên vùng sát thương phải bằng nó. */
const CONTACT_RANGE_TILES = CHASER_CONTACT_RANGE_TILES;
/**
 * Đạn player phải sống đủ lâu để bay hết tầm auto-aim, nếu không "tầm bắn"
 * trong `config/tuning.json` chỉ là số ảo. Lấy 1.2 s (đủ rộng cho 12 tile/s × 10 tile)
 * hoặc 1.5× thời gian bay hết tầm, cái nào lớn hơn.
 */
const PLAYER_BULLET_TTL_MS = Math.max(
  1200,
  Math.ceil(
    (DEFAULT_COMBAT.targetingRangeTiles / DEFAULT_COMBAT.projectileSpeedTilesPerSecond) *
      1000 *
      1.5,
  ),
);
/** Đạn enemy chậm để né được (GDD §4). */
const ENEMY_BULLET_SPEED_TILES_PER_SECOND = 4;
const ENEMY_BULLET_TTL_MS = 3000;
/** Lệch hướng đạn caster, radian — nguồn duy nhất cần seed. */
const ENEMY_SHOT_SPREAD_RADIANS = 0.15;

/** Thế giới mà policy đọc. Chỉ đọc, không được sửa. */
export interface PolicyWorld {
  readonly nowMs: number;
  readonly room: number;
  /** Index wave 0-based. */
  readonly wave: number;
  readonly player: Vec2;
  readonly hearts: number;
  readonly shieldCharges: number;
  readonly enemies: readonly EnemyState[];
  readonly bullets: readonly Bullet[];
}

/** Input kịch bản: hàm thuần của world, trả phím WASD của frame này. */
export type InputPolicy = (world: PolicyWorld) => MoveInput;

export interface SimulationOptions {
  readonly seed: number;
  /** Một chapter đầy đủ; phòng lấy theo thứ tự trong `level.rooms`. */
  readonly level: ChapterData;
  readonly policy: InputPolicy;
  /** Mặc định `SIM_DEFAULT_MAX_DURATION_MS`; hết giờ thì trả `timeout`. */
  readonly maxDurationMs?: number;
  /** Test hook: player không nhận sát thương. */
  readonly godMode?: boolean;
  /** Skill đang sở hữu, `Map<skillId, stacks>` như `RunState` của game. */
  readonly skills?: ReadonlyMap<string, number>;
}

export type SimulationStatus = 'won' | 'lost' | 'timeout';

interface SimEventBase {
  readonly nowMs: number;
  readonly room: number;
}

export type SimulationEvent =
  | (SimEventBase & { readonly kind: 'kill'; readonly enemyId: string; readonly role: EnemyRole; readonly gold: number })
  | (SimEventBase & { readonly kind: 'player-hit'; readonly hearts: number; readonly source: 'contact' | 'projectile' })
  | (SimEventBase & { readonly kind: 'shield-block' })
  | (SimEventBase & { readonly kind: 'room-cleared'; readonly gold: number })
  | (SimEventBase & { readonly kind: 'boss-phase'; readonly phase: number })
  | { readonly kind: 'run-won' | 'run-lost'; readonly nowMs: number };

export interface SimulationResult {
  readonly status: SimulationStatus;
  readonly roomsCleared: number;
  readonly kills: number;
  readonly goldEarned: number;
  readonly durationMs: number;
  readonly events: readonly SimulationEvent[];
}

/** Chạy trọn một chapter headless. Pure: không đọc/ghi state ngoài tham số. */
export function simulateRun(options: SimulationOptions): SimulationResult {
  const maxDurationMs = options.maxDurationMs ?? SIM_DEFAULT_MAX_DURATION_MS;
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    throw new Error(`simulateRun cần maxDurationMs hữu hạn > 0, nhận ${maxDurationMs}`);
  }
  const firstRoom = options.level.rooms[0];
  if (firstRoom === undefined) throw new Error('simulateRun cần chapter có ít nhất 1 phòng');

  const rng = new SeededRng(options.seed);
  const stats = computeDerivedStats(options.skills ?? new Map<string, number>());
  const health = new HealthState({
    playerMaxHearts: stats.maxHearts,
    invulnerabilityMs: stats.invulnerabilityMs,
  });
  const shield = new ShieldCharger(
    stats.shield?.charges ?? 0,
    stats.shield?.cooldownMs ?? 0,
  );
  const autoFire = AutoFire.fromRate(stats.fireRatePerSecond);
  const bullets = new BulletPool();
  /** Status của từng enemy, key = id (không nhét vào `EnemyState` để không đổi schema chung). */
  const statuses = new Map<string, StatusEffects>();
  const events: SimulationEvent[] = [];
  /** Id đạn trúng trong frame hiện tại; tái dùng để không cấp phát mỗi frame. */
  const spent = new Set<number>();
  let hitstopMs = 0;

  let roomIndex = 0;
  let room = firstRoom;
  let waveIndex = 0;
  let enemies = spawnRoomWave(room, 0);
  let player: Vec2 = { x: room.playerStart.x, y: room.playerStart.y };
  let durationMs = 0;
  let roomsCleared = 0;
  let kills = 0;
  let goldEarned = 0;
  let status: SimulationStatus | null = null;

  const healPlayer = (amount: number): void => {
    if (amount > 0) health.heal(amount);
  };

  const damagePlayer = (amount: number): void => {
    if (options.godMode === true) return;
    if (shield.tryBlock(durationMs)) {
      events.push({ kind: 'shield-block', nowMs: durationMs, room: room.room });
      return;
    }
    const result = health.tryDamage(amount, durationMs);
    if (!result.applied) return;
    events.push({
      kind: 'player-hit',
      nowMs: durationMs,
      room: room.room,
      hearts: result.hearts,
      source: 'projectile',
    });
  };

  const statusOf = (enemy: EnemyState): StatusEffects => {
    let entry = statuses.get(enemy.id);
    if (entry === undefined) {
      entry = new StatusEffects();
      statuses.set(enemy.id, entry);
    }
    return entry;
  };

  /**
   * Caster bắn một loạt. Elite dùng `eliteVolleyAngles` (3 viên toả); thường
   * một viên với lệch ngẫu nhiên nhỏ để hai caster không bắn trùng một đường.
   * Cùng luật với `game/combat-loop.ts`.
   */
  const fireCasterVolley = (enemy: EnemyState): void => {
    const dx = player.x - enemy.position.x;
    const dy = player.y - enemy.position.y;
    const length = Math.hypot(dx, dy);
    const baseAngle = length === 0 ? 0 : Math.atan2(dy, dx);
    const eliteAngles = eliteVolleyAngles(enemy.role, enemy.elite);
    const angles =
      enemy.elite && eliteAngles.length > 0
        ? eliteAngles
        : [(rng.next() * 2 - 1) * ENEMY_SHOT_SPREAD_RADIANS];
    const damage = contactDamageFor(enemy.role, enemy.elite, undefined, room.chapter);

    for (const offset of angles) {
      const angle = baseAngle + offset;
      bullets.spawn({
        position: enemy.position,
        velocity: {
          x: Math.cos(angle) * ENEMY_BULLET_SPEED_TILES_PER_SECOND,
          y: Math.sin(angle) * ENEMY_BULLET_SPEED_TILES_PER_SECOND,
        },
        radiusTiles: BULLET_RADIUS_TILES,
        damage,
        owner: 'enemy',
        ttlMs: ENEMY_BULLET_TTL_MS,
      });
    }
  };

  const killEnemy = (enemy: EnemyState, atMs: number): void => {
    if (enemy.health <= 0 && enemy.action.kind === 'dead') return;
    enemy.health = 0;
    enemy.action = { kind: 'dead' };
    const gold = Math.round(goldForKill(enemy.role, enemy.elite) * stats.goldMultiplier);
    kills += 1;
    goldEarned += gold;
    events.push({
      kind: 'kill',
      nowMs: atMs,
      room: room.room,
      enemyId: enemy.id,
      role: enemy.role,
      gold,
    });
  };

  const damageEnemy = (enemy: EnemyState, amount: number): number => {
    if (amount <= 0 || enemy.health <= 0) return 0;
    const dealt = Math.min(amount, enemy.health);
    enemy.health = Math.max(0, enemy.health - amount);
    if (enemy.health <= 0) killEnemy(enemy, durationMs);
    else enemy.action = staggerAction(durationMs, DEFAULT_COMBAT.enemyStaggerMs);
    return dealt;
  };

  /** Vào phòng boss: giao hẳn cho `simulateBossRun` và kết thúc run. */
  const runBossRoom = (
    bossRoom: LevelData,
    atRoomIndex: number,
  ): { bossDurationMs: number; won: boolean } => {
    const bossDef =
      bossRoom.boss === undefined ? undefined : bossForSpriteName(bossRoom.boss.name);
    if (bossDef === undefined) {
      throw new Error(`Phòng boss ${bossRoom.id} thiếu boss hợp lệ trong BOSSES`);
    }

    const result = simulateBossRun({
      bossId: bossDef.id,
      seed: options.seed + atRoomIndex * 1_000 + 1,
      maxDurationMs: Math.max(1, maxDurationMs - durationMs),
      godMode: options.godMode,
      skills: options.skills,
      playerHearts: health.current,
      playerStart: bossRoom.playerStart,
      bossStart: bossRoom.bossStart,
    });

    for (const event of result.events) {
      if (event.kind === 'boss-phase') {
        events.push({
          kind: 'boss-phase',
          nowMs: durationMs + event.nowMs,
          room: bossRoom.room,
          phase: event.phase,
        });
      }
    }
    if (result.outcome === 'won') {
      kills += 1;
      const gold = Math.round(goldForRoomClear(true) * stats.goldMultiplier);
      goldEarned += gold;
      roomsCleared += 1;
      events.push({
        kind: 'room-cleared',
        nowMs: durationMs + result.durationMs,
        room: bossRoom.room,
        gold,
      });
      events.push({ kind: 'run-won', nowMs: durationMs + result.durationMs });
    } else {
      events.push({ kind: 'run-lost', nowMs: durationMs + result.durationMs });
    }

    return { bossDurationMs: result.durationMs, won: result.outcome === 'won' };
  };

  // Chapter chỉ có phòng boss (author sai/edge): xử lý trước khi vào loop.
  if (room.isBossRoom) {
    const bossRun = runBossRoom(room, 0);
    return {
      status: bossRun.won ? 'won' : 'lost',
      roomsCleared,
      kills,
      goldEarned,
      durationMs: bossRun.bossDurationMs,
      events,
    };
  }

  while (durationMs < maxDurationMs && status === null) {
    durationMs += SIM_STEP_MS;
    shield.update(durationMs);

    // Hitstop: thời gian trôi nhưng mô phỏng đứng yên (đúng `HitstopClock`).
    if (hitstopMs > 0) {
      hitstopMs -= SIM_STEP_MS;
      continue;
    }

    const intent = options.policy({
      nowMs: durationMs,
      room: room.room,
      wave: waveIndex,
      player,
      hearts: health.current,
      shieldCharges: shield.charges,
      enemies,
      bullets: bullets.active(),
    });
    player = movePlayer(player, intent, stats.moveSpeedTilesPerSecond, room);

    const targets = enemies.map((enemy) => ({
      id: enemy.id,
      position: enemy.position,
      alive: enemy.health > 0 && enemy.action.kind !== 'dead',
    }));
    const shot = autoFire.update({
      deltaMs: SIM_STEP_MS,
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
        radiusTiles: BULLET_RADIUS_TILES,
        ttlMs: PLAYER_BULLET_TTL_MS,
      });
    }

    // --- Enemy AI ---------------------------------------------------------
    for (const enemy of enemies) {
      if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;

      const statusEffects = statusOf(enemy);
      const slow = statusEffects.speedMultiplier(durationMs);
      const poison = statusEffects.poisonDamage(durationMs, SIM_STEP_MS);
      if (poison > 0) damageEnemy(enemy, poison);
      if (enemy.health <= 0) continue;

      const before = enemy.action;
      const next = decideAction({ state: enemy, player, nowMs: durationMs, level: room });
      if (next.kind !== before.kind) enemy.actionStartedMs = durationMs;
      enemy.action = next;

      if (attackReleased(before, next) === 'shot') {
        fireCasterVolley(enemy);
      }
      advanceEnemy(enemy, next, slow, room);

      const melee = enemy.role === 'chaser' || enemy.role === 'tank';
      const contactRange = CONTACT_RANGE_TILES * visualScaleFor(enemy.role);
      if (melee && distance(enemy.position, player) <= contactRange) {
        if (options.godMode !== true) {
          if (shield.tryBlock(durationMs)) {
            events.push({ kind: 'shield-block', nowMs: durationMs, room: room.room });
          } else {
            const result = health.tryDamage(
              contactDamageFor(enemy.role, enemy.elite, undefined, room.chapter),
              durationMs,
            );
            if (result.applied) {
              events.push({
                kind: 'player-hit',
                nowMs: durationMs,
                room: room.room,
                hearts: result.hearts,
                source: 'contact',
              });
              // Thorns: chạm vào player thì enemy ăn đòn (chỉ khi đòn thật sự vào).
              if (stats.thorns !== undefined) {
                damageEnemy(enemy, stats.thorns.damage);
              }
            }
          }
        }
      }
    }

    // --- Homing -----------------------------------------------------------
    for (const bullet of bullets.active()) {
      if (!bullet.homing || bullet.owner !== 'player') continue;
      const aim = nearestAlive(bullet.position, enemies);
      if (aim === null) continue;
      const turn = (HOMING_TURN_RATE_RADIANS_PER_SECOND * SIM_STEP_MS) / 1000;
      const next = steerVelocity(bullet.velocity, bullet.position, aim, turn);
      bullet.velocity.x = next.x;
      bullet.velocity.y = next.y;
    }

    bullets.update(SIM_STEP_MS);

    // Vật cản + va chạm. Viên trúng được gom id rồi `consumeWhere` **một lượt**
    // sau vòng lặp: không thu hồi giữa lúc đang duyệt `active()`, và đạn trúng
    // biến mất ngay trong frame này thay vì sống thêm một frame với `ttlMs = 0`.
    const seconds = SIM_STEP_MS / 1000;
    spent.clear();
    for (const bullet of bullets.active()) {
      if (spent.has(bullet.id)) continue;

      const from = {
        x: bullet.position.x - bullet.velocity.x * seconds,
        y: bullet.position.y - bullet.velocity.y * seconds,
      };
      if (firstHit({ from, to: bullet.position }, room) !== null) {
        spent.add(bullet.id);
        continue;
      }
      const area = { position: bullet.position, radiusTiles: bullet.radiusTiles };

      if (bullet.owner === 'enemy') {
        if (!hitsCircle(area, { position: player, radiusTiles: PLAYER_RADIUS_TILES })) continue;
        spent.add(bullet.id);
        damagePlayer(bullet.damage);
        continue;
      }

      // Đạn player: quét mọi enemy còn sống trên đường (Piercing), nảy nếu có
      // Ricochet, rồi mới quyết thu hồi.
      let consumed = false;
      for (const enemy of enemies) {
        if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
        if (bullet.hitIds.includes(enemy.id)) continue;

        const enemyRadius = DEFAULT_ENEMY_RADIUS_TILES * visualScaleFor(enemy.role);
        if (!hitsCircle(area, { position: enemy.position, radiusTiles: enemyRadius })) continue;

        bullet.hitIds.push(enemy.id);
        const damage = damageAfterExecute(stats, bullet.damage, enemy.health / enemy.maxHealth);
        const dealt = damageEnemy(enemy, damage);
        healPlayer(lifestealHeal(stats, dealt));
        statusOf(enemy).apply(stats, durationMs);
        hitstopMs = Math.max(hitstopMs, DEFAULT_COMBAT.enemyHitstopMs);

        // Explosive: damage phụ lên enemy khác trong bán kính.
        if (bullet.explosiveRadiusTiles > 0 && bullet.explosiveDamage > 0) {
          for (const other of enemies) {
            if (other === enemy || other.health <= 0 || other.action.kind === 'dead') continue;
            if (distance(bullet.position, other.position) > bullet.explosiveRadiusTiles) continue;
            damageEnemy(other, bullet.explosiveDamage);
          }
        }

        // Enemy chết vì đòn chính: event kill đã phát trong damageEnemy.
        if (bullet.pierceRemaining > 0) {
          bullet.pierceRemaining -= 1;
          continue;
        }
        if (bullet.ricochetRemaining > 0) {
          const next = ricochetTarget(
            bullet.position,
            enemies
              .filter((candidate) => candidate.health > 0 && candidate.action.kind !== 'dead')
              .map((candidate) => ({ id: candidate.id, position: candidate.position })),
            bullet.hitIds,
          );
          if (next !== null) {
            bullet.ricochetRemaining -= 1;
            const speed = Math.hypot(bullet.velocity.x, bullet.velocity.y);
            const dx = next.position.x - bullet.position.x;
            const dy = next.position.y - bullet.position.y;
            const length = Math.hypot(dx, dy) || 1;
            bullet.velocity.x = (dx / length) * speed;
            bullet.velocity.y = (dy / length) * speed;
            continue;
          }
        }
        consumed = true;
        break;
      }

      if (consumed) spent.add(bullet.id);
    }
    if (spent.size > 0) bullets.consumeWhere((bullet) => spent.has(bullet.id));

    if (health.isDead) {
      status = 'lost';
      events.push({ kind: 'run-lost', nowMs: durationMs });
      break;
    }
    if (!isWaveCleared(enemies)) continue;

    if (waveIndex + 1 < waveCount(room)) {
      waveIndex += 1;
    } else {
      const roomGold = Math.round(goldForRoomClear(room.isBossRoom) * stats.goldMultiplier);
      goldEarned += roomGold;
      roomsCleared += 1;
      events.push({ kind: 'room-cleared', nowMs: durationMs, room: room.room, gold: roomGold });
      healPlayer(stats.healPerRoom ?? 0);

      const nextRoom = options.level.rooms[roomIndex + 1];
      if (nextRoom === undefined) {
        status = 'won';
        events.push({ kind: 'run-won', nowMs: durationMs });
        break;
      }

      roomIndex += 1;
      room = nextRoom;
      waveIndex = 0;

      if (room.isBossRoom) {
        const bossRun = runBossRoom(room, roomIndex);
        durationMs += bossRun.bossDurationMs;
        status = bossRun.won ? 'won' : 'lost';
        break;
      }

      player = { x: room.playerStart.x, y: room.playerStart.y };
    }

    enemies = spawnRoomWave(room, waveIndex);
    bullets.clear();
  }

  return { status: status ?? 'timeout', roomsCleared, kills, goldEarned, durationMs, events };
}

/** Wave của phòng. Boss room do `runBossRoom` xử lý nên ở đây chỉ phòng thường. */
function spawnRoomWave(room: LevelData, waveIndex: number): EnemyState[] {
  return spawnWave(room, waveIndex);
}

function waveCount(room: LevelData): number {
  return room.waves.length;
}

function nearestAlive(from: Vec2, enemies: readonly EnemyState[]): Vec2 | null {
  let best: Vec2 | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const enemy of enemies) {
    if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;
    const gap = distance(from, enemy.position);
    if (gap < bestGap) {
      best = enemy.position;
      bestGap = gap;
    }
  }
  return best;
}

function movePlayer(player: Vec2, input: MoveInput, speed: number, room: LevelData): Vec2 {
  const velocity = velocityFromInput(normalizeMoveInput(input), speed);
  const seconds = SIM_STEP_MS / 1000;
  const maxX = room.size.cols - ROOM_EDGE_MARGIN_TILES;
  const maxY = room.size.rows - ROOM_EDGE_MARGIN_TILES;
  return {
    x: Math.min(Math.max(player.x + velocity.x * seconds, ROOM_EDGE_MARGIN_TILES), maxX),
    y: Math.min(Math.max(player.y + velocity.y * seconds, ROOM_EDGE_MARGIN_TILES), maxY),
  };
}

/** Di chuyển enemy theo action vừa quyết; `slow` là hệ số Freeze hiện tại. */
function advanceEnemy(enemy: EnemyState, action: EnemyAction, slow: number, level: LevelData): void {
  const seconds = SIM_STEP_MS / 1000;
  const factor = Math.max(0, Math.min(1, slow));

  if (action.kind === 'charge') {
    const step = action.speedTilesPerSecond * factor * seconds;
    const { x, y } = action.direction;
    enemy.position = clampToRoom(level, {
      x: enemy.position.x + x * step,
      y: enemy.position.y + y * step,
    });
    return;
  }
  if (action.kind !== 'walk') return;

  const dx = action.target.x - enemy.position.x;
  const dy = action.target.y - enemy.position.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;

  const scale = Math.min(1, (speedFor(enemy.role, enemy.elite) * factor * seconds) / length);
  enemy.position = clampToRoom(level, {
    x: enemy.position.x + dx * scale,
    y: enemy.position.y + dy * scale,
  });
}

function clampToRoom(level: LevelData, point: Vec2): Vec2 {
  return {
    x: Math.min(Math.max(point.x, ROOM_EDGE_MARGIN_TILES), level.size.cols - ROOM_EDGE_MARGIN_TILES),
    y: Math.min(Math.max(point.y, ROOM_EDGE_MARGIN_TILES), level.size.rows - ROOM_EDGE_MARGIN_TILES),
  };
}
