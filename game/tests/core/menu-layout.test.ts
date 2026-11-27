import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOSS_IDS } from '../../assets/scripts/core/boss/boss-defs';
import { CHARACTER_ROSTER } from '../../assets/scripts/core/characters/roster';
import { ENEMY_ROLES, ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../../assets/scripts/core/level/level-data';
import { parseWaterLayout, waterAreasFor } from '../../assets/scripts/core/level/water-layout';
import {
  STAT_UPGRADE_TRACKS,
  UPGRADE_TRACKS,
  UTILITY_UPGRADE_TRACKS,
  maxLevelFor,
} from '../../assets/scripts/core/meta/upgrades';
import {
  MAX_ASCENSION,
  ascensionLabel,
  ascensionSummaryLines,
} from '../../assets/scripts/core/run/ascension';
import { RUN_SAVE_VERSION, type ActiveRunSave } from '../../assets/scripts/core/save/run-save';
import {
  buyCharacter,
  createDefaultSave,
  unlockChapterAscension,
  unlockNextChapter,
  withSelectedCharacter,
} from '../../assets/scripts/core/save/save-data';
import { describeSkill } from '../../assets/scripts/core/skills/description';
import { EVOLUTIONS, evolutionHintsForSkill } from '../../assets/scripts/core/skills/evolutions';
import { SKILLS, getSkill } from '../../assets/scripts/core/skills/pool';
import { letterboxRect, worldToUiScale } from '../../assets/scripts/core/view/letterbox';
import {
  MENU_BACKDROP_ROOM,
  menuBackdropFrame,
  menuFramedPlayerSpot,
  type TileRect,
} from '../../assets/scripts/core/view/menu-backdrop';
import {
  ASCENSION_SUMMARY_MAX_CHARS,
  FOCUS_RING_EXPAND_PX,
  MENU_COLUMN_WIDTH,
  PANEL_SHADOW_EXPAND_PX,
  RESULT_LINE_MAX_CHARS,
  SHOP_CHARACTER_START_INDEX,
  SHOP_CHAR_SELECT_BUTTON_INDEX,
  SHOP_UNLOCK_CHARACTER_IDS,
  THEME_WOOD_BORDERS,
  characterShopRow,
  computeChapterSelectLayout,
  computeCharacterSelectLayout,
  computeMenuButtonTextLayout,
  computeMenuScreenLayout,
  computeResultScreenLayout,
  computeShopScreenLayout,
  computeSkillCardLayout,
  formatChapterAscensionHint,
  formatChapterButtonDetail,
  formatCharacterPrimaryAction,
  formatCharacterSummaryLines,
  formatContinueRunDetail,
  formatResultScreenSummary,
  formatShopBonusSummary,
  formatTitleCharacterDetail,
  formatTitleCharacterLabel,
  formatTitleInfoLines,
  nextChapterSelectFocus,
  nextCharacterSelectFocus,
  nextResultScreenFocus,
  nextShopScreenFocus,
  resolveMenuButtonVisualState,
  toOwnedSkillsMap,
  upgradeRow,
} from '../../assets/scripts/core/view/menu-layout';
import { buildSkillCodex } from '../../assets/scripts/core/view/skill-codex';
import { readPng } from '../../scripts/lib/png';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', 'assets');
const UI_THEME_WOOD = join(ASSETS, 'resources', 'art', 'ui', 'theme-wood');
const DESIGN_WIDTH = ROOM_COLS * TILE_SIZE_PX;
const DESIGN_HEIGHT = ROOM_ROWS * TILE_SIZE_PX;

const TARGET_VIEWPORTS = [
  { label: '1920x1080 (16:9)', width: 1920, height: 1080 },
  { label: '1280x720 (16:9)', width: 1280, height: 720 },
  { label: '1280x800 (16:10)', width: 1280, height: 800 },
  { label: '1024x768 (4:3)', width: 1024, height: 768 },
] as const;

/** Same conservative glyph width estimator `game/ui-text.ts` uses when checking `insideParent`. */
const GLYPH_WIDTH_RATIO = 0.62;
/** Runtime bounding-box height factor of `NormalFont.ttf` in Cocos (`~1.48 × fontSize`). */
const FONT_BOX_HEIGHT_RATIO = 1.5;

function localKeepOutForScale(worldScale: number): TileRect {
  const scale = Number.isFinite(worldScale) && worldScale > 0 ? Math.min(1, worldScale) : 1;
  const widthTiles = MENU_COLUMN_WIDTH / (TILE_SIZE_PX * scale);
  const left = Math.floor(ROOM_COLS / 2 - widthTiles / 2);
  const right = Math.ceil(ROOM_COLS / 2 + widthTiles / 2);
  return { x: left, y: 0, width: right - left, height: ROOM_ROWS };
}

function clearOf(point: { readonly x: number; readonly y: number }, rect: TileRect, margin: number): boolean {
  return (
    point.x <= rect.x - margin ||
    point.x >= rect.x + rect.width + margin ||
    point.y <= rect.y - margin ||
    point.y >= rect.y + rect.height + margin
  );
}

function makeSampleActiveRun(overrides: Partial<ActiveRunSave> = {}): ActiveRunSave {
  return {
    version: RUN_SAVE_VERSION,
    seed: 123456789,
    chapter: 3,
    roomIndex: 6,
    chosenDoor: 'xp',
    drawnRooms: [1, 2, 3, 4, 5, 6, 7, 8, 17],
    bossId: 'samurai',
    characterId: 'cultivator',
    hearts: 5,
    maxHearts: 7,
    xpLevel: 8,
    xpCurrent: 12,
    xpTotal: 190,
    pendingLevelUps: 0,
    ownedSkills: { sharpen: 2 },
    rerollsUsed: 1,
    freeRerollsLeft: 2,
    goldEarned: 145,
    kills: 112,
    elapsedMs: 185000,
    ascension: 4,
    endlessLoop: 2,
    ...overrides,
  };
}

describe('Theme Wood UI assets & 9-slice invariants', () => {
  const EXPECTED_SPRITES = [
    { file: 'button_normal.png', width: 16, height: 8 },
    { file: 'button_hover.png', width: 16, height: 8 },
    { file: 'button_pressed.png', width: 16, height: 8 },
    { file: 'button_disabled.png', width: 16, height: 8 },
    { file: 'nine_path_panel_interior.png', width: 16, height: 16 },
    { file: 'nine_path_bg_2.png', width: 16, height: 16 },
    { file: 'nine_path_focus.png', width: 8, height: 8 },
  ] as const;

  it('every Theme Wood sprite used by menus exists with exact dimensions and valid image .meta', () => {
    for (const spec of EXPECTED_SPRITES) {
      const path = join(UI_THEME_WOOD, spec.file);
      expect(existsSync(path), `${spec.file} missing`).toBe(true);
      expect(existsSync(`${path}.meta`), `${spec.file}.meta missing`).toBe(true);

      const png = readPng(path);
      expect([png.width, png.height], spec.file).toEqual([spec.width, spec.height]);

      const meta = JSON.parse(readFileSync(`${path}.meta`, 'utf8')) as { importer?: string };
      expect(meta.importer, `${spec.file}.meta importer`).toBe('image');
    }
  });

  it('nine_path_focus.png has a transparent 2×2 centre matching 3px 9-slice insets', () => {
    const png = readPng(join(UI_THEME_WOOD, 'nine_path_focus.png'));
    const { left, right, top, bottom } = THEME_WOOD_BORDERS.focus;
    expect(left + right).toBeLessThan(png.width);
    expect(top + bottom).toBeLessThan(png.height);

    for (let y = top; y < png.height - bottom; y += 1) {
      for (let x = left; x < png.width - right; x += 1) {
        const alpha = png.data[(y * png.width + x) * 4 + 3];
        expect(alpha, `centre (${x},${y}) must be transparent`).toBe(0);
      }
    }
  });
});

describe('resolveMenuButtonVisualState — unmistakable button states', () => {
  it('distinguishes normal, focused, hovered, pressed, disabled, and disabled-focused', () => {
    const normal = resolveMenuButtonVisualState({
      disabled: false,
      focused: false,
      hovered: false,
      pressed: false,
    });
    const focused = resolveMenuButtonVisualState({
      disabled: false,
      focused: true,
      hovered: false,
      pressed: false,
    });
    const hovered = resolveMenuButtonVisualState({
      disabled: false,
      focused: true,
      hovered: true,
      pressed: false,
    });
    const pressed = resolveMenuButtonVisualState({
      disabled: false,
      focused: true,
      hovered: true,
      pressed: true,
    });
    const disabled = resolveMenuButtonVisualState({
      disabled: true,
      focused: false,
      hovered: false,
      pressed: false,
    });
    const disabledFocused = resolveMenuButtonVisualState({
      disabled: true,
      focused: true,
      hovered: true,
      pressed: true,
    });

    expect(normal).toEqual({
      state: 'normal',
      frame: 'normal',
      showFocusRing: false,
      focusRingStyle: 'none',
      contentOffsetY: 0,
    });
    expect(focused).toEqual({
      state: 'focused',
      frame: 'hover',
      showFocusRing: true,
      focusRingStyle: 'gold',
      contentOffsetY: 0,
    });
    expect(hovered).toEqual({
      state: 'hovered',
      frame: 'hover',
      showFocusRing: true,
      focusRingStyle: 'gleam',
      contentOffsetY: 0,
    });
    expect(pressed).toEqual({
      state: 'pressed',
      frame: 'pressed',
      showFocusRing: true,
      focusRingStyle: 'gleam',
      contentOffsetY: -1,
    });
    expect(disabled).toEqual({
      state: 'disabled',
      frame: 'disabled',
      showFocusRing: false,
      focusRingStyle: 'none',
      contentOffsetY: 0,
    });
    expect(disabledFocused).toEqual({
      state: 'disabled-focused',
      frame: 'disabled',
      showFocusRing: true,
      focusRingStyle: 'muted',
      contentOffsetY: 0,
    });

    const states = new Set([
      normal.state,
      focused.state,
      hovered.state,
      pressed.state,
      disabled.state,
      disabledFocused.state,
    ]);
    expect(states.size).toBe(6);
  });
});

describe('computeMenuButtonTextLayout — internal padding and subtitle fit', () => {
  const TWO_LINE_CASES = [
    {
      screen: 'Title (standard 5 buttons)',
      width: MENU_COLUMN_WIDTH - 28,
      height: 31,
      fontSize: 11,
      labels: [
        'Play',
        ...CHARACTER_ROSTER.map((c) => formatTitleCharacterLabel(c)),
        'Meta shop',
        'Settings',
        'Credits',
      ],
      details: [
        'Choose a chapter',
        ...CHARACTER_ROSTER.map((c) => formatTitleCharacterDetail(c, 1)),
        ...CHARACTER_ROSTER.map((c) => formatTitleCharacterDetail(c, 4)),
        'Stats, utilities & heroes',
        'Music, SFX, display, effects',
      ],
    },
    {
      screen: 'Title (with Continue Run, 6 buttons)',
      width: MENU_COLUMN_WIDTH - 28,
      height: 29,
      fontSize: 10,
      labels: [
        'Continue Run',
        'Play',
        ...CHARACTER_ROSTER.map((c) => formatTitleCharacterLabel(c)),
        'Meta shop',
        'Settings',
        'Credits',
      ],
      details: [
        ...CHARACTER_ROSTER.map((c) =>
          formatContinueRunDetail(
            makeSampleActiveRun({
              characterId: c.id,
              chapter: 4,
              roomIndex: 9,
              ascension: 5,
              endlessLoop: 12,
            }),
          ),
        ),
        'Choose a chapter',
        'Stats, utilities & heroes',
        'Music, SFX, display, effects',
      ],
    },
    {
      screen: 'Chapter Select',
      width: MENU_COLUMN_WIDTH - 28,
      height: 29,
      fontSize: 10,
      labels: ['Chapter 1', 'Chapter 4'],
      details: [
        'Enter chapter',
        'Enter · Ascension 5',
        'Enter · Max A5',
        'Locked — clear previous',
        'No data',
      ],
    },
    {
      screen: 'Meta Shop (three-column rows)',
      width: 156,
      height: 35,
      fontSize: 10,
      labels: [
        'Fire rate   Lv 10/10',
        'Free rerolls   Lv 3/3',
        'Cultivator — UNLOCKED',
        'Cultivator — 350g',
      ],
      details: [
        'Next: 500g · need 500g',
        'Next: 500 gold',
        'Maxed out',
        'Buy early (or clear Ch3)',
        'Need 350g (or clear Ch3)',
        'Unlocked (Chapter 3 cleared)',
      ],
    },
    {
      screen: 'Pause (Music & SFX rows)',
      width: 312,
      height: 31,
      fontSize: 11,
      labels: ['Restart run', 'Music   100%', 'SFX   100%'],
      details: ['New run, keep gold earned', 'Left / Right or click (+10%)'],
    },
    {
      screen: 'Result (Continue Endless & footer buttons)',
      width: 138,
      height: 29,
      fontSize: 10,
      labels: ['Meta shop', 'Chapter select', 'Title'],
      details: ['Spend gold earned', 'Try another chapter', 'Back to main menu'],
    },
  ] as const;

  it('keeps label and detail strictly inside button borders with clean vertical separation', () => {
    for (const spec of TWO_LINE_CASES) {
      const layout = computeMenuButtonTextLayout({
        width: spec.width,
        height: spec.height,
        fontSize: spec.fontSize,
        hasDetail: true,
      });

      const halfH = spec.height / 2;
      const labelHalfH = (layout.labelFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
      const detailHalfH = (layout.detailFontSize * FONT_BOX_HEIGHT_RATIO) / 2;

      expect(layout.labelY + labelHalfH, `${spec.screen} label top`).toBeLessThanOrEqual(halfH - 1);
      expect(layout.detailY - detailHalfH, `${spec.screen} detail bottom`).toBeGreaterThanOrEqual(
        -halfH + 2,
      );
      expect(layout.labelY - layout.detailY, `${spec.screen} line separation`).toBeGreaterThanOrEqual(
        12,
      );

      for (const text of spec.labels) {
        const estimatedW = text.length * layout.labelFontSize * GLYPH_WIDTH_RATIO;
        expect(estimatedW, `${spec.screen} label "${text}"`).toBeLessThanOrEqual(
          layout.safeTextWidth,
        );
      }
      for (const text of spec.details) {
        const estimatedW = text.length * layout.detailFontSize * GLYPH_WIDTH_RATIO;
        expect(estimatedW, `${spec.screen} detail "${text}"`).toBeLessThanOrEqual(
          layout.safeTextWidth,
        );
      }
    }
  });

  it('centres single-line buttons cleanly (Settings 22px, Ascension < / > 28×22, Back 28px, Credits 30px)', () => {
    for (const [width, height, fontSize, sampleText] of [
      [28, 22, 10, '<'],
      [316, 22, 10, 'Damage numbers   OFF'],
      [280, 24, 11, 'Music   100%'],
      [184, 28, 10, 'Character select'],
      [280, 30, 11, 'Back'],
    ] as const) {
      const layout = computeMenuButtonTextLayout({
        width,
        height,
        fontSize,
        hasDetail: false,
      });
      expect(layout.labelY).toBe(0);
      const labelHalfH = (layout.labelFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
      expect(labelHalfH).toBeLessThanOrEqual(height / 2 - 2);
      expect(sampleText.length * layout.labelFontSize * GLYPH_WIDTH_RATIO).toBeLessThanOrEqual(
        layout.safeTextWidth,
      );
    }
  });
});

describe('computeMenuScreenLayout & computeSkillCardLayout — viewport bounds audit', () => {
  const SCREEN_SPECS = [
    {
      name: 'Title (no activeRun)',
      hasSubtitle: true,
      infoCount: 2,
      buttonHeights: [31, 31, 31, 31, 31],
      buttonGap: 5,
      panelWidth: MENU_COLUMN_WIDTH,
      panelFullHeight: true,
    },
    {
      name: 'Title (with Continue Run)',
      titleFontSize: 20,
      hasSubtitle: true,
      infoCount: 1,
      buttonHeights: [29, 29, 29, 29, 29, 29],
      buttonGap: 3,
      panelWidth: MENU_COLUMN_WIDTH,
      panelFullHeight: true,
    },
    {
      name: 'Settings (8 rows: Music + SFX + toggles + Language + Back)',
      titleFontSize: 20,
      hasSubtitle: true,
      infoCount: 1,
      buttonHeights: [20, 20, 20, 20, 20, 20, 20, 20],
      buttonGap: 2,
      panelWidth: 468,
      panelFullHeight: false,
    },
    {
      name: 'Pause (5 rows: Resume, Restart, Music, SFX, Quit)',
      hasSubtitle: true,
      infoCount: 0,
      buttonHeights: [31, 31, 31, 31, 31],
      buttonGap: 5,
      panelWidth: 364,
      panelFullHeight: false,
    },
    {
      name: 'Credits',
      hasSubtitle: true,
      infoCount: 6,
      buttonHeights: [30, 30],
      buttonGap: 6,
      panelWidth: 412,
      panelFullHeight: false,
    },
  ] as const;

  it('keeps every menu plaque, shadow, header, button, and hint strictly inside the UI band at 1920×1080, 1280×720, 1280×800, and 1024×768', () => {
    for (const vp of TARGET_VIEWPORTS) {
      const band = letterboxRect(vp.width, vp.height, DESIGN_WIDTH, DESIGN_HEIGHT);
      expect(band.width).toBeGreaterThan(0);
      expect(band.height).toBeGreaterThan(0);

      for (const spec of SCREEN_SPECS) {
        const layout = computeMenuScreenLayout({
          visibleWidth: DESIGN_WIDTH,
          visibleHeight: DESIGN_HEIGHT,
          ...('titleFontSize' in spec ? { titleFontSize: spec.titleFontSize } : {}),
          hasSubtitle: spec.hasSubtitle,
          infoCount: spec.infoCount,
          buttonHeights: spec.buttonHeights,
          buttonGap: spec.buttonGap,
          panelWidth: spec.panelWidth,
          panelFullHeight: spec.panelFullHeight,
        });

        const halfCanvasW = DESIGN_WIDTH / 2;
        const halfCanvasH = DESIGN_HEIGHT / 2;
        const shadowHalfW = (layout.panelWidth + PANEL_SHADOW_EXPAND_PX) / 2;
        const shadowTop = layout.panelY + (layout.panelHeight + PANEL_SHADOW_EXPAND_PX) / 2 - 1;
        const shadowBottom = layout.panelY - (layout.panelHeight + PANEL_SHADOW_EXPAND_PX) / 2 - 1;

        expect(shadowHalfW, `${vp.label} ${spec.name} width`).toBeLessThanOrEqual(halfCanvasW);
        expect(shadowTop, `${vp.label} ${spec.name} top`).toBeLessThanOrEqual(halfCanvasH);
        expect(shadowBottom, `${vp.label} ${spec.name} bottom`).toBeGreaterThanOrEqual(-halfCanvasH);

        const panelTop = layout.panelY + layout.panelHeight / 2;
        const panelBottom = layout.panelY - layout.panelHeight / 2;
        expect(layout.titleY + layout.titleFontSize * 0.75, `${spec.name} title top`).toBeLessThanOrEqual(
          panelTop,
        );
        if (layout.subtitleY !== null) {
          expect(layout.subtitleY).toBeLessThan(layout.titleY);
          expect(layout.dividerY).toBeLessThan(layout.subtitleY);
        }
        if (layout.infoYs.length > 0) {
          expect(layout.dividerY).toBeLessThan(layout.infoYs[layout.infoYs.length - 1]!);
        }

        const firstButtonTop = layout.buttonYs[0]! + spec.buttonHeights[0]! / 2;
        const lastIdx = spec.buttonHeights.length - 1;
        const lastButtonBottom = layout.buttonYs[lastIdx]! - spec.buttonHeights[lastIdx]! / 2;
        expect(firstButtonTop, `${spec.name} buttons below divider`).toBeLessThan(layout.dividerY - 2);
        expect(lastButtonBottom, `${spec.name} buttons above hint`).toBeGreaterThan(
          layout.hintY + layout.hintFontSize * 0.6,
        );
        expect(layout.hintY - layout.hintFontSize * 0.75, `${spec.name} hint inside panel`).toBeGreaterThanOrEqual(
          panelBottom + 2,
        );
      }
    }
  });

  it('formats Continue Run subtitle and Title info lines within column bounds (vi & en)', () => {
    expect(
      formatContinueRunDetail(
        makeSampleActiveRun({ characterId: 'ninja', chapter: 1, roomIndex: 2, ascension: 0, endlessLoop: 0 }),
      ),
    ).toBe('Ninja · Ch1 P2');
    expect(
      formatContinueRunDetail(
        makeSampleActiveRun({ characterId: 'archer', chapter: 2, roomIndex: 5, ascension: 3, endlessLoop: 0 }),
      ),
    ).toBe('Cung Thủ · Ch2 P5 · A3');
    expect(
      formatContinueRunDetail(
        makeSampleActiveRun({ characterId: 'cultivator', chapter: 4, roomIndex: 9, ascension: 5, endlessLoop: 2 }),
      ),
    ).toBe('Tu Tiên · Ch4 P9 · A5 · E2');

    expect(
      formatContinueRunDetail(
        makeSampleActiveRun({ characterId: 'ninja', chapter: 1, roomIndex: 2, ascension: 0, endlessLoop: 0 }),
        'en',
      ),
    ).toBe('Ninja · Ch1 R2');
    expect(
      formatContinueRunDetail(
        makeSampleActiveRun({ characterId: 'archer', chapter: 2, roomIndex: 5, ascension: 3, endlessLoop: 0 }),
        'en',
      ),
    ).toBe('Archer · Ch2 R5 · A3');
    expect(
      formatContinueRunDetail(
        makeSampleActiveRun({ characterId: 'cultivator', chapter: 4, roomIndex: 9, ascension: 5, endlessLoop: 2 }),
        'en',
      ),
    ).toBe('Cultivator · Ch4 R9 · A5 · E2');

    const compactInfoVi = formatTitleInfoLines(
      99999,
      { chapter: 4, room: 9 },
      'Kỷ lục: Chương 4 · Phòng 9',
      true,
    );
    expect(compactInfoVi).toEqual(['Vàng 99999 · Kỷ lục Ch4 P9']);
    expect(compactInfoVi[0]!.length * 9 * GLYPH_WIDTH_RATIO).toBeLessThanOrEqual(
      MENU_COLUMN_WIDTH - 30,
    );

    const compactInfoEn = formatTitleInfoLines(
      99999,
      { chapter: 4, room: 9 },
      'Best: chapter 4 · room 9',
      true,
      'en',
    );
    expect(compactInfoEn).toEqual(['Gold 99999 · Best Ch4 R9']);
    expect(compactInfoEn[0]!.length * 9 * GLYPH_WIDTH_RATIO).toBeLessThanOrEqual(
      MENU_COLUMN_WIDTH - 30,
    );
  });

  it('fits 3 skill cards with focus rings, all skill/Evolution labels, pairing hints, and Gold Reroll inside 512×288 across all viewports', () => {
    const layout = computeSkillCardLayout(3);
    const leftEdge = layout.cardXs[0]! - (layout.cardWidth + FOCUS_RING_EXPAND_PX) / 2;
    const rightEdge = layout.cardXs[2]! + (layout.cardWidth + FOCUS_RING_EXPAND_PX) / 2;
    const bottomEdge = layout.cardY - (layout.cardHeight + FOCUS_RING_EXPAND_PX) / 2;
    const topEdge = layout.cardY + (layout.cardHeight + FOCUS_RING_EXPAND_PX) / 2;

    expect(leftEdge).toBeGreaterThanOrEqual(-DESIGN_WIDTH / 2 + 8);
    expect(rightEdge).toBeLessThanOrEqual(DESIGN_WIDTH / 2 - 8);
    expect(bottomEdge).toBeGreaterThanOrEqual(-DESIGN_HEIGHT / 2 + 8);
    expect(topEdge).toBeLessThan(layout.subtitleY - 10);

    expect(layout.pairHintY).toBeLessThan(layout.effectY - layout.effectHeight / 2);
    expect(layout.pairHintY).toBeGreaterThan(layout.stackY + 8);
    expect(layout.stackY - 6).toBeGreaterThan(-layout.cardHeight / 2 + 5);

    const rerollTopEdge = layout.rerollY + (layout.rerollHeight + FOCUS_RING_EXPAND_PX) / 2;
    const rerollBottomEdge = layout.rerollY - (layout.rerollHeight + FOCUS_RING_EXPAND_PX) / 2;
    expect(rerollTopEdge).toBeLessThanOrEqual(bottomEdge - 4);
    expect(rerollBottomEdge).toBeGreaterThanOrEqual(-DESIGN_HEIGHT / 2 + 6);
    expect((layout.rerollWidth + FOCUS_RING_EXPAND_PX) / 2).toBeLessThanOrEqual(
      DESIGN_WIDTH / 2 - 8,
    );

    const rerollText = computeMenuButtonTextLayout({
      width: layout.rerollWidth,
      height: layout.rerollHeight,
      fontSize: 11,
      hasDetail: true,
    });
    for (const labelText of [
      'Free Reroll (R) · 3 left',
      'Reroll (R) — 10g',
      'Reroll (R) — 120g',
      'Reroll (R)',
    ]) {
      expect(labelText.length * rerollText.labelFontSize * GLYPH_WIDTH_RATIO).toBeLessThanOrEqual(
        rerollText.safeTextWidth,
      );
    }
    for (const detailText of [
      'Gold: 9999g',
      'Gold: 5g — Not enough gold',
      'No alternative skills',
    ]) {
      expect(detailText.length * rerollText.detailFontSize * GLYPH_WIDTH_RATIO).toBeLessThanOrEqual(
        rerollText.safeTextWidth,
      );
    }

    for (const vp of TARGET_VIEWPORTS) {
      const band = letterboxRect(vp.width, vp.height, DESIGN_WIDTH, DESIGN_HEIGHT);
      expect(band.width).toBeGreaterThan(0);
      expect(band.height).toBeGreaterThan(0);
    }

    for (const card of [...SKILLS, ...EVOLUTIONS]) {
      const nameW = card.name.length * 12 * GLYPH_WIDTH_RATIO;
      expect(nameW, `card "${card.name}"`).toBeLessThanOrEqual(layout.cardWidth - 16);

      const maxChars = Math.floor(layout.effectWidth / (layout.effectFontSize * GLYPH_WIDTH_RATIO));
      let lines = 1;
      let lineLen = 0;
      for (const word of describeSkill(card).split(/\s+/)) {
        if (lineLen === 0) lineLen = word.length;
        else if (lineLen + 1 + word.length <= maxChars) lineLen += 1 + word.length;
        else {
          lines += 1;
          lineLen = word.length;
        }
      }
      const wrappedHeight = lines * layout.effectLineHeight;
      const effectTop = layout.effectY + wrappedHeight / 2;
      const effectBottom = layout.effectY - wrappedHeight / 2;
      expect(effectTop, `effect top for ${card.id}`).toBeLessThanOrEqual(layout.accentY - 2);
      expect(effectBottom, `effect bottom for ${card.id}`).toBeGreaterThanOrEqual(
        layout.pairHintY + 5,
      );
    }

    for (const skill of SKILLS) {
      for (const partnerOwned of [false, true]) {
        const fakeOwned = new Map<string, number>();
        if (partnerOwned) {
          for (const hint of evolutionHintsForSkill(skill.id, new Map())) {
            fakeOwned.set(hint.partnerId, 1);
          }
        }
        for (const hint of evolutionHintsForSkill(skill.id, fakeOwned)) {
          const hintW = hint.text.length * 8 * GLYPH_WIDTH_RATIO;
          expect(hintW, `hint "${hint.text}"`).toBeLessThanOrEqual(layout.cardWidth - 18);
        }
      }
    }
    for (const evo of EVOLUTIONS) {
      const recipe = `${getSkill(evo.requires[0]).name} + ${getSkill(evo.requires[1]).name}`;
      expect(recipe.length * 8 * GLYPH_WIDTH_RATIO, recipe).toBeLessThanOrEqual(
        layout.cardWidth - 18,
      );
    }
  });
});

describe('menuBackdropFrame & menuFramedPlayerSpot — living scene framing across Ch1–Ch4', () => {
  const waterLayout = parseWaterLayout(
    JSON.parse(readFileSync(join(ASSETS, 'resources', 'data', 'water-layout.json'), 'utf8')) as unknown,
  );

  it('keeps single-screen 32×18 rooms unshifted at (0, 0, 32×18)', () => {
    const frame = menuBackdropFrame({
      playerStart: { x: 16, y: 15 },
      obstacles: [],
      size: { cols: 32, rows: 18 },
    });
    expect(frame).toEqual({ x: 0, y: 0, width: 32, height: 18 });
  });

  it('frames an interior 32×18 scene in Room 1 of Chapters 1–4 with a visible, obstacle-clear character spot across all target viewports', () => {
    for (const chapter of [1, 2, 3, 4]) {
      const levels = loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`));
      const room = levels.find((entry) => entry.room === MENU_BACKDROP_ROOM);
      expect(room, `chapter ${chapter} room 1`).toBeDefined();
      if (room === undefined) continue;

      const waterAreas = waterAreasFor(waterLayout, chapter, MENU_BACKDROP_ROOM);

      for (const vp of TARGET_VIEWPORTS) {
        const worldScale = worldToUiScale(vp.width, vp.height, DESIGN_WIDTH, DESIGN_HEIGHT);
        const localKeepOut = localKeepOutForScale(worldScale);
        const frame = menuBackdropFrame(room, {
          waterAreas,
          columnWidthTiles: Math.max(20, localKeepOut.width),
        });

        expect(frame.width).toBe(ROOM_COLS);
        expect(frame.height).toBe(ROOM_ROWS);
        expect(Number.isInteger(frame.x)).toBe(true);
        expect(Number.isInteger(frame.y)).toBe(true);
        expect(frame.x, `ch${chapter} frame.x`).toBeGreaterThanOrEqual(3);
        expect(frame.x + frame.width, `ch${chapter} frame right`).toBeLessThanOrEqual(
          room.size.cols - 3,
        );
        expect(frame.y, `ch${chapter} frame.y`).toBeGreaterThanOrEqual(3);
        expect(frame.y + frame.height, `ch${chapter} frame bottom`).toBeLessThanOrEqual(
          room.size.rows - 3,
        );

        const spot = menuFramedPlayerSpot(room, frame, localKeepOut, waterAreas);
        const viewX = spot.x - frame.x;
        const viewY = spot.y - frame.y;

        expect(viewX, `ch${chapter} ${vp.label} viewX`).toBeGreaterThanOrEqual(2);
        expect(viewX, `ch${chapter} ${vp.label} viewX`).toBeLessThanOrEqual(ROOM_COLS - 2);
        expect(viewY, `ch${chapter} ${vp.label} viewY`).toBeGreaterThanOrEqual(3);
        expect(viewY, `ch${chapter} ${vp.label} viewY`).toBeLessThanOrEqual(ROOM_ROWS - 2);
        expect(
          clearOf({ x: viewX, y: viewY }, localKeepOut, 1),
          `ch${chapter} ${vp.label} clear of column`,
        ).toBe(true);

        for (const obstacle of room.obstacles) {
          expect(
            clearOf(spot, obstacle, 1),
            `ch${chapter} ${vp.label} clear of obstacle ${JSON.stringify(obstacle)}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('M15 Chapter Select + Ascension 0–5 selector layout & bounds audit', () => {
  it('fits 4 chapters, < / > Ascension selector, 3 summary lines, Back, and hint inside MENU_COLUMN_WIDTH across all 4 viewports with zero overlap', () => {
    for (const vp of TARGET_VIEWPORTS) {
      const band = letterboxRect(vp.width, vp.height, DESIGN_WIDTH, DESIGN_HEIGHT);
      expect(band.width).toBeGreaterThan(0);

      const layout = computeChapterSelectLayout({
        visibleWidth: DESIGN_WIDTH,
        visibleHeight: DESIGN_HEIGHT,
        chapterCount: 4,
      });

      expect(layout.panelWidth).toBe(MENU_COLUMN_WIDTH);
      const panelTop = layout.panelY + layout.panelHeight / 2;
      const panelBottom = layout.panelY - layout.panelHeight / 2;

      const titleTop = layout.titleY + (layout.titleFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
      const titleBottom = layout.titleY - (layout.titleFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
      const bestTop = layout.bestY + (layout.bestFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
      const bestBottom = layout.bestY - (layout.bestFontSize * FONT_BOX_HEIGHT_RATIO) / 2;

      expect(titleTop, `${vp.label} titleTop`).toBeLessThanOrEqual(panelTop - 2);
      expect(bestTop, `${vp.label} best below title`).toBeLessThan(titleBottom);
      expect(layout.dividerY, `${vp.label} divider below best`).toBeLessThan(bestBottom);

      const ch0TopRing =
        layout.chapterSlots[0]!.y + (layout.chapterSlots[0]!.height + FOCUS_RING_EXPAND_PX) / 2;
      const ch3BottomRing =
        layout.chapterSlots[3]!.y - (layout.chapterSlots[3]!.height + FOCUS_RING_EXPAND_PX) / 2;
      expect(ch0TopRing).toBeLessThanOrEqual(layout.dividerY - 2);

      const ascTopRing =
        layout.ascensionPrevButton.y +
        (layout.ascensionPrevButton.height + FOCUS_RING_EXPAND_PX) / 2;
      const ascBottomRing =
        layout.ascensionPrevButton.y -
        (layout.ascensionPrevButton.height + FOCUS_RING_EXPAND_PX) / 2;
      expect(ascTopRing, `${vp.label} ascension below ch4`).toBeLessThan(ch3BottomRing);

      // Horizontal clearance between < button, Ascension label, and > button.
      const prevRight =
        layout.ascensionPrevButton.x +
        (layout.ascensionPrevButton.width + FOCUS_RING_EXPAND_PX) / 2;
      const nextLeft =
        layout.ascensionNextButton.x -
        (layout.ascensionNextButton.width + FOCUS_RING_EXPAND_PX) / 2;
      expect(nextLeft - prevRight).toBeGreaterThanOrEqual(layout.ascensionLabelSafeWidth - 8);

      const summaryHalfH = (layout.summaryFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
      expect(layout.summaryLineYs[0] + summaryHalfH).toBeLessThan(ascBottomRing);
      expect(layout.summaryLineYs[1] + summaryHalfH).toBeLessThan(
        layout.summaryLineYs[0] - summaryHalfH,
      );
      expect(layout.summaryLineYs[2] + summaryHalfH).toBeLessThan(
        layout.summaryLineYs[1] - summaryHalfH,
      );

      const backTopRing =
        layout.backButton.y + (layout.backButton.height + FOCUS_RING_EXPAND_PX) / 2;
      const backBottomRing =
        layout.backButton.y - (layout.backButton.height + FOCUS_RING_EXPAND_PX) / 2;
      expect(backTopRing).toBeLessThan(layout.summaryLineYs[2] - summaryHalfH);

      const hintHalfH = (layout.hintFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
      expect(layout.hintY + hintHalfH).toBeLessThan(backBottomRing);
      expect(layout.hintY - hintHalfH).toBeGreaterThanOrEqual(panelBottom + 2);
    }
  });

  it('fits every Ascension tier label, summary line (0..5), chapter detail, and unlock hint without horizontal clipping', () => {
    const layout = computeChapterSelectLayout({ chapterCount: 4 });

    for (let tier = 0; tier <= MAX_ASCENSION; tier += 1) {
      const label = ascensionLabel(tier);
      expect(
        label.length * layout.ascensionLabelFontSize * GLYPH_WIDTH_RATIO,
        `ascension label "${label}"`,
      ).toBeLessThanOrEqual(layout.ascensionLabelSafeWidth);

      const lines = ascensionSummaryLines(tier, ASCENSION_SUMMARY_MAX_CHARS);
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const line of lines) {
        expect(
          line.length * layout.summaryFontSize * GLYPH_WIDTH_RATIO,
          `tier ${tier} summary "${line}"`,
        ).toBeLessThanOrEqual(layout.summarySafeWidth);
      }

      const hint = formatChapterAscensionHint(true, tier);
      expect(hint.length * layout.hintFontSize * GLYPH_WIDTH_RATIO, `hint "${hint}"`).toBeLessThanOrEqual(
        layout.dividerWidth,
      );
    }

    const lockedHint = formatChapterAscensionHint(false, 0);
    expect(lockedHint.length * layout.hintFontSize * GLYPH_WIDTH_RATIO).toBeLessThanOrEqual(
      layout.dividerWidth,
    );
    expect(formatChapterButtonDetail(true, true, true, 3, 5)).toBe('Vào · Thăng Hoa 3');
    expect(formatChapterButtonDetail(true, true, false, 3, 4)).toBe('Vào · Tối đa A4');
    expect(formatChapterButtonDetail(false, true, false, 0, 0)).toBe('Khóa — vượt chương trước');
    expect(formatChapterButtonDetail(true, true, true, 3, 5, 'en')).toBe('Enter · Ascension 3');
    expect(formatChapterButtonDetail(true, true, false, 3, 4, 'en')).toBe('Enter · Max A4');
    expect(formatChapterButtonDetail(false, true, false, 0, 0, 'en')).toBe(
      'Locked — clear previous',
    );

    // Focus navigation across chapters, <, >, and Back.
    expect(nextChapterSelectFocus(0, 'down', 4)).toBe(1);
    expect(nextChapterSelectFocus(3, 'down', 4)).toBe(4); // <
    expect(nextChapterSelectFocus(4, 'right', 4)).toBe(5); // >
    expect(nextChapterSelectFocus(5, 'down', 4)).toBe(6); // Back
    expect(nextChapterSelectFocus(6, 'up', 4)).toBe(4);
  });
});

describe('M20 Character Detail & Skill Codex layout — 4 class tabs, stats, passive/active cards, exclusive-skill grid & Evolution', () => {
  const waterLayout = parseWaterLayout(
    JSON.parse(readFileSync(join(ASSETS, 'resources', 'data', 'water-layout.json'), 'utf8')) as unknown,
  );

  it('fits the panel, 4 stacked 64×64 tabs, skill grid, Evolution card and buttons inside 512×288 while keeping the live preview hero uncovered', () => {
    const ch1Room1 = loadTmxLevels(join(LEVELS_ROOT, 'chapter-1')).find(
      (entry) => entry.room === MENU_BACKDROP_ROOM,
    )!;
    const ch1Water = waterAreasFor(waterLayout, 1, MENU_BACKDROP_ROOM);

    for (const vp of TARGET_VIEWPORTS) {
      const band = letterboxRect(vp.width, vp.height, DESIGN_WIDTH, DESIGN_HEIGHT);
      expect(band.width).toBeGreaterThan(0);
      expect(band.height).toBeGreaterThan(0);

      const layout = computeCharacterSelectLayout({
        visibleWidth: DESIGN_WIDTH,
        visibleHeight: DESIGN_HEIGHT,
      });

      const halfW = DESIGN_WIDTH / 2;
      const halfH = DESIGN_HEIGHT / 2;
      const shadowLeft = layout.panelX - (layout.panelWidth + PANEL_SHADOW_EXPAND_PX) / 2;
      const shadowRight = layout.panelX + (layout.panelWidth + PANEL_SHADOW_EXPAND_PX) / 2;
      const shadowTop = layout.panelY + (layout.panelHeight + PANEL_SHADOW_EXPAND_PX) / 2 - 1;
      const shadowBottom = layout.panelY - (layout.panelHeight + PANEL_SHADOW_EXPAND_PX) / 2 - 1;

      expect(shadowLeft, `${vp.label} shadowLeft`).toBeGreaterThanOrEqual(-halfW);
      expect(shadowRight, `${vp.label} shadowRight`).toBeLessThanOrEqual(halfW);
      expect(shadowTop, `${vp.label} shadowTop`).toBeLessThanOrEqual(halfH);
      expect(shadowBottom, `${vp.label} shadowBottom`).toBeGreaterThanOrEqual(-halfH);

      // Right panel leaves the middle of the stage open for the live rigged preview actor.
      expect(layout.panelX - layout.panelWidth / 2).toBeGreaterThan(-halfW / 2);

      // 4 stacked 64×64 class tabs stay on screen and clear of the panel.
      expect(layout.tabs).toHaveLength(4);
      layout.tabs.forEach((tab, index) => {
        expect(tab.index, `${vp.label} tab ${index}`).toBe(index);
        expect(tab.size).toBe(64);
        expect(tab.x - tab.size / 2).toBeGreaterThanOrEqual(-halfW);
        expect(tab.x + tab.size / 2).toBeLessThanOrEqual(layout.panelX - layout.panelWidth / 2 - 6);
        expect(tab.y + tab.size / 2).toBeLessThanOrEqual(halfH);
        expect(tab.y - tab.size / 2).toBeGreaterThanOrEqual(-halfH);
        expect(tab.badgeWidth).toBeLessThanOrEqual(tab.size);
        expect(tab.badgeHeight).toBeLessThanOrEqual(tab.size);
      });
      expect(layout.tabs[0]!.y).toBeGreaterThan(layout.tabs[1]!.y);
      expect(layout.tabs[1]!.y).toBeGreaterThan(layout.tabs[2]!.y);
      expect(layout.tabs[2]!.y).toBeGreaterThan(layout.tabs[3]!.y);

      // Live preview actor (32×32 body) stands between the tabs and the panel.
      const worldScale = worldToUiScale(vp.width, vp.height, DESIGN_WIDTH, DESIGN_HEIGHT);
      const localKeepOut = localKeepOutForScale(worldScale);
      const frame = menuBackdropFrame(ch1Room1, {
        waterAreas: ch1Water,
        columnWidthTiles: Math.max(20, localKeepOut.width),
      });
      const spot = menuFramedPlayerSpot(ch1Room1, frame, localKeepOut, ch1Water);
      const actorUiX = (spot.x - frame.x - ROOM_COLS / 2) * TILE_SIZE_PX * worldScale;
      const halfSpriteUiW = (TILE_SIZE_PX * worldScale) / 2;
      expect(
        actorUiX + halfSpriteUiW,
        `${vp.label} live preview right edge clear of the Codex panel`,
      ).toBeLessThanOrEqual(layout.panelX - layout.panelWidth / 2 - 2);
      expect(
        actorUiX - halfSpriteUiW,
        `${vp.label} live preview left edge clear of the class tabs`,
      ).toBeGreaterThanOrEqual(layout.tabs[0]!.x + layout.tabs[0]!.size / 2 + 2);

      // Panel header stack is ordered and inside the panel.
      const panelTop = layout.panelY + layout.panelHeight / 2;
      const panelBottom = layout.panelY - layout.panelHeight / 2;
      const box = (fontSize: number): number => (fontSize * FONT_BOX_HEIGHT_RATIO) / 2;
      expect(layout.titleY + box(layout.titleFontSize)).toBeLessThanOrEqual(panelTop - 2);
      expect(layout.statusY + box(layout.statusFontSize)).toBeLessThan(layout.titleY - box(layout.titleFontSize));
      expect(layout.dividerY).toBeLessThan(layout.statusY - box(layout.statusFontSize));
      expect(layout.statsY + box(layout.statsFontSize)).toBeLessThan(layout.dividerY);
      expect(layout.weaponY + box(layout.weaponFontSize)).toBeLessThan(layout.statsY - box(layout.statsFontSize));
      expect(layout.passiveHeadingY + box(layout.passiveHeadingFontSize)).toBeLessThan(
        layout.weaponY - box(layout.weaponFontSize),
      );
      expect(layout.passiveBodyY + box(layout.passiveBodyFontSize)).toBeLessThan(
        layout.passiveHeadingY - box(layout.passiveHeadingFontSize),
      );
      expect(layout.activeHeadingY + box(layout.activeHeadingFontSize)).toBeLessThan(
        layout.passiveBodyY - box(layout.passiveBodyFontSize),
      );
      expect(layout.activeBodyY + box(layout.activeBodyFontSize)).toBeLessThan(
        layout.activeHeadingY - box(layout.activeHeadingFontSize),
      );
      expect(layout.exclusivesHeadingY + box(layout.exclusivesHeadingFontSize)).toBeLessThan(
        layout.activeBodyY - box(layout.activeBodyFontSize),
      );

      // 2×2 exclusive-skill grid, Evolution card and buttons stack without overlap.
      expect(layout.skillCards).toHaveLength(4);
      const [topLeft, topRight, bottomLeft, bottomRight] = layout.skillCards;
      expect(topLeft!.x).toBe(bottomLeft!.x);
      expect(topRight!.x).toBe(bottomRight!.x);
      expect(topLeft!.y).toBe(topRight!.y);
      expect(bottomLeft!.y).toBe(bottomRight!.y);
      expect(topLeft!.y - topLeft!.height / 2).toBeGreaterThanOrEqual(
        bottomLeft!.y + bottomLeft!.height / 2,
      );
      expect(layout.skillCards[0]!.y + layout.skillCards[0]!.height / 2).toBeLessThanOrEqual(
        layout.exclusivesHeadingY - box(layout.exclusivesHeadingFontSize),
      );
      expect(layout.evolution.width).toBeGreaterThan(layout.skillCards[0]!.width);
      expect(layout.evolution.height).toBeGreaterThanOrEqual(layout.skillCards[0]!.height);
      expect(
        layout.evolution.y + layout.evolution.height / 2,
      ).toBeLessThanOrEqual(bottomLeft!.y - bottomLeft!.height / 2);
      expect(
        layout.primaryButton.y + layout.primaryButton.height / 2,
      ).toBeLessThanOrEqual(layout.evolution.y - layout.evolution.height / 2);
      expect(layout.primaryButton.y - layout.primaryButton.height / 2).toBeGreaterThanOrEqual(
        panelBottom + 2,
      );
      expect(
        layout.backButton.x - layout.backButton.width / 2 - (layout.primaryButton.x + layout.primaryButton.width / 2),
      ).toBeGreaterThanOrEqual(6);
      expect(layout.backButton.x + layout.backButton.width / 2).toBeLessThanOrEqual(shadowRight);
    }
  });

  it('fits every Codex line (status, stats, passive/active, 4 skills, Evolution recipe) with zero clipping across locales and save states', () => {
    const layout = computeCharacterSelectLayout({
      visibleWidth: DESIGN_WIDTH,
      visibleHeight: DESIGN_HEIGHT,
    });
    const primaryTextLayout = computeMenuButtonTextLayout({
      width: layout.primaryButton.width,
      height: layout.primaryButton.height,
      fontSize: layout.primaryButton.fontSize,
      hasDetail: true,
    });
    const backTextLayout = computeMenuButtonTextLayout({
      width: layout.backButton.width,
      height: layout.backButton.height,
      fontSize: layout.backButton.fontSize,
      hasDetail: false,
    });

    const freshSave = createDefaultSave();
    const richSave = { ...freshSave, gold: 9999 };
    const chClearedSave = withSelectedCharacter(
      unlockNextChapter(unlockNextChapter(unlockNextChapter(freshSave, 1), 2), 3),
      'cultivator',
    );
    const purchasedSave = withSelectedCharacter(
      buyCharacter(buyCharacter(buyCharacter(richSave, 'archer'), 'mage'), 'cultivator'),
      'mage',
    );

    for (const locale of ['vi', 'en'] as const) {
      for (const save of [freshSave, richSave, chClearedSave, purchasedSave]) {
        for (const character of CHARACTER_ROSTER) {
          const view = buildSkillCodex(save, locale).find((entry) => entry.id === character.id)!;

          const statusLine = formatCharacterSummaryLines(character, save, locale).statusLine;
          expect(
            statusLine.length * layout.statusFontSize * GLYPH_WIDTH_RATIO,
            `${locale} ${character.id} status "${statusLine}"`,
          ).toBeLessThanOrEqual(layout.statusWidth);

          const stats = `${view.stats.maxHp} ${view.stats.attacksPerSecond} ${view.stats.weaponForm}`;
          expect(stats.length * layout.statsFontSize * GLYPH_WIDTH_RATIO).toBeLessThanOrEqual(
            layout.contentWidth,
          );
          expect(
            view.stats.weaponLine.length * layout.weaponFontSize * GLYPH_WIDTH_RATIO,
            `${locale} ${character.id} weapon line`,
          ).toBeLessThanOrEqual(layout.statusWidth);

          const headings = [
            { text: `${view.passive.heading} · ${view.passive.name}`, fs: layout.passiveHeadingFontSize },
            { text: view.passive.description, fs: layout.passiveBodyFontSize },
            {
              text: `${view.active.heading} · ${view.active.name} · ${view.active.cooldownLabel}`,
              fs: layout.activeHeadingFontSize,
            },
            { text: view.active.description, fs: layout.activeBodyFontSize },
            { text: view.exclusives.heading, fs: layout.exclusivesHeadingFontSize },
          ] as const;
          for (const line of headings) {
            expect(
              line.text.length * line.fs * GLYPH_WIDTH_RATIO,
              `${locale} ${character.id} "${line.text}"`,
            ).toBeLessThanOrEqual(layout.statusWidth);
          }

          // Skill cards: short single-line names + wrapped descriptions sized to their own width.
          expect(view.exclusives.skills).toHaveLength(4);
          for (const skill of view.exclusives.skills) {
            expect(
              skill.name.length * layout.skillNameFontSize * GLYPH_WIDTH_RATIO,
              `${locale} ${character.id} skill name "${skill.name}"`,
            ).toBeLessThanOrEqual(layout.skillDescWidth);
          }

          const evolution = view.exclusives.evolution;
          const evolutionTitleLine = `${evolution.name}`;
          expect(
            evolutionTitleLine.length * layout.evolutionNameFontSize * GLYPH_WIDTH_RATIO,
            `${locale} ${character.id} evolution name`,
          ).toBeLessThanOrEqual(layout.evolutionDescWidth);
          expect(evolution.recipe).toHaveLength(2);

          const primary = formatCharacterPrimaryAction(character, save, locale);
          expect(
            primary.label.length * primaryTextLayout.labelFontSize * GLYPH_WIDTH_RATIO,
            `${locale} ${character.id} primary label "${primary.label}"`,
          ).toBeLessThanOrEqual(primaryTextLayout.safeTextWidth);
          expect(
            primary.detail.length * primaryTextLayout.detailFontSize * GLYPH_WIDTH_RATIO,
            `${locale} ${character.id} primary detail "${primary.detail}"`,
          ).toBeLessThanOrEqual(primaryTextLayout.safeTextWidth);
        }
      }
    }

    const back = 'Quay lại';
    expect(
      back.length * backTextLayout.labelFontSize * GLYPH_WIDTH_RATIO,
    ).toBeLessThanOrEqual(backTextLayout.safeTextWidth);
  });

  it('navigates the 6 Codex controls: vertical class tabs, then the action bar, with digit shortcuts', () => {
    expect(nextCharacterSelectFocus(0, 'down')).toBe(1);
    expect(nextCharacterSelectFocus(1, 'down')).toBe(2);
    expect(nextCharacterSelectFocus(2, 'down')).toBe(3);
    expect(nextCharacterSelectFocus(3, 'down')).toBe(4);
    expect(nextCharacterSelectFocus(0, 'up')).toBe(0);
    expect(nextCharacterSelectFocus(2, 'up')).toBe(1);
    expect(nextCharacterSelectFocus(4, 'up')).toBe(3);
    expect(nextCharacterSelectFocus(5, 'up')).toBe(3);

    expect(nextCharacterSelectFocus(0, 'right')).toBe(1);
    expect(nextCharacterSelectFocus(3, 'right')).toBe(0);
    expect(nextCharacterSelectFocus(0, 'left')).toBe(3);
    expect(nextCharacterSelectFocus(4, 'right')).toBe(5);
    expect(nextCharacterSelectFocus(5, 'left')).toBe(4);
  });
});
describe('M15 Expanded 3-column Meta Shop layout — STAT, UTILITY & HERO UNLOCKS', () => {
  it('groups all 6 tracks into STAT (3) + UTILITY (3, NO Revive) + HERO UNLOCKS (3) inside 512×288 across all 4 viewports', () => {
    expect(STAT_UPGRADE_TRACKS).toEqual(['hearts', 'damage', 'fireRate']);
    expect(UTILITY_UPGRADE_TRACKS).toEqual(['xpMagnet', 'goldBonus', 'freeRerolls']);
    expect(UPGRADE_TRACKS).toHaveLength(6);
    expect(UPGRADE_TRACKS).not.toContain('revive');
    expect(SHOP_CHARACTER_START_INDEX).toBe(6);
    expect(SHOP_CHAR_SELECT_BUTTON_INDEX).toBe(9);

    for (const vp of TARGET_VIEWPORTS) {
      const band = letterboxRect(vp.width, vp.height, DESIGN_WIDTH, DESIGN_HEIGHT);
      expect(band.width).toBeGreaterThan(0);

      for (const hasCharacterSelect of [true, false]) {
        const layout = computeShopScreenLayout({
          visibleWidth: DESIGN_WIDTH,
          visibleHeight: DESIGN_HEIGHT,
          hasCharacterSelect,
        });

        const halfW = DESIGN_WIDTH / 2;
        const halfH = DESIGN_HEIGHT / 2;
        const shadowHalfW = (layout.panelWidth + PANEL_SHADOW_EXPAND_PX) / 2;
        const shadowTop = layout.panelY + (layout.panelHeight + PANEL_SHADOW_EXPAND_PX) / 2 - 1;
        const shadowBottom = layout.panelY - (layout.panelHeight + PANEL_SHADOW_EXPAND_PX) / 2 - 1;

        expect(shadowHalfW, `${vp.label} shop width`).toBeLessThanOrEqual(halfW);
        expect(shadowTop, `${vp.label} shop top`).toBeLessThanOrEqual(halfH);
        expect(shadowBottom, `${vp.label} shop bottom`).toBeGreaterThanOrEqual(-halfH);

        expect(layout.statSlots).toHaveLength(3);
        expect(layout.utilitySlots).toHaveLength(3);
        expect(layout.upgradeSlots).toHaveLength(6);
        expect(layout.characterSlots).toHaveLength(3);

        // Non-overlapping horizontal columns (including focus rings).
        expect(
          layout.utilitySlots[0]!.x - layout.statSlots[0]!.x - layout.colWidth,
        ).toBeGreaterThanOrEqual(FOCUS_RING_EXPAND_PX + 2);
        expect(
          layout.characterSlots[0]!.x - layout.utilitySlots[0]!.x - layout.colWidth,
        ).toBeGreaterThanOrEqual(FOCUS_RING_EXPAND_PX + 2);

        const topRowRing = layout.upgradeSlots[0]!.y + (layout.rowHeight + FOCUS_RING_EXPAND_PX) / 2;
        const headerBottom =
          layout.sectionHeaderY - (layout.sectionHeaderFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
        expect(topRowRing).toBeLessThan(headerBottom);

        const bottomRowTopRing =
          layout.backButton.y + (layout.backButton.height + FOCUS_RING_EXPAND_PX) / 2;
        const lastTrackBottom = layout.upgradeSlots[2]!.y - layout.rowHeight / 2;
        expect(bottomRowTopRing).toBeLessThan(lastTrackBottom - 2);
        expect(layout.hintY + (layout.hintFontSize * FONT_BOX_HEIGHT_RATIO) / 2).toBeLessThan(
          layout.backButton.y - (layout.backButton.height + FOCUS_RING_EXPAND_PX) / 2 - 4,
        );
      }
    }
  });

  it('formats every upgradeRow (all 6 tracks), characterShopRow (all 3 heroes), and bonus header with zero text overflow', () => {
    const layout = computeShopScreenLayout({ hasCharacterSelect: true });
    const rowTextLayout = computeMenuButtonTextLayout({
      width: layout.colWidth,
      height: layout.rowHeight,
      fontSize: layout.rowFontSize,
      hasDetail: true,
    });

    const brokeSave = createDefaultSave();
    const richSave = { ...brokeSave, gold: 9999 };
    const maxedSave = {
      ...richSave,
      chaptersUnlocked: 4,
      upgrades: {
        hearts: maxLevelFor('hearts'),
        damage: maxLevelFor('damage'),
        fireRate: maxLevelFor('fireRate'),
        xpMagnet: maxLevelFor('xpMagnet'),
        goldBonus: maxLevelFor('goldBonus'),
        freeRerolls: maxLevelFor('freeRerolls'),
      },
    };
    const boughtArcherSave = buyCharacter(richSave, 'archer');

    expect(characterShopRow(brokeSave, 'archer').disabled).toBe(true);
    expect(characterShopRow(brokeSave, 'archer').detail).toContain('Thiếu');
    expect(characterShopRow(brokeSave, 'archer', 'en').detail).toContain('Need');
    expect(characterShopRow(richSave, 'archer').disabled).toBe(false);
    expect(characterShopRow(boughtArcherSave, 'archer').disabled).toBe(true);
    expect(characterShopRow(boughtArcherSave, 'archer').detail).toBe('Đã mở (Đã mua)');
    expect(characterShopRow(boughtArcherSave, 'archer', 'en').detail).toBe('Unlocked (Purchased)');
    expect(characterShopRow(maxedSave, 'cultivator').disabled).toBe(true);
    expect(characterShopRow(maxedSave, 'cultivator').detail).toBe('Đã mở (Vượt Chương 3)');
    expect(characterShopRow(maxedSave, 'cultivator', 'en').detail).toBe(
      'Unlocked (Chapter 3 cleared)',
    );

    for (const save of [brokeSave, richSave, maxedSave, boughtArcherSave]) {
      const bonusLine = formatShopBonusSummary(save);
      expect(bonusLine.length * layout.infoFontSize * GLYPH_WIDTH_RATIO).toBeLessThanOrEqual(
        layout.dividerWidth,
      );

      for (const track of UPGRADE_TRACKS) {
        const row = upgradeRow(save, track);
        expect(
          row.label.length * rowTextLayout.labelFontSize * GLYPH_WIDTH_RATIO,
          `upgrade label "${row.label}"`,
        ).toBeLessThanOrEqual(rowTextLayout.safeTextWidth);
        expect(
          row.detail.length * rowTextLayout.detailFontSize * GLYPH_WIDTH_RATIO,
          `upgrade detail "${row.detail}"`,
        ).toBeLessThanOrEqual(rowTextLayout.safeTextWidth);
      }
      for (const characterId of SHOP_UNLOCK_CHARACTER_IDS) {
        const row = characterShopRow(save, characterId);
        expect(
          row.label.length * rowTextLayout.labelFontSize * GLYPH_WIDTH_RATIO,
          `hero label "${row.label}"`,
        ).toBeLessThanOrEqual(rowTextLayout.safeTextWidth);
        expect(
          row.detail.length * rowTextLayout.detailFontSize * GLYPH_WIDTH_RATIO,
          `hero detail "${row.detail}"`,
        ).toBeLessThanOrEqual(rowTextLayout.safeTextWidth);
      }
    }

    // 2D focus transitions across all 3 columns (`0..2` STAT, `3..5` UTILITY, `6..8` HEROES) + footer (`9..10`).
    expect(nextShopScreenFocus(0, 'right', true)).toBe(3);
    expect(nextShopScreenFocus(3, 'right', true)).toBe(6);
    expect(nextShopScreenFocus(6, 'right', true)).toBe(0);
    expect(nextShopScreenFocus(3, 'left', true)).toBe(0);
    expect(nextShopScreenFocus(2, 'down', true)).toBe(9);
    expect(nextShopScreenFocus(5, 'down', true)).toBe(9);
    expect(nextShopScreenFocus(8, 'down', true)).toBe(10);
    expect(nextShopScreenFocus(9, 'right', true)).toBe(10);
    expect(nextShopScreenFocus(8, 'down', false)).toBe(9);
  });
});

describe('M15 Rich Results / Death screen layout & summary bounds audit', () => {
  it('normalizes ReadonlyMap, Record, and SkillSummaryEntry[] ownedSkills inputs identically', () => {
    const asMap = new Map<string, number>([
      ['sharpen', 3],
      ['phantom-volley', 1],
    ]);
    const asRecord = { sharpen: 3, 'phantom-volley': 1 };
    const asEntries = [
      { id: 'sharpen', stacks: 3 },
      { id: 'phantom-volley', stacks: 1 },
    ] as const;

    expect(Array.from(toOwnedSkillsMap(asMap).entries())).toEqual([
      ['sharpen', 3],
      ['phantom-volley', 1],
    ]);
    expect(Array.from(toOwnedSkillsMap(asRecord).entries())).toEqual([
      ['sharpen', 3],
      ['phantom-volley', 1],
    ]);
    expect(Array.from(toOwnedSkillsMap(asEntries).entries())).toEqual([
      ['sharpen', 3],
      ['phantom-volley', 1],
    ]);
  });

  it('fits worst-case 7-line Rich Result + Continue Endless + 3 footer buttons inside 512×288 across all 4 viewports with zero overlap', () => {
    const maxedOwned: Record<string, number> = {};
    for (const skill of SKILLS) maxedOwned[skill.id] = skill.maxStacks;
    for (const evo of EVOLUTIONS) maxedOwned[evo.id] = 1;

    const worstWin = formatResultScreenSummary({
      chapter: 4,
      roomReached: 9,
      roomsTotal: 9,
      goldEarned: 9999,
      goldTotal: 99999,
      durationMs: 3599000,
      kills: 9999,
      won: true,
      seed: 0xffffffff,
      ascension: 5,
      endlessLoop: 12,
      characterId: 'cultivator',
      ownedSkills: maxedOwned,
      unlocks: {
        unlockedChapter: 4,
        unlockedCharacters: ['archer', 'mage', 'cultivator'],
        unlockedAscension: { chapter: 4, level: 5 },
        endlessUnlocked: true,
      },
      canContinueEndless: true,
    });

    expect(worstWin.title).toBe('HOÀN THÀNH CHƯƠNG');
    expect(worstWin.lines.length).toBeLessThanOrEqual(7);
    expect(worstWin.lines.some((l) => l.text.includes('Tướng: Tu Tiên'))).toBe(true);
    expect(worstWin.lines.some((l) => l.text.includes('Thăng Hoa 5'))).toBe(true);
    expect(worstWin.lines.some((l) => l.text.includes('Vòng Vô Tận 12'))).toBe(true);
    expect(worstWin.lines.some((l) => l.text.includes('Seed 4294967295'))).toBe(true);
    expect(worstWin.lines.some((l) => l.kind === 'evolution')).toBe(true);
    expect(worstWin.lines.some((l) => l.kind === 'skills')).toBe(true);
    expect(worstWin.lines.some((l) => l.kind === 'unlock')).toBe(true);

    for (const vp of TARGET_VIEWPORTS) {
      for (const hasContinueEndless of [true, false]) {
        const layout = computeResultScreenLayout({
          visibleWidth: DESIGN_WIDTH,
          visibleHeight: DESIGN_HEIGHT,
          lineCount: worstWin.lines.length,
          hasContinueEndless,
        });

        const halfW = DESIGN_WIDTH / 2;
        const halfH = DESIGN_HEIGHT / 2;
        const shadowHalfW = (layout.panelWidth + PANEL_SHADOW_EXPAND_PX) / 2;
        const shadowTop = layout.panelY + (layout.panelHeight + PANEL_SHADOW_EXPAND_PX) / 2 - 1;
        const shadowBottom = layout.panelY - (layout.panelHeight + PANEL_SHADOW_EXPAND_PX) / 2 - 1;

        expect(shadowHalfW, `${vp.label} result width`).toBeLessThanOrEqual(halfW);
        expect(shadowTop, `${vp.label} result top`).toBeLessThanOrEqual(halfH);
        expect(shadowBottom, `${vp.label} result bottom`).toBeGreaterThanOrEqual(-halfH);

        const panelTop = layout.panelY + layout.panelHeight / 2;
        const panelBottom = layout.panelY - layout.panelHeight / 2;
        const titleHalfH = (layout.titleFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
        const subHalfH = (layout.subtitleFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
        const lineHalfH = (layout.lineFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
        const hintHalfH = (layout.hintFontSize * FONT_BOX_HEIGHT_RATIO) / 2;

        expect(layout.titleY + titleHalfH).toBeLessThanOrEqual(panelTop - 2);
        expect(layout.subtitleY + subHalfH).toBeLessThan(layout.titleY - titleHalfH);
        expect(layout.dividerY).toBeLessThan(layout.subtitleY - subHalfH);
        expect(layout.lineYs[0]! + lineHalfH).toBeLessThan(layout.dividerY);

        // M19 64×64 Result portrait sits inside the top-left header, above dividerY and clear of title/subtitle.
        const pLeft = layout.portraitFrame.x - layout.portraitFrame.frameSize / 2;
        const pRight = layout.portraitFrame.x + layout.portraitFrame.frameSize / 2;
        const pTop = layout.portraitFrame.y + layout.portraitFrame.frameSize / 2;
        const pBottom = layout.portraitFrame.y - layout.portraitFrame.frameSize / 2;
        expect(layout.portraitFrame.spriteSize).toBe(64);
        expect(pLeft).toBeGreaterThanOrEqual(-layout.dividerWidth / 2);
        expect(pTop).toBeLessThanOrEqual(panelTop - 4);
        expect(pBottom).toBeGreaterThan(layout.dividerY);
        expect(pRight).toBeLessThan(layout.headerTextX - layout.headerTextSafeWidth / 2);

        for (let i = 0; i < worstWin.lines.length; i += 1) {
          const line = worstWin.lines[i]!;
          expect(line.text.length).toBeLessThanOrEqual(RESULT_LINE_MAX_CHARS);
          expect(line.text.length * layout.lineFontSize * GLYPH_WIDTH_RATIO).toBeLessThanOrEqual(
            layout.lineSafeWidth,
          );
          if (i > 0) {
            expect(layout.lineYs[i]! + lineHalfH).toBeLessThan(
              layout.lineYs[i - 1]! - lineHalfH,
            );
          }
        }

        const lastLineBottom = layout.lineYs[layout.lineYs.length - 1]! - lineHalfH;
        const topBtn = layout.continueEndlessButton ?? layout.footerButtons[0];
        const topBtnRing = topBtn.y + (topBtn.height + FOCUS_RING_EXPAND_PX) / 2;
        expect(topBtnRing).toBeLessThan(lastLineBottom);

        if (layout.continueEndlessButton !== null) {
          const contBottom = layout.continueEndlessButton.y - layout.continueEndlessButton.height / 2;
          const footerTop = layout.footerButtons[0].y + layout.footerButtons[0].height / 2;
          expect(contBottom - footerTop).toBeGreaterThanOrEqual(FOCUS_RING_EXPAND_PX);
        }

        const footerBottomRing =
          layout.footerButtons[0].y - (layout.footerButtons[0].height + FOCUS_RING_EXPAND_PX) / 2;
        expect(layout.hintY + hintHalfH).toBeLessThan(footerBottomRing);
        expect(layout.hintY - hintHalfH).toBeGreaterThanOrEqual(panelBottom + 2);
      }
    }

    // Defeat subtitles across all enemy roles & boss IDs fit cleanly inside dividerWidth.
    const refLayout = computeResultScreenLayout({ lineCount: 4, hasContinueEndless: false });
    for (const role of ENEMY_ROLES) {
      const summary = formatResultScreenSummary({
        chapter: 2,
        roomReached: 4,
        roomsTotal: 9,
        goldEarned: 35,
        goldTotal: 120,
        durationMs: 65000,
        kills: 42,
        won: false,
        deathCause: { kind: 'enemy', role, elite: true },
      });
      expect(summary.subtitle).toContain('Tinh Anh');
      expect(
        summary.subtitle.length * refLayout.subtitleFontSize * GLYPH_WIDTH_RATIO,
      ).toBeLessThanOrEqual(refLayout.dividerWidth);
    }
    for (const bossId of BOSS_IDS) {
      const summary = formatResultScreenSummary({
        chapter: 4,
        roomReached: 9,
        roomsTotal: 9,
        goldEarned: 190,
        goldTotal: 500,
        durationMs: 310000,
        kills: 210,
        won: false,
        deathCause: { kind: 'boss', bossId, phase: 3 },
      });
      expect(summary.subtitle).toContain('(Giai đoạn 3)');
      expect(
        summary.subtitle.length * refLayout.subtitleFontSize * GLYPH_WIDTH_RATIO,
      ).toBeLessThanOrEqual(refLayout.dividerWidth);
    }

    // Unlock progression helper sanity check with SaveData.
    const unlockedAsc = unlockChapterAscension(createDefaultSave(), 1, 0);
    expect(unlockedAsc.ascensionUnlocked[0]).toBe(1);

    // 2D focus navigation on ResultScreen.
    expect(nextResultScreenFocus(0, 'down', true)).toBe(1);
    expect(nextResultScreenFocus(2, 'up', true)).toBe(0);
    expect(nextResultScreenFocus(1, 'right', true)).toBe(2);
    expect(nextResultScreenFocus(0, 'right', false)).toBe(1);
    expect(nextResultScreenFocus(0, 'left', false)).toBe(2);
  });
});
