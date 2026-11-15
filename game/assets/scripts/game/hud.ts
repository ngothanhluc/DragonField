/**
 * HUD tối thiểu: hàng tim, số vàng (placeholder), nhãn phòng.
 *
 * Đây là UI thật (Canvas + Camera UI_2D riêng) chứ không phải sprite trong world: HUD
 * phải đứng yên khi camera world đổi, và toạ độ UI tính theo pixel design 512×288.
 *
 * Hai TODO có chủ ý:
 * - `TODO(ui)`: font pixel của pack. Pack đã stage không có file font (`.ttf`/`.fnt`),
 *   nên đang dùng font hệ thống của engine. Thêm font vào `resources/art/ui/` rồi gán
 *   `Label.font` là xong, không phải đổi layout.
 * - `TODO(ui)`: icon vàng + khung nine-path. Art đã stage (`ui/theme-wood`), nhưng cần
 *   set Border trong Sprite Editor trước (import-checklist §2.4) nên chưa làm ở đây.
 */
import {
  _decorator,
  Color as CocosColor,
  Component,
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  view,
} from 'cc';
import { loadTexture } from './assets/texture-cache';
import { sliceFrame } from './level-view';
import type { TileRect } from './level-view';

const { ccclass } = _decorator;

/** `cc` là module any trong repo: type phải suy ra từ import value (xem `texture-cache.ts`). */
type Label = InstanceType<typeof CocosLabel>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** `Heart.png` 80×16 = 5 trạng thái 16×16 xếp ngang, đầy → rỗng (import-checklist §3.5). */
export const HEART_SHEET = 'resources/art/ui/Heart.png';

const HEART_SIZE_PX = 16;
/** Trạng thái 0 = tim đầy; trạng thái 4 = tim rỗng. */
const HEART_FULL_INDEX = 0;
const HEART_EMPTY_INDEX = 4;
/** Khoảng cách giữa hai tim, px design (16 px tim + 2 px thở). */
const HEART_SPACING_PX = 18;

const TEXT_COLOR = new CocosColor(255, 255, 255, 255);
const LABEL_FONT_SIZE = 12;

/** Chỗ đặt HUD, tính từ mép trên-trái / trên-phải của màn hình design. */
const PADDING_PX = 8;
const HEART_ROW_TOP_PX = 10;
const GOLD_ROW_TOP_PX = 28;

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
  private frames: {
    readonly full: SpriteFrame;
    readonly empty: SpriteFrame;
  } | null = null;
  private roomLabel: Label | null = null;
  private goldLabel: Label | null = null;
  private shownHearts = -1;
  private shownRoom = '';
  private shownGold = -1;

  /**
   * Dựng HUD. `node` này phải là con của một `Canvas` (bootstrap tạo), nếu không
   * sẽ không có gì được vẽ.
   */
  async init(maxHearts: number, roomText: string): Promise<void> {
    const texture = await loadTexture(HEART_SHEET);
    const frames = {
      full: sliceFrame(texture, heartRect(HEART_FULL_INDEX)),
      empty: sliceFrame(texture, heartRect(HEART_EMPTY_INDEX)),
    };
    this.frames = frames;

    const size = view.getVisibleSize();
    const left = -size.width / 2 + PADDING_PX;
    const top = size.height / 2 - HEART_ROW_TOP_PX;

    for (let index = 0; index < maxHearts; index += 1) {
      const node = this.makeSprite(`heart-${index}`, frames.full);
      node.setPosition(left + index * HEART_SPACING_PX + HEART_SIZE_PX / 2, top, 0);
      this.heartNodes.push(node);
    }

    this.roomLabel = createLabel(this.node, 'room-label', roomText);
    this.roomLabel.node.setPosition(size.width / 2 - PADDING_PX, top, 0);

    // Placeholder: chưa có meta/save nối vào run (M4). Vẫn hiện số 0 để HUD có đủ ô.
    this.goldLabel = createLabel(this.node, 'gold-label', 'Gold 0');
    this.goldLabel.node.setPosition(left, top - GOLD_ROW_TOP_PX, 0);
    // Neo trái để chữ bắt đầu đúng lề trái thay vì bị đẩy ra ngoài màn hình.
    const goldTransform: UITransform | null = this.goldLabel.node.getComponent(CocosUITransform);
    if (goldTransform !== null) goldTransform.setAnchorPoint(0, 0.5);

    this.setRoomLabel(roomText);
    this.setHearts(maxHearts);
    this.setGold(0);
  }

  /** Cập nhật hàng tim; chỉ đổi spriteFrame khi số tim thật sự đổi. */
  setHearts(hearts: number): void {
    const frames = this.frames;
    if (frames === null || hearts === this.shownHearts) return;
    this.shownHearts = hearts;

    this.heartNodes.forEach((node, index) => {
      const sprite: Sprite | null = node.getComponent(CocosSprite);
      if (sprite === null) return;
      sprite.spriteFrame = index < hearts ? frames.full : frames.empty;
    });
  }

  /** Nhãn `3/9` của `RunState.roomLabel`. */
  setRoomLabel(text: string): void {
    const label = this.roomLabel;
    if (label === null || text === this.shownRoom) return;
    this.shownRoom = text;
    label.string = text;
    // Nhãn neo phải-trên để mép phải luôn cách lề PADDING_PX dù nội dung dài ngắn.
    const transform: UITransform | null = label.node.getComponent(CocosUITransform);
    if (transform !== null) transform.setAnchorPoint(1, 0.5);
    label.node.setPosition(view.getVisibleSize().width / 2 - PADDING_PX, label.node.position.y, 0);
  }

  /** TODO(ui): thay bằng icon vàng + số của meta/save. */
  setGold(gold: number): void {
    const label = this.goldLabel;
    if (label === null || gold === this.shownGold) return;
    this.shownGold = gold;
    label.string = `Gold ${gold}`;
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
 * Tạo một node `Label` con của `parent` (phải nằm dưới Canvas).
 *
 * Export để `bootstrap` dùng lại cho màn hình lỗi load — màn đó cần chữ to, đỏ, không
 * phụ thuộc HUD đã dựng xong hay chưa.
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
  // TODO(ui): thay bằng font pixel của pack khi có file font trong resources.
  label.useSystemFont = true;

  return label;
}
