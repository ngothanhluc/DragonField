/**
 * Title screen (GDD §9): Play, Shop, Settings, Credits.
 *
 * Built in code, no `.scene` edits. All layout/navigation lives in `screens/menu.ts`;
 * this file only decides the content and action order.
 *
 * Since #8 the title draws a real chapter-1 room behind it: a narrow opaque column with a light
 * dim (94 alpha) instead of the near-opaque backdrop, so the living room stays visible on both
 * sides while every label/button keeps its wooden panel.
 */
import { formatBest } from '../chapter-select';
import type { BestProgress } from '../../core/save/save-data';
import { buildMenuScreen, MENU_COLUMN_WIDTH, type MenuScreen } from './menu';

export interface TitleScreenOptions {
  readonly parent: Parameters<typeof buildMenuScreen>[0]['parent'];
  readonly gold: number;
  readonly best: BestProgress;
  readonly onPlay: () => void;
  readonly onShop: () => void;
  readonly onSettings: () => void;
  readonly onCredits: () => void;
}

/** A light dim over the living room; the panel itself stays opaque (alpha 255). */
const TITLE_BACKDROP_ALPHA = 96;
const TITLE_BUTTON_WIDTH = MENU_COLUMN_WIDTH - 24;

export function buildTitleScreen(options: TitleScreenOptions): Promise<MenuScreen> {
  return buildMenuScreen({
    parent: options.parent,
    name: 'title',
    title: 'YOKAI FIELD',
    subtitle: 'Dodge. Auto-fire. Clear.',
    // Two short lines instead of one long one: the column is only 240 design px wide.
    info: [`Gold ${options.gold}`, formatBest(options.best)],
    items: [
      { label: 'Play', detail: 'Choose a chapter', activate: options.onPlay },
      { label: 'Meta shop', detail: 'Spend gold on upgrades', activate: options.onShop },
      { label: 'Settings', detail: 'Volume, fullscreen, keys', activate: options.onSettings },
      { label: 'Credits', detail: 'Art, audio, engine', activate: options.onCredits },
    ],
    buttonWidth: TITLE_BUTTON_WIDTH,
    buttonHeight: 36,
    buttonGap: 6,
    buttonFontSize: 13,
    backdropAlpha: TITLE_BACKDROP_ALPHA,
    panelWidth: MENU_COLUMN_WIDTH,
    panelFullHeight: true,
  });
}
