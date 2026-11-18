import { describe, expect, it } from 'vitest';
import { AutoFire } from '../../assets/scripts/core/combat/auto-fire';
import { FireControl } from '../../assets/scripts/core/combat/fire-control';
import type { Targetable } from '../../assets/scripts/core/combat/targeting';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';

const ORIGIN: Vec2 = { x: 0, y: 0 };

function enemy(id: string, x: number, y: number, alive = true): Targetable {
  return { id, position: { x, y }, alive };
}

describe('AutoFire', () => {
  it('with no target it does not fire and does not spend cooldown', () => {
    const autoFire = AutoFire.fromRate(2);

    expect(autoFire.update({ deltaMs: 5_000, origin: ORIGIN, targets: [], rangeTiles: 10 })).toBeNull();

    // If the cooldown drained while there was no target, this shot would be missed.
    const shot = autoFire.update({
      deltaMs: 0,
      origin: ORIGIN,
      targets: [enemy('a', 3, 0)],
      rangeTiles: 10,
    });

    expect(shot).not.toBeNull();
    expect(shot?.targetId).toBe('a');
  });

  it('fires at a target in range with a unit direction and the right origin', () => {
    const autoFire = AutoFire.fromRate(2);

    const shot = autoFire.update({
      deltaMs: 0,
      origin: ORIGIN,
      targets: [enemy('bat-1', 3, 4)],
      rangeTiles: 10,
    });

    expect(shot).not.toBeNull();
    expect(shot?.targetId).toBe('bat-1');
    expect(shot?.origin).toEqual(ORIGIN);
    expect(shot?.direction.x).toBeCloseTo(0.6, 10);
    expect(shot?.direction.y).toBeCloseTo(0.8, 10);
    expect(Math.hypot(shot?.direction.x ?? 0, shot?.direction.y ?? 0)).toBeCloseTo(1, 10);
  });

  it('picks the nearest enemy in range', () => {
    const autoFire = AutoFire.fromRate(2);

    const shot = autoFire.update({
      deltaMs: 0,
      origin: ORIGIN,
      targets: [enemy('xa', 6, 0), enemy('gan', 2, 0), enemy('trung-binh', 4, 0)],
      rangeTiles: 10,
    });

    expect(shot?.targetId).toBe('gan');
    expect(shot?.direction).toEqual({ x: 1, y: 0 });
  });

  it('does not fire when the target is out of range', () => {
    const autoFire = AutoFire.fromRate(2);

    const outOfRange = autoFire.update({
      deltaMs: 0,
      origin: ORIGIN,
      targets: [enemy('xa', 11, 0)],
      rangeTiles: 10,
    });
    expect(outOfRange).toBeNull();

    // The cooldown is still full: it fires as soon as the target enters range.
    const inRange = autoFire.update({
      deltaMs: 0,
      origin: ORIGIN,
      targets: [enemy('xa', 9, 0)],
      rangeTiles: 10,
    });
    expect(inRange?.targetId).toBe('xa');
  });

  it('limits the fire rate through FireControl', () => {
    const autoFire = new AutoFire(FireControl.fromRate(2));
    const targets = [enemy('a', 1, 0)];
    const args = { origin: ORIGIN, targets, rangeTiles: 10 };

    expect(autoFire.update({ ...args, deltaMs: 0 })).not.toBeNull();
    expect(autoFire.update({ ...args, deltaMs: 250 })).toBeNull();
    expect(autoFire.update({ ...args, deltaMs: 249 })).toBeNull();
    expect(autoFire.update({ ...args, deltaMs: 1 })).not.toBeNull();
  });

  it('accepts the fire rate per second directly in the constructor', () => {
    const autoFire = new AutoFire(4); // 250 ms
    const args = { origin: ORIGIN, targets: [enemy('a', 1, 0)], rangeTiles: 10 };

    expect(autoFire.update({ ...args, deltaMs: 0 })).not.toBeNull();
    expect(autoFire.update({ ...args, deltaMs: 200 })).toBeNull();
    expect(autoFire.update({ ...args, deltaMs: 50 })).not.toBeNull();
  });

  it('does not fire when the target dies mid-sequence', () => {
    const autoFire = AutoFire.fromRate(2);

    expect(
      autoFire.update({
        deltaMs: 0,
        origin: ORIGIN,
        targets: [enemy('a', 2, 0)],
        rangeTiles: 10,
      }),
    ).not.toBeNull();

    const dead = enemy('a', 2, 0, false);
    expect(
      autoFire.update({ deltaMs: 600, origin: ORIGIN, targets: [dead], rangeTiles: 10 }),
    ).toBeNull();
    expect(
      autoFire.update({ deltaMs: 600, origin: ORIGIN, targets: [dead], rangeTiles: 10 }),
    ).toBeNull();

    // No living target so the cooldown is not spent: it fires as soon as a new target appears.
    const fresh = autoFire.update({
      deltaMs: 600,
      origin: ORIGIN,
      targets: [dead, enemy('b', 3, 0)],
      rangeTiles: 10,
    });
    expect(fresh?.targetId).toBe('b');
  });

  it('uses the default direction when the origin coincides with the target', () => {
    const autoFire = AutoFire.fromRate(2);

    const shot = autoFire.update({
      deltaMs: 0,
      origin: ORIGIN,
      targets: [enemy('a', 0, 0)],
      rangeTiles: 10,
    });

    expect(shot?.direction).toEqual({ x: 1, y: 0 });
  });
});
