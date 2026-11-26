/**
 * Pure Dash state machine, cooldown scaling, brief i-frames, and velocity math (M13, ADR-022).
 *
 * Dash locks a normalized movement direction for `durationMs` at `speedTilesPerSecond`, grants a
 * short `invulnerabilityMs` dodge window on start, and starts a `cooldownMs * cooldownMult`
 * recharge timer so Mobility/Dash skills (`phantom-dash`, `shadowstep`, `afterimage`) scale
 * cleanly in both headless simulation and Cocos gameplay.
 *
 * Pure TypeScript — zero `cc` imports.
 */
import type { Vec2 } from '../math/vec2';

export interface DashConfig {
  /** Base cooldown between dashes before `cooldownMult`, milliseconds. */
  readonly cooldownMs: number;
  /** Active roll/dash motion duration, milliseconds. */
  readonly durationMs: number;
  /** Dash travel speed while `isDashing(state)` is true, tiles/second. */
  readonly speedTilesPerSecond: number;
  /** Brief dodge invulnerability granted when a dash starts, milliseconds. */
  readonly invulnerabilityMs: number;
}

export const DEFAULT_DASH_CONFIG: DashConfig = {
  cooldownMs: 1800,
  durationMs: 180,
  speedTilesPerSecond: 14,
  invulnerabilityMs: 220,
};

export interface DashState {
  /** Remaining active dash movement time, ms (`> 0` while mid-dash). */
  readonly activeRemainingMs: number;
  /** Total duration of the current/last dash, ms. */
  readonly durationMs: number;
  /** Remaining cooldown time before the next dash can start, ms (`0` when ready). */
  readonly cooldownRemainingMs: number;
  /** Effective total cooldown of the last dash (`cooldownMs * cooldownMult`), ms. */
  readonly cooldownTotalMs: number;
  /** Remaining dash-granted i-frame time, ms (`> 0` while dodge i-frames hold). */
  readonly invulnerableRemainingMs: number;
  /** Unit direction locked at dash start (defaults to `{ x: 0, y: 1 }` before first dash). */
  readonly direction: Vec2;
  /** Locked travel speed in tiles/second for the active dash. */
  readonly speedTilesPerSecond: number;
}

export interface StartDashResult {
  readonly started: boolean;
  readonly state: DashState;
  /** Dodge i-frame duration granted on this frame (`> 0` only when `started === true`). */
  readonly invulnerabilityMs: number;
}

const MIN_DIRECTION_LENGTH = 1e-6;
const DEFAULT_DIRECTION: Vec2 = { x: 0, y: 1 };

function normalizeDirection(dir: Vec2): Vec2 | null {
  if (!Number.isFinite(dir.x) || !Number.isFinite(dir.y)) return null;
  const length = Math.hypot(dir.x, dir.y);
  if (!Number.isFinite(length) || length < MIN_DIRECTION_LENGTH) return null;
  return { x: dir.x / length, y: dir.y / length };
}

/** Construct a fresh, ready-to-use `DashState`. */
export function createDashState(initialDirection: Vec2 = DEFAULT_DIRECTION): DashState {
  const unit = normalizeDirection(initialDirection) ?? DEFAULT_DIRECTION;
  return {
    activeRemainingMs: 0,
    durationMs: 0,
    cooldownRemainingMs: 0,
    cooldownTotalMs: 0,
    invulnerableRemainingMs: 0,
    direction: unit,
    speedTilesPerSecond: 0,
  };
}

export const initialDashState = createDashState;

/**
 * Resolve the unit direction for a dash: uses `moveDir` when the player is holding a movement key,
 * falling back to `fallbackDir` (e.g. current facing vector) when dashing from a standstill.
 */
export function resolveDashDirection(
  moveDir: Vec2,
  fallbackDir: Vec2 = DEFAULT_DIRECTION,
): Vec2 {
  return normalizeDirection(moveDir) ?? normalizeDirection(fallbackDir) ?? DEFAULT_DIRECTION;
}

/** True while the player is actively mid-dash (`activeRemainingMs > 0`). */
export function isDashing(state: DashState): boolean {
  return state.activeRemainingMs > 0;
}

/** True while the dash's own dodge i-frame window is still active. */
export function isDashInvulnerable(state: DashState): boolean {
  return state.invulnerableRemainingMs > 0;
}

/** True when neither mid-dash nor waiting on cooldown. */
export function canStartDash(state: DashState): boolean {
  return state.activeRemainingMs <= 0 && state.cooldownRemainingMs <= 0;
}

/**
 * Attempt to start a dash along `dir` using `config` and optional skill `cooldownMult`.
 *
 * Fails cleanly (`started: false`, `invulnerabilityMs: 0`, unchanged `state`) if already mid-dash,
 * still cooling down, `dir` has zero length, or `config` has non-positive duration/speed.
 */
export function tryStartDash(
  state: DashState,
  dir: Vec2,
  config: DashConfig = DEFAULT_DASH_CONFIG,
  cooldownMult = 1,
): StartDashResult {
  if (!canStartDash(state)) {
    return { started: false, state, invulnerabilityMs: 0 };
  }
  if (
    !Number.isFinite(config.durationMs) ||
    config.durationMs <= 0 ||
    !Number.isFinite(config.speedTilesPerSecond) ||
    config.speedTilesPerSecond <= 0
  ) {
    return { started: false, state, invulnerabilityMs: 0 };
  }

  const unitDir = normalizeDirection(dir);
  if (unitDir === null) {
    return { started: false, state, invulnerabilityMs: 0 };
  }

  const safeCooldownBase = Number.isFinite(config.cooldownMs) ? Math.max(0, config.cooldownMs) : 0;
  const safeMult = Number.isFinite(cooldownMult) ? Math.max(0, cooldownMult) : 1;
  const effectiveCooldownMs = safeCooldownBase * safeMult;
  const invulnerabilityMs = Number.isFinite(config.invulnerabilityMs)
    ? Math.max(0, config.invulnerabilityMs)
    : 0;

  return {
    started: true,
    invulnerabilityMs,
    state: {
      activeRemainingMs: config.durationMs,
      durationMs: config.durationMs,
      cooldownRemainingMs: effectiveCooldownMs,
      cooldownTotalMs: effectiveCooldownMs,
      invulnerableRemainingMs: invulnerabilityMs,
      direction: unitDir,
      speedTilesPerSecond: config.speedTilesPerSecond,
    },
  };
}

/**
 * Advance active dash duration, dodge i-frames, and cooldown by `dtMs` of simulation time.
 *
 * Returns `state` unchanged (zero allocation) when `dtMs === 0` or all timers are already at `0`.
 */
export function stepDash(state: DashState, dtMs: number): DashState {
  if (!Number.isFinite(dtMs) || dtMs < 0) {
    throw new Error(`stepDash needs a finite dtMs >= 0, got ${dtMs}`);
  }
  if (
    dtMs === 0 ||
    (state.activeRemainingMs <= 0 &&
      state.cooldownRemainingMs <= 0 &&
      state.invulnerableRemainingMs <= 0)
  ) {
    return state;
  }

  return {
    ...state,
    activeRemainingMs: Math.max(0, state.activeRemainingMs - dtMs),
    cooldownRemainingMs: Math.max(0, state.cooldownRemainingMs - dtMs),
    invulnerableRemainingMs: Math.max(0, state.invulnerableRemainingMs - dtMs),
  };
}

/**
 * Current dash velocity in tiles/second (`{ x: 0, y: 0 }` when not mid-dash).
 * Optional `speedMult` allows Mobility skills (`afterimage`) to scale dash travel speed cleanly.
 */
export function dashVelocity(state: DashState, speedMult = 1): Vec2 {
  if (!isDashing(state)) {
    return { x: 0, y: 0 };
  }
  const safeMult = Number.isFinite(speedMult) && speedMult > 0 ? speedMult : 1;
  const speed = state.speedTilesPerSecond * safeMult;
  return {
    x: state.direction.x * speed,
    y: state.direction.y * speed,
  };
}

/**
 * Cooldown readiness ratio in `[0, 1]` (`1` when ready to dash, `0 → 1` while recharging).
 */
export function dashReadyRatio(state: DashState): number {
  if (!Number.isFinite(state.cooldownRemainingMs) || state.cooldownRemainingMs <= 0) {
    return 1;
  }
  if (!Number.isFinite(state.cooldownTotalMs) || state.cooldownTotalMs <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, 1 - state.cooldownRemainingMs / state.cooldownTotalMs));
}

/** Remaining dash cooldown in seconds (`0` when ready). */
export function dashCooldownSeconds(state: DashState): number {
  if (!Number.isFinite(state.cooldownRemainingMs) || state.cooldownRemainingMs <= 0) {
    return 0;
  }
  return state.cooldownRemainingMs / 1000;
}
