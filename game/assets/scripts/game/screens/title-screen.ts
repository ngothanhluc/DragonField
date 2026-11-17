/**
 * Màn title (GDD §9): Play, Shop, Settings, Credits.
 *
 * Dựng bằng code, không sửa `.scene`. Toàn bộ layout/điều hướng nằm ở
 * `screens/menu.ts`; file này chỉ quyết định nội dung và thứ tự hành động.
 */
import { formatBest } from '../chapter-select';
import type { BestProgress } from '../../core/save/save-data';
import { buildMenuScreen, type MenuScreen } from './menu';

export interface TitleScreenOptions {
  readonly parent: Parameters<typeof buildMenuScreen>[0]['parent'];
  readonly gold: number;
  readonly best: BestProgress;
  readonly onPlay: () => void;
  readonly onShop: () => void;
  readonly onSettings: () => void;
  readonly onCredits: () => void;
}

export function buildTitleScreen(options: TitleScreenOptions): Promise<MenuScreen> {
  return buildMenuScreen({
    parent: options.parent,
    name: 'title',
    title: 'YOKAI FIELD',
    subtitle: 'Dodge. Auto-fire. Clear the chapter.',
    info: [`Gold ${options.gold}   ·   ${formatBest(options.best)}`],
    items: [
      { label: 'Play', detail: 'Choose a chapter', activate: options.onPlay },
      { label: 'Meta shop', detail: 'Spend gold on permanent upgrades', activate: options.onShop },
      { label: 'Settings', detail: 'Volume, fullscreen, keybinds', activate: options.onSettings },
      { label: 'Credits', detail: 'Art, audio, engine', activate: options.onCredits },
    ],
    buttonHeight: 38,
    buttonFontSize: 13,
  });
}
