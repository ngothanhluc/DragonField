/**
 * Credits (GDD §9). Content comes from `art-source/ninja-adventure/README.md`:
 * the Pixel-boy and AAA pack, CC0 1.0 (attribution is not required, but crediting
 * the source still honours the pack).
 */
import { buildMenuScreen, type MenuScreen } from './menu';
import type { TitleScreenOptions } from './title-screen';

export interface CreditsScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly onBack: () => void;
}

export function buildCreditsScreen(options: CreditsScreenOptions): Promise<MenuScreen> {
  return buildMenuScreen({
    parent: options.parent,
    name: 'credits',
    title: 'CREDITS',
    subtitle: 'Yokai Field',
    info: [
      'Ninja Adventure Asset Pack',
      'Assets created by Pixel-boy and AAA',
      'CC0 1.0 Universal — attribution not required',
      'pixel-boy.itch.io  ·  instagram.com/challenger.aaa',
      'Engine: Cocos Creator 3.8.8',
      'Remake of Dragon Field (2023 HCMUS coursework)',
    ],
    items: [
      { label: 'lukeinc.tech', activate: openPortfolio },
      { label: 'Back', activate: options.onBack },
    ],
    onBack: options.onBack,
    buttonHeight: 34,
  });
}

/** Project page on the portfolio — covers the 2023 Unity build and this one. Opens a new tab without leaving the game. */
export const PORTFOLIO_URL = 'https://lukeinc.tech/projects/dragon-field';

function openPortfolio(): void {
  window.open(PORTFOLIO_URL, '_blank', 'noopener');
}
