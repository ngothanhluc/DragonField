/**
 * Rich Run Result & Death screen (GDD §9, §15.5, M15):
 * Displays Run Seed, Chapter/Room depth (+ Ascension & Endless loop tags), Hero name,
 * Cause of Death (`formatDeathCause`), Build + Evolution summary (`formatBuildSummary`, capped/wrapped
 * cleanly), Unlocks earned (`formatRunUnlocks`), optional `Continue Endless` button on victory,
 * and `Meta shop` / `Chapter select` / `Title` actions.
 */
import { Button as CocosButton, Layers, Node as CocosNode } from 'cc';
import type { CharacterId } from '../../core/characters/roster';
import { t } from '../../core/i18n';
import type { DeathCause, RunUnlocksSummary } from '../../core/run/run-summary';
import {
  computeResultScreenLayout,
  formatDuration,
  formatResultScreenSummary,
  nextResultScreenFocus,
  type MenuGridDirection,
  type RunResultOwnedSkills,
  type SkillSummaryEntry,
} from '../../core/view/menu-layout';
import { playSfx } from '../audio/sfx';
import { createLabel } from '../hud';
import {
  MENU_DANGER,
  MENU_GOOD,
  MENU_MUTED_COLOR,
  MENU_TEXT_COLOR,
  MENU_TITLE_COLOR,
  createMenuButton,
  createMenuPanel,
  createScreenBackdrop,
  loadMenuFrames,
  visibleUiSize,
  type MenuButtonHandle,
  type MenuFrames,
  type MenuScreen,
} from './menu';
import type { TitleScreenOptions } from './title-screen';

export { formatDuration, type RunResultOwnedSkills, type SkillSummaryEntry };

export interface RunResultData {
  readonly chapter: number;
  readonly roomReached: number;
  readonly roomsTotal: number;
  readonly goldEarned: number;
  readonly goldTotal: number;
  readonly durationMs: number;
  readonly kills: number;
  readonly won: boolean;
  /** The chapter just unlocked, `undefined` if none was (merged with `unlocks`). */
  readonly unlockedChapter?: number;
  /** Deterministic 32-bit run seed (M15). */
  readonly seed?: number;
  /** Active Ascension tier `0..5` (M15). */
  readonly ascension?: number;
  /** Endless loop counter, `0` = normal chapter run, `>= 1` = Endless loop (M15). */
  readonly endlessLoop?: number;
  /** Hero played in this run (M15). */
  readonly characterId?: CharacterId;
  /** Cause of death on defeat, or `{ kind: 'victory' }` on win (M15). */
  readonly deathCause?: DeathCause;
  /** Owned skills & Evolutions (`ReadonlyMap`, `Record`, or `SkillSummaryEntry[]`, M15). */
  readonly ownedSkills?: RunResultOwnedSkills;
  /** Newly unlocked chapter, characters, Ascension tier, or Endless mode (M15). */
  readonly unlocks?: RunUnlocksSummary;
  /** True when `Continue Endless` may be entered from this victory screen (M15). */
  readonly canContinueEndless?: boolean;
}

export interface ResultScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly result: RunResultData;
  readonly onContinueEndless?: () => void;
  readonly onShop: () => void;
  readonly onChapterSelect: () => void;
  readonly onTitle: () => void;
}

export async function buildResultScreen(options: ResultScreenOptions): Promise<MenuScreen> {
  const { result } = options;
  const hasContinueEndless = result.won && result.canContinueEndless === true;
  const summary = formatResultScreenSummary(result);

  let destroyed = false;
  let focused = 0;
  const handles: MenuButtonHandle[] = [];

  const setFocus = (next: number, playSound = true): void => {
    if (handles.length === 0) return;
    const clamped = Math.min(handles.length - 1, Math.max(0, next));
    if (playSound && clamped !== focused) playSfx('ui-move');
    handles[focused]?.setHovered?.(false);
    focused = clamped;
    handles.forEach((handle, idx) => handle.setFocused(idx === focused));
  };

  const activateFocused = (): void => {
    const handle = handles[focused];
    if (handle === undefined || handle.item.disabled === true) return;
    playSfx('ui-confirm');
    handle.item.activate();
  };

  // Attach capture-phase key listener BEFORE `await loadMenuFrames()` (`AGENTS.md` trap).
  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || destroyed) return;
    const key = event.key;
    const code = event.keyCode;

    if (key === 'Escape' || code === 27) {
      event.preventDefault();
      options.onChapterSelect();
      return;
    }

    let dir: MenuGridDirection | null = null;
    if (key === 'ArrowLeft' || code === 37) dir = 'left';
    else if (key === 'ArrowRight' || code === 39) dir = 'right';
    else if (key === 'ArrowUp' || code === 38) dir = 'up';
    else if (key === 'ArrowDown' || code === 40) dir = 'down';

    if (dir !== null) {
      event.preventDefault();
      setFocus(nextResultScreenFocus(focused, dir, hasContinueEndless));
      return;
    }

    if (key === 'Enter' || key === ' ' || code === 13 || code === 32) {
      event.preventDefault();
      activateFocused();
    }
  };

  const removeListeners = (): void => {
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);

  let frames: MenuFrames;
  try {
    frames = await loadMenuFrames();
  } catch (error: unknown) {
    removeListeners();
    throw error;
  }

  if (destroyed) {
    removeListeners();
    const cancelled = new CocosNode('result-cancelled');
    return {
      node: cancelled,
      focus: () => {},
      updateItem: () => {},
      destroy(): void {
        if (cancelled.isValid) cancelled.destroy();
      },
    };
  }

  const size = visibleUiSize();
  const layout = computeResultScreenLayout({
    visibleWidth: size.width,
    visibleHeight: size.height,
    lineCount: summary.lines.length,
    hasContinueEndless,
  });

  const root = new CocosNode('result');
  root.layer = Layers.Enum.UI_2D;
  root.parent = options.parent;

  createScreenBackdrop(root, 220);

  const panel = createMenuPanel(
    root,
    'result-panel',
    frames,
    layout.panelWidth,
    layout.panelHeight,
    {
      dividerY: layout.dividerY - layout.panelY,
      dividerWidth: layout.dividerWidth,
    },
  );
  panel.setPosition(layout.panelX, layout.panelY, 0);

  const title = createLabel(root, 'result-title', summary.title);
  title.fontSize = layout.titleFontSize;
  title.lineHeight = layout.titleFontSize + 4;
  title.color = result.won ? MENU_TITLE_COLOR : MENU_DANGER;
  title.node.setPosition(0, layout.titleY, 0);

  const subtitle = createLabel(root, 'result-subtitle', summary.subtitle);
  subtitle.fontSize = layout.subtitleFontSize;
  subtitle.lineHeight = layout.subtitleFontSize + 4;
  subtitle.color = result.won ? MENU_TEXT_COLOR : MENU_DANGER;
  subtitle.node.setPosition(0, layout.subtitleY, 0);

  summary.lines.forEach((line, index) => {
    const lbl = createLabel(root, `result-info-${index}`, line.text);
    lbl.fontSize = layout.lineFontSize;
    lbl.lineHeight = layout.lineFontSize + 4;
    lbl.color =
      line.kind === 'evolution'
        ? MENU_TITLE_COLOR
        : line.kind === 'unlock'
          ? MENU_GOOD
          : line.kind === 'meta' || line.kind === 'skills'
            ? MENU_TEXT_COLOR
            : MENU_MUTED_COLOR;
    lbl.node.setPosition(0, layout.lineYs[index] ?? 0, 0);
  });

  if (layout.continueEndlessButton !== null) {
    const box = layout.continueEndlessButton;
    const continueHandle = createMenuButton(
      root,
      'result-continue-endless',
      {
        label: t('result.continueEndless'),
        detail: t('result.continueEndlessDetail'),
        disabled: options.onContinueEndless === undefined,
        activate: () => options.onContinueEndless?.(),
      },
      frames,
      { width: box.width, height: box.height, fontSize: box.fontSize },
    );
    continueHandle.node.setPosition(box.x, box.y, 0);
    handles.push(continueHandle);
  }

  const footerItems = [
    {
      name: 'result-shop',
      label: t('result.shopBtn'),
      detail: t('result.shopDetail'),
      activate: options.onShop,
    },
    {
      name: 'result-chapter-select',
      label: t('result.chapterBtn'),
      detail: t('result.chapterDetail'),
      activate: options.onChapterSelect,
    },
    {
      name: 'result-title-btn',
      label: t('result.titleBtn'),
      detail: t('result.titleDetail'),
      activate: options.onTitle,
    },
  ] as const;

  footerItems.forEach((spec, idx) => {
    const box = layout.footerButtons[idx]!;
    const handle = createMenuButton(
      root,
      spec.name,
      { label: spec.label, detail: spec.detail, activate: spec.activate },
      frames,
      { width: box.width, height: box.height, fontSize: box.fontSize },
    );
    handle.node.setPosition(box.x, box.y, 0);
    handles.push(handle);
  });

  handles.forEach((handle, index) => {
    handle.node.on(CocosNode.EventType.MOUSE_ENTER, () => {
      setFocus(index);
      handle.setHovered?.(true);
    });
    handle.node.on(CocosNode.EventType.MOUSE_LEAVE, () => {
      handle.setHovered?.(false);
      handle.setPressed?.(false);
    });
    handle.node.on(CocosNode.EventType.MOUSE_DOWN, () => {
      setFocus(index, false);
      handle.setPressed?.(true);
    });
    handle.node.on(CocosNode.EventType.MOUSE_UP, () => {
      handle.setPressed?.(false);
    });
    handle.node.on(CocosButton.EventType.CLICK, () => {
      handle.setPressed?.(false);
      setFocus(index, false);
      activateFocused();
    });
  });

  setFocus(focused, false);

  const hint = createLabel(root, 'result-hint', t('result.hint'));
  hint.fontSize = layout.hintFontSize;
  hint.lineHeight = layout.hintFontSize + 4;
  hint.color = MENU_MUTED_COLOR;
  hint.node.setPosition(0, layout.hintY, 0);

  return {
    node: root,
    focus: (index: number) => setFocus(index, false),
    updateItem: (index: number, labelText: string, detailText?: string) => {
      handles[index]?.setText(labelText, detailText);
    },
    destroy(): void {
      destroyed = true;
      removeListeners();
      if (root.isValid) root.destroy();
    },
  };
}
