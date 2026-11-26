/**
 * Title screen (GDD §9, §14, §15.4, §15.5, ADR-023):
 * Optional `Continue Run` (when `activeRun` is non-null), Play, Character Select, Meta shop,
 * Settings, Credits.
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
  readonly onPlay: () => void;
  readonly onShop: () => void;
  readonly onSettings: () => void;
  readonly onCredits: () => void;
  /** Resumable safe-boundary run save (`null` / `undefined` hides `Continue Run`, ADR-023). */
  readonly activeRun?: ActiveRunSave | null;
  /** Invoked when the player activates `Continue Run`. */
  readonly onContinueRun?: (run: ActiveRunSave) => void;
  /** Open the full 4-class Character Select & Early Unlock screen (M14). */
  readonly onOpenCharacterSelect?: () => void;
  /** Currently selected character; defaults to Ninja when omitted. */
  readonly selectedCharacter?: CharacterDef;
  /** Characters unlocked under the current save; defaults to `[selectedCharacter]`. */
  readonly availableCharacters?: readonly CharacterDef[];
  /** Called immediately when the player cycles unlocked characters with ←/→ on the Title row. */
  readonly onSelectCharacter?: (characterId: CharacterId) => void;
  /** Optional initial focused button index. */
  readonly initialFocus?: number;
}

export interface TitleScreen extends MenuScreen {
  /** Update the Character row synchronously (used when debug/save changes selection on Title). */
  setCharacter(character: CharacterDef, available?: readonly CharacterDef[]): void;
}

/** Gentle dim over the living room; the `Theme Wood` column itself stays opaque. */
const TITLE_BACKDROP_ALPHA = 84;
const TITLE_BUTTON_WIDTH = MENU_COLUMN_WIDTH - 28;

export function buildTitleScreen(options: TitleScreenOptions): Promise<TitleScreen> {
  const fallback = CHARACTERS[DEFAULT_CHARACTER_ID];
  let available: readonly CharacterDef[] =
    options.availableCharacters !== undefined && options.availableCharacters.length > 0
      ? options.availableCharacters
      : [options.selectedCharacter ?? fallback];
  let current: CharacterDef =
    available.find((entry) => entry.id === options.selectedCharacter?.id) ??
    available[0] ??
    fallback;
  let screen: MenuScreen | null = null;

  const activeRun = options.activeRun ?? null;
  const hasContinueRun = activeRun !== null;
  const characterItemIndex = hasContinueRun ? 2 : 1;

  const cycleCharacter = (delta: number): void => {
    if (available.length <= 1) return;
    const currentIndex = available.findIndex((entry) => entry.id === current.id);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + delta + available.length) % available.length;
    const next = available[nextIndex];
    if (next === undefined || next.id === current.id) return;

    current = next;
    screen?.updateItem(
      characterItemIndex,
      formatCharacterLabel(current),
      formatCharacterDetail(current, available.length),
    );
    options.onSelectCharacter?.(current.id);
  };

  const items: MenuItem[] = [];
  if (activeRun !== null) {
    items.push({
      label: t('title.continueRun'),
      detail: formatContinueRunDetail(activeRun),
      disabled: options.onContinueRun === undefined,
      activate: () => options.onContinueRun?.(activeRun),
    });
  }

  items.push(
    { label: t('title.play'), detail: t('title.playDetail'), activate: options.onPlay },
    {
      label: formatCharacterLabel(current),
      detail: formatCharacterDetail(current, available.length),
      activate: () => {
        if (options.onOpenCharacterSelect !== undefined) {
          options.onOpenCharacterSelect();
        } else {
          cycleCharacter(1);
        }
      },
    },
    {
      label: t('title.metaShop'),
      detail: t('title.metaShopDetail'),
      activate: options.onShop,
    },
    { label: t('title.settings'), detail: t('title.settingsDetail'), activate: options.onSettings },
    { label: t('title.credits'), detail: t('title.creditsDetail'), activate: options.onCredits },
  );

  const task = buildMenuScreen({
    parent: options.parent,
    name: 'title',
    title: t('title.gameTitle'),
    ...(hasContinueRun ? { titleFontSize: 20 } : {}),
    subtitle: t('title.subtitle'),
    info: formatTitleInfoLines(
      options.gold,
      options.best,
      formatBest(options.best),
      hasContinueRun,
    ),
    items,
    onAdjust: (index, delta) => {
      if (index === characterItemIndex) cycleCharacter(delta);
    },
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

  return task.then((built) => {
    screen = built;
    return {
      ...built,
      setCharacter(character: CharacterDef, nextAvailable?: readonly CharacterDef[]): void {
        if (nextAvailable !== undefined && nextAvailable.length > 0) {
          available = nextAvailable;
        }
        current = available.find((entry) => entry.id === character.id) ?? character;
        built.updateItem(
          characterItemIndex,
          formatCharacterLabel(current),
          formatCharacterDetail(current, available.length),
        );
      },
    };
  });
}
