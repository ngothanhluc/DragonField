/**
 * Pause (GDD §9, §15.5, M15): Resume, Restart run, independent Music & SFX sliders, Quit to title.
 *
 * It stops nothing itself — bootstrap switches `status` to `paused` before building this
 * screen, and `update()` only runs while `status === 'playing'`, so enemies, bullets,
 * telegraphs, hitstop and shield/i-frame timers all stand still (the sim clock does not advance).
 */
import { t } from '../../core/i18n';
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

export function buildPauseScreen(options: PauseScreenOptions): Promise<MenuScreen> {
  let audio = applySettings({
    ...(options.volume !== undefined ? { volume: options.volume } : {}),
    ...(options.musicVolume !== undefined ? { musicVolume: options.musicVolume } : {}),
    ...(options.sfxVolume !== undefined ? { sfxVolume: options.sfxVolume } : {}),
  });
  let screen: MenuScreen | null = null;
  const sliderDetail = t('pause.sliderDetail');

  const changeMusicVolume = (delta: number): void => {
    audio = stepMusicVolume(audio, delta);
    if (options.onMusicVolume !== undefined) {
      options.onMusicVolume(audio.musicVolume);
    } else {
      options.onVolume?.(audio.musicVolume);
    }
    screen?.updateItem(2, formatMusicVolume(audio.musicVolume), sliderDetail);
  };

  const changeSfxVolume = (delta: number): void => {
    audio = stepSfxVolume(audio, delta);
    if (options.onSfxVolume !== undefined) {
      options.onSfxVolume(audio.sfxVolume);
    } else {
      options.onVolume?.(audio.sfxVolume);
    }
    screen?.updateItem(3, formatSfxVolume(audio.sfxVolume), sliderDetail);
  };

  const items: MenuItem[] = [
    { label: t('pause.resume'), detail: t('pause.resumeDetail'), activate: options.onResume },
    { label: t('pause.restart'), detail: t('pause.restartDetail'), activate: options.onRestart },
    {
      label: formatMusicVolume(audio.musicVolume),
      detail: sliderDetail,
      activate: () => changeMusicVolume(1),
    },
    {
      label: formatSfxVolume(audio.sfxVolume),
      detail: sliderDetail,
      activate: () => changeSfxVolume(1),
    },
    { label: t('pause.quit'), detail: t('pause.quitDetail'), activate: options.onQuit },
  ];

  return buildMenuScreen({
    parent: options.parent,
    name: 'pause',
    title: t('pause.title'),
    subtitle: t('pause.subtitle'),
    items,
    onBack: options.onResume,
    onAdjust: (index, delta) => {
      if (index === 2) changeMusicVolume(delta);
      else if (index === 3) changeSfxVolume(delta);
    },
    hint: t('pause.hint'),
    backdropAlpha: 184,
    panelWidth: 372,
    buttonWidth: 316,
    buttonHeight: 31,
    buttonGap: 5,
    buttonFontSize: 11,
  }).then((built) => {
    screen = built;
    return built;
  });
}
