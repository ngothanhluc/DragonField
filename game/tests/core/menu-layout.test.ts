import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHARACTER_ROSTER } from '../../assets/scripts/core/characters/roster';
import { ROOM_COLS, ROOM_ROWS, TILE_SIZE_PX } from '../../assets/scripts/core/level/level-data';
import { parseWaterLayout, waterAreasFor } from '../../assets/scripts/core/level/water-layout';
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
  FOCUS_RING_EXPAND_PX,
  MENU_COLUMN_WIDTH,
  PANEL_SHADOW_EXPAND_PX,
  THEME_WOOD_BORDERS,
  computeMenuButtonTextLayout,
  computeMenuScreenLayout,
  computeSkillCardLayout,
  resolveMenuButtonVisualState,
} from '../../assets/scripts/core/view/menu-layout';
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
      screen: 'Title',
      width: MENU_COLUMN_WIDTH - 28,
      height: 31,
      fontSize: 11,
      labels: ['Play', 'Character: Cultivator', 'Meta shop', 'Settings', 'Credits'],
      details: [
        'Choose a chapter',
        'Default ninja (Settings to unlock)',
        ...CHARACTER_ROSTER.map((c) => `${c.subtitle} (←/→)`),
        'Spend gold on upgrades',
        'Volume, fullscreen, keys',
      ],
    },
    {
      screen: 'Chapter Select',
      width: MENU_COLUMN_WIDTH - 28,
      height: 33,
      fontSize: 11,
      labels: ['Chapter 1', 'Chapter 4'],
      details: ['Enter chapter', 'Locked — clear previous', 'No data'],
    },
    {
      screen: 'Meta Shop',
      width: 344,
      height: 37,
      fontSize: 12,
      labels: ['Fire rate   Lv 10/10'],
      details: ['Next level: 999 gold — need 999 more', 'Maxed out'],
    },
    {
      screen: 'Pause',
      width: 312,
      height: 36,
      fontSize: 12,
      labels: ['Restart run', 'Volume   100%'],
      details: ['New run, keep gold earned', 'Left / Right or click (+10%)'],
    },
    {
      screen: 'Result',
      width: 328,
      height: 35,
      fontSize: 12,
      labels: ['Chapter select'],
      details: ['Spend the gold you earned', 'Back to the main menu'],
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

  it('centres single-line buttons cleanly (Settings 22px, Back 28px, Credits 30px)', () => {
    for (const [height, fontSize] of [
      [22, 10],
      [28, 11],
      [30, 11],
    ] as const) {
      const layout = computeMenuButtonTextLayout({
        width: 280,
        height,
        fontSize,
        hasDetail: false,
      });
      expect(layout.labelY).toBe(0);
      const labelHalfH = (layout.labelFontSize * FONT_BOX_HEIGHT_RATIO) / 2;
      expect(labelHalfH).toBeLessThanOrEqual(height / 2 - 2);
    }
  });
});

describe('computeMenuScreenLayout & computeSkillCardLayout — viewport bounds audit', () => {
  const SCREEN_SPECS = [
    {
      name: 'Title',
      hasSubtitle: true,
      infoCount: 2,
      buttonHeights: [31, 31, 31, 31, 31],
      buttonGap: 5,
      panelWidth: MENU_COLUMN_WIDTH,
      panelFullHeight: true,
    },
    {
      name: 'Chapter Select',
      hasSubtitle: true,
      infoCount: 1,
      buttonHeights: [33, 33, 33, 33, 28],
      buttonGap: 5,
      panelWidth: MENU_COLUMN_WIDTH,
      panelFullHeight: true,
    },
    {
      name: 'Meta Shop',
      hasSubtitle: true,
      infoCount: 1,
      buttonHeights: [37, 37, 37, 28],
      buttonGap: 5,
      panelWidth: 396,
      panelFullHeight: false,
    },
    {
      name: 'Settings',
      titleFontSize: 20,
      hasSubtitle: true,
      infoCount: 1,
      buttonHeights: [22, 22, 22, 22, 22, 22, 22],
      buttonGap: 4,
      panelWidth: 452,
      panelFullHeight: false,
    },
    {
      name: 'Pause',
      hasSubtitle: true,
      infoCount: 0,
      buttonHeights: [36, 36, 36, 36],
      buttonGap: 6,
      panelWidth: 364,
      panelFullHeight: false,
    },
    {
      name: 'Result (with unlock)',
      hasSubtitle: true,
      infoCount: 4,
      buttonHeights: [35, 35, 35],
      buttonGap: 5,
      panelWidth: 384,
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
      // SHOW_ALL preserves the 512×288 design visible size inside the letterboxed viewport band.
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

    // Interior slots stay clear of each other and inside the card well.
    expect(layout.pairHintY).toBeLessThan(layout.effectY - layout.effectHeight / 2);
    expect(layout.pairHintY).toBeGreaterThan(layout.stackY + 8);
    expect(layout.stackY - 6).toBeGreaterThan(-layout.cardHeight / 2 + 5);

    // Gold Reroll button sits cleanly below the 3 cards without touching focus rings or bottom edge.
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
    for (const labelText of ['Reroll (R) — 10g', 'Reroll (R) — 120g', 'Reroll (R)']) {
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
        // Never include the 2-tile outer wall/door-cutout border of 64×36 rooms.
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

        // Character stands visibly inside the 32×18 viewport and clear of the centred menu column.
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
