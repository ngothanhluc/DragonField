/**
 * Reusable RPG `DialogBox` (M21 #92): bottom panel, 64×64 nearest-filtered portrait, speaker
 * name, typewriter body text, a continue hint and (for the Shopkeeper/Dojo) a choice list.
 *
 * Pure content comes from `dialogBoxView()` in `core/hub/village-life.ts`; this file only draws
 * it and reports keys/clicks. It is reused by the Shop interior (#93) and the Dojo (#94).
 *
 * Input: `E` is routed by `bootstrap`'s hub key handler (advance); this box listens for
 * `W/S`/arrows (move the highlight) and `Enter`/`Space` (advance/confirm) on a `document`
 * capture listener attached in the constructor, before any texture `await` — a key pressed on
 * the frame the box opens is not lost.
 */
import {
  Button as CocosButton,
  Color as CocosColor,
  Graphics as CocosGraphics,
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import type { SpriteFrame as CocosSpriteFrame } from 'cc';
import type { DialogPortraitSpec } from '../core/hub';
import type { DialogBoxView } from '../core/hub/village-life';
import { t } from '../core/i18n';
import { loadPixelTexture } from './assets/texture-cache';
import { createBackdropPanel, createLabel } from './hud';
import { sliceSliced } from './screens/menu';
import { sliceFrame, type TileRect } from './level-view';

type Button = InstanceType<typeof CocosButton>;
type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Label = InstanceType<typeof CocosLabel>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = InstanceType<typeof CocosSpriteFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** Design-resolution canvas (same as `hub-village.ts`). */
const DESIGN_WIDTH = 512;
const DESIGN_HEIGHT = 288;

const PANEL_WIDTH = 480;
const PANEL_HEIGHT = 104;
/** Panel centre: bottom edge sits 6 design px above the canvas bottom. */
const PANEL_Y = -DESIGN_HEIGHT / 2 + 6 + PANEL_HEIGHT / 2;

const PORTRAIT_SIZE = 64;
const PORTRAIT_X = -PANEL_WIDTH / 2 + 8 + PORTRAIT_SIZE / 2;
const PORTRAIT_Y = PANEL_HEIGHT / 2 - 8 - PORTRAIT_SIZE / 2;

const TEXT_LEFT = -PANEL_WIDTH / 2 + 80;
const TEXT_RIGHT = PANEL_WIDTH / 2 - 8;
const TEXT_WIDTH = TEXT_RIGHT - TEXT_LEFT;
const NAME_Y = PANEL_HEIGHT / 2 - 14;
const BODY_TOP = PANEL_HEIGHT / 2 - 28;
const NAME_FONT_SIZE = 11;
const BODY_FONT_SIZE = 10;
const BODY_LINE_HEIGHT = 13;
const HINT_FONT_SIZE = 9;
/** Choice rows sit under the body; the box never shows more than the Shopkeeper's 3. */
const CHOICE_FIRST_Y = -22;
const CHOICE_STEP_Y = 12;
const CHOICE_ROW_HEIGHT = 11;
const MAX_CHOICE_ROWS = 3;

/** Inner square of the theme-wood frame (the outer square would double-frame, see AGENTS.md). */
const PANEL_SHEET = 'resources/art/ui/theme-wood/nine_path_panel_interior.png';
const PANEL_RECT: TileRect = { x: 0, y: 0, width: 16, height: 16 };
const PANEL_BORDERS = { left: 4, right: 4, top: 4, bottom: 4 } as const;

const PANEL_TINT = new CocosColor(150, 110, 90, 255);
const NAME_COLOR = new CocosColor(255, 230, 120, 255);
const TEXT_COLOR = new CocosColor(238, 238, 238, 255);
const MUTED_COLOR = new CocosColor(180, 180, 180, 255);
const CHOICE_COLOR = new CocosColor(226, 226, 226, 255);
const CHOICE_SELECTED_COLOR = new CocosColor(255, 236, 150, 255);
const HIGHLIGHT_COLOR = new CocosColor(84, 58, 40, 220);

export interface DialogBoxOptions {
  readonly parent: Node;
  /** Advance/confirm (`E`, `Enter`, `Space`, or a click on the panel). */
  readonly onAdvance: () => void;
  /** Move the highlight (`W/S`, arrows). */
  readonly onMoveChoice: (delta: number) => void;
  /** A choice row was clicked. */
  readonly onSelectChoice: (index: number) => void;
}

/** One choice row: its click target and the label drawn over it. */
interface ChoiceRow {
  readonly hit: Node;
  readonly label: Label;
}

export class DialogBox {
  private readonly root: Node;
  private readonly panel: Node;
  private readonly nameLabel: Label;
  private readonly bodyLabel: Label;
  private readonly hintLabel: Label;
  private readonly highlight: Node;
  private readonly portraitNode: Node;
  private readonly rows: ChoiceRow[] = [];
  private portraitSpeaker: string | null = null;
  private portraitToken = 0;
  /** Set by a row click so the panel's own click (bubbled) does not also advance. */
  private swallowPanelClick = false;
  private visible = false;
  private destroyed = false;
  private readonly options: DialogBoxOptions;

  constructor(options: DialogBoxOptions) {
    this.options = options;
    this.root = new CocosNode('dialog-box');
    this.root.layer = Layers.Enum.UI_2D;
    this.root.parent = options.parent;
    this.root.active = false;

    this.panel = new CocosNode('dialog-panel');
    this.panel.layer = Layers.Enum.UI_2D;
    this.panel.parent = this.root;
    this.panel.setPosition(0, PANEL_Y, 0);
    const panelTransform: UITransform = this.panel.addComponent(CocosUITransform);
    panelTransform.setContentSize(PANEL_WIDTH, PANEL_HEIGHT);

    // Dark base first (visible even before the wood frame texture resolves).
    createBackdropPanel(this.panel, 'dialog-panel-base', PANEL_WIDTH, PANEL_HEIGHT, 225);
    void this.loadPanelFrame();

    const button: Button = this.panel.addComponent(CocosButton);
    button.transition = CocosButton.Transition.NONE;
    this.panel.on(CocosButton.EventType.CLICK, () => {
      if (this.swallowPanelClick) {
        this.swallowPanelClick = false;
        return;
      }
      this.options.onAdvance();
    });

    // 64×64 portrait slot: a dark well + 1px gold rim + the nearest-filtered faceset on top.
    const well = new CocosNode('dialog-portrait-well');
    well.layer = Layers.Enum.UI_2D;
    well.parent = this.panel;
    well.setPosition(PORTRAIT_X, PORTRAIT_Y, 0);
    const wellGraphics: Graphics = well.addComponent(CocosGraphics);
    wellGraphics.fillColor = new CocosColor(18, 14, 10, 255);
    wellGraphics.rect(-PORTRAIT_SIZE / 2 - 2, -PORTRAIT_SIZE / 2 - 2, PORTRAIT_SIZE + 4, PORTRAIT_SIZE + 4);
    wellGraphics.fill();

    this.portraitNode = new CocosNode('dialog-portrait');
    this.portraitNode.layer = Layers.Enum.UI_2D;
    this.portraitNode.parent = this.panel;
    this.portraitNode.setPosition(PORTRAIT_X, PORTRAIT_Y, 0);
    const portraitSprite: Sprite = this.portraitNode.addComponent(CocosSprite);
    portraitSprite.type = CocosSprite.Type.SIMPLE;
    portraitSprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
    portraitSprite.trim = false;
    const portraitTransform: UITransform =
      this.portraitNode.getComponent(CocosUITransform) ?? this.portraitNode.addComponent(CocosUITransform);
    portraitTransform.setContentSize(PORTRAIT_SIZE, PORTRAIT_SIZE);

    this.nameLabel = this.createLeftLabel('dialog-name', NAME_Y, NAME_FONT_SIZE, NAME_COLOR);
    this.bodyLabel = this.createWrappedLabel();
    this.hintLabel = createLabel(this.panel, 'dialog-continue-hint', t('hub.dialog.continueHint'));
    this.hintLabel.fontSize = HINT_FONT_SIZE;
    this.hintLabel.lineHeight = HINT_FONT_SIZE + 2;
    this.hintLabel.color = MUTED_COLOR;
    const hintTransform: UITransform | null = this.hintLabel.node.getComponent(CocosUITransform);
    if (hintTransform !== null) hintTransform.setAnchorPoint(1, 0);
    this.hintLabel.node.setPosition(TEXT_RIGHT, -PANEL_HEIGHT / 2 + 4, 0);
    this.hintLabel.node.active = false;

    this.highlight = new CocosNode('dialog-choice-highlight');
    this.highlight.layer = Layers.Enum.UI_2D;
    this.highlight.parent = this.panel;
    const highlightGraphics: Graphics = this.highlight.addComponent(CocosGraphics);
    highlightGraphics.fillColor = HIGHLIGHT_COLOR;
    highlightGraphics.rect(0, -CHOICE_ROW_HEIGHT / 2, TEXT_WIDTH, CHOICE_ROW_HEIGHT);
    highlightGraphics.fill();
    this.highlight.setPosition(TEXT_LEFT, CHOICE_FIRST_Y, 0);
    this.highlight.active = false;

    for (let index = 0; index < MAX_CHOICE_ROWS; index += 1) {
      this.rows.push(this.createChoiceRow(index));
    }

    // Keys are attached here (synchronously), never after a texture `await` (AGENTS.md trap).
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  /** True while the box is on screen (bootstrap locks the player and hides the `[E]` prompt). */
  get isVisible(): boolean {
    return this.visible && !this.destroyed;
  }

  /** Draw one view-model frame; `null` hides the box. */
  render(view: DialogBoxView | null): void {
    if (this.destroyed) return;
    if (view === null) {
      this.visible = false;
      this.root.active = false;
      return;
    }

    this.visible = true;
    this.root.active = true;
    if (this.nameLabel.string !== view.speakerName) this.nameLabel.string = view.speakerName;
    if (this.bodyLabel.string !== view.text) this.bodyLabel.string = view.text;
    this.hintLabel.node.active = view.showContinueHint;
    this.syncPortrait(view.portrait);

    const choices = view.choices;
    for (let index = 0; index < this.rows.length; index += 1) {
      const row = this.rows[index]!;
      const choice = choices[index];
      row.hit.active = choice !== undefined;
      row.label.node.active = choice !== undefined;
      if (choice === undefined) continue;
      const y = CHOICE_FIRST_Y - index * CHOICE_STEP_Y;
      row.hit.setPosition(TEXT_LEFT + TEXT_WIDTH / 2, y, 0);
      row.label.node.setPosition(TEXT_LEFT + 6, y, 0);
      row.label.color = choice.selected ? CHOICE_SELECTED_COLOR : CHOICE_COLOR;
      if (row.label.string !== choice.label) row.label.string = choice.label;
      if (choice.selected) this.highlight.setPosition(TEXT_LEFT, y, 0);
    }
    this.highlight.active = choices.some((choice) => choice.selected);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.root.destroy();
  }

  private createLeftLabel(name: string, y: number, fontSize: number, color: Color): Label {
    const label = createLabel(this.panel, name, '');
    label.fontSize = fontSize;
    label.lineHeight = fontSize + 2;
    label.color = color;
    const transform: UITransform | null = label.node.getComponent(CocosUITransform);
    if (transform !== null) transform.setAnchorPoint(0, 0.5);
    label.node.setPosition(TEXT_LEFT, y, 0);
    return label;
  }

  /** Body text: top-left anchored, wraps inside the panel and grows downward (RESIZE_HEIGHT). */
  private createWrappedLabel(): Label {
    const label = createLabel(this.panel, 'dialog-body', '');
    label.fontSize = BODY_FONT_SIZE;
    label.lineHeight = BODY_LINE_HEIGHT;
    label.color = TEXT_COLOR;
    label.enableWrapText = true;
    label.overflow = CocosLabel.Overflow.RESIZE_HEIGHT;
    const transform: UITransform | null = label.node.getComponent(CocosUITransform);
    if (transform !== null) {
      transform.setAnchorPoint(0, 1);
      transform.setContentSize(TEXT_WIDTH, BODY_LINE_HEIGHT);
    }
    label.node.setPosition(TEXT_LEFT, BODY_TOP, 0);
    return label;
  }

  /** One clickable choice row: the hit node carries the Button, the label is a sibling of it. */
  private createChoiceRow(index: number): ChoiceRow {
    const hit = new CocosNode(`dialog-choice-hit-${index}`);
    hit.layer = Layers.Enum.UI_2D;
    hit.parent = this.panel;
    const transform: UITransform = hit.addComponent(CocosUITransform);
    transform.setContentSize(TEXT_WIDTH, CHOICE_ROW_HEIGHT);
    const button: Button = hit.addComponent(CocosButton);
    button.transition = CocosButton.Transition.NONE;
    hit.on(CocosButton.EventType.CLICK, () => {
      this.swallowPanelClick = true;
      // Always clear it again: whether or not this click bubbles to the panel, the *next* panel
      // click must advance normally.
      queueMicrotask(() => {
        this.swallowPanelClick = false;
      });
      this.options.onSelectChoice(index);
    });
    hit.active = false;

    const label = createLabel(this.panel, `dialog-choice-label-${index}`, '');
    label.fontSize = HINT_FONT_SIZE + 1;
    label.lineHeight = HINT_FONT_SIZE + 3;
    label.color = CHOICE_COLOR;
    const labelTransform: UITransform | null = label.node.getComponent(CocosUITransform);
    if (labelTransform !== null) labelTransform.setAnchorPoint(0, 0.5);
    label.node.active = false;

    return { hit, label };
  }

  private async loadPanelFrame(): Promise<void> {
    try {
      const texture = await loadPixelTexture(PANEL_SHEET);
      if (this.destroyed || !this.panel.isValid) return;
      const frame = sliceSliced(texture, PANEL_RECT, PANEL_BORDERS);
      const frameNode = new CocosNode('dialog-panel-frame');
      frameNode.layer = Layers.Enum.UI_2D;
      frameNode.parent = this.panel;
      // Above the dark base, under the portrait/labels drawn before the texture resolved.
      frameNode.setSiblingIndex(1);
      const sprite: Sprite = frameNode.addComponent(CocosSprite);
      sprite.type = CocosSprite.Type.SLICED;
      sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
      sprite.trim = false;
      sprite.spriteFrame = frame;
      sprite.color = PANEL_TINT;
      const transform: UITransform | null = frameNode.getComponent(CocosUITransform);
      if (transform !== null) transform.setContentSize(PANEL_WIDTH, PANEL_HEIGHT);
    } catch {
      // The dark base above already reads; a missing frame is only ugly, never broken.
    }
  }

  /** Load/refresh the 64×64 portrait when the speaker changes (nearest filter keeps it crisp). */
  private syncPortrait(portrait: DialogPortraitSpec): void {
    const key = `${portrait.primaryPath}|${portrait.fallbackPath ?? ''}`;
    if (this.portraitSpeaker === key) return;
    this.portraitSpeaker = key;
    const token = (this.portraitToken += 1);
    void this.loadPortraitFrame(portrait)
      .then((frame) => {
        if (frame === null || token !== this.portraitToken || this.destroyed) return;
        const sprite: Sprite | null = this.portraitNode.getComponent(CocosSprite);
        if (sprite !== null) sprite.spriteFrame = frame;
      })
      .catch(() => undefined);
  }

  private async loadPortraitFrame(portrait: DialogPortraitSpec): Promise<SpriteFrame | null> {
    const paths = portrait.fallbackPath === null
      ? [portrait.primaryPath]
      : [portrait.primaryPath, portrait.fallbackPath];
    for (const path of paths) {
      try {
        const texture = await loadPixelTexture(`resources/${path}.png`);
        const width = texture.width;
        const height = texture.height;
        if (width <= 0 || height <= 0) continue;
        return sliceFrame(texture, { x: 0, y: 0, width, height });
      } catch {
        // Try the guaranteed fallback sheet next.
      }
    }
    return null;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isVisible || event.repeat) return;
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.options.onMoveChoice(-1);
        event.preventDefault();
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.options.onMoveChoice(1);
        event.preventDefault();
        break;
      case 'Enter':
      case 'Space':
        this.options.onAdvance();
        event.preventDefault();
        break;
      default:
        break;
    }
  };
}

/** Design size of the UI canvas this box assumes (`exported for tests/layout checks`). */
export const DIALOG_BOX_DESIGN = {
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  panelWidth: PANEL_WIDTH,
  panelHeight: PANEL_HEIGHT,
  textWidth: TEXT_WIDTH,
  maxChoiceRows: MAX_CHOICE_ROWS,
} as const;
