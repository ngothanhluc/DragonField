/**
 * Title screen (GDD §9, §14, §15.4, §15.5, ADR-023, M21 #91):
 * the streamlined home menu — `Vào Làng`, optional `Continue Run` (when `activeRun` is non-null),
 * and `Settings` (Credits moved there). Character Select and the Meta Shop now live in the
 * Village Hub, so the Title no longer shows the character/shop/credits rows.
 *
 * Built in code, no `.scene` edits. All `Theme Wood` 9-slice framing, padding, and navigation live
 * in `screens/menu.ts`; this file decides the content and action order.
 */
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  type CharacterDef,
  type CharacterId,
} from '../../core/characters/roster';
import { titleMenuItems } from '../../core/hub/home-flow';
import { t } from '../../core/i18n';
import type { ActiveRunSave } from '../../core/save/run-save';
import type { BestProgress } from '../../core/save/save-data';
import {
  formatContinueRunDetail,
  formatTitleCharacterDetail as formatCharacterDetail,
  formatTitleCharacterLabel as formatCharacterLabel,
  formatTitleInfoLines,
} from '../../core/view/menu-layout';
import { formatBest } from '../chapter-select';
import { buildMenuScreen, MENU_COLUMN_WIDTH, type MenuItem, type MenuScreen } from './menu';

export { formatCharacterDetail, formatCharacterLabel, formatContinueRunDetail };

export interface TitleScreenOptions {
  readonly parent: Parameters<typeof buildMenuScreen>[0]['parent'];
  readonly gold: number;
  readonly best: BestProgress;
  /** Open the Village Hub (`Vào Làng`). */
  readonly onEnterVillage: () => void;
  readonly onSettings: () => void;
  /** Resumable safe-boundary run save (`null` / `undefined` hides `Continue Run`, ADR-023). */
  readonly activeRun?: ActiveRunSave | null;
  /** Invoked when the player activates `Continue Run`. */
  readonly onContinueRun?: (run: ActiveRunSave) => void;
  /** Currently selected character, shown in the info lines. */
  readonly selectedCharacter?: CharacterDef;
  /** Optional initial focused button index. */
  readonly initialFocus?: number;
}

export type TitleScreen = MenuScreen;

/** Gentle dim over the living room; the `Theme Wood` column itself stays opaque. */
const TITLE_BACKDROP_ALPHA = 84;
const TITLE_BUTTON_WIDTH = MENU_COLUMN_WIDTH - 28;

export function buildTitleScreen(options: TitleScreenOptions): Promise<TitleScreen> {
  const current: CharacterDef = options.selectedCharacter ?? CHARACTERS[DEFAULT_CHARACTER_ID];
  const activeRun = options.activeRun ?? null;
  const hasContinueRun = activeRun !== null;

  const items: MenuItem[] = [];
  for (const id of titleMenuItems(hasContinueRun)) {
    if (id === 'enter-village') {
      items.push({
        label: t('title.enterVillage'),
        detail: t('title.enterVillageDetail'),
        activate: options.onEnterVillage,
      });
    } else if (id === 'continue-run') {
      if (activeRun === null) continue;
      items.push({
        label: t('title.continueRun'),
        detail: formatContinueRunDetail(activeRun),
        disabled: options.onContinueRun === undefined,
        activate: () => options.onContinueRun?.(activeRun),
      });
    } else {
      items.push({
        label: t('title.settings'),
        detail: t('title.settingsDetail'),
        activate: options.onSettings,
      });
    }
  }

  return buildMenuScreen({
    parent: options.parent,
    name: 'title',
    title: t('title.gameTitle'),
    ...(hasContinueRun ? { titleFontSize: 20 } : {}),
    subtitle: t('title.subtitle'),
    info: [
      formatCharacterLabel(current),
      ...formatTitleInfoLines(options.gold, options.best, formatBest(options.best), hasContinueRun),
    ],
    items,
    ...(options.initialFocus !== undefined ? { initialFocus: options.initialFocus } : {}),
    hint: t('title.hint'),
    buttonWidth: TITLE_BUTTON_WIDTH,
    buttonHeight: hasContinueRun ? 29 : 31,
    buttonGap: hasContinueRun ? 3 : 5,
    buttonFontSize: hasContinueRun ? 10 : 11,
    backdropAlpha: TITLE_BACKDROP_ALPHA,
    panelWidth: MENU_COLUMN_WIDTH,
    panelFullHeight: true,
  });
}

/** The four playable classes are still exported for screens that build a character row. */
export type { CharacterId };
