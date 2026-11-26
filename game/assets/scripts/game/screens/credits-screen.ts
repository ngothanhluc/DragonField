/**
 * Credits (GDD §9). Content comes from `art-source/ninja-adventure/README.md`:
 * the Pixel-boy and AAA pack, CC0 1.0 (attribution is not required, but crediting
 * the source still honours the pack).
 */
import { t } from '../../core/i18n';
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
    title: t('credits.title'),
    subtitle: t('credits.subtitle'),
    info: [
      t('credits.line1'),
      t('credits.line2'),
      t('credits.line3'),
      t('credits.line4'),
      t('credits.line5'),
    ],
    items: [
      { label: 'lukeinc.tech', activate: openPortfolio },
      { label: t('common.back'), activate: options.onBack },
    ],
    onBack: options.onBack,
    panelWidth: 444,
    buttonWidth: 280,
    buttonHeight: 30,
    buttonGap: 6,
    buttonFontSize: 11,
  });
}

/** Project page on the portfolio — covers the 2023 Unity build and this one. Opens a new tab without leaving the game. */
export const PORTFOLIO_URL = 'https://lukeinc.tech/projects/dragon-field';

function openPortfolio(): void {
  window.open(PORTFOLIO_URL, '_blank', 'noopener');
}
