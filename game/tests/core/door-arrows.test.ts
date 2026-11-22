import { describe, expect, it } from 'vitest';
import { DOORS_TUNING } from '../../assets/scripts/core/enemies/tuning';
import {
  doorArrowTargets,
  doorHintVisible,
  type DoorArrowSource,
} from '../../assets/scripts/core/view/door-arrows';

/** The acceptance test is the contract; these lock the two rules it does not spell out. */
describe('doorArrowTargets — limits', () => {
  const view = { x: 0, y: 0, width: 32, height: 18 };
  const player = { x: 16, y: 9 };
  const offScreen: DoorArrowSource[] = [
    { at: { x: 16, y: 40 }, reward: 'skill' },
    { at: { x: 16, y: -20 }, reward: 'gold' },
    { at: { x: -10, y: 9 }, reward: 'heal' },
    { at: { x: 50, y: 9 }, reward: 'chest' },
  ];

  it('keeps only the nearest `max` doors', () => {
    const targets = doorArrowTargets(player, view, offScreen, 2);
    expect(targets).toEqual([
      { x: -10, y: 9, reward: 'heal' },
      { x: 16, y: -20, reward: 'gold' },
    ]);
  });

  it('max 0 or a negative max asks for no arrows', () => {
    expect(doorArrowTargets(player, view, offScreen, 0)).toEqual([]);
    expect(doorArrowTargets(player, view, offScreen, -2)).toEqual([]);
  });
});

describe('doorHintVisible — timing comes from the config', () => {
  it('lasts exactly doors.hintMs, and never shows before the doors open', () => {
    expect(doorHintVisible(-1)).toBe(false);
    expect(doorHintVisible(DOORS_TUNING.hintMs - 1)).toBe(true);
    expect(doorHintVisible(DOORS_TUNING.hintMs)).toBe(false);
  });
});
