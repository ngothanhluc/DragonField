/**
 * M15 Wave 2 UI & ScreenFlow wiring tests:
 * - TitleScreen: hides `Continue Run` when `activeRun` is null/undefined; renders `Continue Run`
 *   with Hero, `Ch<N> R<M>`, and `A<X>` / `E<Y>` tags when non-null and invokes `onContinueRun`.
 * - ChapterSelect: clamps Ascension 0–5 selector (`<` / `>` and Left/Right) to
 *   `unlockedAscensionForChapter(save, chapter)` and forwards `(chapter, ascension)` on start.
 * - ShopScreen: renders STAT UPGRADES, UTILITY UPGRADES, and HERO UNLOCKS (all 6 tracks + 3 heroes,
 *   zero Revive) and invokes purchase callbacks.
 * - SettingsScreen & PauseScreen: step Music & SFX channels independently by 10%, calling
 *   `onMusicVolume` / `onSfxVolume` with clean fallback to `onVolume`.
 * - ResultScreen: displays Seed, Hero, Depth + Ascension/Endless tags, Cause of Death, Build +
 *   Evolutions, Unlocks, and renders `Continue Endless` iff `won && canContinueEndless`.
 * - ScreenFlow: compiles with optional M15 hooks omitted, preserves selected `ascension` across
 *   Character Select -> Chapter Select -> start run, ducks/unducks music on Pause open/close, and
 *   persists independent Music & SFX volumes cleanly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  MockButton,
  MockColor,
  MockGraphics,
  MockLabel,
  MockNode,
  MockSprite,
  MockUITransform,
  keyListeners,
  dispatchKey,
} = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  const docListeners = new Set<(event: KeyboardEvent) => void>();

  function fireKey(key: string, keyCode = 0, code = ''): void {
    const ev = {
      key,
      keyCode,
      code: code || key,
      repeat: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    for (const fn of Array.from(docListeners)) {
      fn(ev);
    }
  }

  class HoistedColor {
    constructor(
      public r = 255,
      public g = 255,
      public b = 255,
      public a = 255,
    ) {}
  }

  class HoistedUITransform {
    width = 100;
    height = 100;
    anchorPoint = { x: 0.5, y: 0.5 };
    contentSize = { width: 100, height: 100 };
    setContentSize(w: number, h: number): void {
      this.width = w;
      this.height = h;
      this.contentSize = { width: w, height: h };
    }
  }

  class HoistedLabel {
    static Overflow = { NONE: 0, CLAMP: 1, SHRINK: 2, RESIZE_HEIGHT: 3 };
    static HorizontalAlign = { LEFT: 0, CENTER: 1, RIGHT: 2 };
    static VerticalAlign = { TOP: 0, CENTER: 1, BOTTOM: 2 };
    string = '';
    fontSize = 12;
    lineHeight = 14;
    color: unknown = null;
    useSystemFont = true;
    font: unknown = null;
    enableWrapText = false;
    overflow = 0;
    horizontalAlign = 1;
    verticalAlign = 1;
    node!: HoistedNode;
    updateRenderData(): void {}
  }

  class HoistedSprite {
    static Type = { SIMPLE: 0, SLICED: 1, TILED: 2 };
    static SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
    type = 0;
    sizeMode = 0;
    trim = false;
    spriteFrame: unknown = null;
    color: unknown = null;
  }

  class HoistedGraphics {
    fillColor: unknown = null;
    rect(): void {}
    fill(): void {}
    clear(): void {}
  }

  class HoistedButton {
    static Transition = { NONE: 0 };
    static EventType = { CLICK: 'click' };
    transition = 0;
  }

  class HoistedNode {
    static EventType = {
      MOUSE_ENTER: 'mouse-enter',
      MOUSE_LEAVE: 'mouse-leave',
      MOUSE_DOWN: 'mouse-down',
      MOUSE_UP: 'mouse-up',
    };
    active = true;
    isValid = true;
    layer = 0;
    readonly children: HoistedNode[] = [];
    readonly position = { x: 0, y: 0, z: 0 };
    private parentNode: HoistedNode | null = null;
    private readonly components = new Map<unknown, unknown>();
    private readonly events = new Map<string, Listener[]>();

    constructor(public name = '') {
      this.components.set(HoistedUITransform, new HoistedUITransform());
    }

    get activeInHierarchy(): boolean {
      if (!this.active || !this.isValid) return false;
      return this.parentNode === null ? true : this.parentNode.activeInHierarchy;
    }

    get parent(): HoistedNode | null {
      return this.parentNode;
    }

    set parent(next: HoistedNode | null) {
      if (this.parentNode !== null) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx >= 0) this.parentNode.children.splice(idx, 1);
      }
      this.parentNode = next;
      if (next !== null) next.children.push(this);
    }

    addComponent<T>(Ctor: new () => T): T {
      const inst = new Ctor();
      if (inst instanceof HoistedLabel) {
        inst.node = this;
      }
      this.components.set(Ctor, inst);
      return inst;
    }

    getComponent<T>(Ctor: new () => T): T | null {
      return (this.components.get(Ctor) as T | undefined) ?? null;
    }

    setPosition(x: number, y: number, z = 0): void {
      this.position.x = x;
      this.position.y = y;
      this.position.z = z;
    }

    on(type: string, fn: Listener): void {
      const list = this.events.get(type) ?? [];
      list.push(fn);
      this.events.set(type, list);
    }

    emit(type: string): void {
      for (const fn of this.events.get(type) ?? []) fn();
    }

    destroy(): void {
      this.isValid = false;
      this.parent = null;
      for (const child of Array.from(this.children)) child.destroy();
    }
  }

  (globalThis as unknown as { document: unknown }).document = {
    fullscreenElement: null,
    documentElement: {},
    addEventListener: (type: string, fn: (event: KeyboardEvent) => void) => {
      if (type === 'keydown') docListeners.add(fn);
    },
    removeEventListener: (type: string, fn: (event: KeyboardEvent) => void) => {
      if (type === 'keydown') docListeners.delete(fn);
    },
  };

  return {
    MockButton: HoistedButton,
    MockColor: HoistedColor,
    MockGraphics: HoistedGraphics,
    MockLabel: HoistedLabel,
    MockNode: HoistedNode,
    MockSprite: HoistedSprite,
    MockUITransform: HoistedUITransform,
    keyListeners: docListeners,
    dispatchKey: fireKey,
  };
});

vi.mock('cc', () => ({
  Button: MockButton,
  Canvas: class {},
  Color: MockColor,
  Component: class {},
  Font: class {},
  Graphics: MockGraphics,
  Label: MockLabel,
  Layers: { Enum: { UI_2D: 1 << 25 } },
  Node: MockNode,
  Rect: class {
    constructor(
      public x = 0,
      public y = 0,
      public width = 16,
      public height = 16,
    ) {}
  },
  Size: class {
    constructor(
      public width = 16,
      public height = 16,
    ) {}
  },
  Vec2: class {
    constructor(
      public x = 0,
      public y = 0,
    ) {}
  },
  Vec3: class {
    constructor(
      public x = 0,
      public y = 0,
      public z = 0,
    ) {}
  },
  Input: { EventType: { KEY_DOWN: 'key-down', KEY_UP: 'key-up' } },
  KeyCode: { KEY_1: 49, KEY_2: 50, KEY_3: 51, KEY_R: 82 },
  JsonAsset: class {},
  TiledMap: class {},
  TiledMapAsset: class {},
  input: { on: () => undefined, off: () => undefined },
  Sprite: MockSprite,
  SpriteFrame: class {
    texture: unknown = null;
    rect: unknown = null;
    insetLeft = 0;
    insetRight = 0;
    insetTop = 0;
    insetBottom = 0;
  },
  Texture2D: class {
    static Filter = { NEAREST: 0, LINEAR: 1 };
  },
  UIOpacity: class {},
  UITransform: MockUITransform,
  _decorator: { ccclass: () => (target: unknown) => target },
  resources: { load: () => undefined },
  view: {
    getVisibleSize: () => ({ width: 512, height: 288 }),
    getViewportRect: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    getScaleX: () => 3.75,
    getScaleY: () => 3.75,
  },
  warn: () => undefined,
}));

vi.mock('../../assets/scripts/game/assets/texture-cache', () => ({
  loadPixelTexture: vi.fn(async () => ({ width: 16, height: 16 })),
  loadTexture: vi.fn(async () => ({ width: 16, height: 16 })),
  preloadSheets: vi.fn(async () => undefined),
}));

import { CHARACTERS } from '../../assets/scripts/core/characters/roster';
import { getLocale, setLocale } from '../../assets/scripts/core/i18n';
import { RUN_SAVE_VERSION, type ActiveRunSave } from '../../assets/scripts/core/save/run-save';
import {
  createDefaultSave,
  unlockChapterAscension,
  unlockNextChapter,
  unlockedAscensionForChapter,
  type SaveData,
} from '../../assets/scripts/core/save/save-data';
import { DEFAULT_SETTINGS } from '../../assets/scripts/core/save/settings';
import { MemorySaveStorage, SaveRepository } from '../../assets/scripts/core/save/storage';
import { buildChapterSelect } from '../../assets/scripts/game/chapter-select';
import type { DebugStatus } from '../../assets/scripts/game/debug-api';
import { ScreenFlow } from '../../assets/scripts/game/screen-flow';
import { buildPauseScreen } from '../../assets/scripts/game/screens/pause-screen';
import { buildResultScreen } from '../../assets/scripts/game/screens/result-screen';
import { buildSettingsScreen } from '../../assets/scripts/game/screens/settings-screen';
import { buildShopScreen } from '../../assets/scripts/game/screens/shop-screen';
import { buildTitleScreen } from '../../assets/scripts/game/screens/title-screen';

function collectLabels(node: InstanceType<typeof MockNode>): string[] {
  const out: string[] = [];
  const walk = (cur: InstanceType<typeof MockNode>): void => {
    if (!cur.active || !cur.isValid) return;
    const lbl = cur.getComponent(MockLabel);
    if (lbl !== null && lbl.string.trim() !== '') {
      out.push(lbl.string);
    }
    for (const child of cur.children) walk(child);
  };
  walk(node);
  return out;
}

function findNodeByName(
  root: InstanceType<typeof MockNode>,
  name: string,
): InstanceType<typeof MockNode> | null {
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = findNodeByName(child, name);
    if (found !== null) return found;
  }
  return null;
}

function makeActiveRun(overrides: Partial<ActiveRunSave> = {}): ActiveRunSave {
  return {
    version: RUN_SAVE_VERSION,
    seed: 987654,
    chapter: 2,
    roomIndex: 4,
    chosenDoor: 'gold',
    drawnRooms: [1, 2, 3, 4, 5, 6, 7, 8, 17],
    bossId: 'squid',
    characterId: 'archer',
    hearts: 5,
    maxHearts: 6,
    xpLevel: 5,
    xpCurrent: 10,
    xpTotal: 90,
    pendingLevelUps: 0,
    ownedSkills: { piercing: 2 },
    rerollsUsed: 0,
    freeRerollsLeft: 1,
    goldEarned: 60,
    kills: 45,
    elapsedMs: 92000,
    ascension: 3,
    endlessLoop: 1,
    ...overrides,
  };
}

beforeEach(() => {
  keyListeners.clear();
  setLocale('vi');
});

describe('M15 TitleScreen — Continue Run button', () => {
  it('hides Continue Run completely when activeRun is null or omitted', async () => {
    const parent = new MockNode('ui');
    const screen = await buildTitleScreen({
      parent: parent as unknown as never,
      gold: 50,
      best: { chapter: 1, room: 3 },
      activeRun: null,
      onPlay: vi.fn(),
      onShop: vi.fn(),
      onSettings: vi.fn(),
      onCredits: vi.fn(),
    });

    const texts = collectLabels(screen.node as unknown as InstanceType<typeof MockNode>);
    expect(texts).not.toContain('Tiếp tục màn chơi');
    expect(texts).toContain('Chơi');
    screen.destroy();
  });

  it('renders Continue Run with Hero, Ch/P, and A/E tags when activeRun is present and fires onContinueRun', async () => {
    const parent = new MockNode('ui');
    const activeRun = makeActiveRun();
    const onContinueRun = vi.fn();
    const onSelectCharacter = vi.fn();

    const screen = await buildTitleScreen({
      parent: parent as unknown as never,
      gold: 120,
      best: { chapter: 2, room: 7 },
      activeRun,
      onContinueRun,
      selectedCharacter: CHARACTERS.ninja,
      availableCharacters: [CHARACTERS.ninja, CHARACTERS.archer],
      onSelectCharacter,
      onPlay: vi.fn(),
      onShop: vi.fn(),
      onSettings: vi.fn(),
      onCredits: vi.fn(),
    });

    const texts = collectLabels(screen.node as unknown as InstanceType<typeof MockNode>);
    expect(texts).toContain('Tiếp tục màn chơi');
    expect(texts).toContain('Cung Thủ · Ch2 P4 · A3 · E1');

    // Focus defaults to 0 (Continue Run) -> Enter invokes onContinueRun(activeRun).
    dispatchKey('Enter', 13);
    expect(onContinueRun).toHaveBeenCalledTimes(1);
    expect(onContinueRun).toHaveBeenCalledWith(activeRun);

    // Character row is shifted to index 2 -> Left/Right cycles unlocked heroes cleanly.
    screen.focus(2);
    dispatchKey('ArrowRight', 39);
    expect(onSelectCharacter).toHaveBeenCalledWith('archer');

    screen.destroy();
  });
});

describe('M15 ChapterSelect — Ascension 0–5 selector & clamping', () => {
  it('clamps Ascension to unlockedAscensionForChapter(save, selectedChapter) and passes (chapter, ascension) on start', async () => {
    const parent = new MockNode('ui');
    let save = unlockNextChapter(createDefaultSave(), 1); // Ch1 & Ch2 playable
    save = unlockChapterAscension(unlockChapterAscension(save, 1, 0), 1, 1); // Ch1 max A2, Ch2 max A0

    const onStartChapter = vi.fn();
    const screen = await buildChapterSelect(parent as unknown as never, {
      chapters: [
        { chapter: 1, playable: true, hasData: true },
        { chapter: 2, playable: true, hasData: true },
        { chapter: 3, playable: false, hasData: true },
        { chapter: 4, playable: false, hasData: true },
      ],
      best: save.best,
      save,
      initialAscension: 5, // clamped to Ch1's unlocked max (2)
      onStartChapter,
      onBack: vi.fn(),
    });

    expect(screen.getAscension()).toBe(2);
    let texts = collectLabels(screen.node as unknown as InstanceType<typeof MockNode>);
    expect(texts).toContain('Thăng Hoa 2');
    expect(texts.some((t) => t.includes('+30% Vàng'))).toBe(true);

    // Trying to step right beyond unlocked tier 2 stays clamped at 2.
    dispatchKey('ArrowRight', 39);
    expect(screen.getAscension()).toBe(2);

    // Click `<` button steps down to Ascension 1.
    const prevNode = findNodeByName(
      screen.node as unknown as InstanceType<typeof MockNode>,
      'chapter-ascension-prev',
    )!;
    prevNode.emit(MockButton.EventType.CLICK);
    expect(screen.getAscension()).toBe(1);

    // Moving down from Chapter 1 (index 0) to Chapter 2 (max A0) clamps Ascension to 0 (Normal).
    screen.focus(0);
    dispatchKey('ArrowDown', 40);
    expect(screen.getAscension()).toBe(0);
    texts = collectLabels(screen.node as unknown as InstanceType<typeof MockNode>);
    expect(texts).toContain('Thường');

    // Move back up to Chapter 1, step to A2 via `>` button, and press Enter to launch Ch1 at A2.
    dispatchKey('ArrowUp', 38);
    const nextNode = findNodeByName(
      screen.node as unknown as InstanceType<typeof MockNode>,
      'chapter-ascension-next',
    )!;
    nextNode.emit(MockButton.EventType.CLICK);
    nextNode.emit(MockButton.EventType.CLICK);
    expect(screen.getAscension()).toBe(2);

    screen.focus(0);
    dispatchKey('Enter', 13);
    expect(onStartChapter).toHaveBeenCalledWith(1, 2);

    screen.destroy();
  });
});

describe('M15 Expanded Meta Shop — 6 upgrade tracks + 3 hero unlocks', () => {
  it('renders STAT UPGRADES, UTILITY UPGRADES (no Revive), and HERO UNLOCKS and triggers purchases', async () => {
    const parent = new MockNode('ui');
    const save: SaveData = { ...createDefaultSave(), gold: 500 };
    const onBuy = vi.fn();
    const onBuyCharacter = vi.fn();

    const screen = await buildShopScreen({
      parent: parent as unknown as never,
      save,
      onBuy,
      onBuyCharacter,
      onOpenCharacterSelect: vi.fn(),
      onBack: vi.fn(),
    });

    const root = screen.node as unknown as InstanceType<typeof MockNode>;
    const texts = collectLabels(root);
    expect(texts).toContain('NÂNG CHỈ SỐ');
    expect(texts).toContain('TIỆN ÍCH');
    expect(texts).toContain('MỞ KHÓA TƯỚNG');
    expect(texts.some((t) => /revive/i.test(t))).toBe(false);

    // Buy `xpMagnet` (index 3, utility column top).
    screen.focus(3);
    dispatchKey('Enter', 13);
    expect(onBuy).toHaveBeenCalledWith('xpMagnet');

    // Buy `archer` (index 6, hero unlocks column top).
    screen.focus(6);
    dispatchKey('Enter', 13);
    expect(onBuyCharacter).toHaveBeenCalledWith('archer');

    screen.destroy();
  });
});

describe('M15 Settings & Pause — independent Music and SFX sliders + M16 Language toggle', () => {
  it('steps Music and SFX independently by 10% on Settings and falls back to onVolume when needed', async () => {
    const parent = new MockNode('ui');
    const onMusicVolume = vi.fn();
    const onSfxVolume = vi.fn();
    const onToggleLocale = vi.fn();

    const screen = await buildSettingsScreen({
      parent: parent as unknown as never,
      settings: { ...DEFAULT_SETTINGS, musicVolume: 0.8, sfxVolume: 0.5 },
      onMusicVolume,
      onSfxVolume,
      onToggleFullscreen: vi.fn(),
      onToggleScreenShake: vi.fn(),
      onToggleDamageNumbers: vi.fn(),
      onToggleEffects: vi.fn(),
      onToggleLocale,
      onBack: vi.fn(),
    });

    let texts = collectLabels(screen.node as unknown as InstanceType<typeof MockNode>);
    expect(texts).toContain('Nhạc nền   80%');
    expect(texts).toContain('Hiệu ứng âm   50%');
    expect(texts).toContain('Ngôn ngữ   Tiếng Việt');

    // Index 0 = Music: step left (-10%) -> 70%, SFX remains 50%.
    dispatchKey('ArrowLeft', 37);
    expect(onMusicVolume).toHaveBeenCalledWith(0.7);
    expect(onSfxVolume).not.toHaveBeenCalled();

    // Index 1 = SFX: step right (+10%) -> 60%.
    screen.focus(1);
    dispatchKey('ArrowRight', 39);
    expect(onSfxVolume).toHaveBeenCalledWith(0.6);

    // Index 6 = Language: Enter or Left/Right fires onToggleLocale.
    screen.focus(6);
    dispatchKey('Enter', 13);
    expect(onToggleLocale).toHaveBeenCalledTimes(1);

    texts = collectLabels(screen.node as unknown as InstanceType<typeof MockNode>);
    expect(texts).toContain('Nhạc nền   70%');
    expect(texts).toContain('Hiệu ứng âm   60%');
    screen.destroy();

    // Fallback to `onVolume` when channel callbacks are omitted.
    const onLegacyVolume = vi.fn();
    const legacyScreen = await buildPauseScreen({
      parent: parent as unknown as never,
      volume: 0.6,
      onResume: vi.fn(),
      onRestart: vi.fn(),
      onQuit: vi.fn(),
      onVolume: onLegacyVolume,
    });
    legacyScreen.focus(2); // Music row on Pause
    dispatchKey('ArrowRight', 39);
    expect(onLegacyVolume).toHaveBeenCalledWith(0.7);
    legacyScreen.destroy();
  });
});

describe('M15 Rich Result / Death screen — rich summary & Continue Endless', () => {
  it('shows Seed, Hero, Depth, Cause of Death, Build/Evolutions, Unlocks, and hides Continue Endless on defeat', async () => {
    const parent = new MockNode('ui');
    const screen = await buildResultScreen({
      parent: parent as unknown as never,
      result: {
        chapter: 3,
        roomReached: 7,
        roomsTotal: 9,
        goldEarned: 88,
        goldTotal: 320,
        durationMs: 145000,
        kills: 134,
        won: false,
        seed: 424242,
        ascension: 2,
        characterId: 'mage',
        deathCause: { kind: 'bomber-blast', elite: true },
        ownedSkills: new Map([
          ['cataclysm', 1],
          ['explosive', 3],
          ['freeze', 2],
        ]),
        canContinueEndless: true, // ignored because won === false
      },
      onContinueEndless: vi.fn(),
      onShop: vi.fn(),
      onChapterSelect: vi.fn(),
      onTitle: vi.fn(),
    });

    const texts = collectLabels(screen.node as unknown as InstanceType<typeof MockNode>);
    expect(texts).toContain('KẾT THÚC MÀN CHƠI');
    expect(texts).toContain('Bị hạ bởi Cảm Tử Tinh Anh');
    expect(texts.some((t) => t.includes('Tướng: Pháp Sư') && t.includes('Thăng Hoa 2'))).toBe(true);
    expect(texts.some((t) => t.includes('Seed 424242'))).toBe(true);
    expect(texts.some((t) => t.includes('Tiến hóa: Đại Họa Hủy Diệt'))).toBe(true);
    expect(texts.some((t) => t.includes('Đạn Nổ x3'))).toBe(true);
    expect(texts).not.toContain('Tiếp tục Vô Tận');
    screen.destroy();
  });

  it('renders Continue Endless on victory when canContinueEndless is true and invokes callback', async () => {
    const parent = new MockNode('ui');
    const onContinueEndless = vi.fn();
    const screen = await buildResultScreen({
      parent: parent as unknown as never,
      result: {
        chapter: 4,
        roomReached: 9,
        roomsTotal: 9,
        goldEarned: 240,
        goldTotal: 900,
        durationMs: 280000,
        kills: 260,
        won: true,
        seed: 777,
        ascension: 4,
        endlessLoop: 1,
        characterId: 'cultivator',
        unlocks: {
          unlockedAscension: { chapter: 4, level: 5 },
          endlessUnlocked: true,
        },
        canContinueEndless: true,
      },
      onContinueEndless,
      onShop: vi.fn(),
      onChapterSelect: vi.fn(),
      onTitle: vi.fn(),
    });

    const texts = collectLabels(screen.node as unknown as InstanceType<typeof MockNode>);
    expect(texts).toContain('HOÀN THÀNH CHƯƠNG');
    expect(texts).toContain('Tiếp tục Vô Tận');
    expect(texts.some((t) => t.includes('Mở khóa: Ch4 Thăng Hoa 5'))).toBe(true);
    expect(texts.some((t) => t.includes('Đã mở Chế độ Vô Tận!'))).toBe(true);

    // Focus 0 = Continue Endless -> Enter fires onContinueEndless.
    dispatchKey('Enter', 13);
    expect(onContinueEndless).toHaveBeenCalledTimes(1);
    screen.destroy();
  });
});

describe('M15 ScreenFlow — Ascension preservation, Pause music ducking & channel persistence', () => {
  it('preserves selected Ascension across Character Select -> Chapter Select -> startChapter and ducks music on Pause', async () => {
    const uiRoot = new MockNode('canvas');
    const primary = new MemorySaveStorage();
    const backup = new MemorySaveStorage();
    const repo = new SaveRepository(primary, backup);

    let save = unlockNextChapter(createDefaultSave(), 1);
    save = unlockChapterAscension(unlockChapterAscension(save, 1, 0), 1, 1); // Ch1 max A2
    repo.save(save);

    let status: DebugStatus = 'menu';
    const startChapter = vi.fn();
    const onMusicDucked = vi.fn();
    const onMusicVolume = vi.fn();
    const onSfxVolume = vi.fn();

    const flow = new ScreenFlow({
      uiRoot: () => uiRoot as unknown as never,
      save: () => save,
      repository: () => repo,
      setSave: (next) => {
        save = next;
      },
      status: () => status,
      setStatus: (next) => {
        status = next;
      },
      chapterAvailable: () => true,
      showMenuBackdrop: vi.fn(),
      clearMenuBackdrop: vi.fn(),
      startChapter,
      runSnapshot: () =>
        status === 'playing' || status === 'paused'
          ? {
              chapter: 1,
              room: 2,
              roomsTotal: 9,
              durationMs: 12000,
              goldEarned: 15,
              kills: 8,
              ascension: 2,
            }
          : null,
      launchChapter: vi.fn(async () => {
        status = 'playing';
      }),
      teardownRun: vi.fn(),
      setMusic: vi.fn(),
      onMusicVolume,
      onSfxVolume,
      onMusicDucked,
      applyFeelSettings: vi.fn(),
      fail: (err) => {
        throw err;
      },
    });

    // 1. Open Chapter Select, step Ascension to 2 (`ArrowRight` twice on Chapter 1).
    await flow.showChapterSelect();
    dispatchKey('ArrowRight', 39);
    dispatchKey('ArrowRight', 39);
    expect(flow.ascension).toBe(2);

    // 2. Navigate through Character Select and back to Chapter Select -> Ascension 2 is preserved!
    await flow.showCharacterSelect();
    expect(flow.ascension).toBe(2);
    await flow.showChapterSelect();
    expect(flow.ascension).toBe(2);

    // 3. Start Chapter 1 -> passes `(1, 2)`!
    dispatchKey('Enter', 13);
    expect(startChapter).toHaveBeenCalledWith(1, 2);

    // 4. Enter playing state, open Pause -> music ducks (`true`), step Music & SFX -> persists cleanly, Resume -> unducks (`false`).
    status = 'playing';
    await flow.showPause();
    expect(status).toBe('paused');
    expect(onMusicDucked).toHaveBeenLastCalledWith(true);

    // Focus Music row (index 2) on Pause and step -10% (0.8 -> 0.7).
    dispatchKey('ArrowDown', 40);
    dispatchKey('ArrowDown', 40);
    dispatchKey('ArrowLeft', 37);
    expect(onMusicVolume).toHaveBeenCalledWith(0.7);
    expect(save.settings.musicVolume).toBe(0.7);
    expect(save.settings.sfxVolume).toBe(0.8);

    // Focus SFX row (index 3) and step -20% (0.8 -> 0.6).
    dispatchKey('ArrowDown', 40);
    dispatchKey('ArrowLeft', 37);
    dispatchKey('ArrowLeft', 37);
    expect(onSfxVolume).toHaveBeenCalledWith(0.6);
    expect(save.settings.musicVolume).toBe(0.7);
    expect(save.settings.sfxVolume).toBe(0.6);

    // Press Escape to resume -> unducks music (`false`).
    dispatchKey('Escape', 27);
    expect(status).toBe('playing');
    expect(onMusicDucked).toHaveBeenLastCalledWith(false);

    flow.destroy();
  });

  it('preserves runSave on Pause -> Quit to Title (no double gold banking) and clears runSave on death/victory', async () => {
    const uiRoot = new MockNode('canvas');
    const primary = new MemorySaveStorage();
    const backup = new MemorySaveStorage();
    const repo = new SaveRepository(primary, backup);

    let save: SaveData = { ...createDefaultSave(), gold: 100, chaptersUnlocked: 4 };
    repo.save(save);

    let activeRun: ActiveRunSave | null = makeActiveRun({
      chapter: 4,
      roomIndex: 6,
      goldEarned: 55,
      ascension: 0,
    });
    let status: DebugStatus = 'playing';
    const onContinueRun = vi.fn();
    const onContinueEndless = vi.fn();
    const teardownCalls: Array<boolean | undefined> = [];

    const flow = new ScreenFlow({
      uiRoot: () => uiRoot as unknown as never,
      save: () => save,
      repository: () => repo,
      setSave: (next) => {
        save = next;
      },
      status: () => status,
      setStatus: (next) => {
        status = next;
      },
      chapterAvailable: () => true,
      showMenuBackdrop: vi.fn(),
      clearMenuBackdrop: vi.fn(),
      startChapter: vi.fn(),
      getActiveRunSave: () => activeRun,
      onContinueRun,
      onContinueEndless,
      runSnapshot: () => ({
        chapter: 4,
        room: 9,
        roomsTotal: 9,
        durationMs: 180000,
        goldEarned: 55,
        kills: 90,
        seed: 987654,
        ascension: 0,
        endlessLoop: 0,
        characterId: 'archer',
        deathCause: { kind: 'boss', bossId: 'samurai', phase: 3 },
        ownedSkills: { multishot: 2, pierce: 1 },
      }),
      launchChapter: vi.fn(async () => {
        status = 'playing';
      }),
      teardownRun: (clearRunSave) => {
        teardownCalls.push(clearRunSave);
        if (clearRunSave) activeRun = null;
      },
      setMusic: vi.fn(),
      applyFeelSettings: vi.fn(),
      fail: (err) => {
        throw err;
      },
    });

    // 1. Open Pause and select `Quit to title` (index 4: Resume, Restart, Music, SFX, Quit to title).
    await flow.showPause();
    dispatchKey('ArrowDown', 40);
    dispatchKey('ArrowDown', 40);
    dispatchKey('ArrowDown', 40);
    dispatchKey('ArrowDown', 40);
    dispatchKey('Enter', 13);
    // Allow async quitToTitle -> showTitle to complete.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Safe-boundary runSave MUST survive Quit to Title, gold MUST NOT be double-banked,
    // and Title MUST immediately show `Continue Run`.
    expect(teardownCalls[0]).toBe(false);
    expect(activeRun).not.toBeNull();
    expect(save.gold).toBe(100);
    let texts = collectLabels(uiRoot);
    expect(texts).toContain('Tiếp tục màn chơi');

    // Pressing Enter on Title focus 0 invokes `onContinueRun(activeRun)`.
    dispatchKey('Enter', 13);
    expect(onContinueRun).toHaveBeenCalledTimes(1);
    expect(onContinueRun).toHaveBeenCalledWith(activeRun);

    // 2. Finish Chapter 4 victory -> clears runSave (`teardownRun(true)`), unlocks Ch4 Ascension 1,
    //    banks gold once, and renders rich ResultScreen with `Tiếp tục Vô Tận` + unlocks!
    status = 'playing';
    flow.finishRun(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(teardownCalls[teardownCalls.length - 1]).toBe(true);
    expect(activeRun).toBeNull();
    expect(save.gold).toBe(155);
    expect(unlockedAscensionForChapter(save, 4)).toBe(1);

    texts = collectLabels(uiRoot);
    expect(texts).toContain('HOÀN THÀNH CHƯƠNG');
    expect(texts).toContain('Tiếp tục Vô Tận');
    expect(texts.some((t) => t.includes('Seed 987654'))).toBe(true);
    expect(texts.some((t) => t.includes('Ch4 Thăng Hoa 1'))).toBe(true);

    // Returning to Title after victory hides `Continue Run` because `activeRun` was cleared.
    await flow.showTitle();
    texts = collectLabels(uiRoot);
    expect(texts).not.toContain('Tiếp tục màn chơi');

    // 3. M16: Opening Settings from Title (index 3: Play, Character, Meta shop, Settings) and
    //    toggling Language updates locale live, rebuilds Settings in English, and persists `settings.locale = 'en'`.
    dispatchKey('ArrowDown', 40);
    dispatchKey('ArrowDown', 40);
    dispatchKey('ArrowDown', 40);
    dispatchKey('Enter', 13);
    await new Promise((resolve) => setTimeout(resolve, 0));
    texts = collectLabels(uiRoot);
    expect(texts).toContain('CÀI ĐẶT');
    expect(texts).toContain('Ngôn ngữ   Tiếng Việt');

    // Move focus to index 6 (Language row) and press Enter -> switches live to English!
    for (let step = 0; step < 6; step += 1) dispatchKey('ArrowDown', 40);
    dispatchKey('Enter', 13);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getLocale()).toBe('en');
    expect(save.settings.locale).toBe('en');
    expect(repo.load().settings.locale).toBe('en');
    texts = collectLabels(uiRoot);
    expect(texts).toContain('SETTINGS');
    expect(texts).toContain('Language   English');

    // Navigating back to Title renders English Title labels cleanly.
    dispatchKey('Escape', 27);
    await new Promise((resolve) => setTimeout(resolve, 0));
    texts = collectLabels(uiRoot);
    expect(texts).toContain('Play');
    expect(texts).toContain('Settings');

    flow.destroy();
  });
});
