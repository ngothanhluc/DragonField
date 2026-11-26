/**
 * Pure HUD layout and safe-band geometry (M11 T4 + M12 T2 + M13 T1 + M17).
 *
 * The UI Canvas runs at a 512×288 design resolution (`ResolutionPolicy.SHOW_ALL`, origin `(0, 0)`
 * at screen centre, +x right, +y up). `WorldCamera` scales the world to integer multiples of
 * 512×288 (`pixelPerfectRect`), and the HUD root node scales by `WorldCamera.hudScale`
 * (`worldToUiScale ≤ 1`) so every HUD plate hugs the actual visible room edges across 16:9,
 * 16:10, 4:3, and ultrawide viewports without drifting into letterbox bars or clipping.
 *
 * Active HUD plates and reserved safe bands (M17 unified top-left layout):
 * - Top-left: Reserved 28×28 portrait frame + 100-scale HP bar (with delayed damage-drain trail)
 *   + XP bar & `LV X` badge directly underneath + Gold counter (`topLeft`, enclosing `xpBar`);
 * - Top-right: Room + Enemies (`topRight`);
 * - Top-centre: Boss HP bar (`bossBar`) / Door hint (`doorHint`);
 * - Bottom-right: Wrapped 10×2 owned skill grid holding up to 20 distinct skills (`skillStrip`),
 *   anchored at the bottom edge now that bottom-centre is freed;
 * - Bottom-left: Event-driven Dash (`SPACE`) + Signature Active (`E`) cooldown widgets (`dashActive`);
 * - Clamped off-screen enemy / portal edge-arrow band (`arrowLimits`).
 *
 * Pure arithmetic — no `cc` import.
 */
import { getLocale, t, type Locale } from '../i18n';
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

/** M17 unified top-left plate: reserved 28×28 portrait slot + HP bar + XP bar + Gold counter. */
export const HUD_TOP_LEFT_PAD_X_PX = 5;
export const HUD_TOP_LEFT_PAD_Y_PX = 4;
export const HUD_PORTRAIT_SIZE_PX = 28;
export const HUD_PORTRAIT_GAP_PX = 5;
export const HUD_HP_BAR_WIDTH_PX = 103;
export const HUD_HP_BAR_HEIGHT_PX = 13;
export const HUD_HP_BAR_INSET_PX = 1;
export const HUD_HP_FONT_SIZE = 9;
export const HUD_HP_LINE_HEIGHT = 10;
export const HUD_HP_XP_GAP_PX = 3;
/** Delayed white damage-drain trail duration on HP loss (ms, ease-out). */
export const HUD_HP_TRAIL_DURATION_MS = 350;
/** Gold highlight flash duration on XP level-up (ms). */
export const HUD_XP_LEVEL_UP_FLASH_MS = 350;

/** Legacy heart-size exports retained only for asset/reference compatibility. */
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

/**
 * Bottom-right owned skill grid (M12: up to 20 distinct skills = 10 columns × 2 rows of 24×24 icons
 * + 1 px rarity frame, expanding from 1 compact row for 1..10 skills to 2 rows for 11..20 skills).
 */
export const HUD_SKILL_MAX_COLS = 10;
export const HUD_SKILL_MAX_ROWS = 2;
export const HUD_SKILL_SLOTS = HUD_SKILL_MAX_COLS * HUD_SKILL_MAX_ROWS;
export const HUD_SKILL_ICON_PX = 24;
export const HUD_SKILL_SLOT_STEP_PX = 28;
export const HUD_SKILL_ROW_STEP_PX = 28;
export const HUD_SKILL_STRIP_PAD_X_PX = 4;
export const HUD_SKILL_STRIP_PAD_Y_PX = 3;
export const HUD_SKILL_STRIP_HEIGHT_PX = 32;
export const HUD_SKILL_STRIP_MAX_HEIGHT_PX = 60;

/** M17 top-left XP bar + `LV X` / `Cấp X` badge directly underneath the HP bar. */
export const HUD_M12_XP_BAR_WIDTH_PX = HUD_HP_BAR_WIDTH_PX;
export const HUD_M12_XP_BAR_HEIGHT_PX = 12;
export const HUD_XP_PLATE_PAD_X_PX = 0;
export const HUD_XP_BADGE_WIDTH_PX = 36;
export const HUD_XP_BADGE_HEIGHT_PX = 12;
export const HUD_XP_BADGE_GAP_PX = 3;
export const HUD_XP_BAR_WIDTH_PX =
  HUD_HP_BAR_WIDTH_PX - HUD_XP_BADGE_WIDTH_PX - HUD_XP_BADGE_GAP_PX; // 64 px
export const HUD_XP_BAR_HEIGHT_PX = 10;
export const HUD_XP_BAR_INSET_PX = 1;
export const HUD_XP_LEVEL_FONT_SIZE = 8;
export const HUD_XP_LEVEL_LINE_HEIGHT = 9;
export const HUD_XP_PROGRESS_FONT_SIZE = 8;
export const HUD_XP_PROGRESS_LINE_HEIGHT = 9;

/**
 * M13 bottom-left Dash (`SPACE`) + Signature Active (`E`) cooldown plate and internal geometry.
 * M17 polish: +2 px vertical padding on each action bar so Vietnamese diacritics (`SẴN`) never
 * touch the top edge of the bar frame.
 */
export const HUD_M13_DASH_ACTIVE_WIDTH_PX = 112;
export const HUD_M13_DASH_ACTIVE_HEIGHT_PX = 36;
export const HUD_ACTION_PLATE_PAD_X_PX = 5;
export const HUD_ACTION_PLATE_PAD_Y_PX = 4;
export const HUD_ACTION_ROW_HEIGHT_PX = 13;
export const HUD_ACTION_ROW_GAP_PX = 2;
export const HUD_ACTION_KEY_WIDTH_PX = 36;
export const HUD_ACTION_KEY_HEIGHT_PX = 13;
export const HUD_ACTION_KEY_GAP_PX = 4;
export const HUD_ACTION_BAR_WIDTH_PX = 62;
export const HUD_ACTION_BAR_HEIGHT_PX = 12;
export const HUD_ACTION_BAR_INSET_PX = 1;
export const HUD_ACTION_KEY_FONT_SIZE = 8;
export const HUD_ACTION_KEY_LINE_HEIGHT = 9;
export const HUD_ACTION_STATUS_FONT_SIZE = 8;
export const HUD_ACTION_STATUS_LINE_HEIGHT = 9;
export const HUD_DASH_KEY_TEXT = 'SPACE';
export const HUD_ACTIVE_KEY_TEXT = 'E';

/** Off-screen enemy / portal arrow clamping insets inside the HUD design band. */
export const HUD_ARROW_SIDE_INSET_PX = 14;
export const HUD_ARROW_BOTTOM_INSET_PX = 20;
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

export type HudHpColorTier = 'high' | 'mid' | 'low';

export interface HudHpTrailState {
  readonly current: number;
  readonly start: number;
  readonly target: number;
  readonly elapsedMs: number;
  readonly active: boolean;
}

export interface HudHpBarLayout {
  readonly barTrack: HudRect;
  readonly barFillMax: HudRect;
  /** Centered (`anchor = (0.5, 0.5)`) inside `barTrack`. */
  readonly hpLabel: Vec2;
  readonly hpText: string;
  readonly fillRatio: number;
  readonly tier: HudHpColorTier;
}

export interface HudTopLeftLayout {
  readonly plate: HudRect;
  /** Reserved `28×28` square portrait frame on the immediate left edge (ready for M19 avatar). */
  readonly portraitSlot: HudRect;
  /** 100-scale pixel HP bar with numeric readout (`85/100`). */
  readonly hpBar: HudHpBarLayout;
  /** Unified XP bar + `LV X` / `Cấp X` badge directly underneath `hpBar`. */
  readonly xpBar: HudXpBarLayout;
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

export interface HudXpBarLayout {
  readonly plate: HudRect;
  readonly badge: HudRect;
  readonly barTrack: HudRect;
  readonly barFillMax: HudRect;
  /** Centered (`anchor = (0.5, 0.5)`) inside `badge`. */
  readonly levelLabel: Vec2;
  /** Centered (`anchor = (0.5, 0.5)`) inside `barTrack`. */
  readonly progressLabel: Vec2;
  readonly levelText: string;
  readonly progressText: string;
  readonly fillRatio: number;
}

export interface HudActionSlotLayout {
  readonly row: HudRect;
  readonly keyBadge: HudRect;
  readonly barTrack: HudRect;
  readonly barFillMax: HudRect;
  /** Centered (`anchor = (0.5, 0.5)`) inside `keyBadge`. */
  readonly keyLabel: Vec2;
  /** Centered (`anchor = (0.5, 0.5)`) inside `barTrack`. */
  readonly statusLabel: Vec2;
  readonly keyText: string;
  readonly statusText: string;
  readonly readyRatio: number;
  readonly isReady: boolean;
}

export interface HudDashActiveLayout {
  readonly plate: HudRect;
  readonly dash: HudActionSlotLayout;
  readonly active: HudActionSlotLayout;
}

export interface HudSkillStripLayout {
  /** Maximum 20-slot (10×2) reservation on the bottom-right, used for non-overlap checks. */
  readonly maxPlate: HudRect;
  /** Compact active backdrop wrapping `shownCount` slots (`null` when 0 skills are owned). */
  readonly activePlate: HudRect | null;
  readonly shownCount: number;
  readonly rowCount: number;
  readonly colCount: number;
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
  /** Current player HP (defaults to `maxHp`). */
  readonly hp?: number;
  /** Max player HP (100-HP scale; also falls back to legacy `maxHearts`). */
  readonly maxHp?: number;
  /** Legacy alias for `maxHp` (kept for call-site compatibility). */
  readonly maxHearts?: number;
  readonly gold?: number;
  readonly roomLabel?: string;
  /** `null` hides the enemies row (boss rooms, special rooms, menus). */
  readonly enemiesLeft?: number | null;
  readonly skillCount?: number;
  readonly xpLevel?: number;
  readonly xpCurrent?: number;
  readonly xpRequired?: number;
  readonly dashReadyRatio?: number;
  readonly dashCooldownSec?: number;
  readonly activeReadyRatio?: number;
  readonly activeCooldownSec?: number;
}

export interface HudLayout {
  readonly screen: HudRect;
  readonly safeArea: HudRect;
  readonly topLeft: HudTopLeftLayout;
  readonly topRight: HudTopRightLayout;
  readonly bossBar: HudBossBarLayout;
  readonly doorHint: HudRect;
  readonly skillStrip: HudSkillStripLayout;
  /** Top-left XP bar + level badge detailed geometry (`topLeft.xpBar`, `xpBar.plate === m12XpBar`). */
  readonly xpBar: HudXpBarLayout;
  /** Top-left XP bar row bounding rect (`xpBar.plate`, inside `topLeft.plate`). */
  readonly m12XpBar: HudRect;
  /** M13 bottom-left Dash + Signature Active detailed geometry (`dashActive.plate === m13DashActive`). */
  readonly dashActive: HudDashActiveLayout;
  /** Bottom-left Dash + Signature Active cooldown bounding plate (`dashActive.plate`). */
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

export function formatHudGoldText(gold: number, locale: Locale = getLocale()): string {
  const safe = Number.isFinite(gold) ? Math.max(0, Math.floor(gold)) : 0;
  return t('hud.gold', { gold: safe }, locale);
}

export function formatHudRoomText(roomLabel: string, locale: Locale = getLocale()): string {
  const trimmed = roomLabel.trim();
  const value = trimmed === '' ? '1/9' : trimmed;
  if (value.startsWith('Room ') || value.startsWith('Phòng ')) return value;
  return t('hud.room', { room: value }, locale);
}

export function formatHudEnemiesText(enemiesLeft: number, locale: Locale = getLocale()): string {
  const safe = Number.isFinite(enemiesLeft) ? Math.max(0, Math.floor(enemiesLeft)) : 0;
  return t('hud.enemies', { count: safe }, locale);
}

/** Normalize a player HP value (`current` or `max`) to a non-negative integer. */
export function normalizeHudHpValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** Clamp player HP bar fill ratio to `[0, 1]`. */
export function computeHudHpFillRatio(hp: number, maxHp: number): number {
  if (!Number.isFinite(maxHp) || maxHp <= 0) return 0;
  if (!Number.isFinite(hp) || hp <= 0) return 0;
  return Math.min(1, Math.max(0, hp / maxHp));
}

/** Format numeric HP readout (`85/100`). */
export function formatHudHpText(hp: number, maxHp: number): string {
  const safeMax = Math.max(1, normalizeHudHpValue(maxHp));
  const safeHp = Math.min(safeMax, normalizeHudHpValue(hp));
  return `${safeHp}/${safeMax}`;
}

/** Colour tier for the pixel HP bar fill (`high` emerald → `mid` amber → `low` crimson). */
export function hudHpColorTier(ratio: number): HudHpColorTier {
  if (!Number.isFinite(ratio) || ratio <= 0.25) return 'low';
  if (ratio <= 0.5) return 'mid';
  return 'high';
}

/** Create an idle damage-drain trail resting at `initialRatio`. */
export function createHudHpTrail(initialRatio = 1): HudHpTrailState {
  const clamped = Number.isFinite(initialRatio) ? Math.min(1, Math.max(0, initialRatio)) : 1;
  return {
    current: clamped,
    start: clamped,
    target: clamped,
    elapsedMs: 0,
    active: false,
  };
}

/**
 * Update the delayed white damage-drain trail on an HP change event:
 * - On damage (`nextTarget < state.current`): begins a smooth ease-out drain from `state.current`.
 * - On heal (`nextTarget >= state.current`): snaps immediately so healing feels crisp.
 */
export function triggerHudHpTrail(
  state: HudHpTrailState,
  nextTargetRatio: number,
): HudHpTrailState {
  const target = Number.isFinite(nextTargetRatio) ? Math.min(1, Math.max(0, nextTargetRatio)) : 0;
  if (target >= state.current - 1e-6) {
    return {
      current: target,
      start: target,
      target,
      elapsedMs: 0,
      active: false,
    };
  }
  return {
    current: state.current,
    start: state.current,
    target,
    elapsedMs: 0,
    active: true,
  };
}

/** Step the delayed damage-drain trail with cubic ease-out (`~350 ms` default). */
export function advanceHudHpTrail(
  state: HudHpTrailState,
  dtMs: number,
  durationMs = HUD_HP_TRAIL_DURATION_MS,
): HudHpTrailState {
  if (!state.active) return state;
  const safeDt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  if (safeDt === 0) return state;
  const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1;
  const elapsedMs = Math.min(safeDuration, state.elapsedMs + safeDt);
  const u = elapsedMs / safeDuration;
  const eased = 1 - Math.pow(1 - u, 3);
  if (u >= 1) {
    return {
      current: state.target,
      start: state.target,
      target: state.target,
      elapsedMs: safeDuration,
      active: false,
    };
  }
  return {
    current: state.start + (state.target - state.start) * eased,
    start: state.start,
    target: state.target,
    elapsedMs,
    active: true,
  };
}

/** Normalize a player XP level to an integer `>= 1`. */
export function normalizeHudXpLevel(level: number): number {
  return Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
}

/** Normalize an XP counter (`current` or `required`) to an integer `>= 0`. */
export function normalizeHudXpValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Clamp XP bar progress ratio to `[0, 1]`. Returns `0` when `requiredXp <= 0` or inputs are
 * non-finite so max-level / uninitialized states never divide by zero or produce `NaN`.
 */
export function computeHudXpFillRatio(currentXp: number, requiredXp: number): number {
  if (!Number.isFinite(requiredXp) || requiredXp <= 0) return 0;
  if (!Number.isFinite(currentXp) || currentXp <= 0) return 0;
  return Math.min(1, Math.max(0, currentXp / requiredXp));
}

/** Format the level badge text (`Cấp 1` / `LV 1`, …). */
export function formatHudLevelText(level: number, locale: Locale = getLocale()): string {
  return t('hud.level', { level: normalizeHudXpLevel(level) }, locale);
}

/**
 * Format compact XP progress readout (`14/35`). Returns `''` when `requiredXp <= 0` so pre-XP or
 * capped states show a clean track without a meaningless `0/0`.
 */
export function formatHudXpProgressText(currentXp: number, requiredXp: number): string {
  if (!Number.isFinite(requiredXp) || requiredXp <= 0) return '';
  const safeCurrent = normalizeHudXpValue(currentXp);
  const safeRequired = Math.max(1, Math.floor(requiredXp));
  return `${safeCurrent}/${safeRequired}`;
}

/** Clamp a Dash or Signature Active readiness ratio cleanly to `[0, 1]` (`0` on non-finite). */
export function computeHudActionReadyRatio(readyRatio: number): number {
  if (!Number.isFinite(readyRatio) || readyRatio <= 0) return 0;
  return Math.min(1, Math.max(0, readyRatio));
}

/** Normalize a remaining cooldown in seconds (`0` when ready or non-finite). */
export function normalizeHudCooldownSeconds(cooldownSec: number): number {
  if (!Number.isFinite(cooldownSec) || cooldownSec <= 0) return 0;
  return cooldownSec;
}

/** True when the action is fully ready (`readyRatio >= 1` and `cooldownSec <= 0`). */
export function isHudActionReady(readyRatio: number, cooldownSec: number): boolean {
  return (
    computeHudActionReadyRatio(readyRatio) >= 1 && normalizeHudCooldownSeconds(cooldownSec) <= 0
  );
}

/**
 * Format compact status text inside a Dash or Signature Active cooldown track:
 * `'SẴN'` / `'READY'` when ready, tenths-of-a-second countdown (`'1.8s'`, `'9.4s'`) while cooling down,
 * or integer percentage (`'50%'`) if a partial ratio is provided with `cooldownSec <= 0`.
 */
export function formatHudActionStatusText(
  readyRatio: number,
  cooldownSec: number,
  locale: Locale = getLocale(),
): string {
  const safeSec = normalizeHudCooldownSeconds(cooldownSec);
  if (safeSec > 0) {
    if (safeSec >= 100) {
      return `${Math.min(999, Math.ceil(safeSec))}s`;
    }
    const tenths = Math.max(1, Math.ceil(safeSec * 10 - 1e-9));
    return `${(tenths / 10).toFixed(1)}s`;
  }
  const safeRatio = computeHudActionReadyRatio(readyRatio);
  if (safeRatio >= 1) return t('hud.ready', undefined, locale);
  return `${Math.floor(safeRatio * 100)}%`;
}

/** Compute the complete M17 unified top-left HP+XP HUD layout, 20-slot skill grid, and M13 Dash/Active widgets. */
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

  const maxHp = input.maxHp ?? input.maxHearts ?? 100;
  const hp = input.hp ?? maxHp;

  const topLeft = computeTopLeftLayout(
    safeArea.left,
    safeArea.top,
    hp,
    maxHp,
    input.gold ?? 0,
    input.xpLevel ?? 1,
    input.xpCurrent ?? 0,
    input.xpRequired ?? 0,
  );
  const xpBar = topLeft.xpBar;
  const m12XpBar = xpBar.plate;

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

  const dashActive = computeDashActiveLayout(
    safeArea.left,
    safeArea.bottom,
    input.dashReadyRatio ?? 1,
    input.dashCooldownSec ?? 0,
    input.activeReadyRatio ?? 1,
    input.activeCooldownSec ?? 0,
  );
  const m13DashActive = dashActive.plate;

  // M17: bottom-centre XP bar moved to top-left, so the bottom-right skill grid sits cleanly at safeArea.bottom.
  const skillStrip = computeSkillStripLayout(
    safeArea.right,
    safeArea.bottom,
    input.skillCount ?? 0,
  );

  const topPlateHeight = Math.max(topLeft.plate.height, topRight.plate.height);
  const arrowTopInset = HUD_EDGE_MARGIN_PX + topPlateHeight + ARROW_CLEARANCE_BELOW_TOP_PLATE_PX;
  const arrowBottomInset = HUD_ARROW_BOTTOM_INSET_PX;
  const arrowLimits: HudArrowLimits = {
    halfWidth: Math.max(0, halfW - HUD_ARROW_SIDE_INSET_PX),
    top: Math.max(0, halfH - arrowTopInset),
    bottom: Math.max(0, halfH - arrowBottomInset),
  };

  return {
    screen,
    safeArea,
    topLeft,
    topRight,
    bossBar,
    doorHint,
    skillStrip,
    xpBar,
    m12XpBar,
    dashActive,
    m13DashActive,
    arrowLimits,
  };
}

function computeActionSlotLayout(
  contentLeft: number,
  rowBottom: number,
  contentWidth: number,
  keyText: string,
  rawReadyRatio: number,
  rawCooldownSec: number,
): HudActionSlotLayout {
  const row = makeHudRect(contentLeft, rowBottom, contentWidth, HUD_ACTION_ROW_HEIGHT_PX);
  const keyBadge = makeHudRect(
    contentLeft,
    row.centerY - HUD_ACTION_KEY_HEIGHT_PX / 2,
    HUD_ACTION_KEY_WIDTH_PX,
    HUD_ACTION_KEY_HEIGHT_PX,
  );
  const barTrack = makeHudRect(
    keyBadge.right + HUD_ACTION_KEY_GAP_PX,
    row.centerY - HUD_ACTION_BAR_HEIGHT_PX / 2,
    HUD_ACTION_BAR_WIDTH_PX,
    HUD_ACTION_BAR_HEIGHT_PX,
  );
  const barFillMax = makeHudRect(
    barTrack.left + HUD_ACTION_BAR_INSET_PX,
    barTrack.bottom + HUD_ACTION_BAR_INSET_PX,
    barTrack.width - HUD_ACTION_BAR_INSET_PX * 2,
    barTrack.height - HUD_ACTION_BAR_INSET_PX * 2,
  );

  const readyRatio = computeHudActionReadyRatio(rawReadyRatio);
  const isReady = isHudActionReady(rawReadyRatio, rawCooldownSec);
  const statusText = formatHudActionStatusText(rawReadyRatio, rawCooldownSec);

  return {
    row,
    keyBadge,
    barTrack,
    barFillMax,
    keyLabel: { x: keyBadge.centerX, y: keyBadge.centerY },
    statusLabel: { x: barTrack.centerX, y: barTrack.centerY },
    keyText,
    statusText,
    readyRatio,
    isReady,
  };
}

function computeDashActiveLayout(
  left: number,
  bottom: number,
  dashReadyRatio: number,
  dashCooldownSec: number,
  activeReadyRatio: number,
  activeCooldownSec: number,
): HudDashActiveLayout {
  const plate = makeHudRect(
    left,
    bottom,
    HUD_M13_DASH_ACTIVE_WIDTH_PX,
    HUD_M13_DASH_ACTIVE_HEIGHT_PX,
  );
  const contentLeft = plate.left + HUD_ACTION_PLATE_PAD_X_PX;
  const contentWidth = plate.width - HUD_ACTION_PLATE_PAD_X_PX * 2;
  const activeBottom = plate.bottom + HUD_ACTION_PLATE_PAD_Y_PX;
  const dashBottom = activeBottom + HUD_ACTION_ROW_HEIGHT_PX + HUD_ACTION_ROW_GAP_PX;

  return {
    plate,
    dash: computeActionSlotLayout(
      contentLeft,
      dashBottom,
      contentWidth,
      HUD_DASH_KEY_TEXT,
      dashReadyRatio,
      dashCooldownSec,
    ),
    active: computeActionSlotLayout(
      contentLeft,
      activeBottom,
      contentWidth,
      HUD_ACTIVE_KEY_TEXT,
      activeReadyRatio,
      activeCooldownSec,
    ),
  };
}

function computeXpBarLayout(
  left: number,
  bottom: number,
  xpLevel: number,
  xpCurrent: number,
  xpRequired: number,
): HudXpBarLayout {
  const plate = makeHudRect(left, bottom, HUD_M12_XP_BAR_WIDTH_PX, HUD_M12_XP_BAR_HEIGHT_PX);

  const badge = makeHudRect(
    plate.left + HUD_XP_PLATE_PAD_X_PX,
    plate.centerY - HUD_XP_BADGE_HEIGHT_PX / 2,
    HUD_XP_BADGE_WIDTH_PX,
    HUD_XP_BADGE_HEIGHT_PX,
  );

  const barTrack = makeHudRect(
    badge.right + HUD_XP_BADGE_GAP_PX,
    plate.centerY - HUD_XP_BAR_HEIGHT_PX / 2,
    HUD_XP_BAR_WIDTH_PX,
    HUD_XP_BAR_HEIGHT_PX,
  );

  const barFillMax = makeHudRect(
    barTrack.left + HUD_XP_BAR_INSET_PX,
    barTrack.bottom + HUD_XP_BAR_INSET_PX,
    barTrack.width - HUD_XP_BAR_INSET_PX * 2,
    barTrack.height - HUD_XP_BAR_INSET_PX * 2,
  );

  return {
    plate,
    badge,
    barTrack,
    barFillMax,
    levelLabel: { x: badge.centerX, y: badge.centerY },
    progressLabel: { x: barTrack.centerX, y: barTrack.centerY },
    levelText: formatHudLevelText(xpLevel),
    progressText: formatHudXpProgressText(xpCurrent, xpRequired),
    fillRatio: computeHudXpFillRatio(xpCurrent, xpRequired),
  };
}

function computeTopLeftLayout(
  left: number,
  top: number,
  rawHp: number,
  rawMaxHp: number,
  rawGold: number,
  xpLevel: number,
  xpCurrent: number,
  xpRequired: number,
): HudTopLeftLayout {
  const barsHeight = HUD_HP_BAR_HEIGHT_PX + HUD_HP_XP_GAP_PX + HUD_M12_XP_BAR_HEIGHT_PX;
  const headerHeight = Math.max(HUD_PORTRAIT_SIZE_PX, barsHeight);
  const headerWidth = HUD_PORTRAIT_SIZE_PX + HUD_PORTRAIT_GAP_PX + HUD_HP_BAR_WIDTH_PX;

  const goldText = formatHudGoldText(rawGold);
  const goldChars = Math.max(GOLD_MIN_CHARS, goldText.length);
  const goldRowWidth =
    HUD_GOLD_ICON_SIZE_PX + HUD_ICON_TEXT_GAP_PX + estimateHudLabelWidth(goldChars);
  const goldRowHeight = Math.max(HUD_GOLD_ICON_SIZE_PX, HUD_LABEL_LINE_HEIGHT);

  const contentWidth = Math.max(headerWidth, goldRowWidth);
  const contentHeight = headerHeight + ROW_GAP_PX + goldRowHeight;
  const plateWidth = contentWidth + HUD_TOP_LEFT_PAD_X_PX * 2;
  const plateHeight = contentHeight + HUD_TOP_LEFT_PAD_Y_PX * 2;
  const plate = makeHudRect(left, top - plateHeight, plateWidth, plateHeight);

  const contentLeft = left + HUD_TOP_LEFT_PAD_X_PX;
  const contentTop = top - HUD_TOP_LEFT_PAD_Y_PX;

  const portraitSlot = makeHudRect(
    contentLeft,
    contentTop - HUD_PORTRAIT_SIZE_PX,
    HUD_PORTRAIT_SIZE_PX,
    HUD_PORTRAIT_SIZE_PX,
  );

  const barsLeft = portraitSlot.right + HUD_PORTRAIT_GAP_PX;
  const hpTrack = makeHudRect(
    barsLeft,
    contentTop - HUD_HP_BAR_HEIGHT_PX,
    HUD_HP_BAR_WIDTH_PX,
    HUD_HP_BAR_HEIGHT_PX,
  );
  const hpFillMax = makeHudRect(
    hpTrack.left + HUD_HP_BAR_INSET_PX,
    hpTrack.bottom + HUD_HP_BAR_INSET_PX,
    hpTrack.width - HUD_HP_BAR_INSET_PX * 2,
    hpTrack.height - HUD_HP_BAR_INSET_PX * 2,
  );
  const hpFillRatio = computeHudHpFillRatio(rawHp, rawMaxHp);
  const hpBar: HudHpBarLayout = {
    barTrack: hpTrack,
    barFillMax: hpFillMax,
    hpLabel: { x: hpTrack.centerX, y: hpTrack.centerY },
    hpText: formatHudHpText(rawHp, rawMaxHp),
    fillRatio: hpFillRatio,
    tier: hudHpColorTier(hpFillRatio),
  };

  const xpRowBottom = hpTrack.bottom - HUD_HP_XP_GAP_PX - HUD_M12_XP_BAR_HEIGHT_PX;
  const xpBar = computeXpBarLayout(barsLeft, xpRowBottom, xpLevel, xpCurrent, xpRequired);

  const goldCenterY = contentTop - headerHeight - ROW_GAP_PX - goldRowHeight / 2;
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
    portraitSlot,
    hpBar,
    xpBar,
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
  const slotVisualSize = HUD_SKILL_ICON_PX + 2;
  const stepGapX = HUD_SKILL_SLOT_STEP_PX - slotVisualSize;
  const stepGapY = HUD_SKILL_ROW_STEP_PX - slotVisualSize;

  const maxContentWidth = HUD_SKILL_MAX_COLS * HUD_SKILL_SLOT_STEP_PX - stepGapX;
  const maxContentHeight = HUD_SKILL_MAX_ROWS * HUD_SKILL_ROW_STEP_PX - stepGapY;
  const maxWidth = maxContentWidth + HUD_SKILL_STRIP_PAD_X_PX * 2;
  const maxHeight = maxContentHeight + HUD_SKILL_STRIP_PAD_Y_PX * 2;
  const maxPlate = makeHudRect(right - maxWidth, bottom, maxWidth, maxHeight);

  const shownCount = Math.min(HUD_SKILL_SLOTS, Math.max(0, Math.floor(rawSkillCount)));
  const rowCount = shownCount === 0 ? 0 : Math.ceil(shownCount / HUD_SKILL_MAX_COLS);
  const colCount = shownCount === 0 ? 0 : Math.min(HUD_SKILL_MAX_COLS, shownCount);

  const layoutCols = colCount > 0 ? colCount : HUD_SKILL_MAX_COLS;
  const layoutRows = rowCount > 0 ? rowCount : HUD_SKILL_MAX_ROWS;
  const activeContentWidth = layoutCols * HUD_SKILL_SLOT_STEP_PX - stepGapX;
  const activeContentHeight = layoutRows * HUD_SKILL_ROW_STEP_PX - stepGapY;
  const activeWidth = activeContentWidth + HUD_SKILL_STRIP_PAD_X_PX * 2;
  const activeHeight = activeContentHeight + HUD_SKILL_STRIP_PAD_Y_PX * 2;
  const activeLeft = right - activeWidth;

  const activePlate =
    shownCount > 0 ? makeHudRect(activeLeft, bottom, activeWidth, activeHeight) : null;

  const slotCenters: Vec2[] = [];
  const bottomRowCenterY = bottom + HUD_SKILL_STRIP_PAD_Y_PX + slotVisualSize / 2;
  const topRowCenterY = bottomRowCenterY + HUD_SKILL_ROW_STEP_PX;

  for (let index = 0; index < HUD_SKILL_SLOTS; index += 1) {
    const col = index % HUD_SKILL_MAX_COLS;
    const row = Math.floor(index / HUD_SKILL_MAX_COLS);
    if (layoutRows === 1) {
      const baseLeft = row === 0 ? activeLeft : maxPlate.left;
      slotCenters.push({
        x: baseLeft + HUD_SKILL_STRIP_PAD_X_PX + slotVisualSize / 2 + col * HUD_SKILL_SLOT_STEP_PX,
        y: bottomRowCenterY,
      });
    } else {
      slotCenters.push({
        x:
          maxPlate.left +
          HUD_SKILL_STRIP_PAD_X_PX +
          slotVisualSize / 2 +
          col * HUD_SKILL_SLOT_STEP_PX,
        y: row === 0 ? topRowCenterY : bottomRowCenterY,
      });
    }
  }

  return {
    maxPlate,
    activePlate,
    shownCount,
    rowCount,
    colCount,
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

/** Compact XP state carried in `CombatHudSnapshot` (optional until Wave 2 wires live XP). */
export interface HudXpSnapshot {
  readonly level: number;
  readonly current: number;
  readonly required: number;
}

/** Compact M13 Dash + Signature Active state carried in `CombatHudSnapshot` (optional until Wave 2). */
export interface HudActionsSnapshot {
  readonly dashReadyRatio: number;
  readonly dashCooldownSec: number;
  readonly activeReadyRatio: number;
  readonly activeCooldownSec: number;
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
  readonly xpLevel?: number;
  readonly xpCurrent?: number;
  readonly xpRequired?: number;
  readonly xp?: HudXpSnapshot;
  readonly dashReadyRatio?: number;
  readonly dashCooldownSec?: number;
  readonly activeReadyRatio?: number;
  readonly activeCooldownSec?: number;
  readonly actions?: HudActionsSnapshot;
}

export interface CombatHudDiff {
  readonly maxHeartsChanged: boolean;
  readonly heartsChanged: boolean;
  readonly enemiesLeftChanged: boolean;
  readonly bossChanged: boolean;
  readonly xpChanged: boolean;
  readonly actionsChanged: boolean;
}

/** True when `snap` carries explicit XP fields (either scalar `xpLevel/Current/Required` or `xp`). */
export function hasSnapshotXp(snap: CombatHudSnapshot): boolean {
  return (
    snap.xp !== undefined ||
    snap.xpLevel !== undefined ||
    snap.xpCurrent !== undefined ||
    snap.xpRequired !== undefined
  );
}

export function snapshotXpLevel(snap: CombatHudSnapshot): number {
  return snap.xp?.level ?? snap.xpLevel ?? 1;
}

export function snapshotXpCurrent(snap: CombatHudSnapshot): number {
  return snap.xp?.current ?? snap.xpCurrent ?? 0;
}

export function snapshotXpRequired(snap: CombatHudSnapshot): number {
  return snap.xp?.required ?? snap.xpRequired ?? 0;
}

/** True when `snap` carries explicit M13 Dash/Active fields (either nested `actions` or scalars). */
export function hasSnapshotActions(snap: CombatHudSnapshot): boolean {
  return (
    snap.actions !== undefined ||
    snap.dashReadyRatio !== undefined ||
    snap.dashCooldownSec !== undefined ||
    snap.activeReadyRatio !== undefined ||
    snap.activeCooldownSec !== undefined
  );
}

export function snapshotDashReadyRatio(snap: CombatHudSnapshot): number {
  return snap.actions?.dashReadyRatio ?? snap.dashReadyRatio ?? 1;
}

export function snapshotDashCooldownSec(snap: CombatHudSnapshot): number {
  return snap.actions?.dashCooldownSec ?? snap.dashCooldownSec ?? 0;
}

export function snapshotActiveReadyRatio(snap: CombatHudSnapshot): number {
  return snap.actions?.activeReadyRatio ?? snap.activeReadyRatio ?? 1;
}

export function snapshotActiveCooldownSec(snap: CombatHudSnapshot): number {
  return snap.actions?.activeCooldownSec ?? snap.activeCooldownSec ?? 0;
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
      xpChanged: hasSnapshotXp(next),
      actionsChanged: hasSnapshotActions(next),
    };
  }
  const prevHasXp = hasSnapshotXp(prev);
  const nextHasXp = hasSnapshotXp(next);
  const xpChanged =
    prevHasXp !== nextHasXp ||
    (nextHasXp &&
      (!Object.is(snapshotXpLevel(prev), snapshotXpLevel(next)) ||
        !Object.is(snapshotXpCurrent(prev), snapshotXpCurrent(next)) ||
        !Object.is(snapshotXpRequired(prev), snapshotXpRequired(next))));

  const prevHasActions = hasSnapshotActions(prev);
  const nextHasActions = hasSnapshotActions(next);
  const actionsChanged =
    prevHasActions !== nextHasActions ||
    (nextHasActions &&
      (!Object.is(snapshotDashReadyRatio(prev), snapshotDashReadyRatio(next)) ||
        !Object.is(snapshotDashCooldownSec(prev), snapshotDashCooldownSec(next)) ||
        !Object.is(snapshotActiveReadyRatio(prev), snapshotActiveReadyRatio(next)) ||
        !Object.is(snapshotActiveCooldownSec(prev), snapshotActiveCooldownSec(next))));

  return {
    maxHeartsChanged: prev.maxHearts !== next.maxHearts,
    heartsChanged: prev.hearts !== next.hearts || prev.maxHearts !== next.maxHearts,
    enemiesLeftChanged: prev.enemiesLeft !== next.enemiesLeft,
    bossChanged:
      prev.bossName !== next.bossName ||
      prev.bossHp !== next.bossHp ||
      prev.bossMaxHp !== next.bossMaxHp ||
      prev.bossPhase !== next.bossPhase,
    xpChanged,
    actionsChanged,
  };
}
