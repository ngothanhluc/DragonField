/**
 * Thu thập các `Label` đang hiển thị cho debug hook `uiText()` (M5 acceptance).
 *
 * Mục tiêu: chứng minh headless rằng **không text nào bị cắt** ở mọi tỉ lệ
 * canvas, và text trong card/button không tràn khỏi **rect của cha** (M5 round 3).
 * Rect trả về là pixel canvas (gốc dưới-trái) để test so trực tiếp với kích
 * thước canvas; `insideCanvas` so với band UI nhìn thấy, `insideParent` so với
 * UITransform gần nhất (button/card).
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

/** Hệ số ước lượng bề rộng glyph của font hệ thống (dự phòng khi contentSize = 0). */
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

  // Label wrap (RESIZE_HEIGHT/CLAMP/SHRINK) giữ bề rộng theo contentSize; nếu lấy
  // ước lượng theo độ dài chuỗi thì text đã wrap vẫn bị báo tràn sai.
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
    // Canvas phủ cả màn: so label với nó không có nghĩa. Chỉ card/button/panel
    // mới là "rect cha" cần kiểm text tràn.
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
