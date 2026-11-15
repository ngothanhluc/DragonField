/**
 * Mô phỏng run headless — không engine, không DOM, không `SaveStorage`.
 *
 * Nối các module `core/` mà game dùng (`waves`, `behaviours`, `AutoFire`,
 * `BulletPool`, `HealthState`, `rewards`) thành tick loop 16 ms, để test tích
 * hợp bắt regression balance và luồng thắng/thua mà không mở Cocos.
 *
 * - Ngẫu nhiên chỉ qua `SeededRng` tạo từ `seed`; không module-level state.
 * - Vật cản **chỉ chặn đạn** (mô phỏng cân bằng, không phải collision/nav thật).
 * - `godMode` là hook test: bỏ qua sát thương lên player để đo thời gian dọn phòng.
 */
import { AutoFire } from '../combat/auto-fire';
import { BulletPool, firstHit, hitsCircle, type Bullet } from '../combat/bullets';
import { HealthState } from '../combat/health';
import { DEFAULT_COMBAT } from '../config';
import {
  CHASER_CONTACT_RANGE_TILES,
  ROOM_EDGE_MARGIN_TILES,
  TANK_CHARGE_SPEED_TILES_PER_SECOND,
  attackReleased,
  contactDamageFor,
  decideAction,
  maxHealthFor,
  speedFor,
  type EnemyAction,
  type EnemyState,
} from '../enemies/behaviours';
import { isWaveCleared, spawnWave } from '../enemies/waves';
import type { ChapterData, EnemyRole, LevelData } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { normalizeMoveInput, velocityFromInput, type MoveInput } from '../movement/move-intent';
import { SeededRng } from '../rng';
import { goldForKill, goldForRoomClear } from '../run/rewards';
import { computeDerivedStats } from '../skills/derived-stats';

export const SIM_STEP_MS = 16;
/** 10 phút — dài hơn run 8–12 phút của GDD §2. */
export const SIM_DEFAULT_MAX_DURATION_MS = 600_000;

/** Bán kính va chạm, tile. */
const PLAYER_RADIUS_TILES = 0.25;
const ENEMY_RADIUS_TILES = 0.4;
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
  | (SimEventBase & { readonly kind: 'room-cleared'; readonly gold: number })
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
  const health = new HealthState({ playerMaxHearts: stats.maxHearts, invulnerabilityMs: stats.invulnerabilityMs });
  const autoFire = AutoFire.fromRate(stats.fireRatePerSecond);
  const bullets = new BulletPool();
  const events: SimulationEvent[] = [];
  /** Id đạn trúng trong frame hiện tại; tái dùng để không cấp phát mỗi frame. */
  const spent = new Set<number>();

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

  const applyDamage = (amount: number, source: 'contact' | 'projectile'): void => {
    if (options.godMode === true) return;
    const result = health.tryDamage(amount, durationMs);
    if (!result.applied) return;
    events.push({ kind: 'player-hit', nowMs: durationMs, room: room.room, hearts: result.hearts, source });
  };

  while (durationMs < maxDurationMs && status === null) {
    durationMs += SIM_STEP_MS;

    const intent = options.policy({
      nowMs: durationMs,
      room: room.room,
      wave: waveIndex,
      player,
      hearts: health.current,
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
      const speed = DEFAULT_COMBAT.projectileSpeedTilesPerSecond;
      const velocity = { x: shot.direction.x * speed, y: shot.direction.y * speed };
      bullets.spawn({
        position: shot.origin,
        velocity,
        radiusTiles: BULLET_RADIUS_TILES,
        damage: stats.damage,
        owner: 'player',
        ttlMs: PLAYER_BULLET_TTL_MS,
      });
    }

    // decideAction là hàm thuần; adapter (ở đây) mới là bên ghi action.
    for (const enemy of enemies) {
      if (enemy.health <= 0 || enemy.action.kind === 'dead') continue;

      const before = enemy.action;
      const next = decideAction({ state: enemy, player, nowMs: durationMs, level: room });
      if (next.kind !== before.kind) enemy.actionStartedMs = durationMs;
      enemy.action = next;

      if (attackReleased(before, next) === 'shot') {
        const spread = (rng.next() * 2 - 1) * ENEMY_SHOT_SPREAD_RADIANS;
        spawnEnemyShot(bullets, enemy, player, spread);
      }
      advanceEnemy(enemy, next);

      const melee = enemy.role === 'chaser' || enemy.role === 'tank';
      if (melee && distance(enemy.position, player) <= CONTACT_RANGE_TILES) {
        applyDamage(contactDamageFor(enemy.role, enemy.elite), 'contact');
      }
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
        applyDamage(bullet.damage, 'projectile');
        continue;
      }

      const target = enemies.find(
        (enemy) =>
          enemy.health > 0 &&
          enemy.action.kind !== 'dead' &&
          hitsCircle(area, { position: enemy.position, radiusTiles: ENEMY_RADIUS_TILES }),
      );
      if (target === undefined) continue;

      spent.add(bullet.id);
      target.health -= bullet.damage;
      if (target.health > 0) continue;

      target.action = { kind: 'dead' };
      const gold = goldForKill(target.role, target.elite);
      kills += 1;
      goldEarned += gold;
      events.push({ kind: 'kill', nowMs: durationMs, room: room.room, enemyId: target.id, role: target.role, gold });
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
      const roomGold = goldForRoomClear(room.isBossRoom);
      goldEarned += roomGold;
      roomsCleared += 1;
      events.push({ kind: 'room-cleared', nowMs: durationMs, room: room.room, gold: roomGold });

      const nextRoom = options.level.rooms[roomIndex + 1];
      if (nextRoom === undefined) {
        status = 'won';
        events.push({ kind: 'run-won', nowMs: durationMs });
        break;
      }
      roomIndex += 1;
      room = nextRoom;
      waveIndex = 0;
      player = { x: room.playerStart.x, y: room.playerStart.y };
    }

    enemies = spawnRoomWave(room, waveIndex);
    bullets.clear();
  }

  return { status: status ?? 'timeout', roomsCleared, kills, goldEarned, durationMs, events };
}

/**
 * Wave của phòng. Boss room chưa dùng được `core/boss/*` (module đang thêm song
 * song, chưa có API spawn `EnemyState` ổn định) nên tạm là **một tank**.
 *
 * TODO(boss): thay bằng `assets/scripts/core/boss/patterns.ts` (`stepBoss`) +
 * `boss-defs.ts` để boss room chạy đúng pattern GDD §5.
 */
function spawnRoomWave(room: LevelData, waveIndex: number): EnemyState[] {
  if (!room.isBossRoom) return spawnWave(room, waveIndex);

  const health = maxHealthFor('tank', false);
  const position = { x: room.size.cols / 2, y: room.size.rows / 4 };
  return [
    {
      id: `r${room.room}-boss`,
      role: 'tank',
      elite: false,
      position,
      health,
      maxHealth: health,
      action: { kind: 'idle' },
      actionStartedMs: 0,
    },
  ];
}

function waveCount(room: LevelData): number {
  return room.isBossRoom ? 1 : room.waves.length;
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

/** Di chuyển enemy theo action vừa quyết; `walk` không vượt quá target. */
function advanceEnemy(enemy: EnemyState, action: EnemyAction): void {
  const seconds = SIM_STEP_MS / 1000;

  if (action.kind === 'charge') {
    const step = TANK_CHARGE_SPEED_TILES_PER_SECOND * seconds;
    const { x, y } = action.direction;
    enemy.position = { x: enemy.position.x + x * step, y: enemy.position.y + y * step };
    return;
  }
  if (action.kind !== 'walk') return;

  const dx = action.target.x - enemy.position.x;
  const dy = action.target.y - enemy.position.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;

  const scale = Math.min(1, (speedFor(enemy.role, enemy.elite) * seconds) / length);
  enemy.position = { x: enemy.position.x + dx * scale, y: enemy.position.y + dy * scale };
}

function spawnEnemyShot(bullets: BulletPool, enemy: EnemyState, player: Vec2, spread: number): void {
  const dx = player.x - enemy.position.x;
  const dy = player.y - enemy.position.y;
  const length = Math.hypot(dx, dy);
  const base = length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length };
  const cos = Math.cos(spread);
  const sin = Math.sin(spread);
  const direction = { x: base.x * cos - base.y * sin, y: base.x * sin + base.y * cos };
  const speed = ENEMY_BULLET_SPEED_TILES_PER_SECOND;

  bullets.spawn({
    position: enemy.position,
    velocity: { x: direction.x * speed, y: direction.y * speed },
    radiusTiles: BULLET_RADIUS_TILES,
    damage: contactDamageFor(enemy.role, enemy.elite),
    owner: 'enemy',
    ttlMs: ENEMY_BULLET_TTL_MS,
  });
}
