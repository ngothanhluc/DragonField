/**
 * Settings (GDD §9): volume, fullscreen, accessibility (rung, số damage), keybind
 * read-only.
 *
 * Volume đi từng bước 10% và được ghi vào save ngay (`onVolume`), nên mở lại
 * sau khi reload vẫn đúng. Hai cờ ticket #2 áp **ngay** khi bấm (không cần
 * restart run): people nhạy chuyển động tắt rung được giữa run.
 */
import { stepVolume, type Settings } from '../../core/save/settings';
import { buildMenuScreen, type MenuItem, type MenuScreen } from './menu';
import type { TitleScreenOptions } from './title-screen';

export interface SettingsScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly settings: Settings;
  readonly onVolume: (volume: number) => void;
  readonly onToggleFullscreen: () => void;
  readonly onToggleScreenShake: () => void;
  readonly onToggleDamageNumbers: () => void;
  readonly onBack: () => void;
}

export function formatVolume(volume: number): string {
  return `Volume   ${Math.round(volume * 100)}%`;
}

export function formatFullscreen(on: boolean): string {
  return `Fullscreen   ${on ? 'ON' : 'OFF'}`;
}

/** Nhãn công tắc chung cho các cờ accessibility. */
export function formatToggle(label: string, on: boolean): string {
  return `${label}   ${on ? 'ON' : 'OFF'}`;
}

export function buildSettingsScreen(options: SettingsScreenOptions): Promise<MenuScreen> {
  let current = options.settings;
  let screen: MenuScreen | null = null;

  const changeVolume = (delta: number): void => {
    current = { ...current, volume: stepVolume(current.volume, delta) };
    options.onVolume(current.volume);
    screen?.updateItem(0, formatVolume(current.volume), 'Left / Right or click (+10%)');
  };

  const toggleScreenShake = (): void => {
    current = { ...current, screenShake: !current.screenShake };
    options.onToggleScreenShake();
    screen?.updateItem(2, formatToggle('Screen shake', current.screenShake));
  };

  const toggleDamageNumbers = (): void => {
    current = { ...current, damageNumbers: !current.damageNumbers };
    options.onToggleDamageNumbers();
    screen?.updateItem(3, formatToggle('Damage numbers', current.damageNumbers));
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
    {
      label: formatToggle('Screen shake', current.screenShake),
      detail: 'Enter / click to toggle',
      activate: () => toggleScreenShake(),
    },
    {
      label: formatToggle('Damage numbers', current.damageNumbers),
      detail: 'Enter / click to toggle',
      activate: () => toggleDamageNumbers(),
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
