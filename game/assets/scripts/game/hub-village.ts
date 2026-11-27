/**
 * Village Hub presentation adapters (M21, #91): the floating localized `[E]` interaction prompt
 * and the full-screen black fade used when entering/leaving the village.
 *
 * Pure logic lives in `core/hub/`; this file only turns a `HubPromptDescriptor` into a Label and
 * a fade alpha into a `UIOpacity`. It is deliberately thin so `bootstrap` stays about flow.
 */
import {
  Button as CocosButton,
  Graphics as CocosGraphics,
  Layers,
  Node as CocosNode,
  UIOpacity as CocosUIOpacity,
  UITransform as CocosUITransform,
  Color as CocosColor,
} from 'cc';
import type { HubPromptDescriptor } from '../core/hub';
import {
  VILLAGE_QUICK_ITEMS,
  VILLAGE_QUICK_LABEL_KEYS,
  type VillageQuickItemId,
} from '../core/hub/quick-access';
import { t } from '../core/i18n';
import type { Vec2 } from '../core/math/vec2';
import { createBackdropPanel, createLabel } from './hud';
import { visibleUiSize } from './screens/menu';

type Node = InstanceType<typeof CocosNode>;
type Button = InstanceType<typeof CocosButton>;
type Label = ReturnType<typeof createLabel>;
type UIOpacity = InstanceType<typeof CocosUIOpacity>;

/** Design resolution the UI canvas uses (same constant as `bootstrap`). */
const DESIGN_WIDTH = 512;
const DESIGN_HEIGHT = 288;
/** One room tile is 16 design px at `hudScale = 1`. */
const TILE_PX = 16;
const PROMPT_FONT_SIZE = 10;
const PROMPT_HEIGHT = 20;
/** Wide enough for the longest localized prompt (`[E] Ra khỏi cửa hàng`) at this font size. */
const PROMPT_WIDTH = 168;

/** Corner quick-access bar + `Esc` village menu (#94): compact, pixel-font labels. */
const QUICK_FONT_SIZE = 10;
const QUICK_HEIGHT = 20;
const QUICK_GAP = 6;
const QUICK_EDGE = 8;
const QUICK_PAD_X = 10;
const QUICK_BOTTOM_MARGIN = 8;
const MENU_BUTTON_WIDTH = 220;
const MENU_BUTTON_HEIGHT = 26;
const MENU_BUTTON_GAP = 8;
const MENU_TITLE_FONT_SIZE = 14;

/** Camera state the prompt needs to project a world anchor into UI coordinates. */
export interface HubPromptCamera {
  /** Camera centre in `LevelData` tiles (top-left origin, y down). */
  readonly position: Vec2;
  /** World band / UI band ratio from `WorldCamera.hudScale`. */
  readonly hudScale: number;
}

export class HubVillageView {
  private readonly promptRoot: Node;
  private readonly promptLabel: Label;
  private readonly goldLabel: Label;
  private readonly fadeRoot: Node;
  private readonly fadeOpacity: UIOpacity;
  /** Corner quick-access bar (#94); hidden while a dialog, the Codex or a fade owns input. */
  private readonly quickRoot: Node;
  /** `Esc` village menu (#94) with the same three shortcuts plus a mouse Close. */
  private readonly menuRoot: Node;
  private quickAllowed = false;
  private menuOpen = false;
  private onQuickItem: ((item: VillageQuickItemId) => void) | null = null;
  private readonly onQuickClick = (item: VillageQuickItemId): void => {
    this.onQuickItem?.(item);
  };
  private onActivate: (() => void) | null = null;
  private destroyed = false;

  constructor(parent: Node) {
    this.promptRoot = new CocosNode('hub-prompt');
    this.promptRoot.layer = Layers.Enum.UI_2D;
    this.promptRoot.parent = parent;
    const promptTransform = this.promptRoot.addComponent(CocosUITransform);
    promptTransform.setContentSize(PROMPT_WIDTH, PROMPT_HEIGHT);
    this.promptRoot.active = false;

    createBackdropPanel(this.promptRoot, 'hub-prompt-backdrop', PROMPT_WIDTH, PROMPT_HEIGHT, 190);

    this.promptLabel = createLabel(this.promptRoot, 'hub-prompt-text', '');
    this.promptLabel.fontSize = PROMPT_FONT_SIZE;
    this.promptLabel.lineHeight = PROMPT_FONT_SIZE + 2;
    this.promptLabel.node.setPosition(0, 0, 0);

    const button: Button = this.promptRoot.addComponent(CocosButton);
    button.transition = CocosButton.Transition.NONE;
    this.promptRoot.on(CocosButton.EventType.CLICK, () => {
      this.onActivate?.();
    });

    // Small persistent gold line (Results → Village keeps the gold; no combat HUD in the hub).
    this.goldLabel = createLabel(parent, 'hub-gold', '');
    this.goldLabel.fontSize = PROMPT_FONT_SIZE;
    this.goldLabel.lineHeight = PROMPT_FONT_SIZE + 2;
    this.goldLabel.node.setPosition(-200, DESIGN_HEIGHT / 2 - 14, 0);

    this.quickRoot = new CocosNode('hub-quick-bar');
    this.quickRoot.layer = Layers.Enum.UI_2D;
    this.quickRoot.parent = parent;
    this.quickRoot.active = false;
    this.buildQuickBar();

    this.menuRoot = new CocosNode('hub-village-menu');
    this.menuRoot.layer = Layers.Enum.UI_2D;
    this.menuRoot.parent = parent;
    this.menuRoot.active = false;
    this.buildVillageMenu();

    this.fadeRoot = new CocosNode('hub-fade');
    this.fadeRoot.layer = Layers.Enum.UI_2D;
    this.fadeRoot.parent = parent;
    const graphics: InstanceType<typeof CocosGraphics> = this.fadeRoot.addComponent(CocosGraphics);
    graphics.fillColor = new CocosColor(0, 0, 0, 255);
    graphics.rect(-DESIGN_WIDTH / 2, -DESIGN_HEIGHT / 2, DESIGN_WIDTH, DESIGN_HEIGHT);
    graphics.fill();
    this.fadeOpacity = this.fadeRoot.addComponent(CocosUIOpacity);
    this.fadeOpacity.opacity = 0;
    this.fadeRoot.active = false;
  }

  /** Called when the player clicks a shortcut on the corner bar or the `Esc` village menu. */
  setQuickHandler(handler: ((item: VillageQuickItemId) => void) | null): void {
    this.onQuickItem = handler;
  }

  /** Show/hide the corner bar; the village menu, a dialog, the Codex or a fade hides it. */
  setQuickVisible(visible: boolean): void {
    if (this.destroyed) return;
    this.quickAllowed = visible;
    this.syncQuickVisibility();
  }

  /** Toggle the `Esc` village menu (same three shortcuts plus a mouse Close). */
  setMenuOpen(open: boolean): void {
    if (this.destroyed) return;
    if (this.menuOpen === open) return;
    this.menuOpen = open;
    this.menuRoot.active = open;
    this.syncQuickVisibility();
  }

  isMenuOpen(): boolean {
    return this.menuOpen;
  }

  /** Whether the corner bar is actually drawn (proof + hide rules). */
  isQuickVisible(): boolean {
    return this.quickRoot.active;
  }

  private syncQuickVisibility(): void {
    this.quickRoot.active = this.quickAllowed && !this.menuOpen;
  }

  /** One compact wooden plate + centered pixel label, clickable as a whole. */
  private addHubButton(
    parent: Node,
    name: string,
    text: string,
    width: number,
    height: number,
    x: number,
    y: number,
    onClick: () => void,
  ): void {
    const node = new CocosNode(name);
    node.layer = Layers.Enum.UI_2D;
    node.parent = parent;
    const transform = node.addComponent(CocosUITransform);
    transform.setContentSize(width, height);
    node.setPosition(x, y, 0);

    createBackdropPanel(node, `${name}-plate`, width, height, 210);
    const label = createLabel(node, `${name}-text`, text);
    label.fontSize = QUICK_FONT_SIZE;
    label.lineHeight = QUICK_FONT_SIZE + 2;
    label.node.setPosition(0, 0, 0);

    const button: Button = node.addComponent(CocosButton);
    button.transition = CocosButton.Transition.NONE;
    node.on(CocosButton.EventType.CLICK, onClick);
  }

  /** Bottom-right bar: `Cổng Xuất Chinh · Võ Đường · Cài Đặt` (widths fit the localized text). */
  private buildQuickBar(): void {
    const labels = VILLAGE_QUICK_ITEMS.map((item) => t(VILLAGE_QUICK_LABEL_KEYS[item]));
    const widths = labels.map((text) =>
      Math.max(
        56,
        Math.ceil(text.length * QUICK_FONT_SIZE * 0.68) + QUICK_PAD_X * 2,
      ),
    );
    const total = widths.reduce((sum, width) => sum + width, 0) + QUICK_GAP * (widths.length - 1);
    let x = DESIGN_WIDTH / 2 - QUICK_EDGE - total;
    const y = -DESIGN_HEIGHT / 2 + QUICK_HEIGHT / 2 + QUICK_BOTTOM_MARGIN;

    VILLAGE_QUICK_ITEMS.forEach((item, index) => {
      const width = widths[index] ?? 56;
      this.addHubButton(
        this.quickRoot,
        `hub-quick-${item}`,
        labels[index] ?? item,
        width,
        QUICK_HEIGHT,
        x + width / 2,
        y,
        () => this.onQuickClick(item),
      );
      x += width + QUICK_GAP;
    });
  }

  /** `Esc` village menu: dark backdrop, title and the same three shortcuts as large rows. */
  private buildVillageMenu(): void {
    const size = visibleUiSize();
    createBackdropPanel(this.menuRoot, 'hub-menu-backdrop', size.width, size.height, 205);

    const title = createLabel(this.menuRoot, 'hub-menu-title', t('village.quick.menuTitle'));
    title.fontSize = MENU_TITLE_FONT_SIZE;
    title.lineHeight = MENU_TITLE_FONT_SIZE + 3;
    title.node.setPosition(0, size.height / 2 - 34, 0);

    const startY = 24;
    const step = MENU_BUTTON_HEIGHT + MENU_BUTTON_GAP;
    VILLAGE_QUICK_ITEMS.forEach((item, index) => {
      this.addHubButton(
        this.menuRoot,
        `hub-menu-${item}`,
        t(VILLAGE_QUICK_LABEL_KEYS[item]),
        MENU_BUTTON_WIDTH,
        MENU_BUTTON_HEIGHT,
        0,
        startY - index * step,
        () => {
          this.setMenuOpen(false);
          this.onQuickClick(item);
        },
      );
    });

    this.addHubButton(
      this.menuRoot,
      'hub-menu-close',
      `[Esc] ${t('common.back')}`,
      MENU_BUTTON_WIDTH,
      MENU_BUTTON_HEIGHT,
      0,
      startY - VILLAGE_QUICK_ITEMS.length * step,
      () => this.setMenuOpen(false),
    );
  }

  /** Gold kept from the last run, shown top-left (`Vàng {gold}` / `Gold {gold}`). */
  setGold(gold: number): void {
    if (this.destroyed) return;
    this.goldLabel.string = t('title.goldLine', { gold: Math.max(0, Math.floor(gold)) });
  }

  /** Called when the player clicks the floating prompt. */
  setPromptHandler(handler: (() => void) | null): void {
    this.onActivate = handler;
  }

  /** Show the localized prompt above `descriptor.anchor`, or hide it for `null`. */
  showPrompt(
    descriptor: HubPromptDescriptor | null,
    camera: HubPromptCamera,
    roomRows: number,
  ): void {
    if (this.destroyed) return;
    if (descriptor === null) {
      if (this.promptRoot.active) this.promptRoot.active = false;
      return;
    }

    const text = `${descriptor.keyHint} ${t(descriptor.promptKey)}`;
    if (this.promptLabel.string !== text) {
      this.promptLabel.string = text;
    }

    const scale = Number.isFinite(camera.hudScale) && camera.hudScale > 0 ? camera.hudScale : 1;
    const worldX = descriptor.anchor.x;
    const worldY = roomRows - descriptor.anchor.y + 0.9;
    const centreY = roomRows - camera.position.y;
    this.promptRoot.setPosition(
      (worldX - camera.position.x) * TILE_PX * scale,
      (worldY - centreY) * TILE_PX * scale,
      0,
    );
    if (!this.promptRoot.active) this.promptRoot.active = true;
  }

  /** `0` = clear, `1` = full black. */
  setFade(alpha: number): void {
    if (this.destroyed) return;
    const clamped = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
    this.fadeOpacity.opacity = Math.round(clamped * 255);
    const active = clamped > 0.001;
    if (this.fadeRoot.active !== active) this.fadeRoot.active = active;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onActivate = null;
    this.onQuickItem = null;
    this.promptRoot.destroy();
    this.goldLabel.node.destroy();
    this.quickRoot.destroy();
    this.menuRoot.destroy();
    this.fadeRoot.destroy();
  }
}
