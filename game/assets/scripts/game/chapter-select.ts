/**
 * Màn chọn chapter (stub M2) — dựng 100% bằng code, không sửa `.scene`.
 *
 * Ba nút, chapter 1 mở, chapter 2–3 khoá; hiện kỷ lục `best` lấy từ save
 * (`core/save/save-data.ts`). Nút dùng `Button` của engine để nhận click chuột
 * thật (headless test click đúng toạ độ design), không phải hack phím tắt.
 *
 * Toạ độ tính bằng pixel design (512×288 nhìn thấy), gốc ở tâm UI canvas — cùng
 * hệ với HUD (`hud.ts`). Nền tối phía sau do camera world tô (`BACKDROP_COLOR`).
 */
import {
  Button as CocosButton,
  Color as CocosColor,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
} from 'cc';
import type { BestProgress } from '../core/save/save-data';
import { loadTexture } from './assets/texture-cache';
import { createLabel } from './hud';
import { sliceFrame } from './level-view';
import type { TileRect } from './level-view';

/**
 * `cc` trong repo là module any (xem `types/cc.d.ts`), nên tên import chỉ dùng được ở vị
 * trí value. `InstanceType` giữ đúng nghĩa khi mở project trong editor có type thật.
 */
type Button = InstanceType<typeof CocosButton>;
type Color = InstanceType<typeof CocosColor>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type SpriteFrame = ReturnType<typeof sliceFrame>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** Nút gỗ của pack (`Theme Wood`), 16×8 px — kéo giãn bằng `sizeMode = CUSTOM`. */
const BUTTON_SHEET = 'resources/art/ui/theme-wood/button_normal.png';
const BUTTON_DISABLED_SHEET = 'resources/art/ui/theme-wood/button_disabled.png';
/** Ảnh 16×8 chỉ có 1 ô: lấy nguyên file. */
const BUTTON_RECT: TileRect = { x: 0, y: 0, width: 16, height: 8 };

const BUTTON_WIDTH = 116;
const BUTTON_HEIGHT = 36;
const BUTTON_GAP = 14;
const BUTTON_ROW_Y = 8;

const TITLE_Y = 108;
const SUBTITLE_Y = 78;
const BEST_Y = -52;
const HINT_Y = -76;

const TITLE_COLOR = new CocosColor(255, 230, 120, 255);
const TEXT_COLOR = new CocosColor(236, 236, 236, 255);
const MUTED_COLOR = new CocosColor(150, 150, 150, 255);
const LOCKED_COLOR = new CocosColor(128, 128, 128, 255);

export interface ChapterButton {
  readonly chapter: number;
  /** Mở được (đã unlock **và** có dữ liệu `.tmx`). */
  readonly playable: boolean;
  /** Chapter có dữ liệu level trong build này. Không có thì luôn khoá. */
  readonly hasData: boolean;
}

export interface ChapterSelectOptions {
  /** 1-based, tối đa `CHAPTERS_PER_RUN`; thứ tự hiển thị giữ nguyên. */
  readonly chapters: readonly ChapterButton[];
  readonly best: BestProgress;
  readonly onSelect: (chapter: number) => void;
}

/** Kỷ lục dạng chữ: "Best: chapter 2 · room 4" hoặc "Best: —". */
export function formatBest(best: BestProgress): string {
  if (best.chapter <= 0 || best.room <= 0) return 'Best: —';
  return `Best: chapter ${best.chapter} · room ${best.room}`;
}

/** Nhãn nút. Khoá thì nói rõ vì sao (chưa mở hay chưa có dữ liệu). */
export function chapterCaption(button: ChapterButton): string {
  if (button.playable) return `Chapter ${button.chapter}`;
  return button.hasData ? `Chapter ${button.chapter}\nlocked` : `Chapter ${button.chapter}\nno data`;
}

/**
 * Dựng màn chọn chapter dưới `parent` (node của UI canvas) và trả về root để
 * bootstrap huỷ khi vào run. Texture nút load bất đồng bộ nên hàm là `async`.
 */
export async function buildChapterSelect(
  parent: Node,
  options: ChapterSelectOptions,
): Promise<Node> {
  const [normalTexture, disabledTexture] = await Promise.all([
    loadTexture(BUTTON_SHEET),
    loadTexture(BUTTON_DISABLED_SHEET),
  ]);
  const normalFrame: SpriteFrame = sliceFrame(normalTexture, BUTTON_RECT);
  const disabledFrame: SpriteFrame = sliceFrame(disabledTexture, BUTTON_RECT);

  const root = new CocosNode('chapter-select');
  root.layer = Layers.Enum.UI_2D;
  root.parent = parent;

  const title = createLabel(root, 'title', 'YOKAI FIELD');
  title.fontSize = 30;
  title.lineHeight = 34;
  title.color = TITLE_COLOR;
  title.node.setPosition(0, TITLE_Y, 0);

  const subtitle = createLabel(root, 'subtitle', 'SELECT CHAPTER');
  subtitle.fontSize = 12;
  subtitle.color = TEXT_COLOR;
  subtitle.node.setPosition(0, SUBTITLE_Y, 0);

  const count = options.chapters.length;
  const rowWidth = count * BUTTON_WIDTH + Math.max(0, count - 1) * BUTTON_GAP;
  const firstX = -rowWidth / 2 + BUTTON_WIDTH / 2;

  options.chapters.forEach((chapter, index) => {
    const x = firstX + index * (BUTTON_WIDTH + BUTTON_GAP);
    const node = makeButton(
      root,
      `chapter-${chapter.chapter}`,
      chapterCaption(chapter),
      chapter.playable ? normalFrame : disabledFrame,
      chapter.playable ? TEXT_COLOR : LOCKED_COLOR,
    );
    node.setPosition(x, BUTTON_ROW_Y, 0);

    if (chapter.playable) {
      const button: Button = node.addComponent(CocosButton);
      // Không cần sprite target: phản hồi thị giác đã nằm ở 2 texture khác nhau.
      button.transition = CocosButton.Transition.NONE;
      node.on(CocosButton.EventType.CLICK, () => options.onSelect(chapter.chapter));
    }
  });

  const best = createLabel(root, 'best', formatBest(options.best));
  best.fontSize = 11;
  best.color = TEXT_COLOR;
  best.node.setPosition(0, BEST_Y, 0);

  const hint = createLabel(root, 'hint', 'Click Chapter 1 to start');
  hint.fontSize = 10;
  hint.color = MUTED_COLOR;
  hint.node.setPosition(0, HINT_Y, 0);

  return root;
}

/** Một nút: sprite nền + label ở giữa. Toạ độ/kích thước theo design px. */
function makeButton(
  parent: Node,
  name: string,
  caption: string,
  frame: SpriteFrame,
  labelColor: Color,
): Node {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.spriteFrame = frame;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(BUTTON_WIDTH, BUTTON_HEIGHT);

  const label = createLabel(node, 'caption', caption);
  label.fontSize = 11;
  label.lineHeight = 13;
  label.color = labelColor;
  label.node.setPosition(0, 0, 0);

  return node;
}
