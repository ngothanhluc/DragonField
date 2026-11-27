/**
 * Pure home-screen flow for M21 (#91): the Village Hub replaces the Title as the place between
 * runs (`title → village → chapter-select → run → result → village`), plus the Title menu shape
 * and the interactable registry the hub adapters dispatch into.
 *
 * Pure TS — zero `cc` imports. `screen-flow.ts` (the Cocos adapter) routes every transition
 * through `stepHomeFlow`, so this reducer is the single source of the rules.
 */
import type { HubEntryOrigin } from './hub-state';
import type { HubTriggerId } from './hub-tmx';
import type { HubInteractAction } from './interact';

/** Streamlined Title buttons, in display order. */
export type TitleMenuItemId = 'enter-village' | 'continue-run' | 'settings';

/** Screens reachable from the Title once the Village is home. */
export type HomeScreenId =
  | 'title'
  | 'settings'
  | 'village'
  | 'chapter-select'
  | 'run'
  | 'result';

export type HomeFlowEvent =
  | { readonly kind: 'title-select'; readonly item: TitleMenuItemId }
  | { readonly kind: 'back' }
  | { readonly kind: 'hub-interact'; readonly action: HubInteractAction }
  | { readonly kind: 'start-run'; readonly chapter: number; readonly ascension: number }
  | { readonly kind: 'run-ended'; readonly outcome: 'victory' | 'defeat' }
  | { readonly kind: 'result-to-village' }
  | { readonly kind: 'result-to-chapter-select' };

export interface HomeFlowState {
  readonly screen: HomeScreenId;
  /** How the player last entered the village; `null` before the first entry. */
  readonly hubEntryOrigin: HubEntryOrigin | null;
  /** Outcome of the run that just ended, consumed by `result-to-village`. */
  readonly lastRunOutcome: 'victory' | 'defeat' | null;
}

/**
 * Title buttons for the current save. `Continue Run` only appears when a resumable run save
 * exists (ADR-023); the character / meta-shop / credits entries moved into the village and
 * Settings respectively.
 */
export function titleMenuItems(hasValidRunSave: boolean): readonly TitleMenuItemId[] {
  return hasValidRunSave
    ? ['enter-village', 'continue-run', 'settings']
    : ['enter-village', 'settings'];
}

export function initialHomeFlow(): HomeFlowState {
  return { screen: 'title', hubEntryOrigin: null, lastRunOutcome: null };
}

/** Total reducer: an event that is invalid on the current screen returns the state unchanged. */
export function stepHomeFlow(state: HomeFlowState, event: HomeFlowEvent): HomeFlowState {
  switch (state.screen) {
    case 'title':
      if (event.kind !== 'title-select') return state;
      switch (event.item) {
        case 'enter-village':
          return { ...state, screen: 'village', hubEntryOrigin: 'title' };
        case 'continue-run':
          return { ...state, screen: 'run' };
        case 'settings':
          return { ...state, screen: 'settings' };
      }
      return state;

    case 'settings':
      return event.kind === 'back' ? { ...state, screen: 'title' } : state;

    case 'village':
      if (event.kind !== 'hub-interact') return state;
      return event.action.kind === 'open-expedition'
        ? { ...state, screen: 'chapter-select' }
        : state;

    case 'chapter-select':
      if (event.kind === 'back') return { ...state, screen: 'village' };
      if (event.kind === 'start-run') return { ...state, screen: 'run' };
      return state;

    case 'run':
      if (event.kind !== 'run-ended') return state;
      return { ...state, screen: 'result', lastRunOutcome: event.outcome };

    case 'result':
      if (event.kind === 'result-to-village') {
        return {
          ...state,
          screen: 'village',
          hubEntryOrigin:
            state.lastRunOutcome === 'victory' ? 'run-victory' : 'run-defeat',
        };
      }
      if (event.kind === 'result-to-chapter-select') {
        return { ...state, screen: 'chapter-select' };
      }
      return state;
  }
}

export interface HubInteractRegistry {
  register<K extends HubInteractAction['kind']>(
    kind: K,
    handler: (action: Extract<HubInteractAction, { readonly kind: K }>) => void,
  ): () => void;
  dispatch(action: HubInteractAction): boolean;
  has(kind: HubInteractAction['kind']): boolean;
}

type AnyHubInteractHandler = (action: HubInteractAction) => void;

/**
 * One registry per hub session. Later tickets (villagers, shop interior, dojo) register their
 * action kinds here; registering twice throws so two tickets cannot silently override each other.
 */
export function createHubInteractRegistry(): HubInteractRegistry {
  const handlers = new Map<HubInteractAction['kind'], AnyHubInteractHandler>();

  return {
    register<K extends HubInteractAction['kind']>(
      kind: K,
      handler: (action: Extract<HubInteractAction, { readonly kind: K }>) => void,
    ): () => void {
      if (handlers.has(kind)) {
        throw new Error(`Hub interact handler already registered for '${kind}'`);
      }
      // The map is keyed by `kind`; dispatch only ever passes the matching variant.
      const stored: AnyHubInteractHandler = (action) =>
        handler(action as Extract<HubInteractAction, { readonly kind: K }>);
      handlers.set(kind, stored);
      return () => {
        if (handlers.get(kind) === stored) handlers.delete(kind);
      };
    },
    dispatch(action: HubInteractAction): boolean {
      const handler = handlers.get(action.kind);
      if (handler === undefined) return false;
      handler(action);
      return true;
    },
    has(kind: HubInteractAction['kind']): boolean {
      return handlers.has(kind);
    },
  };
}

/**
 * Automatic step triggers fire once when the player enters a zone: `previous` is the zone from
 * last frame. Re-entering the same zone after standing still returns `null`.
 */
export function stepTriggerEntered(
  previous: HubTriggerId | null,
  current: HubTriggerId | null,
): HubTriggerId | null {
  return current !== null && current !== previous ? current : null;
}
