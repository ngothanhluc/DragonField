/**
 * Pure RPG `DialogBox` state machine for the Shopkeeper, Dojo Master, and wandering Villagers
 * (GDD M21 §2–§3, ADR-028).
 *
 * Pure TS — zero `cc` imports.
 *
 * Supports:
 * - Contextual Shopkeeper greetings (victory celebration, rich gold pouch, recent chapter unlock,
 *   empty wallet, or standard warm welcome) + 3 RPG choices (`'meta-shop' | 'unlock-heroes' | 'leave'`).
 * - Rotating localized Villager lore & bullet-hell gameplay tips (`vi`/`en` i18n keys) that cycle
 *   cleanly per villager without repeating consecutive lines.
 * - Portrait resource path resolution for all 6 generated `64×64` portraits (`ninja`, `archer`,
 *   `mage`, `cultivator`, `shopkeeper`, `dojo-master`) plus staged pack `Faceset.png` portraits
 *   for villagers and fallback resilience.
 * - Typewriter character reveal + throttled voice blip SFX counts (`dialog-blip`).
 */
import {
  CHARACTER_ROSTER,
  isCharacterId,
  isCharacterUnlocked,
  type CharacterId,
  type CharacterUnlockSource,
} from '../characters/roster';
import type { HubNpcId, HubVillagerId } from './hub-tmx';

/** Shopkeeper dialog choice IDs (GDD M21 §3). */
export const SHOPKEEPER_CHOICE_IDS = ['meta-shop', 'unlock-heroes', 'leave'] as const;
export type ShopkeeperChoiceId = (typeof SHOPKEEPER_CHOICE_IDS)[number];

export type DialogSpeakerId = CharacterId | HubNpcId;

/** Default typewriter speed in characters per second. */
export const DEFAULT_DIALOG_CHARS_PER_SEC = 42;

/** Emit one soft voice blip SFX per this many newly revealed characters. */
export const CHARS_PER_DIALOG_BLIP = 3;

/** Rich pouch threshold for the Shopkeeper's contextual gold remark. */
export const SHOPKEEPER_RICH_GOLD_THRESHOLD = 250;

export interface DialogPortraitSpec {
  readonly speakerId: DialogSpeakerId;
  /** Resource path under `assets/resources/` (no extension) for `loadPixelTexture`. */
  readonly primaryPath: string;
  /** Guaranteed staged fallback resource path under `assets/resources/` (no extension), if any. */
  readonly fallbackPath: string | null;
  /** Target display box size in UI pixels (`64` for hero/shopkeeper/dojo portraits). */
  readonly displaySizePx: number;
}

const GENERATED_PORTRAIT_SPEAKERS: ReadonlySet<string> = new Set([
  'ninja',
  'archer',
  'mage',
  'cultivator',
  'shopkeeper',
  'dojo-master',
]);

/**
 * Resolve the portrait resource path for any playable hero or village NPC speaker.
 */
export function resolveDialogPortrait(speakerId: DialogSpeakerId): DialogPortraitSpec {
  if (speakerId === 'shopkeeper') {
    return {
      speakerId,
      primaryPath: 'art/generated/portraits/portrait-shopkeeper',
      fallbackPath: 'art/npc/shopkeeper/Faceset',
      displaySizePx: 64,
    };
  }
  if (speakerId === 'dojo-master') {
    return {
      speakerId,
      primaryPath: 'art/generated/portraits/portrait-dojo-master',
      fallbackPath: 'art/npc/dojo-master/Faceset',
      displaySizePx: 64,
    };
  }
  if (isCharacterId(speakerId) && GENERATED_PORTRAIT_SPEAKERS.has(speakerId)) {
    return {
      speakerId,
      primaryPath: `art/generated/portraits/portrait-${speakerId}`,
      fallbackPath: null,
      displaySizePx: 64,
    };
  }
  // Wandering villagers (`villager-1` .. `villager-5`): staged pack `Faceset.png` scaled crisp nearest to 64×64.
  return {
    speakerId,
    primaryPath: `art/npc/${speakerId}/Faceset`,
    fallbackPath: `art/npc/${speakerId}/Faceset`,
    displaySizePx: 64,
  };
}

/** Curated localized speaker name keys & rotating lore/tip line keys per villager. */
export const VILLAGER_DIALOG_CATALOG: Readonly<
  Record<
    HubVillagerId,
    {
      readonly nameKey: string;
      readonly lineKeys: readonly [string, string, string];
    }
  >
> = {
  'villager-1': {
    nameKey: 'hub.npc.villager1.name',
    lineKeys: [
      'hub.dialog.villager1.tipPotions',
      'hub.dialog.villager1.loreSquare',
      'hub.dialog.villager1.tipClearSpeed',
    ],
  },
  'villager-2': {
    nameKey: 'hub.npc.villager2.name',
    lineKeys: [
      'hub.dialog.villager2.tipBullets',
      'hub.dialog.villager2.loreNorthGate',
      'hub.dialog.villager2.tipDash',
    ],
  },
  'villager-3': {
    nameKey: 'hub.npc.villager3.name',
    lineKeys: [
      'hub.dialog.villager3.tipShopUpgrades',
      'hub.dialog.villager3.loreSmithy',
      'hub.dialog.villager3.tipSpecialRoom',
    ],
  },
  'villager-4': {
    nameKey: 'hub.npc.villager4.name',
    lineKeys: [
      'hub.dialog.villager4.tipDojoCodex',
      'hub.dialog.villager4.tipEvolutions',
      'hub.dialog.villager4.loreChapters',
    ],
  },
  'villager-5': {
    nameKey: 'hub.npc.villager5.name',
    lineKeys: [
      'hub.dialog.villager5.loreAnimals',
      'hub.dialog.villager5.tipActiveSkill',
      'hub.dialog.villager5.lorePeace',
    ],
  },
};

export type ShopkeeperGreetingKey =
  | 'hub.dialog.shopkeeper.greetVictory'
  | 'hub.dialog.shopkeeper.greetRich'
  | 'hub.dialog.shopkeeper.greetChapter'
  | 'hub.dialog.shopkeeper.greetBroke'
  | 'hub.dialog.shopkeeper.greetDefault';

export interface ShopkeeperContext extends CharacterUnlockSource {
  readonly gold: number;
  readonly chaptersUnlocked?: number;
  readonly lastRunOutcome?: 'victory' | 'defeat' | null;
}

export interface DialogChoice {
  readonly id: ShopkeeperChoiceId;
  readonly labelKey: string;
  /** Number of locked heroes that can currently be unlocked with gold (`unlock-heroes` badge). */
  readonly affordableCount?: number;
  /** Number of heroes still locked (`0` when the full 4-hero roster is already unlocked). */
  readonly remainingLockedCount?: number;
}

export interface DialogState {
  readonly open: boolean;
  readonly kind: 'shopkeeper' | 'villager';
  readonly speakerId: DialogSpeakerId;
  readonly speakerNameKey: string;
  readonly portrait: DialogPortraitSpec;
  readonly bodyKey: string;
  readonly bodyParams: Readonly<Record<string, string | number>>;
  /** Total character length of the resolved localized body text (for typewriter progress). */
  readonly totalChars: number;
  readonly revealedChars: number;
  readonly isFullyRevealed: boolean;
  readonly choices: readonly DialogChoice[];
  readonly selectedChoiceIndex: number;
}

/** Per-villager conversation counter ensuring rotating lore/tips across talks. */
export type VillagerTalkCounts = Readonly<Partial<Record<HubVillagerId, number>>>;

/**
 * Pick the Shopkeeper's contextual greeting key + interpolation parameters from player progress.
 */
export function pickShopkeeperGreeting(context: ShopkeeperContext): {
  readonly greetingKey: ShopkeeperGreetingKey;
  readonly params: Readonly<Record<string, string | number>>;
} {
  const safeGold =
    Number.isFinite(context.gold) && context.gold > 0 ? Math.floor(context.gold) : 0;
  const chapters =
    typeof context.chaptersUnlocked === 'number' && Number.isFinite(context.chaptersUnlocked)
      ? Math.max(1, Math.floor(context.chaptersUnlocked))
      : 1;

  if (context.lastRunOutcome === 'victory') {
    return {
      greetingKey: 'hub.dialog.shopkeeper.greetVictory',
      params: { gold: safeGold, chapter: chapters },
    };
  }
  if (safeGold >= SHOPKEEPER_RICH_GOLD_THRESHOLD) {
    return {
      greetingKey: 'hub.dialog.shopkeeper.greetRich',
      params: { gold: safeGold },
    };
  }
  if (chapters >= 2 && safeGold > 0) {
    return {
      greetingKey: 'hub.dialog.shopkeeper.greetChapter',
      params: { chapter: chapters, gold: safeGold },
    };
  }
  if (safeGold === 0) {
    return {
      greetingKey: 'hub.dialog.shopkeeper.greetBroke',
      params: { gold: 0 },
    };
  }
  return {
    greetingKey: 'hub.dialog.shopkeeper.greetDefault',
    params: { gold: safeGold },
  };
}

/**
 * Build the Shopkeeper's 3 choices (`meta-shop`, `unlock-heroes`, `leave`) with live unlock counts.
 */
export function buildShopkeeperChoices(context: ShopkeeperContext): readonly DialogChoice[] {
  const safeGold =
    Number.isFinite(context.gold) && context.gold > 0 ? Math.floor(context.gold) : 0;
  const lockedHeroes = CHARACTER_ROSTER.filter(
    (hero) => !isCharacterUnlocked(hero.id, context),
  );
  const affordableHeroes = lockedHeroes.filter((hero) => safeGold >= hero.unlockGoldCost);

  return [
    {
      id: 'meta-shop',
      labelKey: 'hub.dialog.shopkeeper.choice.metaShop',
    },
    {
      id: 'unlock-heroes',
      labelKey: 'hub.dialog.shopkeeper.choice.unlockHeroes',
      affordableCount: affordableHeroes.length,
      remainingLockedCount: lockedHeroes.length,
    },
    {
      id: 'leave',
      labelKey: 'hub.dialog.shopkeeper.choice.leave',
    },
  ];
}

function sanitizeTextLength(length: number | undefined): number {
  if (length === undefined || !Number.isFinite(length) || length < 0) return 48;
  return Math.floor(length);
}

/**
 * Open the Shopkeeper RPG `DialogBox` with contextual greeting and 3 choices.
 */
export function openShopkeeperDialog(
  context: ShopkeeperContext,
  resolvedTextLength?: number,
): DialogState {
  const { greetingKey, params } = pickShopkeeperGreeting(context);
  const totalChars = sanitizeTextLength(resolvedTextLength);

  return {
    open: true,
    kind: 'shopkeeper',
    speakerId: 'shopkeeper',
    speakerNameKey: 'hub.npc.shopkeeper.name',
    portrait: resolveDialogPortrait('shopkeeper'),
    bodyKey: greetingKey,
    bodyParams: params,
    totalChars,
    revealedChars: totalChars === 0 ? 0 : 0,
    isFullyRevealed: totalChars === 0,
    choices: buildShopkeeperChoices(context),
    selectedChoiceIndex: 0,
  };
}

export interface OpenVillagerDialogResult {
  readonly dialog: DialogState;
  readonly talkCounts: VillagerTalkCounts;
  readonly lineIndex: number;
}

/**
 * Open a Villager RPG `DialogBox`, rotating cleanly through that villager's lore/tip pool.
 */
export function openVillagerDialog(
  villagerId: HubVillagerId,
  talkCounts: VillagerTalkCounts = {},
  resolvedTextLength?: number,
): OpenVillagerDialogResult {
  const entry = VILLAGER_DIALOG_CATALOG[villagerId];
  const prevCount = talkCounts[villagerId] ?? 0;
  const safeCount = Number.isInteger(prevCount) && prevCount >= 0 ? prevCount : 0;
  const lineIndex = safeCount % entry.lineKeys.length;
  const bodyKey = entry.lineKeys[lineIndex] ?? entry.lineKeys[0];
  const totalChars = sanitizeTextLength(resolvedTextLength);

  return {
    dialog: {
      open: true,
      kind: 'villager',
      speakerId: villagerId,
      speakerNameKey: entry.nameKey,
      portrait: resolveDialogPortrait(villagerId),
      bodyKey,
      bodyParams: {},
      totalChars,
      revealedChars: 0,
      isFullyRevealed: totalChars === 0,
      choices: [],
      selectedChoiceIndex: 0,
    },
    talkCounts: {
      ...talkCounts,
      [villagerId]: safeCount + 1,
    },
    lineIndex,
  };
}

export interface StepDialogResult {
  readonly state: DialogState;
  /** Number of soft `dialog-blip` SFX triggers earned during this step (`0` or `1`). */
  readonly blipCount: number;
}

/**
 * Advance typewriter text reveal by `dtMs` milliseconds, emitting a throttled blip pulse.
 */
export function stepDialogTypewriter(
  state: DialogState,
  dtMs: number,
  charsPerSec: number = DEFAULT_DIALOG_CHARS_PER_SEC,
): StepDialogResult {
  if (!state.open || state.isFullyRevealed) {
    return { state, blipCount: 0 };
  }
  const safeDt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const rate = Number.isFinite(charsPerSec) && charsPerSec > 0 ? charsPerSec : DEFAULT_DIALOG_CHARS_PER_SEC;
  if (safeDt === 0) return { state, blipCount: 0 };

  const added = Math.max(1, Math.floor((safeDt / 1000) * rate));
  const nextChars = Math.min(state.totalChars, state.revealedChars + added);
  const prevBucket = Math.floor(state.revealedChars / CHARS_PER_DIALOG_BLIP);
  const nextBucket = Math.floor(nextChars / CHARS_PER_DIALOG_BLIP);
  const blipCount = nextBucket > prevBucket ? 1 : 0;

  return {
    state: {
      ...state,
      revealedChars: nextChars,
      isFullyRevealed: nextChars >= state.totalChars,
    },
    blipCount,
  };
}

/** Move choice highlight up/down (`delta = -1 | +1`), wrapping cleanly across the choice list. */
export function moveDialogChoice(state: DialogState, delta: number): DialogState {
  if (!state.open || state.choices.length === 0 || !Number.isFinite(delta)) return state;
  const step = Math.trunc(delta);
  if (step === 0) return state;
  const len = state.choices.length;
  const nextIndex = (((state.selectedChoiceIndex + step) % len) + len) % len;
  return { ...state, selectedChoiceIndex: nextIndex };
}

export type DialogAdvanceOutcome =
  | { readonly kind: 'revealed'; readonly state: DialogState }
  | { readonly kind: 'closed'; readonly state: DialogState }
  | { readonly kind: 'choice'; readonly choice: ShopkeeperChoiceId; readonly state: DialogState };

/**
 * Handle pressing `[E]` / `Enter` / `Space` inside an open `DialogBox`:
 * 1. If text is still typing out, reveals the full line immediately (standard RPG feel).
 * 2. Once revealed:
 *    - Villager dialog closes cleanly (`kind: 'closed'`).
 *    - Shopkeeper dialog activates the highlighted choice (`'meta-shop' | 'unlock-heroes' | 'leave'`);
 *      `'leave'` closes the dialog, while `'meta-shop'` / `'unlock-heroes'` also close or hand off to the panel.
 */
export function advanceDialog(state: DialogState): DialogAdvanceOutcome {
  if (!state.open) {
    return { kind: 'closed', state };
  }
  if (!state.isFullyRevealed) {
    return {
      kind: 'revealed',
      state: {
        ...state,
        revealedChars: state.totalChars,
        isFullyRevealed: true,
      },
    };
  }
  if (state.choices.length === 0) {
    return { kind: 'closed', state: closeDialog(state) };
  }
  const picked = state.choices[state.selectedChoiceIndex] ?? state.choices[0]!;
  return selectDialogChoice(state, picked.id);
}

/**
 * Directly pick a Shopkeeper choice by ID (e.g. clicking a choice button with the mouse).
 */
export function selectDialogChoice(
  state: DialogState,
  choiceId: ShopkeeperChoiceId,
): DialogAdvanceOutcome {
  const index = state.choices.findIndex((c) => c.id === choiceId);
  if (!state.open || index < 0) {
    return { kind: 'closed', state: closeDialog(state) };
  }
  const closed = closeDialog({ ...state, selectedChoiceIndex: index });
  return {
    kind: 'choice',
    choice: choiceId,
    state: closed,
  };
}

/** Close an open dialog box cleanly. */
export function closeDialog(state: DialogState): DialogState {
  if (!state.open) return state;
  return {
    ...state,
    open: false,
    revealedChars: state.totalChars,
    isFullyRevealed: true,
  };
}
