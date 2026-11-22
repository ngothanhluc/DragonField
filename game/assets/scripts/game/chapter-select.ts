/**
 * Chapter select screen (GDD §2, §9) — built 100% in code, no `.scene` edits.
 *
 * Three chapter buttons (locked/unlocked + best) and Back to title. Locked buttons **cannot**
 * be clicked, and bootstrap also calls `core/save/chapter-gate.ts` before loading `.tmx` — the
 * disabled button is not the only protection.
 *
 * Shares `screens/menu.ts` for button frames, visible focus and keys
 * ↑/↓/←/→ + Enter/Space + Esc.
 *
 * Since #8 a real room is drawn behind it (#8: the focused chapter's room, chapter 1 at first):
 * the buttons stack vertically in a narrow opaque column with a light dim, so the room and its
 * critters stay visible on both sides. `onFocusChapter` tells ScreenFlow which room to show.
 */
import { Layers, Node as CocosNode } from 'cc';
import type { BestProgress } from '../core/save/save-data';
import {
  FocusList,
  MENU_COLUMN_WIDTH,
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
  /**
   * Focus moved (keyboard or hover), including the initial focus: the chapter of the focused
   * button, or `null` when focus is on Back. Drives the living room behind the menu.
   */
  readonly onFocusChapter?: (chapter: number | null) => void;
}

export interface ChapterSelectScreen {
  readonly node: Node;
  focus(index: number): void;
  destroy(): void;
}

/** A light dim over the living room; the panel itself stays opaque (alpha 255). */
const CHAPTER_BACKDROP_ALPHA = 96;
const BUTTON_WIDTH = MENU_COLUMN_WIDTH - 40;
/** 32×4 + 4×3 gaps + Back fit inside the 268 px column with four chapters (#45). */
const BUTTON_HEIGHT = 32;
const BUTTON_GAP = 4;
const PANEL_HEIGHT = 268;

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

  createScreenBackdrop(root, CHAPTER_BACKDROP_ALPHA);

  const title = createLabel(root, 'title', 'YOKAI FIELD');
  title.fontSize = 26;
  title.lineHeight = 30;
  title.color = MENU_TITLE_COLOR;
  title.node.setPosition(0, 114, 0);

  const subtitle = createLabel(root, 'subtitle', 'SELECT CHAPTER');
  subtitle.fontSize = 11;
  subtitle.color = MENU_TEXT_COLOR;
  subtitle.node.setPosition(0, 88, 0);

  const best = createLabel(root, 'best', formatBest(options.best));
  best.fontSize = 10;
  best.color = MENU_TEXT_COLOR;
  best.node.setPosition(0, 70, 0);

  const hint = createLabel(root, 'hint', 'Clear a chapter to unlock the next');
  hint.fontSize = 10;
  hint.color = MENU_MUTED_COLOR;
  hint.node.setPosition(0, -127, 0);

  // Chapter buttons stack vertically inside the narrow column (the old 380 px row is gone).
  const handles: MenuButtonHandle[] = [];
  const count = options.chapters.length;
  const firstCenter = 34;

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
      { width: BUTTON_WIDTH, height: BUTTON_HEIGHT, fontSize: 12 },
    );
    handle.node.setPosition(0, firstCenter - index * (BUTTON_HEIGHT + BUTTON_GAP), 0);
    handles.push(handle);
  });

  const back = createMenuButton(
    root,
    'back',
    { label: 'Back', activate: options.onBack },
    frames,
    { width: BUTTON_WIDTH, height: 30, fontSize: 12 },
  );
  back.node.setPosition(0, -106, 0);
  handles.push(back);

  const panel = createMenuPanel(
    root,
    'chapter-panel',
    frames.panel,
    MENU_COLUMN_WIDTH,
    Math.min(PANEL_HEIGHT, size.height - 20),
  );
  panel.setSiblingIndex(1);

  // Chapter 1 is always index 0; if this build has no data, still focus the first button.
  const focus = new FocusList({
    handles,
    onBack: options.onBack,
    ...(options.onFocusChapter !== undefined
      ? {
          onFocus: (index: number) => {
            const chapter = index >= 0 && index < count ? options.chapters[index]?.chapter : undefined;
            options.onFocusChapter?.(chapter ?? null);
          },
        }
      : {}),
  });

  return {
    node: root,
    focus: (index: number) => focus.focus(index),
    destroy(): void {
      focus.destroy();
      if (root.isValid) root.destroy();
    },
  };
}
