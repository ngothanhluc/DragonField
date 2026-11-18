/**
 * Meta shop (GDD §7, §9): 3 permanent tracks, current level, next-level price and
 * gold on hand.
 *
 * A button is **disabled with a reason** when gold is short or the track is maxed. Purchase
 * rules still live in `core/meta/upgrades.ts`; the UI only reads `canBuy`/`costFor` to draw,
 * while bootstrap calls `buy()` and catches errors — a mis-aimed click cannot break the rules.
 */
import {
  UPGRADE_TRACKS,
  applyUpgrades,
  canBuy,
  costFor,
  maxLevelFor,
  type UpgradeTrack,
} from '../../core/meta/upgrades';
import type { SaveData } from '../../core/save/save-data';
import { buildMenuScreen, type MenuItem, type MenuScreen } from './menu';
import type { TitleScreenOptions } from './title-screen';

export interface ShopScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly save: SaveData;
  readonly onBuy: (track: UpgradeTrack) => void;
  readonly onBack: () => void;
  readonly initialFocus?: number;
}

const TRACK_NAMES: Readonly<Record<UpgradeTrack, string>> = {
  hearts: 'Hearts',
  damage: 'Damage',
  fireRate: 'Fire rate',
};

/** Label + detail for one track; `disabled` and the reason are what the player reads. */
export function upgradeRow(
  save: SaveData,
  track: UpgradeTrack,
): { readonly label: string; readonly detail: string; readonly disabled: boolean } {
  const level = save.upgrades[track];
  const max = maxLevelFor(track);
  const name = TRACK_NAMES[track];
  const label = `${name}   Lv ${level}/${max}`;

  if (level >= max) {
    return { label, detail: 'Maxed out', disabled: true };
  }

  const price = costFor(track, level + 1);
  const affordable = canBuy(save, track, save.gold);
  const short = Math.max(0, price - save.gold);
  return {
    label,
    detail: affordable
      ? `Next level: ${price} gold`
      : `Next level: ${price} gold — need ${short} more`,
    disabled: !affordable,
  };
}

export function buildShopScreen(options: ShopScreenOptions): Promise<MenuScreen> {
  const { save } = options;
  const bonuses = applyUpgrades(save);
  const items: MenuItem[] = UPGRADE_TRACKS.map((track) => {
    const row = upgradeRow(save, track);
    return {
      label: row.label,
      detail: row.detail,
      disabled: row.disabled,
      activate: () => options.onBuy(track),
    };
  });

  items.push({ label: 'Back', activate: options.onBack });

  return buildMenuScreen({
    parent: options.parent,
    name: 'shop',
    title: 'META SHOP',
    subtitle: `Gold ${save.gold}`,
    info: [
      `Bonus: +${bonuses.maxHeartsBonus} hearts · +${Math.round((bonuses.damageMultiplier - 1) * 100)}% damage · ` +
        `+${Math.round((bonuses.fireRateMultiplier - 1) * 100)}% fire rate`,
    ],
    items,
    onBack: options.onBack,
    buttonHeight: 40,
    buttonGap: 6,
    ...(options.initialFocus !== undefined ? { initialFocus: options.initialFocus } : {}),
    hint: '↑/↓ select · Enter buy · Esc back',
  });
}
