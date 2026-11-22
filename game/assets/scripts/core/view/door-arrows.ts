/**
 * Door arrows after a room clear (#63): which doors the HUD edge arrows point at, and how long
 * the "choose a door" hint stays up. Stub — ticket #63 implements it.
 */
import type { ViewRect } from '../camera/follow-camera';
import type { Vec2 } from '../math/vec2';
import type { DoorReward } from '../run/doors';

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

export function doorArrowTargets(
  _player: Vec2,
  _view: ViewRect,
  _doors: readonly DoorArrowSource[],
  _max = 3,
): DoorArrowTarget[] {
  return [];
}

export function doorHintVisible(_elapsedMs: number): boolean {
  return false;
}
