/**
 * Title screen (GDD §9, §14, §15.4): Play, Character Select, Meta shop, Settings, Credits.
 *
 * Built in code, no `.scene` edits. All `Theme Wood` 9-slice framing, padding, and navigation live
 * in `screens/menu.ts`; this file decides the content and action order.
 *
 * Since #8 (refined in M11 T5 & M14 T3) the title draws a cleanly framed 32×18 window of chapter 1
 * behind a centred `Theme Wood` column with a gentle dim, leaving the living room, 1:1 weather, and
 * the active rigged playable character visible on the flank.
 */
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  type CharacterDef,
  type CharacterId,
} from '../../core/characters/roster';
import type { BestProgress } from '../../core/save/save-data';
import {
  formatTitleCharacterDetail as formatCharacterDetail,
  formatTitleCharacterLabel as formatCharacterLabel,
} from '../../core/view/menu-layout';
import { formatBest } from '../chapter-select';
import { buildMenuScreen, MENU_COLUMN_WIDTH, type MenuScreen } from './menu';

export { formatCharacterDetail, formatCharacterLabel };

export interface TitleScreenOptions {
  readonly parent: Parameters<typeof buildMenuScreen>[0]['parent'];
  readonly gold: number;
  readonly best: BestProgress;
  readonly onPlay: () => void;
  readonly onShop: () => void;
  readonly onSettings: () => void;
  readonly onCredits: () => void;
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
const CHARACTER_ITEM_INDEX = 1;

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

  const cycleCharacter = (delta: number): void => {
    if (available.length <= 1) return;
    const currentIndex = available.findIndex((entry) => entry.id === current.id);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + delta + available.length) % available.length;
    const next = available[nextIndex];
    if (next === undefined || next.id === current.id) return;

    current = next;
    screen?.updateItem(
      CHARACTER_ITEM_INDEX,
      formatCharacterLabel(current),
      formatCharacterDetail(current, available.length),
    );
    options.onSelectCharacter?.(current.id);
  };

  const task = buildMenuScreen({
    parent: options.parent,
    name: 'title',
    title: 'YOKAI FIELD',
    subtitle: 'Dodge. Auto-fire. Clear.',
    info: [`Gold ${options.gold}`, formatBest(options.best)],
    items: [
      { label: 'Play', detail: 'Choose a chapter', activate: options.onPlay },
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
        label: 'Meta shop',
        detail: 'Upgrades & character unlocks',
        activate: options.onShop,
      },
      { label: 'Settings', detail: 'Volume, fullscreen, effects', activate: options.onSettings },
      { label: 'Credits', detail: 'Art, audio, engine', activate: options.onCredits },
    ],
    onAdjust: (index, delta) => {
      if (index === CHARACTER_ITEM_INDEX) cycleCharacter(delta);
    },
    ...(options.initialFocus !== undefined ? { initialFocus: options.initialFocus } : {}),
    hint: '↑/↓ select · ←/→ hero · Enter open',
    buttonWidth: TITLE_BUTTON_WIDTH,
    buttonHeight: 31,
    buttonGap: 5,
    buttonFontSize: 11,
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
          CHARACTER_ITEM_INDEX,
          formatCharacterLabel(current),
          formatCharacterDetail(current, available.length),
        );
      },
    };
  });
}
