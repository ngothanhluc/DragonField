/**
 * 8× enemies per room, delivered in waves under an alive cap, with fair spawn and attack rules
 * (M9, ticket #41).
 *
 * STUB written with the red acceptance test. The executor replaces the bodies; the exported names
 * and signatures are the agreed seam.
 */
import type { ViewRect } from '../camera/follow-camera';
import type { EnemyRole, LevelData } from '../level/level-data';
import type { Vec2 } from '../math/vec2';

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

/** Total enemies this room spawns (8× the v1 count for its chapter, seeded). */
export function roomEnemyTotal(level: LevelData, seed: number): number {
  void seed;
  return level.waves.reduce((sum, wave) => sum + wave.enemies.length, 0);
}

export class WaveScheduler {
  private spawnedCount = 0;

  constructor(
    readonly level: LevelData,
    readonly seed: number,
  ) {}

  get total(): number {
    return roomEnemyTotal(this.level, this.seed);
  }

  get spawned(): number {
    return this.spawnedCount;
  }

  /** Spawns to create now (may be empty). Never lets `alive` exceed the cap. */
  step(args: SchedulerStepArgs): ScheduledSpawn[] {
    void args;
    return [];
  }

  /** Every enemy of the room spawned and none alive. */
  isCleared(alive: number): boolean {
    return this.spawnedCount >= this.total && alive === 0;
  }
}

/** An enemy may fire, charge or pounce only while inside the view (shrunk by `insetTiles`). */
export function canAttackFrom(position: Vec2, view: ViewRect, insetTiles = 1): boolean {
  void position;
  void view;
  void insetTiles;
  return true;
}

/**
 * What the edge arrows point at: the nearest `max` off-screen enemies while the room is not
 * cleared, the doors once it is. Positions in tiles, nearest first.
 */
export function edgeArrowTargets(
  player: Vec2,
  view: ViewRect,
  enemies: readonly Vec2[],
  doors: readonly Vec2[],
  cleared: boolean,
  max = 3,
): Vec2[] {
  void player;
  void view;
  void enemies;
  void doors;
  void cleared;
  void max;
  return [];
}
