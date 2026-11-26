/**
 * Settings (GDD §9): volume, fullscreen, accessibility (shake, damage numbers), Effects
 * Full/Reduced, and read-only keybinds.
 *
 * Volume steps by 10% and is written to the save immediately (`onVolume`), so reopening after
 * a reload shows the right value. Accessibility and effects toggles apply immediately.
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
  readonly onToggleEffects: () => void;
  readonly onBack: () => void;
}

export function formatVolume(volume: number): string {
  return `Volume   ${Math.round(volume * 100)}%`;
}

export function formatFullscreen(on: boolean): string {
  return `Fullscreen   ${on ? 'ON' : 'OFF'}`;
}

/** Shared toggle label for accessibility flags. */
export function formatToggle(label: string, on: boolean): string {
  return `${label}   ${on ? 'ON' : 'OFF'}`;
}

/** Effects mode row: Full keeps trails/auras, Reduced drops them and keeps impacts. */
export function formatEffects(mode: 'full' | 'reduced'): string {
  return `Effects   ${mode === 'full' ? 'FULL' : 'REDUCED'}`;
}

export function buildSettingsScreen(options: SettingsScreenOptions): Promise<MenuScreen> {
  let current = options.settings;
  let screen: MenuScreen | null = null;

  const changeVolume = (delta: number): void => {
    current = { ...current, volume: stepVolume(current.volume, delta) };
    options.onVolume(current.volume);
    screen?.updateItem(0, formatVolume(current.volume));
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

  const toggleEffects = (): void => {
    current = { ...current, effects: current.effects === 'full' ? 'reduced' : 'full' };
    options.onToggleEffects();
    screen?.updateItem(4, formatEffects(current.effects));
  };

  const items: MenuItem[] = [
    {
      label: formatVolume(current.volume),
      activate: () => changeVolume(1),
    },
    {
      label: formatFullscreen(current.fullscreen),
      activate: options.onToggleFullscreen,
    },
    {
      label: formatToggle('Screen shake', current.screenShake),
      activate: () => toggleScreenShake(),
    },
    {
      label: formatToggle('Damage numbers', current.damageNumbers),
      activate: () => toggleDamageNumbers(),
    },
    {
      label: formatEffects(current.effects),
      activate: () => toggleEffects(),
    },
    { label: 'Back', activate: options.onBack },
  ];

  const task = buildMenuScreen({
    parent: options.parent,
    name: 'settings',
    title: 'SETTINGS',
    titleFontSize: 20,
    subtitle: 'Saved to this browser',
    info: ['Keybinds fixed: WASD/arrows move · Esc/P pause · Enter/Space menus'],
    items,
    onBack: options.onBack,
    onAdjust: (index, delta) => {
      if (index === 0) changeVolume(delta);
    },
    hint: '↑/↓ select · ←/→ adjust volume · Esc back',
    panelWidth: 452,
    buttonWidth: 316,
    buttonHeight: 22,
    buttonGap: 4,
    buttonFontSize: 10,
  });

  return task.then((built) => {
    screen = built;
    return built;
  });
}

/** Re-export the Settings type used here so adapters do not import from two places. */
export type SettingsScreenState = Settings;
