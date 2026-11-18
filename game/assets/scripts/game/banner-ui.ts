/**
 * Centre-screen text banner (room clear, game over, chapter clear, load error).
 *
 * Split from bootstrap: dark backdrop + label + line-based sizing is a complete UI block
 * unrelated to run flow. The backdrop uses `Graphics`, so it reads on any floor type
 * (chapter 3 once made a gold banner sink into a gold floor).
 */
import {
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  UITransform as CocosUITransform,
} from 'cc';
import { createBackdropPanel, createLabel } from './hud';

/** Minimal Cocos `Color` RGBA shape; avoids a value import used only in type position. */
export interface BannerColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

type Node = ReturnType<typeof createBackdropPanel>;

/**
 * Build a banner under `parent` (the Canvas) and return the **container** so the caller only
 * destroys one node. `maxWidth` is the screen's design width.
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
  // RESIZE_HEIGHT + a fixed width = wrap to the screen instead of overflowing.
  label.overflow = CocosLabel.Overflow.RESIZE_HEIGHT;

  const transform = label.node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(maxWidth - 16, 80);
  label.node.setPosition(0, 0, 0);
  return container;
}
