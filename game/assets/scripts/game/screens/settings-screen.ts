/**
 * Settings (GDD §9, §13.1, §15.5, M15): independent Music & SFX 10%-step sliders, fullscreen,
 * accessibility (shake, damage numbers), Effects Full/Reduced, and read-only keybinds.
 *
 * Music and SFX step independently by 10% (`stepMusicVolume` / `stepSfxVolume`) and persist
 * immediately via `onMusicVolume` / `onSfxVolume` (falling back to `onVolume` when omitted).
 */
import {
  applySettings,
  stepMusicVolume,
  stepSfxVolume,
  type Settings,
} from '../../core/save/settings';
import { buildMenuScreen, type MenuItem, type MenuScreen } from './menu';
import type { TitleScreenOptions } from './title-screen';

export interface SettingsScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly settings: Settings;
  readonly onMusicVolume?: (volume: number) => void;
  readonly onSfxVolume?: (volume: number) => void;
  /** Backwards-compatible fallback when `onMusicVolume` / `onSfxVolume` is omitted. */
  readonly onVolume?: (volume: number) => void;
  readonly onToggleFullscreen: () => void;
  readonly onToggleScreenShake: () => void;
  readonly onToggleDamageNumbers: () => void;
  readonly onToggleEffects: () => void;
  readonly onBack: () => void;
}

export function formatVolume(volume: number): string {
  return `Volume   ${Math.round(volume * 100)}%`;
}

export function formatMusicVolume(volume: number): string {
  return `Music   ${Math.round(volume * 100)}%`;
}

export function formatSfxVolume(volume: number): string {
  return `SFX   ${Math.round(volume * 100)}%`;
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
  let current = applySettings(options.settings);
  let screen: MenuScreen | null = null;

  const changeMusicVolume = (delta: number): void => {
    current = stepMusicVolume(current, delta);
    if (options.onMusicVolume !== undefined) {
      options.onMusicVolume(current.musicVolume);
    } else {
      options.onVolume?.(current.musicVolume);
    }
    screen?.updateItem(0, formatMusicVolume(current.musicVolume));
  };

  const changeSfxVolume = (delta: number): void => {
    current = stepSfxVolume(current, delta);
    if (options.onSfxVolume !== undefined) {
      options.onSfxVolume(current.sfxVolume);
    } else {
      options.onVolume?.(current.sfxVolume);
    }
    screen?.updateItem(1, formatSfxVolume(current.sfxVolume));
  };

  const toggleScreenShake = (): void => {
    current = { ...current, screenShake: !current.screenShake };
    options.onToggleScreenShake();
    screen?.updateItem(3, formatToggle('Screen shake', current.screenShake));
  };

  const toggleDamageNumbers = (): void => {
    current = { ...current, damageNumbers: !current.damageNumbers };
    options.onToggleDamageNumbers();
    screen?.updateItem(4, formatToggle('Damage numbers', current.damageNumbers));
  };

  const toggleEffects = (): void => {
    current = { ...current, effects: current.effects === 'full' ? 'reduced' : 'full' };
    options.onToggleEffects();
    screen?.updateItem(5, formatEffects(current.effects));
  };

  const items: MenuItem[] = [
    {
      label: formatMusicVolume(current.musicVolume),
      activate: () => changeMusicVolume(1),
    },
    {
      label: formatSfxVolume(current.sfxVolume),
      activate: () => changeSfxVolume(1),
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
    info: ['Controls: WASD move · Space dash · E/R-Click skill · Esc/P pause'],
    items,
    onBack: options.onBack,
    onAdjust: (index, delta) => {
      if (index === 0) changeMusicVolume(delta);
      else if (index === 1) changeSfxVolume(delta);
    },
    hint: '↑/↓ select · ←/→ adjust audio · Esc back',
    panelWidth: 452,
    buttonWidth: 316,
    buttonHeight: 22,
    buttonGap: 3,
    buttonFontSize: 10,
  });

  return task.then((built) => {
    screen = built;
    return built;
  });
}

/** Re-export the Settings type used here so adapters do not import from two places. */
export type SettingsScreenState = Settings;
