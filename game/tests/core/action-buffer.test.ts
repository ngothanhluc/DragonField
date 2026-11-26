import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { HitstopClock } from '../../assets/scripts/core/combat/hitstop';
import {
  ACTION_KINDS,
  ActionBuffer,
  DEFAULT_ACTION_BUFFER_MS,
  RIGHT_MOUSE_BUTTON,
  actionForKey,
  isActiveMouseButton,
} from '../../assets/scripts/core/input/action-buffer';
import { IME_PROCESS_KEY_CODE } from '../../assets/scripts/core/movement/move-keys';
import { KeyboardMove, type KeyboardMoveTargets } from '../../assets/scripts/game/keyboard-move';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(HERE, '..', '..', 'assets');

function collectMetaUuids(dir: string, out: Array<{ path: string; uuid: string }> = []): Array<{
  path: string;
  uuid: string;
}> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectMetaUuids(full, out);
    } else if (name.endsWith('.meta')) {
      const parsed = JSON.parse(readFileSync(full, 'utf8')) as { uuid?: unknown };
      if (typeof parsed.uuid === 'string') {
        out.push({ path: full, uuid: parsed.uuid });
      }
    }
  }
  return out;
}

describe('ActionBuffer — 150 ms game-time discrete input buffer', () => {
  it('defaults to a 150 ms window and fires at most once per press', () => {
    const buffer = new ActionBuffer();
    expect(DEFAULT_ACTION_BUFFER_MS).toBe(150);
    expect(buffer.windowMs).toBe(150);
    expect(ACTION_KINDS).toEqual(['dash', 'active']);

    expect(buffer.has('dash')).toBe(false);
    expect(buffer.remainingMs('dash')).toBe(0);
    expect(buffer.consume('dash')).toBe(false);

    buffer.press('dash');
    expect(buffer.has('dash')).toBe(true);
    expect(buffer.remainingMs('dash')).toBe(150);
    expect(buffer.has('active')).toBe(false);

    // Consuming fires once and immediately clears the buffered press.
    expect(buffer.consume('dash')).toBe(true);
    expect(buffer.has('dash')).toBe(false);
    expect(buffer.remainingMs('dash')).toBe(0);
    expect(buffer.consume('dash')).toBe(false);
  });

  it('expires cleanly once 150 ms of simulation time elapses, while 149 ms still fires', () => {
    const buffer = new ActionBuffer();
    buffer.press('dash');
    buffer.press('active');

    buffer.step(100);
    expect(buffer.remainingMs('dash')).toBe(50);
    expect(buffer.has('dash')).toBe(true);

    buffer.step(49);
    expect(buffer.remainingMs('dash')).toBe(1);
    expect(buffer.consume('dash')).toBe(true);
    expect(buffer.consume('dash')).toBe(false);

    // `active` was not consumed at 149 ms; 1 more ms reaches 150 ms and expires it cleanly.
    expect(buffer.remainingMs('active')).toBe(1);
    buffer.step(1);
    expect(buffer.has('active')).toBe(false);
    expect(buffer.remainingMs('active')).toBe(0);
    expect(buffer.consume('active')).toBe(false);
  });

  it('freezes completely during pause and 70 ms HitstopClock frames (dtMs === 0)', () => {
    const buffer = new ActionBuffer();
    const hitstop = new HitstopClock(70);

    buffer.press('dash');
    buffer.step(60);
    expect(buffer.remainingMs('dash')).toBe(90);

    // Simulate 3 full seconds of real wall-clock pause (sim does not advance -> step(0)).
    for (let i = 0; i < 180; i += 1) {
      buffer.step(0);
    }
    expect(buffer.remainingMs('dash')).toBe(90);
    expect(buffer.has('dash')).toBe(true);

    // Trigger a 70 ms hitstop across 16 ms frames: frozen frames pass 0 simulation ms.
    hitstop.request(70);
    for (let frame = 0; frame < 4; frame += 1) {
      const simDt = hitstop.step(16);
      expect(simDt).toBe(0);
      buffer.step(simDt);
    }
    // 64 ms of hitstop ate real time, zero buffer time lost!
    expect(buffer.remainingMs('dash')).toBe(90);

    // 5th frame consumes remaining 6 ms of hitstop and advances simulation by 10 ms -> 80 ms left.
    const resumeDt = hitstop.step(16);
    expect(resumeDt).toBe(10);
    buffer.step(resumeDt);
    expect(buffer.remainingMs('dash')).toBe(80);
    expect(buffer.consume('dash')).toBe(true);
  });

  it('refreshes the 150 ms window on re-press and supports targeted or full clear()', () => {
    const buffer = new ActionBuffer(150);
    buffer.press('dash');
    buffer.step(120);
    expect(buffer.remainingMs('dash')).toBe(30);

    // Player presses Space again before expiry -> fresh 150 ms window.
    buffer.press('dash');
    expect(buffer.remainingMs('dash')).toBe(150);

    buffer.press('active');
    buffer.clear('dash');
    expect(buffer.has('dash')).toBe(false);
    expect(buffer.has('active')).toBe(true);

    buffer.press('dash');
    buffer.clear();
    expect(buffer.has('dash')).toBe(false);
    expect(buffer.has('active')).toBe(false);
  });

  it('supports a 0 ms same-frame window and rejects negative or non-finite inputs', () => {
    const zeroBuffer = new ActionBuffer(0);
    zeroBuffer.press('active');
    expect(zeroBuffer.consume('active')).toBe(true);
    expect(zeroBuffer.consume('active')).toBe(false);

    zeroBuffer.press('active');
    zeroBuffer.step(1);
    expect(zeroBuffer.consume('active')).toBe(false);

    expect(() => new ActionBuffer(-1)).toThrow();
    expect(() => new ActionBuffer(Number.NaN)).toThrow();
    expect(() => new ActionBuffer(Number.POSITIVE_INFINITY)).toThrow();

    const valid = new ActionBuffer();
    expect(() => valid.step(-5)).toThrow();
    expect(() => valid.step(Number.NaN)).toThrow();
  });
});

describe('actionForKey & isActiveMouseButton — IME-safe discrete bindings', () => {
  it('resolves Space -> dash and KeyE -> active by physical code even under Telex/VNI IME (229)', () => {
    expect(actionForKey({ code: 'Space', key: ' ', keyCode: 32 })).toBe('dash');
    expect(actionForKey({ code: 'KeyE', key: 'e', keyCode: 69 })).toBe('active');
    expect(actionForKey({ code: 'KeyE', key: 'E', keyCode: 69 })).toBe('active');

    // Vietnamese IME mid-composition sends keyCode 229 and composed/Process key strings.
    expect(actionForKey({ code: 'KeyE', key: 'Process', keyCode: IME_PROCESS_KEY_CODE })).toBe(
      'active',
    );
    expect(actionForKey({ code: 'KeyE', key: 'ê', keyCode: IME_PROCESS_KEY_CODE })).toBe('active'); // i18n-allow: IME key data
    expect(actionForKey({ code: 'Space', key: 'Process', keyCode: IME_PROCESS_KEY_CODE })).toBe(
      'dash',
    );

    // Physical code wins over layout character (e.g. Dvorak where another physical key produces 'e').
    expect(actionForKey({ code: 'KeyD', key: 'e', keyCode: 69 })).toBeNull();
    expect(actionForKey({ code: 'KeyW', key: 'w', keyCode: 87 })).toBeNull();
  });

  it('falls back to key and keyCode only when code is empty, ignoring IME 229', () => {
    expect(actionForKey({ code: '', key: ' ', keyCode: 0 })).toBe('dash');
    expect(actionForKey({ code: '', key: 'e', keyCode: 0 })).toBe('active');
    expect(actionForKey({ code: '', key: '', keyCode: 32 })).toBe('dash');
    expect(actionForKey({ code: '', key: '', keyCode: 69 })).toBe('active');
    expect(actionForKey({ code: '', key: 'Process', keyCode: IME_PROCESS_KEY_CODE })).toBeNull();
  });

  it('matches only secondary mouse button (2) for right-click Signature Active', () => {
    expect(RIGHT_MOUSE_BUTTON).toBe(2);
    expect(isActiveMouseButton(2)).toBe(true);
    expect(isActiveMouseButton(0)).toBe(false);
    expect(isActiveMouseButton(1)).toBe(false);
  });
});

describe('KeyboardMove — capture-phase Space, KeyE, right-click, and modal/WASD safety', () => {
  function createHarness(): {
    readonly targets: KeyboardMoveTargets;
    setVisibility(state: DocumentVisibilityState): void;
    dispatchDoc(type: string, event: Record<string, unknown>): {
      readonly defaultPrevented: boolean;
      readonly propagationStopped: boolean;
    };
    dispatchWin(type: string): void;
    listenerCount(): number;
  } {
    const docListeners = new Map<string, Set<EventListener>>();
    const winListeners = new Map<string, Set<EventListener>>();
    let visibility: DocumentVisibilityState = 'visible';

    const add = (
      map: Map<string, Set<EventListener>>,
      type: string,
      listener: EventListenerOrEventListenerObject,
    ): void => {
      const fn = typeof listener === 'function' ? listener : (e: Event) => listener.handleEvent(e);
      let set = map.get(type);
      if (set === undefined) {
        set = new Set();
        map.set(type, set);
      }
      set.add(fn);
    };

    const remove = (
      map: Map<string, Set<EventListener>>,
      type: string,
      listener: EventListenerOrEventListenerObject,
    ): void => {
      if (typeof listener === 'function') {
        map.get(type)?.delete(listener);
      }
    };

    return {
      targets: {
        doc: {
          get visibilityState() {
            return visibility;
          },
          addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
            add(docListeners, type, listener),
          removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
            remove(docListeners, type, listener),
        },
        win: {
          addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
            add(winListeners, type, listener),
          removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
            remove(winListeners, type, listener),
        },
      },
      setVisibility(state: DocumentVisibilityState): void {
        visibility = state;
      },
      dispatchDoc(type: string, raw: Record<string, unknown>) {
        let defaultPrevented = false;
        let propagationStopped = false;
        const event = {
          type,
          key: '',
          code: '',
          keyCode: 0,
          repeat: false,
          isComposing: false,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          button: 0,
          target: null,
          ...raw,
          preventDefault() {
            defaultPrevented = true;
          },
          stopPropagation() {
            propagationStopped = true;
          },
        };
        for (const fn of docListeners.get(type) ?? []) {
          fn(event as unknown as Event);
        }
        return { defaultPrevented, propagationStopped };
      },
      dispatchWin(type: string) {
        for (const fn of winListeners.get(type) ?? []) {
          fn({ type } as unknown as Event);
        }
      },
      listenerCount() {
        let count = 0;
        for (const set of docListeners.values()) count += set.size;
        for (const set of winListeners.values()) count += set.size;
        return count;
      },
    };
  }

  it('fires onDash (Space) and onActive (KeyE + Right-Click), prevents contextmenu, and ignores repeat', () => {
    const harness = createHarness();
    const onDash = vi.fn();
    const onActive = vi.fn();
    let gameplayActive = true;

    const input = new KeyboardMove({
      onDash,
      onActive,
      isGameplayActive: () => gameplayActive,
    });
    input.attach(harness.targets);

    // Space triggers onDash once and never stops propagation (menus/HUD can still observe if needed).
    const spaceRes = harness.dispatchDoc('keydown', { code: 'Space', key: ' ', keyCode: 32 });
    expect(onDash).toHaveBeenCalledTimes(1);
    expect(spaceRes.defaultPrevented).toBe(true);
    expect(spaceRes.propagationStopped).toBe(false);

    // Held Space auto-repeat does NOT re-trigger onDash.
    harness.dispatchDoc('keydown', { code: 'Space', key: ' ', keyCode: 32, repeat: true });
    expect(onDash).toHaveBeenCalledTimes(1);

    // IME-composed KeyE (keyCode 229) still triggers onActive cleanly.
    const keyERes = harness.dispatchDoc('keydown', {
      code: 'KeyE',
      key: 'ê', // i18n-allow: IME key data
      keyCode: IME_PROCESS_KEY_CODE,
      isComposing: true,
    });
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(keyERes.defaultPrevented).toBe(true);
    expect(keyERes.propagationStopped).toBe(false);

    // Left-click (button 0) is ignored; right-click (button 2) triggers onActive + blocks contextmenu.
    expect(harness.dispatchDoc('mousedown', { button: 0 }).defaultPrevented).toBe(false);
    expect(onActive).toHaveBeenCalledTimes(1);

    const rmbDown = harness.dispatchDoc('mousedown', { button: 2 });
    expect(rmbDown.defaultPrevented).toBe(true);
    expect(onActive).toHaveBeenCalledTimes(2);

    const ctxMenu = harness.dispatchDoc('contextmenu', { button: 2 });
    expect(ctxMenu.defaultPrevented).toBe(true);

    // Pause / Skill Pick modal opens (`gameplayActive = false`): Space, KeyE, right-click pass untouched!
    gameplayActive = false;
    const modalSpace = harness.dispatchDoc('keydown', { code: 'Space', key: ' ', keyCode: 32 });
    const modalRmb = harness.dispatchDoc('mousedown', { button: 2 });
    const modalCtx = harness.dispatchDoc('contextmenu', { button: 2 });
    expect(modalSpace.defaultPrevented).toBe(false);
    expect(modalRmb.defaultPrevented).toBe(false);
    expect(modalCtx.defaultPrevented).toBe(false);
    expect(onDash).toHaveBeenCalledTimes(1);
    expect(onActive).toHaveBeenCalledTimes(2);

    // WASD still works alongside actions, and detach removes all 6 listeners cleanly.
    harness.dispatchDoc('keydown', { code: 'KeyW', key: 'w', keyCode: 87 });
    expect(input.keys.up).toBe(true);
    harness.setVisibility('hidden');
    harness.dispatchDoc('visibilitychange', {});
    expect(input.keys.up).toBe(false);

    input.detach();
    expect(harness.listenerCount()).toBe(0);
  });

  it('ignores modifier chords and editable HTML inputs', () => {
    const harness = createHarness();
    const onDash = vi.fn();
    const onActive = vi.fn();
    const input = new KeyboardMove({ onDash, onActive });
    input.attach(harness.targets);

    harness.dispatchDoc('keydown', { code: 'KeyE', key: 'e', keyCode: 69, ctrlKey: true });
    harness.dispatchDoc('keydown', { code: 'KeyE', key: 'e', keyCode: 69, metaKey: true });
    harness.dispatchDoc('keydown', {
      code: 'Space',
      key: ' ',
      keyCode: 32,
      target: { tagName: 'INPUT' },
    });
    expect(onDash).toHaveBeenCalledTimes(0);
    expect(onActive).toHaveBeenCalledTimes(0);
    input.detach();
  });
});

describe('core/input Cocos .meta files', () => {
  it('ships valid directory and typescript .meta files with globally unique UUIDs', () => {
    const expectedMetas = [
      { rel: 'scripts/core/input.meta', importer: 'directory' },
      { rel: 'scripts/core/input/action-buffer.ts.meta', importer: 'typescript' },
      { rel: 'scripts/core/input/dash.ts.meta', importer: 'typescript' },
      { rel: 'scripts/core/input/active-skill.ts.meta', importer: 'typescript' },
    ] as const;

    for (const item of expectedMetas) {
      const full = join(ASSETS_DIR, item.rel);
      expect(existsSync(full), `${item.rel} missing`).toBe(true);
      const parsed = JSON.parse(readFileSync(full, 'utf8')) as {
        importer?: string;
        uuid?: string;
      };
      expect(parsed.importer).toBe(item.importer);
      expect(parsed.uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }

    const allMetas = collectMetaUuids(ASSETS_DIR);
    const seen = new Map<string, string>();
    for (const entry of allMetas) {
      const prev = seen.get(entry.uuid);
      expect(prev, `duplicate UUID ${entry.uuid} in ${entry.path} and ${prev}`).toBeUndefined();
      seen.set(entry.uuid, entry.path);
    }
  });
});
