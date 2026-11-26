/**
 * Game-time discrete action buffer and IME-safe action key mapping (M13, ADR-022).
 *
 * Discrete player presses (`Dash` on `Space`, `Signature Active` on `KeyE` / Right-Click) often
 * land slightly before cooldown recovery finishes. Storing presses in a short **game-time** window
 * (`DEFAULT_ACTION_BUFFER_MS = 150`) makes controls feel responsive without loosening cooldowns:
 *
 * - Time advances **only** through `step(dtMs)` driven by the simulation clock, so buffered inputs
 *   freeze automatically during pause, level-up modals, and 70 ms hitstop (`HitstopClock`).
 * - A buffered press expires cleanly once `windowMs` of simulation time elapses.
 * - `consume(kind)` clears the slot immediately so one physical press fires **at most once**.
 *
 * Pure TypeScript — zero `cc` or DOM imports.
 */
import { IME_PROCESS_KEY_CODE, type KeyIdentity } from '../movement/move-keys';

export type ActionKind = 'dash' | 'active';

export const ACTION_KINDS = ['dash', 'active'] as const satisfies readonly ActionKind[];

/** Default game-time buffer window in milliseconds (ADR-022 / `input-systems`). */
export const DEFAULT_ACTION_BUFFER_MS = 150;

/** Standard `MouseEvent.button` code for secondary (right) click. */
export const RIGHT_MOUSE_BUTTON = 2;

const ACTION_BY_CODE: Readonly<Record<string, ActionKind>> = {
  Space: 'dash',
  KeyE: 'active',
};

const ACTION_BY_KEY: Readonly<Record<string, ActionKind>> = {
  ' ': 'dash',
  spacebar: 'dash',
  e: 'active',
};

const ACTION_BY_KEY_CODE: Readonly<Record<number, ActionKind>> = {
  32: 'dash',
  69: 'active',
};

/**
 * Resolve a discrete gameplay action (`'dash'` or `'active'`) from a keyboard event, or `null`.
 *
 * Physical `event.code` takes priority over `key` / `keyCode` so Vietnamese Telex/VNI composition
 * (`key = 'Process'` / `'ê'`, `keyCode = 229`) never drops `KeyE` or `Space`, and non-QWERTY
 * layouts keep physical key positions consistent with WASD (`moveDirectionForKey`).
 */
export function actionForKey(event: KeyIdentity): ActionKind | null {
  const byCode = ACTION_BY_CODE[event.code];
  if (byCode !== undefined) return byCode;
  if (event.code !== '') return null;

  const normalizedKey = event.key === ' ' ? ' ' : event.key.toLowerCase();
  const byKey = ACTION_BY_KEY[normalizedKey];
  if (byKey !== undefined) return byKey;
  if (event.keyCode === IME_PROCESS_KEY_CODE) return null;
  return ACTION_BY_KEY_CODE[event.keyCode] ?? null;
}

/** True when `MouseEvent.button` is right-click (`2`), mapped to Signature Active. */
export function isActiveMouseButton(button: number): boolean {
  return button === RIGHT_MOUSE_BUTTON;
}

/**
 * Game-time buffer for discrete gameplay actions (`'dash'` and `'active'`).
 *
 * Never reads `Date.now()` or `performance.now()`: callers advance `step(dtMs)` using simulation
 * delta time so pause and hitstop freeze buffered inputs with zero drift.
 */
export class ActionBuffer {
  private dashBuffered = false;
  private dashRemainingMs = 0;
  private activeBuffered = false;
  private activeRemainingMs = 0;

  constructor(readonly windowMs: number = DEFAULT_ACTION_BUFFER_MS) {
    if (!Number.isFinite(windowMs) || windowMs < 0) {
      throw new Error(`ActionBuffer needs a finite windowMs >= 0, got ${windowMs}`);
    }
  }

  /** Record a fresh discrete press for `kind`, refreshing its game-time window to `windowMs`. */
  press(kind: ActionKind): void {
    if (kind === 'dash') {
      this.dashBuffered = true;
      this.dashRemainingMs = this.windowMs;
      return;
    }
    this.activeBuffered = true;
    this.activeRemainingMs = this.windowMs;
  }

  /**
   * Advance buffered timers by `dtMs` of **simulation** time.
   *
   * Passing `0` (paused / hitstop frame) freezes all buffered timers in place. Once an action's
   * remaining time reaches `<= 0`, it expires cleanly and `consume` will return `false`.
   */
  step(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) {
      throw new Error(`ActionBuffer.step needs a finite dtMs >= 0, got ${dtMs}`);
    }
    if (dtMs === 0) return;

    if (this.dashBuffered) {
      this.dashRemainingMs -= dtMs;
      if (this.dashRemainingMs <= 0) {
        this.dashRemainingMs = 0;
        this.dashBuffered = false;
      }
    }

    if (this.activeBuffered) {
      this.activeRemainingMs -= dtMs;
      if (this.activeRemainingMs <= 0) {
        this.activeRemainingMs = 0;
        this.activeBuffered = false;
      }
    }
  }

  /** True when `kind` is currently buffered and has not yet expired or been consumed. */
  has(kind: ActionKind): boolean {
    return kind === 'dash' ? this.dashBuffered : this.activeBuffered;
  }

  /** Remaining game-time buffer window in milliseconds (`0` when unbuffered or expired). */
  remainingMs(kind: ActionKind): number {
    if (kind === 'dash') {
      return this.dashBuffered ? this.dashRemainingMs : 0;
    }
    return this.activeBuffered ? this.activeRemainingMs : 0;
  }

  /**
   * Consume a buffered press for `kind` if still valid.
   *
   * Returns `true` and clears the buffered entry immediately so a single press can fire **at most
   * once**; returns `false` when nothing is buffered or the window already expired.
   */
  consume(kind: ActionKind): boolean {
    if (kind === 'dash') {
      if (!this.dashBuffered) return false;
      this.dashBuffered = false;
      this.dashRemainingMs = 0;
      return true;
    }

    if (!this.activeBuffered) return false;
    this.activeBuffered = false;
    this.activeRemainingMs = 0;
    return true;
  }

  /** Drop buffered input (one `kind`, or all actions when omitted) on death, room change, or blur. */
  clear(kind?: ActionKind): void {
    if (kind === undefined || kind === 'dash') {
      this.dashBuffered = false;
      this.dashRemainingMs = 0;
    }
    if (kind === undefined || kind === 'active') {
      this.activeBuffered = false;
      this.activeRemainingMs = 0;
    }
  }
}
