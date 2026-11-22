/**
 * Minimal HUD: heart row, gold earned in the run, room label.
 *
 * This is real UI (Canvas + its own UI_2D camera), not a world sprite: the HUD must stay
 * still when the world camera changes, and UI coordinates are in 512×288 design pixels.
 *
 * Two deliberate TODOs:
 * - `TODO(ui)`: the pack's pixel font. The staged pack has no font file (`.ttf`/`.fnt`),
 *   so the engine's system font is used. Add a font to `resources/art/ui/` and assign
 *   `Label.font`; no layout change needed.
 * - `TODO(ui)`: the gold icon + nine-path frame. The art is staged (`ui/theme-wood`) but
 *   needs its Border set in the Sprite Editor first (import-checklist §2.4), so it is not done here.
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
/** Boss health bar background — reuses the pack's wooden button, tinted per state. */
const BAR_SHEET = 'resources/art/ui/theme-wood/button_normal.png';
const BAR_RECT: TileRect = { x: 0, y: 0, width: 16, height: 8 };

const HEART_SIZE_PX = 16;
/** State 0 = empty heart (grey); state 4 = full heart (red). */
const HEART_EMPTY_INDEX = 0;
const HEART_FULL_INDEX = 4;
/** Spacing between hearts, design px (16 px heart + 2 px of breathing room). */
const HEART_SPACING_PX = 18;

const TEXT_COLOR = new CocosColor(255, 255, 255, 255);
/** Outline behind the HUD stack digit so it reads on any icon colour. */
const STACK_OUTLINE_COLOR = new CocosColor(12, 10, 16, 255);
const LABEL_FONT_SIZE = 12;

/** Rarity colours shared by skill cards and the HUD skill row. */
export const RARITY_COLORS = {
  common: new CocosColor(222, 222, 222, 255),
  rare: new CocosColor(110, 170, 255, 255),
  epic: new CocosColor(200, 140, 255, 255),
} as const;

/** Maximum skill slots on the HUD (GDD §9: at most 8). */
const SKILL_SLOTS = 8;
const SKILL_SLOT_WIDTH_PX = 34;
/** Icon 24 px + 2 px of frame on each side → the row backdrop needs ~28 px. */
const SKILL_ROW_HEIGHT_PX = 28;
/** Bottom margin of the row, design px: the 24 px icon spans y 4…28 from the room's bottom edge. */
const SKILL_ROW_BOTTOM_PX = 16;

/** One HUD skill slot: icon + rarity frame + stack count, with the abbreviation as load fallback. */
interface SkillSlot {
  readonly root: Node;
  readonly icon: Node;
  readonly frame: Graphics;
  readonly stack: Label;
  readonly fallback: Label;
  /** Skill id this slot currently shows; guards async icon loads against a stale slot. */
  id: string;
}

/** Boss health bar. */
const BOSS_BAR_WIDTH_PX = 180;
const BOSS_BAR_HEIGHT_PX = 8;
const BOSS_BAR_TOP_PX = 20;
const BOSS_FILL_COLOR = new CocosColor(232, 74, 74, 255);
const BOSS_BG_COLOR = new CocosColor(44, 30, 30, 255);

/** HUD placement, measured from the design screen's top-left / top-right edges. */
const PADDING_PX = 8;
const HEART_ROW_TOP_PX = 10;
const GOLD_ROW_TOP_PX = 28;

/** Design px per world tile: the HUD band is scaled to the world band, which shows 32×18 tiles. */
const HUD_PX_PER_TILE = 16;
/** Edge arrows sit this far inside the band border so they never touch the letterbox bar. */
const ARROW_INSET_PX = 14;
/**
 * Edge arrows must stay below the HUD's two top rows (room label over the hearts at
 * `HEART_ROW_TOP_PX`, gold over the enemies counter `GOLD_ROW_TOP_PX` lower) or an up-right arrow
 * lands on the "Enemies N" text. Row 2's bottom edge + half a label row + the arrow's own reach
 * (`drawArrow`'s farthest vertex is √(5²+5²) ≈ 7.1 px) is the smallest inset that clears them.
 */
const ARROW_TOP_INSET_PX =
  HEART_ROW_TOP_PX + GOLD_ROW_TOP_PX + (LABEL_FONT_SIZE + 2) / 2 + 8;
/** At most three arrows (#41): the nearest off-screen enemies, or the doors once clear. */
export const MAX_EDGE_ARROWS = 3;
const ARROW_FILL = new CocosColor(255, 233, 170, 235);
const ARROW_OUTLINE = new CocosColor(20, 16, 24, 220);

function heartRect(index: number): TileRect {
  return {
    x: index * HEART_SIZE_PX,
    y: 0,
    width: HEART_SIZE_PX,
    height: HEART_SIZE_PX,
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
  } | null = null;
  private roomLabel: Label | null = null;
  private goldLabel: Label | null = null;
  private shownHearts = -1;
  private shownRoom = '';
  private shownGold = -1;

  /** HUD skill slots: icon + stack, framed by rarity. Created once, hidden when empty. */
  private readonly skillSlots: SkillSlot[] = [];
  private skillRowBackdrop: Node | null = null;
  private shownSkills = '';

  /** Boss health bar: background + fill (left anchor) + name/phase label. */
  private bossRoot: Node | null = null;
  private bossFill: Node | null = null;
  private bossTitle: Label | null = null;
  private shownBoss = '';

  /** #41: enemies-left counter (hidden in a boss room) and the border arrows. */
  private enemiesLeftLabel: Label | null = null;
  private shownEnemiesLeft = -1;
  private readonly arrowNodes: Node[] = [];

  /**
   * Build the HUD. This `node` must be a child of a `Canvas` (created by bootstrap), or
   * nothing will be drawn.
   */
  async init(maxHearts: number, roomText: string): Promise<void> {
    const [texture, barTexture] = await Promise.all([
      loadPixelTexture(HEART_SHEET),
      loadPixelTexture(BAR_SHEET),
    ]);
    const frames = {
      full: sliceFrame(texture, heartRect(HEART_FULL_INDEX)),
      empty: sliceFrame(texture, heartRect(HEART_EMPTY_INDEX)),
    };
    this.frames = frames;
    const barFrame = sliceFrame(barTexture, BAR_RECT);

    const size = view.getVisibleSize();
    const left = -size.width / 2 + PADDING_PX;
    const top = size.height / 2 - HEART_ROW_TOP_PX;

    this.ensureHeartNodes(maxHearts, left, top);

    this.roomLabel = createLabel(this.node, 'room-label', roomText);
    this.roomLabel.node.setPosition(size.width / 2 - PADDING_PX, top, 0);

    // Placeholder: meta/save is not wired into the run yet (M4). Still shows 0 so the HUD has its slot.
    this.goldLabel = createLabel(this.node, 'gold-label', 'Gold 0');
    this.goldLabel.node.setPosition(left, top - GOLD_ROW_TOP_PX, 0);
    // Left anchor so the text starts at the left margin instead of being pushed off screen.
    const goldTransform: UITransform | null = this.goldLabel.node.getComponent(CocosUITransform);
    if (goldTransform !== null) goldTransform.setAnchorPoint(0, 0.5);

    this.createSkillRow(left, -size.height / 2 + SKILL_ROW_BOTTOM_PX);
    this.createBossBar(barFrame, size.height);
    this.createEnemiesLeft(size);
    this.createArrows();

    this.setRoomLabel(roomText);
    this.setHearts(maxHearts);
    this.setGold(0);
    this.setSkills([]);
  }

  /** Update the heart row; spriteFrame only changes when the heart count really changes. */
  setHearts(hearts: number): void {
    const frames = this.frames;
    if (frames === null || hearts === this.shownHearts) return;
    this.shownHearts = hearts;
    this.lastHearts = hearts;

    this.heartNodes.forEach((node, index) => {
      const sprite: Sprite | null = node.getComponent(CocosSprite);
      if (sprite === null) return;
      node.active = index < this.maxHeartNodes;
      sprite.spriteFrame = index < hearts ? frames.full : frames.empty;
    });
  }

  /** Vitality can raise the cap mid-run: add heart slots instead of under-drawing. */
  setMaxHearts(maxHearts: number): void {
    const frames = this.frames;
    if (frames === null || maxHearts === this.maxHeartNodes) return;

    const size = view.getVisibleSize();
    this.ensureHeartNodes(maxHearts, -size.width / 2 + PADDING_PX, size.height / 2 - HEART_ROW_TOP_PX);
    // Force a redraw: the slot count changed but the current heart count may not have.
    this.shownHearts = -1;
    this.setHearts(this.lastHearts);
  }

  /** The `3/9` label from `RunState.roomLabel`. */
  setRoomLabel(text: string): void {
    const label = this.roomLabel;
    if (label === null || text === this.shownRoom) return;
    this.shownRoom = text;
    label.string = text;
    // Right-anchored label so its right edge stays PADDING_PX from the margin whatever the text length.
    const transform: UITransform | null = label.node.getComponent(CocosUITransform);
    if (transform !== null) transform.setAnchorPoint(1, 0.5);
    label.node.setPosition(view.getVisibleSize().width / 2 - PADDING_PX, label.node.position.y, 0);
  }

  /**
   * Gold cell position in canvas design pixels (already multiplied by the HUD scale) — coins
   * fly from the world to exactly here (see `feel-view.ts`).
   */
  goldAnchor(): Vec2 {
    const label = this.goldLabel;
    if (label === null) return { x: 0, y: 0 };
    const scale = this.node.scale.x;
    return { x: label.node.position.x * scale, y: label.node.position.y * scale };
  }

  /** Gold earned in the run (M5); the shop shows the save total. */
  setGold(gold: number): void {
    const label = this.goldLabel;
    if (label === null || gold === this.shownGold) return;
    this.shownGold = gold;
    label.string = `Gold ${gold}`;
  }

  /**
   * Skills picked up: icon + stack count (GDD §9 "skill icons, at most 8"), with the rarity colour
   * on a thin frame and the stack number. Icon art comes from the pack (`core/skills/icons.ts`);
   * while it loads — or if it fails — the 2-letter abbreviation stands in so no slot is blank.
   */
  setSkills(entries: readonly OwnedSkillStacks[]): void {
    // With no skills, hide the dark strip too — do not leave an empty black bar on the HUD.
    if (this.skillRowBackdrop !== null) this.skillRowBackdrop.active = entries.length > 0;
    const signature = entries
      .map((entry) => `${entry.def.id}:${entry.stacks}`)
      .join(',');
    if (signature === this.shownSkills) return;
    this.shownSkills = signature;

    const shown = entries.slice(0, SKILL_SLOTS);
    for (let index = 0; index < this.skillSlots.length; index += 1) {
      const slot = this.skillSlots[index];
      if (slot === undefined) continue;
      const entry = shown[index];
      if (entry === undefined) {
        slot.id = '';
        slot.root.active = false;
        continue;
      }

      const color = RARITY_COLORS[entry.def.rarity];
      slot.id = entry.def.id;
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

      // Not loaded yet: show the abbreviation until the texture arrives.
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
          // Broken art must not leave a hole: keep the abbreviation visible.
          if (slot.id !== entry.def.id) return;
          slot.icon.active = false;
          slot.fallback.node.active = true;
        });
    }

    // More than 8 skills: the last slot shows the remainder instead of silently truncating.
    const extra = entries.length - SKILL_SLOTS;
    if (extra > 0) {
      const last = this.skillSlots[SKILL_SLOTS - 1];
      if (last !== undefined) {
        last.id = '';
        last.icon.active = false;
        last.stack.string = '';
        last.fallback.string = `+${extra}`;
        last.fallback.color = TEXT_COLOR;
        last.fallback.node.active = true;
        drawSkillFrame(last.frame, TEXT_COLOR);
      }
    }
  }

  /**
   * Enemies left in the room (#41): alive + not yet spawned. `null` hides the counter (boss room,
   * menus). A cleared room shows `Enemies 0` behind the ROOM CLEAR banner.
   */
  setEnemiesLeft(count: number | null): void {
    const label = this.enemiesLeftLabel;
    if (label === null) return;

    if (count === null) {
      label.string = '';
      this.shownEnemiesLeft = -1;
      return;
    }

    const shown = Math.max(0, Math.floor(count));
    if (shown === this.shownEnemiesLeft) return;
    this.shownEnemiesLeft = shown;
    label.string = `Enemies ${shown}`;
  }

  /**
   * Border arrows (#41). Each entry is a target position **relative to the camera centre** in room
   * tiles (y down). The HUD band shows exactly one 32×18 screen, so a tile offset maps to
   * `HUD_PX_PER_TILE` design px; the ray is clamped to the band inset and the arrow turned to face
   * the target. The top edge uses `ARROW_TOP_INSET_PX` instead, so an arrow never covers the
   * hearts / gold / room / enemies text. More than `MAX_EDGE_ARROWS` entries are ignored.
   */
  setArrows(offsets: readonly Vec2[]): void {
    const size = view.getVisibleSize();
    const halfWidth = size.width / 2 - ARROW_INSET_PX;
    const topLimit = size.height / 2 - ARROW_TOP_INSET_PX;
    const bottomLimit = size.height / 2 - ARROW_INSET_PX;

    for (let index = 0; index < this.arrowNodes.length; index += 1) {
      const node = this.arrowNodes[index];
      if (node === null) continue;
      const offset = offsets[index];
      if (offset === undefined) {
        if (node.active) node.active = false;
        continue;
      }

      // y down (room tiles) → y up (UI px).
      const px = offset.x * HUD_PX_PER_TILE;
      const py = -offset.y * HUD_PX_PER_TILE;
      const verticalLimit = py >= 0 ? topLimit : bottomLimit;
      const scale = Math.min(
        Math.abs(px) > 1e-6 ? halfWidth / Math.abs(px) : Number.POSITIVE_INFINITY,
        Math.abs(py) > 1e-6 ? verticalLimit / Math.abs(py) : Number.POSITIVE_INFINITY,
      );
      const clamped = Number.isFinite(scale) ? Math.min(1, scale) : 1;

      node.setPosition(px * clamped, py * clamped, 0);
      node.angle = (Math.atan2(py, px) * 180) / Math.PI;
      if (!node.active) node.active = true;
    }
  }

  /** Show/hide the boss health bar. `hp === null` hides it. */
  setBoss(
    info: { readonly name: string; readonly hp: number; readonly maxHp: number; readonly phase: number } | null,
  ): void {
    const root = this.bossRoot;
    const fill = this.bossFill;
    if (root === null || fill === null) return;

    if (info === null) {
      if (root.active) root.active = false;
      this.shownBoss = '';
      return;
    }

    if (!root.active) root.active = true;
    const key = `${info.name}:${info.phase}`;
    if (key !== this.shownBoss) {
      this.shownBoss = key;
      const title = this.bossTitle;
      if (title !== null) title.string = `${info.name}  ·  PHASE ${info.phase}`;
    }

    const fraction = info.maxHp > 0 ? Math.min(1, Math.max(0, info.hp / info.maxHp)) : 0;
    // Left anchor: scale.x shortens the bar from the right.
    fill.setScale(fraction, 1, 1);
  }

  /** #41: "Enemies 12" under the room label (top-right), right-anchored like the room label. */
  private createEnemiesLeft(size: { readonly width: number; readonly height: number }): void {
    const label = createLabel(this.node, 'enemies-left', '');
    const top = size.height / 2 - HEART_ROW_TOP_PX;
    label.node.setPosition(size.width / 2 - PADDING_PX, top - GOLD_ROW_TOP_PX, 0);
    const transform: UITransform | null = label.node.getComponent(CocosUITransform);
    if (transform !== null) transform.setAnchorPoint(1, 0.5);
    this.enemiesLeftLabel = label;
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

  private createSkillRow(left: number, y: number): void {
    // Semi-transparent dark backdrop: icons must read on gold/green/white floors.
    const width = SKILL_SLOTS * SKILL_SLOT_WIDTH_PX - 8;
    const backdrop = createBackdropPanel(this.node, 'skill-row-backdrop', width, SKILL_ROW_HEIGHT_PX, 150);
    backdrop.setPosition(left + width / 2 - 4, y, 0);
    backdrop.active = false;
    this.skillRowBackdrop = backdrop;

    for (let index = 0; index < SKILL_SLOTS; index += 1) {
      const slotWidth = SKILL_ICON_SIZE_PX + 2;
      const root = new CocosNode(`skill-${index}`);
      root.layer = Layers.Enum.UI_2D;
      root.parent = this.node;
      root.setPosition(left + index * SKILL_SLOT_WIDTH_PX + slotWidth / 2 - 1, y, 0);

      const icon = new CocosNode('icon');
      icon.layer = Layers.Enum.UI_2D;
      icon.parent = root;
      const iconSprite: Sprite = icon.addComponent(CocosSprite);
      // CUSTOM size mode: the content size below decides the drawn size (not the 24 px texture).
      iconSprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
      iconSprite.trim = false;
      const iconTransform: UITransform | null = icon.getComponent(CocosUITransform);
      if (iconTransform !== null) {
        // ×1 = 24 px: an integer multiple keeps the pixel art crisp under nearest filtering.
        iconTransform.setContentSize(SKILL_ICON_SIZE_PX, SKILL_ICON_SIZE_PX);
      }

      // Thin rarity frame around the icon (the rarity colour must stay visible at 1 stack).
      const frameNode = new CocosNode('frame');
      frameNode.layer = Layers.Enum.UI_2D;
      frameNode.parent = root;
      const frame: Graphics = frameNode.addComponent(CocosGraphics);
      drawSkillFrame(frame, RARITY_COLORS.common);

      const stack = createLabel(root, 'stack', '');
      stack.fontSize = 9;
      stack.lineHeight = 10;
      // White with a dark 1 px outline: a rarity-coloured digit on a same-colour icon (blue "2" on
      // Crit Eye, grey "3" on Sharpen) is unreadable. Rarity colour already lives on the frame.
      stack.color = TEXT_COLOR;
      stack.enableOutline = true;
      stack.outlineColor = STACK_OUTLINE_COLOR;
      stack.outlineWidth = 1;
      // Bottom-right corner of the icon; a single digit never reaches the next slot.
      stack.node.setPosition(SKILL_ICON_SIZE_PX / 2 - 3, -SKILL_ICON_SIZE_PX / 2 + 4, 0);
      const stackTransform: UITransform | null = stack.node.getComponent(CocosUITransform);
      if (stackTransform !== null) stackTransform.setAnchorPoint(0, 0.5);

      // Load-failure fallback: the 2-letter abbreviation behind the icon.
      const fallback = createLabel(root, 'fallback', '');
      fallback.fontSize = 9;
      fallback.lineHeight = 11;

      root.active = false;
      this.skillSlots.push({ root, icon, frame, stack, fallback, id: '' });
    }
  }

  private createBossBar(
    frame: SpriteFrame,
    height: number,
  ): void {
    const root = new CocosNode('boss-bar');
    root.layer = Layers.Enum.UI_2D;
    root.parent = this.node;
    root.setPosition(0, height / 2 - BOSS_BAR_TOP_PX - BOSS_BAR_HEIGHT_PX, 0);

    this.makeBar('boss-bg', frame, BOSS_BG_COLOR, root);
    this.bossFill = this.makeBar('boss-fill', frame, BOSS_FILL_COLOR, root);

    const title = createLabel(root, 'boss-title', '');
    title.fontSize = 10;
    title.lineHeight = 12;
    title.node.setPosition(0, BOSS_BAR_HEIGHT_PX + 2, 0);
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
      transform.setContentSize(BOSS_BAR_WIDTH_PX, BOSS_BAR_HEIGHT_PX);
      // Left anchor: scale.x shrinks from right to left, so the bar's start does not jump.
      transform.setAnchorPoint(0, 0.5);
    }
    node.setPosition(-BOSS_BAR_WIDTH_PX / 2, 0, 0);
    return node;
  }

  /** Add heart slots as the cap grows; surplus slots are hidden rather than destroyed. */
  private ensureHeartNodes(maxHearts: number, left: number, top: number): void {
    const frames = this.frames;
    if (frames === null) return;
    this.maxHeartNodes = Math.max(0, Math.floor(maxHearts));

    for (let index = 0; index < this.maxHeartNodes; index += 1) {
      if (this.heartNodes[index] !== undefined) continue;
      const node = this.makeSprite(`heart-${index}`, frames.full);
      node.setPosition(left + index * HEART_SPACING_PX + HEART_SIZE_PX / 2, top, 0);
      this.heartNodes.push(node);
    }
  }

  private makeSprite(name: string, frame: SpriteFrame): Node {
    const node = new CocosNode(name);
    node.layer = Layers.Enum.UI_2D;
    node.parent = this.node;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.spriteFrame = frame;

    const transform: UITransform | null = node.getComponent(CocosUITransform);
    if (transform !== null) transform.setContentSize(HEART_SIZE_PX, HEART_SIZE_PX);

    return node;
  }
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
 * Used for the HUD skill row and the centre-screen banner: chapter 3's bright/gold floor makes
 * white text or a gold banner unreadable without a backdrop.
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
 * Create a `Label` node under `parent` (which must be under a Canvas).
 *
 * Exported so `bootstrap` can reuse it for the load-error screen — that screen needs big red
 * text regardless of whether the HUD finished building.
 */
export function createLabel(parent: Node, name: string, text: string): Label {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const label: Label = node.addComponent(CocosLabel);
  label.string = text;
  label.fontSize = LABEL_FONT_SIZE;
  label.lineHeight = LABEL_FONT_SIZE + 2;
  label.color = TEXT_COLOR;
  // The pack's pixel font (NormalFont.ttf); it loads async so the label switches when it arrives.
  applyPixelFont(label);

  return label;
}
