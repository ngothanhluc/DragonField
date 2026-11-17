/**
 * Màn chọn chapter (GDD §2, §9) — dựng 100% bằng code, không sửa `.scene`.
 *
 * Ba nút chapter (khoá/mở + best) và Back về title. Nút khoá **không** bấm được,
 * và bootstrap còn gọi `core/save/chapter-gate.ts` trước khi load `.tmx` — nút
 * disabled không phải lớp bảo vệ duy nhất.
 *
 * Dùng chung `screens/menu.ts` cho frame nút, focus nhìn thấy được và phím
 * ↑/↓/←/→ + Enter/Space + Esc.
 */
import { Layers, Node as CocosNode } from 'cc';
import type { BestProgress } from '../core/save/save-data';
import {
  FocusList,
  MENU_MUTED_COLOR,
  MENU_TEXT_COLOR,
  MENU_TITLE_COLOR,
  createMenuButton,
  createMenuPanel,
  createScreenBackdrop,
  loadMenuFrames,
  visibleUiSize,
  type MenuButtonHandle,
} from './screens/menu';
import { createLabel } from './hud';

type Node = InstanceType<typeof CocosNode>;

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
  /** Esc / nút Back. */
  readonly onBack: () => void;
}

export interface ChapterSelectScreen {
  readonly node: Node;
  focus(index: number): void;
  destroy(): void;
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

export async function buildChapterSelect(
  parent: Node,
  options: ChapterSelectOptions,
): Promise<ChapterSelectScreen> {
  const frames = await loadMenuFrames();
  const size = visibleUiSize();

  const root = new CocosNode('chapter-select');
  root.layer = Layers.Enum.UI_2D;
  root.parent = parent;

  createScreenBackdrop(root);

  const title = createLabel(root, 'title', 'YOKAI FIELD');
  title.fontSize = 30;
  title.lineHeight = 34;
  title.color = MENU_TITLE_COLOR;
  title.node.setPosition(0, size.height / 2 - 34, 0);

  const subtitle = createLabel(root, 'subtitle', 'SELECT CHAPTER');
  subtitle.fontSize = 12;
  subtitle.color = MENU_TEXT_COLOR;
  subtitle.node.setPosition(0, size.height / 2 - 64, 0);

  const best = createLabel(root, 'best', formatBest(options.best));
  best.fontSize = 11;
  best.color = MENU_TEXT_COLOR;
  best.node.setPosition(0, -38, 0);

  const hint = createLabel(root, 'hint', 'Clear a chapter to unlock the next');
  hint.fontSize = 10;
  hint.color = MENU_MUTED_COLOR;
  hint.node.setPosition(0, -size.height / 2 + 16, 0);

  const handles: MenuButtonHandle[] = [];
  const count = options.chapters.length;
  const width = 120;
  const gap = 10;
  const rowWidth = count * width + Math.max(0, count - 1) * gap;
  const firstX = -rowWidth / 2 + width / 2;

  options.chapters.forEach((chapter, index) => {
    const handle = createMenuButton(
      root,
      `chapter-${chapter.chapter}`,
      {
        label: `Chapter ${chapter.chapter}`,
        detail: chapter.playable ? 'play' : chapter.hasData ? 'locked' : 'no data',
        disabled: !chapter.playable,
        activate: () => options.onSelect(chapter.chapter),
      },
      frames,
      { width, height: 46, fontSize: 13 },
    );
    handle.node.setPosition(firstX + index * (width + gap), 14, 0);
    handles.push(handle);
  });

  const back = createMenuButton(
    root,
    'back',
    { label: 'Back', activate: options.onBack },
    frames,
    { width: 120, height: 30, fontSize: 12 },
  );
  back.node.setPosition(0, -88, 0);
  handles.push(back);

  const panel = createMenuPanel(root, 'chapter-panel', frames.panel, Math.min(460, size.width - 24), size.height - 28);
  panel.setSiblingIndex(1);

  // Chapter 1 luôn ở index 0; nếu build không có dữ liệu thì vẫn focus nút đầu.
  const focus = new FocusList({ handles, onBack: options.onBack });

  return {
    node: root,
    focus: (index: number) => focus.focus(index),
    destroy(): void {
      focus.destroy();
      if (root.isValid) root.destroy();
    },
  };
}
