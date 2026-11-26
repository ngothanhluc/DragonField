/**
 * Meta shop (GDD §7, §9, §15.4, M14-T3):
 * - Left column (`STAT UPGRADES`): 3 permanent upgrade tracks (`Hearts`, `Damage`, `Fire rate`).
 * - Right column (`HERO UNLOCKS`): 3 early character unlocks (`Archer 120g`, `Mage 220g`,
 *   `Cultivator 350g`), wired to `canBuyCharacter` / `buyCharacter`.
 * - Bottom row: optional `Character Select` shortcut + `Back` button.
 *
 * Every button is **disabled with a clear reason** when gold is short, a stat track is maxed, or
 * a hero is already unlocked. Purchase rules live in `core/meta/upgrades.ts` and
 * `core/save/save-data.ts`; `ScreenFlow` performs and persists mutations safely.
 */
import { Button as CocosButton, Layers, Node as CocosNode } from 'cc';
import type { CharacterId } from '../../core/characters/roster';
import {
  UPGRADE_TRACKS,
  applyUpgrades,
  type UpgradeTrack,
} from '../../core/meta/upgrades';
import type { SaveData } from '../../core/save/save-data';
import {
  SHOP_UNLOCK_CHARACTER_IDS,
  characterShopRow,
  computeShopScreenLayout,
  nextShopScreenFocus,
  upgradeRow,
  type MenuGridDirection,
  type ShopRowText,
} from '../../core/view/menu-layout';
import { playSfx } from '../audio/sfx';
import { createLabel } from '../hud';
import {
  MENU_MUTED_COLOR,
  MENU_TEXT_COLOR,
  MENU_TITLE_COLOR,
  createMenuButton,
  createMenuPanel,
  createScreenBackdrop,
  loadMenuFrames,
  visibleUiSize,
  type MenuButtonHandle,
  type MenuFrames,
  type MenuScreen,
} from './menu';
import type { TitleScreenOptions } from './title-screen';

export { SHOP_UNLOCK_CHARACTER_IDS, characterShopRow, upgradeRow, type ShopRowText };

export interface ShopScreenOptions {
  readonly parent: TitleScreenOptions['parent'];
  readonly save: SaveData;
  readonly onBuy: (track: UpgradeTrack) => void;
  readonly onBuyCharacter?: (characterId: CharacterId) => void;
  readonly onOpenCharacterSelect?: () => void;
  readonly onBack: () => void;
  readonly initialFocus?: number;
}

export async function buildShopScreen(options: ShopScreenOptions): Promise<MenuScreen> {
  const { save } = options;
  const hasCharacterSelect = options.onOpenCharacterSelect !== undefined;
  const maxIndex = hasCharacterSelect ? 7 : 6;

  let destroyed = false;
  let focused = Math.min(maxIndex, Math.max(0, options.initialFocus ?? 0));
  const handles: MenuButtonHandle[] = [];

  const setFocus = (next: number, playSound = true): void => {
    if (handles.length === 0) return;
    const clamped = Math.min(handles.length - 1, Math.max(0, next));
    if (playSound && clamped !== focused) playSfx('ui-move');
    handles[focused]?.setHovered?.(false);
    focused = clamped;
    handles.forEach((handle, idx) => handle.setFocused(idx === focused));
  };

  const activateFocused = (): void => {
    const handle = handles[focused];
    if (handle === undefined || handle.item.disabled === true) return;
    playSfx('ui-confirm');
    handle.item.activate();
  };

  // Attach capture-phase key listener BEFORE `await loadMenuFrames()` (`AGENTS.md` trap).
  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || destroyed) return;
    const key = event.key;
    const code = event.keyCode;

    if (key === 'Escape' || code === 27) {
      event.preventDefault();
      options.onBack();
      return;
    }

    let dir: MenuGridDirection | null = null;
    if (key === 'ArrowLeft' || code === 37) dir = 'left';
    else if (key === 'ArrowRight' || code === 39) dir = 'right';
    else if (key === 'ArrowUp' || code === 38) dir = 'up';
    else if (key === 'ArrowDown' || code === 40) dir = 'down';

    if (dir !== null) {
      event.preventDefault();
      setFocus(nextShopScreenFocus(focused, dir, hasCharacterSelect));
      return;
    }

    if (key === 'Enter' || key === ' ' || code === 13 || code === 32) {
      event.preventDefault();
      activateFocused();
    }
  };

  const removeListeners = (): void => {
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);

  let frames: MenuFrames;
  try {
    frames = await loadMenuFrames();
  } catch (error: unknown) {
    removeListeners();
    throw error;
  }

  if (destroyed) {
    removeListeners();
    const cancelled = new CocosNode('shop-cancelled');
    return {
      node: cancelled,
      focus: () => {},
      updateItem: () => {},
      destroy(): void {
        if (cancelled.isValid) cancelled.destroy();
      },
    };
  }

  const size = visibleUiSize();
  const layout = computeShopScreenLayout({
    visibleWidth: size.width,
    visibleHeight: size.height,
    hasCharacterSelect,
  });

  const root = new CocosNode('shop');
  root.layer = Layers.Enum.UI_2D;
  root.parent = options.parent;

  createScreenBackdrop(root, 220);

  const panel = createMenuPanel(
    root,
    'shop-panel',
    frames,
    layout.panelWidth,
    layout.panelHeight,
    {
      dividerY: layout.dividerY - layout.panelY,
      dividerWidth: layout.dividerWidth,
    },
  );
  panel.setPosition(layout.panelX, layout.panelY, 0);

  const title = createLabel(root, 'shop-title', 'META SHOP');
  title.fontSize = layout.titleFontSize;
  title.lineHeight = layout.titleFontSize + 4;
  title.color = MENU_TITLE_COLOR;
  title.node.setPosition(0, layout.titleY, 0);

  const subtitle = createLabel(
    root,
    'shop-subtitle',
    `Gold: ${save.gold}g · Permanent upgrades & early hero unlocks`,
  );
  subtitle.fontSize = layout.subtitleFontSize;
  subtitle.lineHeight = layout.subtitleFontSize + 2;
  subtitle.color = MENU_TEXT_COLOR;
  subtitle.node.setPosition(0, layout.subtitleY, 0);

  const bonuses = applyUpgrades(save);
  const infoText =
    `Bonus: +${bonuses.maxHeartsBonus} hearts · +${Math.round((bonuses.damageMultiplier - 1) * 100)}% damage · ` +
    `+${Math.round((bonuses.fireRateMultiplier - 1) * 100)}% fire rate`;
  const info = createLabel(root, 'shop-info-0', infoText);
  info.fontSize = layout.infoFontSize;
  info.lineHeight = layout.infoFontSize + 2;
  info.color = MENU_MUTED_COLOR;
  info.node.setPosition(0, layout.infoY, 0);

  const leftHeader = createLabel(root, 'shop-col-upgrades', 'STAT UPGRADES');
  leftHeader.fontSize = layout.sectionHeaderFontSize;
  leftHeader.lineHeight = layout.sectionHeaderFontSize + 2;
  leftHeader.color = MENU_TITLE_COLOR;
  leftHeader.node.setPosition(layout.leftHeaderX, layout.sectionHeaderY, 0);

  const rightHeader = createLabel(root, 'shop-col-heroes', 'HERO UNLOCKS');
  rightHeader.fontSize = layout.sectionHeaderFontSize;
  rightHeader.lineHeight = layout.sectionHeaderFontSize + 2;
  rightHeader.color = MENU_TITLE_COLOR;
  rightHeader.node.setPosition(layout.rightHeaderX, layout.sectionHeaderY, 0);

  // Indices 0..2: Stat upgrade tracks.
  UPGRADE_TRACKS.forEach((track, idx) => {
    const row = upgradeRow(save, track);
    const box = layout.upgradeSlots[idx]!;
    const handle = createMenuButton(
      root,
      `shop-upgrade-${track}`,
      {
        label: row.label,
        detail: row.detail,
        disabled: row.disabled,
        activate: () => options.onBuy(track),
      },
      frames,
      { width: box.width, height: box.height, fontSize: box.fontSize },
    );
    handle.node.setPosition(box.x, box.y, 0);
    handles.push(handle);
  });

  // Indices 3..5: Early character unlocks (`archer`, `mage`, `cultivator`).
  SHOP_UNLOCK_CHARACTER_IDS.forEach((characterId, idx) => {
    const row = characterShopRow(save, characterId);
    const box = layout.characterSlots[idx]!;
    const handle = createMenuButton(
      root,
      `shop-character-${characterId}`,
      {
        label: row.label,
        detail: row.detail,
        disabled: row.disabled || options.onBuyCharacter === undefined,
        activate: () => options.onBuyCharacter?.(characterId),
      },
      frames,
      { width: box.width, height: box.height, fontSize: box.fontSize },
    );
    handle.node.setPosition(box.x, box.y, 0);
    handles.push(handle);
  });

  // Index 6 (optional): Character Select shortcut.
  if (layout.characterSelectButton !== null && options.onOpenCharacterSelect !== undefined) {
    const box = layout.characterSelectButton;
    const openSelect = options.onOpenCharacterSelect;
    const charSelectHandle = createMenuButton(
      root,
      'shop-open-character-select',
      {
        label: 'Character select',
        activate: openSelect,
      },
      frames,
      { width: box.width, height: box.height, fontSize: box.fontSize },
    );
    charSelectHandle.node.setPosition(box.x, box.y, 0);
    handles.push(charSelectHandle);
  }

  // Last index: Back button.
  const backBox = layout.backButton;
  const backHandle = createMenuButton(
    root,
    'shop-back',
    { label: 'Back', activate: options.onBack },
    frames,
    { width: backBox.width, height: backBox.height, fontSize: backBox.fontSize },
  );
  backHandle.node.setPosition(backBox.x, backBox.y, 0);
  handles.push(backHandle);

  handles.forEach((handle, index) => {
    handle.node.on(CocosNode.EventType.MOUSE_ENTER, () => {
      setFocus(index);
      handle.setHovered?.(true);
    });
    handle.node.on(CocosNode.EventType.MOUSE_LEAVE, () => {
      handle.setHovered?.(false);
      handle.setPressed?.(false);
    });
    handle.node.on(CocosNode.EventType.MOUSE_DOWN, () => {
      setFocus(index, false);
      handle.setPressed?.(true);
    });
    handle.node.on(CocosNode.EventType.MOUSE_UP, () => {
      handle.setPressed?.(false);
    });
    handle.node.on(CocosButton.EventType.CLICK, () => {
      handle.setPressed?.(false);
      setFocus(index, false);
      activateFocused();
    });
  });

  setFocus(focused, false);

  const hint = createLabel(
    root,
    'shop-hint',
    'Arrows navigate · Enter buy/open · Esc back',
  );
  hint.fontSize = layout.hintFontSize;
  hint.lineHeight = layout.hintFontSize + 2;
  hint.color = MENU_MUTED_COLOR;
  hint.node.setPosition(0, layout.hintY, 0);

  return {
    node: root,
    focus: (index: number) => setFocus(index, false),
    updateItem: (index: number, labelText: string, detailText?: string) => {
      handles[index]?.setText(labelText, detailText);
    },
    destroy(): void {
      destroyed = true;
      removeListeners();
      if (root.isValid) root.destroy();
    },
  };
}
