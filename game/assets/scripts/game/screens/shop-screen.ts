/**
 * Meta shop (GDD §7, §9): 3 track vĩnh viễn, level hiện tại, giá cấp kế và
 * vàng đang có.
 *
 * Nút bị **disable kèm lý do** khi thiếu vàng hoặc track đã max. Luật mua vẫn
 * nằm ở `core/meta/upgrades.ts`; UI chỉ đọc `canBuy`/`costFor` để vẽ, còn
 * bootstrap gọi `buy()` và bắt lỗi — click sai toạ độ không thể mua vượt luật.
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

/** Nhãn + detail cho một track; `disabled` và lý do là thứ người chơi đọc được. */
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
