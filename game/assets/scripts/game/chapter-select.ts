/**
 * Chapter select screen (GDD §2, §9, §15.5, M15) — built 100% in code, no `.scene` edits.
 *
 * Four chapter buttons (locked/unlocked + best), an Ascension 0–5 `<` / `>` selector clamped to
 * `0 .. unlockedAscensionForChapter(save, selectedChapter)` with concise `ascensionSummaryLines`
 * (including Gold% bonus), and `Back` inside the centred `Theme Wood` column (`MENU_COLUMN_WIDTH`)
 * so the living chapter backdrop and hero cross-swap cleanly behind it.
 */
import { Button as CocosButton, Layers, Node as CocosNode } from 'cc';
import {
  ascensionLabel,
  ascensionSummaryLines,
  clampAscension,
} from '../core/run/ascension';
import {
  unlockedAscensionForChapter,
  type BestProgress,
  type SaveData,
} from '../core/save/save-data';
import {
  ASCENSION_SUMMARY_MAX_CHARS,
  computeChapterSelectLayout,
  computeMenuButtonTextLayout,
  formatChapterAscensionHint,
  formatChapterButtonDetail,
  nextChapterSelectFocus,
  resolveMenuButtonVisualState,
  type MenuButtonBox,
  type MenuGridDirection,
} from '../core/view/menu-layout';
import { playSfx } from './audio/sfx';
import { createLabel } from './hud';
import {
  MENU_COLUMN_WIDTH,
  MENU_DISABLED_COLOR,
  MENU_MUTED_COLOR,
  MENU_TEXT_COLOR,
  MENU_TITLE_COLOR,
  createFocusFrame,
  createMenuPanel,
  createScreenBackdrop,
  loadMenuFrames,
  visibleUiSize,
  type MenuFrames,
} from './screens/menu';
import { Color as CocosColor, Sprite as CocosSprite, UITransform as CocosUITransform } from 'cc';

type Button = InstanceType<typeof CocosButton>;
type Label = ReturnType<typeof createLabel>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;

export interface ChapterButton {
  readonly chapter: number;
  /** Playable (unlocked **and** has `.tmx` data). */
  readonly playable: boolean;
  /** Whether the chapter has level data in this build. Without it, always locked. */
  readonly hasData: boolean;
  /** Highest unlocked Ascension tier (0..5) when `save` is not supplied directly. */
  readonly maxAscension?: number;
}

export interface ChapterSelectOptions {
  /** 1-based, up to `CHAPTERS_PER_RUN`; the display order is kept as given. */
  readonly chapters: readonly ChapterButton[];
  readonly best: BestProgress;
  /** Optional save snapshot used to read `unlockedAscensionForChapter(save, chapter)`. */
  readonly save?: SaveData;
  /** Initial highlighted chapter (1-based); defaults to first playable chapter. */
  readonly initialChapter?: number;
  /** Initial Ascension tier (clamped to `0 .. maxUnlocked` for the selected chapter). */
  readonly initialAscension?: number;
  /** Fired whenever the selected Ascension tier or chapter changes so `ScreenFlow` preserves it. */
  readonly onAscensionChange?: (ascension: number, chapter: number) => void;
  /** Start `chapter` at `ascension` (M15). */
  readonly onStartChapter?: (chapter: number, ascension?: number) => void;
  /** Backwards-compatible chapter start callback (`onStartChapter` is also invoked when provided). */
  readonly onSelect?: (chapter: number, ascension: number) => void;
  /** Esc / the Back button. */
  readonly onBack: () => void;
  /**
   * Focus moved (keyboard or hover), including the initial focus: the chapter of the focused
   * button, or `null` when focus is on `<` / `>` / `Back`. Drives the living room behind the menu.
   */
  readonly onFocusChapter?: (chapter: number | null) => void;
}

export interface ChapterSelectScreen {
  readonly node: Node;
  focus(index: number): void;
  getAscension(): number;
  setAscension(tier: number): void;
  destroy(): void;
}

/** Gentle dim over the living room; matches Title so transitions feel seamless. */
const CHAPTER_BACKDROP_ALPHA = 84;

const BUTTON_NORMAL_TINT = new CocosColor(242, 230, 218, 255);
const BUTTON_FOCUS_TINT = new CocosColor(255, 246, 228, 255);
const BUTTON_HOVER_TINT = new CocosColor(255, 255, 255, 255);
const BUTTON_PRESSED_TINT = new CocosColor(244, 224, 206, 255);
const BUTTON_DISABLED_TINT = new CocosColor(186, 176, 166, 255);
const BUTTON_DISABLED_FOCUS_TINT = new CocosColor(214, 204, 194, 255);

const INK_DARK = new CocosColor(30, 15, 6, 255);
const INK_FOCUS = new CocosColor(48, 14, 4, 255);
const INK_DETAIL = new CocosColor(62, 28, 10, 255);
const INK_DETAIL_FOCUS = new CocosColor(78, 30, 8, 255);
const INK_DISABLED_DETAIL = new CocosColor(202, 190, 176, 255);
const ASCENSION_ACTIVE_COLOR = new CocosColor(255, 214, 112, 255);

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

interface DynamicControl {
  readonly node: Node;
  setInteraction(focused: boolean, hovered: boolean, pressed: boolean): void;
  update(labelText: string, detailText: string | undefined, disabled: boolean): void;
  isDisabled(): boolean;
}

export async function buildChapterSelect(
  parent: Node,
  options: ChapterSelectOptions,
): Promise<ChapterSelectScreen> {
  const chapters = options.chapters;
  const count = chapters.length;
  const prevIdx = count;
  const nextIdx = count + 1;
  const backIdx = count + 2;

  const maxUnlockedFor = (chapterNum: number): number => {
    if (options.save !== undefined) {
      return clampAscension(unlockedAscensionForChapter(options.save, chapterNum));
    }
    const found = chapters.find((entry) => entry.chapter === chapterNum);
    return clampAscension(found?.maxAscension ?? 0);
  };

  const firstPlayableIdx = Math.max(
    0,
    chapters.findIndex((entry) =>
      options.initialChapter !== undefined ? entry.chapter === options.initialChapter : entry.playable,
    ),
  );

  let destroyed = false;
  let focusedIndex = firstPlayableIdx;
  let selectedChapterIdx = firstPlayableIdx;
  let hoveredIndex: number | null = null;
  let pressedIndex: number | null = null;

  const currentChapterBtn = (): ChapterButton | undefined => chapters[selectedChapterIdx];
  const initialChapterNum = currentChapterBtn()?.chapter ?? 1;
  let selectedAscension = Math.min(
    clampAscension(options.initialAscension ?? 0),
    maxUnlockedFor(initialChapterNum),
  );

  let syncVisuals: (() => void) | null = null;

  const emitFocusChapter = (focusIdx: number): void => {
    const ch = focusIdx >= 0 && focusIdx < count ? chapters[focusIdx]?.chapter ?? null : null;
    options.onFocusChapter?.(ch);
  };

  const selectChapterIndex = (idx: number): void => {
    const clampedIdx = Math.min(Math.max(0, idx), Math.max(0, count - 1));
    selectedChapterIdx = clampedIdx;
    const btn = chapters[clampedIdx];
    const maxAsc = btn !== undefined && btn.playable ? maxUnlockedFor(btn.chapter) : 0;
    const clampedAsc = Math.min(selectedAscension, maxAsc);
    selectedAscension = clampedAsc;
    if (btn !== undefined) {
      options.onAscensionChange?.(selectedAscension, btn.chapter);
    }
  };

  const stepAscension = (delta: number): void => {
    const btn = currentChapterBtn();
    if (btn === undefined || !btn.playable) return;
    const maxAsc = maxUnlockedFor(btn.chapter);
    const nextAsc = Math.min(maxAsc, Math.max(0, selectedAscension + Math.trunc(delta)));
    if (nextAsc === selectedAscension) return;
    selectedAscension = nextAsc;
    playSfx('ui-move');
    options.onAscensionChange?.(selectedAscension, btn.chapter);
    syncVisuals?.();
  };

  const setFocus = (next: number, fromPointer = false): void => {
    const clamped = Math.min(backIdx, Math.max(0, next));
    const changed = clamped !== focusedIndex;
    if (!fromPointer) {
      hoveredIndex = null;
      pressedIndex = null;
    }
    focusedIndex = clamped;
    if (clamped < count) {
      selectChapterIndex(clamped);
    }
    if (changed) {
      playSfx('ui-move');
      emitFocusChapter(clamped);
    }
    syncVisuals?.();
  };

  const startSelectedChapter = (chapterIndex: number): void => {
    const btn = chapters[chapterIndex];
    if (btn === undefined || !btn.playable) return;
    selectChapterIndex(chapterIndex);
    playSfx('ui-confirm');
    options.onStartChapter?.(btn.chapter, selectedAscension);
    options.onSelect?.(btn.chapter, selectedAscension);
  };

  const activateIndex = (index: number): void => {
    if (index < count) {
      startSelectedChapter(index);
      return;
    }
    if (index === prevIdx) {
      stepAscension(-1);
      return;
    }
    if (index === nextIdx) {
      stepAscension(1);
      return;
    }
    playSfx('ui-confirm');
    options.onBack();
  };

  // Attach capture-phase key listener BEFORE `await loadMenuFrames()` (`AGENTS.md` trap).
  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || destroyed) return;
    const key = event.key;
    const code = event.keyCode;

    if (key === 'Escape' || code === 27) {
      event.preventDefault();
      options.onBack();
      return;
    }

    const left = key === 'ArrowLeft' || code === 37;
    const right = key === 'ArrowRight' || code === 39;
    const up = key === 'ArrowUp' || code === 38;
    const down = key === 'ArrowDown' || code === 40;

    if (left || right) {
      event.preventDefault();
      if (focusedIndex < count) {
        stepAscension(left ? -1 : 1);
      } else {
        setFocus(nextChapterSelectFocus(focusedIndex, left ? 'left' : 'right', count));
      }
      return;
    }

    if (up || down) {
      event.preventDefault();
      const dir: MenuGridDirection = up ? 'up' : 'down';
      setFocus(nextChapterSelectFocus(focusedIndex, dir, count));
      return;
    }

    if (key === 'Enter' || key === ' ' || code === 13 || code === 32) {
      event.preventDefault();
      activateIndex(focusedIndex);
    }
  };

  const removeListeners = (): void => {
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);

  // Fire initial chapter backdrop & ascension notification immediately.
  emitFocusChapter(focusedIndex);
  options.onAscensionChange?.(selectedAscension, initialChapterNum);

  let frames: MenuFrames;
  try {
    frames = await loadMenuFrames();
  } catch (error: unknown) {
    removeListeners();
    throw error;
  }

  if (destroyed) {
    removeListeners();
    const cancelled = new CocosNode('chapter-select-cancelled');
    return {
      node: cancelled,
      focus: () => {},
      getAscension: () => selectedAscension,
      setAscension: () => {},
      destroy(): void {
        if (cancelled.isValid) cancelled.destroy();
      },
    };
  }

  const size = visibleUiSize();
  const layout = computeChapterSelectLayout({
    visibleWidth: size.width,
    visibleHeight: size.height,
    chapterCount: count,
  });

  const root = new CocosNode('chapter-select');
  root.layer = Layers.Enum.UI_2D;
  root.parent = parent;

  createScreenBackdrop(root, CHAPTER_BACKDROP_ALPHA);

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

  const title = createLabel(root, 'title', 'SELECT CHAPTER');
  title.fontSize = layout.titleFontSize;
  title.lineHeight = layout.titleFontSize + 2;
  title.color = MENU_TITLE_COLOR;
  title.node.setPosition(0, layout.titleY, 0);

  const best = createLabel(root, 'best', formatBest(options.best));
  best.fontSize = layout.bestFontSize;
  best.lineHeight = layout.bestFontSize + 2;
  best.color = MENU_MUTED_COLOR;
  best.node.setPosition(0, layout.bestY, 0);

  const controls: DynamicControl[] = [];

  chapters.forEach((chapter, index) => {
    const slot = layout.chapterSlots[index] ?? {
      x: 0,
      y: 0,
      width: MENU_COLUMN_WIDTH - 28,
      height: 29,
      fontSize: 10,
    };
    const detail = formatChapterButtonDetail(
      chapter.playable,
      chapter.hasData,
      index === selectedChapterIdx,
      selectedAscension,
      maxUnlockedFor(chapter.chapter),
    );
    controls.push(
      createChapterControl(
        root,
        `chapter-${chapter.chapter}`,
        `Chapter ${chapter.chapter}`,
        detail,
        !chapter.playable,
        frames,
        slot,
      ),
    );
  });

  // Ascension `<` and `>` buttons + centred Ascension label.
  const prevControl = createChapterControl(
    root,
    'chapter-ascension-prev',
    '<',
    undefined,
    true,
    frames,
    layout.ascensionPrevButton,
  );
  controls.push(prevControl);

  const nextControl = createChapterControl(
    root,
    'chapter-ascension-next',
    '>',
    undefined,
    true,
    frames,
    layout.ascensionNextButton,
  );
  controls.push(nextControl);

  const ascLabel = createLabel(root, 'chapter-ascension-label', ascensionLabel(selectedAscension));
  ascLabel.fontSize = layout.ascensionLabelFontSize;
  ascLabel.lineHeight = layout.ascensionLabelFontSize + 2;
  ascLabel.color = selectedAscension > 0 ? ASCENSION_ACTIVE_COLOR : MENU_TEXT_COLOR;
  ascLabel.node.setPosition(layout.ascensionLabelX, layout.ascensionLabelY, 0);

  const summaryLabels: Label[] = layout.summaryLineYs.map((lineY, i) => {
    const lbl = createLabel(root, `chapter-ascension-summary-${i}`, '');
    lbl.fontSize = layout.summaryFontSize;
    lbl.lineHeight = layout.summaryFontSize + 1;
    lbl.color = MENU_MUTED_COLOR;
    lbl.node.setPosition(0, lineY, 0);
    return lbl;
  });

  const backControl = createChapterControl(
    root,
    'back',
    'Back',
    undefined,
    false,
    frames,
    layout.backButton,
  );
  controls.push(backControl);

  const hint = createLabel(root, 'hint', '');
  hint.fontSize = layout.hintFontSize;
  hint.lineHeight = layout.hintFontSize + 2;
  hint.color = MENU_MUTED_COLOR;
  hint.node.setPosition(0, layout.hintY, 0);

  controls.forEach((control, index) => {
    control.node.on(CocosNode.EventType.MOUSE_ENTER, () => {
      hoveredIndex = index;
      setFocus(index, true);
    });
    control.node.on(CocosNode.EventType.MOUSE_LEAVE, () => {
      if (hoveredIndex === index) hoveredIndex = null;
      if (pressedIndex === index) pressedIndex = null;
      syncVisuals?.();
    });
    control.node.on(CocosNode.EventType.MOUSE_DOWN, () => {
      hoveredIndex = index;
      pressedIndex = index;
      setFocus(index, true);
    });
    control.node.on(CocosNode.EventType.MOUSE_UP, () => {
      if (pressedIndex === index) pressedIndex = null;
      syncVisuals?.();
    });
    control.node.on(CocosButton.EventType.CLICK, () => {
      pressedIndex = null;
      setFocus(index, true);
      activateIndex(index);
    });
  });

  syncVisuals = (): void => {
    if (destroyed || !root.isValid) return;

    const selBtn = currentChapterBtn();
    const selPlayable = selBtn?.playable === true;
    const maxAsc = selBtn !== undefined && selPlayable ? maxUnlockedFor(selBtn.chapter) : 0;
    selectedAscension = Math.min(selectedAscension, maxAsc);

    chapters.forEach((chapter, idx) => {
      const detail = formatChapterButtonDetail(
        chapter.playable,
        chapter.hasData,
        idx === selectedChapterIdx,
        selectedAscension,
        maxUnlockedFor(chapter.chapter),
      );
      controls[idx]?.update(`Chapter ${chapter.chapter}`, detail, !chapter.playable);
    });

    prevControl.update('<', undefined, !selPlayable || selectedAscension <= 0);
    nextControl.update('>', undefined, !selPlayable || selectedAscension >= maxAsc);

    ascLabel.string = ascensionLabel(selectedAscension);
    ascLabel.color = selectedAscension > 0 ? ASCENSION_ACTIVE_COLOR : MENU_TEXT_COLOR;

    const summaryLines = selPlayable
      ? ascensionSummaryLines(selectedAscension, ASCENSION_SUMMARY_MAX_CHARS)
      : ['Unlock this chapter to select Ascension'];
    summaryLabels.forEach((lbl, idx) => {
      const text = summaryLines[idx] ?? '';
      lbl.string = text;
      lbl.node.active = text.length > 0;
      lbl.color = selectedAscension > 0 && selPlayable ? MENU_TEXT_COLOR : MENU_MUTED_COLOR;
    });

    hint.string = formatChapterAscensionHint(selPlayable, maxAsc);

    controls.forEach((control, idx) => {
      control.setInteraction(
        idx === focusedIndex,
        idx === hoveredIndex,
        idx === pressedIndex,
      );
    });
  };

  syncVisuals();

  return {
    node: root,
    focus: (index: number) => setFocus(index),
    getAscension: () => selectedAscension,
    setAscension(tier: number): void {
      const btn = currentChapterBtn();
      const maxAsc = btn !== undefined && btn.playable ? maxUnlockedFor(btn.chapter) : 0;
      selectedAscension = Math.min(maxAsc, clampAscension(tier));
      if (btn !== undefined) {
        options.onAscensionChange?.(selectedAscension, btn.chapter);
      }
      syncVisuals?.();
    },
    destroy(): void {
      destroyed = true;
      removeListeners();
      if (root.isValid) root.destroy();
    },
  };
}

function createChapterControl(
  parent: Node,
  name: string,
  initialLabel: string,
  initialDetail: string | undefined,
  initialDisabled: boolean,
  frames: MenuFrames,
  box: MenuButtonBox,
): DynamicControl {
  const node = new CocosNode(name);
  node.layer = Layers.Enum.UI_2D;
  node.parent = parent;
  node.setPosition(box.x, box.y, 0);

  const sprite: Sprite = node.addComponent(CocosSprite);
  sprite.type = CocosSprite.Type.SLICED;
  sprite.sizeMode = CocosSprite.SizeMode.CUSTOM;
  sprite.trim = false;

  const transform: UITransform | null = node.getComponent(CocosUITransform);
  if (transform !== null) transform.setContentSize(box.width, box.height);

  const ring = createFocusFrame(node, frames.focus, box.width, box.height);
  const hasDetail = initialDetail !== undefined;
  const textLayout = computeMenuButtonTextLayout({
    width: box.width,
    height: box.height,
    fontSize: box.fontSize,
    hasDetail,
  });

  const label = createLabel(node, 'label', initialLabel);
  label.fontSize = textLayout.labelFontSize;
  label.lineHeight = textLayout.labelLineHeight;
  label.node.setPosition(0, textLayout.labelY, 0);

  let detail: Label | null = null;
  if (hasDetail) {
    detail = createLabel(node, 'detail', initialDetail ?? '');
    detail.fontSize = textLayout.detailFontSize;
    detail.lineHeight = textLayout.detailLineHeight;
    detail.node.setPosition(0, textLayout.detailY, 0);
  }

  const button: Button = node.addComponent(CocosButton);
  button.transition = CocosButton.Transition.NONE;

  let disabled = initialDisabled;
  let focused = false;
  let hovered = false;
  let pressed = false;

  const applyVisual = (): void => {
    const visual = resolveMenuButtonVisualState({ disabled, focused, hovered, pressed });
    sprite.spriteFrame =
      visual.frame === 'disabled'
        ? frames.disabled
        : visual.frame === 'pressed'
          ? frames.pressed
          : visual.frame === 'hover'
            ? frames.hover
            : frames.normal;
    sprite.color =
      visual.state === 'disabled'
        ? BUTTON_DISABLED_TINT
        : visual.state === 'disabled-focused'
          ? BUTTON_DISABLED_FOCUS_TINT
          : visual.state === 'pressed'
            ? BUTTON_PRESSED_TINT
            : visual.state === 'hovered'
              ? BUTTON_HOVER_TINT
              : visual.state === 'focused'
                ? BUTTON_FOCUS_TINT
                : BUTTON_NORMAL_TINT;

    ring.applyStyle(visual.focusRingStyle);

    const active =
      visual.state === 'focused' || visual.state === 'hovered' || visual.state === 'pressed';
    label.node.setPosition(0, textLayout.labelY + visual.contentOffsetY, 0);
    label.color = disabled ? MENU_DISABLED_COLOR : active ? INK_FOCUS : INK_DARK;

    if (detail !== null) {
      detail.node.setPosition(0, textLayout.detailY + visual.contentOffsetY, 0);
      detail.color = disabled ? INK_DISABLED_DETAIL : active ? INK_DETAIL_FOCUS : INK_DETAIL;
    }
  };

  applyVisual();

  return {
    node,
    setInteraction(nextFocused: boolean, nextHovered: boolean, nextPressed: boolean): void {
      focused = nextFocused;
      hovered = nextHovered;
      pressed = nextPressed;
      applyVisual();
    },
    update(labelText: string, detailText: string | undefined, nextDisabled: boolean): void {
      label.string = labelText;
      if (detail !== null && detailText !== undefined) detail.string = detailText;
      disabled = nextDisabled;
      applyVisual();
    },
    isDisabled: (): boolean => disabled,
  };
}
