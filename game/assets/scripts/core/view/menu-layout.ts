/**
 * Pure layout, padding, text-formatting, and button visual-state helpers for the `Theme Wood`
 * menu UI (M11 T5, extended in M14 T3 for 4-class Character Select & Meta Shop early unlocks).
 *
 * Zero `cc` imports (`no-restricted-imports` enforced), so vitest verifies:
 * - distinct button states (`normal`, `focused`, `hovered`, `pressed`, `disabled`, `disabled-focused`),
 * - comfortable internal padding and line separation for single-line and two-line buttons,
 * - vertical centering, header-to-button divider placement, and non-clipping bounds across
 *   16:9 (1920×1080, 1280×720), 16:10 (1280×800), and 4:3 (1024×768).
 */
import {
  CHARACTERS,
  characterUnlockReason,
  isCharacterUnlocked,
  resolveSelectedCharacter,
  type CharacterDef,
  type CharacterId,
} from '../characters/roster';
import {
  canBuy,
  costFor,
  maxLevelFor,
  type UpgradeTrack,
} from '../meta/upgrades';
import { canBuyCharacter, type SaveData } from '../save/save-data';

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
  readonly effectFontSize: number;
  readonly effectLineHeight: number;
  /** Compact Evolution pairing hint line between effect description and stack badge (M13). */
  readonly pairHintY: number;
  readonly stackY: number;
  readonly cardXs: readonly number[];
  /** Centred Gold Reroll button below the 3 cards (M12, ADR-021). */
  readonly rerollY: number;
  readonly rerollWidth: number;
  readonly rerollHeight: number;
}

/** Compute the horizontal card positions and interior element anchors for the 1-of-N skill picker. */
export function computeSkillCardLayout(choiceCount: number): SkillCardLayout {
  const cardWidth = 152;
  const cardHeight = 168;
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
    iconY: 44,
    hotkeyX: -cardWidth / 2 + 14,
    hotkeyY: cardHeight / 2 - 14,
    nameY: 5,
    rarityY: -9,
    accentY: -17,
    effectY: -36,
    effectWidth: cardWidth - 16,
    effectHeight: 28,
    effectFontSize: 8,
    effectLineHeight: 9,
    pairHintY: -60,
    stackY: -cardHeight / 2 + 12,
    cardXs,
    rerollY: -114,
    rerollWidth: 236,
    rerollHeight: 32,
  };
}

export interface MenuButtonBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}

export interface CharacterCardSlot extends MenuButtonBox {
  readonly index: number;
  readonly row: number;
  readonly col: number;
}

export interface CharacterSelectLayoutInput {
  readonly visibleWidth?: number;
  readonly visibleHeight?: number;
}

export interface CharacterSelectLayout {
  /** Right X boundary of the open living-backdrop preview stage on the left (`[-visibleWidth/2, stageRightX]`). */
  readonly stageRightX: number;
  readonly panelX: number;
  readonly panelY: number;
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly titleFontSize: number;
  readonly titleY: number;
  readonly subtitleFontSize: number;
  readonly subtitleY: number;
  readonly dividerY: number;
  readonly dividerWidth: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly cardColGap: number;
  readonly cardRowGap: number;
  readonly cardFontSize: number;
  readonly cards: readonly CharacterCardSlot[];
  readonly summaryX: number;
  readonly summaryY: number;
  readonly summaryWidth: number;
  readonly summaryHeight: number;
  readonly summarySafeTextWidth: number;
  readonly statusFontSize: number;
  readonly statusLocalY: number;
  readonly summaryDividerLocalY: number;
  readonly summaryDividerWidth: number;
  readonly weaponFontSize: number;
  readonly weaponLocalY: number;
  readonly passiveTitleFontSize: number;
  readonly passiveTitleLocalY: number;
  readonly passiveBodyFontSize: number;
  readonly passiveBodyLocalY: number;
  readonly signatureTitleFontSize: number;
  readonly signatureTitleLocalY: number;
  readonly signatureBodyFontSize: number;
  readonly signatureBodyLocalY: number;
  readonly primaryButton: MenuButtonBox;
  readonly backButton: MenuButtonBox;
  readonly hintFontSize: number;
  readonly hintY: number;
}

/**
 * Pure 512×288 layout for the 4-class Character Select screen (M14-T3):
 * - Leaves `x ∈ [-256, -126]` completely open on the left so the living-room hero + weapon
 *   attachment (`uiX ≈ -144..-140.8`) stands clearly visible in Chapter 1's sunlit forest.
 * - Docks a `372 × 280` `Theme Wood` plaque on the right (`center x = +62`, `[-124, +248]`)
 *   housing a 2×2 class card grid, a recessed 3-layer class summary well, an early-unlock /
 *   equip action button, and a Back button.
 */
export function computeCharacterSelectLayout(
  input: CharacterSelectLayoutInput = {},
): CharacterSelectLayout {
  const visibleWidth = input.visibleWidth ?? 512;
  const visibleHeight = input.visibleHeight ?? 288;
  const panelWidth = Math.min(372, Math.max(280, Math.round(visibleWidth - 140)));
  const panelHeight = Math.min(280, Math.max(240, Math.round(visibleHeight - 8)));
  const panelX = Math.round(visibleWidth / 2 - 8 - panelWidth / 2);
  const panelY = 0;
  const stageRightX = panelX - panelWidth / 2 - PANEL_SHADOW_EXPAND_PX / 2;

  const innerWidth = panelWidth - 24;
  const cardColGap = 8;
  const cardRowGap = 6;
  const cardWidth = Math.floor((innerWidth - cardColGap) / 2);
  const cardHeight = 32;
  const cardFontSize = 10;
  const rowYs = [78, 78 - cardHeight - cardRowGap] as const;
  const colOffset = (cardWidth + cardColGap) / 2;

  const cards: CharacterCardSlot[] = [
    { index: 0, row: 0, col: 0, x: panelX - colOffset, y: rowYs[0], width: cardWidth, height: cardHeight, fontSize: cardFontSize },
    { index: 1, row: 0, col: 1, x: panelX + colOffset, y: rowYs[0], width: cardWidth, height: cardHeight, fontSize: cardFontSize },
    { index: 2, row: 1, col: 0, x: panelX - colOffset, y: rowYs[1], width: cardWidth, height: cardHeight, fontSize: cardFontSize },
    { index: 3, row: 1, col: 1, x: panelX + colOffset, y: rowYs[1], width: cardWidth, height: cardHeight, fontSize: cardFontSize },
  ];

  const summaryWidth = cardWidth * 2 + cardColGap;
  const summaryHeight = 98;
  const summaryX = panelX;
  const summaryY = -32;
  const summarySafeTextWidth = summaryWidth - 16;

  const actionY = -103;
  const actionHeight = 30;
  const actionGap = 8;
  const backWidth = 108;
  const primaryWidth = summaryWidth - backWidth - actionGap;

  return {
    stageRightX,
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    titleFontSize: 16,
    titleY: 124,
    subtitleFontSize: 9,
    subtitleY: 109,
    dividerY: 101,
    dividerWidth: summaryWidth,
    cardWidth,
    cardHeight,
    cardColGap,
    cardRowGap,
    cardFontSize,
    cards,
    summaryX,
    summaryY,
    summaryWidth,
    summaryHeight,
    summarySafeTextWidth,
    statusFontSize: 9,
    statusLocalY: 39,
    summaryDividerLocalY: 30,
    summaryDividerWidth: summaryWidth - 20,
    weaponFontSize: 9,
    weaponLocalY: 21,
    passiveTitleFontSize: 9,
    passiveTitleLocalY: 6,
    passiveBodyFontSize: 8,
    passiveBodyLocalY: -7,
    signatureTitleFontSize: 9,
    signatureTitleLocalY: -22,
    signatureBodyFontSize: 8,
    signatureBodyLocalY: -35,
    primaryButton: {
      x: panelX - summaryWidth / 2 + primaryWidth / 2,
      y: actionY,
      width: primaryWidth,
      height: actionHeight,
      fontSize: 10,
    },
    backButton: {
      x: panelX + summaryWidth / 2 - backWidth / 2,
      y: actionY,
      width: backWidth,
      height: actionHeight,
      fontSize: 11,
    },
    hintFontSize: 8,
    hintY: -130,
  };
}

export type MenuGridDirection = 'up' | 'down' | 'left' | 'right';

/**
 * 2D focus navigation across Character Select's 6 controls:
 * - `0..3`: 2×2 character cards (`Ninja`, `Archer`, `Mage`, `Cultivator`)
 * - `4`: Primary Select / Unlock Early button
 * - `5`: Back button
 *
 * `left`/`right` on `0..3` cycles cleanly through all 4 classes (`0 ↔ 1 ↔ 2 ↔ 3`); moving `up`
 * from the action bar (`4` or `5`) returns directly to `highlightedCard` so inspecting and
 * unlocking `Archer` (`1`) never strands or swaps your highlighted class.
 */
export function nextCharacterSelectFocus(
  current: number,
  direction: MenuGridDirection,
  highlightedCard = 0,
): number {
  const clampedCard = Math.min(3, Math.max(0, Math.trunc(highlightedCard)));
  const index = Math.min(5, Math.max(0, Math.trunc(current)));

  if (direction === 'left' || direction === 'right') {
    const delta = direction === 'left' ? -1 : 1;
    if (index <= 3) return (index + delta + 4) % 4;
    return index === 4 ? 5 : 4;
  }

  if (direction === 'down') {
    if (index === 0) return 2;
    if (index === 1) return 3;
    if (index === 2) return 4;
    if (index === 3) return 4;
    return clampedCard;
  }

  // direction === 'up'
  if (index === 0) return 4;
  if (index === 1) return 5;
  if (index === 2) return 0;
  if (index === 3) return 1;
  return clampedCard;
}

export interface ShopScreenLayoutInput {
  readonly visibleWidth?: number;
  readonly visibleHeight?: number;
  readonly hasCharacterSelect?: boolean;
}

export interface ShopScreenLayout {
  readonly panelX: number;
  readonly panelY: number;
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly titleFontSize: number;
  readonly titleY: number;
  readonly subtitleFontSize: number;
  readonly subtitleY: number;
  readonly infoFontSize: number;
  readonly infoY: number;
  readonly dividerY: number;
  readonly dividerWidth: number;
  readonly leftHeaderX: number;
  readonly rightHeaderX: number;
  readonly sectionHeaderY: number;
  readonly sectionHeaderFontSize: number;
  readonly colWidth: number;
  readonly rowHeight: number;
  readonly rowFontSize: number;
  /** Stat upgrade track slots (`0..2`: Hearts, Damage, Fire rate) on the left column. */
  readonly upgradeSlots: readonly MenuButtonBox[];
  /** Early character unlock slots (`3..5`: Archer, Mage, Cultivator) on the right column. */
  readonly characterSlots: readonly MenuButtonBox[];
  /** Optional `Character Select` navigation button (`index 6`) on the bottom-left. */
  readonly characterSelectButton: MenuButtonBox | null;
  /** `Back` button (`index 7` when `characterSelectButton` exists, otherwise `index 6`). */
  readonly backButton: MenuButtonBox;
  readonly hintFontSize: number;
  readonly hintY: number;
}

/**
 * Pure 512×288 two-column layout for the Meta Shop (M14-T3):
 * - Left column: 3 permanent stat tracks (`Hearts`, `Damage`, `Fire rate`).
 * - Right column: 3 early character unlocks (`Archer`, `Mage`, `Cultivator`).
 * - Footer row: optional `Character Select` shortcut + `Back` button.
 */
export function computeShopScreenLayout(input: ShopScreenLayoutInput = {}): ShopScreenLayout {
  const visibleWidth = input.visibleWidth ?? 512;
  const visibleHeight = input.visibleHeight ?? 288;
  const hasCharacterSelect = input.hasCharacterSelect === true;

  const panelWidth = Math.min(476, Math.max(360, Math.round(visibleWidth - 36)));
  const panelHeight = Math.min(272, Math.max(240, Math.round(visibleHeight - 16)));
  const colGap = 12;
  const colWidth = Math.floor((panelWidth - 32 - colGap) / 2);
  const colOffset = (colWidth + colGap) / 2;
  const rowHeight = 35;
  const rowGap = 5;
  const rowFontSize = 11;
  const rowYs = [40, 40 - (rowHeight + rowGap), 40 - 2 * (rowHeight + rowGap)] as const;

  const upgradeSlots: MenuButtonBox[] = rowYs.map((y) => ({
    x: -colOffset,
    y,
    width: colWidth,
    height: rowHeight,
    fontSize: rowFontSize,
  }));

  const characterSlots: MenuButtonBox[] = rowYs.map((y) => ({
    x: colOffset,
    y,
    width: colWidth,
    height: rowHeight,
    fontSize: rowFontSize,
  }));

  const bottomY = -83;
  const bottomHeight = 28;
  const bottomFontSize = 11;

  return {
    panelX: 0,
    panelY: 0,
    panelWidth,
    panelHeight,
    titleFontSize: 18,
    titleY: 117,
    subtitleFontSize: 9,
    subtitleY: 99,
    infoFontSize: 8,
    infoY: 86,
    dividerY: 78,
    dividerWidth: colWidth * 2 + colGap,
    leftHeaderX: -colOffset,
    rightHeaderX: colOffset,
    sectionHeaderY: 68,
    sectionHeaderFontSize: 9,
    colWidth,
    rowHeight,
    rowFontSize,
    upgradeSlots,
    characterSlots,
    characterSelectButton: hasCharacterSelect
      ? {
          x: -colOffset,
          y: bottomY,
          width: colWidth,
          height: bottomHeight,
          fontSize: bottomFontSize,
        }
      : null,
    backButton: {
      x: hasCharacterSelect ? colOffset : 0,
      y: bottomY,
      width: colWidth,
      height: bottomHeight,
      fontSize: bottomFontSize,
    },
    hintFontSize: 8,
    hintY: -117,
  };
}

/**
 * 2D focus navigation for the two-column Meta Shop:
 * - `0..2`: left column stat tracks (`Hearts`, `Damage`, `Fire rate`)
 * - `3..5`: right column character early unlocks (`Archer`, `Mage`, `Cultivator`)
 * - `6` (and `7` when `hasCharacterSelect`): bottom row (`Character Select`, `Back`).
 */
export function nextShopScreenFocus(
  current: number,
  direction: MenuGridDirection,
  hasCharacterSelect: boolean,
): number {
  const maxIndex = hasCharacterSelect ? 7 : 6;
  const index = Math.min(maxIndex, Math.max(0, Math.trunc(current)));

  if (direction === 'left' || direction === 'right') {
    if (index <= 2) return index + 3;
    if (index <= 5) return index - 3;
    if (hasCharacterSelect) return index === 6 ? 7 : 6;
    return 6;
  }

  const leftCol = hasCharacterSelect ? [0, 1, 2, 6] : [0, 1, 2, 6];
  const rightCol = hasCharacterSelect ? [3, 4, 5, 7] : [3, 4, 5, 6];
  const inRight = (index >= 3 && index <= 5) || index === 7;
  const col = inRight ? rightCol : leftCol;
  const pos = col.indexOf(index);
  const step = direction === 'down' ? 1 : -1;
  return col[(pos + step + col.length) % col.length] ?? 0;
}

/** Unlockable classes shown in the Meta Shop's `HERO UNLOCKS` column, in progression order. */
export const SHOP_UNLOCK_CHARACTER_IDS = ['archer', 'mage', 'cultivator'] as const;

export interface ShopRowText {
  readonly label: string;
  readonly detail: string;
  readonly disabled: boolean;
}

const SHOP_TRACK_NAMES: Readonly<Record<UpgradeTrack, string>> = {
  hearts: 'Hearts',
  damage: 'Damage',
  fireRate: 'Fire rate',
};

/** Label + detail for one permanent stat track (`216 × 35` button). */
export function upgradeRow(save: SaveData, track: UpgradeTrack): ShopRowText {
  const level = save.upgrades[track];
  const max = maxLevelFor(track);
  const name = SHOP_TRACK_NAMES[track];
  const label = `${name}   Lv ${level}/${max}`;

  if (level >= max) {
    return { label, detail: 'Maxed out', disabled: true };
  }

  const price = costFor(track, level + 1);
  const affordable = canBuy(save, track, save.gold);
  const short = Math.max(0, price - save.gold);
  return {
    label,
    detail: affordable ? `Next: ${price} gold` : `Next: ${price}g — need ${short}g more`,
    disabled: !affordable,
  };
}

/** Label + detail for one early character unlock row in Meta Shop (`216 × 35` button). */
export function characterShopRow(save: SaveData, characterId: CharacterId): ShopRowText {
  const def = CHARACTERS[characterId];
  if (isCharacterUnlocked(characterId, save)) {
    return {
      label: `${def.name} — UNLOCKED`,
      detail: characterUnlockReason(characterId, save),
      disabled: true,
    };
  }

  const cost = def.unlockGoldCost;
  const affordable = canBuyCharacter(save, characterId);
  const short = Math.max(0, cost - save.gold);
  return {
    label: `${def.name} — ${cost}g`,
    detail: affordable
      ? `Buy early (or clear Ch${def.unlockChapter})`
      : `Need ${short}g more (or clear Ch${def.unlockChapter})`,
    disabled: !affordable,
  };
}

export function formatTitleCharacterLabel(character: CharacterDef): string {
  return `Character: ${character.name}`;
}

export function formatTitleCharacterDetail(
  character: CharacterDef,
  availableCount: number,
): string {
  if (availableCount <= 1) return `${character.subtitle} · View 4 classes`;
  return `${character.subtitle} (←/→ or Enter)`;
}

export interface CharacterCardText {
  readonly label: string;
  readonly detail: string;
  readonly status: 'selected' | 'unlocked' | 'locked';
}

export interface CharacterPrimaryActionSpec {
  readonly label: string;
  readonly detail: string;
  readonly disabled: boolean;
  readonly kind: 'confirm' | 'select' | 'unlock';
}

export interface CharacterSummaryLines {
  readonly statusLine: string;
  readonly statusKind: 'selected' | 'unlocked' | 'locked';
  readonly weaponLine: string;
  readonly passiveTitle: string;
  readonly passiveBody: string;
  readonly signatureTitle: string;
  readonly signatureBody: string;
}

/** Format label + detail for one of the 4 character cards (`170 × 32`). */
export function formatCharacterCardText(
  character: CharacterDef,
  save: SaveData,
): CharacterCardText {
  const activeId = resolveSelectedCharacter(save).id;
  const unlocked = isCharacterUnlocked(character.id, save);
  if (unlocked && character.id === activeId) {
    return {
      label: `${character.name} — SELECTED`,
      detail: character.subtitle,
      status: 'selected',
    };
  }
  if (unlocked) {
    return {
      label: `${character.name} — UNLOCKED`,
      detail: character.subtitle,
      status: 'unlocked',
    };
  }
  return {
    label: `${character.name} — LOCKED`,
    detail: `Clear Ch${character.unlockChapter} or ${character.unlockGoldCost}g`,
    status: 'locked',
  };
}

/** Format all 3 class-identity layers + unlock status line for the recessed summary well. */
export function formatCharacterSummaryLines(
  character: CharacterDef,
  save: SaveData,
): CharacterSummaryLines {
  const activeId = resolveSelectedCharacter(save).id;
  const unlocked = isCharacterUnlocked(character.id, save);
  const reason = characterUnlockReason(character.id, save);
  const statusKind: CharacterSummaryLines['statusKind'] = !unlocked
    ? 'locked'
    : character.id === activeId
      ? 'selected'
      : 'unlocked';
  const tag =
    statusKind === 'selected'
      ? 'SELECTED'
      : statusKind === 'unlocked'
        ? 'UNLOCKED'
        : 'LOCKED';

  return {
    statusLine: `${character.name.toUpperCase()} · ${tag} — ${reason}`,
    statusKind,
    weaponLine: `Weapon · ${character.weaponSummary}`,
    passiveTitle: `Passive · ${character.passiveName}`,
    passiveBody: character.passiveSummary,
    signatureTitle: `Signature [E] · ${character.signatureName}`,
    signatureBody: character.signatureSummary,
  };
}

/** Format the dynamic Primary Select / Early Gold Unlock button below the summary well. */
export function formatCharacterPrimaryAction(
  character: CharacterDef,
  save: SaveData,
): CharacterPrimaryActionSpec {
  const activeId = resolveSelectedCharacter(save).id;
  const unlocked = isCharacterUnlocked(character.id, save);

  if (unlocked && character.id === activeId) {
    return {
      label: `Selected: ${character.name}`,
      detail: 'Active for next run (Enter to confirm)',
      disabled: false,
      kind: 'confirm',
    };
  }
  if (unlocked) {
    return {
      label: `Select ${character.name}`,
      detail: 'Equip for your next run',
      disabled: false,
      kind: 'select',
    };
  }

  const cost = character.unlockGoldCost;
  const affordable = canBuyCharacter(save, character.id);
  const short = Math.max(0, cost - save.gold);
  return {
    label: `Unlock ${character.name} — ${cost}g`,
    detail: affordable
      ? 'Buy early with Meta gold & equip'
      : `Need ${short}g more (or clear Ch${character.unlockChapter})`,
    disabled: !affordable,
    kind: 'unlock',
  };
}

export function formatCharacterSelectSubtitle(gold: number): string {
  return `Gold: ${gold}g · Preview & choose your hero`;
}
