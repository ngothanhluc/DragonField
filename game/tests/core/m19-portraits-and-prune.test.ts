/**
 * Milestone M19 integration tests (ADR-027, `docs/gdd/m19-m20-class-skills-and-art.md` §1–§2):
 * 1. Shared base skill pool pruned `27 → 21` (none of the 6 bland IDs remain in pool, icons, or i18n).
 * 2. `aegis-retribution` Evolution rewired to `['shield', 'vitality']` and unlocks cleanly.
 * 3. Legacy `runSave` payloads containing pruned skill IDs migrate & resolve cleanly without crashing.
 * 4. Nearest-filtered `64×64` Hero Portraits (`icon.portrait-ninja/archer/mage/cultivator`) render
 *    with `loadPixelTexture`, `Sprite.SizeMode.CUSTOM`, and exact `UITransform` contentSize (never
 *    Cocos's `100×100` default) across:
 *    - Top-left HUD portrait slot (`Hud.init` & `Hud.setCharacter`, `26×26` inside `28×28` frame),
 *    - Character Select screen (`character-portrait`, `64×64`),
 *    - Victory & Defeat Results screen (`result-portrait`, `64×64`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  MockButton,
  MockColor,
  MockGraphics,
  MockLabel,
  MockNode,
  MockSprite,
  MockSpriteFrame,
  MockUITransform,
  keyListeners,
  dispatchKey,
  loadPixelTextureMock,
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
    node!: HoistedNode;
    setContentSize(w: number, h: number): void {
      this.width = w;
      this.height = h;
      this.contentSize = { width: w, height: h };
    }
    setAnchorPoint(x: number, y: number): void {
      this.anchorPoint = { x, y };
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

  class HoistedSpriteFrame {
    texture: { sheet?: string; width: number; height: number } | null = null;
    rect: { x: number; y: number; width: number; height: number } | null = null;
    originalSize: { width: number; height: number } | null = null;
    offset: { x: number; y: number } | null = null;
    packable = true;
    insetLeft = 0;
    insetRight = 0;
    insetTop = 0;
    insetBottom = 0;
  }

  class HoistedSprite {
    static Type = { SIMPLE: 0, SLICED: 1, TILED: 2 };
    static SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
    type = 0;
    sizeMode = 1;
    trim = true;
    spriteFrame: HoistedSpriteFrame | null = null;
    color: HoistedColor | null = null;
    node!: HoistedNode;
  }

  class HoistedGraphics {
    fillColor: unknown = null;
    strokeColor: unknown = null;
    lineWidth = 1;
    node!: HoistedNode;
    rect(): void {}
    roundRect(): void {}
    moveTo(): void {}
    lineTo(): void {}
    close(): void {}
    fill(): void {}
    stroke(): void {}
    clear(): void {}
  }

  class HoistedButton {
    static Transition = { NONE: 0 };
    static EventType = { CLICK: 'click' };
    transition = 0;
    node!: HoistedNode;
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
    angle = 0;
    readonly children: HoistedNode[] = [];
    readonly position = { x: 0, y: 0, z: 0 };
    readonly scale = { x: 1, y: 1, z: 1 };
    private parentNode: HoistedNode | null = null;
    private readonly components = new Map<unknown, unknown>();
    private readonly events = new Map<string, Listener[]>();

    constructor(public name = '') {
      const tr = new HoistedUITransform();
      tr.node = this;
      this.components.set(HoistedUITransform, tr);
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
      (inst as { node?: HoistedNode }).node = this;
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

    setScale(x: number, y = 1, z = 1): void {
      this.scale.x = x;
      this.scale.y = y;
      this.scale.z = z;
    }

    on(type: string, fn: Listener): void {
      const list = this.events.get(type) ?? [];
      list.push(fn);
      this.events.set(type, list);
    }

    off(type: string, fn: Listener): void {
      const list = this.events.get(type);
      if (list === undefined) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
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

  const pixelLoader = vi.fn(async (sheet: string) => ({
    sheet,
    width: sheet.includes('/portraits/') ? 64 : 16,
    height: sheet.includes('/portraits/') ? 64 : 16,
  }));

  return {
    MockButton: HoistedButton,
    MockColor: HoistedColor,
    MockGraphics: HoistedGraphics,
    MockLabel: HoistedLabel,
    MockNode: HoistedNode,
    MockSprite: HoistedSprite,
    MockSpriteFrame: HoistedSpriteFrame,
    MockUITransform: HoistedUITransform,
    keyListeners: docListeners,
    dispatchKey: fireKey,
    loadPixelTextureMock: pixelLoader,
  };
});

vi.mock('cc', () => ({
  Button: MockButton,
  Canvas: class {},
  Color: MockColor,
  Component: class {
    node!: InstanceType<typeof MockNode>;
  },
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
  SpriteFrame: MockSpriteFrame,
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
  loadPixelTexture: loadPixelTextureMock,
  loadTexture: vi.fn(async (sheet: string) => ({ sheet, width: 16, height: 16 })),
  preloadSheets: vi.fn(async () => undefined),
}));

import { validateManifest } from '../../assets/scripts/core/art/manifest';
import {
  CHARACTER_IDS,
  HERO_PORTRAIT_SHEETS,
  PORTRAIT_SOURCE_SIZE_PX,
} from '../../assets/scripts/core/characters/roster';
import { EN } from '../../assets/scripts/core/i18n/en';
import { VI } from '../../assets/scripts/core/i18n/vi';
import { RUN_SAVE_VERSION, migrateRunSave } from '../../assets/scripts/core/save/run-save';
import { createDefaultSave, type SaveData } from '../../assets/scripts/core/save/save-data';
import {
  getEvolution,
  unlockedEvolutions,
} from '../../assets/scripts/core/skills/evolutions';
import { SKILL_ICONS } from '../../assets/scripts/core/skills/icons';
import {
  PRUNED_M19_SKILL_IDS,
  SKILLS,
  resolveOwnedSkills,
} from '../../assets/scripts/core/skills/pool';
import { createSkillRollRng, rollChoices } from '../../assets/scripts/core/skills/roll';
import {
  CHARACTER_SELECT_PORTRAIT_SIZE_PX,
  RESULT_PORTRAIT_SIZE_PX,
} from '../../assets/scripts/core/view/menu-layout';
import { HUD_PORTRAIT_SPRITE_SIZE_PX } from '../../assets/scripts/core/view/hud-layout';
import {
  cachedCharacterPortrait,
  clearPortraitCache,
  loadCharacterPortrait,
} from '../../assets/scripts/game/assets/portrait-icon';
import { Hud } from '../../assets/scripts/game/hud';
import { buildCharacterSelectScreen } from '../../assets/scripts/game/screens/character-select-screen';
import { buildResultScreen } from '../../assets/scripts/game/screens/result-screen';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, '..', '..', 'assets', 'resources', 'data', 'animations.json');
const realManifest = validateManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown);

function findNodeByName(
  root: InstanceType<typeof MockNode>,
  name: string,
): InstanceType<typeof MockNode> | null {
  if (root.name === name) return root;
  for (const child of root.children) {
    const hit = findNodeByName(child, name);
    if (hit !== null) return hit;
  }
  return null;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('M19 skill prune (27 → 21), aegis-retribution rewire & legacy runSave safety', () => {
  beforeEach(() => {
    clearPortraitCache();
    loadPixelTextureMock.mockClear();
    keyListeners.clear();
  });

  it('keeps exactly 21 shared base skills and removes all 6 pruned IDs from pool, icons, and i18n', () => {
    expect(SKILLS).toHaveLength(21);
    expect(PRUNED_M19_SKILL_IDS).toEqual([
      'long-iframe',
      'thorns',
      'iron-skin',
      'corrosive',
      'second-wind',
      'executioner',
    ]);

    const poolIds = new Set(SKILLS.map((s) => s.id));
    for (const prunedId of PRUNED_M19_SKILL_IDS) {
      expect(poolIds.has(prunedId), `${prunedId} still in SKILLS`).toBe(false);
      expect(prunedId in SKILL_ICONS, `${prunedId} still in SKILL_ICONS`).toBe(false);
      expect(`skill.${prunedId}` in VI, `skill.${prunedId} still in VI`).toBe(false);
      expect(`skill.${prunedId}` in EN, `skill.${prunedId} still in EN`).toBe(false);
    }
  });

  it('rewires aegis-retribution to [shield, vitality] and unlocks it cleanly in level-up rolls', () => {
    const aegis = getEvolution('aegis-retribution');
    expect(aegis.requires).toEqual(['shield', 'vitality']);

    expect(
      unlockedEvolutions(
        new Map([
          ['shield', 1],
          ['thorns', 1],
        ]),
      ),
    ).toEqual([]);

    const unlocked = unlockedEvolutions(
      new Map([
        ['shield', 1],
        ['vitality', 1],
      ]),
    );
    expect(unlocked.map((evo) => evo.id)).toEqual(['aegis-retribution']);

    // Verify `aegis-retribution` actually rolls as a 1-of-3 level-up offer.
    let offered = false;
    const rng = createSkillRollRng(19);
    const owned = new Map<string, number>([
      ['shield', 1],
      ['vitality', 1],
    ]);
    for (let i = 0; i < 40 && !offered; i += 1) {
      const hand = rollChoices({ owned, count: 3, rng });
      if (hand.some((card) => card.id === 'aegis-retribution')) offered = true;
    }
    expect(offered).toBe(true);
  });

  it('migrates and resolves a legacy runSave containing all 6 pruned skill IDs without crashing', () => {
    const legacyRaw = {
      version: RUN_SAVE_VERSION,
      seed: 777,
      chapter: 2,
      roomIndex: 5,
      chosenDoor: 'xp',
      drawnRooms: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      bossId: 'tengu',
      characterId: 'cultivator',
      hearts: 95,
      maxHearts: 120,
      xpLevel: 8,
      xpCurrent: 12,
      xpTotal: 140,
      pendingLevelUps: 0,
      ownedSkills: {
        shield: 1,
        thorns: 2,
        'iron-skin': 3,
        'long-iframe': 1,
        corrosive: 2,
        'second-wind': 1,
        executioner: 2,
        vitality: 2,
        'aegis-retribution': 1,
      },
      rerollsUsed: 1,
      freeRerollsLeft: 0,
      goldEarned: 88,
      kills: 64,
      elapsedMs: 120_000,
      ascension: 1,
      endlessLoop: 0,
    };

    const migrated = migrateRunSave(legacyRaw);
    expect(migrated).not.toBeNull();
    expect(migrated?.ownedSkills).toEqual({
      shield: 1,
      vitality: 2,
      'aegis-retribution': 1,
    });

    // Direct map with stale IDs also resolves safely through `resolveOwnedSkills` (in SKILLS order).
    const resolved = resolveOwnedSkills(
      new Map<string, number>(Object.entries(legacyRaw.ownedSkills)),
    );
    expect(resolved.map((entry) => [entry.def.id, entry.stacks])).toEqual([
      ['vitality', 2],
      ['shield', 1],
    ]);
  });
});

describe('M19 64×64 Hero Portrait integration (HUD, Character Select, Result Screen)', () => {
  beforeEach(() => {
    clearPortraitCache();
    loadPixelTextureMock.mockClear();
    keyListeners.clear();
  });

  it('loads all 4 hero portraits via loadPixelTexture (NEAREST) with exact 64×64 rect and cache dedup', async () => {
    for (const id of CHARACTER_IDS) {
      const frame = await loadCharacterPortrait(id, realManifest);
      expect(frame.texture?.sheet).toBe(HERO_PORTRAIT_SHEETS[id]);
      expect(frame.rect).toMatchObject({
        x: 0,
        y: 0,
        width: PORTRAIT_SOURCE_SIZE_PX,
        height: PORTRAIT_SOURCE_SIZE_PX,
      });
      expect(frame.originalSize).toMatchObject({
        width: PORTRAIT_SOURCE_SIZE_PX,
        height: PORTRAIT_SOURCE_SIZE_PX,
      });
      expect(cachedCharacterPortrait(id, realManifest)).toBe(frame);
    }
    expect(loadPixelTextureMock).toHaveBeenCalledTimes(4);
  });

  it('renders crisp nearest-filtered portrait in Top-Left HUD slot at 26×26 (SizeMode.CUSTOM) and updates across character switches with stale-async guard', async () => {
    const hudNode = new MockNode('hud-root');
    const hud = hudNode.addComponent(Hud);

    await hud.init(100, '1/9', 'archer', realManifest);

    const portraitNode = findNodeByName(hudNode, 'portrait-sprite');
    const innerFallback = findNodeByName(hudNode, 'portrait-slot-inner');
    expect(portraitNode).not.toBeNull();
    expect(portraitNode?.active).toBe(true);
    expect(innerFallback).not.toBeNull();
    expect(innerFallback?.active).toBe(false);
    expect(hud.activeCharacterId).toBe('archer');

    const sprite = portraitNode!.getComponent(MockSprite);
    const transform = portraitNode!.getComponent(MockUITransform);
    expect(sprite).not.toBeNull();
    expect(sprite!.type).toBe(MockSprite.Type.SIMPLE);
    expect(sprite!.sizeMode).toBe(MockSprite.SizeMode.CUSTOM);
    expect(sprite!.trim).toBe(false);
    expect(sprite!.spriteFrame?.texture?.sheet).toBe(HERO_PORTRAIT_SHEETS.archer);
    expect([transform?.width, transform?.height]).toEqual([
      HUD_PORTRAIT_SPRITE_SIZE_PX,
      HUD_PORTRAIT_SPRITE_SIZE_PX,
    ]);
    expect(transform?.width).not.toBe(100);

    // Switch across all remaining playable heroes (`mage`, `cultivator`, `ninja`).
    for (const nextHero of ['mage', 'cultivator', 'ninja'] as const) {
      hud.setCharacter(nextHero, realManifest);
      await flushMicrotasks();
      expect(hud.activeCharacterId).toBe(nextHero);
      expect(sprite!.spriteFrame?.texture?.sheet).toBe(HERO_PORTRAIT_SHEETS[nextHero]);
      expect(portraitNode?.active).toBe(true);
    }

    // Stale async guard: if a slow load for `mage` resolves AFTER switching to `cultivator`,
    // the HUD must keep `cultivator`'s portrait and ignore `mage`'s late resolution.
    clearPortraitCache();
    let resolveDelayedMage!: (tex: { sheet: string; width: number; height: number }) => void;
    loadPixelTextureMock.mockImplementationOnce(
      (sheet: string) =>
        new Promise((resolve) => {
          resolveDelayedMage = () => resolve({ sheet, width: 64, height: 64 });
        }),
    );

    hud.setCharacter('mage', realManifest);
    hud.setCharacter('cultivator', realManifest);
    await flushMicrotasks();
    expect(hud.activeCharacterId).toBe('cultivator');
    expect(sprite!.spriteFrame?.texture?.sheet).toBe(HERO_PORTRAIT_SHEETS.cultivator);

    resolveDelayedMage({ sheet: HERO_PORTRAIT_SHEETS.mage, width: 64, height: 64 });
    await flushMicrotasks();
    expect(hud.activeCharacterId).toBe('cultivator');
    expect(sprite!.spriteFrame?.texture?.sheet).toBe(HERO_PORTRAIT_SHEETS.cultivator);
  });

  it('renders 64×64 nearest-filtered portrait tabs on the Character Codex and updates the inspected class on focus & save changes', async () => {
    const parent = new MockNode('ui-root');
    const save: SaveData = {
      ...createDefaultSave(),
      chaptersUnlocked: 2, // Ninja + Archer unlocked; Mage + Cultivator locked.
      selectedCharacter: 'ninja',
    };

    const handle = await buildCharacterSelectScreen({
      parent: parent as unknown as Parameters<typeof buildCharacterSelectScreen>[0]['parent'],
      save,
      onSelectCharacter: vi.fn(),
      onUnlockCharacter: vi.fn(),
      onBack: vi.fn(),
    });
    await flushMicrotasks();

    // One crisp 64×64 nearest-filtered portrait per class tab.
    for (const heroId of CHARACTER_IDS) {
      const portraitNode = findNodeByName(parent, `character-portrait-${heroId}`);
      expect(portraitNode, `character-portrait-${heroId}`).not.toBeNull();
      const sprite = portraitNode!.getComponent(MockSprite)!;
      const transform = portraitNode!.getComponent(MockUITransform)!;

      expect(sprite.type).toBe(MockSprite.Type.SIMPLE);
      expect(sprite.sizeMode).toBe(MockSprite.SizeMode.CUSTOM);
      expect(sprite.trim).toBe(false);
      expect([transform.width, transform.height]).toEqual([
        CHARACTER_SELECT_PORTRAIT_SIZE_PX,
        CHARACTER_SELECT_PORTRAIT_SIZE_PX,
      ]);
      expect(transform.width).toBe(64);
      expect(sprite.spriteFrame?.texture?.sheet).toBe(HERO_PORTRAIT_SHEETS[heroId]);
    }

    // Unlocked/selected tabs stay full tint; locked tabs are cool-muted but still crisp.
    expect(
      findNodeByName(parent, 'character-portrait-ninja')!.getComponent(MockSprite)!.color?.r,
    ).toBe(255);
    expect(
      findNodeByName(parent, 'character-portrait-archer')!.getComponent(MockSprite)!.color?.r,
    ).toBe(255);
    expect(
      findNodeByName(parent, 'character-portrait-mage')!.getComponent(MockSprite)!.color?.r,
    ).toBeLessThan(200);
    expect(
      findNodeByName(parent, 'character-portrait-cultivator')!.getComponent(MockSprite)!.color?.r,
    ).toBeLessThan(200);

    const status = findNodeByName(parent, 'codex-status')!.getComponent(MockLabel)!;
    expect(status.string).toContain('NINJA');
    expect(status.string).toContain('ĐANG CHỌN');

    // ArrowDown walks the vertical class tabs and re-inspects each class (locked included).
    dispatchKey('ArrowDown', 40);
    await flushMicrotasks();
    expect(status.string).toContain('CUNG THỦ');
    expect(status.string).toContain('ĐÃ MỞ');

    dispatchKey('ArrowDown', 40);
    await flushMicrotasks();
    expect(status.string).toContain('PHÁP SƯ');
    expect(status.string).toContain('KHÓA');

    dispatchKey('ArrowDown', 40);
    await flushMicrotasks();
    expect(status.string).toContain('TU TIÊN');

    // Left/right cycles the same roster: from Cultivator, right wraps to Ninja.
    dispatchKey('ArrowRight', 39);
    await flushMicrotasks();
    expect(status.string).toContain('NINJA');

    // Saving a new selected character updates the inspected class live.
    handle.setSave({ ...save, chaptersUnlocked: 3, selectedCharacter: 'archer' });
    dispatchKey('ArrowDown', 40);
    await flushMicrotasks();
    expect(status.string).toContain('CUNG THỦ');
    expect(status.string).toContain('ĐANG CHỌN');

    handle.destroy();
  });
  it('renders 64×64 nearest-filtered portrait on Victory & Defeat Results screens for all 4 heroes', async () => {
    for (const [idx, heroId] of CHARACTER_IDS.entries()) {
      const parent = new MockNode(`result-root-${heroId}`);
      const won = idx % 2 === 0;
      const screen = await buildResultScreen({
        parent: parent as unknown as Parameters<typeof buildResultScreen>[0]['parent'],
        result: {
          chapter: idx + 1,
          roomReached: won ? 9 : 5,
          roomsTotal: 9,
          goldEarned: 120,
          goldTotal: 340,
          durationMs: 185_000,
          kills: 92,
          won,
          characterId: heroId,
          deathCause: won ? { kind: 'victory' } : { kind: 'enemy', role: 'caster', elite: false },
          ownedSkills: new Map<string, number>([
            ['shield', 1],
            ['vitality', 2],
            ['aegis-retribution', 1],
          ]),
        },
        onShop: vi.fn(),
        onChapterSelect: vi.fn(),
        onVillage: vi.fn(),
      });
      await flushMicrotasks();

      const portraitNode = findNodeByName(parent, 'result-portrait');
      expect(portraitNode, `${heroId} missing result-portrait`).not.toBeNull();
      const sprite = portraitNode!.getComponent(MockSprite)!;
      const transform = portraitNode!.getComponent(MockUITransform)!;

      expect(sprite.type).toBe(MockSprite.Type.SIMPLE);
      expect(sprite.sizeMode).toBe(MockSprite.SizeMode.CUSTOM);
      expect(sprite.trim).toBe(false);
      expect([transform.width, transform.height]).toEqual([
        RESULT_PORTRAIT_SIZE_PX,
        RESULT_PORTRAIT_SIZE_PX,
      ]);
      expect(transform.width).toBe(64);
      expect(sprite.spriteFrame?.texture?.sheet).toBe(HERO_PORTRAIT_SHEETS[heroId]);

      screen.destroy();
    }
  });
});
