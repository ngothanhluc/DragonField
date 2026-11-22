/**
 * Door arrows after a room clear (#63): which doors the HUD edge arrows point at, and how long
 * the "choose a door" hint stays up.
 *
 * Same fairness rule as the enemy arrows of #41: only what the player cannot see gets an arrow.
 * An off-screen door keeps its reward, so the HUD can draw the exact icon the door shows.
 */
import type { ViewRect } from '../camera/follow-camera';
import { DOORS_TUNING } from '../enemies/tuning';
import { distance, type Vec2 } from '../math/vec2';
import type { DoorReward } from '../run/doors';
import { insideViewRect } from './view-rect';

/** A door the room offers: where it stands (tiles) and the reward behind it. */
export interface DoorArrowSource {
  readonly at: Vec2;
  readonly reward: DoorReward;
}

/** One edge arrow toward an off-screen door, carrying that door's reward. */
export interface DoorArrowTarget {
  readonly x: number;
  readonly y: number;
  readonly reward: DoorReward;
}

/**
 * Off-screen doors only, nearest to the player first, at most `max`. A door on screen already
 * shows its reward icon, so it needs no arrow (#41's `insideViewRect` rule).
 */
export function doorArrowTargets(
  player: Vec2,
  view: ViewRect,
  doors: readonly DoorArrowSource[],
  max = 3,
): DoorArrowTarget[] {
  const limit = Math.max(0, Math.floor(max));
  if (limit === 0) return [];

  return doors
    .filter((door) => !insideViewRect(door.at, view))
    .map((door) => ({ door, gap: distance(door.at, player) }))
    .sort((a, b) => a.gap - b.gap)
    .slice(0, limit)
    .map(({ door }) => ({ x: door.at.x, y: door.at.y, reward: door.reward }));
}

/** The "choose a door" hint: up right when the doors open, gone after `doors.hintMs`. */
export function doorHintVisible(elapsedMs: number): boolean {
  return elapsedMs >= 0 && elapsedMs < DOORS_TUNING.hintMs;
}
