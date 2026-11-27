/**
 * Village Life session (M21 #92): the living population of the Village Hub — the 5 wandering
 * villagers with their patrol/yield AI, the 4 yard animals, and the open RPG `DialogBox`.
 *
 * Pure TS — zero `cc` imports. The Cocos adapter (`game/hub-life-view.ts`,
 * `game/dialog-box.ts`) only renders what this module returns.
 *
 * Everything is deterministic: villagers step from their `.tmx` patrol routes, animals from a
 * single `SeededRng`, so a headless test sees exactly what a browser sees.
 */
import type { AnimalTuning } from '../atmosphere/atmosphere';
import {
  createAnimal,
  stepAnimal,
  type AnimalState,
} from '../atmosphere/living-decor';
import { HUB_TUNING } from '../enemies/tuning';
import { t, type Locale, type TranslationKey } from '../i18n';
import type { Vec2 } from '../math/vec2';
import { SeededRng } from '../rng';
import {
  VILLAGER_DIALOG_CATALOG,
  advanceDialog,
  openVillagerDialog,
  stepDialogTypewriter,
  type DialogChoice,
  type DialogPortraitSpec,
  type DialogState,
  type VillagerTalkCounts,
} from './dialog';
import type { HubAnimalSprite, HubMapData, HubVillagerId } from './hub-tmx';
import { createVillagePatrolRoster, stepAllVillagers, type NpcPatrolState } from './npc-patrol';

/** One yard animal: where the map placed it (`home`) and its live wander/flee state. */
export interface VillageAnimal {
  readonly id: string;
  readonly sprite: HubAnimalSprite;
  /** The `.tmx` placement, tile units — the centre of its yard leash. */
  readonly home: Vec2;
  readonly state: AnimalState;
}

/** The whole Village Life session: population, open dialog and talk rotation counters. */
export interface VillageLifeState {
  readonly villagers: readonly NpcPatrolState[];
  readonly animals: readonly VillageAnimal[];
  /** `null` when no DialogBox is open. */
  readonly dialog: DialogState | null;
  /** Rotating talk counters (in memory for the session; see the brief). */
  readonly talkCounts: VillagerTalkCounts;
  /** Animal speeds/flee radius from `assets/resources/data/atmosphere.json`. */
  readonly animalTuning: AnimalTuning;
  /** Shared animal RNG (deterministic per seed). */
  readonly rng: SeededRng;
}

/** Village Life movement numbers (from `config/tuning.json` → `hub`). */
export interface VillageLifeTuning {
  /** Animals never stray farther than this from their `.tmx` spot, tiles. */
  readonly animalYardLeashTiles: number;
  /** Animals never come closer than this to the village spawn (the plaza stays people-only), tiles. */
  readonly animalPlazaKeepOutTiles: number;
}

export const DEFAULT_VILLAGE_LIFE_TUNING: VillageLifeTuning = {
  animalYardLeashTiles: HUB_TUNING.animalYardLeashTiles,
  animalPlazaKeepOutTiles: HUB_TUNING.animalPlazaKeepOutTiles,
};

export interface CreateVillageLifeOptions {
  /** Deterministic animal wander seed. */
  readonly seed: number;
  /** Animal speeds/radius from `assets/resources/data/atmosphere.json` (`animal`). */
  readonly animalTuning: AnimalTuning;
  readonly tuning?: Partial<VillageLifeTuning>;
}

export interface StepVillageLifeOptions {
  readonly dtMs: number;
  /** Player position in tile units, or `null` when nobody is around (menus). */
  readonly playerPos: Vec2 | null;
}

export interface StepVillageLifeResult {
  readonly state: VillageLifeState;
  /** `dialog-blip` SFX pulses earned this step (`0` or `1`). */
  readonly blipCount: number;
}

/** Build the session from the parsed village map (villagers in `HUB_VILLAGER_IDS` order). */
export function createVillageLife(
  map: HubMapData,
  options: CreateVillageLifeOptions,
): VillageLifeState {
  const animals: VillageAnimal[] = map.animals.map((placed) => ({
    id: placed.id,
    sprite: placed.sprite,
    home: { x: placed.at.x, y: placed.at.y },
    state: createAnimal({ x: placed.at.x, y: placed.at.y }),
  }));

  return {
    villagers: createVillagePatrolRoster(map),
    animals,
    dialog: null,
    talkCounts: {},
    animalTuning: options.animalTuning,
    rng: new SeededRng(options.seed),
  };
}

/** Resolve the localized text of one villager line (used for the typewriter length). */
function villagerLineText(lineKey: string, locale: Locale): string {
  return t(lineKey as TranslationKey, undefined, locale);
}

/**
 * One session frame: patrol/yield AI, animals (leashed to their yard and out of the plaza), and
 * the open DialogBox's typewriter. The talking villager is held still and faces the player.
 */
export function stepVillageLife(
  state: VillageLifeState,
  map: HubMapData,
  options: StepVillageLifeOptions,
): StepVillageLifeResult {
  const dtMs = Number.isFinite(options.dtMs) && options.dtMs > 0 ? options.dtMs : 0;
  const playerPos = options.playerPos;
  // `DialogSpeakerId` also allows playable heroes; only a villager dialog yields its walker.
  const talkingNpcId: HubVillagerId | null =
    state.dialog !== null && state.dialog.kind === 'villager'
      ? (state.dialog.speakerId as HubVillagerId)
      : null;

  const villagers = stepAllVillagers(state.villagers, {
    dtMs,
    playerPos,
    talkingNpcId,
    collisionLevel: map.collisionLevel,
  });

  const leashRadius = DEFAULT_VILLAGE_LIFE_TUNING.animalYardLeashTiles;
  const keepOutRadius = DEFAULT_VILLAGE_LIFE_TUNING.animalPlazaKeepOutTiles;
  const animals = state.animals.map((animal) => ({
    ...animal,
    state: stepAnimal(animal.state, {
      player: playerPos,
      dtMs,
      level: map.collisionLevel,
      tuning: state.animalTuning,
      rng: state.rng,
      leash: { center: animal.home, radiusTiles: leashRadius },
      keepOut: { center: map.playerStart, radiusTiles: keepOutRadius },
    }),
  }));

  let dialog = state.dialog;
  let blipCount = 0;
  if (dialog !== null) {
    const stepped = stepDialogTypewriter(dialog, dtMs);
    dialog = stepped.state;
    blipCount = stepped.blipCount;
  }

  return {
    state: {
      ...state,
      villagers,
      animals,
      dialog,
    },
    blipCount,
  };
}

/** Open the DialogBox for one villager, rotating through that villager's 3 lines. */
export function talkToVillager(
  state: VillageLifeState,
  villagerId: HubVillagerId,
  locale: Locale,
): VillageLifeState {
  if (state.dialog !== null) return state;
  const entry = VILLAGER_DIALOG_CATALOG[villagerId];
  const count = state.talkCounts[villagerId] ?? 0;
  const lineKey = entry.lineKeys[count % entry.lineKeys.length] ?? entry.lineKeys[0];
  const totalChars = villagerLineText(lineKey, locale).length;
  const opened = openVillagerDialog(villagerId, state.talkCounts, totalChars);
  return {
    ...state,
    dialog: opened.dialog,
    talkCounts: opened.talkCounts,
  };
}

/** `[E]` inside the box: first press reveals the whole line, the next closes it. */
export function advanceVillageDialog(state: VillageLifeState): VillageLifeState {
  if (state.dialog === null) return state;
  const outcome = advanceDialog(state.dialog);
  return {
    ...state,
    dialog: outcome.kind === 'closed' || outcome.kind === 'choice' ? null : outcome.state,
  };
}

/** True while a DialogBox is open (the player is locked and `[E]` advances instead of talking). */
export function isVillageDialogOpen(state: VillageLifeState): boolean {
  return state.dialog !== null;
}

/** Live villager positions for `buildHubInteractables(map, live)` so `[E]` follows walkers. */
export function villageLiveNpcs(
  state: VillageLifeState,
): Array<{ id: HubVillagerId; position: Vec2 }> {
  return state.villagers.map((villager) => ({
    id: villager.id,
    position: { x: villager.position.x, y: villager.position.y },
  }));
}

/** One localized choice row of the DialogBox view model. */
export interface DialogChoiceView {
  readonly label: string;
  readonly selected: boolean;
}

/** Everything the Cocos DialogBox needs, pre-resolved (no locale work in the adapter). */
export interface DialogBoxView {
  readonly speakerName: string;
  readonly portrait: DialogPortraitSpec;
  readonly fullText: string;
  /** Typewriter prefix of `fullText` (clamped when the locale changed mid-line). */
  readonly text: string;
  /** `[]` until fully revealed, then every choice with exactly one `selected`. */
  readonly choices: readonly DialogChoiceView[];
  readonly showContinueHint: boolean;
}

function localizeChoice(choice: DialogChoice, locale: Locale, selected: boolean): DialogChoiceView {
  return {
    label: t(choice.labelKey as TranslationKey, undefined, locale),
    selected,
  };
}

/**
 * Turn the pure `DialogState` into the DialogBox view model for `locale`:
 * speaker name, 64×64 portrait, full/typed text, revealed-only choices, continue hint.
 */
export function dialogBoxView(dialog: DialogState, locale: Locale): DialogBoxView {
  const fullText = t(dialog.bodyKey as TranslationKey, dialog.bodyParams, locale);
  const revealed = Math.max(0, Math.min(fullText.length, Math.floor(dialog.revealedChars)));
  const isFullyRevealed = dialog.isFullyRevealed || revealed >= fullText.length;

  return {
    speakerName: t(dialog.speakerNameKey as TranslationKey, undefined, locale),
    portrait: dialog.portrait,
    fullText,
    text: fullText.slice(0, revealed),
    choices: isFullyRevealed
      ? dialog.choices.map((choice, index) =>
          localizeChoice(choice, locale, index === dialog.selectedChoiceIndex),
        )
      : [],
    showContinueHint: isFullyRevealed && dialog.choices.length === 0,
  };
}
