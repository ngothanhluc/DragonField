/**
 * Khung menu dùng chung cho mọi màn M5 (title, shop, settings, pause, result,
 * credits, chapter select).
 *
 * Ba thứ mọi màn phải có, nên nằm đúng một chỗ:
 * - nút gỗ của pack + nhãn/detail (giá, level, lý do disabled);
 * - **focus nhìn thấy được** (viền vàng + đổi frame hover) và điều hướng bằng
 *   phím: ↑/↓ (hoặc ←/→), Enter/Space để chọn, Esc để lùi;
 * - click chuột thật qua `Button` của engine, hover cập nhật focus.
 *
 * `document.addEventListener('keydown', ..., true)` là bắt buộc: Cocos gắn
 * listener phím trên canvas và có thể chặn bubble (xem bẫy AGENTS.md), nên UI
 * nghe ở capture phase để không im lặng khi canvas đang focus.
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
import { createBackdropPanel, createLabel } from '../hud';
import { loadPixelTexture } from '../assets/texture-cache';
import { sliceFrame } from '../level-view';
import type { TileRect } from '../level-view';

/** `cc` là module any: tên import chỉ dùng được ở vị trí value. */
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
const BUTTON_DISABLED = 'resources/art/ui/theme-wood/button_disabled.png';
const BUTTON_RECT: TileRect = { x: 0, y: 0, width: 16, height: 8 };

export const MENU_TITLE_COLOR = new CocosColor(255, 230, 120, 255);
export const MENU_TEXT_COLOR = new CocosColor(238, 238, 238, 255);
export const MENU_MUTED_COLOR = new CocosColor(170, 170, 170, 255);
export const MENU_DISABLED_COLOR = new CocosColor(205, 195, 185, 255);
export const MENU_FOCUS_COLOR = new CocosColor(255, 222, 96, 255);
/** Chữ trên nút gỗ: nền cam sáng, nên phải là màu tối (không phải trắng/vàng). */
const BUTTON_TEXT_COLOR = new CocosColor(34, 18, 8, 255);
const BUTTON_DETAIL_COLOR = new CocosColor(78, 40, 16, 255);
const BUTTON_FOCUS_TEXT_COLOR = new CocosColor(88, 24, 6, 255);
const BUTTON_DISABLED_DETAIL = new CocosColor(180, 170, 160, 255);
const MENU_DANGER_COLOR = new CocosColor(255, 120, 120, 255);
const MENU_GOOD_COLOR = new CocosColor(150, 235, 150, 255);
const FOCUS_RING_COLOR = new CocosColor(255, 222, 96, 255);

export interface MenuFrames {
  readonly normal: SpriteFrame;
  readonly hover: SpriteFrame;
  readonly disabled: SpriteFrame;
}

let framesPromise: Promise<MenuFrames> | null = null;

/** Load 3 frame nút một lần cho cả phiên (cache texture đã có sẵn). */
export function loadMenuFrames(): Promise<MenuFrames> {
  if (framesPromise !== null) return framesPromise;

  const task = Promise.all([
    loadPixelTexture(BUTTON_NORMAL),
    loadPixelTexture(BUTTON_HOVER),
    loadPixelTexture(BUTTON_DISABLED),
  ]).then(([normal, hover, disabled]) => ({
    normal: sliceFrame(normal, BUTTON_RECT),
    hover: sliceFrame(hover, BUTTON_RECT),
    disabled: sliceFrame(disabled, BUTTON_RECT),
  }));

  framesPromise = task;
  task.catch(() => {
    if (framesPromise === task) framesPromise = null;
  });
  return task;
}

/** Một hành động trên màn. `detail` là dòng nhỏ thứ hai (giá, level, lý do khoá). */
export interface MenuItem {
  readonly label: string;
  readonly detail?: string;
  readonly disabled?: boolean;
  /** Màu nhãn đặc biệt (vd. Quit đỏ); mặc định trắng. */
  readonly color?: Color;
  readonly activate: () => void;
}

export interface MenuButtonHandle {
  readonly node: Node;
  readonly item: MenuItem;
  setFocused(focused: boolean): void;
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
  readonly subtitle?: string;
  readonly info?: readonly string[];
  readonly items: readonly MenuItem[];
  /** Esc. Không có = Esc không làm gì. */
  readonly onBack?: () => void;
  readonly hint?: string;
  readonly buttonWidth?: number;
  readonly buttonHeight?: number;
  readonly buttonGap?: number;
  readonly buttonFontSize?: number;
  readonly initialFocus?: number;
  /** ←/→ gọi hàm này thay vì đổi focus (hàng volume). */
  readonly onAdjust?: (index: number, delta: number) => void;
}

/** Kích thước vùng UI nhìn thấy (design px) — mọi màn dùng đúng nguồn này. */
export function visibleUiSize(): { readonly width: number; readonly height: number } {
  const size = view.getVisibleSize();
  return { width: size.width, height: size.height };
}

/** Nền tối phủ toàn màn để chữ đọc được trên mọi nền phòng. */
export function createScreenBackdrop(parent: Node, alpha = 238): Node {
  const size = visibleUiSize();
  return createBackdropPanel(parent, 'screen-backdrop', size.width, size.height, alpha);
}

/**
 * Dựng một màn danh sách dọc. Trả sau khi có frame nút; caller phải kiểm tra
 * token để bỏ màn cũ nếu người dùng đã chuyển màn trong lúc load.
 */
export async function buildMenuScreen(options: MenuScreenOptions): Promise<MenuScreen> {
  const frames = await loadMenuFrames();
  const size = visibleUiSize();

  const root = new CocosNode(options.name);
  root.layer = Layers.Enum.UI_2D;
  root.parent = options.parent;

  createScreenBackdrop(root);

  const buttonWidth = options.buttonWidth ?? 300;
  const buttonHeight = options.buttonHeight ?? 34;
  const gap = options.buttonGap ?? 8;
  const fontSize = options.buttonFontSize ?? 12;

  let y = size.height / 2 - 24;

  const title = createLabel(root, `${options.name}-title`, options.title);
  title.fontSize = 24;
  title.lineHeight = 28;
  title.color = MENU_TITLE_COLOR;
  title.node.setPosition(0, y, 0);
  y -= 30;

  if (options.subtitle !== undefined) {
    const subtitle = createLabel(root, `${options.name}-subtitle`, options.subtitle);
    subtitle.fontSize = 11;
    subtitle.lineHeight = 13;
    subtitle.color = MENU_TEXT_COLOR;
    subtitle.node.setPosition(0, y, 0);
    y -= 18;
  }

  for (const [index, line] of (options.info ?? []).entries()) {
    const info = createLabel(root, `${options.name}-info-${index}`, line);
    info.fontSize = 10;
    info.lineHeight = 12;
    info.color = MENU_MUTED_COLOR;
    info.node.setPosition(0, y, 0);
    y -= 14;
  }

  y -= 6;

  const handles: MenuButtonHandle[] = [];
  for (const [index, item] of options.items.entries()) {
    const handle = createMenuButton(root, `${options.name}-item-${index}`, item, frames, {
      width: buttonWidth,
      height: buttonHeight,
      fontSize,
    });
    handle.node.setPosition(0, y - buttonHeight / 2, 0);
    y -= buttonHeight + gap;
    handles.push(handle);
  }

  const hintText = options.hint ?? '↑/↓ select · Enter confirm · Esc back';
  const hint = createLabel(root, `${options.name}-hint`, hintText);
  hint.fontSize = 9;
  hint.lineHeight = 11;
  hint.color = MENU_MUTED_COLOR;
  hint.node.setPosition(0, -size.height / 2 + 12, 0);

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

/** Một nút: sprite frame + nhãn + detail + viền focus. */
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
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;
  sprite.spriteFrame = item.disabled === true ? frames.disabled : frames.normal;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(style.width, style.height);

  const ring = createFocusRing(node, style.width, style.height);

  const hasDetail = item.detail !== undefined;
  const labelY = hasDetail ? 4 : 0;
  const label = createLabel(node, 'label', item.label);
  label.fontSize = style.fontSize;
  label.lineHeight = style.fontSize + 2;
  label.color =
    item.disabled === true ? MENU_DISABLED_COLOR : (item.color ?? BUTTON_TEXT_COLOR);
  label.node.setPosition(0, labelY, 0);

  let detail: Label | null = null;
  if (item.detail !== undefined) {
    detail = createLabel(node, 'detail', item.detail);
    detail.fontSize = Math.max(8, style.fontSize - 3);
    detail.lineHeight = Math.max(9, style.fontSize - 1);
    detail.color = item.disabled === true ? BUTTON_DISABLED_DETAIL : BUTTON_DETAIL_COLOR;
    detail.node.setPosition(0, -labelY - 2, 0);
  }

  const button: Button = node.addComponent(CocosButton);
  button.transition = CocosButton.Transition.NONE;

  let focused = false;
  const baseColor =
    item.disabled === true ? MENU_DISABLED_COLOR : (item.color ?? BUTTON_TEXT_COLOR);

  return {
    node,
    item,
    setFocused(value: boolean): void {
      if (focused === value) return;
      focused = value;
      ring.active = value;
      sprite.spriteFrame =
        item.disabled === true ? frames.disabled : value ? frames.hover : frames.normal;
      label.color =
        item.disabled === true
          ? MENU_DISABLED_COLOR
          : value
            ? BUTTON_FOCUS_TEXT_COLOR
            : baseColor;
      if (detail !== null) {
        detail.color = item.disabled === true ? BUTTON_DISABLED_DETAIL : BUTTON_DETAIL_COLOR;
      }
    },
    setText(labelText: string, detailText?: string): void {
      label.string = labelText;
      if (detail !== null && detailText !== undefined) detail.string = detailText;
    },
  };
}

function createFocusRing(parent: Node, width: number, height: number): Node {
  const node = new CocosNode('focus-ring');
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const graphics: Graphics = node.addComponent(CocosGraphics);
  graphics.lineWidth = 2;
  graphics.strokeColor = FOCUS_RING_COLOR;
  graphics.rect(-width / 2 - 2, -height / 2 - 2, width + 4, height + 4);
  graphics.stroke();

  node.active = false;
  return node;
}

export interface FocusListOptions {
  readonly handles: readonly MenuButtonHandle[];
  readonly onBack?: () => void;
  readonly onAdjust?: (index: number, delta: number) => void;
  readonly initialFocus?: number;
}

/**
 * Điều hướng focus + phím cho một danh sách nút. Tự gỡ listener khi `destroy`.
 * Hover chuột cũng đặt focus, nên chuột và phím dùng chung một trạng thái.
 */
export class FocusList {
  private index = 0;
  private readonly handles: readonly MenuButtonHandle[];
  private readonly onBack: (() => void) | undefined;
  private readonly onAdjust: ((index: number, delta: number) => void) | undefined;
  private readonly onKey: (event: KeyboardEvent) => void;

  constructor(options: FocusListOptions) {
    this.handles = options.handles;
    this.onBack = options.onBack;
    this.onAdjust = options.onAdjust;

    this.handles.forEach((handle, index) => {
      handle.node.on(CocosNode.EventType.MOUSE_ENTER, () => this.focus(index));
      handle.node.on(CocosButton.EventType.CLICK, () => {
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
    this.index = next;
    this.handles.forEach((handle, handleIndex) => handle.setFocused(handleIndex === next));
  }

  private move(delta: number): void {
    if (this.handles.length === 0) return;
    const next = (this.index + delta + this.handles.length) % this.handles.length;
    this.focus(next);
  }

  private activate(): void {
    const handle = this.handles[this.index];
    if (handle === undefined || handle.item.disabled === true) return;
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

/** Màu dùng lại cho nội dung đặc biệt. */
export const MENU_DANGER = MENU_DANGER_COLOR;
export const MENU_GOOD = MENU_GOOD_COLOR;
