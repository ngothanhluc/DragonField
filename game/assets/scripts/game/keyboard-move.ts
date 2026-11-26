/**
 * Listen for WASD/arrow movement keys plus discrete M13 gameplay actions (`Space` → Dash,
 * `KeyE` / Right-Click → Signature Active) directly in capture phase via physical `event.code`.
 *
 * Why capture-phase DOM instead of Cocos `input.on(KEY_DOWN)`:
 * - Cocos only forwards `keyCode`, and a composing Vietnamese IME (Telex/VNI) sends `keyCode = 229`
 *   (`key = 'Process'` / `'ư'` / `'đ'` / `'ê'`), which previously caused stuck WASD or dropped
 *   `KeyE` presses (`AGENTS.md` trap). Physical `event.code` is immune to IME composition.
 * - Discrete actions (`onDash`, `onActive`) never call `stopPropagation()` and respect
 *   `isGameplayActive`, so `Space`, `Enter`, `R`, and mouse clicks inside Pause, Skill Pick, Shop,
 *   or Title menus continue to work without interference.
 * - On tab blur or visibility loss, held movement keys reset cleanly so nothing sticks.
 */
import { actionForKey, isActiveMouseButton } from '../core/input/action-buffer';
import { MoveKeyState } from '../core/movement/move-keys';

/** One key log line for `__yokai.keyLog()` when `?debug=1`. */
export interface KeyLogEntry {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly keyCode: number;
  readonly isComposing: boolean;
  readonly t: number;
}

export interface KeyboardMoveCallbacks {
  /** Fired on non-repeating `Space` press while gameplay actions are active. */
  readonly onDash?: (() => void) | null;
  /** Fired on non-repeating `KeyE` press or right-click while gameplay actions are active. */
  readonly onActive?: (() => void) | null;
  /**
   * Optional predicate guarding discrete gameplay actions (`onDash`, `onActive`, right-click
   * `contextmenu` suppression). Return `false` while modals/menus/pause are open so `Space` and
   * right-click pass untouched to UI.
   */
  readonly isGameplayActive?: (() => boolean) | null;
}

/** Minimal event-target surface so unit tests can exercise `KeyboardMove` without a browser DOM. */
export interface KeyboardMoveTargets {
  readonly doc: Pick<Document, 'addEventListener' | 'removeEventListener'> & {
    readonly visibilityState?: DocumentVisibilityState;
  };
  readonly win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

const KEY_LOG_LIMIT = 200;
const keyLogEntries: KeyLogEntry[] = [];

/** The last 200 keyboard events (every key, not just WASD) for IME diagnosis. */
export function keyLog(): readonly KeyLogEntry[] {
  return keyLogEntries.slice();
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;
}

function record(event: KeyboardEvent): void {
  keyLogEntries.push({
    type: event.type,
    key: event.key,
    code: event.code,
    keyCode: event.keyCode,
    isComposing: Boolean(event.isComposing),
    t: nowMs(),
  });
  if (keyLogEntries.length > KEY_LOG_LIMIT) keyLogEntries.shift();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const candidate = target as {
    readonly tagName?: unknown;
    readonly isContentEditable?: unknown;
  };
  if (candidate.isContentEditable === true) return true;
  if (typeof candidate.tagName !== 'string') return false;
  const tag = candidate.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function hasModifierChord(event: KeyboardEvent | MouseEvent): boolean {
  return Boolean(event.ctrlKey || event.metaKey || event.altKey);
}

export class KeyboardMove {
  readonly keys = new MoveKeyState();

  onDash: (() => void) | null;
  onActive: (() => void) | null;
  isGameplayActive: (() => boolean) | null;

  private attachedTargets: KeyboardMoveTargets | null = null;

  constructor(callbacks: KeyboardMoveCallbacks = {}) {
    this.onDash = callbacks.onDash ?? null;
    this.onActive = callbacks.onActive ?? null;
    this.isGameplayActive = callbacks.isGameplayActive ?? null;
  }

  /**
   * True when discrete gameplay actions (`Space`, `KeyE`, Right-Click) should be captured.
   *
   * Requires at least one bound callback (`onDash` / `onActive`) or an explicit `isGameplayActive`
   * predicate returning `true`, so unconfigured instances and open menus/modals never swallow `Space`
   * or right-click.
   */
  private canCaptureActions(): boolean {
    if (this.isGameplayActive !== null) {
      return this.isGameplayActive();
    }
    return this.onDash !== null || this.onActive !== null;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    record(event);
    if (isEditableTarget(event.target)) return;

    if (!hasModifierChord(event) && this.keys.apply(event, true)) {
      event.preventDefault();
      return;
    }

    if (hasModifierChord(event) || !this.canCaptureActions()) return;

    const action = actionForKey(event);
    if (action === 'dash') {
      if (this.onDash !== null || this.isGameplayActive !== null) {
        event.preventDefault();
      }
      if (!event.repeat) {
        this.onDash?.();
      }
      return;
    }

    if (action === 'active') {
      if (this.onActive !== null || this.isGameplayActive !== null) {
        event.preventDefault();
      }
      if (!event.repeat) {
        this.onActive?.();
      }
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    record(event);
    if (this.keys.apply(event, false)) {
      event.preventDefault();
    }
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!isActiveMouseButton(event.button)) return;
    if (hasModifierChord(event) || isEditableTarget(event.target)) return;
    if (!this.canCaptureActions()) return;

    if (this.onActive !== null || this.isGameplayActive !== null) {
      event.preventDefault();
    }
    this.onActive?.();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (isEditableTarget(event.target)) return;
    if (!this.canCaptureActions()) return;

    if (this.onActive !== null || this.isGameplayActive !== null) {
      event.preventDefault();
    }
  };

  private readonly onBlur = (): void => {
    this.keys.reset();
  };

  private readonly onVisibility = (): void => {
    const state = this.attachedTargets?.doc.visibilityState;
    if (state !== undefined && state !== 'visible') {
      this.keys.reset();
    }
  };

  attach(targets?: KeyboardMoveTargets): void {
    this.detach();
    const resolved: KeyboardMoveTargets | null =
      targets ??
      (typeof document !== 'undefined' && typeof window !== 'undefined'
        ? { doc: document, win: window }
        : null);
    if (resolved === null) return;

    this.attachedTargets = resolved;
    resolved.doc.addEventListener('keydown', this.onKeyDown, true);
    resolved.doc.addEventListener('keyup', this.onKeyUp, true);
    resolved.doc.addEventListener('mousedown', this.onMouseDown, true);
    resolved.doc.addEventListener('contextmenu', this.onContextMenu, true);
    resolved.win.addEventListener('blur', this.onBlur);
    resolved.doc.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(): void {
    const targets = this.attachedTargets;
    if (targets !== null) {
      targets.doc.removeEventListener('keydown', this.onKeyDown, true);
      targets.doc.removeEventListener('keyup', this.onKeyUp, true);
      targets.doc.removeEventListener('mousedown', this.onMouseDown, true);
      targets.doc.removeEventListener('contextmenu', this.onContextMenu, true);
      targets.win.removeEventListener('blur', this.onBlur);
      targets.doc.removeEventListener('visibilitychange', this.onVisibility);
      this.attachedTargets = null;
    }
    this.keys.reset();
  }
}
