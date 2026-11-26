import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  HUD_ACTION_KEY_FONT_SIZE,
  HUD_ACTION_KEY_GAP_PX,
  HUD_ACTION_KEY_LINE_HEIGHT,
  HUD_ACTION_ROW_GAP_PX,
  HUD_ACTION_STATUS_FONT_SIZE,
  HUD_ACTION_STATUS_LINE_HEIGHT,
  HUD_ACTIVE_KEY_TEXT,
  HUD_BOSS_TITLE_FONT_SIZE,
  HUD_DASH_KEY_TEXT,
  HUD_DESIGN_HEIGHT,
  HUD_DESIGN_WIDTH,
  HUD_EDGE_MARGIN_PX,
  HUD_ENEMY_ICON_SIZE_PX,
  HUD_GOLD_ICON_SIZE_PX,
  HUD_GOLD_ICON_SOURCE_PX,
  HUD_HEART_SIZE_PX,
  HUD_ICON_TEXT_GAP_PX,
  HUD_LABEL_FONT_SIZE,
  HUD_LABEL_LINE_HEIGHT,
  HUD_MAX_HEARTS_PER_ROW,
  HUD_MIN_SEPARATION_PX,
  HUD_PLATE_PAD_X_PX,
  HUD_PLATE_PAD_Y_PX,
  HUD_PLATE_SLICE_INSETS,
  HUD_ROOM_ICON_SIZE_PX,
  HUD_SKILL_ICON_PX,
  HUD_SKILL_MAX_COLS,
  HUD_SKILL_MAX_ROWS,
  HUD_SKILL_SLOTS,
  HUD_SKILL_STRIP_HEIGHT_PX,
  HUD_SKILL_STRIP_MAX_HEIGHT_PX,
  HUD_XP_BADGE_GAP_PX,
  HUD_XP_LEVEL_FONT_SIZE,
  HUD_XP_LEVEL_LINE_HEIGHT,
  HUD_XP_PROGRESS_FONT_SIZE,
  HUD_XP_PROGRESS_LINE_HEIGHT,
  computeHudActionReadyRatio,
  computeHudLayout,
  computeHudXpFillRatio,
  diffCombatHudSnapshot,
  estimateHudLabelWidth,
  formatHudActionStatusText,
  formatHudEnemiesText,
  formatHudGoldText,
  formatHudLevelText,
  formatHudRoomText,
  formatHudXpProgressText,
  hudRectInside,
  hudRectOnCanvas,
  hudRectsOverlap,
  isHudActionReady,
  makeHudRect,
  scaleHudRectToUi,
  type CombatHudSnapshot,
  type HudRect,
} from '../../assets/scripts/core/view/hud-layout';
import { pixelPerfectRect, worldToUiScale } from '../../assets/scripts/core/view/letterbox';
import { applyCombatHudSnapshot, type CombatHudTarget } from '../../assets/scripts/game/hud-sync';
import { readPng } from '../../scripts/lib/png';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', '..', 'assets');

const SUPPORTED_VIEWPORTS: ReadonlyArray<{
  readonly label: string;
  readonly width: number;
  readonly height: number;
}> = [
  { label: '16:9 FHD (1920×1080)', width: 1920, height: 1080 },
  { label: '16:9 HD (1280×720)', width: 1280, height: 720 },
  { label: '16:10 WXGA (1280×800)', width: 1280, height: 800 },
  { label: '4:3 XGA (1024×768)', width: 1024, height: 768 },
  { label: '21:9 Ultrawide (2560×1080)', width: 2560, height: 1080 },
];

describe('HUD backing plates and internal element containment', () => {
  it('wraps top-left Hearts + GoldCoin + Gold label inside the top-left plate with padding', () => {
    for (const maxHearts of [3, 6, 7, 10, 14]) {
      for (const gold of [0, 95, 9999, 125000]) {
        const layout = computeHudLayout({ maxHearts, gold });
        const { plate, hearts, goldIcon, goldLabel, goldText, heartRows } = layout.topLeft;

        expect(hearts).toHaveLength(maxHearts);
        expect(heartRows).toBe(Math.ceil(maxHearts / HUD_MAX_HEARTS_PER_ROW));
        expect(hudRectInside(plate, layout.safeArea)).toBe(true);

        for (const heart of hearts) {
          const heartRect = makeHudRect(
            heart.x - HUD_HEART_SIZE_PX / 2,
            heart.y - HUD_HEART_SIZE_PX / 2,
            HUD_HEART_SIZE_PX,
            HUD_HEART_SIZE_PX,
          );
          expect(hudRectInside(heartRect, plate)).toBe(true);
        }

        const coinRect = makeHudRect(
          goldIcon.x - HUD_GOLD_ICON_SIZE_PX / 2,
          goldIcon.y - HUD_GOLD_ICON_SIZE_PX / 2,
          HUD_GOLD_ICON_SIZE_PX,
          HUD_GOLD_ICON_SIZE_PX,
        );
        expect(hudRectInside(coinRect, plate)).toBe(true);

        // `ui-text.ts` measures glyph width with 0.62 * fontSize; verify our plate encloses it.
        const uiTextWidth = goldText.length * HUD_LABEL_FONT_SIZE * 0.62;
        const labelRect = makeHudRect(
          goldLabel.x,
          goldLabel.y - HUD_LABEL_LINE_HEIGHT / 2,
          uiTextWidth,
          HUD_LABEL_LINE_HEIGHT,
        );
        expect(hudRectInside(labelRect, plate)).toBe(true);
        expect(coinRect.right + HUD_ICON_TEXT_GAP_PX).toBeLessThanOrEqual(labelRect.left + 1e-6);
      }
    }
  });

  it('keeps top-left plate width steady across normal 0..9999 gold pickups', () => {
    const start = computeHudLayout({ maxHearts: 6, gold: 0 });
    const mid = computeHudLayout({ maxHearts: 6, gold: 450 });
    const high = computeHudLayout({ maxHearts: 6, gold: 9999 });
    expect(mid.topLeft.plate).toEqual(start.topLeft.plate);
    expect(high.topLeft.plate).toEqual(start.topLeft.plate);
  });

  it('wraps top-right Room x/9 + Enemies remaining + icons cleanly and shrinks in boss rooms', () => {
    const combatLayout = computeHudLayout({ roomLabel: '3/9', enemiesLeft: 48 });
    const bossLayout = computeHudLayout({ roomLabel: '9/9', enemiesLeft: null });

    expect(combatLayout.topRight.hasEnemies).toBe(true);
    expect(bossLayout.topRight.hasEnemies).toBe(false);
    expect(combatLayout.topRight.roomText).toBe('Phòng 3/9');
    expect(combatLayout.topRight.enemiesText).toBe('Quái 48');
    expect(bossLayout.topRight.plate.height).toBeLessThan(combatLayout.topRight.plate.height);
    expect(bossLayout.topRight.plate.top).toBe(combatLayout.topRight.plate.top);
    expect(bossLayout.topRight.plate.right).toBe(combatLayout.topRight.plate.right);

    const roomIconRect = makeHudRect(
      combatLayout.topRight.roomIcon.x - HUD_ROOM_ICON_SIZE_PX / 2,
      combatLayout.topRight.roomIcon.y - HUD_ROOM_ICON_SIZE_PX / 2,
      HUD_ROOM_ICON_SIZE_PX,
      HUD_ROOM_ICON_SIZE_PX,
    );
    const enemyIconRect = makeHudRect(
      combatLayout.topRight.enemyIcon.x - HUD_ENEMY_ICON_SIZE_PX / 2,
      combatLayout.topRight.enemyIcon.y - HUD_ENEMY_ICON_SIZE_PX / 2,
      HUD_ENEMY_ICON_SIZE_PX,
      HUD_ENEMY_ICON_SIZE_PX,
    );
    expect(hudRectInside(roomIconRect, combatLayout.topRight.plate)).toBe(true);
    expect(hudRectInside(enemyIconRect, combatLayout.topRight.plate)).toBe(true);

    const roomTextWidth = combatLayout.topRight.roomText.length * HUD_LABEL_FONT_SIZE * 0.62;
    const roomLabelRect = makeHudRect(
      combatLayout.topRight.roomLabel.x - roomTextWidth,
      combatLayout.topRight.roomLabel.y - HUD_LABEL_LINE_HEIGHT / 2,
      roomTextWidth,
      HUD_LABEL_LINE_HEIGHT,
    );
    expect(hudRectInside(roomLabelRect, combatLayout.topRight.plate)).toBe(true);
    expect(roomLabelRect.left).toBeGreaterThanOrEqual(roomIconRect.right + 2);

    const enemiesTextWidth =
      combatLayout.topRight.enemiesText.length * HUD_LABEL_FONT_SIZE * 0.62;
    const enemiesLabelRect = makeHudRect(
      combatLayout.topRight.enemiesLabel.x - enemiesTextWidth,
      combatLayout.topRight.enemiesLabel.y - HUD_LABEL_LINE_HEIGHT / 2,
      enemiesTextWidth,
      HUD_LABEL_LINE_HEIGHT,
    );
    expect(hudRectInside(enemiesLabelRect, combatLayout.topRight.plate)).toBe(true);
    expect(enemiesLabelRect.left).toBeGreaterThanOrEqual(enemyIconRect.right + 2);
  });

  it('expands the bottom-right skill grid cleanly across 0..20 distinct skills (10×2) with zero truncation or slot overlap', () => {
    expect(HUD_SKILL_MAX_COLS).toBe(10);
    expect(HUD_SKILL_MAX_ROWS).toBe(2);
    expect(HUD_SKILL_SLOTS).toBe(20);

    const empty = computeHudLayout({ skillCount: 0 });
    expect(empty.skillStrip.activePlate).toBeNull();
    expect(empty.skillStrip.shownCount).toBe(0);
    expect(empty.skillStrip.rowCount).toBe(0);
    expect(empty.skillStrip.slotCenters).toHaveLength(HUD_SKILL_SLOTS);

    let prevSingleRowWidth = 0;
    for (let count = 1; count <= HUD_SKILL_SLOTS; count += 1) {
      const layout = computeHudLayout({ skillCount: count });
      const { activePlate, maxPlate, shownCount, rowCount, colCount, slotCenters } =
        layout.skillStrip;

      // Zero silent truncation for up to 20 distinct skills (easily covering 12–16 M12 picks).
      expect(shownCount).toBe(count);
      expect(activePlate).not.toBeNull();
      expect(activePlate!.right).toBe(layout.safeArea.right);
      expect(hudRectInside(activePlate!, maxPlate)).toBe(true);

      if (count <= HUD_SKILL_MAX_COLS) {
        expect(rowCount).toBe(1);
        expect(colCount).toBe(count);
        expect(activePlate!.height).toBe(HUD_SKILL_STRIP_HEIGHT_PX);
        expect(activePlate!.width).toBeGreaterThan(prevSingleRowWidth);
        prevSingleRowWidth = activePlate!.width;
      } else {
        expect(rowCount).toBe(2);
        expect(colCount).toBe(HUD_SKILL_MAX_COLS);
        expect(activePlate!.height).toBe(HUD_SKILL_STRIP_MAX_HEIGHT_PX);
        expect(activePlate!).toEqual(maxPlate);
      }

      const slotRects: Array<readonly [string, HudRect]> = [];
      for (let slot = 0; slot < count; slot += 1) {
        const center = slotCenters[slot]!;
        const slotRect = makeHudRect(
          center.x - (HUD_SKILL_ICON_PX + 2) / 2,
          center.y - (HUD_SKILL_ICON_PX + 2) / 2,
          HUD_SKILL_ICON_PX + 2,
          HUD_SKILL_ICON_PX + 2,
        );
        expect(hudRectInside(slotRect, activePlate!)).toBe(true);
        expect(hudRectInside(slotRect, maxPlate)).toBe(true);
        slotRects.push([`skill-${slot}`, slotRect]);
      }
      assertPairwiseSeparated(slotRects, 2);
    }
  });

  it('encloses M12 XP bar track, fill, LV badge, and progress text inside m12XpBar without clipping', () => {
    for (const [xpLevel, xpCurrent, xpRequired] of [
      [1, 0, 0],
      [1, 0, 20],
      [8, 45, 90],
      [16, 240, 240],
      [99, 9999, 9999],
    ] as const) {
      const layout = computeHudLayout({ xpLevel, xpCurrent, xpRequired });
      const { xpBar, m12XpBar, safeArea } = layout;

      expect(xpBar.plate).toEqual(m12XpBar);
      expect(hudRectInside(xpBar.plate, safeArea)).toBe(true);
      expect(hudRectInside(xpBar.badge, xpBar.plate)).toBe(true);
      expect(hudRectInside(xpBar.barTrack, xpBar.plate)).toBe(true);
      expect(hudRectInside(xpBar.barFillMax, xpBar.barTrack)).toBe(true);
      expect(hudRectsOverlap(xpBar.badge, xpBar.barTrack, HUD_XP_BADGE_GAP_PX)).toBe(false);

      // Verify `LV X` badge label fits strictly inside both `badge` and `plate` under `ui-text.ts` metrics.
      const levelUiWidth = xpBar.levelText.length * HUD_XP_LEVEL_FONT_SIZE * 0.62;
      const levelEstWidth = estimateHudLabelWidth(xpBar.levelText.length, HUD_XP_LEVEL_FONT_SIZE);
      for (const width of [levelUiWidth, levelEstWidth]) {
        const levelRect = makeHudRect(
          xpBar.levelLabel.x - width / 2,
          xpBar.levelLabel.y - HUD_XP_LEVEL_LINE_HEIGHT / 2,
          width,
          HUD_XP_LEVEL_LINE_HEIGHT,
        );
        expect(hudRectInside(levelRect, xpBar.badge)).toBe(true);
        expect(hudRectInside(levelRect, xpBar.plate)).toBe(true);
      }

      if (xpBar.progressText !== '') {
        const progUiWidth = xpBar.progressText.length * HUD_XP_PROGRESS_FONT_SIZE * 0.62;
        const progEstWidth = estimateHudLabelWidth(
          xpBar.progressText.length,
          HUD_XP_PROGRESS_FONT_SIZE,
        );
        for (const width of [progUiWidth, progEstWidth]) {
          const progRect = makeHudRect(
            xpBar.progressLabel.x - width / 2,
            xpBar.progressLabel.y - HUD_XP_PROGRESS_LINE_HEIGHT / 2,
            width,
            HUD_XP_PROGRESS_LINE_HEIGHT,
          );
          expect(hudRectInside(progRect, xpBar.barTrack)).toBe(true);
          expect(hudRectInside(progRect, xpBar.plate)).toBe(true);
        }
      }
    }
  });

  it('encloses M13 Dash (SPACE) and Signature Active (E) key badges, tracks, fills, and status text inside m13DashActive', () => {
    for (const [dashReadyRatio, dashCooldownSec, activeReadyRatio, activeCooldownSec] of [
      [1, 0, 1, 0],
      [0, 1.8, 0, 10],
      [0.45, 0.99, 0.62, 3.8],
      [0.95, 0.05, 0.1, 125],
      [0.5, 0, 0.75, 0],
    ] as const) {
      const layout = computeHudLayout({
        dashReadyRatio,
        dashCooldownSec,
        activeReadyRatio,
        activeCooldownSec,
      });
      const { dashActive, m13DashActive, safeArea } = layout;

      expect(dashActive.plate).toEqual(m13DashActive);
      expect(hudRectInside(dashActive.plate, safeArea)).toBe(true);
      expect(dashActive.dash.keyText).toBe(HUD_DASH_KEY_TEXT);
      expect(dashActive.active.keyText).toBe(HUD_ACTIVE_KEY_TEXT);
      expect(hudRectsOverlap(dashActive.dash.row, dashActive.active.row, HUD_ACTION_ROW_GAP_PX)).toBe(
        false,
      );

      for (const slot of [dashActive.dash, dashActive.active]) {
        expect(hudRectInside(slot.row, dashActive.plate)).toBe(true);
        expect(hudRectInside(slot.keyBadge, slot.row)).toBe(true);
        expect(hudRectInside(slot.barTrack, slot.row)).toBe(true);
        expect(hudRectInside(slot.barFillMax, slot.barTrack)).toBe(true);
        expect(hudRectsOverlap(slot.keyBadge, slot.barTrack, HUD_ACTION_KEY_GAP_PX)).toBe(false);

        const keyUiWidth = slot.keyText.length * HUD_ACTION_KEY_FONT_SIZE * 0.62;
        const keyEstWidth = estimateHudLabelWidth(slot.keyText.length, HUD_ACTION_KEY_FONT_SIZE);
        for (const width of [keyUiWidth, keyEstWidth]) {
          const keyRect = makeHudRect(
            slot.keyLabel.x - width / 2,
            slot.keyLabel.y - HUD_ACTION_KEY_LINE_HEIGHT / 2,
            width,
            HUD_ACTION_KEY_LINE_HEIGHT,
          );
          expect(hudRectInside(keyRect, slot.keyBadge)).toBe(true);
          expect(hudRectInside(keyRect, dashActive.plate)).toBe(true);
        }

        const statusUiWidth = slot.statusText.length * HUD_ACTION_STATUS_FONT_SIZE * 0.62;
        const statusEstWidth = estimateHudLabelWidth(
          slot.statusText.length,
          HUD_ACTION_STATUS_FONT_SIZE,
        );
        for (const width of [statusUiWidth, statusEstWidth]) {
          const statusRect = makeHudRect(
            slot.statusLabel.x - width / 2,
            slot.statusLabel.y - HUD_ACTION_STATUS_LINE_HEIGHT / 2,
            width,
            HUD_ACTION_STATUS_LINE_HEIGHT,
          );
          expect(hudRectInside(statusRect, slot.barTrack)).toBe(true);
          expect(hudRectInside(statusRect, dashActive.plate)).toBe(true);
        }
      }
    }
  });
});

describe('M13 Dash & Signature Active ratio clamping and countdown formatting', () => {
  it('clamps action ready ratios cleanly to [0, 1] and formats READY / tenths countdowns', () => {
    expect(computeHudActionReadyRatio(1)).toBe(1);
    expect(computeHudActionReadyRatio(0)).toBe(0);
    expect(computeHudActionReadyRatio(0.45)).toBeCloseTo(0.45, 6);
    expect(computeHudActionReadyRatio(-0.5)).toBe(0);
    expect(computeHudActionReadyRatio(2.5)).toBe(1);
    expect(computeHudActionReadyRatio(Number.NaN)).toBe(0);
    expect(computeHudActionReadyRatio(Number.POSITIVE_INFINITY)).toBe(0);

    expect(isHudActionReady(1, 0)).toBe(true);
    expect(isHudActionReady(1, 0.2)).toBe(false);
    expect(isHudActionReady(0.6, 0)).toBe(false);

    expect(formatHudActionStatusText(1, 0)).toBe('SẴN');
    expect(formatHudActionStatusText(1, 0, 'en')).toBe('READY');
    expect(formatHudActionStatusText(0, 1.8)).toBe('1.8s');
    expect(formatHudActionStatusText(0.95, 0.02)).toBe('0.1s');
    expect(formatHudActionStatusText(0, 10)).toBe('10.0s');
    expect(formatHudActionStatusText(0, 125)).toBe('125s');
    expect(formatHudActionStatusText(0.5, 0)).toBe('50%');
  });
});

describe('M12 XP fill ratio clamping and badge/progress formatting', () => {
  it('clamps XP fill ratio cleanly to [0, 1] and guards requiredXp <= 0 or non-finite values', () => {
    expect(computeHudXpFillRatio(0, 20)).toBe(0);
    expect(computeHudXpFillRatio(5, 20)).toBeCloseTo(0.25, 6);
    expect(computeHudXpFillRatio(20, 20)).toBe(1);
    expect(computeHudXpFillRatio(35, 20)).toBe(1);
    expect(computeHudXpFillRatio(-10, 20)).toBe(0);

    // `required <= 0` and non-finite edge cases never divide by zero or return NaN.
    expect(computeHudXpFillRatio(0, 0)).toBe(0);
    expect(computeHudXpFillRatio(15, 0)).toBe(0);
    expect(computeHudXpFillRatio(15, -8)).toBe(0);
    expect(computeHudXpFillRatio(Number.NaN, 20)).toBe(0);
    expect(computeHudXpFillRatio(10, Number.NaN)).toBe(0);
    expect(computeHudXpFillRatio(Number.POSITIVE_INFINITY, 20)).toBe(0);
    expect(computeHudXpFillRatio(10, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('formats level badge and compact XP progress text deterministically', () => {
    expect(formatHudLevelText(1)).toBe('Cấp 1');
    expect(formatHudLevelText(16)).toBe('Cấp 16');
    expect(formatHudLevelText(14.9)).toBe('Cấp 14');
    expect(formatHudLevelText(0)).toBe('Cấp 1');
    expect(formatHudLevelText(-3)).toBe('Cấp 1');
    expect(formatHudLevelText(Number.NaN)).toBe('Cấp 1');
    expect(formatHudLevelText(1, 'en')).toBe('LV 1');
    expect(formatHudLevelText(16, 'en')).toBe('LV 16');

    expect(formatHudXpProgressText(0, 20)).toBe('0/20');
    expect(formatHudXpProgressText(14.8, 35.9)).toBe('14/35');
    expect(formatHudXpProgressText(-5, 20)).toBe('0/20');
    expect(formatHudXpProgressText(0, 0)).toBe('');
    expect(formatHudXpProgressText(12, 0)).toBe('');
    expect(formatHudXpProgressText(12, -10)).toBe('');
    expect(formatHudXpProgressText(12, Number.NaN)).toBe('');
  });
});

describe('non-overlap across active HUD plates, 16–20 skill grid, M12 XP bar, and M13 reserve', () => {
  it('never overlaps top-left, boss bar / door hint, top-right, 0..20 skill strip, M12 XP bar, or M13 Dash/Active', () => {
    for (const maxHearts of [3, 6, 8, 12, 14]) {
      for (const skillCount of [0, 1, 4, 8, 10, 12, 16, 20]) {
        const combat = computeHudLayout({
          maxHearts,
          gold: 9999,
          roomLabel: '8/9',
          enemiesLeft: 64,
          skillCount,
          xpLevel: 15,
          xpCurrent: 80,
          xpRequired: 120,
        });

        // Combat mode regions (doorHint + top-left + top-right + skillStrip + M12 + M13)
        const combatRegions: Array<readonly [string, HudRect]> = [
          ['topLeft', combat.topLeft.plate],
          ['doorHint', combat.doorHint],
          ['topRight', combat.topRight.plate],
          ['skillStrip', combat.skillStrip.maxPlate],
          ['m12XpBar', combat.m12XpBar],
          ['m13DashActive', combat.m13DashActive],
        ];
        assertPairwiseSeparated(combatRegions, HUD_MIN_SEPARATION_PX);

        if (combat.skillStrip.activePlate !== null) {
          assertPairwiseSeparated(
            [
              ['topLeft', combat.topLeft.plate],
              ['doorHint', combat.doorHint],
              ['topRight', combat.topRight.plate],
              ['activeSkillStrip', combat.skillStrip.activePlate],
              ['m12XpBar', combat.m12XpBar],
              ['m13DashActive', combat.m13DashActive],
            ],
            HUD_MIN_SEPARATION_PX,
          );
        }

        // Boss mode regions (bossBar + top-left + top-right + skillStrip + M12 + M13)
        const boss = computeHudLayout({
          maxHearts,
          gold: 9999,
          roomLabel: '9/9',
          enemiesLeft: null,
          skillCount,
          xpLevel: 16,
          xpCurrent: 110,
          xpRequired: 120,
        });
        const bossRegions: ReadonlyArray<readonly [string, HudRect]> = [
          ['topLeft', boss.topLeft.plate],
          ['bossBar', boss.bossBar.plate],
          ['topRight', boss.topRight.plate],
          ['skillStrip', boss.skillStrip.maxPlate],
          ['m12XpBar', boss.m12XpBar],
          ['m13DashActive', boss.m13DashActive],
        ];
        assertPairwiseSeparated(bossRegions, HUD_MIN_SEPARATION_PX);

        // Longest boss title ("GIANT BLUE SAMURAI  ·  PHASE 3") fits inside boss plate.
        const maxBossTitle = 'GIANT BLUE SAMURAI  ·  PHASE 3';
        const bossTitleWidth = maxBossTitle.length * HUD_BOSS_TITLE_FONT_SIZE * 0.62;
        expect(bossTitleWidth).toBeLessThanOrEqual(boss.bossBar.plate.width - HUD_PLATE_PAD_X_PX);
      }
    }
  });

  it('positions M12 XP bar at bottom-centre and M13 Dash/Active at bottom-left inside safeArea', () => {
    const singleRowLayout = computeHudLayout({ skillCount: 10 });
    expect(singleRowLayout.m12XpBar.centerX).toBe(0);
    expect(singleRowLayout.m12XpBar.bottom).toBe(singleRowLayout.safeArea.bottom);
    expect(hudRectInside(singleRowLayout.m12XpBar, singleRowLayout.safeArea)).toBe(true);

    expect(singleRowLayout.m13DashActive.left).toBe(singleRowLayout.safeArea.left);
    expect(singleRowLayout.m13DashActive.bottom).toBe(singleRowLayout.safeArea.bottom);
    expect(hudRectInside(singleRowLayout.m13DashActive, singleRowLayout.safeArea)).toBe(true);

    // 1..10 skills keeps >= 175 px central window; full 20-skill 2-row grid still keeps >= 150 px.
    const oneRowWindow =
      singleRowLayout.topLeft.plate.bottom - singleRowLayout.skillStrip.activePlate!.top;
    expect(oneRowWindow).toBeGreaterThanOrEqual(175);

    const fullGridWindow =
      singleRowLayout.topLeft.plate.bottom - singleRowLayout.skillStrip.maxPlate.top;
    expect(fullGridWindow).toBeGreaterThanOrEqual(150);
  });

  it('clamps off-screen edge arrows below top HUD plates and above the M12 XP bar', () => {
    const layout = computeHudLayout({ maxHearts: 6, enemiesLeft: 24 });
    // Arrow triangle tip reaches 7 px from its node centre.
    expect(layout.arrowLimits.top + 7).toBeLessThanOrEqual(layout.topLeft.plate.bottom);
    expect(layout.arrowLimits.top + 7).toBeLessThanOrEqual(layout.topRight.plate.bottom);
    expect(-layout.arrowLimits.bottom - 7).toBeGreaterThanOrEqual(layout.m12XpBar.top);
  });
});

describe('viewport scaling across 16:9, 16:10, 4:3, and 21:9 ultrawide', () => {
  it.each(SUPPORTED_VIEWPORTS)(
    '$label ($width×$height): 16–20 skill grid, M12 XP bar, and all HUD plates stay inside the room band and canvas with zero overlap',
    ({ width, height }) => {
      const hudScale = worldToUiScale(width, height, HUD_DESIGN_WIDTH, HUD_DESIGN_HEIGHT);
      expect(hudScale).toBeGreaterThan(0);
      expect(hudScale).toBeLessThanOrEqual(1);

      const worldNorm = pixelPerfectRect(width, height, HUD_DESIGN_WIDTH, HUD_DESIGN_HEIGHT);
      const worldBandPx = makeHudRect(
        worldNorm.x * width,
        worldNorm.y * height,
        worldNorm.width * width,
        worldNorm.height * height,
      );
      const canvasPx = makeHudRect(0, 0, width, height);
      const uiBandDesign = makeHudRect(
        -HUD_DESIGN_WIDTH / 2,
        -HUD_DESIGN_HEIGHT / 2,
        HUD_DESIGN_WIDTH,
        HUD_DESIGN_HEIGHT,
      );

      for (const skillCount of [8, 12, 16, 20]) {
        const layout = computeHudLayout({
          maxHearts: 8,
          gold: 4321,
          roomLabel: '9/9',
          enemiesLeft: 32,
          skillCount,
          xpLevel: 16,
          xpCurrent: 75,
          xpRequired: 100,
        });

        const rects: ReadonlyArray<HudRect> = [
          layout.topLeft.plate,
          layout.bossBar.plate,
          layout.doorHint,
          layout.topRight.plate,
          layout.skillStrip.maxPlate,
          layout.skillStrip.activePlate!,
          layout.m12XpBar,
          layout.m13DashActive,
        ];

        const projected: HudRect[] = [];
        for (const rect of rects) {
          // UI Canvas (`collectUiText` `insideCanvas`) check after multiplying by `hudScale`.
          const inUi = scaleHudRectToUi(rect, hudScale);
          expect(hudRectInside(inUi, uiBandDesign, 0.5)).toBe(true);

          // Actual browser canvas pixel rect hugs the pixel-perfect room band with safe margin.
          const onCanvas = hudRectOnCanvas(rect, width, height);
          expect(hudRectInside(onCanvas, worldBandPx, 0.5)).toBe(true);
          expect(hudRectInside(onCanvas, canvasPx, 0.5)).toBe(true);

          const minMarginPx = Math.floor(HUD_EDGE_MARGIN_PX * (worldBandPx.width / HUD_DESIGN_WIDTH));
          expect(onCanvas.left - worldBandPx.left).toBeGreaterThanOrEqual(minMarginPx - 0.5);
          expect(worldBandPx.right - onCanvas.right).toBeGreaterThanOrEqual(minMarginPx - 0.5);
          expect(onCanvas.bottom - worldBandPx.bottom).toBeGreaterThanOrEqual(minMarginPx - 0.5);
          expect(worldBandPx.top - onCanvas.top).toBeGreaterThanOrEqual(minMarginPx - 0.5);
          projected.push(onCanvas);
        }

        // Verify all 16–20 individual skill slot frames project cleanly inside the active plate & canvas.
        for (let slot = 0; slot < skillCount; slot += 1) {
          const center = layout.skillStrip.slotCenters[slot]!;
          const slotDesign = makeHudRect(
            center.x - (HUD_SKILL_ICON_PX + 2) / 2,
            center.y - (HUD_SKILL_ICON_PX + 2) / 2,
            HUD_SKILL_ICON_PX + 2,
            HUD_SKILL_ICON_PX + 2,
          );
          const slotCanvas = hudRectOnCanvas(slotDesign, width, height);
          expect(hudRectInside(slotCanvas, projected[5]!, 0.5)).toBe(true);
          expect(hudRectInside(slotCanvas, canvasPx, 0.5)).toBe(true);
        }

        // Projected top-left, bossBar, top-right, active skillStrip, M12, M13 remain separated in canvas px.
        const nonOverlappingCanvas: ReadonlyArray<readonly [string, HudRect]> = [
          ['topLeft', projected[0]!],
          ['bossBar', projected[1]!],
          ['topRight', projected[3]!],
          ['skillStrip', projected[5]!],
          ['m12XpBar', projected[6]!],
          ['m13DashActive', projected[7]!],
        ];
        assertPairwiseSeparated(nonOverlappingCanvas, 2);
      }
    },
  );
});

describe('HUD pixel-art icon & 9-slice asset files on disk', () => {
  it('stages GoldCoin.png (7×7), Arrow.png (13×13), skull, Heart.png, and nine_path_panel_interior with valid image .meta', () => {
    const specs = [
      {
        rel: 'resources/art/ui/coin/GoldCoin.png',
        w: HUD_GOLD_ICON_SOURCE_PX,
        h: HUD_GOLD_ICON_SOURCE_PX,
        expectNearestInMeta: true,
      },
      {
        rel: 'resources/art/ui/Arrow.png',
        w: HUD_ROOM_ICON_SIZE_PX,
        h: HUD_ROOM_ICON_SIZE_PX,
        expectNearestInMeta: true,
      },
      {
        rel: 'resources/art/ui/Heart.png',
        w: 80,
        h: HUD_HEART_SIZE_PX,
        expectNearestInMeta: false,
      },
      {
        rel: 'resources/art/ui/theme-wood/nine_path_panel_interior.png',
        w: 16,
        h: 16,
        expectNearestInMeta: false,
      },
      {
        rel: 'resources/art/monsters/skull-blue/SpriteSheet.png',
        w: 64,
        h: 64,
        expectNearestInMeta: true,
      },
    ] as const;

    for (const spec of specs) {
      const fullPath = join(ASSETS, spec.rel);
      expect(existsSync(fullPath), `${spec.rel} missing`).toBe(true);
      const png = readPng(fullPath);
      expect([png.width, png.height], spec.rel).toEqual([spec.w, spec.h]);

      const metaPath = `${fullPath}.meta`;
      expect(existsSync(metaPath), `${spec.rel}.meta missing`).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        importer?: string;
        subMetas?: Record<string, { userData?: { minfilter?: string; magfilter?: string } }>;
      };
      expect(meta.importer).toBe('image');
      if (spec.expectNearestInMeta) {
        expect(meta.subMetas?.['6c48a']?.userData?.minfilter).toBe('nearest');
        expect(meta.subMetas?.['6c48a']?.userData?.magfilter).toBe('nearest');
      }
    }

    // Integer texel scaling check for HUD icons.
    expect(HUD_GOLD_ICON_SIZE_PX % HUD_GOLD_ICON_SOURCE_PX).toBe(0);
    expect(HUD_PLATE_SLICE_INSETS).toEqual({ left: 4, right: 4, top: 4, bottom: 4 });
    expect(HUD_PLATE_PAD_Y_PX).toBeGreaterThanOrEqual(HUD_PLATE_SLICE_INSETS.top);
  });
});

describe('event-driven HUD sync (diffCombatHudSnapshot & applyCombatHudSnapshot)', () => {
  function makeMockHud(): {
    readonly target: CombatHudTarget;
    readonly maxHearts: ReturnType<typeof vi.fn>;
    readonly hearts: ReturnType<typeof vi.fn>;
    readonly enemiesLeft: ReturnType<typeof vi.fn>;
    readonly bossState: ReturnType<typeof vi.fn>;
    readonly xp: ReturnType<typeof vi.fn>;
    readonly actions: ReturnType<typeof vi.fn>;
  } {
    const maxHearts = vi.fn();
    const hearts = vi.fn();
    const enemiesLeft = vi.fn();
    const bossState = vi.fn();
    const xp = vi.fn();
    const actions = vi.fn();
    return {
      target: {
        setMaxHearts: maxHearts,
        setHearts: hearts,
        setEnemiesLeft: enemiesLeft,
        setBossState: bossState,
        setXp: xp,
        setActions: actions,
      },
      maxHearts,
      hearts,
      enemiesLeft,
      bossState,
      xp,
      actions,
    };
  }

  it('pushes initial state once on connect and performs 0 calls on unchanged frames (with or without XP)', () => {
    const mock = makeMockHud();
    const initial: CombatHudSnapshot = {
      maxHearts: 6,
      hearts: 6,
      enemiesLeft: 28,
      bossName: null,
      bossHp: 0,
      bossMaxHp: 0,
      bossPhase: 0,
    };

    applyCombatHudSnapshot(mock.target, initial);
    expect(mock.maxHearts).toHaveBeenCalledTimes(1);
    expect(mock.hearts).toHaveBeenCalledTimes(1);
    expect(mock.enemiesLeft).toHaveBeenCalledTimes(1);
    expect(mock.bossState).toHaveBeenCalledTimes(1);
    // Legacy callers omitting XP fields never overwrite XP state.
    expect(mock.xp).toHaveBeenCalledTimes(0);

    // Simulate 120 unchanged frames: zero HUD setter calls.
    for (let frame = 0; frame < 120; frame += 1) {
      applyCombatHudSnapshot(mock.target, { ...initial });
    }
    expect(mock.maxHearts).toHaveBeenCalledTimes(1);
    expect(mock.hearts).toHaveBeenCalledTimes(1);
    expect(mock.enemiesLeft).toHaveBeenCalledTimes(1);
    expect(mock.bossState).toHaveBeenCalledTimes(1);
    expect(mock.xp).toHaveBeenCalledTimes(0);
  });

  it('updates only setXp when XP level, current, or required changes, and skips identical XP frames', () => {
    const mock = makeMockHud();
    const initialWithXp: CombatHudSnapshot = {
      maxHearts: 6,
      hearts: 6,
      enemiesLeft: 24,
      bossName: null,
      bossHp: 0,
      bossMaxHp: 0,
      bossPhase: 0,
      xpLevel: 1,
      xpCurrent: 0,
      xpRequired: 20,
    };

    applyCombatHudSnapshot(mock.target, initialWithXp);
    expect(mock.xp).toHaveBeenCalledTimes(1);
    expect(mock.xp).toHaveBeenLastCalledWith(1, 0, 20);

    // 120 identical frames with XP present → 0 calls across all HUD setters.
    for (let frame = 0; frame < 120; frame += 1) {
      applyCombatHudSnapshot(mock.target, { ...initialWithXp });
    }
    expect(mock.xp).toHaveBeenCalledTimes(1);
    expect(mock.hearts).toHaveBeenCalledTimes(1);
    expect(mock.enemiesLeft).toHaveBeenCalledTimes(1);

    // XP orb picked up (`xpCurrent` changes) → ONLY `setXp` fires.
    const afterPickup: CombatHudSnapshot = { ...initialWithXp, xpCurrent: 8 };
    expect(diffCombatHudSnapshot(initialWithXp, afterPickup)).toEqual({
      maxHeartsChanged: false,
      heartsChanged: false,
      enemiesLeftChanged: false,
      bossChanged: false,
      xpChanged: true,
      actionsChanged: false,
    });
    applyCombatHudSnapshot(mock.target, afterPickup);
    expect(mock.xp).toHaveBeenCalledTimes(2);
    expect(mock.xp).toHaveBeenLastCalledWith(1, 8, 20);
    expect(mock.hearts).toHaveBeenCalledTimes(1);
    expect(mock.enemiesLeft).toHaveBeenCalledTimes(1);
    expect(mock.bossState).toHaveBeenCalledTimes(1);

    // Level-up via nested `xp: { level, current, required }` form → ONLY `setXp` fires, then stabilizes.
    const afterLevelUp: CombatHudSnapshot = {
      maxHearts: 6,
      hearts: 6,
      enemiesLeft: 24,
      bossName: null,
      bossHp: 0,
      bossMaxHp: 0,
      bossPhase: 0,
      xp: { level: 2, current: 3, required: 28 },
    };
    applyCombatHudSnapshot(mock.target, afterLevelUp);
    expect(mock.xp).toHaveBeenCalledTimes(3);
    expect(mock.xp).toHaveBeenLastCalledWith(2, 3, 28);

    // Equivalent scalar vs nested representation with identical values produces `xpChanged: false`.
    applyCombatHudSnapshot(mock.target, {
      ...initialWithXp,
      xpLevel: 2,
      xpCurrent: 3,
      xpRequired: 28,
    });
    expect(mock.xp).toHaveBeenCalledTimes(3);
  });

  it('updates only the exact field that changed (hearts, enemiesLeft, Vitality cap, boss HP/phase)', () => {
    const mock = makeMockHud();
    const base: CombatHudSnapshot = {
      maxHearts: 6,
      hearts: 6,
      enemiesLeft: 12,
      bossName: null,
      bossHp: 0,
      bossMaxHp: 0,
      bossPhase: 0,
    };
    applyCombatHudSnapshot(mock.target, base);

    // Enemy killed → only setEnemiesLeft fires.
    applyCombatHudSnapshot(mock.target, { ...base, enemiesLeft: 11 });
    expect(mock.enemiesLeft).toHaveBeenCalledTimes(2);
    expect(mock.hearts).toHaveBeenCalledTimes(1);
    expect(mock.maxHearts).toHaveBeenCalledTimes(1);
    expect(mock.bossState).toHaveBeenCalledTimes(1);

    // Player hit → only setHearts fires.
    applyCombatHudSnapshot(mock.target, { ...base, enemiesLeft: 11, hearts: 5 });
    expect(mock.hearts).toHaveBeenCalledTimes(2);
    expect(mock.enemiesLeft).toHaveBeenCalledTimes(2);

    // Vitality picked → both setMaxHearts and setHearts refresh.
    applyCombatHudSnapshot(mock.target, { ...base, enemiesLeft: 11, maxHearts: 7, hearts: 6 });
    expect(mock.maxHearts).toHaveBeenCalledTimes(2);
    expect(mock.hearts).toHaveBeenCalledTimes(3);

    // Enter boss room → enemiesLeft becomes null + boss appears; subsequent idle frames do 0 calls.
    const bossSnap: CombatHudSnapshot = {
      maxHearts: 7,
      hearts: 6,
      enemiesLeft: null,
      bossName: 'Tengu',
      bossHp: 120,
      bossMaxHp: 120,
      bossPhase: 1,
    };
    applyCombatHudSnapshot(mock.target, bossSnap);
    expect(mock.enemiesLeft).toHaveBeenLastCalledWith(null);
    expect(mock.bossState).toHaveBeenLastCalledWith('Tengu', 120, 120, 1);

    applyCombatHudSnapshot(mock.target, bossSnap);
    expect(mock.bossState).toHaveBeenCalledTimes(2);

    expect(diffCombatHudSnapshot(bossSnap, { ...bossSnap, bossHp: 90 })).toEqual({
      maxHeartsChanged: false,
      heartsChanged: false,
      enemiesLeftChanged: false,
      bossChanged: true,
      xpChanged: false,
      actionsChanged: false,
    });
  });

  it('updates only setActions when Dash or Signature Active cooldown changes, and skips ready/unchanged frames', () => {
    const mock = makeMockHud();
    const readySnap: CombatHudSnapshot = {
      maxHearts: 6,
      hearts: 6,
      enemiesLeft: 20,
      bossName: null,
      bossHp: 0,
      bossMaxHp: 0,
      bossPhase: 0,
      actions: {
        dashReadyRatio: 1,
        dashCooldownSec: 0,
        activeReadyRatio: 1,
        activeCooldownSec: 0,
      },
    };

    applyCombatHudSnapshot(mock.target, readySnap);
    expect(mock.actions).toHaveBeenCalledTimes(1);
    expect(mock.actions).toHaveBeenLastCalledWith(1, 0, 1, 0);

    // 120 identical frames with both actions READY → 0 calls across all HUD setters!
    for (let frame = 0; frame < 120; frame += 1) {
      applyCombatHudSnapshot(mock.target, {
        ...readySnap,
        actions: { ...readySnap.actions! },
      });
    }
    expect(mock.actions).toHaveBeenCalledTimes(1);
    expect(mock.hearts).toHaveBeenCalledTimes(1);
    expect(mock.enemiesLeft).toHaveBeenCalledTimes(1);

    // Dash triggered → ONLY `setActions` fires.
    const dashStarted: CombatHudSnapshot = {
      ...readySnap,
      actions: {
        dashReadyRatio: 0,
        dashCooldownSec: 1.8,
        activeReadyRatio: 1,
        activeCooldownSec: 0,
      },
    };
    expect(diffCombatHudSnapshot(readySnap, dashStarted)).toEqual({
      maxHeartsChanged: false,
      heartsChanged: false,
      enemiesLeftChanged: false,
      bossChanged: false,
      xpChanged: false,
      actionsChanged: true,
    });
    applyCombatHudSnapshot(mock.target, dashStarted);
    expect(mock.actions).toHaveBeenCalledTimes(2);
    expect(mock.actions).toHaveBeenLastCalledWith(0, 1.8, 1, 0);
    expect(mock.hearts).toHaveBeenCalledTimes(1);

    // Equivalent scalar representation with identical values produces `actionsChanged: false`.
    applyCombatHudSnapshot(mock.target, {
      maxHearts: 6,
      hearts: 6,
      enemiesLeft: 20,
      bossName: null,
      bossHp: 0,
      bossMaxHp: 0,
      bossPhase: 0,
      dashReadyRatio: 0,
      dashCooldownSec: 1.8,
      activeReadyRatio: 1,
      activeCooldownSec: 0,
    });
    expect(mock.actions).toHaveBeenCalledTimes(2);
  });

  it('re-syncs boss and XP state if Hud was modified directly between sync calls', () => {
    let liveBoss: string | null = null;
    let liveXpLevel = 1;
    let liveXpCurrent = 0;
    let liveXpRequired = 0;
    let liveDashRatio = 1;
    const bossState = vi.fn((name: string | null) => {
      liveBoss = name;
    });
    const setXp = vi.fn((level: number, current: number, required: number) => {
      liveXpLevel = level;
      liveXpCurrent = current;
      liveXpRequired = required;
    });
    const setActions = vi.fn((dashRatio: number) => {
      liveDashRatio = dashRatio;
    });
    const target: CombatHudTarget = {
      get activeBossName() {
        return liveBoss;
      },
      get activeXpLevel() {
        return liveXpLevel;
      },
      get activeXpCurrent() {
        return liveXpCurrent;
      },
      get activeXpRequired() {
        return liveXpRequired;
      },
      get activeDashReadyRatio() {
        return liveDashRatio;
      },
      setMaxHearts: vi.fn(),
      setHearts: vi.fn(),
      setEnemiesLeft: vi.fn(),
      setBossState: bossState,
      setXp,
      setActions,
    };

    const snap: CombatHudSnapshot = {
      maxHearts: 6,
      hearts: 6,
      enemiesLeft: null,
      bossName: 'Tengu',
      bossHp: 120,
      bossMaxHp: 120,
      bossPhase: 1,
      xpLevel: 4,
      xpCurrent: 12,
      xpRequired: 40,
      actions: {
        dashReadyRatio: 0.5,
        dashCooldownSec: 0.9,
        activeReadyRatio: 1,
        activeCooldownSec: 0,
      },
    };
    applyCombatHudSnapshot(target, snap);
    expect(bossState).toHaveBeenCalledTimes(1);
    expect(setXp).toHaveBeenCalledTimes(1);
    expect(setActions).toHaveBeenCalledTimes(1);

    // Direct `hud.setBoss(null)` / `hud.setXp(...)` / `hud.setActions(...)` invalidates cached snapshot cleanly.
    liveBoss = null;
    applyCombatHudSnapshot(target, snap);
    expect(bossState).toHaveBeenCalledTimes(2);

    liveXpCurrent = 0;
    applyCombatHudSnapshot(target, snap);
    expect(setXp).toHaveBeenCalledTimes(2);

    liveDashRatio = 1;
    applyCombatHudSnapshot(target, snap);
    expect(setActions).toHaveBeenCalledTimes(2);
  });

  it('formats HUD text helpers deterministically in Vietnamese (default) and English', () => {
    expect(formatHudGoldText(0)).toBe('Vàng 0');
    expect(formatHudGoldText(-5)).toBe('Vàng 0');
    expect(formatHudGoldText(42.9)).toBe('Vàng 42');
    expect(formatHudRoomText('1/9')).toBe('Phòng 1/9');
    expect(formatHudRoomText('Phòng 4/9')).toBe('Phòng 4/9');
    expect(formatHudRoomText('')).toBe('Phòng 1/9');
    expect(formatHudEnemiesText(17.8)).toBe('Quái 17');

    expect(formatHudGoldText(0, 'en')).toBe('Gold 0');
    expect(formatHudGoldText(42.9, 'en')).toBe('Gold 42');
    expect(formatHudRoomText('1/9', 'en')).toBe('Room 1/9');
    expect(formatHudRoomText('Room 4/9', 'en')).toBe('Room 4/9');
    expect(formatHudRoomText('', 'en')).toBe('Room 1/9');
    expect(formatHudEnemiesText(17.8, 'en')).toBe('Enemies 17');
    expect(estimateHudLabelWidth(8)).toBeGreaterThan(0);
  });
});

function assertPairwiseSeparated(
  regions: ReadonlyArray<readonly [string, HudRect]>,
  minGapPx: number,
): void {
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      const [nameA, rectA] = regions[i]!;
      const [nameB, rectB] = regions[j]!;
      expect(
        hudRectsOverlap(rectA, rectB, minGapPx),
        `${nameA} (${fmtRect(rectA)}) overlaps or crowds ${nameB} (${fmtRect(rectB)}) within ${minGapPx}px`,
      ).toBe(false);
    }
  }
}

function fmtRect(r: HudRect): string {
  return `[${r.left.toFixed(1)}..${r.right.toFixed(1)}, ${r.bottom.toFixed(1)}..${r.top.toFixed(1)}]`;
}
