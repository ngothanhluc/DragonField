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
import { t } from '../core/i18n';
import type { Vec2 } from '../core/math/vec2';
import { createBackdropPanel, createLabel } from './hud';

type Node = InstanceType<typeof CocosNode>;
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

    const button: InstanceType<typeof CocosButton> = this.promptRoot.addComponent(CocosButton);
    button.transition = CocosButton.Transition.NONE;
    this.promptRoot.on(CocosButton.EventType.CLICK, () => {
      this.onActivate?.();
    });

    // Small persistent gold line (Results → Village keeps the gold; no combat HUD in the hub).
    this.goldLabel = createLabel(parent, 'hub-gold', '');
    this.goldLabel.fontSize = PROMPT_FONT_SIZE;
    this.goldLabel.lineHeight = PROMPT_FONT_SIZE + 2;
    this.goldLabel.node.setPosition(-200, DESIGN_HEIGHT / 2 - 14, 0);

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
    this.promptRoot.destroy();
    this.goldLabel.node.destroy();
    this.fadeRoot.destroy();
  }
}
