/**
 * Ticket #63 acceptance: after a clear, the edge arrows point only at the **off-screen** doors and
 * each one carries that door's reward, so the HUD can show the same icon the door shows. A door
 * already on screen gets no arrow. A short "choose a door" hint shows for about two seconds.
 */
import { describe, expect, it } from 'vitest';
import { doorArrowTargets, doorHintVisible } from '../../assets/scripts/core/view/door-arrows';

describe('door arrows after a clear', () => {
  // Camera view: x 40..72, y 20..38 (one 32×18 screen) — the player stands in the middle.
  const view = { x: 40, y: 20, width: 32, height: 18 };
  const player = { x: 56, y: 29 };

  it('both doors off screen: one arrow per door, each with its reward kind, nearest first', () => {
    const doors = [
      { at: { x: 64, y: 71 }, reward: 'gold' as const },
      { at: { x: 64, y: 0.5 }, reward: 'xp' as const },
    ];
    expect(doorArrowTargets(player, view, doors)).toEqual([
      { x: 64, y: 0.5, reward: 'xp' },
      { x: 64, y: 71, reward: 'gold' },
    ]);
  });

  it('a door on screen gets no arrow; the off-screen one keeps its reward', () => {
    const doors = [
      { at: { x: 60, y: 30 }, reward: 'heal' as const },
      { at: { x: 100, y: 29 }, reward: 'shop' as const },
    ];
    expect(doorArrowTargets(player, view, doors)).toEqual([{ x: 100, y: 29, reward: 'shop' }]);
  });

  it('both doors on screen: no arrows at all', () => {
    const doors = [
      { at: { x: 45, y: 25 }, reward: 'xp' as const },
      { at: { x: 70, y: 36 }, reward: 'chest' as const },
    ];
    expect(doorArrowTargets(player, view, doors)).toEqual([]);
  });

  it('the single boss door gives a single arrow', () => {
    const doors = [{ at: { x: 10, y: 60 }, reward: 'boss' as const }];
    expect(doorArrowTargets(player, view, doors)).toEqual([{ x: 10, y: 60, reward: 'boss' }]);
  });
});

describe('choose-a-door hint', () => {
  it('shows right after the doors open and is gone after about two seconds', () => {
    expect(doorHintVisible(0)).toBe(true);
    expect(doorHintVisible(1500)).toBe(true);
    expect(doorHintVisible(3000)).toBe(false);
  });
});
