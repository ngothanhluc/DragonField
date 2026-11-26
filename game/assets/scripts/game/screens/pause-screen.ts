/**
 * Pause (GDD §9, §15.5, M15): Resume, Restart run, independent Music & SFX sliders, Quit to title.
 *
 * It stops nothing itself — bootstrap switches `status` to `paused` before building this
 * screen, and `update()` only runs while `status === 'playing'`, so enemies, bullets,
 * telegraphs, hitstop and shield/i-frame timers all stand still (the sim clock does not advance).
 */
import {
  applySettings,
  stepMusicVolume,
  stepSfxVolume,
} from '../../core/save/settings';
import { buildMenuScreen, type MenuItem, type MenuScreen } from './menu';
import { formatMusicVolume, formatSfxVolume } from './settings-screen';
import type { TitleScreenOptions } from './title-screen';

export interface PauseScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly musicVolume?: number;
  readonly sfxVolume?: number;
  /** Legacy fallback initial volume when `musicVolume` / `sfxVolume` is omitted. */
  readonly volume?: number;
  readonly onResume: () => void;
  readonly onRestart: () => void;
  readonly onQuit: () => void;
  readonly onMusicVolume?: (volume: number) => void;
  readonly onSfxVolume?: (volume: number) => void;
  /** Backwards-compatible fallback when `onMusicVolume` / `onSfxVolume` is omitted. */
  readonly onVolume?: (volume: number) => void;
}

const SLIDER_DETAIL = 'Left / Right or click (+10%)';

export function buildPauseScreen(options: PauseScreenOptions): Promise<MenuScreen> {
  let audio = applySettings({
    ...(options.volume !== undefined ? { volume: options.volume } : {}),
    ...(options.musicVolume !== undefined ? { musicVolume: options.musicVolume } : {}),
    ...(options.sfxVolume !== undefined ? { sfxVolume: options.sfxVolume } : {}),
  });
  let screen: MenuScreen | null = null;

  const changeMusicVolume = (delta: number): void => {
    audio = stepMusicVolume(audio, delta);
    if (options.onMusicVolume !== undefined) {
      options.onMusicVolume(audio.musicVolume);
    } else {
      options.onVolume?.(audio.musicVolume);
    }
    screen?.updateItem(2, formatMusicVolume(audio.musicVolume), SLIDER_DETAIL);
  };

  const changeSfxVolume = (delta: number): void => {
    audio = stepSfxVolume(audio, delta);
    if (options.onSfxVolume !== undefined) {
      options.onSfxVolume(audio.sfxVolume);
    } else {
      options.onVolume?.(audio.sfxVolume);
    }
    screen?.updateItem(3, formatSfxVolume(audio.sfxVolume), SLIDER_DETAIL);
  };

  const items: MenuItem[] = [
    { label: 'Resume', detail: 'Esc', activate: options.onResume },
    { label: 'Restart run', detail: 'New run, keep gold earned', activate: options.onRestart },
    {
      label: formatMusicVolume(audio.musicVolume),
      detail: SLIDER_DETAIL,
      activate: () => changeMusicVolume(1),
    },
    {
      label: formatSfxVolume(audio.sfxVolume),
      detail: SLIDER_DETAIL,
      activate: () => changeSfxVolume(1),
    },
    { label: 'Quit to title', detail: 'Keep gold earned', activate: options.onQuit },
  ];

  return buildMenuScreen({
    parent: options.parent,
    name: 'pause',
    title: 'PAUSED',
    subtitle: 'Game time is frozen',
    items,
    onBack: options.onResume,
    onAdjust: (index, delta) => {
      if (index === 2) changeMusicVolume(delta);
      else if (index === 3) changeSfxVolume(delta);
    },
    hint: '↑/↓ select · ←/→ adjust audio · Esc resume',
    backdropAlpha: 184,
    panelWidth: 364,
    buttonWidth: 312,
    buttonHeight: 31,
    buttonGap: 5,
    buttonFontSize: 11,
  }).then((built) => {
    screen = built;
    return built;
  });
}
