/**
 * Chapter select screen (GDD §2, §9) — built 100% in code, no `.scene` edits.
 *
 * Three chapter buttons (locked/unlocked + best) and Back to title. Locked buttons **cannot**
 * be clicked, and bootstrap also calls `core/save/chapter-gate.ts` before loading `.tmx` — the
 * disabled button is not the only protection.
 *
 * Shares `screens/menu.ts` for button frames, visible focus and keys
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
  /** Playable (unlocked **and** has `.tmx` data). */
  readonly playable: boolean;
  /** Whether the chapter has level data in this build. Without it, always locked. */
  readonly hasData: boolean;
}

export interface ChapterSelectOptions {
  /** 1-based, up to `CHAPTERS_PER_RUN`; the display order is kept as given. */
  readonly chapters: readonly ChapterButton[];
  readonly best: BestProgress;
  readonly onSelect: (chapter: number) => void;
  /** Esc / the Back button. */
  readonly onBack: () => void;
}

export interface ChapterSelectScreen {
  readonly node: Node;
  focus(index: number): void;
  destroy(): void;
}

/** Record as text: "Best: chapter 2 · room 4" or "Best: —". */
export function formatBest(best: BestProgress): string {
  if (best.chapter <= 0 || best.room <= 0) return 'Best: —';
  return `Best: chapter ${best.chapter} · room ${best.room}`;
}

/** Button label. When locked, say why (not unlocked or no data). */
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

  // Chapter 1 is always index 0; if this build has no data, still focus the first button.
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
