/**
 * Collect the visible `Label`s for the `uiText()` debug hook (M5 acceptance).
 *
 * Goal: prove headlessly that **no text is clipped** at any canvas ratio, and that text in a
 * card/button does not overflow its **parent rect** (M5 round 3).
 * Rects are canvas pixels (bottom-left origin) so tests can compare directly against the canvas
 * size; `insideCanvas` compares with the visible UI band, `insideParent` with the nearest
 * UITransform (button/card).
 */
import {
  Canvas as CocosCanvas,
  Label as CocosLabel,
  UITransform as CocosUITransform,
  view,
} from 'cc';
import type { Node as CocosNode } from 'cc';
import type { DebugUiText } from './debug-api';

type Label = InstanceType<typeof CocosLabel>;
type Node = InstanceType<typeof CocosNode>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** Estimated glyph width ratio of the system font (fallback when contentSize = 0). */
const GLYPH_WIDTH_RATIO = 0.62;
const EPSILON = 0.5;

interface DesignRect {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

export function collectUiText(root: Node | null): DebugUiText[] {
  if (root === null || !root.isValid) return [];

  const labels: DebugUiText[] = [];
  visit(root, labels);
  return labels;
}

function visit(node: Node, out: DebugUiText[]): void {
  if (!node.isValid || !node.activeInHierarchy) return;

  const label = node.getComponent(CocosLabel);
  if (label !== null) {
    const text = label.string;
    if (text.trim() !== '') out.push(measure(label));
  }

  for (const child of node.children) visit(child, out);
}

function measure(label: Label): DebugUiText {
  const node = label.node;
  const transform: UITransform | null = node.getComponent(CocosUITransform);
  const content = transform?.contentSize;
  const anchor = transform?.anchorPoint;

  const lines = label.string.split('\n') as string[];
  const longest = lines.reduce((max: number, line: string) => Math.max(max, line.length), 0);
  const estimateWidth = longest * label.fontSize * GLYPH_WIDTH_RATIO;
  const estimateHeight = lines.length * Math.max(label.lineHeight, label.fontSize);

  // Wrapping labels (RESIZE_HEIGHT/CLAMP/SHRINK) keep their width from contentSize; estimating
  // from string length would wrongly report already-wrapped text as overflowing.
  const wrapped =
    label.enableWrapText === true && label.overflow !== CocosLabel.Overflow.NONE;
  const width = wrapped
    ? (content?.width ?? 0)
    : Math.max(content?.width ?? 0, estimateWidth);
  const height = Math.max(content?.height ?? 0, wrapped ? 0 : estimateHeight);

  const ax = anchor?.x ?? 0.5;
  const ay = anchor?.y ?? 0.5;
  const own = rectOf(node.worldPosition, width, height, ax, ay);

  const visible = view.getVisibleSize();
  const halfW = visible.width / 2;
  const halfH = visible.height / 2;
  const insideCanvas =
    own.left >= -halfW - EPSILON &&
    own.right <= halfW + EPSILON &&
    own.bottom >= -halfH - EPSILON &&
    own.top <= halfH + EPSILON;

  const parent = nearestParentTransform(node);
  const parentRect =
    parent === null
      ? null
      : rectOf(
          parent.node.worldPosition,
          parent.contentSize.width,
          parent.contentSize.height,
          parent.anchorPoint.x,
          parent.anchorPoint.y,
        );
  const insideParent =
    parentRect === null ||
    (own.left >= parentRect.left - EPSILON &&
      own.right <= parentRect.right + EPSILON &&
      own.bottom >= parentRect.bottom - EPSILON &&
      own.top <= parentRect.top + EPSILON);

  const viewport = view.getViewportRect();
  const scaleX = view.getScaleX() || 1;
  const scaleY = view.getScaleY() || 1;
  const canvasRect = toCanvas(own, viewport, scaleX, scaleY, halfW, halfH);

  return {
    text: label.string,
    x: round(canvasRect.left),
    y: round(canvasRect.bottom),
    width: round(canvasRect.right - canvasRect.left),
    height: round(canvasRect.top - canvasRect.bottom),
    insideCanvas,
    node: node.name,
    parent: parent?.node.name ?? null,
    insideParent,
  };
}

function nearestParentTransform(node: Node): UITransform | null {
  let current: Node | null = node.parent;
  while (current !== null) {
    // The Canvas covers the whole screen, so comparing a label with it is meaningless. Only
    // cards/buttons/panels are "parent rects" worth overflow-checking.
    if (current.getComponent(CocosCanvas) !== null) return null;
    const transform = current.getComponent(CocosUITransform);
    if (transform !== null) return transform;
    current = current.parent;
  }
  return null;
}

function rectOf(
  position: { readonly x: number; readonly y: number },
  width: number,
  height: number,
  ax: number,
  ay: number,
): DesignRect {
  return {
    left: position.x - width * ax,
    right: position.x + width * (1 - ax),
    bottom: position.y - height * ay,
    top: position.y + height * (1 - ay),
  };
}

function toCanvas(
  rect: DesignRect,
  viewport: { readonly x: number; readonly y: number },
  scaleX: number,
  scaleY: number,
  halfW: number,
  halfH: number,
): DesignRect {
  return {
    left: viewport.x + (rect.left + halfW) * scaleX,
    right: viewport.x + (rect.right + halfW) * scaleX,
    bottom: viewport.y + (rect.bottom + halfH) * scaleY,
    top: viewport.y + (rect.top + halfH) * scaleY,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
