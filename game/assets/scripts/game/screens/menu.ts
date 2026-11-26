/**
 * Shared `Theme Wood` menu frame for every M5/M11 screen (title, shop, settings, pause, result,
 * credits, chapter select).
 *
 * Everything every screen needs lives in one place:
 * - layered `Theme Wood` 9-slice plaques (`nine_path_bg_2` pixel drop shadow + carved wooden rim +
 *   recessed `nine_path_panel_interior` dark mahogany well + pixel groove divider);
 * - unmistakable `normal` / `focused` / `hovered` / `pressed` / `disabled` / `disabled-focused`
 *   wooden button states with `nine_path_focus` 9-slice focus frames and comfortable padding;
 * - keyboard navigation (`↑/↓/←/→`, `Enter`/`Space`, `Esc`) in capture phase plus real mouse
 *   hover/press/click sharing a single focus state.
 *
 * `document.addEventListener('keydown', ..., true)` is mandatory: Cocos attaches its key listener
 * on the canvas and may stop bubbling (see `AGENTS.md` traps), so UI listens in capture phase.
 */
import {
  Button as CocosButton,
  Color as CocosColor,
  Graphics as CocosGraphics,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  view,
} from 'cc';
import {
  FOCUS_RING_EXPAND_PX,
  MENU_COLUMN_WIDTH,
  PANEL_SHADOW_EXPAND_PX,
  PANEL_WELL_INSET_PX,
  THEME_WOOD_BORDERS,
  computeMenuButtonTextLayout,
  computeMenuScreenLayout,
  resolveMenuButtonVisualState,
  type MenuFocusRingStyle,
} from '../../core/view/menu-layout';
import { createBackdropPanel, createLabel } from '../hud';
import { loadPixelTexture } from '../assets/texture-cache';
import { playSfx } from '../audio/sfx';
import { sliceFrame } from '../level-view';
import type { TileRect } from '../level-view';

export { MENU_COLUMN_WIDTH };

/** `cc` is an any module: import names only work in value position. */
type Button = InstanceType<typeof CocosButton>;
type Color = InstanceType<typeof CocosColor>;
type Graphics = InstanceType<typeof CocosGraphics>;
type Label = ReturnType<typeof createLabel>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

const BUTTON_NORMAL = 'resources/art/ui/theme-wood/button_normal.png';
const BUTTON_HOVER = 'resources/art/ui/theme-wood/button_hover.png';
const BUTTON_PRESSED = 'resources/art/ui/theme-wood/button_pressed.png';
const BUTTON_DISABLED = 'resources/art/ui/theme-wood/button_disabled.png';
const BUTTON_RECT: TileRect = { x: 0, y: 0, width: 16, height: 8 };

// `nine_path_panel*.png` contains an off-centre inner square that 9-slice stretching turns into
// two offset frames (`AGENTS.md` trap). `nine_path_panel_interior.png` and `nine_path_bg_2.png`
// have flat centres so they stretch cleanly at any size.
const PANEL_INTERIOR_SHEET = 'resources/art/ui/theme-wood/nine_path_panel_interior.png';
const PANEL_SHADOW_SHEET = 'resources/art/ui/theme-wood/nine_path_bg_2.png';
const PANEL_RECT: TileRect = { x: 0, y: 0, width: 16, height: 16 };

// `nine_path_focus.png` is an 8×8 pixel focus ring with a transparent 2×2 centre.
const FOCUS_SHEET = 'resources/art/ui/theme-wood/nine_path_focus.png';
const FOCUS_RECT: TileRect = { x: 0, y: 0, width: 8, height: 8 };

/** Outer carved oak frame tint (slightly deeper than active buttons so buttons pop inside). */
export const PANEL_RIM_TINT = new CocosColor(224, 188, 162, 255);
/** Recessed mahogany-espresso interior tint (`(155,81,60)` × `(112,118,124)` ≈ `(68,37,29)`). */
export const PANEL_WELL_TINT = new CocosColor(112, 118, 124, 255);
export const PANEL_SHADOW_TINT = new CocosColor(255, 255, 255, 228);

const DIVIDER_DARK_COLOR = new CocosColor(28, 14, 10, 215);
const DIVIDER_LIGHT_COLOR = new CocosColor(176, 126, 88, 120);

export const MENU_TITLE_COLOR = new CocosColor(255, 232, 128, 255);
export const MENU_TEXT_COLOR = new CocosColor(246, 238, 224, 255);
export const MENU_MUTED_COLOR = new CocosColor(206, 192, 174, 255);
export const MENU_DISABLED_COLOR = new CocosColor(232, 222, 210, 255);
export const MENU_FOCUS_COLOR = new CocosColor(255, 222, 96, 255);

/** High-contrast dark ink on warm wooden buttons, plus crisp light parchment on weathered disabled wood. */
const BUTTON_NORMAL_TINT = new CocosColor(242, 230, 218, 255);
const BUTTON_FOCUS_TINT = new CocosColor(255, 246, 228, 255);
const BUTTON_HOVER_TINT = new CocosColor(255, 255, 255, 255);
const BUTTON_PRESSED_TINT = new CocosColor(244, 224, 206, 255);
const BUTTON_DISABLED_TINT = new CocosColor(186, 176, 166, 255);
const BUTTON_DISABLED_FOCUS_TINT = new CocosColor(214, 204, 194, 255);

const BUTTON_TEXT_COLOR = new CocosColor(30, 15, 6, 255);
const BUTTON_DETAIL_COLOR = new CocosColor(62, 28, 10, 255);
const BUTTON_FOCUS_TEXT_COLOR = new CocosColor(48, 14, 4, 255);
const BUTTON_FOCUS_DETAIL_COLOR = new CocosColor(78, 30, 8, 255);
const BUTTON_DISABLED_DETAIL = new CocosColor(202, 190, 176, 255);

const FOCUS_RING_GOLD = new CocosColor(255, 230, 124, 255);
const FOCUS_RING_GLEAM = new CocosColor(255, 255, 255, 255);
const FOCUS_RING_MUTED = new CocosColor(172, 178, 190, 220);

const MENU_DANGER_COLOR = new CocosColor(255, 128, 120, 255);
const MENU_GOOD_COLOR = new CocosColor(156, 238, 156, 255);

export interface MenuFrames {
  readonly normal: SpriteFrame;
  readonly hover: SpriteFrame;
  readonly pressed: SpriteFrame;
  readonly disabled: SpriteFrame;
  readonly panel: SpriteFrame;
  readonly shadow: SpriteFrame;
  readonly focus: SpriteFrame;
}

let framesPromise: Promise<MenuFrames> | null = null;

/** Load all `Theme Wood` button, panel, shadow, and focus 9-slice frames once per session. */
export function loadMenuFrames(): Promise<MenuFrames> {
  if (framesPromise !== null) return framesPromise;

  const task = Promise.all([
    loadPixelTexture(BUTTON_NORMAL),
    loadPixelTexture(BUTTON_HOVER),
    loadPixelTexture(BUTTON_PRESSED),
    loadPixelTexture(BUTTON_DISABLED),
    loadPixelTexture(PANEL_INTERIOR_SHEET),
    loadPixelTexture(PANEL_SHADOW_SHEET),
    loadPixelTexture(FOCUS_SHEET),
  ]).then(([normal, hover, pressed, disabled, panel, shadow, focus]) => ({
    normal: sliceSliced(normal, BUTTON_RECT, THEME_WOOD_BORDERS.button),
    hover: sliceSliced(hover, BUTTON_RECT, THEME_WOOD_BORDERS.button),
    pressed: sliceSliced(pressed, BUTTON_RECT, THEME_WOOD_BORDERS.buttonPressed),
    disabled: sliceSliced(disabled, BUTTON_RECT, THEME_WOOD_BORDERS.button),
    panel: sliceSliced(panel, PANEL_RECT, THEME_WOOD_BORDERS.panel),
    shadow: sliceSliced(shadow, PANEL_RECT, THEME_WOOD_BORDERS.panel),
    focus: sliceSliced(focus, FOCUS_RECT, THEME_WOOD_BORDERS.focus),
  }));

  framesPromise = task;
  task.catch(() => {
    if (framesPromise === task) framesPromise = null;
  });
  return task;
}

/**
 * Slice a frame, then declare its 9-slice borders. Only `Sprite.Type.SLICED` uses borders;
 * without insets the engine stretches all 4 corners and the wooden edge distorts.
 */
export function sliceSliced(
  texture: Parameters<typeof sliceFrame>[0],
  rect: TileRect,
  borders: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
): SpriteFrame {
  const frame = sliceFrame(texture, rect);
  frame.insetLeft = borders.left;
  frame.insetRight = borders.right;
  frame.insetTop = borders.top;
  frame.insetBottom = borders.bottom;
  return frame;
}

function isMenuFrames(value: MenuFrames | SpriteFrame): value is MenuFrames {
  return 'panel' in value && 'normal' in value && 'shadow' in value;
}

/** Helper to create one `Sprite.Type.SLICED` child with `SizeMode.CUSTOM` + `setContentSize`. */
export function addSlicedSpriteNode(
  parent: Node,
  name: string,
  frame: SpriteFrame,
  width: number,
  height: number,
  tint: Color,
): { readonly node: Node; readonly sprite: Sprite } {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SLICED;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;
  sprite.spriteFrame = frame;
  sprite.color = tint;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(width, height);

  return { node, sprite };
}

/**
 * Two-line pixel wood groove divider (`AGENTS.md`: one `Graphics` node per fill colour so
 * `fill()` never repaints an earlier sub-path).
 */
export function addPanelDivider(parent: Node, width: number, localY: number): void {
  const shadowNode = new CocosNode('divider-shadow');
  shadowNode.layer = Layers.Enum.UI_2D;
  shadowNode.parent = parent;
  shadowNode.setPosition(0, localY, 0);
  const shadowGfx: Graphics = shadowNode.addComponent(CocosGraphics);
  shadowGfx.fillColor = DIVIDER_DARK_COLOR;
  shadowGfx.rect(-width / 2, 0, width, 1);
  shadowGfx.fill();

  const lightNode = new CocosNode('divider-highlight');
  lightNode.layer = Layers.Enum.UI_2D;
  lightNode.parent = parent;
  lightNode.setPosition(0, localY - 1, 0);
  const lightGfx: Graphics = lightNode.addComponent(CocosGraphics);
  lightGfx.fillColor = DIVIDER_LIGHT_COLOR;
  lightGfx.rect(-width / 2, 0, width, 1);
  lightGfx.fill();
}

export interface MenuPanelOptions {
  /** Optional divider Y relative to the panel centre. */
  readonly dividerY?: number;
  readonly dividerWidth?: number;
}

/**
 * Layered `Theme Wood` 9-slice plaque:
 * 1) `nine_path_bg_2` pixel drop shadow,
 * 2) `button_normal` carved oak outer border,
 * 3) `nine_path_panel_interior` recessed dark mahogany well,
 * 4) optional horizontal wood-groove header divider.
 */
export function createMenuPanel(
  parent: Node,
  name: string,
  framesOrPanel: MenuFrames | SpriteFrame,
  width: number,
  height: number,
  options?: MenuPanelOptions,
): Node {
  if (!isMenuFrames(framesOrPanel)) {
    return addSlicedSpriteNode(parent, name, framesOrPanel, width, height, PANEL_WELL_TINT).node;
  }

  const root = new CocosNode(name);
  root.layer = Layers.Enum.UI_2D;
  root.parent = parent;

  const shadow = addSlicedSpriteNode(
    root,
    `${name}-shadow`,
    framesOrPanel.shadow,
    width + PANEL_SHADOW_EXPAND_PX,
    height + PANEL_SHADOW_EXPAND_PX,
    PANEL_SHADOW_TINT,
  );
  shadow.node.setPosition(0, -1, 0);

  addSlicedSpriteNode(root, `${name}-rim`, framesOrPanel.normal, width, height, PANEL_RIM_TINT);

  const wellWidth = Math.max(16, width - PANEL_WELL_INSET_PX * 2);
  const wellHeight = Math.max(16, height - PANEL_WELL_INSET_PX * 2);
  addSlicedSpriteNode(
    root,
    `${name}-well`,
    framesOrPanel.panel,
    wellWidth,
    wellHeight,
    PANEL_WELL_TINT,
  );

  if (options?.dividerY !== undefined) {
    const divWidth = options.dividerWidth ?? Math.max(48, wellWidth - 20);
    addPanelDivider(root, divWidth, options.dividerY);
  }

  return root;
}

/** One screen action. `detail` is the smaller second line (price, level, lock reason). */
export interface MenuItem {
  readonly label: string;
  readonly detail?: string;
  readonly disabled?: boolean;
  /** Optional per-button height override (e.g. a sleek single-line Back row below taller tracks). */
  readonly height?: number;
  /** Special label colour (e.g. a red Quit); dark ink by default. */
  readonly color?: Color;
  readonly activate: () => void;
}

export interface MenuButtonHandle {
  readonly node: Node;
  readonly item: MenuItem;
  setFocused(focused: boolean): void;
  setHovered?(hovered: boolean): void;
  setPressed?(pressed: boolean): void;
  setText(label: string, detail?: string): void;
}

export interface MenuScreen {
  readonly node: Node;
  focus(index: number): void;
  updateItem(index: number, label: string, detail?: string): void;
  destroy(): void;
}

export interface MenuScreenOptions {
  readonly parent: Node;
  readonly name: string;
  readonly title: string;
  readonly titleColor?: Color;
  readonly titleFontSize?: number;
  readonly subtitle?: string;
  readonly info?: readonly string[];
  readonly items: readonly MenuItem[];
  /** Esc. Absent = Esc does nothing. */
  readonly onBack?: () => void;
  readonly hint?: string;
  readonly buttonWidth?: number;
  readonly buttonHeight?: number;
  readonly buttonGap?: number;
  readonly buttonFontSize?: number;
  readonly initialFocus?: number;
  /** ←/→ calls this instead of moving focus (volume / character row). */
  readonly onAdjust?: (index: number, delta: number) => void;
  /** Alpha of the dark backdrop; screens with a living room behind them use a light dim. */
  readonly backdropAlpha?: number;
  /** Panel width in design px; a narrow centred column lets the room show on both sides. */
  readonly panelWidth?: number;
  /** Stretch the panel to the full screen height (the narrow column of the title screen). */
  readonly panelFullHeight?: boolean;
}

/** Visible UI size (design px) — every screen uses this exact source. */
export function visibleUiSize(): { readonly width: number; readonly height: number } {
  const size = view.getVisibleSize();
  return { width: size.width, height: size.height };
}

/** Dark backdrop over the whole screen so text reads on any room background (`Graphics`, never a 16×8 button frame). */
export function createScreenBackdrop(parent: Node, alpha = 224): Node {
  const size = visibleUiSize();
  return createBackdropPanel(parent, 'screen-backdrop', size.width, size.height, alpha);
}

/**
 * Build one vertical list screen inside a layered `Theme Wood` plaque. Returns after the pixel
 * textures are ready; callers check their token to drop stale screens if navigated away.
 */
export async function buildMenuScreen(options: MenuScreenOptions): Promise<MenuScreen> {
  const frames = await loadMenuFrames();
  const size = visibleUiSize();

  const root = new CocosNode(options.name);
  root.layer = Layers.Enum.UI_2D;
  root.parent = options.parent;

  createScreenBackdrop(root, options.backdropAlpha ?? 220);

  const defaultButtonHeight = options.buttonHeight ?? 34;
  const buttonWidth = options.buttonWidth ?? 304;
  const gap = options.buttonGap ?? 6;
  const fontSize = options.buttonFontSize ?? 12;
  const buttonHeights = options.items.map((item) => item.height ?? defaultButtonHeight);
  const infoLines = options.info ?? [];

  const layout = computeMenuScreenLayout({
    visibleWidth: size.width,
    visibleHeight: size.height,
    ...(options.titleFontSize !== undefined ? { titleFontSize: options.titleFontSize } : {}),
    hasSubtitle: options.subtitle !== undefined,
    infoCount: infoLines.length,
    buttonHeights,
    buttonGap: gap,
    ...(options.panelWidth !== undefined ? { panelWidth: options.panelWidth } : {}),
    ...(options.panelFullHeight !== undefined ? { panelFullHeight: options.panelFullHeight } : {}),
  });

  const panel = createMenuPanel(
    root,
    `${options.name}-panel`,
    frames,
    layout.panelWidth,
    layout.panelHeight,
    {
      dividerY: layout.dividerY - layout.panelY,
      dividerWidth: layout.dividerWidth,
    },
  );
  panel.setPosition(0, layout.panelY, 0);

  const title = createLabel(root, `${options.name}-title`, options.title);
  title.fontSize = layout.titleFontSize;
  title.lineHeight = layout.titleFontSize + 4;
  title.color = options.titleColor ?? MENU_TITLE_COLOR;
  title.node.setPosition(0, layout.titleY, 0);

  if (options.subtitle !== undefined && layout.subtitleY !== null) {
    const subtitle = createLabel(root, `${options.name}-subtitle`, options.subtitle);
    subtitle.fontSize = layout.subtitleFontSize;
    subtitle.lineHeight = layout.subtitleFontSize + 2;
    subtitle.color = MENU_TEXT_COLOR;
    subtitle.node.setPosition(0, layout.subtitleY, 0);
  }

  infoLines.forEach((line, index) => {
    const info = createLabel(root, `${options.name}-info-${index}`, line);
    info.fontSize = layout.infoFontSize;
    info.lineHeight = layout.infoFontSize + 2;
    info.color = MENU_MUTED_COLOR;
    info.node.setPosition(0, layout.infoYs[index] ?? 0, 0);
  });

  const handles: MenuButtonHandle[] = [];
  options.items.forEach((item, index) => {
    const itemHeight = buttonHeights[index] ?? defaultButtonHeight;
    const handle = createMenuButton(root, `${options.name}-item-${index}`, item, frames, {
      width: buttonWidth,
      height: itemHeight,
      fontSize,
    });
    handle.node.setPosition(0, layout.buttonYs[index] ?? 0, 0);
    handles.push(handle);
  });

  const hintText = options.hint ?? '↑/↓ select · Enter confirm · Esc back';
  const hint = createLabel(root, `${options.name}-hint`, hintText);
  hint.fontSize = layout.hintFontSize;
  hint.lineHeight = layout.hintFontSize + 2;
  hint.color = MENU_MUTED_COLOR;
  hint.node.setPosition(0, layout.hintY, 0);

  const focus = new FocusList({
    handles,
    ...(options.onBack !== undefined ? { onBack: options.onBack } : {}),
    ...(options.onAdjust !== undefined ? { onAdjust: options.onAdjust } : {}),
    ...(options.initialFocus !== undefined ? { initialFocus: options.initialFocus } : {}),
  });

  return {
    node: root,
    focus: (index: number) => focus.focus(index),
    updateItem: (index: number, labelText: string, detail?: string) => {
      handles[index]?.setText(labelText, detail);
    },
    destroy(): void {
      focus.destroy();
      if (root.isValid) root.destroy();
    },
  };
}

export interface MenuButtonStyle {
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
}

/** Build a `nine_path_focus.png` 9-slice focus ring around `width × height`. */
export function createFocusFrame(
  parent: Node,
  focusSpriteFrame: SpriteFrame,
  width: number,
  height: number,
): { readonly node: Node; readonly sprite: Sprite; applyStyle(style: MenuFocusRingStyle): void } {
  const { node, sprite } = addSlicedSpriteNode(
    parent,
    'focus-ring',
    focusSpriteFrame,
    width + FOCUS_RING_EXPAND_PX,
    height + FOCUS_RING_EXPAND_PX,
    FOCUS_RING_GOLD,
  );
  node.active = false;

  return {
    node,
    sprite,
    applyStyle(style: MenuFocusRingStyle): void {
      if (style === 'none') {
        node.active = false;
        return;
      }
      node.active = true;
      sprite.color =
        style === 'gleam'
          ? FOCUS_RING_GLEAM
          : style === 'muted'
            ? FOCUS_RING_MUTED
            : FOCUS_RING_GOLD;
    },
  };
}

/** One `Theme Wood` button: 9-slice wooden sprite + `nine_path_focus` ring + padded label/detail. */
export function createMenuButton(
  parent: Node,
  name: string,
  item: MenuItem,
  frames: MenuFrames,
  style: MenuButtonStyle,
): MenuButtonHandle {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SLICED;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(style.width, style.height);

  const ring = createFocusFrame(node, frames.focus, style.width, style.height);

  const textLayout = computeMenuButtonTextLayout({
    width: style.width,
    height: style.height,
    fontSize: style.fontSize,
    hasDetail: item.detail !== undefined,
  });

  const label = createLabel(node, 'label', item.label);
  label.fontSize = textLayout.labelFontSize;
  label.lineHeight = textLayout.labelLineHeight;
  label.node.setPosition(0, textLayout.labelY, 0);

  let detail: Label | null = null;
  if (item.detail !== undefined) {
    detail = createLabel(node, 'detail', item.detail);
    detail.fontSize = textLayout.detailFontSize;
    detail.lineHeight = textLayout.detailLineHeight;
    detail.node.setPosition(0, textLayout.detailY, 0);
  }

  const button: Button = node.addComponent(CocosButton);
  button.transition = CocosButton.Transition.NONE;

  let focused = false;
  let hovered = false;
  let pressed = false;
  const disabled = item.disabled === true;
  const customColor = item.color;

  const applyVisualState = (): void => {
    const visual = resolveMenuButtonVisualState({ disabled, focused, hovered, pressed });
    sprite.spriteFrame =
      visual.frame === 'disabled'
        ? frames.disabled
        : visual.frame === 'pressed'
          ? frames.pressed
          : visual.frame === 'hover'
            ? frames.hover
            : frames.normal;
    sprite.color =
      visual.state === 'disabled'
        ? BUTTON_DISABLED_TINT
        : visual.state === 'disabled-focused'
          ? BUTTON_DISABLED_FOCUS_TINT
          : visual.state === 'pressed'
            ? BUTTON_PRESSED_TINT
            : visual.state === 'hovered'
              ? BUTTON_HOVER_TINT
              : visual.state === 'focused'
                ? BUTTON_FOCUS_TINT
                : BUTTON_NORMAL_TINT;

    ring.applyStyle(visual.focusRingStyle);

    label.node.setPosition(0, textLayout.labelY + visual.contentOffsetY, 0);
    label.color = disabled
      ? MENU_DISABLED_COLOR
      : customColor ??
        (visual.state === 'focused' || visual.state === 'hovered' || visual.state === 'pressed'
          ? BUTTON_FOCUS_TEXT_COLOR
          : BUTTON_TEXT_COLOR);

    if (detail !== null) {
      detail.node.setPosition(0, textLayout.detailY + visual.contentOffsetY, 0);
      detail.color = disabled
        ? BUTTON_DISABLED_DETAIL
        : visual.state === 'focused' || visual.state === 'hovered' || visual.state === 'pressed'
          ? BUTTON_FOCUS_DETAIL_COLOR
          : BUTTON_DETAIL_COLOR;
    }
  };

  applyVisualState();

  return {
    node,
    item,
    setFocused(value: boolean): void {
      if (focused === value) return;
      focused = value;
      if (!value) pressed = false;
      applyVisualState();
    },
    setHovered(value: boolean): void {
      if (hovered === value) return;
      hovered = value;
      if (!value) pressed = false;
      applyVisualState();
    },
    setPressed(value: boolean): void {
      if (pressed === value) return;
      pressed = value;
      applyVisualState();
    },
    setText(labelText: string, detailText?: string): void {
      label.string = labelText;
      if (detail !== null && detailText !== undefined) detail.string = detailText;
    },
  };
}

export interface FocusListOptions {
  readonly handles: readonly MenuButtonHandle[];
  readonly onBack?: () => void;
  readonly onAdjust?: (index: number, delta: number) => void;
  readonly initialFocus?: number;
  /** Fired whenever the focus changes, including the initial focus set by the constructor. */
  readonly onFocus?: (index: number) => void;
}

/**
 * Focus + keyboard/pointer navigation for a list of buttons. Removes its listener on `destroy`.
 * Mouse hover moves selection so mouse and keyboard share one focus, while `MOUSE_LEAVE` returns
 * from bright hover gleam to resting keyboard focus without stranding selection.
 */
export class FocusList {
  private index = 0;
  private initialised = false;
  private readonly handles: readonly MenuButtonHandle[];
  private readonly onBack: (() => void) | undefined;
  private readonly onAdjust: ((index: number, delta: number) => void) | undefined;
  private readonly onFocus: ((index: number) => void) | undefined;
  private readonly onKey: (event: KeyboardEvent) => void;

  constructor(options: FocusListOptions) {
    this.handles = options.handles;
    this.onBack = options.onBack;
    this.onAdjust = options.onAdjust;
    this.onFocus = options.onFocus;

    this.handles.forEach((handle, index) => {
      handle.node.on(CocosNode.EventType.MOUSE_ENTER, () => {
        this.focus(index);
        handle.setHovered?.(true);
      });
      handle.node.on(CocosNode.EventType.MOUSE_LEAVE, () => {
        handle.setHovered?.(false);
        handle.setPressed?.(false);
      });
      handle.node.on(CocosNode.EventType.MOUSE_DOWN, () => {
        this.focus(index);
        handle.setPressed?.(true);
      });
      handle.node.on(CocosNode.EventType.MOUSE_UP, () => {
        handle.setPressed?.(false);
      });
      handle.node.on(CocosButton.EventType.CLICK, () => {
        handle.setPressed?.(false);
        this.focus(index);
        this.activate();
      });
    });

    this.onKey = (event: KeyboardEvent): void => this.handleKey(event);
    document.addEventListener('keydown', this.onKey, true);

    const start = options.initialFocus ?? 0;
    this.focus(start);
  }

  get focused(): number {
    return this.index;
  }

  focus(index: number): void {
    if (this.handles.length === 0) return;
    const next = Math.min(Math.max(0, index), this.handles.length - 1);
    const changed = !this.initialised || next !== this.index;
    if (this.initialised && next !== this.index) playSfx('ui-move');
    this.index = next;
    this.initialised = true;
    this.handles.forEach((handle, handleIndex) => handle.setFocused(handleIndex === next));
    if (changed) this.onFocus?.(next);
  }

  private move(delta: number): void {
    if (this.handles.length === 0) return;
    // Moving by keyboard clears any lingering pointer-hover gleam on the previous button.
    this.handles[this.index]?.setHovered?.(false);
    const next = (this.index + delta + this.handles.length) % this.handles.length;
    this.focus(next);
  }

  private activate(): void {
    const handle = this.handles[this.index];
    if (handle === undefined || handle.item.disabled === true) return;
    playSfx('ui-confirm');
    handle.item.activate();
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.repeat) return;
    const key = event.key;
    const code = event.keyCode;

    if (key === 'Escape' || code === 27) {
      event.preventDefault();
      this.onBack?.();
      return;
    }

    const left = key === 'ArrowLeft' || code === 37;
    const right = key === 'ArrowRight' || code === 39;
    const up = key === 'ArrowUp' || code === 38;
    const down = key === 'ArrowDown' || code === 40;

    if (left || right) {
      if (this.onAdjust !== undefined) {
        event.preventDefault();
        this.onAdjust(this.index, left ? -1 : 1);
        return;
      }
      event.preventDefault();
      this.move(left ? -1 : 1);
      return;
    }
    if (up || down) {
      event.preventDefault();
      this.move(up ? -1 : 1);
      return;
    }

    if (key === 'Enter' || key === ' ' || code === 13 || code === 32) {
      event.preventDefault();
      this.activate();
    }
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKey, true);
  }
}

/** Colours reused for special content. */
export const MENU_DANGER = MENU_DANGER_COLOR;
export const MENU_GOOD = MENU_GOOD_COLOR;
