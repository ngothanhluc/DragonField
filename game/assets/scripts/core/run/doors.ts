/**
 * Door choice after each normal room (M9, ticket #39, ADR-014).
 *
 * STUB written with the red acceptance test. The executor replaces the bodies; the exported names
 * and signatures are the agreed seam.
 */

/** What lies behind a door. `boss` is the single door after the last normal room. */
export type DoorReward = 'skill' | 'gold' | 'heal' | 'shop' | 'chest' | 'boss';

/** Rewards of a combat room (the room behind the door is a normal fight). */
export const COMBAT_REWARDS: readonly DoorReward[] = ['skill', 'gold'];

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
  void runSeed;
  void clearedRoom;
  void drawnNormalRooms;
  void enabled;
  return ['skill'];
}

/** The clear reward of room `room`: room 1 is always `skill`; later rooms take the chosen door's. */
export function clearRewardFor(room: number, chosenDoor: DoorReward | null): DoorReward {
  void room;
  void chosenDoor;
  return 'skill';
}
