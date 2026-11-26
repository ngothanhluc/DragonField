/**
 * Single North Portal & mid-chapter Special Room cadence (M17, ADR-025 — revises ADR-014).
 *
 * After clearing any combat room, **only 1 North Portal** opens at the top-centre edge of the
 * room (`northDoorPosition`). Chapter progression follows a clean 9-room cadence:
 * - Rooms 1–4: combat rooms connected via a jade/cyan North Portal (`'xp'`).
 * - After Room 4: North Portal glows warm gold and leads automatically to **1 mid-chapter
 *   Special Room** (seeded deterministic choice of `'shop'` or `'chest'`), whose exit portal
 *   leads into Room 5.
 * - Rooms 5–8: combat rooms scaling up in enemy density.
 * - After Room 8 (last normal room): North Portal ignites as the crimson **Boss Portal** (`'boss'`)
 *   leading into Room 9 (Chapter Boss).
 */
import { TUNING } from '../enemies/tuning';
import type { LevelData } from '../level/level-data';
import type { Vec2 } from '../math/vec2';
import { SeededRng } from '../rng';

/** What lies behind a portal. `boss` is the crimson portal after the last normal room. */
export type DoorReward = 'xp' | 'gold' | 'heal' | 'shop' | 'chest' | 'boss';

/** Destination visual category for color-coded North Portal VFX & edge pointer arrows (M17). */
export type PortalDestinationKind = 'normal' | 'special' | 'boss';

/** Rewards of a combat room (the room behind the portal is a normal fight). */
export const COMBAT_REWARDS: readonly DoorReward[] = ['xp', 'gold'];

/** A reward that has a weight in the config (everything but the boss portal). */
type WeightedReward = Exclude<DoorReward, 'boss'>;

/** Every reward a portal can represent, specials included. */
export const DOOR_REWARDS: readonly WeightedReward[] = ['xp', 'gold', 'heal', 'shop', 'chest'];

/** Mid-chapter special room pool offered automatically after Room 4 (M17, ADR-025). */
export const MID_CHAPTER_SPECIAL_POOL: readonly WeightedReward[] = ['shop', 'chest'];

/** Seed offset of the portal draw, so it never reuses the room draw or combat streams. */
const DOOR_SEED_SALT = 0x85ebca6b;
const DOOR_ROOM_SALT = 0x9e3779b1;
const DOOR_TOTAL_SALT = 0xc2b2ae35;

function weightOf(reward: WeightedReward): number {
  const weights: Readonly<Record<WeightedReward, number>> = TUNING.doors.weights;
  return weights[reward] ?? 0;
}

/** One weighted pick from `pool`; falls back to uniform pick if all weights are 0. */
function weightedPick(rng: SeededRng, pool: readonly WeightedReward[]): WeightedReward {
  const first = pool[0];
  if (first === undefined) return 'shop';
  if (pool.length === 1) return first;

  const weights = pool.map((reward) => weightOf(reward));
  if (weights.every((weight) => weight <= 0)) return rng.pick(pool);
  return pool[rng.weightedIndex(weights)] ?? first;
}

/**
 * Normal room index (1-based) after which the mid-chapter Special Room portal automatically opens.
 * For the standard 8 normal rooms per chapter this is Room `4` (between Rooms 1–4 and Rooms 5–8).
 */
export function midChapterSpecialAfterRoom(drawnNormalRooms: number): number {
  if (!Number.isInteger(drawnNormalRooms) || drawnNormalRooms < 2) return 0;
  return Math.floor(drawnNormalRooms / 2);
}

/** Classify a portal destination for color-coded Portal VFX & edge arrows (M17). */
export function portalDestinationKind(reward: DoorReward): PortalDestinationKind {
  if (reward === 'boss') return 'boss';
  if (reward === 'shop' || reward === 'chest' || reward === 'heal') return 'special';
  return 'normal';
}

/**
 * Resolve the single North Portal position (tile units, y down) for `level`.
 * Picks the authored door spot closest to the North edge (smallest `at.y`); falls back to
 * top-centre `{ x: cols / 2, y: 0.5 }` when a room fixture defines no doors.
 */
export function northDoorPosition(level: Pick<LevelData, 'size' | 'doors'>): Vec2 {
  const doors = level.doors;
  if (doors.length === 0) {
    return { x: level.size.cols / 2, y: 0.5 };
  }
  let best = doors[0]!;
  for (let index = 1; index < doors.length; index += 1) {
    const candidate = doors[index];
    if (candidate !== undefined && candidate.at.y < best.at.y) {
      best = candidate;
    }
  }
  return { x: best.at.x, y: best.at.y };
}

/**
 * The single North Portal offered after clearing normal room `clearedRoom` (1-based) of a run
 * with `drawnNormalRooms` normal rooms (M17, ADR-025):
 * - After the last normal room (`clearedRoom >= drawnNormalRooms`, e.g. Room 8): `['boss']`.
 * - After the mid-chapter room (`clearedRoom === floor(drawnNormalRooms / 2)`, e.g. Room 4)
 *   when special rooms are enabled in `enabled`: seeded choice `['shop']` or `['chest']`.
 * - Otherwise (Rooms 1–3, 5–7): single normal combat portal `['xp']` (or `['gold']` if `'xp'`
 *   was omitted from `enabled`).
 *
 * Always returns length `1`, pure and deterministic.
 */
export function doorOffers(
  runSeed: number,
  clearedRoom: number,
  drawnNormalRooms: number,
  enabled: readonly DoorReward[],
): DoorReward[] {
  if (!Number.isInteger(clearedRoom) || clearedRoom < 1) return ['boss'];
  if (!Number.isInteger(drawnNormalRooms) || drawnNormalRooms < 1) return ['boss'];
  if (clearedRoom >= drawnNormalRooms) return ['boss'];

  const specialAfter = midChapterSpecialAfterRoom(drawnNormalRooms);
  if (clearedRoom === specialAfter) {
    const specialPool = MID_CHAPTER_SPECIAL_POOL.filter((reward) => enabled.includes(reward));
    const fallbackHeal =
      specialPool.length === 0 && enabled.includes('heal') ? (['heal'] as const) : [];
    const pool = specialPool.length > 0 ? specialPool : fallbackHeal;
    if (pool.length > 0) {
      const rng = new SeededRng(
        (Math.trunc(runSeed) >>> 0) ^
          Math.imul(Math.trunc(clearedRoom), DOOR_ROOM_SALT) ^
          Math.imul(Math.trunc(drawnNormalRooms), DOOR_TOTAL_SALT) ^
          DOOR_SEED_SALT,
      );
      return [weightedPick(rng, pool)];
    }
  }

  if (enabled.includes('xp')) return ['xp'];
  if (enabled.includes('gold')) return ['gold'];
  return ['xp'];
}

/** The clear reward of room `room`: room 1 is always `xp`; later rooms take the chosen portal's. */
export function clearRewardFor(room: number, chosenDoor: DoorReward | null): DoorReward {
  if (room <= 1) return 'xp';
  if (chosenDoor === null || chosenDoor === 'boss') return 'xp';
  return chosenDoor;
}
