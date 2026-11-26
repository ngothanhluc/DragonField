/**
 * Pure layout, padding, text-formatting, and button visual-state helpers for the `Theme Wood`
 * menu UI (M11 T5, M14 T3, extended in M15 for Continue Run, Ascension 0–5, 6-track Meta Shop,
 * and Rich Run Results).
 *
 * Zero `cc` imports (`no-restricted-imports` enforced), so vitest verifies:
 * - distinct button states (`normal`, `focused`, `hovered`, `pressed`, `disabled`, `disabled-focused`),
 * - comfortable internal padding and line separation for single-line and two-line buttons,
 * - vertical centering, header-to-button divider placement, and non-clipping bounds across
 *   16:9 (1920×1080, 1280×720), 16:10 (1280×800), and 4:3 (1024×768).
 */
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  characterUnlockReason,
  isCharacterId,
  isCharacterUnlocked,
  resolveSelectedCharacter,
  type CharacterDef,
  type CharacterId,
} from '../characters/roster';
import {
  getLocale,
  localizeCharacterField,
  localizeCharacterName,
  localizeUpgradeTrack,
  t,
  type Locale,
} from '../i18n';
import {
  STAT_UPGRADE_TRACKS,
  UPGRADE_TRACKS,
  UTILITY_UPGRADE_TRACKS,
  applyUpgrades,
  applyUtilityUpgrades,
  canBuy,
  costFor,
  maxLevelFor,
  type UpgradeTrack,
} from '../meta/upgrades';
import { MAX_ASCENSION, ascensionLabel, clampAscension } from '../run/ascension';
import {
  formatBuildSummary,
  formatDeathCause,
  formatRunUnlocks,
  type DeathCause,
  type RunUnlocksSummary,
} from '../run/run-summary';
import type { ActiveRunSave } from '../save/run-save';
import { canBuyCharacter, type BestProgress, type SaveData } from '../save/save-data';

/**
 * Width of the centred column on Title and Chapter Select (design px).
 *
 * At 512×288 design resolution, 252 px keeps the exact same integer tile keep-out footprint as
 * 240 px (`16` tiles at `worldScale = 1.0`, `20` tiles at `worldScale = 0.8`) while giving
 * long subtitles comfortable horizontal padding.
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
  const safeTextWidth = Math.max(
    0,
    input.width - (THEME_WOOD_BORDERS.button.left + THEME_WOOD_BORDERS.button.right + 8),
  );
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
 * - Floating modal plaques (Settings / Pause / Credits) wrap tightly around header + divider +
 *   buttons + hint and centre vertically on screen.
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

// ---------------------------------------------------------------------------
// M15: Continue Run (Title Screen)
// ---------------------------------------------------------------------------

/**
 * Concise `Continue Run` subtitle showing Hero, `Ch<N> R<M>`, and optional `A<X>` / `E<Y>` tags.
 * Fits cleanly inside Title's `224 × 29` button (`safeTextWidth = 208` px).
 */
export function formatContinueRunDetail(run: ActiveRunSave, locale: Locale = getLocale()): string {
  const charId = isCharacterId(run.characterId) ? run.characterId : DEFAULT_CHARACTER_ID;
  const hero = localizeCharacterName(charId, locale);
  const parts = [
    hero,
    t('title.continueChapterRoom', { chapter: run.chapter, room: run.roomIndex }, locale),
  ];
  if (run.ascension > 0) {
    parts.push(`A${clampAscension(run.ascension)}`);
  }
  if (run.endlessLoop > 0) {
    parts.push(`E${Math.trunc(run.endlessLoop)}`);
  }
  return parts.join(' · ');
}

/** Compact best-depth summary for single-line Title header when `Continue Run` is shown. */
export function formatTitleCompactBest(best: BestProgress, locale: Locale = getLocale()): string {
  if (best.chapter <= 0 || best.room <= 0) return t('title.bestNone', undefined, locale);
  return t('title.bestCompact', { chapter: best.chapter, room: best.room }, locale);
}

/**
 * Header info lines for Title:
 * - Standard 5-button Title: 2 lines (`Gold <N>`, `Best: chapter <C> · room <R>`).
 * - 6-button Title with `Continue Run`: 1 compact line (`Gold <N> · Best Ch<C> R<R>`) so all 6
 *   two-line buttons fit inside the `252 × 280` column with generous focus-ring clearance.
 */
export function formatTitleInfoLines(
  gold: number,
  best: BestProgress,
  fullBestText: string,
  hasContinueRun: boolean,
  locale: Locale = getLocale(),
): readonly string[] {
  if (!hasContinueRun) {
    return [t('title.goldLine', { gold }, locale), fullBestText];
  }
  return [
    t('title.compactInfo', { gold, best: formatTitleCompactBest(best, locale) }, locale),
  ];
}

// ---------------------------------------------------------------------------
// M15: Chapter Select + Ascension 0–5 Selector
// ---------------------------------------------------------------------------

/** Maximum characters per Ascension summary line inside the `252` px Chapter Select column. */
export const ASCENSION_SUMMARY_MAX_CHARS = 44;

export interface ChapterSelectLayoutInput {
  readonly visibleWidth?: number;
  readonly visibleHeight?: number;
  readonly chapterCount?: number;
}

export interface ChapterSelectLayout {
  readonly panelWidth: number;
  readonly panelHeight: number;
  readonly panelY: number;
  readonly titleFontSize: number;
  readonly titleY: number;
  readonly bestFontSize: number;
  readonly bestY: number;
  readonly dividerY: number;
  readonly dividerWidth: number;
  readonly chapterSlots: readonly MenuButtonBox[];
  readonly ascensionRowY: number;
  readonly ascensionPrevButton: MenuButtonBox;
  readonly ascensionNextButton: MenuButtonBox;
  readonly ascensionLabelX: number;
  readonly ascensionLabelY: number;
  readonly ascensionLabelFontSize: number;
  readonly ascensionLabelSafeWidth: number;
  readonly summaryFontSize: number;
  readonly summarySafeWidth: number;
  readonly summaryLineYs: readonly [number, number, number];
  readonly backButton: MenuButtonBox;
  readonly hintFontSize: number;
  readonly hintY: number;
}

/**
 * Pure 512×288 layout for Chapter Select with Ascension 0–5 `<` / `>` selector inside the centred
 * `MENU_COLUMN_WIDTH` (`252 × 280`) column so the living chapter backdrop and hero stay uncovered.
 */
export function computeChapterSelectLayout(
  input: ChapterSelectLayoutInput = {},
): ChapterSelectLayout {
  const visibleWidth = input.visibleWidth ?? 512;
  const visibleHeight = input.visibleHeight ?? 288;
  const count = Math.max(1, Math.min(4, Math.trunc(input.chapterCount ?? 4)));

  const panelWidth = Math.round(
    Math.min(MENU_COLUMN_WIDTH, Math.max(180, visibleWidth - 24)),
  );
  const panelHeight = Math.max(240, Math.min(280, Math.round(visibleHeight - 8)));
  const innerWidth = panelWidth - 28;
  const dividerWidth = Math.max(64, panelWidth - PANEL_WELL_INSET_PX * 2 - 20);

  const chapterHeight = 29;
  const chapterGap = 2.5;
  const chapterFontSize = 10;
  const firstChapterY = 82.5;

  const chapterSlots: MenuButtonBox[] = [];
  for (let i = 0; i < count; i += 1) {
    chapterSlots.push({
      x: 0,
      y: firstChapterY - i * (chapterHeight + chapterGap),
      width: innerWidth,
      height: chapterHeight,
      fontSize: chapterFontSize,
    });
  }

  const ascensionRowY = -44.5;
  const arrowWidth = 28;
  const arrowHeight = 22;
  const arrowOffset = innerWidth / 2 - arrowWidth / 2;

  return {
    panelWidth,
    panelHeight,
    panelY: 0,
    titleFontSize: 14,
    titleY: 126,
    bestFontSize: 8,
    bestY: 109,
    dividerY: 102,
    dividerWidth,
    chapterSlots,
    ascensionRowY,
    ascensionPrevButton: {
      x: -arrowOffset,
      y: ascensionRowY,
      width: arrowWidth,
      height: arrowHeight,
      fontSize: 10,
    },
    ascensionNextButton: {
      x: arrowOffset,
      y: ascensionRowY,
      width: arrowWidth,
      height: arrowHeight,
      fontSize: 10,
    },
    ascensionLabelX: 0,
    ascensionLabelY: ascensionRowY,
    ascensionLabelFontSize: 10,
    ascensionLabelSafeWidth: Math.max(64, innerWidth - arrowWidth * 2 - 12),
    summaryFontSize: 8,
    summarySafeWidth: innerWidth,
    summaryLineYs: [-65, -77.5, -90],
    backButton: {
      x: 0,
      y: -110.5,
      width: innerWidth,
      height: 22,
      fontSize: 10,
    },
    hintFontSize: 8,
    hintY: -131.5,
  };
}

/** Subtitle on a Chapter Select button reflecting playable state and active/unlocked Ascension. */
export function formatChapterButtonDetail(
  playable: boolean,
  hasData: boolean,
  isSelectedChapter: boolean,
  selectedAscension: number,
  maxAscension: number,
  locale: Locale = getLocale(),
): string {
  if (!playable) {
    return hasData
      ? t('chapter.detailLocked', undefined, locale)
      : t('chapter.detailNoData', undefined, locale);
  }
  const clampedSel = clampAscension(selectedAscension);
  const clampedMax = clampAscension(maxAscension);
  if (isSelectedChapter) {
    return clampedSel > 0
      ? t('chapter.detailEnterAscension', { level: clampedSel }, locale)
      : t('chapter.detailEnter', undefined, locale);
  }
  return clampedMax > 0
    ? t('chapter.detailMaxAscension', { level: clampedMax }, locale)
    : t('chapter.detailEnter', undefined, locale);
}

/** Subtle bottom hint explaining how higher Ascension tiers unlock on clear. */
export function formatChapterAscensionHint(
  playable: boolean,
  maxUnlocked: number,
  locale: Locale = getLocale(),
): string {
  if (!playable) {
    return t('chapter.hintLocked', undefined, locale);
  }
  const clampedMax = clampAscension(maxUnlocked);
  if (clampedMax >= MAX_ASCENSION) {
    return t('chapter.hintAllAscension', undefined, locale);
  }
  if (clampedMax === 0) {
    return t('chapter.hintUnlockAsc1', undefined, locale);
  }
  return t('chapter.hintUnlockNextAsc', { current: clampedMax, next: clampedMax + 1 }, locale);
}

/**
 * Focus navigation across Chapter Select controls:
 * - `0 .. chapterCount - 1`: Chapter rows
 * - `chapterCount`: Ascension `<` button
 * - `chapterCount + 1`: Ascension `>` button
 * - `chapterCount + 2`: `Back` button
 */
export function nextChapterSelectFocus(
  current: number,
  direction: MenuGridDirection,
  chapterCount = 4,
): number {
  const count = Math.max(1, Math.trunc(chapterCount));
  const prevIdx = count;
  const nextIdx = count + 1;
  const backIdx = count + 2;
  const index = Math.min(backIdx, Math.max(0, Math.trunc(current)));

  if (direction === 'left' || direction === 'right') {
    if (index === prevIdx) return nextIdx;
    if (index === nextIdx) return prevIdx;
    return index;
  }

  if (direction === 'down') {
    if (index < count - 1) return index + 1;
    if (index === count - 1) return prevIdx;
    if (index === prevIdx || index === nextIdx) return backIdx;
    return 0;
  }

  // direction === 'up'
  if (index === 0) return backIdx;
  if (index < count) return index - 1;
  if (index === prevIdx || index === nextIdx) return count - 1;
  return prevIdx;
}

// ---------------------------------------------------------------------------
// M15: Expanded 3-Column Meta Shop (STAT + UTILITY + HERO UNLOCKS)
// ---------------------------------------------------------------------------

/** Unlockable classes shown in the Meta Shop's `HERO UNLOCKS` column, in progression order. */
export const SHOP_UNLOCK_CHARACTER_IDS = ['archer', 'mage', 'cultivator'] as const;

/** Button index of the first `HERO UNLOCKS` row (`Archer`), right after all 6 upgrade tracks. */
export const SHOP_CHARACTER_START_INDEX = UPGRADE_TRACKS.length;

/** Button index of the optional `Character select` shortcut in the Meta Shop footer. */
export const SHOP_CHAR_SELECT_BUTTON_INDEX =
  UPGRADE_TRACKS.length + SHOP_UNLOCK_CHARACTER_IDS.length;

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
  readonly statHeaderX: number;
  readonly utilityHeaderX: number;
  readonly heroHeaderX: number;
  /** Alias for `statHeaderX` (leftmost column). */
  readonly leftHeaderX: number;
  /** Alias for `heroHeaderX` (rightmost column). */
  readonly rightHeaderX: number;
  readonly sectionHeaderY: number;
  readonly sectionHeaderFontSize: number;
  readonly colWidth: number;
  readonly colGap: number;
  readonly rowHeight: number;
  readonly rowFontSize: number;
  /** Stat upgrade track slots (`0..2`: `hearts`, `damage`, `fireRate`). */
  readonly statSlots: readonly MenuButtonBox[];
  /** Utility upgrade track slots (`3..5`: `xpMagnet`, `goldBonus`, `freeRerolls`). */
  readonly utilitySlots: readonly MenuButtonBox[];
  /** All 6 upgrade track slots (`0..5` in `UPGRADE_TRACKS` order: Stat then Utility). */
  readonly upgradeSlots: readonly MenuButtonBox[];
  /** Early character unlock slots (`6..8`: `archer`, `mage`, `cultivator`). */
  readonly characterSlots: readonly MenuButtonBox[];
  /** Optional `Character select` navigation button (`index 9`) on the bottom-left. */
  readonly characterSelectButton: MenuButtonBox | null;
  /** `Back` button (`index 10` when `characterSelectButton` exists, otherwise `index 9`). */
  readonly backButton: MenuButtonBox;
  readonly hintFontSize: number;
  readonly hintY: number;
}

/**
 * Pure 512×288 three-column layout for the Expanded Meta Shop (M15):
 * - Column 1 (`STAT UPGRADES`): `Hearts`, `Damage`, `Fire rate`.
 * - Column 2 (`UTILITY UPGRADES`): `XP magnet`, `Gold bonus`, `Free rerolls` (NO Revive!).
 * - Column 3 (`HERO UNLOCKS`): `Archer`, `Mage`, `Cultivator`.
 * - Footer row: optional `Character select` shortcut + `Back` button.
 */
export function computeShopScreenLayout(input: ShopScreenLayoutInput = {}): ShopScreenLayout {
  const visibleWidth = input.visibleWidth ?? 512;
  const visibleHeight = input.visibleHeight ?? 288;
  const hasCharacterSelect = input.hasCharacterSelect === true;

  const panelWidth = Math.min(504, Math.max(380, Math.round(visibleWidth - 8)));
  const panelHeight = Math.min(272, Math.max(240, Math.round(visibleHeight - 16)));
  const colGap = 8;
  const colWidth = Math.floor((panelWidth - 20 - colGap * 2) / 3);
  const colSpan = colWidth + colGap;
  const statHeaderX = -colSpan;
  const utilityHeaderX = 0;
  const heroHeaderX = colSpan;

  const rowHeight = 35;
  const rowGap = 5;
  const rowFontSize = 10;
  const rowYs = [40, 40 - (rowHeight + rowGap), 40 - 2 * (rowHeight + rowGap)] as const;

  const statSlots: MenuButtonBox[] = STAT_UPGRADE_TRACKS.map((_, i) => ({
    x: statHeaderX,
    y: rowYs[i] ?? 0,
    width: colWidth,
    height: rowHeight,
    fontSize: rowFontSize,
  }));

  const utilitySlots: MenuButtonBox[] = UTILITY_UPGRADE_TRACKS.map((_, i) => ({
    x: utilityHeaderX,
    y: rowYs[i] ?? 0,
    width: colWidth,
    height: rowHeight,
    fontSize: rowFontSize,
  }));

  const characterSlots: MenuButtonBox[] = SHOP_UNLOCK_CHARACTER_IDS.map((_, i) => ({
    x: heroHeaderX,
    y: rowYs[i] ?? 0,
    width: colWidth,
    height: rowHeight,
    fontSize: rowFontSize,
  }));

  const bottomY = -83;
  const bottomHeight = 28;
  const bottomFontSize = 10;
  const bottomGap = 12;
  const bottomWidth = Math.min(200, colWidth + 28);
  const bottomOffset = (bottomWidth + bottomGap) / 2;

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
    dividerWidth: colWidth * 3 + colGap * 2,
    statHeaderX,
    utilityHeaderX,
    heroHeaderX,
    leftHeaderX: statHeaderX,
    rightHeaderX: heroHeaderX,
    sectionHeaderY: 68,
    sectionHeaderFontSize: 9,
    colWidth,
    colGap,
    rowHeight,
    rowFontSize,
    statSlots,
    utilitySlots,
    upgradeSlots: [...statSlots, ...utilitySlots],
    characterSlots,
    characterSelectButton: hasCharacterSelect
      ? {
          x: -bottomOffset,
          y: bottomY,
          width: bottomWidth,
          height: bottomHeight,
          fontSize: bottomFontSize,
        }
      : null,
    backButton: {
      x: hasCharacterSelect ? bottomOffset : 0,
      y: bottomY,
      width: bottomWidth,
      height: bottomHeight,
      fontSize: bottomFontSize,
    },
    hintFontSize: 8,
    hintY: -117,
  };
}

/**
 * 2D focus navigation for the three-column Meta Shop:
 * - `0..2`: left column stat tracks (`Hearts`, `Damage`, `Fire rate`)
 * - `3..5`: middle column utility tracks (`XP magnet`, `Gold bonus`, `Free rerolls`)
 * - `6..8`: right column character early unlocks (`Archer`, `Mage`, `Cultivator`)
 * - `9` (and `10` when `hasCharacterSelect`): bottom row (`Character select`, `Back`).
 */
export function nextShopScreenFocus(
  current: number,
  direction: MenuGridDirection,
  hasCharacterSelect: boolean,
): number {
  const maxIndex = hasCharacterSelect ? 10 : 9;
  const index = Math.min(maxIndex, Math.max(0, Math.trunc(current)));

  if (direction === 'left' || direction === 'right') {
    const delta = direction === 'left' ? -1 : 1;
    if (index <= 8) {
      const col = Math.floor(index / 3);
      const row = index % 3;
      const nextCol = (col + delta + 3) % 3;
      return nextCol * 3 + row;
    }
    if (hasCharacterSelect) return index === 9 ? 10 : 9;
    return 9;
  }

  const statCol = [0, 1, 2, 9];
  const utilCol = [3, 4, 5, 9];
  const heroCol = [6, 7, 8, hasCharacterSelect ? 10 : 9];

  let col: readonly number[];
  if (index >= 6 && index <= 8) {
    col = heroCol;
  } else if (index === 10) {
    col = heroCol;
  } else if (index >= 3 && index <= 5) {
    col = utilCol;
  } else {
    col = statCol;
  }

  const pos = col.indexOf(index);
  const step = direction === 'down' ? 1 : -1;
  return col[(pos + step + col.length) % col.length] ?? 0;
}

/** Compact one-line summary of all 6 Stat + Utility Meta bonuses for the Shop header. */
export function formatShopBonusSummary(save: SaveData, locale: Locale = getLocale()): string {
  const stat = applyUpgrades(save);
  const util = applyUtilityUpgrades(save);
  const dmgPct = Math.round((stat.damageMultiplier - 1) * 100);
  const ratePct = Math.round((stat.fireRateMultiplier - 1) * 100);
  const magPct = Math.round((util.xpMagnetMult - 1) * 100);
  const goldPct = Math.round((util.goldBonusMult - 1) * 100);
  return t(
    'shop.bonusSummary',
    {
      hearts: stat.maxHeartsBonus,
      dmg: dmgPct,
      rate: ratePct,
      magnet: magPct,
      gold: goldPct,
      rerolls: util.freeRerolls,
    },
    locale,
  );
}

export interface ShopRowText {
  readonly label: string;
  readonly detail: string;
  readonly disabled: boolean;
}

/** Label + detail for one permanent Stat or Utility upgrade track (`156 × 35` button). */
export function upgradeRow(
  save: SaveData,
  track: UpgradeTrack,
  locale: Locale = getLocale(),
): ShopRowText {
  const level = save.upgrades[track];
  const max = maxLevelFor(track);
  const name = localizeUpgradeTrack(track, locale);
  const label = t('shop.trackRowLabel', { name, level, max }, locale);

  if (level >= max) {
    return { label, detail: t('shop.maxedOut', undefined, locale), disabled: true };
  }

  const price = costFor(track, level + 1);
  const affordable = canBuy(save, track, save.gold);
  const short = Math.max(0, price - save.gold);
  return {
    label,
    detail: affordable
      ? t('shop.nextGold', { price }, locale)
      : t('shop.nextNeed', { price, short }, locale),
    disabled: !affordable,
  };
}

/** Label + detail for one early character unlock row in Meta Shop (`156 × 35` button). */
export function characterShopRow(
  save: SaveData,
  characterId: CharacterId,
  locale: Locale = getLocale(),
): ShopRowText {
  const def = CHARACTERS[characterId];
  const name = localizeCharacterName(characterId, locale);
  if (isCharacterUnlocked(characterId, save)) {
    return {
      label: t('shop.heroUnlocked', { name }, locale),
      detail: characterUnlockReason(characterId, save, locale),
      disabled: true,
    };
  }

  const cost = def.unlockGoldCost;
  const affordable = canBuyCharacter(save, characterId);
  const short = Math.max(0, cost - save.gold);
  return {
    label: t('shop.heroCost', { name, cost }, locale),
    detail: affordable
      ? t('shop.heroBuyEarly', { chapter: def.unlockChapter }, locale)
      : t('shop.heroNeed', { short, chapter: def.unlockChapter }, locale),
    disabled: !affordable,
  };
}

// ---------------------------------------------------------------------------
// M15: Rich Results / Death Screen Layout & Formatting
// ---------------------------------------------------------------------------

/** Maximum characters per summary line on the `476` px Rich Result plaque (`safeWidth = 446` px). */
export const RESULT_LINE_MAX_CHARS = 64;

export interface SkillSummaryEntry {
  readonly id: string;
  readonly stacks: number;
}

/**
 * Flexible skill-map input accepted by `RunResultData`:
 * - `ReadonlyMap<string, number>` (exact input type of `formatBuildSummary` / `SkillRun.snapshot()`)
 * - `Readonly<Record<string, number>>` (`ActiveRunSave['ownedSkills']`)
 * - `readonly SkillSummaryEntry[]` (`{ id, stacks }[]`)
 */
export type RunResultOwnedSkills =
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>
  | readonly SkillSummaryEntry[];

export interface ResultSummaryInput {
  readonly chapter: number;
  readonly roomReached: number;
  readonly roomsTotal: number;
  readonly goldEarned: number;
  readonly goldTotal: number;
  readonly durationMs: number;
  readonly kills: number;
  readonly won: boolean;
  readonly unlockedChapter?: number;
  readonly seed?: number;
  readonly ascension?: number;
  readonly endlessLoop?: number;
  readonly characterId?: CharacterId;
  readonly deathCause?: DeathCause;
  readonly ownedSkills?: RunResultOwnedSkills;
  readonly unlocks?: RunUnlocksSummary;
  readonly canContinueEndless?: boolean;
}

export type ResultLineKind = 'meta' | 'stats' | 'evolution' | 'skills' | 'unlock';

export interface ResultSummaryLine {
  readonly text: string;
  readonly kind: ResultLineKind;
}

export interface ResultSummaryOutput {
  readonly title: string;
  readonly subtitle: string;
  readonly lines: readonly ResultSummaryLine[];
}

/** mm:ss, seconds rounded down. */
export function formatDuration(durationMs: number): string {
  const total = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs / 1000)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Normalize any `RunResultOwnedSkills` representation into a `ReadonlyMap<string, number>`. */
export function toOwnedSkillsMap(
  ownedSkills: RunResultOwnedSkills | undefined,
): ReadonlyMap<string, number> {
  if (ownedSkills === undefined) return new Map();
  if (ownedSkills instanceof Map) return ownedSkills;
  if (Array.isArray(ownedSkills)) {
    const out = new Map<string, number>();
    for (const entry of ownedSkills) {
      out.set(entry.id, entry.stacks);
    }
    return out;
  }
  if ('forEach' in ownedSkills && typeof ownedSkills.forEach === 'function') {
    const out = new Map<string, number>();
    (ownedSkills as ReadonlyMap<string, number>).forEach((stacks, id) => {
      out.set(id, stacks);
    });
    return out;
  }
  const out = new Map<string, number>();
  const record = ownedSkills as Readonly<Record<string, number>>;
  for (const id of Object.keys(record)) {
    const stacks = record[id];
    if (stacks !== undefined) out.set(id, stacks);
  }
  return out;
}

function packTokensToLines(
  tokens: readonly string[],
  separator: string,
  maxLineLength: number,
  maxLines: number,
  locale: Locale,
): string[] {
  if (tokens.length === 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (current.length === 0) {
      current = token.length <= maxLineLength ? token : `${token.slice(0, maxLineLength - 1)}…`;
      continue;
    }
    const remaining = tokens.length - i;
    const isLastLine = lines.length === maxLines - 1;
    const suffix =
      isLastLine && tokens.length - i - 1 > 0
        ? t('result.moreSuffix', { count: tokens.length - i - 1 }, locale)
        : '';
    const candidate = `${current}${separator}${token}`;

    if (candidate.length + suffix.length <= maxLineLength) {
      current = candidate;
    } else if (isLastLine) {
      const overflow = `${current}${t('result.moreSuffix', { count: remaining }, locale)}`;
      lines.push(
        overflow.length <= maxLineLength ? overflow : `${current.slice(0, maxLineLength - 8)} (+${remaining})`,
      );
      return lines;
    } else {
      lines.push(current);
      current = token.length <= maxLineLength ? token : `${token.slice(0, maxLineLength - 1)}…`;
    }
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

function capBuildLines(
  rawLines: readonly string[],
  maxLineLength: number,
  locale: Locale,
): ResultSummaryLine[] {
  const capped: ResultSummaryLine[] = [];
  const evoPrefix = t('result.evolutionsPrefix', undefined, locale);
  const evoLines = rawLines.filter((line) => line.startsWith(evoPrefix));
  const otherLines = rawLines.filter((line) => !line.startsWith(evoPrefix));

  if (evoLines.length > 0) {
    // Keep Evolutions to 1 crisp line so total build lines never exceed 3 even with 7 Evolutions.
    const joinedEvos = evoLines
      .map((line, idx) => (idx === 0 ? line.slice(evoPrefix.length) : line))
      .join(', ')
      .split(', ')
      .filter((s) => s.length > 0);
    const packedEvo = packTokensToLines(
      joinedEvos.map((name, idx) => (idx === 0 ? `${evoPrefix}${name}` : name)),
      ', ',
      maxLineLength,
      1,
      locale,
    );
    if (packedEvo[0] !== undefined) {
      capped.push({ text: packedEvo[0], kind: 'evolution' });
    }
  }

  const maxSkillCount = Math.max(1, 3 - capped.length);
  for (let i = 0; i < Math.min(maxSkillCount, otherLines.length); i += 1) {
    const text = otherLines[i]!;
    capped.push({
      text: text.length <= maxLineLength ? text : `${text.slice(0, maxLineLength - 1)}…`,
      kind: 'skills',
    });
  }

  return capped;
}

/**
 * Format title, cause-of-death / clear subtitle, and compact non-overflowing summary lines
 * (`<= 7` lines, `<= 64` chars each) for `ResultScreen`.
 */
export function formatResultScreenSummary(
  result: ResultSummaryInput,
  locale: Locale = getLocale(),
): ResultSummaryOutput {
  const title = result.won
    ? t('result.titleWin', undefined, locale)
    : t('result.titleLoss', undefined, locale);

  let subtitle: string;
  if (result.won) {
    if (result.canContinueEndless === true) {
      subtitle = t('result.subtitleEndless', undefined, locale);
    } else {
      subtitle = t('result.subtitleWin', undefined, locale);
    }
  } else if (result.deathCause !== undefined && result.deathCause.kind !== 'victory') {
    subtitle = formatDeathCause(result.deathCause, locale);
  } else {
    subtitle = formatDeathCause({ kind: 'unknown' }, locale);
  }

  const lines: ResultSummaryLine[] = [];

  // Line 1: Hero + Chapter/Room depth + Ascension + Endless loop tag.
  const metaParts: string[] = [];
  if (result.characterId !== undefined && isCharacterId(result.characterId)) {
    metaParts.push(
      t('result.hero', { name: localizeCharacterName(result.characterId, locale) }, locale),
    );
  }
  const hasRichTags =
    result.characterId !== undefined ||
    (result.ascension !== undefined && result.ascension > 0) ||
    (result.endlessLoop !== undefined && result.endlessLoop > 0);
  metaParts.push(
    hasRichTags
      ? t(
          'result.chRoomCompact',
          { chapter: result.chapter, room: result.roomReached, total: result.roomsTotal },
          locale,
        )
      : t(
          'result.chRoomFull',
          { chapter: result.chapter, room: result.roomReached, total: result.roomsTotal },
          locale,
        ),
  );
  if (result.ascension !== undefined && result.ascension > 0) {
    metaParts.push(ascensionLabel(result.ascension, locale));
  }
  if (result.endlessLoop !== undefined && result.endlessLoop > 0) {
    metaParts.push(t('result.endlessLoop', { loop: Math.trunc(result.endlessLoop) }, locale));
  }
  lines.push({ text: metaParts.join(' · '), kind: 'meta' });

  // Line 2: Run Seed + Gold + Time + Kills.
  const statsParts: string[] = [];
  if (result.seed !== undefined && Number.isFinite(result.seed)) {
    statsParts.push(t('result.seed', { seed: Math.trunc(result.seed) >>> 0 }, locale));
    statsParts.push(
      t('result.goldCompact', { earned: result.goldEarned, total: result.goldTotal }, locale),
    );
    statsParts.push(`${formatDuration(result.durationMs)}`);
    statsParts.push(t('result.killsCompact', { kills: result.kills }, locale));
  } else {
    statsParts.push(
      t('result.goldFull', { earned: result.goldEarned, total: result.goldTotal }, locale),
    );
    statsParts.push(t('result.timeFull', { duration: formatDuration(result.durationMs) }, locale));
    statsParts.push(t('result.killsFull', { kills: result.kills }, locale));
  }
  lines.push({ text: statsParts.join(' · '), kind: 'stats' });

  // Lines 3..5: Build + Legendary Evolutions summary (when `ownedSkills` is supplied).
  if (result.ownedSkills !== undefined) {
    const rawBuild = formatBuildSummary(
      toOwnedSkillsMap(result.ownedSkills),
      {
        maxLineLength: RESULT_LINE_MAX_CHARS,
        maxSkillLines: 2,
      },
      locale,
    );
    lines.push(...capBuildLines(rawBuild, RESULT_LINE_MAX_CHARS, locale));
  }

  // Lines 6..7: Unlocks earned (merges `unlocks` with legacy `unlockedChapter`).
  const mergedUnlocks: RunUnlocksSummary = {
    ...(result.unlocks ?? {}),
    ...(result.unlocks?.unlockedChapter === undefined && result.unlockedChapter !== undefined
      ? { unlockedChapter: result.unlockedChapter }
      : {}),
  };
  const unlockTokens = formatRunUnlocks(mergedUnlocks, locale);
  if (unlockTokens.length > 0) {
    const packedUnlocks = packTokensToLines(
      unlockTokens,
      ' · ',
      RESULT_LINE_MAX_CHARS,
      2,
      locale,
    );
    for (const text of packedUnlocks) {
      lines.push({ text, kind: 'unlock' });
    }
  }

  return { title, subtitle, lines };
}

export interface ResultScreenLayoutInput {
  readonly visibleWidth?: number;
  readonly visibleHeight?: number;
  readonly lineCount: number;
  readonly hasContinueEndless: boolean;
}

export interface ResultScreenLayout {
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
  readonly lineFontSize: number;
  readonly lineSafeWidth: number;
  readonly lineYs: readonly number[];
  /** Optional `Continue Endless` primary button (`index 0` when present). */
  readonly continueEndlessButton: MenuButtonBox | null;
  /** Bottom 3-button action bar (`Meta shop`, `Chapter select`, `Title`). */
  readonly footerButtons: readonly [MenuButtonBox, MenuButtonBox, MenuButtonBox];
  readonly hintFontSize: number;
  readonly hintY: number;
}

/**
 * Pure 512×288 modal layout for the Rich Result / Death screen (M15):
 * wraps header + up to 7 rich summary lines + optional `Continue Endless` banner button +
 * 3-button footer bar inside `panelHeight <= 236` px with zero label clipping or overlap.
 */
export function computeResultScreenLayout(input: ResultScreenLayoutInput): ResultScreenLayout {
  const visibleWidth = input.visibleWidth ?? 512;
  const visibleHeight = input.visibleHeight ?? 288;
  const lineCount = Math.max(1, Math.min(7, Math.trunc(input.lineCount)));
  const hasContinueEndless = input.hasContinueEndless === true;

  const panelWidth = Math.min(476, Math.max(360, Math.round(visibleWidth - 36)));
  const dividerWidth = Math.max(120, panelWidth - PANEL_WELL_INSET_PX * 2 - 20);
  const innerWidth = panelWidth - 34;

  const titleOffset = 17;
  const subtitleOffset = 38;
  const dividerOffset = 48;
  const firstLineOffset = 59;
  const lineStep = 12.5;

  const lineOffsets: number[] = [];
  for (let i = 0; i < lineCount; i += 1) {
    lineOffsets.push(firstLineOffset + i * lineStep);
  }
  const lastLineOffset = lineOffsets[lineOffsets.length - 1] ?? firstLineOffset;
  const firstButtonTopOffset = lastLineOffset + 13;

  const footerGap = 8;
  const footerWidth = Math.floor((innerWidth - footerGap * 2) / 3);
  const footerSpan = footerWidth + footerGap;
  const continueHeight = 29;
  const footerHeight = hasContinueEndless ? 29 : 31;

  let continueCenterOffset: number | null = null;
  let footerCenterOffset: number;
  let buttonsBottomOffset: number;

  if (hasContinueEndless) {
    continueCenterOffset = firstButtonTopOffset + continueHeight / 2;
    const footerTopOffset = firstButtonTopOffset + continueHeight + 6;
    footerCenterOffset = footerTopOffset + footerHeight / 2;
    buttonsBottomOffset = footerTopOffset + footerHeight;
  } else {
    footerCenterOffset = firstButtonTopOffset + footerHeight / 2;
    buttonsBottomOffset = firstButtonTopOffset + footerHeight;
  }

  const hintOffset = buttonsBottomOffset + 12;
  const rawHeight = Math.ceil(hintOffset + 11);
  const panelHeight = Math.min(Math.round(visibleHeight - 8), Math.max(136, rawHeight));
  const panelTop = panelHeight / 2;

  const footerY = Math.round((panelTop - footerCenterOffset) * 2) / 2;
  const footerButtons: readonly [MenuButtonBox, MenuButtonBox, MenuButtonBox] = [
    { x: -footerSpan, y: footerY, width: footerWidth, height: footerHeight, fontSize: 10 },
    { x: 0, y: footerY, width: footerWidth, height: footerHeight, fontSize: 10 },
    { x: footerSpan, y: footerY, width: footerWidth, height: footerHeight, fontSize: 10 },
  ];

  return {
    panelX: 0,
    panelY: 0,
    panelWidth,
    panelHeight,
    titleFontSize: 18,
    titleY: Math.round(panelTop - titleOffset),
    subtitleFontSize: 9,
    subtitleY: Math.round(panelTop - subtitleOffset),
    dividerY: Math.round(panelTop - dividerOffset),
    dividerWidth,
    lineFontSize: 8,
    lineSafeWidth: dividerWidth,
    lineYs: lineOffsets.map((offset) => Math.round((panelTop - offset) * 2) / 2),
    continueEndlessButton:
      continueCenterOffset !== null
        ? {
            x: 0,
            y: Math.round((panelTop - continueCenterOffset) * 2) / 2,
            width: footerWidth * 3 + footerGap * 2,
            height: continueHeight,
            fontSize: 10,
          }
        : null,
    footerButtons,
    hintFontSize: 8,
    hintY: Math.round(panelTop - hintOffset),
  };
}

/**
 * 2D focus navigation for `ResultScreen`:
 * - Without `Continue Endless`: `0 = Meta shop`, `1 = Chapter select`, `2 = Title`.
 * - With `Continue Endless`: `0 = Continue Endless` (top), `1..3 = Meta shop / Chapter select / Title` (bottom).
 */
export function nextResultScreenFocus(
  current: number,
  direction: MenuGridDirection,
  hasContinueEndless: boolean,
): number {
  if (!hasContinueEndless) {
    const idx = Math.min(2, Math.max(0, Math.trunc(current)));
    const delta = direction === 'left' || direction === 'up' ? -1 : 1;
    return (idx + delta + 3) % 3;
  }

  const idx = Math.min(3, Math.max(0, Math.trunc(current)));
  if (direction === 'up' || direction === 'down') {
    return idx === 0 ? 1 : 0;
  }
  const delta = direction === 'left' ? -1 : 1;
  if (idx === 0) return delta < 0 ? 3 : 1;
  return ((idx - 1 + delta + 3) % 3) + 1;
}

// ---------------------------------------------------------------------------
// Title & Character Select Text Helpers (M14)
// ---------------------------------------------------------------------------

export function formatTitleCharacterLabel(
  character: CharacterDef,
  locale: Locale = getLocale(),
): string {
  return t('title.characterLabel', { name: localizeCharacterName(character.id, locale) }, locale);
}

export function formatTitleCharacterDetail(
  character: CharacterDef,
  availableCount: number,
  locale: Locale = getLocale(),
): string {
  const subtitle = localizeCharacterField(character.id, 'subtitle', locale);
  if (availableCount <= 1) {
    return t('title.characterDetailSingle', { subtitle }, locale);
  }
  return t('title.characterDetailCycle', { subtitle }, locale);
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
  locale: Locale = getLocale(),
): CharacterCardText {
  const activeId = resolveSelectedCharacter(save).id;
  const unlocked = isCharacterUnlocked(character.id, save);
  const name = localizeCharacterName(character.id, locale);
  const subtitle = localizeCharacterField(character.id, 'subtitle', locale);
  if (unlocked && character.id === activeId) {
    return {
      label: t(
        'charSelect.cardLabel',
        { name, status: t('charSelect.statusSelected', undefined, locale) },
        locale,
      ),
      detail: subtitle,
      status: 'selected',
    };
  }
  if (unlocked) {
    return {
      label: t(
        'charSelect.cardLabel',
        { name, status: t('charSelect.statusUnlocked', undefined, locale) },
        locale,
      ),
      detail: subtitle,
      status: 'unlocked',
    };
  }
  return {
    label: t(
      'charSelect.cardLabel',
      { name, status: t('charSelect.statusLocked', undefined, locale) },
      locale,
    ),
    detail: t(
      'charSelect.cardLockedDetail',
      { chapter: character.unlockChapter, cost: character.unlockGoldCost },
      locale,
    ),
    status: 'locked',
  };
}

/** Format all 3 class-identity layers + unlock status line for the recessed summary well. */
export function formatCharacterSummaryLines(
  character: CharacterDef,
  save: SaveData,
  locale: Locale = getLocale(),
): CharacterSummaryLines {
  const activeId = resolveSelectedCharacter(save).id;
  const unlocked = isCharacterUnlocked(character.id, save);
  const reason = characterUnlockReason(character.id, save, locale);
  const statusKind: CharacterSummaryLines['statusKind'] = !unlocked
    ? 'locked'
    : character.id === activeId
      ? 'selected'
      : 'unlocked';
  const status =
    statusKind === 'selected'
      ? t('charSelect.statusSelected', undefined, locale)
      : statusKind === 'unlocked'
        ? t('charSelect.statusUnlocked', undefined, locale)
        : t('charSelect.statusLocked', undefined, locale);

  const name = localizeCharacterName(character.id, locale).toUpperCase();
  return {
    statusLine: t('charSelect.summaryStatus', { name, status, reason }, locale),
    statusKind,
    weaponLine: t(
      'charSelect.summaryWeapon',
      { summary: localizeCharacterField(character.id, 'weapon', locale) },
      locale,
    ),
    passiveTitle: t(
      'charSelect.summaryPassive',
      { name: localizeCharacterField(character.id, 'passiveName', locale) },
      locale,
    ),
    passiveBody: localizeCharacterField(character.id, 'passiveSummary', locale),
    signatureTitle: t(
      'charSelect.summarySignature',
      { name: localizeCharacterField(character.id, 'signatureName', locale) },
      locale,
    ),
    signatureBody: localizeCharacterField(character.id, 'signatureSummary', locale),
  };
}

/** Format the dynamic Primary Select / Early Gold Unlock button below the summary well. */
export function formatCharacterPrimaryAction(
  character: CharacterDef,
  save: SaveData,
  locale: Locale = getLocale(),
): CharacterPrimaryActionSpec {
  const activeId = resolveSelectedCharacter(save).id;
  const unlocked = isCharacterUnlocked(character.id, save);
  const name = localizeCharacterName(character.id, locale);

  if (unlocked && character.id === activeId) {
    return {
      label: t('charSelect.primarySelected', { name }, locale),
      detail: t('charSelect.primarySelectedDetail', undefined, locale),
      disabled: false,
      kind: 'confirm',
    };
  }
  if (unlocked) {
    return {
      label: t('charSelect.primarySelect', { name }, locale),
      detail: t('charSelect.primarySelectDetail', undefined, locale),
      disabled: false,
      kind: 'select',
    };
  }

  const cost = character.unlockGoldCost;
  const affordable = canBuyCharacter(save, character.id);
  const short = Math.max(0, cost - save.gold);
  return {
    label: t('charSelect.primaryUnlock', { name, cost }, locale),
    detail: affordable
      ? t('charSelect.primaryUnlockDetail', undefined, locale)
      : t('charSelect.primaryUnlockShort', { short, chapter: character.unlockChapter }, locale),
    disabled: !affordable,
    kind: 'unlock',
  };
}

export function formatCharacterSelectSubtitle(
  gold: number,
  locale: Locale = getLocale(),
): string {
  return t('charSelect.subtitle', { gold }, locale);
}
