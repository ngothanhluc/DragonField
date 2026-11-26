/**
 * In-game HUD (M11 T4 + M12 T2 + M13 T1 + M17): unified top-left RPG plate (reserved 28×28
 * portrait frame + 100-scale pixel HP bar with delayed white damage-drain trail + XP bar &
 * `Cấp X`/`LV X` badge directly underneath + Gold counter), top-right Room/Enemies plate,
 * bottom-right 20-slot (10×2) skill grid, and bottom-left Dash (`SPACE`) + Signature Active (`E`)
 * cooldown widgets.
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
import {
  cachedCharacterPortrait,
  createPortraitSpriteNode,
  loadCharacterPortrait,
} from './assets/portrait-icon';
import { cachedSkillIcon, loadSkillIcon, SKILL_ICON_SIZE_PX } from './assets/skill-icon';
import type { AnimationManifest } from '../core/art/manifest';
import {
  DEFAULT_CHARACTER_ID,
  isCharacterId,
  type CharacterId,
} from '../core/characters/roster';
import { localizeBossDisplayName, t } from '../core/i18n';
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
  HUD_HP_FONT_SIZE,
  HUD_HP_LINE_HEIGHT,
  HUD_HP_TRAIL_DURATION_MS,
  HUD_LABEL_FONT_SIZE,
  HUD_LABEL_LINE_HEIGHT,
  HUD_PLATE_SLICE_INSETS,
  HUD_PORTRAIT_SPRITE_SIZE_PX,
  HUD_ROOM_ICON_SIZE_PX,
  HUD_SKILL_SLOTS,
  HUD_XP_LEVEL_FONT_SIZE,
  HUD_XP_LEVEL_LINE_HEIGHT,
  HUD_XP_LEVEL_UP_FLASH_MS,
  HUD_XP_PROGRESS_FONT_SIZE,
  HUD_XP_PROGRESS_LINE_HEIGHT,
  advanceHudHpTrail,
  computeHudActionReadyRatio,
  computeHudHpFillRatio,
  computeHudLayout,
  computeHudXpFillRatio,
  createHudHpTrail,
  formatHudActionStatusText,
  formatHudEnemiesText,
  formatHudGoldText,
  formatHudHpText,
  formatHudLevelText,
  formatHudXpProgressText,
  hudHpColorTier,
  isHudActionReady,
  triggerHudHpTrail,
  type HudActionSlotLayout,
  type HudArrowLimits,
  type HudHpColorTier,
  type HudHpTrailState,
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

/** M17 unified top-left portrait placeholder + 100-HP bar colours (strictly ONE Graphics per colour). */
const PORTRAIT_BG_COLOR = new CocosColor(18, 16, 24, 244);
const PORTRAIT_BORDER_COLOR = new CocosColor(216, 174, 108, 235);
const PORTRAIT_INNER_COLOR = new CocosColor(44, 38, 56, 210);
const HP_TRACK_BG_COLOR = new CocosColor(24, 14, 18, 245);
const HP_TRACK_BORDER_COLOR = new CocosColor(138, 76, 82, 230);
const HP_TRAIL_WHITE_COLOR = new CocosColor(255, 248, 242, 235);
const HP_FILL_HIGH_COLOR = new CocosColor(72, 214, 122, 255);
const HP_FILL_HIGH_SHINE_COLOR = new CocosColor(172, 248, 194, 225);
const HP_FILL_MID_COLOR = new CocosColor(242, 182, 62, 255);
const HP_FILL_MID_SHINE_COLOR = new CocosColor(255, 228, 152, 225);
const HP_FILL_LOW_COLOR = new CocosColor(226, 60, 68, 255);
const HP_FILL_LOW_SHINE_COLOR = new CocosColor(255, 162, 166, 225);

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

@ccclass('Hud')
export class Hud extends Component {
  private maxHpValue = 100;
  private lastHpValue = 100;
  private ready = false;

  private topLeftRoot: Node | null = null;
  private topLeftPlate: HudPlateHandle | null = null;
  private portraitInnerNode: Node | null = null;
  private portraitSpriteNode: Node | null = null;
  private portraitSprite: Sprite | null = null;
  private shownCharacterId: CharacterId = DEFAULT_CHARACTER_ID;
  private manifestRef: AnimationManifest | null = null;
  private hpTrailRoot: Node | null = null;
  private hpFillRoot: Node | null = null;
  private hpFillHighNode: Node | null = null;
  private hpFillMidNode: Node | null = null;
  private hpFillLowNode: Node | null = null;
  private hpLabel: Label | null = null;
  private hpTrailState: HudHpTrailState = createHudHpTrail(1);
  private shownHpRatio = -1;
  private shownHpTier: HudHpColorTier | null = null;
  private shownHpText = '';
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
    top: HUD_DESIGN_HEIGHT / 2 - 69,
    bottom: HUD_DESIGN_HEIGHT / 2 - 20,
  };

  /** Unified top-left XP bar + `LV X` badge directly below HP bar: event-driven, zero polling. */
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
  private xpLevelUpFlashMs = 0;

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
  async init(
    maxHp: number,
    roomText: string,
    characterId: CharacterId = DEFAULT_CHARACTER_ID,
    manifest: AnimationManifest | null = null,
  ): Promise<void> {
    const initialCharId: CharacterId = isCharacterId(characterId)
      ? characterId
      : DEFAULT_CHARACTER_ID;
    this.manifestRef = manifest;
    this.shownCharacterId = initialCharId;

    const [
      barTexture,
      plateTexture,
      goldCoinTexture,
      roomIconTexture,
      enemyIconTexture,
      initialPortraitFrame,
    ] = await Promise.all([
      loadPixelTexture(BAR_SHEET),
      loadPixelTexture(HUD_PLATE_SHEET),
      loadPixelTexture(GOLD_COIN_SHEET),
      loadPixelTexture(ROOM_ICON_SHEET),
      loadPixelTexture(ENEMY_ICON_SHEET),
      loadCharacterPortrait(initialCharId, manifest).catch(() => null),
    ]);

    const plateFrame = sliceSlicedFrame(plateTexture, PLATE_RECT, HUD_PLATE_SLICE_INSETS);
    const barFrame = sliceFrame(barTexture, BAR_RECT);
    const goldCoinFrame = sliceFrame(goldCoinTexture, GOLD_COIN_RECT);
    const roomIconFrame = sliceFrame(roomIconTexture, ROOM_ICON_RECT);
    const enemyIconFrame = sliceFrame(enemyIconTexture, ENEMY_ICON_RECT);

    const safeMaxHp = Math.max(1, Math.round(maxHp));
    this.maxHpValue = safeMaxHp;
    this.lastHpValue = safeMaxHp;
    this.hpTrailState = createHudHpTrail(1);
    this.ready = true;

    const layout = this.computeLayout(safeMaxHp, safeMaxHp, 0, roomText, null, 0);
    this.cachedArrowLimits = layout.arrowLimits;

    this.createTopLeftGroup(goldCoinFrame, plateFrame, initialPortraitFrame, layout);
    this.createTopRightGroup(roomIconFrame, enemyIconFrame, plateFrame, layout);
    this.createDashActiveGroup(plateFrame, layout);
    this.createSkillRow(plateFrame, layout);
    this.createBossBar(barFrame, plateFrame, layout);
    this.createArrows();
    this.createDoorArrows();
    this.createDoorHint(plateFrame, layout);

    this.setRoomLabel(roomText);
    this.setHp(safeMaxHp, safeMaxHp);
    this.setGold(0);
    this.setEnemiesLeft(null);
    this.setXp(1, 0, 0);
    this.setActions(1, 0, 1, 0);
    this.setSkills([]);
    // If `setCharacter` was called while `init` was awaiting textures, sync to the latest hero.
    if (this.shownCharacterId !== initialCharId) {
      const target = this.shownCharacterId;
      this.shownCharacterId = initialCharId;
      this.setCharacter(target, this.manifestRef);
    }
  }

  /** Playable hero currently displayed in the top-left HUD portrait frame (M19). */
  get activeCharacterId(): CharacterId {
    return this.shownCharacterId;
  }

  /**
   * Update the active hero's 64×64 nearest-filtered portrait in the top-left HUD slot (M19).
   * Uses synchronous cache hit when preloaded and guards async resolution against stale updates.
   */
  setCharacter(
    characterId: CharacterId | string,
    manifest: AnimationManifest | null = this.manifestRef,
  ): void {
    const normalized: CharacterId = isCharacterId(characterId) ? characterId : DEFAULT_CHARACTER_ID;
    if (manifest !== null) this.manifestRef = manifest;

    const sprite = this.portraitSprite;
    const spriteNode = this.portraitSpriteNode;
    if (normalized === this.shownCharacterId && sprite?.spriteFrame !== null) {
      return;
    }
    this.shownCharacterId = normalized;
    if (!this.ready || sprite === null || spriteNode === null) return;

    const cached = cachedCharacterPortrait(normalized, this.manifestRef);
    if (cached !== undefined) {
      sprite.spriteFrame = cached;
      spriteNode.active = true;
      if (this.portraitInnerNode !== null) this.portraitInnerNode.active = false;
      return;
    }

    void loadCharacterPortrait(normalized, this.manifestRef)
      .then((frame) => {
        if (!spriteNode.isValid || this.shownCharacterId !== normalized) return;
        sprite.spriteFrame = frame;
        spriteNode.active = true;
        if (this.portraitInnerNode !== null) this.portraitInnerNode.active = false;
      })
      .catch(() => {
        if (!spriteNode.isValid || this.shownCharacterId !== normalized) return;
        spriteNode.active = false;
        if (this.portraitInnerNode !== null) this.portraitInnerNode.active = true;
      });
  }

  /**
   * Lightweight transition stepper: only runs while the delayed white HP damage-drain trail
   * (`~350 ms` ease-out) or the XP level-up gold flash is active; exits on line 1 at rest.
   */
  protected update(dt: number): void {
    if (!this.hpTrailState.active && this.xpLevelUpFlashMs <= 0) return;
    const dtMs = dt * 1000;

    if (this.hpTrailState.active) {
      this.hpTrailState = advanceHudHpTrail(this.hpTrailState, dtMs, HUD_HP_TRAIL_DURATION_MS);
      this.syncHpTrailVisual();
    }

    if (this.xpLevelUpFlashMs > 0) {
      this.xpLevelUpFlashMs = Math.max(0, this.xpLevelUpFlashMs - dtMs);
      if (this.xpLevelUpFlashMs <= 0) {
        this.syncXpFillColor();
      }
    }
  }

  /** Update current & max HP on the unified top-left pixel HP bar. */
  setHp(hp: number, maxHp = this.maxHpValue): void {
    if (!this.ready) return;
    const safeMax = Math.max(1, Math.round(maxHp));
    const safeHp = Math.min(safeMax, Math.max(0, Math.round(hp)));
    const maxChanged = safeMax !== this.maxHpValue;
    const hpChanged = safeHp !== this.shownHearts;
    if (!maxChanged && !hpChanged) return;

    this.maxHpValue = safeMax;
    this.lastHpValue = safeHp;
    this.shownHearts = safeHp;

    const ratio = computeHudHpFillRatio(safeHp, safeMax);
    this.hpTrailState = triggerHudHpTrail(this.hpTrailState, ratio);
    this.syncHpTrailVisual();

    if (ratio !== this.shownHpRatio) {
      this.shownHpRatio = ratio;
      const fill = this.hpFillRoot;
      if (fill !== null) {
        if (ratio <= 0) {
          if (fill.active) fill.active = false;
        } else {
          if (!fill.active) fill.active = true;
          fill.setScale(ratio, 1, 1);
        }
      }
    }

    const tier = hudHpColorTier(ratio);
    if (tier !== this.shownHpTier) {
      this.shownHpTier = tier;
      if (this.hpFillHighNode !== null) this.hpFillHighNode.active = tier === 'high';
      if (this.hpFillMidNode !== null) this.hpFillMidNode.active = tier === 'mid';
      if (this.hpFillLowNode !== null) this.hpFillLowNode.active = tier === 'low';
    }

    const hpText = formatHudHpText(safeHp, safeMax);
    if (hpText !== this.shownHpText) {
      this.shownHpText = hpText;
      if (this.hpLabel !== null) this.hpLabel.string = hpText;
    }
  }

  /** Legacy-named HP setter (accepts 100-scale integer HP from `hud-sync`). */
  setHearts(hp: number): void {
    this.setHp(hp, this.maxHpValue);
  }

  /** Legacy-named max HP setter (Vitality raises max HP mid-run). */
  setMaxHearts(maxHp: number): void {
    const safeMax = Math.max(1, Math.round(maxHp));
    if (!this.ready || safeMax === this.maxHpValue) return;
    this.maxHpValue = safeMax;
    // Force a clean bar & label redraw with the updated denominator.
    this.shownHearts = -1;
    this.setHp(this.lastHpValue, safeMax);
  }

  private syncHpTrailVisual(): void {
    const trail = this.hpTrailRoot;
    if (trail === null) return;
    const trailRatio = this.hpTrailState.current;
    const visible = trailRatio > this.shownHpRatio + 1e-4 && trailRatio > 0;
    if (trail.active !== visible) trail.active = visible;
    if (visible) {
      trail.setScale(trailRatio, 1, 1);
    }
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
    label.string = formatHudGoldText(clamped);
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
   * Event-driven XP bar + `Cấp X` / `LV X` badge setter (M12 T2 + M17 top-left relocation).
   *
   * Skips label/scale updates whenever `(level, currentXp, requiredXp)` is unchanged; triggers a
   * brief gold highlight flash on level-up.
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

    const leveledUp = this.shownXpLevel >= 1 && level > this.shownXpLevel;
    this.shownXpLevel = level;
    this.shownXpCurrent = currentXp;
    this.shownXpRequired = requiredXp;

    if (leveledUp) {
      this.xpLevelUpFlashMs = HUD_XP_LEVEL_UP_FLASH_MS;
    }

    const levelText = formatHudLevelText(level);
    if (levelText !== this.shownXpLevelText) {
      this.shownXpLevelText = levelText;
      if (this.xpLevelLabel !== null) {
        this.xpLevelLabel.string = levelText;
      }
    }

    const ratio = computeHudXpFillRatio(currentXp, requiredXp);
    if (ratio !== this.shownXpRatio || leveledUp) {
      this.shownXpRatio = ratio;
      const fill = this.xpFillRoot;
      if (fill !== null) {
        const displayRatio = this.xpLevelUpFlashMs > 0 ? Math.max(ratio, 1) : ratio;
        if (displayRatio <= 0) {
          if (fill.active) fill.active = false;
        } else {
          if (!fill.active) fill.active = true;
          fill.setScale(displayRatio, 1, 1);
          this.syncXpFillColor();
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

  private syncXpFillColor(): void {
    const isGold = this.shownXpRatio >= 1 || this.xpLevelUpFlashMs > 0;
    if (this.xpFillCyanNode !== null && this.xpFillCyanNode.active !== !isGold) {
      this.xpFillCyanNode.active = !isGold;
    }
    if (this.xpFillGoldNode !== null && this.xpFillGoldNode.active !== isGold) {
      this.xpFillGoldNode.active = isGold;
    }
    if (this.xpFillRoot !== null && this.xpLevelUpFlashMs <= 0) {
      if (this.shownXpRatio <= 0) {
        if (this.xpFillRoot.active) this.xpFillRoot.active = false;
      } else {
        if (!this.xpFillRoot.active) this.xpFillRoot.active = true;
        this.xpFillRoot.setScale(this.shownXpRatio, 1, 1);
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
        this.lastHpValue,
        this.maxHpValue,
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
      label.string = formatHudEnemiesText(normalized);
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
        this.bossTitle.string = t('boss.hudTitle', {
          name: localizeBossDisplayName(name),
          phase,
        });
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
    hp: number,
    maxHp: number,
    gold: number,
    roomLabel: string,
    enemiesLeft: number | null,
    skillCount: number,
  ): HudLayout {
    const visible = view.getVisibleSize();
    return computeHudLayout({
      designWidth: visible.width > 0 ? visible.width : HUD_DESIGN_WIDTH,
      designHeight: visible.height > 0 ? visible.height : HUD_DESIGN_HEIGHT,
      hp,
      maxHp,
      gold,
      roomLabel,
      enemiesLeft,
      skillCount,
    });
  }

  private createTopLeftGroup(
    goldCoinFrame: SpriteFrame,
    plateFrame: SpriteFrame,
    initialPortraitFrame: SpriteFrame | null,
    layout: HudLayout,
  ): void {
    const group = new CocosNode('hud-top-left');
    group.layer = Layers.Enum.UI_2D;
    group.parent = this.node;
    this.topLeftRoot = group;

    this.topLeftPlate = createHudPlate(group, 'top-left-plate', plateFrame, layout.topLeft.plate);

    // M17/M19 28×28 hero portrait frame: dark well + crisp 26×26 nearest-filtered portrait + 1px gold rim.
    const { portraitSlot, hpBar, xpBar } = layout.topLeft;
    createFilledRectNode(group, 'portrait-slot-bg', portraitSlot, PORTRAIT_BG_COLOR);
    const portraitInner = createStrokedRectNode(
      group,
      'portrait-slot-inner',
      {
        left: portraitSlot.left + 2,
        right: portraitSlot.right - 2,
        bottom: portraitSlot.bottom + 2,
        top: portraitSlot.top - 2,
        width: portraitSlot.width - 4,
        height: portraitSlot.height - 4,
        centerX: portraitSlot.centerX,
        centerY: portraitSlot.centerY,
      },
      PORTRAIT_INNER_COLOR,
    );
    portraitInner.active = initialPortraitFrame === null;
    this.portraitInnerNode = portraitInner;

    const portraitBuilt = createPortraitSpriteNode(
      group,
      'portrait-sprite',
      HUD_PORTRAIT_SPRITE_SIZE_PX,
      HUD_PORTRAIT_SPRITE_SIZE_PX,
      initialPortraitFrame,
    );
    portraitBuilt.node.setPosition(portraitSlot.centerX, portraitSlot.centerY, 0);
    portraitBuilt.node.active = initialPortraitFrame !== null;
    this.portraitSpriteNode = portraitBuilt.node;
    this.portraitSprite = portraitBuilt.sprite;

    createStrokedRectNode(group, 'portrait-slot-border', portraitSlot, PORTRAIT_BORDER_COLOR);

    // 100-HP pixel bar: trough + border + white delayed damage-drain trail + colour-tiered fill + numeric label.
    createFilledRectNode(group, 'hp-track-bg', hpBar.barTrack, HP_TRACK_BG_COLOR);
    createStrokedRectNode(group, 'hp-track-border', hpBar.barTrack, HP_TRACK_BORDER_COLOR);

    const hpTrailRoot = new CocosNode('hp-trail-fill');
    hpTrailRoot.layer = Layers.Enum.UI_2D;
    hpTrailRoot.parent = group;
    hpTrailRoot.setPosition(hpBar.barFillMax.left, hpBar.barFillMax.centerY, 0);
    createLeftAnchoredFillNode(
      hpTrailRoot,
      'hp-trail-white',
      hpBar.barFillMax.width,
      hpBar.barFillMax.height,
      0,
      HP_TRAIL_WHITE_COLOR,
    );
    hpTrailRoot.active = false;
    this.hpTrailRoot = hpTrailRoot;

    const hpFillRoot = new CocosNode('hp-fill');
    hpFillRoot.layer = Layers.Enum.UI_2D;
    hpFillRoot.parent = group;
    hpFillRoot.setPosition(hpBar.barFillMax.left, hpBar.barFillMax.centerY, 0);
    this.hpFillRoot = hpFillRoot;

    this.hpFillHighNode = createShinedFillGroup(
      hpFillRoot,
      'hp-fill-high',
      hpBar.barFillMax.width,
      hpBar.barFillMax.height,
      HP_FILL_HIGH_COLOR,
      HP_FILL_HIGH_SHINE_COLOR,
    );
    this.hpFillMidNode = createShinedFillGroup(
      hpFillRoot,
      'hp-fill-mid',
      hpBar.barFillMax.width,
      hpBar.barFillMax.height,
      HP_FILL_MID_COLOR,
      HP_FILL_MID_SHINE_COLOR,
    );
    this.hpFillMidNode.active = false;
    this.hpFillLowNode = createShinedFillGroup(
      hpFillRoot,
      'hp-fill-low',
      hpBar.barFillMax.width,
      hpBar.barFillMax.height,
      HP_FILL_LOW_COLOR,
      HP_FILL_LOW_SHINE_COLOR,
    );
    this.hpFillLowNode.active = false;

    const hpLabel = createStyledLabel(
      group,
      'hp-label',
      hpBar.hpText,
      HUD_HP_FONT_SIZE,
      HUD_HP_LINE_HEIGHT,
      TEXT_COLOR,
    );
    hpLabel.node.setPosition(hpBar.hpLabel.x, hpBar.hpLabel.y, 0);
    this.hpLabel = hpLabel;

    // Unified XP bar + `Cấp X`/`LV X` badge directly underneath the HP bar.
    this.createXpBar(group, xpBar);

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
      this.lastHpValue,
      this.maxHpValue,
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
      this.lastHpValue,
      this.maxHpValue,
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
      t('hud.chooseDoor'),
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
   * M17 top-left XP bar + `Cấp X` / `LV X` badge mounted directly underneath the HP bar inside
   * the unified top-left plate (strictly one colour per `Graphics` node per AGENTS.md).
   */
  private createXpBar(parent: Node, xpLayout: HudLayout['xpBar']): void {
    const group = new CocosNode('hud-xp-bar');
    group.layer = Layers.Enum.UI_2D;
    group.parent = parent;
    this.xpRoot = group;

    const { badge, barTrack, barFillMax, levelLabel, progressLabel } = xpLayout;

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

    this.xpFillCyanNode = createShinedFillGroup(
      fillRoot,
      'xp-fill-cyan',
      barFillMax.width,
      barFillMax.height,
      XP_FILL_CYAN_COLOR,
      XP_FILL_HIGHLIGHT_COLOR,
    );

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
      xpLayout.levelText,
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
}

/** Two-node left-anchored bar fill + top specular highlight (strictly 1 colour per Graphics node). */
function createShinedFillGroup(
  parent: Node,
  name: string,
  width: number,
  height: number,
  mainColor: Color,
  shineColor: Color,
): Node {
  const group = new CocosNode(name);
  group.layer = Layers.Enum.UI_2D;
  group.parent = parent;
  createLeftAnchoredFillNode(group, `${name}-main`, width, height, 0, mainColor);
  const shineHeight = Math.min(2, height);
  createLeftAnchoredFillNode(
    group,
    `${name}-shine`,
    width,
    shineHeight,
    (height - shineHeight) / 2,
    shineColor,
  );
  return group;
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
