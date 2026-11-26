/**
 * Chapter select screen (GDD §2, §9) — built 100% in code, no `.scene` edits.
 *
 * Four chapter buttons (locked/unlocked + best) and Back to title inside the same centred
 * `Theme Wood` column as Title, so switching Title ↔ Chapter Select keeps the wooden frame steady
 * while the living chapter backdrop and 1:1 weather cross-swap behind it.
 */
import { Layers, Node as CocosNode } from 'cc';
import type { BestProgress } from '../core/save/save-data';
import { computeMenuScreenLayout } from '../core/view/menu-layout';
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

/** Gentle dim over the living room; matches Title so transitions feel seamless. */
const CHAPTER_BACKDROP_ALPHA = 84;
const BUTTON_WIDTH = MENU_COLUMN_WIDTH - 28;
const CHAPTER_BUTTON_HEIGHT = 33;
const BACK_BUTTON_HEIGHT = 28;
const BUTTON_GAP = 5;

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

  const count = options.chapters.length;
  const buttonHeights = [
    ...options.chapters.map(() => CHAPTER_BUTTON_HEIGHT),
    BACK_BUTTON_HEIGHT,
  ];

  const layout = computeMenuScreenLayout({
    visibleWidth: size.width,
    visibleHeight: size.height,
    hasSubtitle: true,
    infoCount: 1,
    buttonHeights,
    buttonGap: BUTTON_GAP,
    panelWidth: MENU_COLUMN_WIDTH,
    panelFullHeight: true,
  });

  const panel = createMenuPanel(
    root,
    'chapter-panel',
    frames,
    layout.panelWidth,
    layout.panelHeight,
    {
      dividerY: layout.dividerY,
      dividerWidth: layout.dividerWidth,
    },
  );
  panel.setPosition(0, layout.panelY, 0);

  const title = createLabel(root, 'title', 'YOKAI FIELD');
  title.fontSize = layout.titleFontSize;
  title.lineHeight = layout.titleFontSize + 4;
  title.color = MENU_TITLE_COLOR;
  title.node.setPosition(0, layout.titleY, 0);

  const subtitle = createLabel(root, 'subtitle', 'SELECT CHAPTER');
  subtitle.fontSize = layout.subtitleFontSize;
  subtitle.lineHeight = layout.subtitleFontSize + 2;
  subtitle.color = MENU_TEXT_COLOR;
  subtitle.node.setPosition(0, layout.subtitleY ?? 99, 0);

  const best = createLabel(root, 'best', formatBest(options.best));
  best.fontSize = layout.infoFontSize;
  best.lineHeight = layout.infoFontSize + 2;
  best.color = MENU_MUTED_COLOR;
  best.node.setPosition(0, layout.infoYs[0] ?? 84, 0);

  const handles: MenuButtonHandle[] = [];
  options.chapters.forEach((chapter, index) => {
    const handle = createMenuButton(
      root,
      `chapter-${chapter.chapter}`,
      {
        label: `Chapter ${chapter.chapter}`,
        detail: chapter.playable ? 'Enter chapter' : chapter.hasData ? 'Locked — clear previous' : 'No data',
        disabled: !chapter.playable,
        activate: () => options.onSelect(chapter.chapter),
      },
      frames,
      { width: BUTTON_WIDTH, height: CHAPTER_BUTTON_HEIGHT, fontSize: 11 },
    );
    handle.node.setPosition(0, layout.buttonYs[index] ?? 0, 0);
    handles.push(handle);
  });

  const back = createMenuButton(
    root,
    'back',
    { label: 'Back', activate: options.onBack },
    frames,
    { width: BUTTON_WIDTH, height: BACK_BUTTON_HEIGHT, fontSize: 11 },
  );
  back.node.setPosition(0, layout.buttonYs[count] ?? -96, 0);
  handles.push(back);

  const hint = createLabel(root, 'hint', 'Clear a chapter to unlock the next');
  hint.fontSize = layout.hintFontSize;
  hint.lineHeight = layout.hintFontSize + 2;
  hint.color = MENU_MUTED_COLOR;
  hint.node.setPosition(0, layout.hintY, 0);

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
