/**
 * Settings (GDD §9, §13.1, §15.5, M15, M16/ADR-024): independent Music & SFX 10%-step sliders,
 * fullscreen, accessibility (shake, damage numbers), Effects Full/Reduced, Language (`vi` / `en`),
 * and read-only keybinds.
 *
 * Music and SFX step independently by 10% (`stepMusicVolume` / `stepSfxVolume`) and persist
 * immediately via `onMusicVolume` / `onSfxVolume` (falling back to `onVolume` when omitted).
 * Language toggles live between `'vi'` (`Tiếng Việt`) and `'en'` (`English`) via `onToggleLocale`.
 */
import {
  getLocale,
  localeDisplayName,
  nextLocale,
  t,
  type Locale,
} from '../../core/i18n';
import {
  applySettings,
  stepMusicVolume,
  stepSfxVolume,
  type Settings,
} from '../../core/save/settings';
import { buildMenuScreen, type MenuItem, type MenuScreen } from './menu';
import type { TitleScreenOptions } from './title-screen';

/** Row index of the Language toggle button inside Settings (`0..7`). */
export const SETTINGS_LANGUAGE_ROW_INDEX = 6;

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
  /** Toggle UI language (`'vi'` ↔ `'en'`) and refresh open screens live (M16, ADR-024). */
  readonly onToggleLocale?: (next: Locale) => void;
  readonly onBack: () => void;
  readonly initialFocus?: number;
}

export function formatVolume(volume: number, locale: Locale = getLocale()): string {
  return t('settings.volume', { percent: Math.round(volume * 100) }, locale);
}

export function formatMusicVolume(volume: number, locale: Locale = getLocale()): string {
  return t('settings.music', { percent: Math.round(volume * 100) }, locale);
}

export function formatSfxVolume(volume: number, locale: Locale = getLocale()): string {
  return t('settings.sfx', { percent: Math.round(volume * 100) }, locale);
}

export function formatFullscreen(on: boolean, locale: Locale = getLocale()): string {
  return t(
    'settings.fullscreen',
    { state: t(on ? 'common.on' : 'common.off', undefined, locale) },
    locale,
  );
}

/** Shared toggle label for accessibility flags. */
export function formatToggle(label: string, on: boolean, locale: Locale = getLocale()): string {
  return t(
    'settings.toggleRow',
    { label, state: t(on ? 'common.on' : 'common.off', undefined, locale) },
    locale,
  );
}

/** Effects mode row: Full keeps trails/auras, Reduced drops them and keeps impacts. */
export function formatEffects(mode: 'full' | 'reduced', locale: Locale = getLocale()): string {
  return t(mode === 'full' ? 'settings.effectsFull' : 'settings.effectsReduced', undefined, locale);
}

/** Language row (`Ngôn ngữ   Tiếng Việt` / `Language   English`). */
export function formatLanguage(locale: Locale = getLocale()): string {
  return t('settings.language', { value: localeDisplayName(locale) }, locale);
}

export function buildSettingsScreen(options: SettingsScreenOptions): Promise<MenuScreen> {
  let current = applySettings(options.settings);
  let screen: MenuScreen | null = null;
  const activeLocale = current.locale;

  const changeMusicVolume = (delta: number): void => {
    current = stepMusicVolume(current, delta);
    if (options.onMusicVolume !== undefined) {
      options.onMusicVolume(current.musicVolume);
    } else {
      options.onVolume?.(current.musicVolume);
    }
    screen?.updateItem(0, formatMusicVolume(current.musicVolume, activeLocale));
  };

  const changeSfxVolume = (delta: number): void => {
    current = stepSfxVolume(current, delta);
    if (options.onSfxVolume !== undefined) {
      options.onSfxVolume(current.sfxVolume);
    } else {
      options.onVolume?.(current.sfxVolume);
    }
    screen?.updateItem(1, formatSfxVolume(current.sfxVolume, activeLocale));
  };

  const toggleScreenShake = (): void => {
    current = { ...current, screenShake: !current.screenShake };
    options.onToggleScreenShake();
    screen?.updateItem(
      3,
      formatToggle(t('settings.screenShake', undefined, activeLocale), current.screenShake, activeLocale),
    );
  };

  const toggleDamageNumbers = (): void => {
    current = { ...current, damageNumbers: !current.damageNumbers };
    options.onToggleDamageNumbers();
    screen?.updateItem(
      4,
      formatToggle(
        t('settings.damageNumbers', undefined, activeLocale),
        current.damageNumbers,
        activeLocale,
      ),
    );
  };

  const toggleEffects = (): void => {
    current = { ...current, effects: current.effects === 'full' ? 'reduced' : 'full' };
    options.onToggleEffects();
    screen?.updateItem(5, formatEffects(current.effects, activeLocale));
  };

  const toggleLanguage = (): void => {
    const next = nextLocale(current.locale);
    current = { ...current, locale: next };
    screen?.updateItem(SETTINGS_LANGUAGE_ROW_INDEX, formatLanguage(next));
    options.onToggleLocale?.(next);
  };

  const items: MenuItem[] = [
    {
      label: formatMusicVolume(current.musicVolume, activeLocale),
      activate: () => changeMusicVolume(1),
    },
    {
      label: formatSfxVolume(current.sfxVolume, activeLocale),
      activate: () => changeSfxVolume(1),
    },
    {
      label: formatFullscreen(current.fullscreen, activeLocale),
      activate: options.onToggleFullscreen,
    },
    {
      label: formatToggle(
        t('settings.screenShake', undefined, activeLocale),
        current.screenShake,
        activeLocale,
      ),
      activate: () => toggleScreenShake(),
    },
    {
      label: formatToggle(
        t('settings.damageNumbers', undefined, activeLocale),
        current.damageNumbers,
        activeLocale,
      ),
      activate: () => toggleDamageNumbers(),
    },
    {
      label: formatEffects(current.effects, activeLocale),
      activate: () => toggleEffects(),
    },
    {
      label: formatLanguage(activeLocale),
      activate: () => toggleLanguage(),
    },
    { label: t('common.back', undefined, activeLocale), activate: options.onBack },
  ];

  const task = buildMenuScreen({
    parent: options.parent,
    name: 'settings',
    title: t('settings.title', undefined, activeLocale),
    titleFontSize: 18,
    subtitle: t('settings.subtitle', undefined, activeLocale),
    info: [t('settings.controls', undefined, activeLocale)],
    items,
    onBack: options.onBack,
    onAdjust: (index, delta) => {
      if (index === 0) changeMusicVolume(delta);
      else if (index === 1) changeSfxVolume(delta);
      else if (index === SETTINGS_LANGUAGE_ROW_INDEX && delta !== 0) toggleLanguage();
    },
    ...(options.initialFocus !== undefined ? { initialFocus: options.initialFocus } : {}),
    hint: t('settings.hint', undefined, activeLocale),
    panelWidth: 468,
    buttonWidth: 320,
    buttonHeight: 20,
    buttonGap: 2,
    buttonFontSize: 10,
  });

  return task.then((built) => {
    screen = built;
    return built;
  });
}

/** Re-export the Settings type used here so adapters do not import from two places. */
export type SettingsScreenState = Settings;
