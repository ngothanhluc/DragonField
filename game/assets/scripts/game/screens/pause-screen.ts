/**
 * Pause (GDD §9): Resume, Restart run, Quit to title, volume.
 *
 * It stops nothing itself — bootstrap switches `status` to `paused` before building this
 * screen, and `update()` only runs while `status === 'playing'`, so enemies, bullets,
 * telegraphs, hitstop and shield/i-frame timers all stand still (the sim clock does not advance).
 */
import { stepVolume } from '../../core/save/settings';
import { buildMenuScreen, type MenuItem, type MenuScreen } from './menu';
import type { TitleScreenOptions } from './title-screen';

export interface PauseScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly volume: number;
  readonly onResume: () => void;
  readonly onRestart: () => void;
  readonly onQuit: () => void;
  readonly onVolume: (volume: number) => void;
}

export function buildPauseScreen(options: PauseScreenOptions): Promise<MenuScreen> {
  let volume = options.volume;
  let screen: MenuScreen | null = null;

  const changeVolume = (delta: number): void => {
    volume = stepVolume(volume, delta);
    options.onVolume(volume);
    screen?.updateItem(2, `Volume   ${Math.round(volume * 100)}%`, 'Left / Right or click (+10%)');
  };

  const items: MenuItem[] = [
    { label: 'Resume', detail: 'Esc', activate: options.onResume },
    { label: 'Restart run', detail: 'New run, keep gold earned', activate: options.onRestart },
    {
      label: `Volume   ${Math.round(volume * 100)}%`,
      detail: 'Left / Right or click (+10%)',
      activate: () => changeVolume(1),
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
      if (index === 2) changeVolume(delta);
    },
    hint: '↑/↓ select · ←/→ adjust volume · Esc resume',
    buttonHeight: 38,
    buttonGap: 8,
  }).then((built) => {
    screen = built;
    return built;
  });
}
