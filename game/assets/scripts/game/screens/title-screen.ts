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
import {
  CHARACTERS,
  DEFAULT_CHARACTER_ID,
  type CharacterDef,
  type CharacterId,
} from '../../core/characters/roster';
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
  /** Currently selected character; defaults to Ninja when omitted. */
  readonly selectedCharacter?: CharacterDef;
  /** Characters unlocked under the current settings; defaults to `[selectedCharacter]`. */
  readonly availableCharacters?: readonly CharacterDef[];
  /** Called immediately when the player cycles the character row on the Title screen. */
  readonly onSelectCharacter?: (characterId: CharacterId) => void;
  /** Optional initial focused button index. */
  readonly initialFocus?: number;
}

export interface TitleScreen extends MenuScreen {
  /** Update the Character row synchronously (used when debug/save changes selection on Title). */
  setCharacter(character: CharacterDef, available?: readonly CharacterDef[]): void;
}

/** A light dim over the living room; the panel itself stays opaque (alpha 255). */
const TITLE_BACKDROP_ALPHA = 96;
const TITLE_BUTTON_WIDTH = MENU_COLUMN_WIDTH - 24;
const CHARACTER_ITEM_INDEX = 1;

export function formatCharacterLabel(character: CharacterDef): string {
  return `Character: ${character.name}`;
}

export function formatCharacterDetail(character: CharacterDef, availableCount: number): string {
  if (availableCount <= 1) return 'Default ninja (Settings to unlock)';
  return `${character.subtitle} (←/→)`;
}

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
    // Two short lines instead of one long one: the column is only 240 design px wide.
    info: [`Gold ${options.gold}`, formatBest(options.best)],
    items: [
      { label: 'Play', detail: 'Choose a chapter', activate: options.onPlay },
      {
        label: formatCharacterLabel(current),
        detail: formatCharacterDetail(current, available.length),
        disabled: available.length <= 1,
        activate: () => cycleCharacter(1),
      },
      { label: 'Meta shop', detail: 'Spend gold on upgrades', activate: options.onShop },
      { label: 'Settings', detail: 'Volume, fullscreen, keys', activate: options.onSettings },
      { label: 'Credits', detail: 'Art, audio, engine', activate: options.onCredits },
    ],
    onAdjust: (index, delta) => {
      if (index === CHARACTER_ITEM_INDEX) cycleCharacter(delta);
    },
    ...(options.initialFocus !== undefined ? { initialFocus: options.initialFocus } : {}),
    hint: '↑/↓ select · ←/→ switch · Enter confirm',
    // 5 rows inside 288px design height: 28×5 + 5×4 = 160px, leaving clear margin above hint.
    buttonWidth: TITLE_BUTTON_WIDTH,
    buttonHeight: 28,
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
