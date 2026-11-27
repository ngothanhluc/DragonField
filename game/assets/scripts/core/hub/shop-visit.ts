/**
 * Shop Visit session (M21 #93): standing at the Shop Interior counter, the Shopkeeper's
 * `DialogBox` and the one panel it routes to — the existing Meta Shop screen, opened either on
 * its 6 permanent upgrade tracks (`meta-shop`) or on its `HERO UNLOCKS` column (`hero-unlocks`).
 *
 * Pure TS — zero `cc` imports. The Cocos hub adapter only renders what this module returns and
 * opens/closes the existing screen; the purchase rules and the save stay untouched.
 *
 * Also owns the one mapping between a hub action and the fade it starts, per location, so the
 * adapter cannot enter the shop from inside the shop (or ping-pong at the doorway).
 */
import { SHOP_CHARACTER_START_INDEX } from '../view/menu-layout';
import { t, type Locale, type TranslationKey } from '../i18n';
import {
  advanceDialog,
  openShopkeeperDialog,
  pickShopkeeperGreeting,
  selectDialogChoice,
  stepDialogTypewriter,
  type DialogState,
  type ShopkeeperChoiceId,
  type ShopkeeperContext,
} from './dialog';
import type { HubTransitionTarget } from './hub-state';
import type { HubLocation } from './hub-tmx';
import type { HubInteractAction } from './interact';

/** The two Meta Shop columns the Shopkeeper can route the player to (GDD M21 §3). */
export const SHOP_PANEL_IDS = ['meta-shop', 'hero-unlocks'] as const;
export type ShopPanelId = (typeof SHOP_PANEL_IDS)[number];

/** One visit to the Shop Interior: the open `DialogBox` and/or the panel it opened. */
export interface ShopVisitState {
  /** `null` when the Shopkeeper is not being talked to. */
  readonly dialog: DialogState | null;
  /** `null` while standing in the shop. */
  readonly panel: ShopPanelId | null;
}

/** A fresh visit: nobody talked to yet, no panel open, the player free to move. */
export function createShopVisit(): ShopVisitState {
  return { dialog: null, panel: null };
}

/** True while a dialog or a panel is open — the player is locked and the `[E]` prompt hidden. */
export function isShopVisitBusy(state: ShopVisitState): boolean {
  return state.dialog !== null || state.panel !== null;
}

/** Localized greeting text (the typewriter length and the gold the Shopkeeper quotes). */
function greetingText(context: ShopkeeperContext, locale: Locale): string {
  const { greetingKey, params } = pickShopkeeperGreeting(context);
  return t(greetingKey as TranslationKey, params, locale);
}

/**
 * Talk to the Shopkeeper: opens the contextual greeting with its 3 choices. Ignored while a
 * dialog or a panel is already open, so nothing talks over the Meta Shop screen.
 */
export function talkToShopkeeper(
  state: ShopVisitState,
  context: ShopkeeperContext,
  locale: Locale,
): ShopVisitState {
  if (isShopVisitBusy(state)) return state;
  const totalChars = greetingText(context, locale).length;
  return { ...state, dialog: openShopkeeperDialog(context, totalChars) };
}

/** Route a confirmed choice to its panel (`null` = back to the shop). */
function panelForChoice(choice: ShopkeeperChoiceId): ShopPanelId | null {
  if (choice === 'meta-shop') return 'meta-shop';
  if (choice === 'unlock-heroes') return 'hero-unlocks';
  return null;
}

/** Close the dialog and open the panel the choice routes to in one step. */
function withChoice(state: ShopVisitState, choice: ShopkeeperChoiceId): ShopVisitState {
  return { dialog: null, panel: panelForChoice(choice) };
}

/**
 * `[E]` / `Enter` / `Space` while talking: the first press reveals the whole line, the next
 * confirms the highlighted choice.
 */
export function advanceShopDialog(state: ShopVisitState): ShopVisitState {
  if (state.dialog === null) return state;
  const outcome = advanceDialog(state.dialog);
  if (outcome.kind === 'revealed') return { ...state, dialog: outcome.state };
  if (outcome.kind === 'closed') return withChoice(state, 'leave');
  return withChoice(state, outcome.choice);
}

/** A clicked choice row routes exactly like confirming it with the keys. */
export function selectShopChoice(
  state: ShopVisitState,
  choiceId: ShopkeeperChoiceId,
): ShopVisitState {
  if (state.dialog === null) return state;
  const outcome = selectDialogChoice(state.dialog, choiceId);
  if (outcome.kind === 'choice') return withChoice(state, outcome.choice);
  return withChoice(state, 'leave');
}

/** `Back` from the Meta Shop screen: the panel closes and the player is free in the shop again. */
export function closeShopPanel(state: ShopVisitState): ShopVisitState {
  if (state.panel === null) return state;
  return { ...state, panel: null };
}

/** Advance the open dialog's typewriter by `dtMs`, returning the soft blip pulses it earned. */
export function stepShopVisit(
  state: ShopVisitState,
  dtMs: number,
): { readonly state: ShopVisitState; readonly blipCount: number } {
  if (state.dialog === null) return { state, blipCount: 0 };
  const stepped = stepDialogTypewriter(state.dialog, dtMs);
  return {
    state: { ...state, dialog: stepped.state },
    blipCount: stepped.blipCount,
  };
}

/**
 * Which row the Meta Shop screen opens focused on: the first permanent upgrade track (`0`) or
 * the first `HERO UNLOCKS` row (right after the 6 upgrade tracks).
 */
export function shopPanelInitialFocus(panel: ShopPanelId): number {
  return panel === 'meta-shop' ? 0 : SHOP_CHARACTER_START_INDEX;
}

/**
 * The fade a hub action starts from `location`, or `null` when that door is not the one you are
 * standing in (or the action is not a scene change at all).
 */
export function hubTransitionForAction(
  action: HubInteractAction,
  location: HubLocation,
): HubTransitionTarget | null {
  if (action.kind === 'enter-shop' && location === 'village') {
    return { kind: 'shop-interior' };
  }
  if (action.kind === 'exit-shop' && location === 'shop-interior') {
    return { kind: 'village', from: 'shop-interior' };
  }
  return null;
}
