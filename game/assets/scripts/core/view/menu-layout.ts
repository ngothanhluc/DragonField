/**
 * Pure layout, padding, and button visual-state helpers for the `Theme Wood` menu UI (M11 T5).
 *
 * Zero `cc` imports (`no-restricted-imports` enforced), so vitest verifies:
 * - distinct button states (`normal`, `focused`, `hovered`, `pressed`, `disabled`, `disabled-focused`),
 * - comfortable internal padding and line separation for single-line and two-line buttons,
 * - vertical centering, header-to-button divider placement, and non-clipping bounds across
 *   16:9 (1920×1080, 1280×720), 16:10 (1280×800), and 4:3 (1024×768).
 */

/**
 * Width of the centred column on Title and Chapter Select (design px).
 *
 * At 512×288 design resolution, 252 px keeps the exact same integer tile keep-out footprint as
 * 240 px (`16` tiles at `worldScale = 1.0`, `20` tiles at `worldScale = 0.8`) while giving
 * long subtitles (`Default ninja (Settings to unlock)`) comfortable horizontal padding.
 */
export const MENU_COLUMN_WIDTH = 252;

/** 9-slice border insets for `Theme Wood` UI sprites (pixels). */
export const THEME_WOOD_BORDERS = {
  /** `button_normal.png` / `button_hover.png` / `button_disabled.png` (16×8). */
  button: { left: 4, right: 4, top: 3, bottom: 3 },
  /** `button_pressed.png` (16×8, shifted 1 px down on press). */
  buttonPressed: { left: 4, right: 4, top: 3, bottom: 2 },
  /** `nine_path_panel_interior.png` / `nine_path_bg_2.png` (16×16). */
  panel: { left: 4, right: 4, top: 4, bottom: 4 },
  /** `nine_path_focus.png` (8×8 carved focus ring with transparent 2×2 centre). */
  focus: { left: 3, right: 3, top: 3, bottom: 3 },
} as const;

/** Inset from the outer wooden panel rim to the recessed dark `nine_path_panel_interior` well. */
export const PANEL_WELL_INSET_PX = 5;
/** Extra size around the panel for its `nine_path_bg_2` pixel drop shadow. */
export const PANEL_SHADOW_EXPAND_PX = 4;
/** Extra size around a button or skill card for its `nine_path_focus` 9-slice frame. */
export const FOCUS_RING_EXPAND_PX = 6;

export type MenuButtonVisualState =
  | 'normal'
  | 'focused'
  | 'hovered'
  | 'pressed'
  | 'disabled'
  | 'disabled-focused';

export type MenuButtonFrameKind = 'normal' | 'hover' | 'pressed' | 'disabled';
export type MenuFocusRingStyle = 'none' | 'gold' | 'gleam' | 'muted';

export interface MenuButtonStateInput {
  readonly disabled: boolean;
  readonly focused: boolean;
  readonly hovered: boolean;
  readonly pressed: boolean;
}

export interface MenuButtonStateVisual {
  readonly state: MenuButtonVisualState;
  readonly frame: MenuButtonFrameKind;
  readonly showFocusRing: boolean;
  readonly focusRingStyle: MenuFocusRingStyle;
  /** Vertical pixel offset applied to button labels while pressed. */
  readonly contentOffsetY: number;
}

/**
 * Resolve a button's interaction flags into one unmistakable visual state.
 *
 * - `normal`: resting wooden button, no ring.
 * - `focused`: keyboard selection — bright golden wood + warm gold `nine_path_focus` frame.
 * - `hovered`: pointer over an active button — bright wood + ivory-gleam `nine_path_focus` frame.
 * - `pressed`: active click held — recessed `button_pressed` frame + 1 px downward text shift.
 * - `disabled`: muted weathered wood, no ring.
 * - `disabled-focused`: muted weathered wood + subtle slate `nine_path_focus` ring so keyboard
 *   and mouse navigation still show where focus sits without looking clickable.
 */
export function resolveMenuButtonVisualState(input: MenuButtonStateInput): MenuButtonStateVisual {
  if (input.disabled) {
    const highlighted = input.focused || input.hovered;
    return {
      state: highlighted ? 'disabled-focused' : 'disabled',
      frame: 'disabled',
      showFocusRing: highlighted,
      focusRingStyle: highlighted ? 'muted' : 'none',
      contentOffsetY: 0,
    };
  }
  if (input.pressed) {
    return {
      state: 'pressed',
      frame: 'pressed',
      showFocusRing: true,
      focusRingStyle: 'gleam',
      contentOffsetY: -1,
    };
  }
  if (input.hovered) {
    return {
      state: 'hovered',
      frame: 'hover',
      showFocusRing: true,
      focusRingStyle: 'gleam',
      contentOffsetY: 0,
    };
  }
  if (input.focused) {
    return {
      state: 'focused',
      frame: 'hover',
      showFocusRing: true,
      focusRingStyle: 'gold',
      contentOffsetY: 0,
    };
  }
  return {
    state: 'normal',
    frame: 'normal',
    showFocusRing: false,
    focusRingStyle: 'none',
    contentOffsetY: 0,
  };
}

export interface MenuButtonTextLayoutInput {
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly hasDetail: boolean;
}

export interface MenuButtonTextLayout {
  readonly labelFontSize: number;
  readonly labelLineHeight: number;
  readonly labelY: number;
  readonly detailFontSize: number;
  readonly detailLineHeight: number;
  readonly detailY: number;
  /** Interior horizontal width clear of the 4 px 9-slice side borders + breathing room. */
  readonly safeTextWidth: number;
}

/**
 * Compute vertical label/detail positions inside a button so neither line touches the 3 px top/bottom
 * wooden bevels and two-line buttons keep clean breathing room between title and subtitle.
 */
export function computeMenuButtonTextLayout(
  input: MenuButtonTextLayoutInput,
): MenuButtonTextLayout {
  const safeTextWidth = Math.max(0, input.width - (THEME_WOOD_BORDERS.button.left + THEME_WOOD_BORDERS.button.right + 8));
  const labelFontSize = input.fontSize;
  const labelLineHeight = labelFontSize + 2;

  if (!input.hasDetail) {
    return {
      labelFontSize,
      labelLineHeight,
      labelY: 0,
      detailFontSize: 0,
      detailLineHeight: 0,
      detailY: 0,
      safeTextWidth,
    };
  }

  const detailFontSize = Math.max(8, labelFontSize - 3);
  const detailLineHeight = detailFontSize + 2;
  const rawOffset = Math.floor(input.height - 22) * 0.5;
  const offset = Math.min(7, Math.max(5.5, rawOffset));

  return {
    labelFontSize,
    labelLineHeight,
    labelY: offset,
    detailFontSize,
    detailLineHeight,
    detailY: -(offset + 1),
    safeTextWidth,
  };
}

export interface MenuScreenLayoutInput {
  readonly visibleWidth: number;
  readonly visibleHeight: number;
  readonly titleFontSize?: number;
  readonly subtitleFontSize?: number;
  readonly infoFontSize?: number;
  readonly hintFontSize?: number;
  readonly hasSubtitle: boolean;
  readonly infoCount: number;
  readonly buttonHeights: readonly number[];
  readonly buttonGap: number;
  readonly panelWidth?: number;
  readonly panelFullHeight?: boolean;
}

export interface MenuScreenLayout {
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly panelY: number;
  readonly titleFontSize: number;
  readonly subtitleFontSize: number;
  readonly infoFontSize: number;
  readonly hintFontSize: number;
  readonly titleY: number;
  readonly subtitleY: number | null;
  readonly infoYs: readonly number[];
  readonly dividerY: number;
  readonly dividerWidth: number;
  readonly buttonYs: readonly number[];
  readonly hintY: number;
}

/**
 * Solve the vertical stack of a menu screen in design pixels (centre origin, y up).
 *
 * - Full-height columns (Title / Chapter Select) span `visibleHeight - 8` (`[-140, +140]`) with
 *   the hint anchored near the bottom of the column well.
 * - Floating modal plaques (Shop / Settings / Pause / Result / Credits) wrap tightly around
 *   header + divider + buttons + hint and centre vertically on screen.
 */
export function computeMenuScreenLayout(input: MenuScreenLayoutInput): MenuScreenLayout {
  const panelWidth = Math.round(
    Math.min(input.panelWidth ?? 400, Math.max(160, input.visibleWidth - 24)),
  );
  const fullHeight = input.panelFullHeight === true;
  const titleFontSize = input.titleFontSize ?? 22;
  const subtitleFontSize = input.subtitleFontSize ?? 10;
  const infoFontSize = input.infoFontSize ?? 9;
  const hintFontSize = input.hintFontSize ?? (panelWidth <= MENU_COLUMN_WIDTH + 8 ? 8 : 9);
  const dividerWidth = Math.max(64, panelWidth - PANEL_WELL_INSET_PX * 2 - 20);

  const titleToNext = titleFontSize <= 20 ? 19 : 21;
  const subtitleStep = 14;
  const infoStep = 12;
  const preDividerGap = 9;
  const postDividerGap = 7;

  if (fullHeight) {
    const panelHeight = Math.max(120, Math.round(input.visibleHeight - 8));
    const panelTop = panelHeight / 2;
    const panelBottom = -panelHeight / 2;

    let cursor = Math.round(panelTop - 20);
    const titleY = cursor;
    cursor -= titleToNext;

    let subtitleY: number | null = null;
    if (input.hasSubtitle) {
      subtitleY = cursor;
      cursor -= subtitleStep;
    }

    const infoYs: number[] = [];
    for (let index = 0; index < input.infoCount; index += 1) {
      infoYs.push(cursor);
      cursor -= infoStep;
    }

    const headerBottom = input.infoCount > 0 ? cursor + infoStep : (subtitleY ?? titleY);
    const dividerY = Math.round(headerBottom - preDividerGap);
    let buttonTop = dividerY - postDividerGap;

    const buttonYs: number[] = [];
    for (const height of input.buttonHeights) {
      buttonYs.push(buttonTop - height / 2);
      buttonTop -= height + input.buttonGap;
    }

    const hintY = Math.round(panelBottom + 11);

    return {
      panelWidth,
      panelHeight,
      panelY: 0,
      titleFontSize,
      subtitleFontSize,
      infoFontSize,
      hintFontSize,
      titleY,
      subtitleY,
      infoYs,
      dividerY,
      dividerWidth,
      buttonYs,
      hintY,
    };
  }

  // Floating modal plaque: measure top-to-bottom span, then centre vertically around y = 0.
  const topPad = 18;
  const bottomPad = 12;
  const hintGap = 13;

  let cursorFromTop = topPad; // title centre distance from panel top
  const titleOffset = cursorFromTop;
  cursorFromTop += titleToNext;

  let subtitleOffset: number | null = null;
  if (input.hasSubtitle) {
    subtitleOffset = cursorFromTop;
    cursorFromTop += subtitleStep;
  }

  const infoOffsets: number[] = [];
  for (let index = 0; index < input.infoCount; index += 1) {
    infoOffsets.push(cursorFromTop);
    cursorFromTop += infoStep;
  }

  const lastHeaderOffset =
    input.infoCount > 0
      ? infoOffsets[infoOffsets.length - 1]!
      : (subtitleOffset ?? titleOffset);
  const dividerOffset = lastHeaderOffset + preDividerGap;
  let buttonTopOffset = dividerOffset + postDividerGap;

  const buttonOffsets: number[] = [];
  for (const height of input.buttonHeights) {
    buttonOffsets.push(buttonTopOffset + height / 2);
    buttonTopOffset += height + input.buttonGap;
  }

  const buttonsBottomOffset =
    input.buttonHeights.length > 0 ? buttonTopOffset - input.buttonGap : dividerOffset + postDividerGap;
  const hintOffset = buttonsBottomOffset + hintGap;
  const rawHeight = Math.ceil(hintOffset + bottomPad);
  const panelHeight = Math.min(Math.round(input.visibleHeight - 8), Math.max(96, rawHeight));
  const panelTop = panelHeight / 2;

  return {
    panelWidth,
    panelHeight,
    panelY: 0,
    titleFontSize,
    subtitleFontSize,
    infoFontSize,
    hintFontSize,
    titleY: Math.round(panelTop - titleOffset),
    subtitleY: subtitleOffset === null ? null : Math.round(panelTop - subtitleOffset),
    infoYs: infoOffsets.map((offset) => Math.round(panelTop - offset)),
    dividerY: Math.round(panelTop - dividerOffset),
    dividerWidth,
    buttonYs: buttonOffsets.map((offset) => Math.round((panelTop - offset) * 2) / 2),
    hintY: Math.round(panelTop - hintOffset),
  };
}

export interface SkillCardLayout {
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly cardGap: number;
  readonly cardY: number;
  readonly titleY: number;
  readonly subtitleY: number;
  readonly iconFrameSize: number;
  readonly iconSize: number;
  readonly iconY: number;
  readonly hotkeyX: number;
  readonly hotkeyY: number;
  readonly nameY: number;
  readonly rarityY: number;
  readonly accentY: number;
  readonly effectY: number;
  readonly effectWidth: number;
  readonly effectHeight: number;
  readonly stackY: number;
  readonly cardXs: readonly number[];
  /** Centred Gold Reroll button below the 3 cards (M12, ADR-021). */
  readonly rerollY: number;
  readonly rerollWidth: number;
  readonly rerollHeight: number;
}

/** Compute the horizontal card positions and interior element anchors for the 1-of-N skill picker. */
export function computeSkillCardLayout(choiceCount: number): SkillCardLayout {
  const cardWidth = 144;
  const cardHeight = 162;
  const cardGap = 12;
  const cardY = 0;
  const iconSize = 48;
  const iconFrameSize = 54;
  const count = Math.max(0, Math.floor(choiceCount));
  const rowWidth = count * cardWidth + Math.max(0, count - 1) * cardGap;
  const firstX = -rowWidth / 2 + cardWidth / 2;
  const cardXs: number[] = [];
  for (let index = 0; index < count; index += 1) {
    cardXs.push(firstX + index * (cardWidth + cardGap));
  }

  return {
    cardWidth,
    cardHeight,
    cardGap,
    cardY,
    titleY: 118,
    subtitleY: 99,
    iconFrameSize,
    iconSize,
    iconY: 41,
    hotkeyX: -cardWidth / 2 + 14,
    hotkeyY: cardHeight / 2 - 14,
    nameY: 2,
    rarityY: -12,
    accentY: -21,
    effectY: -41,
    effectWidth: cardWidth - 22,
    effectHeight: 36,
    stackY: -cardHeight / 2 + 15,
    cardXs,
    rerollY: -114,
    rerollWidth: 236,
    rerollHeight: 32,
  };
}
