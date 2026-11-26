/**
 * 8× enemies per room, delivered in waves under an alive cap, with fair spawn and attack rules
 * (M9, ticket #41).
 *
 * GDD §13.2: a normal room is 4 screens (64×36), so its enemies cannot all stand in it at once.
 * This scheduler owns **delivery**:
 *
 * - `roomEnemyTotal()` decides how many enemies a room spawns: 8× the count the `.tmx` authors,
 *   clamped into the chapter's range in `config/tuning.json` (`waves.chapterTotals`), seeded so
 *   two runs of the same room are not identical.
 * - `step()` releases them in batches at most `aliveCapForSlot(runSlot)` alive at once (a run opens
 *   small and grows room by room, never past `waves.aliveCap`), on free ground at least
 *   `waves.minSpawnDistanceTiles` from the player. The role mix (and which ones are elite) cycles
 *   the room's own spawn list, so the authored composition is what the room plays.
 * - A spawn that lands inside the current view carries `telegraphMs > 0`: the game shows its
 *   spawn telegraph and the enemy only becomes active afterwards, so nothing ever appears on top
 *   of the player.
 *
 * Everything here is a pure function of its arguments plus the seeded RNG: same seed → same room.
 */
import type { ViewRect } from '../camera/follow-camera';
import { ROOM_COLS, ROOM_ROWS, type EnemyRole, type LevelData } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import { SeededRng } from '../rng';
import { insideViewRect } from '../view/view-rect';
import { maxHealthFor, type EnemyState } from './behaviours';
import { ENEMY_TUNING, WAVES_TUNING, type ChapterWaveTotal } from './tuning';

export { canAttackFrom } from '../view/view-rect';

export interface ScheduledSpawn {
  readonly role: EnemyRole;
  readonly at: Vec2;
  readonly elite: boolean;
  /** > 0 when the spawn appears inside the view: it must show its spawn telegraph this long first. */
  readonly telegraphMs: number;
}

export interface SchedulerStepArgs {
  readonly nowMs: number;
  readonly player: Vec2;
  readonly view: ViewRect;
  /** Enemies of this room currently alive (spawned and not dead). */
  readonly alive: number;
}

/** GDD §13.2: a normal room holds 8× the enemies the v1 `.tmx` authored. */
const ENEMIES_PER_ROOM_MULTIPLIER = 8;

/** Scatter copies made per authored spawn point, so a room is not fed from 4 fixed dots. */
const JITTER_VARIANTS = 4;

/** Extra free-ground points as a fallback, tiles apart. */
const GRID_STEP_TILES = 3;

/** A spawn keeps this much space from an obstacle, tiles (an enemy hitbox is 0.4–0.7). */
const OBSTACLE_CLEARANCE_TILES = 0.7;

/** Chapter range of a normal room's enemy total; out of range clamps to the first/last chapter. */
function chapterTotalsFor(chapter: number): ChapterWaveTotal {
  const totals = WAVES_TUNING.chapterTotals;
  if (totals.length === 0) return { min: 0, max: 0 };
  const index = Math.min(Math.max(Math.floor(chapter), 1), totals.length) - 1;
  return totals[index] ?? totals[0] ?? { min: 0, max: 0 };
}

/** One authored spawn of the room, in the order the designer wrote it. */
interface AuthoredSpawn {
  readonly role: EnemyRole;
  readonly elite: boolean;
  readonly at: Vec2;
}

/** Every authored spawn of the room, wave order flattened — the role mix the room plays. */
function authoredSpawns(level: LevelData): AuthoredSpawn[] {
  const spawns: AuthoredSpawn[] = [];
  for (const wave of level.waves) {
    for (const enemy of wave.enemies) {
      spawns.push({ role: enemy.role, elite: enemy.elite, at: enemy.at });
    }
  }
  return spawns;
}

/** Deterministic per-room stream: the run seed mixed with chapter and room number. */
function roomSeed(level: LevelData, seed: number): number {
  const base = Number.isFinite(seed) ? Math.floor(seed) : 0;
  return (
    (Math.imul(base, 0x9e3779b1) ^
      Math.imul(level.chapter, 0x85ebca6b) ^
      Math.imul(level.room, 0xc2b2ae35)) >>>
    0
  );
}

/**
 * Whether a room uses the M9 wave delivery. Only a **multi-screen normal room** (64×36 since #66,
 * ADR-018) does: a one-screen room (a boss arena, a dev room, a hand-built test fixture) cannot
 * host 24+ enemies around a 32×18 alive cap, so it keeps exactly the enemies its `.tmx` authors.
 */
export function usesWaveScheduler(level: LevelData): boolean {
  if (level.isBossRoom) return false;
  return level.size.cols > ROOM_COLS || level.size.rows > ROOM_ROWS;
}

/** Total enemies this room spawns (8× the v1 count for its chapter, seeded). */
export function roomEnemyTotal(level: LevelData, seed: number): number {
  const authored = authoredSpawns(level).length;
  if (authored === 0) return 0;
  if (!usesWaveScheduler(level)) return authored;

  const { min, max } = chapterTotalsFor(level.chapter);
  const rng = new SeededRng(roomSeed(level, seed));
  const scaled = authored * ENEMIES_PER_ROOM_MULTIPLIER * (0.9 + rng.next() * 0.2);
  return Math.min(Math.max(Math.round(scaled), min), max);
}

/**
 * One enemy state for a scheduled spawn, with the chapter's health scaling applied. A fresh
 * enemy stands still (`idle`) and waits out an attack cooldown, so `actionStartedMs` starts at
 * the spawn time instead of 0 (which would be long past).
 *
 * The wait is capped at the role's own telegraph (#66): a denser 64×36 room needs the slow roles
 * to fire less often, but a caster that spawns with a full 2.6 s cooldown ahead of it is killed by
 * the player's auto-aim before its first shot — the balance sim pins "every caster fires before
 * dying". Capping the *first* wait leaves the between-shots cooldown untouched.
 */
export function enemyStateFromSpawn(
  level: LevelData,
  spawn: ScheduledSpawn,
  index: number,
  nowMs = 0,
): EnemyState {
  const maxHealth = maxHealthFor(spawn.role, spawn.elite, undefined, level.chapter);
  const cooldownMs = ENEMY_TUNING.roles[spawn.role].attackCooldownMs;
  const graceMs = Math.min(cooldownMs, ENEMY_TUNING.roles[spawn.role].telegraphMs);
  return {
    id: `r${level.room}-s${index}`,
    role: spawn.role,
    elite: spawn.elite,
    position: { x: spawn.at.x, y: spawn.at.y },
    health: maxHealth,
    maxHealth,
    action: { kind: 'idle' },
    actionStartedMs: nowMs - (cooldownMs - graceMs),
  };
}

/** One position a scheduled spawn may use, ready to be checked against the live player. */
function isFreeGround(level: LevelData, point: Vec2): boolean {
  const margin = OBSTACLE_CLEARANCE_TILES;
  if (point.x < margin || point.x > level.size.cols - margin) return false;
  if (point.y < margin || point.y > level.size.rows - margin) return false;

  for (const obstacle of level.obstacles) {
    if (
      point.x > obstacle.x - margin &&
      point.x < obstacle.x + obstacle.width + margin &&
      point.y > obstacle.y - margin &&
      point.y < obstacle.y + obstacle.height + margin
    ) {
      return false;
    }
  }
  return true;
}

/** Fisher–Yates with the seeded stream, so the candidate order (and thus every spawn) is fixed. */
function shuffleInPlace(points: Vec2[], rng: SeededRng): void {
  for (let index = points.length - 1; index > 0; index -= 1) {
    const swap = rng.int(index + 1);
    const a = points[index];
    const b = points[swap];
    if (a === undefined || b === undefined) continue;
    points[index] = b;
    points[swap] = a;
  }
}

/**
 * Alive cap of one run slot (#41). A run opens with a small crowd (`aliveCapStart`) and grows by
 * `aliveCapStepPerRoom` per drawn room, never past `aliveCap` (24). That way room 1 of a chapter is
 * a fair fight for a player with no skills yet, while the late rooms still reach the full wave.
 * `slot` is 1-based: the drawn room's position in the run.
 */
export function aliveCapForSlot(slot: number): number {
  const max = Math.max(0, Math.floor(WAVES_TUNING.aliveCap));
  if (!Number.isFinite(slot)) return max;
  const start = Math.min(Math.max(0, Math.floor(WAVES_TUNING.aliveCapStart)), max);
  const step = Math.max(0, Math.floor(WAVES_TUNING.aliveCapStepPerRoom));
  const index = Math.max(0, Math.ceil(slot) - 1);
  return Math.min(max, start + step * index);
}

export class WaveScheduler {
  private readonly rng: SeededRng;
  /** Role + elite of every spawn, in order (the room's own list, cycled to the total). */
  private readonly queue: AuthoredSpawn[];
  /** This room's alive cap: the run-slot ramp, never above `waves.aliveCap`. */
  private readonly cap: number;
  private spawnedCount = 0;
  /** Simulated time the next batch may leave, ms. */
  private nextSpawnAtMs = 0;
  /** Rotating cursor into the candidate points, so consecutive spawns do not share a spot. */
  private cursor = 0;
  /** Candidate spawn points, built once (authored points + jitter, then a free-ground grid). */
  private points: Vec2[] | null = null;

  /**
   * `runSlot` is the drawn room's position in the run (1-based, default 1 = the run's first room),
   * which caps how many enemies this room holds at once — see `aliveCapForSlot`.
   * `extraElites` promotes up to that many non-elite enemies in the wave queue (used by `'xp'` doors).
   */
  constructor(
    readonly level: LevelData,
    readonly seed: number,
    readonly runSlot = 1,
    extraElites = 0,
  ) {
    this.rng = new SeededRng(roomSeed(level, seed) ^ 0x5bf03635);
    this.cap = aliveCapForSlot(runSlot);
    const total = roomEnemyTotal(level, seed);
    const authored = authoredSpawns(level);
    this.queue = [];
    for (let index = 0; index < total; index += 1) {
      const source = authored[index % Math.max(1, authored.length)];
      if (source === undefined) break;
      this.queue.push(source);
    }
    this.promoteExtraElites(extraElites);
  }

  /** Promote up to `extraElites` non-elite enemies (excluding splitlings) deterministically. */
  private promoteExtraElites(extraElites: number): void {
    const count = Number.isFinite(extraElites) ? Math.max(0, Math.floor(extraElites)) : 0;
    if (count === 0) return;

    const candidates: number[] = [];
    for (let index = 0; index < this.queue.length; index += 1) {
      const entry = this.queue[index];
      if (entry !== undefined && !entry.elite && entry.role !== 'splitling') {
        candidates.push(index);
      }
    }
    const promotions = Math.min(count, candidates.length);
    for (let step = 0; step < promotions; step += 1) {
      const pick = this.rng.int(candidates.length);
      const targetIndex = candidates.splice(pick, 1)[0];
      if (targetIndex === undefined) continue;
      const current = this.queue[targetIndex];
      if (current !== undefined) {
        this.queue[targetIndex] = { ...current, elite: true };
      }
    }
  }

  get total(): number {
    return this.queue.length;
  }

  get spawned(): number {
    return this.spawnedCount;
  }

  /** Enemies of this room allowed alive at once (the run-slot ramp). */
  get aliveCap(): number {
    return this.cap;
  }

  /** Spawns to create now (may be empty). Never lets `alive` exceed the cap. */
  step(args: SchedulerStepArgs): ScheduledSpawn[] {
    const { nowMs, player, view, alive } = args;
    if (this.spawnedCount >= this.total) return [];

    const cap = Math.max(0, this.cap);
    const free = Math.min(cap - alive, this.total - this.spawnedCount);
    if (free <= 0) return [];
    // Pacing: one batch per interval. A stalled spawn (cap full) does not queue several batches —
    // the next batch is released as soon as a slot frees up.
    if (nowMs < this.nextSpawnAtMs) return [];

    // The first batch of a room is at most half its cap: opening a room with the whole crowd at
    // once reads as an ambush, and the player needs a moment to see where the room is.
    const firstBatchCap =
      this.spawnedCount === 0 ? Math.max(1, Math.ceil(cap / 2)) : Number.POSITIVE_INFINITY;
    const batch = Math.min(
      Math.max(1, WAVES_TUNING.spawnBatchSize),
      Math.min(free, firstBatchCap),
    );
    const spawns: ScheduledSpawn[] = [];
    for (let index = 0; index < batch; index += 1) {
      const queued = this.queue[this.spawnedCount + index];
      if (queued === undefined) break;
      const at = this.pickPoint(player);
      spawns.push({
        role: queued.role,
        elite: queued.elite,
        at,
        telegraphMs: insideViewRect(at, view) ? WAVES_TUNING.telegraphMs : 0,
      });
    }

    if (spawns.length === 0) return [];
    this.spawnedCount += spawns.length;
    this.nextSpawnAtMs = nowMs + WAVES_TUNING.spawnIntervalMs;
    return spawns;
  }

  /** Every enemy of the room spawned and none alive. */
  isCleared(alive: number): boolean {
    return this.spawnedCount >= this.total && alive === 0;
  }

  /**
   * First candidate from the rotating cursor that is free ground and within the spawn band
   * (`minSpawnDistanceTiles` .. `maxSpawnDistanceTiles`) around the player. When no candidate fits
   * the band, the lower bound alone still applies (a spawn must never land on the player), and as
   * a last resort the free point farthest from the player is used — a skipped spawn would mean the
   * room can never clear.
   */
  private pickPoint(player: Vec2): Vec2 {
    const points = this.points ?? (this.points = this.buildPoints());
    const min = WAVES_TUNING.minSpawnDistanceTiles;
    const max = WAVES_TUNING.maxSpawnDistanceTiles;

    const nearest = this.search(player, points, min, max);
    if (nearest !== null) return nearest;
    const anyFar = this.search(player, points, min, Number.POSITIVE_INFINITY);
    if (anyFar !== null) return anyFar;

    let best: Vec2 = { x: this.level.size.cols / 2, y: this.level.size.rows / 2 };
    let bestGap = -1;
    for (const point of points) {
      const gap = distance(point, player);
      if (gap > bestGap) {
        bestGap = gap;
        best = point;
      }
    }
    return { x: best.x, y: best.y };
  }

  /** One pass over the candidate ring: the first point inside `[min, max]` distance, or null. */
  private search(
    player: Vec2,
    points: readonly Vec2[],
    min: number,
    max: number,
  ): Vec2 | null {
    for (let attempt = 0; attempt < points.length; attempt += 1) {
      const point = points[(this.cursor + attempt) % points.length];
      if (point === undefined) continue;
      const gap = distance(point, player);
      if (gap < min || gap > max) continue;
      this.cursor = (this.cursor + attempt + 1) % points.length;
      return { x: point.x, y: point.y };
    }
    return null;
  }

  /** Authored points with seeded jitter first, then a free-ground grid; shuffled once, seeded. */
  private buildPoints(): Vec2[] {
    const level = this.level;
    const jitter = Math.max(0, WAVES_TUNING.spawnJitterTiles);
    const points: Vec2[] = [];

    for (const spawn of authoredSpawns(level)) {
      for (let copy = 0; copy < JITTER_VARIANTS; copy += 1) {
        const point = {
          x: spawn.at.x + (this.rng.next() * 2 - 1) * jitter,
          y: spawn.at.y + (this.rng.next() * 2 - 1) * jitter,
        };
        if (isFreeGround(level, point)) points.push(point);
      }
    }

    // Fallback grid: a room's authored points can all sit near a door the player starts next to.
    for (let y = GRID_STEP_TILES; y < level.size.rows; y += GRID_STEP_TILES) {
      for (let x = GRID_STEP_TILES; x < level.size.cols; x += GRID_STEP_TILES) {
        const point = { x, y };
        if (isFreeGround(level, point)) points.push(point);
      }
    }

    shuffleInPlace(points, this.rng);
    return points;
  }
}

/**
 * What the edge arrows point at: the nearest `max` off-screen enemies while the room is not
 * cleared, the off-screen doors once it is. Positions in tiles, nearest first.
 */
export function edgeArrowTargets(
  player: Vec2,
  view: ViewRect,
  enemies: readonly Vec2[],
  doors: readonly Vec2[],
  cleared: boolean,
  max = 3,
): Vec2[] {
  const limit = Math.max(0, Math.floor(max));
  if (limit === 0) return [];

  const candidates = (cleared ? doors : enemies).filter((point) => !insideViewRect(point, view));
  return candidates
    .map((point) => ({ point, gap: distance(point, player) }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, limit)
    .map((entry) => ({ x: entry.point.x, y: entry.point.y }));
}
