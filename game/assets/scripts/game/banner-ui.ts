/**
 * Banner chữ giữa màn hình (room clear, game over, chapter clear, load error).
 *
 * Tách khỏi bootstrap: nền tối + label + kích thước theo số dòng là một khối UI
 * hoàn chỉnh, không liên quan run flow. Nền dùng `Graphics` nên đọc được trên
 * mọi loại sàn (chapter 3 từng làm banner vàng chìm vào sàn vàng).
 */
import {
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  UITransform as CocosUITransform,
} from 'cc';
import { createBackdropPanel, createLabel } from './hud';

/** Màu RGBA tối thiểu của Cocos `Color`; tránh import value chỉ dùng ở vị trí type. */
export interface BannerColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

type Node = ReturnType<typeof createBackdropPanel>;

/**
 * Dựng banner dưới `parent` (Canvas) và trả **container** để caller chỉ destroy
 * một node. `maxWidth` là bề rộng design của màn hình.
 */
export function createBanner(
  parent: Node,
  name: string,
  text: string,
  color: BannerColor,
  fontSize: number,
  maxWidth: number,
): Node {
  const lines = text.split('\n');
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
  const panelWidth = Math.min(maxWidth - 24, Math.max(160, longest * fontSize * 0.62 + 32));
  const panelHeight = Math.max(44, lines.length * (fontSize + 4) + 18);

  const container = new CocosNode(name);
  container.layer = Layers.Enum.UI_2D;
  container.parent = parent;
  container.setPosition(0, 0, 0);

  createBackdropPanel(container, `${name}-backdrop`, panelWidth, panelHeight, 170);

  const label = createLabel(container, `${name}-text`, text);
  label.fontSize = fontSize;
  label.lineHeight = fontSize + 4;
  label.color = color;
  label.enableWrapText = true;
  // RESIZE_HEIGHT + bề rộng cố định = xuống dòng theo màn hình thay vì tràn ra ngoài.
  label.overflow = CocosLabel.Overflow.RESIZE_HEIGHT;

  const transform = label.node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(maxWidth - 16, 80);
  label.node.setPosition(0, 0, 0);
  return container;
}
