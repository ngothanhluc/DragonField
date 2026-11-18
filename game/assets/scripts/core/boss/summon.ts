/**
 * Enemies summoned by a boss (GDD §5, SquidGreen phase 3: "summon 2 GreenOctopus").
 *
 * Pure and deterministic: same boss + same role + same seed gives exactly the same list.
 * Positions come from an **8-cell ring** around the boss (radius
 * `SUMMON_RING_RADIUS_TILES`, 45° per cell, starting at +x), then clamped into the room.
 * A cell too close to the boss or overlapping an already-summoned enemy is skipped, moving to the next
 * cell; if the whole ring is invalid, take the cell farthest from the boss (a slight overlap
 * beats failing to summon).
 *
 * Deterministic ids: `boss-<bossId>-<role>-<step>-<index>`. `step` keeps two summons
 * at different steps from colliding, and re-running the same seed gives the same ids.
 */
import { ROOM_COLS, ROOM_ROWS, type EnemyRole } from '../level/level-data';
import { distance, type Vec2 } from '../math/vec2';
import type { SeededRng } from '../rng';
import type { BossState } from './patterns';

/** Radius of the summon ring around the boss, tiles. */
export const SUMMON_RING_RADIUS_TILES = 4;

/** Cells on the ring — 8 directions, enough that 2 enemies never have to overlap. */
export const SUMMON_RING_SLOTS = 8;

/** Minimum distance between a summoned enemy and the boss, and between summoned enemies, tiles. */
export const SUMMON_MIN_SEPARATION_TILES = 1.5;

/** Keep 1 tile off the wall, same convention as the boss (`BOSS_EDGE_MARGIN_TILES`). */
export const SUMMON_EDGE_MARGIN_TILES = 1;

const MIN_X = SUMMON_EDGE_MARGIN_TILES;
const MAX_X = ROOM_COLS - SUMMON_EDGE_MARGIN_TILES;
const MIN_Y = SUMMON_EDGE_MARGIN_TILES;
const MAX_Y = ROOM_ROWS - SUMMON_EDGE_MARGIN_TILES;

export interface SummonedEnemy {
  id: string;
  position: Vec2;
  role: EnemyRole;
}

/**
 * `count` enemies around the boss. `rng` is the only randomness source: each enemy draws
 * exactly one number (`int`) to pick a starting cell, so the RNG stream does not depend on
 * whether that cell was valid.
 */
export function summonedEnemies(
  boss: BossState,
  role: EnemyRole,
  count: number,
  rng: SeededRng,
): SummonedEnemy[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`summonedEnemies needs count to be an integer >= 0, got ${count}`);
  }

  const slots = ringSlots(boss.position);
  const used: Vec2[] = [];
  const summoned: SummonedEnemy[] = [];

  for (let index = 0; index < count; index += 1) {
    const start = rng.int(SUMMON_RING_SLOTS);
    const position = pickSlot(slots, start, boss.position, used);
    used.push(position);

    summoned.push({
      id: `boss-${boss.id}-${role}-${boss.step}-${index}`,
      position: { x: position.x, y: position.y },
      role,
    });
  }

  return summoned;
}

/** 8 points around the boss, clamped into the room. Fixed order so tests can read it. */
function ringSlots(origin: Vec2): Vec2[] {
  const slots: Vec2[] = [];
  for (let slot = 0; slot < SUMMON_RING_SLOTS; slot += 1) {
    const angle = (slot * Math.PI * 2) / SUMMON_RING_SLOTS;
    slots.push(
      clampToRoom({
        x: origin.x + Math.cos(angle) * SUMMON_RING_RADIUS_TILES,
        y: origin.y + Math.sin(angle) * SUMMON_RING_RADIUS_TILES,
      }),
    );
  }
  return slots;
}

/**
 * First valid cell from `start`, walking in increasing angle. With no valid cell
 * it returns the cell farthest from the boss (ties go to the cell nearest `start`).
 */
function pickSlot(
  slots: readonly Vec2[],
  start: number,
  boss: Vec2,
  used: readonly Vec2[],
): Vec2 {
  let fallback: Vec2 = slots[0] ?? { x: boss.x, y: boss.y };
  let fallbackGap = -1;

  for (let offset = 0; offset < slots.length; offset += 1) {
    const slot = slots[(start + offset) % slots.length];
    if (slot === undefined) continue;

    const bossGap = distance(slot, boss);
    if (bossGap > fallbackGap) {
      fallback = slot;
      fallbackGap = bossGap;
    }

    if (bossGap < SUMMON_MIN_SEPARATION_TILES) continue;
    if (used.some((taken) => distance(slot, taken) < SUMMON_MIN_SEPARATION_TILES)) continue;
    return { x: slot.x, y: slot.y };
  }

  return { x: fallback.x, y: fallback.y };
}

function clampToRoom(point: Vec2): Vec2 {
  return {
    x: Math.min(Math.max(point.x, MIN_X), MAX_X),
    y: Math.min(Math.max(point.y, MIN_Y), MAX_Y),
  };
}
