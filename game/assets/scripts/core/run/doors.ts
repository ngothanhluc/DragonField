/**
 * Door choice after each normal room (M9 ticket #39, ADR-014; M12 ADR-021 `'skill'` → `'xp'`).
 *
 * After clearing normal room R the player sees two doors, each carrying the reward of the
 * **next** room; walking into one picks it. Room 1's clear defaults to `'xp'` (standard XP
 * progression; skills come exclusively from XP level-ups per ADR-021), so the first door offer
 * shapes room 2. The last normal room offers a single boss door instead.
 */
import { TUNING } from '../enemies/tuning';
import { SeededRng } from '../rng';

/** What lies behind a door. `boss` is the single door after the last normal room. */
export type DoorReward = 'xp' | 'gold' | 'heal' | 'shop' | 'chest' | 'boss';

/** Rewards of a combat room (the room behind the door is a normal fight). */
export const COMBAT_REWARDS: readonly DoorReward[] = ['xp', 'gold'];

/** A reward that has a weight in the config (everything but the boss door). */
type WeightedReward = Exclude<DoorReward, 'boss'>;

/** Every reward a door can offer, specials included (#40 ships the rooms behind them). */
export const DOOR_REWARDS: readonly WeightedReward[] = ['xp', 'gold', 'heal', 'shop', 'chest'];

/** Seed offset of the door draw, so it never reuses the room draw or combat streams. */
const DOOR_SEED_SALT = 0x85ebca6b;
const DOOR_ROOM_SALT = 0x9e3779b1;
const DOOR_TOTAL_SALT = 0xc2b2ae35;

function isCombatReward(reward: DoorReward): boolean {
  return COMBAT_REWARDS.includes(reward);
}

function weightOf(reward: WeightedReward): number {
  const weights: Readonly<Record<WeightedReward, number>> = TUNING.doors.weights;
  return weights[reward] ?? 0;
}

/** One weighted pick from `pool`; a pooled reward with weight 0 never comes up. */
function weightedPick(rng: SeededRng, pool: readonly WeightedReward[]): WeightedReward {
  const first = pool[0];
  if (first === undefined) return 'xp';
  if (pool.length === 1) return first;

  const weights = pool.map((reward) => weightOf(reward));
  if (weights.every((weight) => weight <= 0)) return rng.pick(pool);
  return pool[rng.weightedIndex(weights)] ?? first;
}

/**
 * The doors shown after clearing normal room `clearedRoom` (1-based) of a run with
 * `drawnNormalRooms` normal rooms: two doors drawn by seed from `enabled` with at least one
 * combat door, or the single `boss` door after the last normal room. Pure and deterministic.
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

  // Keep the configured order, drop the boss door and duplicates.
  const pool: WeightedReward[] = [];
  for (const reward of DOOR_REWARDS) {
    if (!enabled.includes(reward)) continue;
    if (weightOf(reward) <= 0) continue;
    pool.push(reward);
  }
  // A misconfigured offer list must not lock the run: fall back to the two combat doors.
  if (pool.length === 0) return [...COMBAT_REWARDS];

  const rng = new SeededRng(
    (Math.trunc(runSeed) >>> 0) ^
      Math.imul(Math.trunc(clearedRoom), DOOR_ROOM_SALT) ^
      Math.imul(Math.trunc(drawnNormalRooms), DOOR_TOTAL_SALT) ^
      DOOR_SEED_SALT,
  );

  const first = weightedPick(rng, pool);
  const combat = pool.filter((reward) => isCombatReward(reward));

  // At least one door must lead to a fight: an offer that starts with a special forces the
  // other door to be combat. Otherwise the second door never repeats the first (two xp
  // doors would make the choice meaningless).
  const withoutFirst = pool.filter((reward) => reward !== first);
  const candidates = isCombatReward(first) ? withoutFirst : combat;
  const secondPool =
    candidates.length > 0 ? candidates : withoutFirst.length > 0 ? withoutFirst : pool;

  return [first, weightedPick(rng, secondPool)];
}

/** The clear reward of room `room`: room 1 is always `xp`; later rooms take the chosen door's. */
export function clearRewardFor(room: number, chosenDoor: DoorReward | null): DoorReward {
  if (room <= 1) return 'xp';
  if (chosenDoor === null || chosenDoor === 'boss') return 'xp';
  return chosenDoor;
}
