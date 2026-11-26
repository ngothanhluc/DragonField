import { describe, expect, it } from 'vitest';
import { ActionBuffer } from '../../assets/scripts/core/input/action-buffer';
import {
  DEFAULT_DASH_CONFIG,
  canStartDash,
  createDashState,
  dashCooldownSeconds,
  dashReadyRatio,
  dashVelocity,
  isDashInvulnerable,
  isDashing,
  resolveDashDirection,
  stepDash,
  tryStartDash,
  type DashConfig,
} from '../../assets/scripts/core/input/dash';

describe('Dash core state machine — cooldown, i-frames, velocity, and cooldownMult', () => {
  it('starts ready with zero velocity and full ready ratio', () => {
    const initial = createDashState();
    expect(canStartDash(initial)).toBe(true);
    expect(isDashing(initial)).toBe(false);
    expect(isDashInvulnerable(initial)).toBe(false);
    expect(dashReadyRatio(initial)).toBe(1);
    expect(dashCooldownSeconds(initial)).toBe(0);
    expect(dashVelocity(initial)).toEqual({ x: 0, y: 0 });
  });

  it('normalizes diagonal direction, grants brief i-frames on start, and locks velocity across durationMs', () => {
    const config: DashConfig = {
      cooldownMs: 1800,
      durationMs: 180,
      speedTilesPerSecond: 14,
      invulnerabilityMs: 220,
    };
    expect(DEFAULT_DASH_CONFIG).toEqual(config);

    const result = tryStartDash(createDashState(), { x: 3, y: -4 }, config, 1);
    expect(result.started).toBe(true);
    expect(result.invulnerabilityMs).toBe(220);

    let state = result.state;
    expect(isDashing(state)).toBe(true);
    expect(isDashInvulnerable(state)).toBe(true);
    expect(canStartDash(state)).toBe(false);
    expect(dashReadyRatio(state)).toBe(0);
    expect(dashCooldownSeconds(state)).toBeCloseTo(1.8, 6);

    // Direction is normalized (3-4-5 right triangle) so diagonal speed equals 14 tiles/s exactly.
    const vel = dashVelocity(state);
    expect(vel.x).toBeCloseTo(0.6 * 14, 6);
    expect(vel.y).toBeCloseTo(-0.8 * 14, 6);
    expect(Math.hypot(vel.x, vel.y)).toBeCloseTo(14, 6);

    // Optional speedMult scales dash velocity cleanly for Mobility skills (`afterimage`).
    const boostedVel = dashVelocity(state, 1.25);
    expect(Math.hypot(boostedVel.x, boostedVel.y)).toBeCloseTo(17.5, 6);

    // Cannot re-trigger dash while dashing or cooling down.
    expect(tryStartDash(state, { x: 1, y: 0 }, config).started).toBe(false);

    // Step 180 ms: dash motion finishes, 40 ms of dodge i-frames remain, cooldown is at 1620 ms.
    state = stepDash(state, 180);
    expect(isDashing(state)).toBe(false);
    expect(dashVelocity(state)).toEqual({ x: 0, y: 0 });
    expect(isDashInvulnerable(state)).toBe(true);
    expect(state.invulnerableRemainingMs).toBe(40);
    expect(dashReadyRatio(state)).toBeCloseTo(180 / 1800, 6);

    // Step 40 ms more: i-frames end cleanly; cooldown still ticking (1580 ms remaining).
    state = stepDash(state, 40);
    expect(isDashInvulnerable(state)).toBe(false);
    expect(canStartDash(state)).toBe(false);

    // Step remaining 1580 ms: dash becomes ready again!
    state = stepDash(state, 1580);
    expect(canStartDash(state)).toBe(true);
    expect(dashReadyRatio(state)).toBe(1);
    expect(dashCooldownSeconds(state)).toBe(0);
  });

  it('applies cooldownMult cleanly for Mobility/Dash skills and guards active duration when CDR is extreme', () => {
    const config: DashConfig = {
      cooldownMs: 2000,
      durationMs: 200,
      speedTilesPerSecond: 14,
      invulnerabilityMs: 240,
    };

    // 35% CDR (`cooldownMult = 0.65`) -> 1300 ms effective cooldown.
    const started = tryStartDash(createDashState(), { x: 1, y: 0 }, config, 0.65);
    expect(started.started).toBe(true);
    expect(started.state.cooldownTotalMs).toBeCloseTo(1300, 6);
    expect(started.state.cooldownRemainingMs).toBeCloseTo(1300, 6);

    const halfWay = stepDash(started.state, 650);
    expect(dashReadyRatio(halfWay)).toBeCloseTo(0.5, 6);
    expect(dashCooldownSeconds(halfWay)).toBeCloseTo(0.65, 6);

    const ready = stepDash(halfWay, 650);
    expect(canStartDash(ready)).toBe(true);
    expect(dashReadyRatio(ready)).toBe(1);

    // Extreme CDR (`cooldownMult = 0.05` -> 100 ms cooldown < 200 ms roll duration):
    // still cannot interrupt mid-roll until `durationMs` completes.
    const ultra = tryStartDash(ready, { x: 0, y: -1 }, config, 0.05);
    const midRoll = stepDash(ultra.state, 120);
    expect(midRoll.cooldownRemainingMs).toBe(0);
    expect(isDashing(midRoll)).toBe(true);
    expect(canStartDash(midRoll)).toBe(false);

    const postRoll = stepDash(midRoll, 80);
    expect(canStartDash(postRoll)).toBe(true);
  });

  it('resolves standstill dash direction from facing fallback and rejects raw zero-length vectors', () => {
    expect(tryStartDash(createDashState(), { x: 0, y: 0 }).started).toBe(false);

    const resolvedFromMove = resolveDashDirection({ x: -2, y: 0 }, { x: 0, y: 1 });
    expect(resolvedFromMove).toEqual({ x: -1, y: 0 });

    const resolvedFromFacing = resolveDashDirection({ x: 0, y: 0 }, { x: 0, y: -3 });
    expect(resolvedFromFacing).toEqual({ x: 0, y: -1 });

    const started = tryStartDash(createDashState(), resolvedFromFacing);
    expect(started.started).toBe(true);
    expect(started.state.direction).toEqual({ x: 0, y: -1 });
  });

  it('freezes on dtMs === 0 without allocating and executes a buffered Space press on the exact recovery tick', () => {
    const buffer = new ActionBuffer(150);
    let dash = tryStartDash(createDashState(), { x: 1, y: 0 }, DEFAULT_DASH_CONFIG, 1).state;

    // Advance to 1700 ms (100 ms left on 1800 ms cooldown).
    dash = stepDash(dash, 1700);
    expect(canStartDash(dash)).toBe(false);

    // Player presses Space 100 ms early -> buffered!
    buffer.press('dash');

    // Pause / hitstop frame (dtMs = 0) returns exact reference and preserves both timers.
    const frozen = stepDash(dash, 0);
    buffer.step(0);
    expect(frozen).toBe(dash);
    expect(buffer.remainingMs('dash')).toBe(150);

    // Step across 16 ms frames; on the frame cooldown hits 0 (7th frame = 112 ms < 150 ms buffer),
    // the buffered dash fires automatically and only once!
    let autoTriggeredCount = 0;
    for (let frame = 0; frame < 10; frame += 1) {
      dash = stepDash(dash, 16);
      buffer.step(16);
      if (canStartDash(dash) && buffer.consume('dash')) {
        const next = tryStartDash(dash, { x: 0, y: 1 }, DEFAULT_DASH_CONFIG, 1);
        if (next.started) {
          dash = next.state;
          autoTriggeredCount += 1;
        }
      }
    }
    expect(autoTriggeredCount).toBe(1);
    expect(isDashing(dash)).toBe(true);
    expect(buffer.has('dash')).toBe(false);

    expect(() => stepDash(dash, -1)).toThrow();
    expect(() => stepDash(dash, Number.NaN)).toThrow();
  });
});
