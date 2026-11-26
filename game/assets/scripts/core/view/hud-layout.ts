/**
 * Pure HUD layout and safe-band geometry (M11 T4).
 *
 * The UI Canvas runs at a 512×288 design resolution (`ResolutionPolicy.SHOW_ALL`, origin `(0, 0)`
 * at screen centre, +x right, +y up). `WorldCamera` scales the world to integer multiples of
 * 512×288 (`pixelPerfectRect`), and the HUD root node scales by `WorldCamera.hudScale`
 * (`worldToUiScale ≤ 1`) so every HUD plate hugs the actual visible room edges across 16:9,
 * 16:10, 4:3, and ultrawide viewports without drifting into letterbox bars or clipping.
 *
 * In addition to active M11 HUD plates (top-left Hearts + Gold, top-right Room + Enemies,
 * top-centre Boss HP bar / Door hint, bottom-right Skill strip, and the edge-arrow band), this
 * module explicitly reserves non-overlapping anchor bands for:
 * - **M12**: bottom-centre XP bar + level badge (`m12XpBar`);
 * - **M13**: bottom-left Dash + Signature Active cooldown indicators (`m13DashActive`).
 *
 * Pure arithmetic — no `cc` import.
 */
import type { Vec2 } from '../math/vec2';
import { letterboxRect, worldToUiScale } from './letterbox';

export const HUD_DESIGN_WIDTH = 512;
export const HUD_DESIGN_HEIGHT = 288;

/** Outer safe margin inside the 512×288 room frame, design px. */
export const HUD_EDGE_MARGIN_PX = 6;
/** Minimum gap required between any two simultaneously active or reserved HUD regions, design px. */
export const HUD_MIN_SEPARATION_PX = 4;

/** Backing plate inner padding and 9-slice border insets (`nine_path_panel_interior.png`, 16×16). */
export const HUD_PLATE_PAD_X_PX = 6;
export const HUD_PLATE_PAD_Y_PX = 5;
export const HUD_PLATE_SLICE_INSETS = {
  left: 4,
  right: 4,
  top: 4,
  bottom: 4,
} as const;

/** Typography metrics matching `NormalFont.ttf` and `collectUiText` (`ui-text.ts`). */
export const HUD_LABEL_FONT_SIZE = 11;
export const HUD_LABEL_LINE_HEIGHT = 13;
export const HUD_BOSS_TITLE_FONT_SIZE = 10;
export const HUD_BOSS_TITLE_LINE_HEIGHT = 12;
/** Slightly above `ui-text.ts`'s 0.62 glyph width estimate so labels always stay inside plates. */
const GLYPH_WIDTH_ESTIMATE = 0.65;

/** Heart row geometry (`Heart.png` 16×16 frames; wraps past 7 so high-Vitality runs never hit Boss bar). */
export const HUD_HEART_SIZE_PX = 16;
export const HUD_HEART_STEP_PX = 17;
export const HUD_HEART_ROW_STEP_PX = 17;
export const HUD_MAX_HEARTS_PER_ROW = 7;

/** Icons in the top-left and top-right HUD plates, all rendered at integer texel multiples. */
export const HUD_GOLD_ICON_SOURCE_PX = 7;
export const HUD_GOLD_ICON_SIZE_PX = 14; // 7×7 GoldCoin.png × 2
export const HUD_ROOM_ICON_SIZE_PX = 13; // 13×13 Arrow.png × 1
export const HUD_ENEMY_ICON_SIZE_PX = 16; // 16×16 skull cell × 1
export const HUD_TOP_RIGHT_ICON_COL_PX = 16;
export const HUD_ICON_TEXT_GAP_PX = 4;
const ROW_GAP_PX = 3;

/** Keep plate widths steady across normal digit changes (`Gold 0`..`Gold 9999`, `Enemies 0`..`99`). */
const GOLD_MIN_CHARS = 9;
const TOP_RIGHT_MIN_CHARS = 10;

/** Top-centre Boss bar & post-clear Door hint dimensions. */
export const HUD_BOSS_BAR_WIDTH_PX = 180;
export const HUD_BOSS_BAR_HEIGHT_PX = 8;
export const HUD_BOSS_PLATE_HEIGHT_PX = 30;
export const HUD_DOOR_HINT_WIDTH_PX = 120;
export const HUD_DOOR_HINT_HEIGHT_PX = 22;

/** Bottom-right owned skill strip (`SKILL_SLOTS = 8` of 24×24 icons + 1 px rarity frame). */
export const HUD_SKILL_SLOTS = 8;
export const HUD_SKILL_ICON_PX = 24;
export const HUD_SKILL_SLOT_STEP_PX = 28;
export const HUD_SKILL_STRIP_PAD_X_PX = 4;
export const HUD_SKILL_STRIP_HEIGHT_PX = 32;

/** M12 bottom-centre XP bar + level badge safe anchor reserve. */
export const HUD_M12_XP_BAR_WIDTH_PX = 200;
export const HUD_M12_XP_BAR_HEIGHT_PX = 14;

/** M13 bottom-left Dash + Signature Active cooldown safe anchor reserve. */
export const HUD_M13_DASH_ACTIVE_WIDTH_PX = 84;
export const HUD_M13_DASH_ACTIVE_HEIGHT_PX = 32;

/** Off-screen enemy / door arrow clamping insets inside the HUD design band. */
export const HUD_ARROW_SIDE_INSET_PX = 14;
export const HUD_ARROW_BOTTOM_INSET_PX = 28;
const ARROW_CLEARANCE_BELOW_TOP_PLATE_PX = 10;

/** Axis-aligned rectangle in HUD design px (origin at centre, +x right, +y up) or canvas px. */
export interface HudRect {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface HudTopLeftLayout {
  readonly plate: HudRect;
  readonly heartCount: number;
  readonly heartRows: number;
  readonly hearts: readonly Vec2[];
  readonly goldIcon: Vec2;
  /** Left-anchored (`anchor = (0, 0.5)`). */
  readonly goldLabel: Vec2;
  readonly goldText: string;
}

export interface HudTopRightLayout {
  readonly plate: HudRect;
  readonly hasEnemies: boolean;
  readonly roomIcon: Vec2;
  /** Right-anchored (`anchor = (1, 0.5)`). */
  readonly roomLabel: Vec2;
  readonly roomText: string;
  readonly enemyIcon: Vec2;
  /** Right-anchored (`anchor = (1, 0.5)`). */
  readonly enemiesLabel: Vec2;
  readonly enemiesText: string;
}

export interface HudBossBarLayout {
  readonly plate: HudRect;
  /** Local Y of the boss title label inside `bossRoot` (`bossRoot` sits at `plate.centerX/Y`). */
  readonly titleOffsetY: number;
  /** Local Y of the health bar inside `bossRoot`. */
  readonly barOffsetY: number;
  readonly barWidth: number;
  readonly barHeight: number;
}

export interface HudSkillStripLayout {
  /** Maximum 8-slot reservation on the bottom-right, used for non-overlap checks. */
  readonly maxPlate: HudRect;
  /** Compact active backdrop wrapping `shownCount` slots (`null` when 0 skills are owned). */
  readonly activePlate: HudRect | null;
  readonly shownCount: number;
  /** Centre of each of the `HUD_SKILL_SLOTS` slots in HUD design space. */
  readonly slotCenters: readonly Vec2[];
}

export interface HudArrowLimits {
  readonly halfWidth: number;
  readonly top: number;
  readonly bottom: number;
}

export interface HudLayoutInput {
  readonly designWidth?: number;
  readonly designHeight?: number;
  readonly maxHearts?: number;
  readonly gold?: number;
  readonly roomLabel?: string;
  /** `null` hides the enemies row (boss rooms, special rooms, menus). */
  readonly enemiesLeft?: number | null;
  readonly skillCount?: number;
}

export interface HudLayout {
  readonly screen: HudRect;
  readonly safeArea: HudRect;
  readonly topLeft: HudTopLeftLayout;
  readonly topRight: HudTopRightLayout;
  readonly bossBar: HudBossBarLayout;
  readonly doorHint: HudRect;
  readonly skillStrip: HudSkillStripLayout;
  /** Reserved for M12: bottom-centre XP bar + level badge. */
  readonly m12XpBar: HudRect;
  /** Reserved for M13: bottom-left Dash + Signature Active cooldown widgets. */
  readonly m13DashActive: HudRect;
  readonly arrowLimits: HudArrowLimits;
}

/** Construct a `HudRect` from `left`, `bottom`, `width`, `height`. */
export function makeHudRect(
  left: number,
  bottom: number,
  width: number,
  height: number,
): HudRect {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  return {
    left,
    right: left + safeWidth,
    bottom,
    top: bottom + safeHeight,
    width: safeWidth,
    height: safeHeight,
    centerX: left + safeWidth / 2,
    centerY: bottom + safeHeight / 2,
  };
}

/** Estimate rendered pixel width of a single-line pixel-font label. */
export function estimateHudLabelWidth(charCount: number, fontSize = HUD_LABEL_FONT_SIZE): number {
  return Math.ceil(Math.max(0, charCount) * fontSize * GLYPH_WIDTH_ESTIMATE);
}

export function formatHudGoldText(gold: number): string {
  const safe = Number.isFinite(gold) ? Math.max(0, Math.floor(gold)) : 0;
  return `Gold ${safe}`;
}

export function formatHudRoomText(roomLabel: string): string {
  const trimmed = roomLabel.trim();
  if (trimmed === '') return 'Room 1/9';
  return trimmed.startsWith('Room ') ? trimmed : `Room ${trimmed}`;
}

export function formatHudEnemiesText(enemiesLeft: number): string {
  const safe = Number.isFinite(enemiesLeft) ? Math.max(0, Math.floor(enemiesLeft)) : 0;
  return `Enemies ${safe}`;
}

/** Compute the complete HUD layout and M12/M13 reserved anchor bands in design coordinates. */
export function computeHudLayout(input: HudLayoutInput = {}): HudLayout {
  const designWidth = input.designWidth ?? HUD_DESIGN_WIDTH;
  const designHeight = input.designHeight ?? HUD_DESIGN_HEIGHT;
  const halfW = designWidth / 2;
  const halfH = designHeight / 2;

  const screen = makeHudRect(-halfW, -halfH, designWidth, designHeight);
  const safeArea = makeHudRect(
    -halfW + HUD_EDGE_MARGIN_PX,
    -halfH + HUD_EDGE_MARGIN_PX,
    designWidth - HUD_EDGE_MARGIN_PX * 2,
    designHeight - HUD_EDGE_MARGIN_PX * 2,
  );

  const topLeft = computeTopLeftLayout(
    safeArea.left,
    safeArea.top,
    input.maxHearts ?? 6,
    input.gold ?? 0,
  );

  const topRight = computeTopRightLayout(
    safeArea.right,
    safeArea.top,
    input.roomLabel ?? '1/9',
    input.enemiesLeft === undefined ? 0 : input.enemiesLeft,
  );

  const bossPlateWidth = HUD_BOSS_BAR_WIDTH_PX + HUD_PLATE_PAD_X_PX * 2;
  const bossPlate = makeHudRect(
    -bossPlateWidth / 2,
    safeArea.top - HUD_BOSS_PLATE_HEIGHT_PX,
    bossPlateWidth,
    HUD_BOSS_PLATE_HEIGHT_PX,
  );
  const bossBar: HudBossBarLayout = {
    plate: bossPlate,
    titleOffsetY: 5,
    barOffsetY: -6,
    barWidth: HUD_BOSS_BAR_WIDTH_PX,
    barHeight: HUD_BOSS_BAR_HEIGHT_PX,
  };

  const doorHint = makeHudRect(
    -HUD_DOOR_HINT_WIDTH_PX / 2,
    safeArea.top - HUD_DOOR_HINT_HEIGHT_PX,
    HUD_DOOR_HINT_WIDTH_PX,
    HUD_DOOR_HINT_HEIGHT_PX,
  );

  const m13DashActive = makeHudRect(
    safeArea.left,
    safeArea.bottom,
    HUD_M13_DASH_ACTIVE_WIDTH_PX,
    HUD_M13_DASH_ACTIVE_HEIGHT_PX,
  );

  const m12XpBar = makeHudRect(
    -HUD_M12_XP_BAR_WIDTH_PX / 2,
    safeArea.bottom,
    HUD_M12_XP_BAR_WIDTH_PX,
    HUD_M12_XP_BAR_HEIGHT_PX,
  );

  const skillStrip = computeSkillStripLayout(
    safeArea.right,
    m12XpBar.top + HUD_MIN_SEPARATION_PX,
    input.skillCount ?? 0,
  );

  const topPlateHeight = Math.max(topLeft.plate.height, topRight.plate.height);
  const arrowTopInset = HUD_EDGE_MARGIN_PX + topPlateHeight + ARROW_CLEARANCE_BELOW_TOP_PLATE_PX;
  const arrowLimits: HudArrowLimits = {
    halfWidth: Math.max(0, halfW - HUD_ARROW_SIDE_INSET_PX),
    top: Math.max(0, halfH - arrowTopInset),
    bottom: Math.max(0, halfH - HUD_ARROW_BOTTOM_INSET_PX),
  };

  return {
    screen,
    safeArea,
    topLeft,
    topRight,
    bossBar,
    doorHint,
    skillStrip,
    m12XpBar,
    m13DashActive,
    arrowLimits,
  };
}

function computeTopLeftLayout(
  left: number,
  top: number,
  rawMaxHearts: number,
  rawGold: number,
): HudTopLeftLayout {
  const heartCount = Math.max(0, Math.floor(rawMaxHearts));
  const effectiveHearts = Math.max(1, heartCount);
  const cols = Math.min(HUD_MAX_HEARTS_PER_ROW, effectiveHearts);
  const heartRows = Math.ceil(effectiveHearts / HUD_MAX_HEARTS_PER_ROW);

  const heartsWidth = cols * HUD_HEART_STEP_PX - (HUD_HEART_STEP_PX - HUD_HEART_SIZE_PX);
  const heartsHeight =
    heartRows * HUD_HEART_ROW_STEP_PX - (HUD_HEART_ROW_STEP_PX - HUD_HEART_SIZE_PX);

  const goldText = formatHudGoldText(rawGold);
  const goldChars = Math.max(GOLD_MIN_CHARS, goldText.length);
  const goldRowWidth =
    HUD_GOLD_ICON_SIZE_PX + HUD_ICON_TEXT_GAP_PX + estimateHudLabelWidth(goldChars);
  const goldRowHeight = Math.max(HUD_GOLD_ICON_SIZE_PX, HUD_LABEL_LINE_HEIGHT);

  const contentWidth = Math.max(heartsWidth, goldRowWidth);
  const contentHeight = heartsHeight + ROW_GAP_PX + goldRowHeight;
  const plateWidth = contentWidth + HUD_PLATE_PAD_X_PX * 2;
  const plateHeight = contentHeight + HUD_PLATE_PAD_Y_PX * 2;
  const plate = makeHudRect(left, top - plateHeight, plateWidth, plateHeight);

  const contentLeft = left + HUD_PLATE_PAD_X_PX;
  const contentTop = top - HUD_PLATE_PAD_Y_PX;

  const hearts: Vec2[] = [];
  for (let index = 0; index < heartCount; index += 1) {
    const col = index % HUD_MAX_HEARTS_PER_ROW;
    const row = Math.floor(index / HUD_MAX_HEARTS_PER_ROW);
    hearts.push({
      x: contentLeft + col * HUD_HEART_STEP_PX + HUD_HEART_SIZE_PX / 2,
      y: contentTop - row * HUD_HEART_ROW_STEP_PX - HUD_HEART_SIZE_PX / 2,
    });
  }

  const goldCenterY = contentTop - heartsHeight - ROW_GAP_PX - goldRowHeight / 2;
  const goldIcon: Vec2 = {
    x: contentLeft + HUD_GOLD_ICON_SIZE_PX / 2,
    y: goldCenterY,
  };
  const goldLabel: Vec2 = {
    x: contentLeft + HUD_GOLD_ICON_SIZE_PX + HUD_ICON_TEXT_GAP_PX,
    y: goldCenterY,
  };

  return {
    plate,
    heartCount,
    heartRows,
    hearts,
    goldIcon,
    goldLabel,
    goldText,
  };
}

function computeTopRightLayout(
  right: number,
  top: number,
  rawRoomLabel: string,
  enemiesLeft: number | null,
): HudTopRightLayout {
  const roomText = formatHudRoomText(rawRoomLabel);
  const hasEnemies = enemiesLeft !== null;
  const enemiesText = hasEnemies ? formatHudEnemiesText(enemiesLeft) : '';

  const chars = Math.max(TOP_RIGHT_MIN_CHARS, roomText.length, enemiesText.length);
  const textWidth = estimateHudLabelWidth(chars);
  const contentWidth = HUD_TOP_RIGHT_ICON_COL_PX + HUD_ICON_TEXT_GAP_PX + textWidth;

  const roomRowHeight = Math.max(HUD_ROOM_ICON_SIZE_PX, HUD_LABEL_LINE_HEIGHT);
  const enemyRowHeight = Math.max(HUD_ENEMY_ICON_SIZE_PX, HUD_LABEL_LINE_HEIGHT);
  const contentHeight = hasEnemies ? roomRowHeight + ROW_GAP_PX + enemyRowHeight : roomRowHeight;

  const plateWidth = contentWidth + HUD_PLATE_PAD_X_PX * 2;
  const plateHeight = contentHeight + HUD_PLATE_PAD_Y_PX * 2;
  const left = right - plateWidth;
  const plate = makeHudRect(left, top - plateHeight, plateWidth, plateHeight);

  const iconCenterX = left + HUD_PLATE_PAD_X_PX + HUD_TOP_RIGHT_ICON_COL_PX / 2;
  const labelRightX = right - HUD_PLATE_PAD_X_PX;
  const contentTop = top - HUD_PLATE_PAD_Y_PX;

  const roomCenterY = contentTop - roomRowHeight / 2;
  const enemyCenterY = contentTop - roomRowHeight - ROW_GAP_PX - enemyRowHeight / 2;

  return {
    plate,
    hasEnemies,
    roomIcon: { x: iconCenterX, y: roomCenterY },
    roomLabel: { x: labelRightX, y: roomCenterY },
    roomText,
    enemyIcon: { x: iconCenterX, y: enemyCenterY },
    enemiesLabel: { x: labelRightX, y: enemyCenterY },
    enemiesText,
  };
}

function computeSkillStripLayout(
  right: number,
  bottom: number,
  rawSkillCount: number,
): HudSkillStripLayout {
  const slotVisualWidth = HUD_SKILL_ICON_PX + 2;
  const stepGap = HUD_SKILL_SLOT_STEP_PX - slotVisualWidth;
  const maxContentWidth = HUD_SKILL_SLOTS * HUD_SKILL_SLOT_STEP_PX - stepGap;
  const maxWidth = maxContentWidth + HUD_SKILL_STRIP_PAD_X_PX * 2;
  const maxPlate = makeHudRect(right - maxWidth, bottom, maxWidth, HUD_SKILL_STRIP_HEIGHT_PX);

  const shownCount = Math.min(HUD_SKILL_SLOTS, Math.max(0, Math.floor(rawSkillCount)));
  const activeCount = shownCount > 0 ? shownCount : HUD_SKILL_SLOTS;
  const activeContentWidth = activeCount * HUD_SKILL_SLOT_STEP_PX - stepGap;
  const activeWidth = activeContentWidth + HUD_SKILL_STRIP_PAD_X_PX * 2;
  const activeLeft = right - activeWidth;

  const activePlate =
    shownCount > 0
      ? makeHudRect(activeLeft, bottom, activeWidth, HUD_SKILL_STRIP_HEIGHT_PX)
      : null;

  const slotCenters: Vec2[] = [];
  for (let index = 0; index < HUD_SKILL_SLOTS; index += 1) {
    slotCenters.push({
      x: activeLeft + HUD_SKILL_STRIP_PAD_X_PX + slotVisualWidth / 2 + index * HUD_SKILL_SLOT_STEP_PX,
      y: maxPlate.centerY,
    });
  }

  return {
    maxPlate,
    activePlate,
    shownCount,
    slotCenters,
  };
}

/** Scale a HUD local rect by `hudScale` into the UI Canvas's `SHOW_ALL` coordinate space. */
export function scaleHudRectToUi(rect: HudRect, hudScale: number): HudRect {
  const s = Number.isFinite(hudScale) && hudScale > 0 ? hudScale : 1;
  return makeHudRect(rect.left * s, rect.bottom * s, rect.width * s, rect.height * s);
}

/**
 * Project a HUD design rect onto actual canvas pixels (`0..canvasWidth`, `0..canvasHeight`,
 * bottom-left origin) using the exact `letterboxRect` + `worldToUiScale` chain the runtime uses.
 */
export function hudRectOnCanvas(
  rect: HudRect,
  canvasWidth: number,
  canvasHeight: number,
  designWidth = HUD_DESIGN_WIDTH,
  designHeight = HUD_DESIGN_HEIGHT,
): HudRect {
  const hudScale = worldToUiScale(canvasWidth, canvasHeight, designWidth, designHeight);
  const scaled = scaleHudRectToUi(rect, hudScale);
  const uiBand = letterboxRect(canvasWidth, canvasHeight, designWidth, designHeight);

  const bandLeftPx = uiBand.x * canvasWidth;
  const bandBottomPx = uiBand.y * canvasHeight;
  const pxPerDesignX = (uiBand.width * canvasWidth) / designWidth;
  const pxPerDesignY = (uiBand.height * canvasHeight) / designHeight;

  return makeHudRect(
    bandLeftPx + (scaled.left + designWidth / 2) * pxPerDesignX,
    bandBottomPx + (scaled.bottom + designHeight / 2) * pxPerDesignY,
    scaled.width * pxPerDesignX,
    scaled.height * pxPerDesignY,
  );
}

/** True when `a` and `b` overlap (or come closer than `minGapPx` when `minGapPx > 0`). */
export function hudRectsOverlap(a: HudRect, b: HudRect, minGapPx = 0): boolean {
  const gap = Math.max(0, minGapPx);
  return (
    a.left < b.right + gap &&
    a.right + gap > b.left &&
    a.bottom < b.top + gap &&
    a.top + gap > b.bottom
  );
}

/** True when `inner` fits completely within `outer` (up to floating-point epsilon). */
export function hudRectInside(inner: HudRect, outer: HudRect, epsilon = 1e-6): boolean {
  return (
    inner.left >= outer.left - epsilon &&
    inner.right <= outer.right + epsilon &&
    inner.bottom >= outer.bottom - epsilon &&
    inner.top <= outer.top + epsilon
  );
}

/** Snapshot of combat-driven HUD fields for event-driven diffing (`hud-sync.ts`). */
export interface CombatHudSnapshot {
  readonly maxHearts: number;
  readonly hearts: number;
  readonly enemiesLeft: number | null;
  readonly bossName: string | null;
  readonly bossHp: number;
  readonly bossMaxHp: number;
  readonly bossPhase: number;
}

export interface CombatHudDiff {
  readonly maxHeartsChanged: boolean;
  readonly heartsChanged: boolean;
  readonly enemiesLeftChanged: boolean;
  readonly bossChanged: boolean;
}

/** Pure diff between two `CombatHudSnapshot`s so `hud-sync` only mutates HUD nodes on transitions. */
export function diffCombatHudSnapshot(
  prev: CombatHudSnapshot | null,
  next: CombatHudSnapshot,
): CombatHudDiff {
  if (prev === null) {
    return {
      maxHeartsChanged: true,
      heartsChanged: true,
      enemiesLeftChanged: true,
      bossChanged: true,
    };
  }
  return {
    maxHeartsChanged: prev.maxHearts !== next.maxHearts,
    heartsChanged: prev.hearts !== next.hearts || prev.maxHearts !== next.maxHearts,
    enemiesLeftChanged: prev.enemiesLeft !== next.enemiesLeft,
    bossChanged:
      prev.bossName !== next.bossName ||
      prev.bossHp !== next.bossHp ||
      prev.bossMaxHp !== next.bossMaxHp ||
      prev.bossPhase !== next.bossPhase,
  };
}
