/**
 * 8× enemies per room, delivered in waves under an alive cap, with fair spawn and attack rules
 * (M9, ticket #41).
 *
 * GDD §13.2: a normal room is 16 screens (128×72), so its enemies cannot all stand in it at once.
 * This scheduler owns **delivery**:
 *
 * - `roomEnemyTotal()` decides how many enemies a room spawns: 8× the count the `.tmx` authors,
 *   clamped into the chapter's range in `config/tuning.json` (`waves.chapterTotals`), seeded so
 *   two runs of the same room are not identical.
 * - `step()` releases them in batches at most `waves.aliveCap` alive at once, on free ground at
 *   least `waves.minSpawnDistanceTiles` from the player. The role mix (and which ones are elite)
 *   cycles the room's own spawn list, so the authored composition is what the room plays.
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
import { WAVES_TUNING, type ChapterWaveTotal } from './tuning';

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
 * Whether a room uses the M9 wave delivery. Only a **multi-screen normal room** (128×72, ADR-018)
 * does: a one-screen room (a boss arena, a dev room, a hand-built test fixture) cannot host 24+
 * enemies around a 32×18 alive cap, so it keeps exactly the enemies its `.tmx` authors.
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
 * enemy stands still (`idle`) and waits out one attack cooldown (see `behaviours.ts`), so
 * `actionStartedMs` starts at the spawn time instead of 0 (which would be long past).
 */
export function enemyStateFromSpawn(
  level: LevelData,
  spawn: ScheduledSpawn,
  index: number,
  nowMs = 0,
): EnemyState {
  const maxHealth = maxHealthFor(spawn.role, spawn.elite, undefined, level.chapter);
  return {
    id: `r${level.room}-s${index}`,
    role: spawn.role,
    elite: spawn.elite,
    position: { x: spawn.at.x, y: spawn.at.y },
    health: maxHealth,
    maxHealth,
    action: { kind: 'idle' },
    actionStartedMs: nowMs,
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

export class WaveScheduler {
  private readonly rng: SeededRng;
  /** Role + elite of every spawn, in order (the room's own list, cycled to the total). */
  private readonly queue: AuthoredSpawn[];
  private spawnedCount = 0;
  /** Simulated time the next batch may leave, ms. */
  private nextSpawnAtMs = 0;
  /** Rotating cursor into the candidate points, so consecutive spawns do not share a spot. */
  private cursor = 0;
  /** Candidate spawn points, built once (authored points + jitter, then a free-ground grid). */
  private points: Vec2[] | null = null;

  constructor(
    readonly level: LevelData,
    readonly seed: number,
  ) {
    this.rng = new SeededRng(roomSeed(level, seed) ^ 0x5bf03635);
    const total = roomEnemyTotal(level, seed);
    const authored = authoredSpawns(level);
    this.queue = [];
    for (let index = 0; index < total; index += 1) {
      const source = authored[index % Math.max(1, authored.length)];
      if (source === undefined) break;
      this.queue.push(source);
    }
  }

  get total(): number {
    return this.queue.length;
  }

  get spawned(): number {
    return this.spawnedCount;
  }

  /** Spawns to create now (may be empty). Never lets `alive` exceed the cap. */
  step(args: SchedulerStepArgs): ScheduledSpawn[] {
    const { nowMs, player, view, alive } = args;
    if (this.spawnedCount >= this.total) return [];

    const cap = Math.max(0, WAVES_TUNING.aliveCap);
    const free = Math.min(cap - alive, this.total - this.spawnedCount);
    if (free <= 0) return [];
    // Pacing: one batch per interval. A stalled spawn (cap full) does not queue several batches —
    // the next batch is released as soon as a slot frees up.
    if (nowMs < this.nextSpawnAtMs) return [];

    const batch = Math.min(Math.max(1, WAVES_TUNING.spawnBatchSize), free);
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
   * First candidate from the rotating cursor that is free ground and far enough from the player.
   * Falls back to the free point farthest from the player, so a spawn is never skipped (a skipped
   * spawn would mean the room can never clear).
   */
  private pickPoint(player: Vec2): Vec2 {
    const points = this.points ?? (this.points = this.buildPoints());
    for (let attempt = 0; attempt < points.length; attempt += 1) {
      const point = points[(this.cursor + attempt) % points.length];
      if (point === undefined) continue;
      if (distance(point, player) < WAVES_TUNING.minSpawnDistanceTiles) continue;
      this.cursor = (this.cursor + attempt + 1) % points.length;
      return { x: point.x, y: point.y };
    }

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
