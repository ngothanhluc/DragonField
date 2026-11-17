/**
 * Settings (GDD §9): volume, fullscreen, keybind read-only.
 *
 * Volume đi từng bước 10% và được ghi vào save ngay (`onVolume`), nên mở lại
 * sau khi reload vẫn đúng. Audio thật chưa có (M6) — giá trị này là hookup sẵn.
 */
import { stepVolume, type Settings } from '../../core/save/settings';
import { buildMenuScreen, type MenuItem, type MenuScreen } from './menu';
import type { TitleScreenOptions } from './title-screen';

export interface SettingsScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly settings: Settings;
  readonly onVolume: (volume: number) => void;
  readonly onToggleFullscreen: () => void;
  readonly onBack: () => void;
}

export function formatVolume(volume: number): string {
  return `Volume   ${Math.round(volume * 100)}%`;
}

export function formatFullscreen(on: boolean): string {
  return `Fullscreen   ${on ? 'ON' : 'OFF'}`;
}

export function buildSettingsScreen(options: SettingsScreenOptions): Promise<MenuScreen> {
  let current = options.settings;
  let screen: MenuScreen | null = null;

  const changeVolume = (delta: number): void => {
    current = { ...current, volume: stepVolume(current.volume, delta) };
    options.onVolume(current.volume);
    screen?.updateItem(0, formatVolume(current.volume), 'Left / Right or click (+10%)');
  };

  const items: MenuItem[] = [
    {
      label: formatVolume(current.volume),
      detail: 'Left / Right or click (+10%)',
      activate: () => changeVolume(1),
    },
    {
      label: formatFullscreen(current.fullscreen),
      detail: 'Enter / click to toggle',
      activate: options.onToggleFullscreen,
    },
    { label: 'Back', activate: options.onBack },
  ];

  const task = buildMenuScreen({
    parent: options.parent,
    name: 'settings',
    title: 'SETTINGS',
    subtitle: 'Saved to this browser',
    info: [
      'Keybinds (fixed in v1)',
      'WASD / arrows — move',
      'Esc / P — pause',
      'Mouse + Enter / Space — menus',
    ],
    items,
    onBack: options.onBack,
    onAdjust: (index, delta) => {
      if (index === 0) changeVolume(delta);
    },
    hint: '↑/↓ select · ←/→ adjust volume · Esc back',
    buttonHeight: 34,
  });

  return task.then((built) => {
    screen = built;
    return built;
  });
}

/** Giữ type Settings được dùng từ file này để adapter khỏi import hai nơi. */
export type SettingsScreenState = Settings;
