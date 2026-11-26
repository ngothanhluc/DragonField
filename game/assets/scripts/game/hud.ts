/**
 * In-game HUD (M11 T4 + M12 T2 + M13 T1): high-contrast pixel backing plates + crisp pack icons,
 * anchored to the visible room band via `WorldCamera.hudScale`, with an event-driven bottom-centre
 * XP bar + `LV X` badge (`m12XpBar`), a 20-slot (10×2) bottom-right skill grid, and event-driven
 * bottom-left Dash (`SPACE`) + Signature Active (`E`) cooldown widgets (`m13DashActive`).
 *
 * Real UI (`Canvas` + `UI_2D` camera), laid out in 512×288 design pixels via pure geometry in
 * `core/view/hud-layout.ts`.
 */
import {
  _decorator,
  Color as CocosColor,
  Component,
  Graphics as CocosGraphics,
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  view,
} from 'cc';
import { loadPixelTexture } from './assets/texture-cache';
import { cachedSkillIcon, loadSkillIcon, SKILL_ICON_SIZE_PX } from './assets/skill-icon';
import type { OwnedSkillStacks } from '../core/skills/pool';
import { skillAbbreviation } from '../core/skills/description';
import type { Vec2 } from '../core/math/vec2';
import type { DoorReward } from '../core/run/doors';
import {
  HUD_ACTION_KEY_FONT_SIZE,
  HUD_ACTION_KEY_LINE_HEIGHT,
  HUD_ACTION_STATUS_FONT_SIZE,
  HUD_ACTION_STATUS_LINE_HEIGHT,
  HUD_BOSS_BAR_HEIGHT_PX,
  HUD_BOSS_BAR_WIDTH_PX,
  HUD_BOSS_TITLE_FONT_SIZE,
  HUD_BOSS_TITLE_LINE_HEIGHT,
  HUD_DESIGN_HEIGHT,
  HUD_DESIGN_WIDTH,
  HUD_ENEMY_ICON_SIZE_PX,
  HUD_GOLD_ICON_SIZE_PX,
  HUD_GOLD_ICON_SOURCE_PX,
  HUD_HEART_SIZE_PX,
  HUD_LABEL_FONT_SIZE,
  HUD_LABEL_LINE_HEIGHT,
  HUD_PLATE_SLICE_INSETS,
  HUD_ROOM_ICON_SIZE_PX,
  HUD_SKILL_SLOTS,
  HUD_XP_LEVEL_FONT_SIZE,
  HUD_XP_LEVEL_LINE_HEIGHT,
  HUD_XP_PROGRESS_FONT_SIZE,
  HUD_XP_PROGRESS_LINE_HEIGHT,
  computeHudActionReadyRatio,
  computeHudLayout,
  computeHudXpFillRatio,
  formatHudActionStatusText,
  formatHudLevelText,
  formatHudXpProgressText,
  isHudActionReady,
  type HudActionSlotLayout,
  type HudArrowLimits,
  type HudLayout,
  type HudRect,
} from '../core/view/hud-layout';
import { ICONS, loadRewardIconFrame } from './door-view';
import { applyPixelFont } from './ui-font';
import { sliceFrame } from './level-view';
import type { TileRect } from './level-view';

const { ccclass } = _decorator;

/** `cc` is an any module in this repo: types must be derived from the import value (see `texture-cache.ts`). */
type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Label = InstanceType<typeof CocosLabel>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** `Heart.png` 80×16 = 5 states of 16×16 laid out horizontally, empty → full (import-checklist §3.5). */
export const HEART_SHEET = 'resources/art/ui/Heart.png';
/** Pack `Items/Treasure/GoldCoin.png` (7×7), rendered at 2× (14×14) with NEAREST filtering. */
export const GOLD_COIN_SHEET = 'resources/art/ui/coin/GoldCoin.png';
/** Pack `Ui/Arrow.png` (13×13), rendered at 1× and rotated right (`▶`) for the room counter. */
export const ROOM_ICON_SHEET = 'resources/art/ui/Arrow.png';
/** Pack skull monster frame `(0, 0, 16, 16)`, rendered at 1× for the enemies-remaining counter. */
export const ENEMY_ICON_SHEET = 'resources/art/monsters/skull-blue/SpriteSheet.png';
/** Flat-centre Theme Wood 9-slice (`nine_path_panel_interior.png`, 16×16) — stretches without double frames. */
export const HUD_PLATE_SHEET = 'resources/art/ui/theme-wood/nine_path_panel_interior.png';

/** Boss health bar background — reuses the pack's wooden button, tinted per state. */
const BAR_SHEET = 'resources/art/ui/theme-wood/button_normal.png';
const BAR_RECT: TileRect = { x: 0, y: 0, width: 16, height: 8 };
const PLATE_RECT: TileRect = { x: 0, y: 0, width: 16, height: 16 };
const GOLD_COIN_RECT: TileRect = {
  x: 0,
  y: 0,
  width: HUD_GOLD_ICON_SOURCE_PX,
  height: HUD_GOLD_ICON_SOURCE_PX,
};
const ROOM_ICON_RECT: TileRect = {
  x: 0,
  y: 0,
  width: HUD_ROOM_ICON_SIZE_PX,
  height: HUD_ROOM_ICON_SIZE_PX,
};
const ENEMY_ICON_RECT: TileRect = {
  x: 0,
  y: 0,
  width: HUD_ENEMY_ICON_SIZE_PX,
  height: HUD_ENEMY_ICON_SIZE_PX,
};

/** State 0 = empty heart (grey); state 4 = full heart (red). */
const HEART_EMPTY_INDEX = 0;
const HEART_FULL_INDEX = 4;

const TEXT_COLOR = new CocosColor(255, 255, 255, 255);
const GOLD_TEXT_COLOR = new CocosColor(255, 234, 142, 255);
const ENEMY_TEXT_COLOR = new CocosColor(255, 244, 232, 255);
/** 1 px dark outline so every HUD label reads cleanly even before/beyond plate contrast. */
const TEXT_OUTLINE_COLOR = new CocosColor(12, 10, 16, 255);
const DEFAULT_LABEL_FONT_SIZE = 12;

/**
 * High-contrast dark tint over `nine_path_panel_interior` `(155, 81, 60)` → deep espresso-slate
 * `(~27, 17, 16, 232)` + 1 px warm-wood outer accent stroke on its own `Graphics` node.
 */
const PLATE_TINT = new CocosColor(44, 52, 68, 232);
const PLATE_BORDER_COLOR = new CocosColor(196, 152, 96, 215);

/**
 * M12 XP bar & level badge colours (AGENTS.md rule: strictly ONE `Graphics` node per colour).
 */
const XP_BADGE_BG_COLOR = new CocosColor(24, 20, 16, 240);
const XP_BADGE_BORDER_COLOR = new CocosColor(232, 190, 96, 235);
const XP_TRACK_BG_COLOR = new CocosColor(16, 22, 32, 245);
const XP_TRACK_BORDER_COLOR = new CocosColor(78, 112, 140, 225);
const XP_FILL_CYAN_COLOR = new CocosColor(68, 218, 255, 255);
const XP_FILL_HIGHLIGHT_COLOR = new CocosColor(196, 248, 255, 235);
const XP_FILL_FULL_GOLD_COLOR = new CocosColor(255, 214, 92, 255);

/**
 * M13 Dash (`SPACE`) & Signature Active (`E`) widget colours (strictly ONE `Graphics` node per
 * colour, drawn once at `init` and toggled via `.active` / `setScale`).
 */
const ACTION_BADGE_BG_COLOR = new CocosColor(20, 22, 30, 242);
const ACTION_BADGE_CD_BORDER_COLOR = new CocosColor(88, 98, 118, 215);
const DASH_BADGE_READY_BORDER_COLOR = new CocosColor(92, 226, 255, 240);
const ACTIVE_BADGE_READY_BORDER_COLOR = new CocosColor(216, 152, 255, 240);
const ACTION_TRACK_BG_COLOR = new CocosColor(14, 18, 28, 245);
const ACTION_TRACK_BORDER_COLOR = new CocosColor(72, 96, 124, 220);

const DASH_FILL_CD_COLOR = new CocosColor(54, 164, 224, 240);
const DASH_FILL_READY_COLOR = new CocosColor(84, 242, 228, 255);
const DASH_FILL_SHINE_COLOR = new CocosColor(210, 255, 252, 235);

const ACTIVE_FILL_CD_COLOR = new CocosColor(152, 92, 232, 240);
const ACTIVE_FILL_READY_COLOR = new CocosColor(214, 126, 255, 255);
const ACTIVE_FILL_SHINE_COLOR = new CocosColor(246, 220, 255, 235);

const ACTION_KEY_CD_COLOR = new CocosColor(178, 190, 208, 255);
const ACTION_STATUS_CD_COLOR = new CocosColor(214, 224, 238, 255);
const DASH_READY_TEXT_COLOR = new CocosColor(224, 255, 252, 255);
const ACTIVE_READY_TEXT_COLOR = new CocosColor(248, 228, 255, 255);

/** Rarity colours shared by skill cards and the HUD skill row. */
export const RARITY_COLORS = {
  common: new CocosColor(222, 222, 222, 255),
  rare: new CocosColor(110, 170, 255, 255),
  epic: new CocosColor(200, 140, 255, 255),
} as const;

/** One HUD skill slot: icon + rarity frame + stack count, with the abbreviation as load fallback. */
interface SkillSlot {
  readonly root: Node;
  readonly icon: Node;
  readonly frame: Graphics;
  readonly stack: Label;
  readonly fallback: Label;
  /** Skill id this slot currently shows; guards async icon loads against a stale slot. */
  id: string;
  stacks: number;
}

/**
 * One door arrow (#63): the triangle turns to the heading while the reward icon between the arrow
 * and the screen centre stays upright.
 */
interface DoorArrowSlot {
  readonly root: Node;
  readonly triangle: Node;
  readonly icon: Sprite;
  /** Reward whose icon this slot shows (or is loading); async loads compare against it. */
  shownReward: DoorReward | null;
}

/** Reusable 9-slice dark plate + 1 px pixel border (sibling nodes, never label ancestors). */
interface HudPlateHandle {
  readonly root: Node;
  setRect(rect: HudRect): void;
  setActive(active: boolean): void;
}

/** Pre-built nodes for one M13 cooldown row (`Dash` or `Signature Active`). */
interface ActionWidgetSlot {
  readonly keyReadyBorder: Node;
  readonly keyCooldownBorder: Node;
  readonly fillRoot: Node;
  readonly fillReadyGroup: Node;
  readonly fillCooldownNode: Node;
  readonly keyLabel: Label;
  readonly statusLabel: Label;
  readonly readyTextColor: Color;
  shownRatio: number;
  shownReady: boolean | null;
  shownStatusText: string;
}

const BOSS_FILL_COLOR = new CocosColor(232, 74, 74, 255);
const BOSS_BG_COLOR = new CocosColor(44, 30, 30, 255);

/** Design px per world tile: the HUD band is scaled to the world band, which shows 32×18 tiles. */
const HUD_PX_PER_TILE = 16;
/** At most three arrows (#41): the nearest off-screen enemies, or the doors once clear. */
export const MAX_EDGE_ARROWS = 3;
const ARROW_FILL = new CocosColor(255, 233, 170, 235);
const ARROW_OUTLINE = new CocosColor(20, 16, 24, 220);
/**
 * Door arrows (#63) are cyan, so a "walk to a door" arrow never reads as an enemy arrow, and each
 * one carries its door's reward icon: the shape alone already says what it points at.
 */
const DOOR_ARROW_FILL = new CocosColor(130, 230, 255, 240);
const DOOR_ARROW_OUTLINE = new CocosColor(8, 24, 40, 230);
/** Reward icon beside the arrow, design px (24 px pack art at half size stays crisp). */
const DOOR_ARROW_ICON_PX = 12;
/** Icon sits this far behind the arrow's tail, so it never covers the triangle. */
const DOOR_ARROW_ICON_INSET_PX = 13;

/** One door arrow for `setDoorArrows`: offset from the camera centre (tiles, y down) + reward. */
export interface DoorArrowOffset {
  readonly x: number;
  readonly y: number;
  readonly reward: DoorReward;
}

/**
 * Format the room counter with optional compact Ascension (`A<n>`) and Endless (`E<n>`) badges
 * (M15) while keeping Normal runs identical (`1/9` → `Room 1/9`). Sized so `Room 9/9 A5 E9`
 * fits inside the top-right plate clear of the Boss bar at 512×288 design resolution.
 */
export function formatRunRoomLabel(
  roomLabel: string,
  ascension = 0,
  endlessLoop = 0,
): string {
  const tags: string[] = [];
  if (Number.isFinite(ascension) && ascension >= 1) {
    tags.push(`A${Math.floor(ascension)}`);
  }
  if (Number.isFinite(endlessLoop) && endlessLoop >= 1) {
    tags.push(`E${Math.floor(endlessLoop)}`);
  }
  return tags.length === 0 ? roomLabel : `${roomLabel} ${tags.join(' ')}`;
}

function heartRect(index: number): TileRect {
  return {
    x: index * HUD_HEART_SIZE_PX,
    y: 0,
    width: HUD_HEART_SIZE_PX,
    height: HUD_HEART_SIZE_PX,
  };
}

@ccclass('Hud')
export class Hud extends Component {
  private readonly heartNodes: Node[] = [];
  private maxHeartNodes = 0;
  private lastHearts = 0;
  private frames: {
    readonly full: SpriteFrame;
    readonly empty: SpriteFrame;
    readonly plate: SpriteFrame;
  } | null = null;

  private topLeftRoot: Node | null = null;
  private topLeftPlate: HudPlateHandle | null = null;
  private goldIconNode: Node | null = null;
  private goldLabel: Label | null = null;
  private goldIconPos: Vec2 = { x: 0, y: 0 };

  private topRightRoot: Node | null = null;
  private topRightPlate: HudPlateHandle | null = null;
  private roomIconNode: Node | null = null;
  private roomLabel: Label | null = null;
  private enemyIconNode: Node | null = null;
  private enemiesLeftLabel: Label | null = null;

  private shownHearts = -1;
  private shownRoomRaw = '';
  private shownGold = -1;
  private shownEnemiesLeft: number | null | undefined = undefined;
  private cachedArrowLimits: HudArrowLimits = {
    halfWidth: HUD_DESIGN_WIDTH / 2 - 14,
    top: HUD_DESIGN_HEIGHT / 2 - 59,
    bottom: HUD_DESIGN_HEIGHT / 2 - 32,
  };

  /** M12 bottom-centre XP bar + `LV X` badge: event-driven, zero per-frame geometry rebuilds. */
  private xpRoot: Node | null = null;
  private xpFillRoot: Node | null = null;
  private xpFillCyanNode: Node | null = null;
  private xpFillGoldNode: Node | null = null;
  private xpLevelLabel: Label | null = null;
  private xpProgressLabel: Label | null = null;
  private shownXpLevel = -1;
  private shownXpCurrent = Number.NaN;
  private shownXpRequired = Number.NaN;
  private shownXpLevelText = '';
  private shownXpProgressText = '';
  private shownXpRatio = -1;

  /** M13 bottom-left Dash (`SPACE`) + Signature Active (`E`) cooldown widgets. */
  private actionsRoot: Node | null = null;
  private dashSlot: ActionWidgetSlot | null = null;
  private activeSlot: ActionWidgetSlot | null = null;
  private shownDashReadyRatio = Number.NaN;
  private shownDashCooldownSec = Number.NaN;
  private shownActiveReadyRatio = Number.NaN;
  private shownActiveCooldownSec = Number.NaN;

  /** HUD skill slots (up to 20 in a 10×2 grid): icon + stack, framed by rarity. */
  private readonly skillSlots: SkillSlot[] = [];
  private skillStripPlate: HudPlateHandle | null = null;
  private shownSkillCount = -1;
  private shownExtraSkills = -1;

  /** Boss health bar: backing plate + background + fill (left anchor) + name/phase label. */
  private bossRoot: Node | null = null;
  private bossFill: Node | null = null;
  private bossTitle: Label | null = null;
  private shownBossName: string | null = null;
  private shownBossPhase = -1;
  private shownBossHp = -1;
  private shownBossMaxHp = -1;

  /** #41: border arrows. */
  private readonly arrowNodes: Node[] = [];

  /** #63: off-screen door arrows (own colour + reward icon) and the "choose a door" hint. */
  private readonly doorArrowSlots: DoorArrowSlot[] = [];
  private doorHintRoot: Node | null = null;
  private shownDoorHint = false;

  /**
   * Build the HUD. This `node` must be a child of a `Canvas` (created by bootstrap), or
   * nothing will be drawn.
   */
  async init(maxHearts: number, roomText: string): Promise<void> {
    const [
      heartTexture,
      barTexture,
      plateTexture,
      goldCoinTexture,
      roomIconTexture,
      enemyIconTexture,
    ] = await Promise.all([
      loadPixelTexture(HEART_SHEET),
      loadPixelTexture(BAR_SHEET),
      loadPixelTexture(HUD_PLATE_SHEET),
      loadPixelTexture(GOLD_COIN_SHEET),
      loadPixelTexture(ROOM_ICON_SHEET),
      loadPixelTexture(ENEMY_ICON_SHEET),
    ]);

    const plateFrame = sliceSlicedFrame(plateTexture, PLATE_RECT, HUD_PLATE_SLICE_INSETS);
    this.frames = {
      full: sliceFrame(heartTexture, heartRect(HEART_FULL_INDEX)),
      empty: sliceFrame(heartTexture, heartRect(HEART_EMPTY_INDEX)),
      plate: plateFrame,
    };

    const barFrame = sliceFrame(barTexture, BAR_RECT);
    const goldCoinFrame = sliceFrame(goldCoinTexture, GOLD_COIN_RECT);
    const roomIconFrame = sliceFrame(roomIconTexture, ROOM_ICON_RECT);
    const enemyIconFrame = sliceFrame(enemyIconTexture, ENEMY_ICON_RECT);

    const layout = this.computeLayout(maxHearts, 0, roomText, null, 0);
    this.cachedArrowLimits = layout.arrowLimits;

    this.createTopLeftGroup(goldCoinFrame, plateFrame, maxHearts, layout);
    this.createTopRightGroup(roomIconFrame, enemyIconFrame, plateFrame, layout);
    this.createDashActiveGroup(plateFrame, layout);
    this.createXpBar(plateFrame, layout);
    this.createSkillRow(plateFrame, layout);
    this.createBossBar(barFrame, plateFrame, layout);
    this.createArrows();
    this.createDoorArrows();
    this.createDoorHint(plateFrame, layout);

    this.setRoomLabel(roomText);
    this.setHearts(maxHearts);
    this.setGold(0);
    this.setEnemiesLeft(null);
    this.setXp(1, 0, 0);
    this.setActions(1, 0, 1, 0);
    this.setSkills([]);
  }

  /** Update the heart row; spriteFrame only changes when the heart count really changes. */
  setHearts(hearts: number): void {
    const frames = this.frames;
    if (frames === null || hearts === this.shownHearts) return;
    this.shownHearts = hearts;
    this.lastHearts = hearts;

    for (let index = 0; index < this.heartNodes.length; index += 1) {
      const node = this.heartNodes[index];
      if (node === undefined) continue;
      const sprite: Sprite | null = node.getComponent(CocosSprite);
      if (sprite === null) continue;
      const visible = index < this.maxHeartNodes;
      if (node.active !== visible) node.active = visible;
      if (visible) {
        sprite.spriteFrame = index < hearts ? frames.full : frames.empty;
      }
    }
  }

  /** Vitality can raise the cap mid-run: add heart slots and resize the top-left plate cleanly. */
  setMaxHearts(maxHearts: number): void {
    const frames = this.frames;
    const clamped = Math.max(0, Math.floor(maxHearts));
    if (frames === null || clamped === this.maxHeartNodes) return;

    this.maxHeartNodes = clamped;
    this.ensureHeartNodes(clamped);
    this.applyTopLeftLayout();
    // Force a redraw: the slot count changed even if current hearts stayed the same.
    this.shownHearts = -1;
    this.setHearts(this.lastHearts);
  }

  /** The `3/9` label from `RunState.roomLabel`, shown with a crisp room pointer icon. */
  setRoomLabel(text: string): void {
    const label = this.roomLabel;
    if (label === null || text === this.shownRoomRaw) return;
    this.shownRoomRaw = text;
    this.applyTopRightLayout();
  }

  /**
   * Gold icon position in canvas design pixels (already multiplied by `hudScale`) — coins
   * fly from the world directly onto the HUD `GoldCoin` icon (see `feel-view.ts`).
   */
  goldAnchor(): Vec2 {
    const scale = this.node.scale.x;
    return { x: this.goldIconPos.x * scale, y: this.goldIconPos.y * scale };
  }

  /** Gold earned in the run (M5); the shop shows the save total. */
  setGold(gold: number): void {
    const label = this.goldLabel;
    const clamped = Number.isFinite(gold) ? Math.max(0, Math.floor(gold)) : 0;
    if (label === null || clamped === this.shownGold) return;
    const prevDigits = this.shownGold >= 0 ? String(this.shownGold).length : 0;
    const nextDigits = String(clamped).length;
    this.shownGold = clamped;
    label.string = `Gold ${clamped}`;
    // Only recompute plate bounds when crossing 5+ digit gold (`Gold 10000+`).
    if (prevDigits !== nextDigits && (prevDigits >= 5 || nextDigits >= 5)) {
      this.applyTopLeftLayout();
    }
  }

  /** Current XP state displayed on the HUD, exposed for `hud-sync` coherence checks. */
  get activeXpLevel(): number {
    return this.shownXpLevel;
  }

  get activeXpCurrent(): number {
    return this.shownXpCurrent;
  }

  get activeXpRequired(): number {
    return this.shownXpRequired;
  }

  /**
   * Event-driven XP bar + `LV X` badge setter (M12 T2).
   *
   * Skips label/scale updates whenever `(level, currentXp, requiredXp)` is unchanged; when XP
   * advances within a level, only the fill bar scale and compact progress string update.
   */
  setXp(level: number, currentXp: number, requiredXp: number): void {
    if (this.xpRoot === null) return;
    if (
      Object.is(level, this.shownXpLevel) &&
      Object.is(currentXp, this.shownXpCurrent) &&
      Object.is(requiredXp, this.shownXpRequired)
    ) {
      return;
    }

    this.shownXpLevel = level;
    this.shownXpCurrent = currentXp;
    this.shownXpRequired = requiredXp;

    const levelText = formatHudLevelText(level);
    if (levelText !== this.shownXpLevelText) {
      this.shownXpLevelText = levelText;
      if (this.xpLevelLabel !== null) {
        this.xpLevelLabel.string = levelText;
      }
    }

    const ratio = computeHudXpFillRatio(currentXp, requiredXp);
    if (ratio !== this.shownXpRatio) {
      this.shownXpRatio = ratio;
      const fill = this.xpFillRoot;
      if (fill !== null) {
        if (ratio <= 0) {
          if (fill.active) fill.active = false;
        } else {
          if (!fill.active) fill.active = true;
          fill.setScale(ratio, 1, 1);
          const isFull = ratio >= 1;
          if (this.xpFillCyanNode !== null && this.xpFillCyanNode.active !== !isFull) {
            this.xpFillCyanNode.active = !isFull;
          }
          if (this.xpFillGoldNode !== null && this.xpFillGoldNode.active !== isFull) {
            this.xpFillGoldNode.active = isFull;
          }
        }
      }
    }

    const progressText = formatHudXpProgressText(currentXp, requiredXp);
    if (progressText !== this.shownXpProgressText) {
      this.shownXpProgressText = progressText;
      if (this.xpProgressLabel !== null) {
        this.xpProgressLabel.string = progressText;
        const visible = progressText !== '';
        if (this.xpProgressLabel.node.active !== visible) {
          this.xpProgressLabel.node.active = visible;
        }
      }
    }
  }

  /** Current M13 Dash & Signature Active state displayed on the HUD (`hud-sync` coherence). */
  get activeDashReadyRatio(): number {
    return this.shownDashReadyRatio;
  }

  get activeDashCooldownSec(): number {
    return this.shownDashCooldownSec;
  }

  get activeSkillReadyRatio(): number {
    return this.shownActiveReadyRatio;
  }

  get activeSkillCooldownSec(): number {
    return this.shownActiveCooldownSec;
  }

  /**
   * Event-driven M13 Dash (`SPACE`) & Signature Active (`E`) cooldown setter.
   *
   * Skips updates whenever inputs match the previous call, scales left-anchored fill nodes without
   * redrawing `Graphics`, and reassigns `Label.string` only when the formatted countdown tenths or
   * `'READY'` state actually changes.
   */
  setActions(
    dashReadyRatio: number,
    dashCooldownSec: number,
    activeReadyRatio: number,
    activeCooldownSec: number,
  ): void {
    if (this.actionsRoot === null) return;

    const dashSame =
      Object.is(dashReadyRatio, this.shownDashReadyRatio) &&
      Object.is(dashCooldownSec, this.shownDashCooldownSec);
    const activeSame =
      Object.is(activeReadyRatio, this.shownActiveReadyRatio) &&
      Object.is(activeCooldownSec, this.shownActiveCooldownSec);
    if (dashSame && activeSame) return;

    if (!dashSame) {
      this.shownDashReadyRatio = dashReadyRatio;
      this.shownDashCooldownSec = dashCooldownSec;
      if (this.dashSlot !== null) {
        updateActionWidgetSlot(this.dashSlot, dashReadyRatio, dashCooldownSec);
      }
    }

    if (!activeSame) {
      this.shownActiveReadyRatio = activeReadyRatio;
      this.shownActiveCooldownSec = activeCooldownSec;
      if (this.activeSlot !== null) {
        updateActionWidgetSlot(this.activeSlot, activeReadyRatio, activeCooldownSec);
      }
    }
  }

  /**
   * Skills picked up: icon + stack count (up to 20 distinct slots in a 10×2 grid), framed by rarity
   * inside a compact bottom-right plate above M12's XP bar and clear of M13's Dash/Active band.
   */
  setSkills(entries: readonly OwnedSkillStacks[]): void {
    const shownCount = Math.min(HUD_SKILL_SLOTS, entries.length);
    const hasOverflow = entries.length > HUD_SKILL_SLOTS;
    const extra = hasOverflow ? entries.length - (HUD_SKILL_SLOTS - 1) : 0;
    if (this.skillsMatch(entries, shownCount, extra)) return;

    const countChanged = shownCount !== this.shownSkillCount;
    this.shownSkillCount = shownCount;
    this.shownExtraSkills = extra;

    if (countChanged) {
      const layout = this.computeLayout(
        this.maxHeartNodes,
        Math.max(0, this.shownGold),
        this.shownRoomRaw || '1/9',
        this.shownEnemiesLeft ?? null,
        shownCount,
      );
      if (layout.skillStrip.activePlate === null) {
        this.skillStripPlate?.setActive(false);
      } else {
        this.skillStripPlate?.setRect(layout.skillStrip.activePlate);
        this.skillStripPlate?.setActive(true);
      }
      for (let index = 0; index < this.skillSlots.length; index += 1) {
        const slot = this.skillSlots[index];
        const pos = layout.skillStrip.slotCenters[index];
        if (slot !== undefined && pos !== undefined) {
          slot.root.setPosition(pos.x, pos.y, 0);
        }
      }
    }

    for (let index = 0; index < this.skillSlots.length; index += 1) {
      const slot = this.skillSlots[index];
      if (slot === undefined) continue;

      if (extra > 0 && index === HUD_SKILL_SLOTS - 1) {
        slot.id = '';
        slot.stacks = -extra;
        slot.root.active = true;
        slot.icon.active = false;
        slot.stack.string = '';
        slot.fallback.string = `+${extra}`;
        slot.fallback.color = TEXT_COLOR;
        slot.fallback.node.active = true;
        drawSkillFrame(slot.frame, TEXT_COLOR);
        continue;
      }

      const entry = index < shownCount ? entries[index] : undefined;
      if (entry === undefined) {
        slot.id = '';
        slot.stacks = 0;
        slot.root.active = false;
        continue;
      }

      const color = RARITY_COLORS[entry.def.rarity];
      slot.id = entry.def.id;
      slot.stacks = entry.stacks;
      slot.root.active = true;
      slot.stack.string = entry.stacks > 1 ? String(entry.stacks) : '';
      slot.stack.color = TEXT_COLOR;
      slot.fallback.string = skillAbbreviation(entry.def);
      slot.fallback.color = color;
      drawSkillFrame(slot.frame, color);

      const ready = cachedSkillIcon(entry.def.id);
      if (ready !== undefined) {
        slot.icon.active = true;
        slot.fallback.node.active = false;
        const sprite: Sprite | null = slot.icon.getComponent(CocosSprite);
        if (sprite !== null) sprite.spriteFrame = ready;
        continue;
      }

      slot.icon.active = false;
      slot.fallback.node.active = true;
      void loadSkillIcon(entry.def.id)
        .then((frame) => {
          if (slot.id !== entry.def.id || !slot.root.isValid) return;
          const sprite: Sprite | null = slot.icon.getComponent(CocosSprite);
          if (sprite === null) return;
          sprite.spriteFrame = frame;
          slot.icon.active = true;
          slot.fallback.node.active = false;
        })
        .catch(() => {
          if (slot.id !== entry.def.id) return;
          slot.icon.active = false;
          slot.fallback.node.active = true;
        });
    }
  }

  /**
   * Enemies left in the room (#41): alive + not yet spawned. `null` hides the second row and
   * shrinks the top-right backing plate cleanly (boss rooms, special rooms, menus).
   */
  setEnemiesLeft(count: number | null): void {
    const label = this.enemiesLeftLabel;
    if (label === null) return;

    const normalized = count === null ? null : Math.max(0, Math.floor(count));
    if (normalized === this.shownEnemiesLeft) return;

    const prevHasRow = this.shownEnemiesLeft !== null && this.shownEnemiesLeft !== undefined;
    const nextHasRow = normalized !== null;
    const prevDigits =
      typeof this.shownEnemiesLeft === 'number' ? String(this.shownEnemiesLeft).length : 0;
    const nextDigits = normalized !== null ? String(normalized).length : 0;

    this.shownEnemiesLeft = normalized;

    if (normalized === null) {
      label.string = '';
      label.node.active = false;
      if (this.enemyIconNode !== null) this.enemyIconNode.active = false;
    } else {
      label.string = `Enemies ${normalized}`;
      label.node.active = true;
      if (this.enemyIconNode !== null) this.enemyIconNode.active = true;
    }

    if (
      prevHasRow !== nextHasRow ||
      (prevDigits !== nextDigits && (prevDigits >= 3 || nextDigits >= 3))
    ) {
      this.applyTopRightLayout();
    }
  }

  /**
   * Border arrows (#41). Each entry is a target position **relative to the camera centre** in room
   * tiles (y down). Clamped to `arrowLimits` so arrows never land on top of HUD plates.
   */
  setArrows(offsets: readonly Vec2[]): void {
    const limits = this.cachedArrowLimits;

    for (let index = 0; index < this.arrowNodes.length; index += 1) {
      const node = this.arrowNodes[index];
      if (node === undefined) continue;
      const offset = offsets[index];
      if (offset === undefined) {
        if (node.active) node.active = false;
        continue;
      }

      node.angle = this.placeArrow(node, offset, limits);
      if (!node.active) node.active = true;
    }

    for (const slot of this.doorArrowSlots) {
      if (slot.root.active) slot.root.active = false;
    }
  }

  /**
   * Door arrows after a clear (#63): cyan triangles + upright reward icons clamped to `arrowLimits`.
   */
  setDoorArrows(targets: readonly DoorArrowOffset[]): void {
    const limits = this.cachedArrowLimits;

    for (let index = 0; index < this.doorArrowSlots.length; index += 1) {
      const slot = this.doorArrowSlots[index];
      if (slot === undefined) continue;
      const target = targets[index];
      if (target === undefined) {
        if (slot.root.active) slot.root.active = false;
        continue;
      }

      const angle = this.placeArrow(slot.root, target, limits);
      slot.triangle.angle = angle;
      const radians = (angle * Math.PI) / 180;
      slot.icon.node.setPosition(
        -Math.cos(radians) * DOOR_ARROW_ICON_INSET_PX,
        -Math.sin(radians) * DOOR_ARROW_ICON_INSET_PX,
        0,
      );
      this.showDoorArrowIcon(slot, target.reward);
      if (!slot.root.active) slot.root.active = true;
    }

    for (const node of this.arrowNodes) {
      if (node.active) node.active = false;
    }
  }

  /** "Choose a door" hint after the clear (#63). Bootstrap decides the timing from tuning. */
  setDoorHint(visible: boolean): void {
    const root = this.doorHintRoot;
    if (root === null || visible === this.shownDoorHint) return;
    this.shownDoorHint = visible;
    root.active = visible;
  }

  /** Boss name currently displayed on the HUD (`null` when hidden), for `hud-sync` coherence. */
  get activeBossName(): string | null {
    return this.shownBossName;
  }

  /** Show/hide the boss health bar (`info === null` hides it). */
  setBoss(
    info: {
      readonly name: string;
      readonly hp: number;
      readonly maxHp: number;
      readonly phase: number;
    } | null,
  ): void {
    if (info === null) {
      this.setBossState(null, 0, 0, 0);
      return;
    }
    this.setBossState(info.name, info.hp, info.maxHp, info.phase);
  }

  /**
   * Zero-allocation scalar boss setter for `hud-sync`: skips label rebuilds and `setScale` calls
   * whenever `(name, hp, maxHp, phase)` is unchanged from the previous event/frame.
   */
  setBossState(name: string | null, hp: number, maxHp: number, phase: number): void {
    const root = this.bossRoot;
    const fill = this.bossFill;
    if (root === null || fill === null) return;

    if (name === null) {
      if (root.active) root.active = false;
      this.shownBossName = null;
      this.shownBossPhase = -1;
      this.shownBossHp = -1;
      this.shownBossMaxHp = -1;
      return;
    }

    if (!root.active) root.active = true;

    if (name !== this.shownBossName || phase !== this.shownBossPhase) {
      this.shownBossName = name;
      this.shownBossPhase = phase;
      if (this.bossTitle !== null) {
        this.bossTitle.string = `${name}  ·  PHASE ${phase}`;
      }
    }

    if (hp !== this.shownBossHp || maxHp !== this.shownBossMaxHp) {
      this.shownBossHp = hp;
      this.shownBossMaxHp = maxHp;
      const fraction = maxHp > 0 ? Math.min(1, Math.max(0, hp / maxHp)) : 0;
      fill.setScale(fraction, 1, 1);
    }
  }

  /** Fast check avoiding array/string allocation when `setSkills` is called with identical state. */
  private skillsMatch(
    entries: readonly OwnedSkillStacks[],
    shownCount: number,
    extra: number,
  ): boolean {
    if (shownCount !== this.shownSkillCount || extra !== this.shownExtraSkills) return false;
    const compareCount = extra > 0 ? HUD_SKILL_SLOTS - 1 : shownCount;
    for (let index = 0; index < compareCount; index += 1) {
      const slot = this.skillSlots[index];
      const entry = entries[index];
      if (slot === undefined || entry === undefined) return false;
      if (slot.id !== entry.def.id || slot.stacks !== entry.stacks) return false;
    }
    return true;
  }

  private computeLayout(
    maxHearts: number,
    gold: number,
    roomLabel: string,
    enemiesLeft: number | null,
    skillCount: number,
  ): HudLayout {
    const visible = view.getVisibleSize();
    return computeHudLayout({
      designWidth: visible.width > 0 ? visible.width : HUD_DESIGN_WIDTH,
      designHeight: visible.height > 0 ? visible.height : HUD_DESIGN_HEIGHT,
      maxHearts,
      gold,
      roomLabel,
      enemiesLeft,
      skillCount,
    });
  }

  private createTopLeftGroup(
    goldCoinFrame: SpriteFrame,
    plateFrame: SpriteFrame,
    maxHearts: number,
    layout: HudLayout,
  ): void {
    const group = new CocosNode('hud-top-left');
    group.layer = Layers.Enum.UI_2D;
    group.parent = this.node;
    this.topLeftRoot = group;

    this.topLeftPlate = createHudPlate(group, 'top-left-plate', plateFrame, layout.topLeft.plate);

    this.maxHeartNodes = Math.max(0, Math.floor(maxHearts));
    this.ensureHeartNodes(this.maxHeartNodes);

    const goldIcon = makePixelSprite(
      group,
      'gold-icon',
      goldCoinFrame,
      HUD_GOLD_ICON_SIZE_PX,
      HUD_GOLD_ICON_SIZE_PX,
    );
    this.goldIconNode = goldIcon;

    const goldLabel = createStyledLabel(
      group,
      'gold-label',
      layout.topLeft.goldText,
      HUD_LABEL_FONT_SIZE,
      HUD_LABEL_LINE_HEIGHT,
      GOLD_TEXT_COLOR,
    );
    const goldTransform: UITransform | null = goldLabel.node.getComponent(CocosUITransform);
    if (goldTransform !== null) goldTransform.setAnchorPoint(0, 0.5);
    this.goldLabel = goldLabel;

    this.positionTopLeftChildren(layout);
  }

  private applyTopLeftLayout(): void {
    const layout = this.computeLayout(
      this.maxHeartNodes,
      Math.max(0, this.shownGold),
      this.shownRoomRaw || '1/9',
      this.shownEnemiesLeft ?? null,
      Math.max(0, this.shownSkillCount),
    );
    this.cachedArrowLimits = layout.arrowLimits;
    this.positionTopLeftChildren(layout);
  }

  private positionTopLeftChildren(layout: HudLayout): void {
    this.topLeftPlate?.setRect(layout.topLeft.plate);
    for (let index = 0; index < layout.topLeft.hearts.length; index += 1) {
      const node = this.heartNodes[index];
      const pos = layout.topLeft.hearts[index];
      if (node !== undefined && pos !== undefined) {
        node.setPosition(pos.x, pos.y, 0);
      }
    }
    this.goldIconPos = layout.topLeft.goldIcon;
    this.goldIconNode?.setPosition(layout.topLeft.goldIcon.x, layout.topLeft.goldIcon.y, 0);
    this.goldLabel?.node.setPosition(layout.topLeft.goldLabel.x, layout.topLeft.goldLabel.y, 0);
  }

  private createTopRightGroup(
    roomIconFrame: SpriteFrame,
    enemyIconFrame: SpriteFrame,
    plateFrame: SpriteFrame,
    layout: HudLayout,
  ): void {
    const group = new CocosNode('hud-top-right');
    group.layer = Layers.Enum.UI_2D;
    group.parent = this.node;
    this.topRightRoot = group;

    this.topRightPlate = createHudPlate(group, 'top-right-plate', plateFrame, layout.topRight.plate);

    const roomIcon = makePixelSprite(
      group,
      'room-icon',
      roomIconFrame,
      HUD_ROOM_ICON_SIZE_PX,
      HUD_ROOM_ICON_SIZE_PX,
    );
    // `Ui/Arrow.png` points down (-y) in sheet space; +90° points right (`▶`).
    roomIcon.angle = 90;
    this.roomIconNode = roomIcon;

    const roomLabel = createStyledLabel(
      group,
      'room-label',
      layout.topRight.roomText,
      HUD_LABEL_FONT_SIZE,
      HUD_LABEL_LINE_HEIGHT,
      TEXT_COLOR,
    );
    const roomTransform: UITransform | null = roomLabel.node.getComponent(CocosUITransform);
    if (roomTransform !== null) roomTransform.setAnchorPoint(1, 0.5);
    this.roomLabel = roomLabel;

    const enemyIcon = makePixelSprite(
      group,
      'enemies-icon',
      enemyIconFrame,
      HUD_ENEMY_ICON_SIZE_PX,
      HUD_ENEMY_ICON_SIZE_PX,
    );
    enemyIcon.active = false;
    this.enemyIconNode = enemyIcon;

    const enemiesLabel = createStyledLabel(
      group,
      'enemies-left',
      '',
      HUD_LABEL_FONT_SIZE,
      HUD_LABEL_LINE_HEIGHT,
      ENEMY_TEXT_COLOR,
    );
    const enemiesTransform: UITransform | null = enemiesLabel.node.getComponent(CocosUITransform);
    if (enemiesTransform !== null) enemiesTransform.setAnchorPoint(1, 0.5);
    enemiesLabel.node.active = false;
    this.enemiesLeftLabel = enemiesLabel;

    this.positionTopRightChildren(layout);
  }

  private applyTopRightLayout(): void {
    const layout = this.computeLayout(
      this.maxHeartNodes,
      Math.max(0, this.shownGold),
      this.shownRoomRaw || '1/9',
      this.shownEnemiesLeft ?? null,
      Math.max(0, this.shownSkillCount),
    );
    this.cachedArrowLimits = layout.arrowLimits;
    if (this.roomLabel !== null) {
      this.roomLabel.string = layout.topRight.roomText;
    }
    this.positionTopRightChildren(layout);
  }

  private positionTopRightChildren(layout: HudLayout): void {
    this.topRightPlate?.setRect(layout.topRight.plate);
    this.roomIconNode?.setPosition(layout.topRight.roomIcon.x, layout.topRight.roomIcon.y, 0);
    this.roomLabel?.node.setPosition(layout.topRight.roomLabel.x, layout.topRight.roomLabel.y, 0);
    this.enemyIconNode?.setPosition(layout.topRight.enemyIcon.x, layout.topRight.enemyIcon.y, 0);
    this.enemiesLeftLabel?.node.setPosition(
      layout.topRight.enemiesLabel.x,
      layout.topRight.enemiesLabel.y,
      0,
    );
  }

  /** Place `node` on the band edge along the ray to `offset`; returns the heading in degrees. */
  private placeArrow(node: Node, offset: Vec2, limits: HudArrowLimits): number {
    // y down (room tiles) → y up (UI px).
    const px = offset.x * HUD_PX_PER_TILE;
    const py = -offset.y * HUD_PX_PER_TILE;
    const verticalLimit = py >= 0 ? limits.top : limits.bottom;
    const scale = Math.min(
      Math.abs(px) > 1e-6 ? limits.halfWidth / Math.abs(px) : Number.POSITIVE_INFINITY,
      Math.abs(py) > 1e-6 ? verticalLimit / Math.abs(py) : Number.POSITIVE_INFINITY,
    );
    const clamped = Number.isFinite(scale) ? Math.min(1, scale) : 1;

    node.setPosition(px * clamped, py * clamped, 0);
    return (Math.atan2(py, px) * 180) / Math.PI;
  }

  /** #41: one small triangle per edge arrow, created once and toggled by `setArrows`. */
  private createArrows(): void {
    for (let index = 0; index < MAX_EDGE_ARROWS; index += 1) {
      const node = new CocosNode(`edge-arrow-${index}`);
      node.layer = Layers.Enum.UI_2D;
      node.parent = this.node;
      const graphics: Graphics = node.addComponent(CocosGraphics);
      drawArrow(graphics);
      node.active = false;
      this.arrowNodes.push(node);
    }
  }

  /**
   * #63: door arrows, created once. The root carries the clamped position; the triangle child
   * turns to the heading and the icon child stays upright just behind it.
   */
  private createDoorArrows(): void {
    for (let index = 0; index < MAX_EDGE_ARROWS; index += 1) {
      const root = new CocosNode(`door-arrow-${index}`);
      root.layer = Layers.Enum.UI_2D;
      root.parent = this.node;

      const triangle = new CocosNode('triangle');
      triangle.layer = Layers.Enum.UI_2D;
      triangle.parent = root;
      const graphics: Graphics = triangle.addComponent(CocosGraphics);
      drawDoorArrow(graphics);

      const iconNode = new CocosNode('reward-icon');
      iconNode.layer = Layers.Enum.UI_2D;
      iconNode.parent = root;
      const icon: Sprite = iconNode.addComponent(CocosSprite);
      icon.sizeMode = CocosSprite.SizeMode.CUSTOM;
      icon.trim = false;
      const transform: UITransform | null = iconNode.getComponent(CocosUITransform);
      // CUSTOM takes its size from contentSize, not from the frame (AGENTS trap).
      if (transform !== null) transform.setContentSize(DOOR_ARROW_ICON_PX, DOOR_ARROW_ICON_PX);
      iconNode.active = false;

      root.active = false;
      this.doorArrowSlots.push({ root, triangle, icon, shownReward: null });
    }
  }

  /** Load the reward icon once per reward change; keep the sprite inactive until its frame arrives. */
  private showDoorArrowIcon(slot: DoorArrowSlot, reward: DoorReward): void {
    if (slot.shownReward === reward) return;
    slot.shownReward = reward;
    slot.icon.node.active = false;

    const spec = ICONS[reward];
    void loadRewardIconFrame(spec)
      .then((frame) => {
        if (!slot.root.isValid || slot.shownReward !== reward) return;
        slot.icon.spriteFrame = frame;
        slot.icon.node.active = true;
      })
      .catch(() => undefined);
  }

  /** #63: transient "Choose a door" hint at top-centre, wrapped in a high-contrast plate. */
  private createDoorHint(plateFrame: SpriteFrame, layout: HudLayout): void {
    const root = new CocosNode('door-hint');
    root.layer = Layers.Enum.UI_2D;
    root.parent = this.node;
    root.setPosition(layout.doorHint.centerX, layout.doorHint.centerY, 0);

    const localRect: HudRect = {
      left: -layout.doorHint.width / 2,
      right: layout.doorHint.width / 2,
      bottom: -layout.doorHint.height / 2,
      top: layout.doorHint.height / 2,
      width: layout.doorHint.width,
      height: layout.doorHint.height,
      centerX: 0,
      centerY: 0,
    };
    createHudPlate(root, 'door-hint-plate', plateFrame, localRect);
    createStyledLabel(
      root,
      'door-hint-label',
      'Choose a door',
      HUD_LABEL_FONT_SIZE,
      HUD_LABEL_LINE_HEIGHT,
      TEXT_COLOR,
    );

    root.active = false;
    this.doorHintRoot = root;
  }

  /**
   * M13 bottom-left Dash (`SPACE`) & Signature Active (`E`) cooldown widgets inside `m13DashActive`.
   *
   * Built with a sibling 9-slice dark plate + single-colour `Graphics` nodes (strictly one colour
   * per `Graphics` node per `AGENTS.md`) so `setActions` only updates `setScale`, `.active`, and
   * quantized countdown strings on state transitions.
   */
  private createDashActiveGroup(plateFrame: SpriteFrame, layout: HudLayout): void {
    const group = new CocosNode('hud-dash-active');
    group.layer = Layers.Enum.UI_2D;
    group.parent = this.node;
    this.actionsRoot = group;

    createHudPlate(group, 'dash-active-plate', plateFrame, layout.dashActive.plate);

    this.dashSlot = createActionWidgetSlot(group, 'dash', layout.dashActive.dash, {
      readyBorderColor: DASH_BADGE_READY_BORDER_COLOR,
      cooldownFillColor: DASH_FILL_CD_COLOR,
      readyFillColor: DASH_FILL_READY_COLOR,
      readyShineColor: DASH_FILL_SHINE_COLOR,
      readyTextColor: DASH_READY_TEXT_COLOR,
    });

    this.activeSlot = createActionWidgetSlot(group, 'active', layout.dashActive.active, {
      readyBorderColor: ACTIVE_BADGE_READY_BORDER_COLOR,
      cooldownFillColor: ACTIVE_FILL_CD_COLOR,
      readyFillColor: ACTIVE_FILL_READY_COLOR,
      readyShineColor: ACTIVE_FILL_SHINE_COLOR,
      readyTextColor: ACTIVE_READY_TEXT_COLOR,
    });
  }

  /**
   * M12 bottom-centre XP bar + `LV X` badge inside `m12XpBar`.
   *
   * Built with sibling dark 9-slice plate + single-colour `Graphics` nodes (strictly one colour per
   * `Graphics` node per AGENTS.md) so `setXp` only updates `setScale` and label strings on XP events.
   */
  private createXpBar(plateFrame: SpriteFrame, layout: HudLayout): void {
    const group = new CocosNode('hud-xp-bar');
    group.layer = Layers.Enum.UI_2D;
    group.parent = this.node;
    this.xpRoot = group;

    const { plate, badge, barTrack, barFillMax, levelLabel, progressLabel } = layout.xpBar;
    createHudPlate(group, 'xp-plate', plateFrame, plate);

    // `LV X` badge pill: dedicated fill node + dedicated 1px gold border node.
    createFilledRectNode(group, 'xp-badge-bg', badge, XP_BADGE_BG_COLOR);
    createStrokedRectNode(group, 'xp-badge-border', badge, XP_BADGE_BORDER_COLOR);

    // XP progress track trough: dedicated fill node + dedicated 1px frame node.
    createFilledRectNode(group, 'xp-track-bg', barTrack, XP_TRACK_BG_COLOR);
    createStrokedRectNode(group, 'xp-track-border', barTrack, XP_TRACK_BORDER_COLOR);

    // Left-anchored XP fill group (`setScale(ratio, 1, 1)` avoids any runtime Graphics redraws).
    const fillRoot = new CocosNode('xp-fill');
    fillRoot.layer = Layers.Enum.UI_2D;
    fillRoot.parent = group;
    fillRoot.setPosition(barFillMax.left, barFillMax.centerY, 0);
    fillRoot.active = false;
    this.xpFillRoot = fillRoot;

    const cyanGroup = new CocosNode('xp-fill-cyan');
    cyanGroup.layer = Layers.Enum.UI_2D;
    cyanGroup.parent = fillRoot;
    createLeftAnchoredFillNode(
      cyanGroup,
      'xp-fill-cyan-main',
      barFillMax.width,
      barFillMax.height,
      0,
      XP_FILL_CYAN_COLOR,
    );
    const highlightHeight = Math.min(2, barFillMax.height);
    createLeftAnchoredFillNode(
      cyanGroup,
      'xp-fill-cyan-shine',
      barFillMax.width,
      highlightHeight,
      (barFillMax.height - highlightHeight) / 2,
      XP_FILL_HIGHLIGHT_COLOR,
    );
    this.xpFillCyanNode = cyanGroup;

    const goldNode = createLeftAnchoredFillNode(
      fillRoot,
      'xp-fill-gold',
      barFillMax.width,
      barFillMax.height,
      0,
      XP_FILL_FULL_GOLD_COLOR,
    );
    goldNode.active = false;
    this.xpFillGoldNode = goldNode;

    const lvLabel = createStyledLabel(
      group,
      'xp-level',
      layout.xpBar.levelText,
      HUD_XP_LEVEL_FONT_SIZE,
      HUD_XP_LEVEL_LINE_HEIGHT,
      GOLD_TEXT_COLOR,
    );
    lvLabel.node.setPosition(levelLabel.x, levelLabel.y, 0);
    this.xpLevelLabel = lvLabel;

    const progLabel = createStyledLabel(
      group,
      'xp-progress',
      '',
      HUD_XP_PROGRESS_FONT_SIZE,
      HUD_XP_PROGRESS_LINE_HEIGHT,
      TEXT_COLOR,
    );
    progLabel.node.setPosition(progressLabel.x, progressLabel.y, 0);
    progLabel.node.active = false;
    this.xpProgressLabel = progLabel;
  }

  private createSkillRow(plateFrame: SpriteFrame, layout: HudLayout): void {
    const group = new CocosNode('hud-skill-strip');
    group.layer = Layers.Enum.UI_2D;
    group.parent = this.node;

    const plate = createHudPlate(group, 'skill-row-backdrop', plateFrame, layout.skillStrip.maxPlate);
    plate.setActive(false);
    this.skillStripPlate = plate;

    for (let index = 0; index < HUD_SKILL_SLOTS; index += 1) {
      const pos = layout.skillStrip.slotCenters[index] ?? { x: 0, y: 0 };
      const root = new CocosNode(`skill-${index}`);
      root.layer = Layers.Enum.UI_2D;
      root.parent = group;
      root.setPosition(pos.x, pos.y, 0);

      const icon = new CocosNode('icon');
      icon.layer = Layers.Enum.UI_2D;
      icon.parent = root;
      const iconSprite: Sprite = icon.addComponent(CocosSprite);
      iconSprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
      iconSprite.trim = false;
      const iconTransform: UITransform | null = icon.getComponent(CocosUITransform);
      if (iconTransform !== null) {
        iconTransform.setContentSize(SKILL_ICON_SIZE_PX, SKILL_ICON_SIZE_PX);
      }

      const frameNode = new CocosNode('frame');
      frameNode.layer = Layers.Enum.UI_2D;
      frameNode.parent = root;
      const frame: Graphics = frameNode.addComponent(CocosGraphics);
      drawSkillFrame(frame, RARITY_COLORS.common);

      const stack = createStyledLabel(root, 'stack', '', 9, 10, TEXT_COLOR);
      // Right-anchored inside the bottom-right corner of the 24 px icon so 2-digit stacks never bleed out.
      stack.node.setPosition(SKILL_ICON_SIZE_PX / 2 - 1, -SKILL_ICON_SIZE_PX / 2 + 5, 0);
      const stackTransform: UITransform | null = stack.node.getComponent(CocosUITransform);
      if (stackTransform !== null) stackTransform.setAnchorPoint(1, 0.5);

      const fallback = createStyledLabel(root, 'fallback', '', 9, 11, TEXT_COLOR);

      root.active = false;
      this.skillSlots.push({ root, icon, frame, stack, fallback, id: '', stacks: 0 });
    }
  }

  private createBossBar(
    barFrame: SpriteFrame,
    plateFrame: SpriteFrame,
    layout: HudLayout,
  ): void {
    const root = new CocosNode('boss-bar');
    root.layer = Layers.Enum.UI_2D;
    root.parent = this.node;
    root.setPosition(layout.bossBar.plate.centerX, layout.bossBar.plate.centerY, 0);

    const localPlate: HudRect = {
      left: -layout.bossBar.plate.width / 2,
      right: layout.bossBar.plate.width / 2,
      bottom: -layout.bossBar.plate.height / 2,
      top: layout.bossBar.plate.height / 2,
      width: layout.bossBar.plate.width,
      height: layout.bossBar.plate.height,
      centerX: 0,
      centerY: 0,
    };
    createHudPlate(root, 'boss-plate', plateFrame, localPlate);

    this.makeBar('boss-bg', barFrame, BOSS_BG_COLOR, root, layout.bossBar.barOffsetY);
    this.bossFill = this.makeBar(
      'boss-fill',
      barFrame,
      BOSS_FILL_COLOR,
      root,
      layout.bossBar.barOffsetY,
    );

    const title = createStyledLabel(
      root,
      'boss-title',
      '',
      HUD_BOSS_TITLE_FONT_SIZE,
      HUD_BOSS_TITLE_LINE_HEIGHT,
      TEXT_COLOR,
    );
    title.node.setPosition(0, layout.bossBar.titleOffsetY, 0);
    this.bossTitle = title;

    root.active = false;
    this.bossRoot = root;
  }

  /** One bar: colour-tinted wooden sprite, left-anchored so scale.x = health fraction. */
  private makeBar(
    name: string,
    frame: SpriteFrame,
    color: Color,
    parent: Node,
    offsetY: number,
  ): Node {
    const node = new CocosNode(name);
    node.layer = Layers.Enum.UI_2D;
    node.parent = parent;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    sprite.trim = false;
    sprite.spriteFrame = frame;
    sprite.color = color;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setContentSize(HUD_BOSS_BAR_WIDTH_PX, HUD_BOSS_BAR_HEIGHT_PX);
      transform.setAnchorPoint(0, 0.5);
    }
    node.setPosition(-HUD_BOSS_BAR_WIDTH_PX / 2, offsetY, 0);
    return node;
  }

  /** Add heart slots as the cap grows; surplus slots are hidden rather than destroyed. */
  private ensureHeartNodes(maxHearts: number): void {
    const frames = this.frames;
    const parent = this.topLeftRoot;
    if (frames === null || parent === null) return;

    for (let index = 0; index < maxHearts; index += 1) {
      if (this.heartNodes[index] !== undefined) continue;
      const node = makePixelSprite(
        parent,
        `heart-${index}`,
        frames.full,
        HUD_HEART_SIZE_PX,
        HUD_HEART_SIZE_PX,
      );
      this.heartNodes.push(node);
    }
  }
}

/** Build one M13 cooldown row (`Dash` or `Signature Active`) with 1-colour-per-node `Graphics`. */
function createActionWidgetSlot(
  parent: Node,
  prefix: string,
  slotLayout: HudActionSlotLayout,
  palette: {
    readonly readyBorderColor: Color;
    readonly cooldownFillColor: Color;
    readonly readyFillColor: Color;
    readonly readyShineColor: Color;
    readonly readyTextColor: Color;
  },
): ActionWidgetSlot {
  const { keyBadge, barTrack, barFillMax, keyLabel, statusLabel, keyText } = slotLayout;

  createFilledRectNode(parent, `${prefix}-key-bg`, keyBadge, ACTION_BADGE_BG_COLOR);
  const keyReadyBorder = createStrokedRectNode(
    parent,
    `${prefix}-key-border-ready`,
    keyBadge,
    palette.readyBorderColor,
  );
  const keyCooldownBorder = createStrokedRectNode(
    parent,
    `${prefix}-key-border-cd`,
    keyBadge,
    ACTION_BADGE_CD_BORDER_COLOR,
  );
  keyCooldownBorder.active = false;

  createFilledRectNode(parent, `${prefix}-track-bg`, barTrack, ACTION_TRACK_BG_COLOR);
  createStrokedRectNode(parent, `${prefix}-track-border`, barTrack, ACTION_TRACK_BORDER_COLOR);

  const fillRoot = new CocosNode(`${prefix}-fill`);
  fillRoot.layer = Layers.Enum.UI_2D;
  fillRoot.parent = parent;
  fillRoot.setPosition(barFillMax.left, barFillMax.centerY, 0);

  const fillReadyGroup = new CocosNode(`${prefix}-fill-ready`);
  fillReadyGroup.layer = Layers.Enum.UI_2D;
  fillReadyGroup.parent = fillRoot;
  createLeftAnchoredFillNode(
    fillReadyGroup,
    `${prefix}-fill-ready-main`,
    barFillMax.width,
    barFillMax.height,
    0,
    palette.readyFillColor,
  );
  const shineHeight = Math.min(2, barFillMax.height);
  createLeftAnchoredFillNode(
    fillReadyGroup,
    `${prefix}-fill-ready-shine`,
    barFillMax.width,
    shineHeight,
    (barFillMax.height - shineHeight) / 2,
    palette.readyShineColor,
  );

  const fillCooldownNode = createLeftAnchoredFillNode(
    fillRoot,
    `${prefix}-fill-cd`,
    barFillMax.width,
    barFillMax.height,
    0,
    palette.cooldownFillColor,
  );
  fillCooldownNode.active = false;

  const keyLbl = createStyledLabel(
    parent,
    `${prefix}-key-label`,
    keyText,
    HUD_ACTION_KEY_FONT_SIZE,
    HUD_ACTION_KEY_LINE_HEIGHT,
    palette.readyTextColor,
  );
  keyLbl.node.setPosition(keyLabel.x, keyLabel.y, 0);

  const statusLbl = createStyledLabel(
    parent,
    `${prefix}-status-label`,
    slotLayout.statusText,
    HUD_ACTION_STATUS_FONT_SIZE,
    HUD_ACTION_STATUS_LINE_HEIGHT,
    TEXT_COLOR,
  );
  statusLbl.node.setPosition(statusLabel.x, statusLabel.y, 0);

  return {
    keyReadyBorder,
    keyCooldownBorder,
    fillRoot,
    fillReadyGroup,
    fillCooldownNode,
    keyLabel: keyLbl,
    statusLabel: statusLbl,
    readyTextColor: palette.readyTextColor,
    shownRatio: -1,
    shownReady: null,
    shownStatusText: '',
  };
}

function updateActionWidgetSlot(
  slot: ActionWidgetSlot,
  rawReadyRatio: number,
  rawCooldownSec: number,
): void {
  const ready = isHudActionReady(rawReadyRatio, rawCooldownSec);
  const ratio = ready ? 1 : computeHudActionReadyRatio(rawReadyRatio);

  if (ratio !== slot.shownRatio) {
    slot.shownRatio = ratio;
    if (ratio <= 0) {
      if (slot.fillRoot.active) slot.fillRoot.active = false;
    } else {
      if (!slot.fillRoot.active) slot.fillRoot.active = true;
      slot.fillRoot.setScale(ratio, 1, 1);
    }
  }

  if (ready !== slot.shownReady) {
    slot.shownReady = ready;
    if (slot.keyReadyBorder.active !== ready) slot.keyReadyBorder.active = ready;
    if (slot.keyCooldownBorder.active !== !ready) slot.keyCooldownBorder.active = !ready;
    if (slot.fillReadyGroup.active !== ready) slot.fillReadyGroup.active = ready;
    if (slot.fillCooldownNode.active !== !ready) slot.fillCooldownNode.active = !ready;
    slot.keyLabel.color = ready ? slot.readyTextColor : ACTION_KEY_CD_COLOR;
    slot.statusLabel.color = ready ? TEXT_COLOR : ACTION_STATUS_CD_COLOR;
  }

  const statusText = formatHudActionStatusText(rawReadyRatio, rawCooldownSec);
  if (statusText !== slot.shownStatusText) {
    slot.shownStatusText = statusText;
    slot.statusLabel.string = statusText;
  }
}

/** Single-colour filled rectangle `Graphics` node positioned at `rect.centerX/Y` (one colour per node). */
function createFilledRectNode(parent: Node, name: string, rect: HudRect, color: Color): Node {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(rect.centerX, rect.centerY, 0);

  const graphics: Graphics = node.addComponent(CocosGraphics);
  graphics.fillColor = color;
  graphics.rect(-rect.width / 2, -rect.height / 2, rect.width, rect.height);
  graphics.fill();
  return node;
}

/** Single-colour 1 px stroked rectangle `Graphics` node positioned at `rect.centerX/Y`. */
function createStrokedRectNode(parent: Node, name: string, rect: HudRect, color: Color): Node {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(rect.centerX, rect.centerY, 0);

  const graphics: Graphics = node.addComponent(CocosGraphics);
  graphics.lineWidth = 1;
  graphics.strokeColor = color;
  graphics.rect(-rect.width / 2 + 0.5, -rect.height / 2 + 0.5, rect.width - 1, rect.height - 1);
  graphics.stroke();
  return node;
}

/** Left-anchored single-colour filled rectangle `[0..width]` so `parent.setScale(ratio, 1, 1)` scales cleanly. */
function createLeftAnchoredFillNode(
  parent: Node,
  name: string,
  width: number,
  height: number,
  offsetY: number,
  color: Color,
): Node {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(0, offsetY, 0);

  const graphics: Graphics = node.addComponent(CocosGraphics);
  graphics.fillColor = color;
  graphics.rect(0, -height / 2, width, height);
  graphics.fill();
  return node;
}

/** Slice a 9-patch `SpriteFrame` with explicit corner insets so `SLICED` sprites never distort edges. */
function sliceSlicedFrame(
  texture: Parameters<typeof sliceFrame>[0],
  rect: TileRect,
  insets: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  },
): SpriteFrame {
  const frame = sliceFrame(texture, rect);
  frame.insetLeft = insets.left;
  frame.insetRight = insets.right;
  frame.insetTop = insets.top;
  frame.insetBottom = insets.bottom;
  return frame;
}

/** Build a crisp CUSTOM-sized pixel sprite (`setContentSize` mandatory per AGENTS.md). */
function makePixelSprite(
  parent: Node,
  name: string,
  frame: SpriteFrame,
  width: number,
  height: number,
): Node {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SIMPLE;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;
  sprite.spriteFrame = frame;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(width, height);

  return node;
}

/**
 * High-contrast HUD backing plate: dark-tinted 9-slice `nine_path_panel_interior` sprite +
 * separate single-colour 1 px warm-wood border `Graphics` node (AGENTS.md: one Graphics per colour).
 */
function createHudPlate(
  parent: Node,
  name: string,
  plateFrame: SpriteFrame,
  initialRect: HudRect,
): HudPlateHandle {
  const root = new CocosNode(name);
  root.layer = Layers.Enum.UI_2D;
  root.parent = parent;

  const bgNode = new CocosNode(`${name}-bg`);
  bgNode.layer = Layers.Enum.UI_2D;
  bgNode.parent = root;
  const sprite: Sprite = bgNode.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SLICED;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;
  sprite.spriteFrame = plateFrame;
  sprite.color = PLATE_TINT;
  const bgTransform: UITransform | null = bgNode.getComponent(CocosUITransform);

  const borderNode = new CocosNode(`${name}-border`);
  borderNode.layer = Layers.Enum.UI_2D;
  borderNode.parent = root;
  const border: Graphics = borderNode.addComponent(CocosGraphics);

  let shownW = -1;
  let shownH = -1;
  let shownX = Number.NaN;
  let shownY = Number.NaN;

  const applyRect = (rect: HudRect): void => {
    if (rect.centerX !== shownX || rect.centerY !== shownY) {
      shownX = rect.centerX;
      shownY = rect.centerY;
      root.setPosition(rect.centerX, rect.centerY, 0);
    }
    if (rect.width !== shownW || rect.height !== shownH) {
      shownW = rect.width;
      shownH = rect.height;
      if (bgTransform !== null) bgTransform.setContentSize(rect.width, rect.height);
      drawPlateBorder(border, rect.width, rect.height);
    }
  };

  applyRect(initialRect);

  return {
    root,
    setRect: applyRect,
    setActive(active: boolean): void {
      if (root.active !== active) root.active = active;
    },
  };
}

function drawPlateBorder(graphics: Graphics, width: number, height: number): void {
  graphics.clear();
  if (width <= 2 || height <= 2) return;
  graphics.lineWidth = 1;
  graphics.strokeColor = PLATE_BORDER_COLOR;
  graphics.rect(-width / 2 + 0.5, -height / 2 + 0.5, width - 1, height - 1);
  graphics.stroke();
}

function createStyledLabel(
  parent: Node,
  name: string,
  text: string,
  fontSize: number,
  lineHeight: number,
  color: Color,
): Label {
  const label = createLabel(parent, name, text);
  label.fontSize = fontSize;
  label.lineHeight = lineHeight;
  label.color = color;
  label.enableOutline = true;
  label.outlineColor = TEXT_OUTLINE_COLOR;
  label.outlineWidth = 1;
  return label;
}

/**
 * Redraw a skill slot's 1 px rarity frame around the 24 px icon (Graphics has no "change colour
 * only" call: clear + stroke is the cheap redraw, and it only runs when the skill row changes).
 */
function drawSkillFrame(graphics: Graphics, color: Color): void {
  graphics.clear();
  graphics.lineWidth = 1;
  graphics.strokeColor = color;
  graphics.rect(
    -SKILL_ICON_SIZE_PX / 2 - 1,
    -SKILL_ICON_SIZE_PX / 2 - 1,
    SKILL_ICON_SIZE_PX + 2,
    SKILL_ICON_SIZE_PX + 2,
  );
  graphics.stroke();
}

/**
 * A semi-transparent dark panel, drawn with `Graphics` (no texture needed).
 *
 * Shared with full-screen modal dims (`menu.ts`, `skill-pick.ts`, `shop-panel.ts`, `banner-ui.ts`).
 */
export function createBackdropPanel(
  parent: Node,
  name: string,
  width: number,
  height: number,
  alpha = 160,
): Node {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const graphics: Graphics = node.addComponent(CocosGraphics);
  graphics.fillColor = new CocosColor(8, 7, 12, Math.min(255, Math.max(0, alpha)));
  graphics.rect(-width / 2, -height / 2, width, height);
  graphics.fill();

  return node;
}

/**
 * A small solid triangle pointing along +x, outlined in near-black so it reads on snow, sand and
 * grass. Drawn once per arrow node; `setArrows` only rotates and moves the node.
 */
function drawArrow(graphics: Graphics): void {
  graphics.fillColor = ARROW_FILL;
  graphics.moveTo(7, 0);
  graphics.lineTo(-5, 5);
  graphics.lineTo(-2, 0);
  graphics.lineTo(-5, -5);
  graphics.close();
  graphics.fill();
  graphics.strokeColor = ARROW_OUTLINE;
  graphics.lineWidth = 1;
  graphics.stroke();
}

/**
 * A door arrow (#63): the same readable silhouette as `drawArrow`, in cyan with a deeper outline so
 * it never reads as an enemy arrow. The reward icon is a sibling node, not part of this drawing.
 */
function drawDoorArrow(graphics: Graphics): void {
  graphics.fillColor = DOOR_ARROW_FILL;
  graphics.moveTo(7, 0);
  graphics.lineTo(-5, 5);
  graphics.lineTo(-2, 0);
  graphics.lineTo(-5, -5);
  graphics.close();
  graphics.fill();
  graphics.strokeColor = DOOR_ARROW_OUTLINE;
  graphics.lineWidth = 1;
  graphics.stroke();
}

/**
 * Create a `Label` node under `parent` (which must be under a Canvas).
 *
 * Exported so `bootstrap` and screen builders reuse the same `NormalFont.ttf` setup.
 */
export function createLabel(parent: Node, name: string, text: string): Label {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const label: Label = node.addComponent(CocosLabel);
  label.string = text;
  label.fontSize = DEFAULT_LABEL_FONT_SIZE;
  label.lineHeight = DEFAULT_LABEL_FONT_SIZE + 2;
  label.color = TEXT_COLOR;
  applyPixelFont(label);

  return label;
}
