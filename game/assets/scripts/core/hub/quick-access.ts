/**
 * Village corner quick-access bar + `Esc` village menu (GDD M21 §4).
 *
 * Pure TS — zero `cc` imports.
 *
 * Every shortcut routes through the same `HomeFlowEvent` / `HubInteractAction` the player would
 * produce by walking to the corresponding place, so the bar can never diverge from the world.
 */
import type { TranslationKey } from '../i18n';
import type { HubInteractAction } from './interact';

/** Shortcuts in display order: Play, Characters, Settings. */
export const VILLAGE_QUICK_ITEMS = ['play', 'characters', 'settings'] as const;

export type VillageQuickItemId = (typeof VILLAGE_QUICK_ITEMS)[number];

/** i18n keys for the three shortcuts (vi `Cổng Xuất Chinh` / `Võ Đường` / `Cài Đặt`). */
export const VILLAGE_QUICK_LABEL_KEYS: Readonly<Record<VillageQuickItemId, TranslationKey>> = {
  play: 'village.quick.play',
  characters: 'village.quick.characters',
  settings: 'village.quick.settings',
};

/** The event a shortcut produces: identical to walking to the gate / Dojo, or opening Settings. */
export type VillageQuickRouteEvent =
  | { readonly kind: 'hub-interact'; readonly action: HubInteractAction }
  | { readonly kind: 'open-settings' };

/** Route a quick-access item to the home-flow / hub-interact event it stands for. */
export function villageQuickRoute(item: VillageQuickItemId): VillageQuickRouteEvent {
  switch (item) {
    case 'play':
      return {
        kind: 'hub-interact',
        action: { kind: 'open-expedition', triggerId: 'expedition-gate' },
      };
    case 'characters':
      return {
        kind: 'hub-interact',
        action: { kind: 'open-dojo', npcId: 'dojo-master' },
      };
    case 'settings':
      return { kind: 'open-settings' };
  }
}
