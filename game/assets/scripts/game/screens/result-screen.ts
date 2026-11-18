/**
 * Run result (GDD §9): rooms reached, gold picked up, time, and Shop / Chapter select /
 * Title buttons — shared by death and chapter win.
 *
 * Bootstrap measures `RunResultData` before tearing the run down, so this screen never reads
 * live state and cannot show `0/0` after combat is destroyed.
 */
import { buildMenuScreen, type MenuScreen } from './menu';
import type { TitleScreenOptions } from './title-screen';

export interface RunResultData {
  readonly chapter: number;
  readonly roomReached: number;
  readonly roomsTotal: number;
  readonly goldEarned: number;
  readonly goldTotal: number;
  readonly durationMs: number;
  readonly kills: number;
  readonly won: boolean;
  /** The chapter just unlocked, `undefined` if none was. */
  readonly unlockedChapter?: number;
}

export interface ResultScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly result: RunResultData;
  readonly onShop: () => void;
  readonly onChapterSelect: () => void;
  readonly onTitle: () => void;
}

/** mm:ss, seconds rounded down. */
export function formatDuration(durationMs: number): string {
  const total = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs / 1000)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function buildResultScreen(options: ResultScreenOptions): Promise<MenuScreen> {
  const { result } = options;
  const info = [
    `Chapter ${result.chapter} · Room ${result.roomReached}/${result.roomsTotal}`,
    `Gold earned  +${result.goldEarned}   (total ${result.goldTotal})`,
    `Time  ${formatDuration(result.durationMs)}   ·   Kills  ${result.kills}`,
  ];
  if (result.unlockedChapter !== undefined) {
    info.push(`Chapter ${result.unlockedChapter} unlocked!`);
  }

  return buildMenuScreen({
    parent: options.parent,
    name: 'result',
    title: result.won ? 'CHAPTER CLEAR' : 'RUN OVER',
    subtitle: result.won ? 'The chapter is cleared.' : 'Gold is kept — spend it in the shop.',
    info,
    items: [
      { label: 'Meta shop', detail: 'Spend the gold you earned', activate: options.onShop },
      { label: 'Chapter select', detail: 'Try another chapter', activate: options.onChapterSelect },
      { label: 'Title', detail: 'Back to the main menu', activate: options.onTitle },
    ],
    onBack: options.onChapterSelect,
    buttonHeight: 38,
    hint: '↑/↓ select · Enter confirm · Esc chapter select',
  });
}
