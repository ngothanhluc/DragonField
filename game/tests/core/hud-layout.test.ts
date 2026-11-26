import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  HUD_BOSS_TITLE_FONT_SIZE,
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
  HUD_SKILL_SLOTS,
  computeHudLayout,
  diffCombatHudSnapshot,
  estimateHudLabelWidth,
  formatHudEnemiesText,
  formatHudGoldText,
  formatHudRoomText,
  hudRectInside,
  hudRectOnCanvas,
  hudRectsOverlap,
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
    expect(combatLayout.topRight.roomText).toBe('Room 3/9');
    expect(combatLayout.topRight.enemiesText).toBe('Enemies 48');
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

  it('keeps the skill strip hidden at 0 skills and wraps 1..8 skills cleanly on the bottom-right', () => {
    const empty = computeHudLayout({ skillCount: 0 });
    expect(empty.skillStrip.activePlate).toBeNull();

    let prevWidth = 0;
    for (let count = 1; count <= HUD_SKILL_SLOTS; count += 1) {
      const layout = computeHudLayout({ skillCount: count });
      const active = layout.skillStrip.activePlate;
      expect(active).not.toBeNull();
      expect(active!.right).toBe(layout.safeArea.right);
      expect(active!.width).toBeGreaterThan(prevWidth);
      expect(hudRectInside(active!, layout.skillStrip.maxPlate)).toBe(true);
      prevWidth = active!.width;

      for (let slot = 0; slot < count; slot += 1) {
        const center = layout.skillStrip.slotCenters[slot]!;
        const slotRect = makeHudRect(
          center.x - (HUD_SKILL_ICON_PX + 2) / 2,
          center.y - (HUD_SKILL_ICON_PX + 2) / 2,
          HUD_SKILL_ICON_PX + 2,
          HUD_SKILL_ICON_PX + 2,
        );
        expect(hudRectInside(slotRect, active!)).toBe(true);
      }
    }
  });
});

describe('non-overlap across active HUD plates and M12 / M13 reserved bands', () => {
  it('never overlaps top-left, boss bar / door hint, top-right, skill strip, M12 XP bar, or M13 Dash/Active', () => {
    for (const maxHearts of [3, 6, 8, 12, 14]) {
      for (const skillCount of [0, 1, 4, 8]) {
        const combat = computeHudLayout({
          maxHearts,
          gold: 9999,
          roomLabel: '8/9',
          enemiesLeft: 64,
          skillCount,
        });

        // Combat mode regions (doorHint + top-left + top-right + skillStrip + M12 + M13)
        const combatRegions: ReadonlyArray<readonly [string, HudRect]> = [
          ['topLeft', combat.topLeft.plate],
          ['doorHint', combat.doorHint],
          ['topRight', combat.topRight.plate],
          ['skillStrip', combat.skillStrip.maxPlate],
          ['m12XpBar', combat.m12XpBar],
          ['m13DashActive', combat.m13DashActive],
        ];
        assertPairwiseSeparated(combatRegions, HUD_MIN_SEPARATION_PX);

        // Boss mode regions (bossBar + top-left + top-right + skillStrip + M12 + M13)
        const boss = computeHudLayout({
          maxHearts,
          gold: 9999,
          roomLabel: '9/9',
          enemiesLeft: null,
          skillCount,
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
    const layout = computeHudLayout();
    expect(layout.m12XpBar.centerX).toBe(0);
    expect(layout.m12XpBar.bottom).toBe(layout.safeArea.bottom);
    expect(hudRectInside(layout.m12XpBar, layout.safeArea)).toBe(true);

    expect(layout.m13DashActive.left).toBe(layout.safeArea.left);
    expect(layout.m13DashActive.bottom).toBe(layout.safeArea.bottom);
    expect(hudRectInside(layout.m13DashActive, layout.safeArea)).toBe(true);

    // Clear central gameplay window between top and bottom HUD bands.
    const combatWindowHeight = layout.topLeft.plate.bottom - layout.skillStrip.maxPlate.top;
    expect(combatWindowHeight).toBeGreaterThanOrEqual(160);
  });

  it('clamps off-screen edge arrows below top HUD plates and above the M12 XP bar', () => {
    const layout = computeHudLayout({ maxHearts: 6, enemiesLeft: 24 });
    // Arrow triangle tip reaches 7 px from its node centre.
    expect(layout.arrowLimits.top + 7).toBeLessThanOrEqual(layout.topLeft.plate.bottom);
    expect(layout.arrowLimits.top + 7).toBeLessThanOrEqual(layout.topRight.plate.bottom);
    expect(-layout.arrowLimits.bottom - 7).toBeGreaterThanOrEqual(layout.m12XpBar.top);
  });
});

describe('viewport scaling across 16:9, 16:10, 4:3, and ultrawide', () => {
  it.each(SUPPORTED_VIEWPORTS)(
    '$label ($width×$height): every HUD plate & M12/M13 band stays inside the room band and canvas',
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

      const layout = computeHudLayout({
        maxHearts: 8,
        gold: 4321,
        roomLabel: '9/9',
        enemiesLeft: 32,
        skillCount: 8,
      });

      const rects: ReadonlyArray<HudRect> = [
        layout.topLeft.plate,
        layout.bossBar.plate,
        layout.doorHint,
        layout.topRight.plate,
        layout.skillStrip.maxPlate,
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

      // Projected top-left, bossBar, top-right, skillStrip, M12, M13 remain non-overlapping in canvas px.
      const nonOverlappingCanvas: ReadonlyArray<readonly [string, HudRect]> = [
        ['topLeft', projected[0]!],
        ['bossBar', projected[1]!],
        ['topRight', projected[3]!],
        ['skillStrip', projected[4]!],
        ['m12XpBar', projected[5]!],
        ['m13DashActive', projected[6]!],
      ];
      assertPairwiseSeparated(nonOverlappingCanvas, 2);
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
  } {
    const maxHearts = vi.fn();
    const hearts = vi.fn();
    const enemiesLeft = vi.fn();
    const bossState = vi.fn();
    return {
      target: {
        setMaxHearts: maxHearts,
        setHearts: hearts,
        setEnemiesLeft: enemiesLeft,
        setBossState: bossState,
      },
      maxHearts,
      hearts,
      enemiesLeft,
      bossState,
    };
  }

  it('pushes initial state once on connect and performs 0 calls on unchanged frames', () => {
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

    // Simulate 120 unchanged frames: zero HUD setter calls.
    for (let frame = 0; frame < 120; frame += 1) {
      applyCombatHudSnapshot(mock.target, { ...initial });
    }
    expect(mock.maxHearts).toHaveBeenCalledTimes(1);
    expect(mock.hearts).toHaveBeenCalledTimes(1);
    expect(mock.enemiesLeft).toHaveBeenCalledTimes(1);
    expect(mock.bossState).toHaveBeenCalledTimes(1);
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
    });
  });

  it('re-syncs boss state if Hud was cleared directly between sync calls', () => {
    let liveBoss: string | null = null;
    const bossState = vi.fn((name: string | null) => {
      liveBoss = name;
    });
    const target: CombatHudTarget = {
      get activeBossName() {
        return liveBoss;
      },
      setMaxHearts: vi.fn(),
      setHearts: vi.fn(),
      setEnemiesLeft: vi.fn(),
      setBossState: bossState,
    };

    const snap: CombatHudSnapshot = {
      maxHearts: 6,
      hearts: 6,
      enemiesLeft: null,
      bossName: 'Tengu',
      bossHp: 120,
      bossMaxHp: 120,
      bossPhase: 1,
    };
    applyCombatHudSnapshot(target, snap);
    expect(bossState).toHaveBeenCalledTimes(1);

    // Direct `hud.setBoss(null)` on room transition invalidates cached snapshot.
    liveBoss = null;
    applyCombatHudSnapshot(target, snap);
    expect(bossState).toHaveBeenCalledTimes(2);
  });

  it('formats HUD text helpers deterministically', () => {
    expect(formatHudGoldText(0)).toBe('Gold 0');
    expect(formatHudGoldText(-5)).toBe('Gold 0');
    expect(formatHudGoldText(42.9)).toBe('Gold 42');
    expect(formatHudRoomText('1/9')).toBe('Room 1/9');
    expect(formatHudRoomText('Room 4/9')).toBe('Room 4/9');
    expect(formatHudRoomText('')).toBe('Room 1/9');
    expect(formatHudEnemiesText(17.8)).toBe('Enemies 17');
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
