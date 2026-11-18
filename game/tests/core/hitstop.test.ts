import { describe, expect, it } from 'vitest';
import { HitstopClock } from '../../assets/scripts/core/combat/hitstop';
import { isTelegraphElapsed } from '../../assets/scripts/core/combat/telegraph';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { HealthState } from '../../assets/scripts/core/combat/health';

/** Simulation loop at 16 ms/frame, same as `core/sim/run-simulation.ts`. */
const FRAME_MS = 16;

describe('HitstopClock — freezes simulation time', () => {
  it('the first 70 ms run no simulation, then it runs normally', () => {
    const clock = new HitstopClock(DEFAULT_COMBAT.enemyHitstopMs);
    expect(DEFAULT_COMBAT.enemyHitstopMs).toBe(70);

    clock.request();

    let simulationMs = 0;
    let realMs = 0;
    const advances: number[] = [];
    while (realMs < 160) {
      const sim = clock.step(FRAME_MS);
      realMs += FRAME_MS;
      simulationMs += sim;
      advances.push(sim);
    }

    // The first 70 ms are eaten (4 frames × 16 = 64, the 5th frame returns the remaining 10 ms).
    expect(advances.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(advances[4]).toBe(10);
    // Total simulation = real time − 70 ms, with no frame lost.
    expect(simulationMs).toBe(realMs - 70);
    expect(clock.isFrozen).toBe(false);
  });

  it('overlapping requests take the max instead of stacking to 140 ms', () => {
    const clock = new HitstopClock(70);
    clock.request();
    clock.request();
    clock.request();

    expect(clock.remaining).toBe(70);
  });

  it('a real frame longer than the remainder loses no time', () => {
    const clock = new HitstopClock(70);
    clock.request();

    expect(clock.step(50)).toBe(0);
    // 20 ms of freeze left; a 50 ms frame returns 30 ms of simulation.
    expect(clock.step(50)).toBe(30);
    expect(clock.remaining).toBe(0);
  });

  it('a request while frozen extends to max(remaining, request)', () => {
    const clock = new HitstopClock(70);
    clock.request(70);
    clock.step(30);
    expect(clock.remaining).toBe(40);

    clock.request(70);
    expect(clock.remaining).toBe(70);
  });

  it('reset drops the freeze; request(0) does nothing', () => {
    const clock = new HitstopClock(70);
    clock.request(70);
    clock.reset();
    expect(clock.isFrozen).toBe(false);
    expect(clock.step(16)).toBe(16);

    clock.request(0);
    expect(clock.isFrozen).toBe(false);
  });

  it('negative or non-finite parameters are rejected', () => {
    expect(() => new HitstopClock(-1)).toThrow();
    expect(() => new HitstopClock(Number.NaN)).toThrow();

    const clock = new HitstopClock(70);
    expect(() => clock.request(-1)).toThrow();
    expect(() => clock.step(-1)).toThrow();
  });
});

describe('hitstop does not desync timers (telegraph, i-frame)', () => {
  it('telegraph and i-frame both stand still during hitstop, then continue together', () => {
    const clock = new HitstopClock(70);
    const health = new HealthState(DEFAULT_COMBAT);
    const telegraphStartedMs = 1000;

    // One simulation clock shared by every system, exactly like `CombatLoop`.
    let nowMs = telegraphStartedMs;
    const telegraphTotalMs = 500;

    health.tryDamage(1, nowMs);
    expect(health.isInvulnerable(nowMs + 100)).toBe(true);

    // The player just hit an enemy ⇒ hitstop; the next 4 frames run no simulation.
    clock.request();
    for (let frame = 0; frame < 4; frame += 1) {
      const simMs = clock.step(FRAME_MS);
      nowMs += simMs;
    }

    // 64 ms of real time pass but nowMs barely moves.
    expect(nowMs).toBe(telegraphStartedMs);
    expect(isTelegraphElapsed(telegraphStartedMs, nowMs, telegraphTotalMs)).toBe(false);
    expect(health.isInvulnerable(nowMs)).toBe(true);

    // Run on until both the telegraph and the i-frame (800 ms) finish, on **one**
    // clock — no system is "faster" because of hitstop.
    let realMs = 0;
    const targetMs = Math.max(telegraphTotalMs, DEFAULT_COMBAT.invulnerabilityMs + 1);
    while (nowMs - telegraphStartedMs < targetMs) {
      nowMs += clock.step(FRAME_MS);
      realMs += FRAME_MS;
    }

    expect(isTelegraphElapsed(telegraphStartedMs, nowMs, telegraphTotalMs)).toBe(true);
    expect(health.isInvulnerable(nowMs + 1)).toBe(false);
    // Real time = simulation time + 70 ms hitstop (rounded up to a frame).
    expect(realMs).toBeGreaterThanOrEqual(targetMs);
    expect(realMs).toBeLessThanOrEqual(targetMs + 70 + FRAME_MS);
  });
});
