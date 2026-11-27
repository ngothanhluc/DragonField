/**
 * #94 acceptance — Dojo live character swap, quick-access bar routing and village music state.
 *
 * Seams (pure, zero `cc`):
 * - `core/hub/dojo.ts`         `dojoSwapCharacter`: one call updates the live hub character
 *                              (sprite + weapon attachment loadout) AND the save, so they cannot drift.
 * - `core/hub/quick-access.ts` `VILLAGE_QUICK_ITEMS` / `villageQuickRoute`: the corner bar and the
 *                              `Esc` village menu route through the same `HomeFlowEvent`s as walking.
 * - `core/hub/home-flow.ts`    `open-settings` from the village; Settings `Back` returns to the village.
 * - `core/hub/hub-audio.ts`    `hubMusicCue`: village track + ducking per hub scene / open dialog.
 *
 * The Cocos wiring (Codex overlay, player node rebuild, AudioManager) is proven in the browser.
 * New modules load dynamically so a missing module fails on an assertion, not on import.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  CHARACTERS,
  resolveSelectedCharacter,
} from "../../../assets/scripts/core/characters/roster";
import {
  createHubInteractRegistry,
  createHubState,
  initialHomeFlow,
  startHubTransition,
  stepHomeFlow,
  stepHubTransition,
  updateHubPlayerPose,
  type HomeFlowState,
  type HubInteractAction,
  type HubState,
} from "../../../assets/scripts/core/hub";
import { EN, VI } from "../../../assets/scripts/core/i18n";
import {
  createDefaultSave,
  parseSaveData,
  type SaveData,
} from "../../../assets/scripts/core/save/save-data";
import {
  MemorySaveStorage,
  SaveRepository,
} from "../../../assets/scripts/core/save/storage";

// --- Expected API of the new modules -------------------------------------------------------

interface DojoSwapResult {
  readonly ok: boolean;
  readonly changed: boolean;
  readonly hub: HubState;
  readonly save: SaveData;
}

interface DojoModule {
  dojoSwapCharacter(hub: HubState, save: SaveData, nextId: string): DojoSwapResult;
}

type VillageQuickItemId = "play" | "characters" | "settings";

/** Loose event shape: the real `HomeFlowEvent` gains `{ kind: 'open-settings' }` in this ticket. */
type QuickRouteEvent =
  | { readonly kind: "hub-interact"; readonly action: HubInteractAction }
  | { readonly kind: "open-settings" };

interface QuickAccessModule {
  readonly VILLAGE_QUICK_ITEMS: readonly VillageQuickItemId[];
  readonly VILLAGE_QUICK_LABEL_KEYS: Readonly<Record<VillageQuickItemId, string>>;
  villageQuickRoute(item: VillageQuickItemId): QuickRouteEvent;
}

interface HubMusicCue {
  readonly track: string;
  readonly ducked: boolean;
}

interface HubAudioModule {
  hubMusicCue(state: HubState, options: { readonly dialogOpen: boolean }): HubMusicCue;
}

let dojo: DojoModule | null = null;
let quick: QuickAccessModule | null = null;
let audio: HubAudioModule | null = null;

beforeAll(async () => {
  try {
    dojo = (await import("../../../assets/scripts/core/hub/dojo")) as unknown as DojoModule;
  } catch {
    dojo = null;
  }
  try {
    quick = (await import(
      "../../../assets/scripts/core/hub/quick-access"
    )) as unknown as QuickAccessModule;
  } catch {
    quick = null;
  }
  try {
    audio = (await import(
      "../../../assets/scripts/core/hub/hub-audio"
    )) as unknown as HubAudioModule;
  } catch {
    audio = null;
  }
});

function need<T>(mod: T | null, what: string): T {
  expect(mod, what).not.toBeNull();
  if (mod === null) throw new Error("unreachable");
  return mod;
}

const dojoLib = (): DojoModule =>
  need(dojo, "core/hub/dojo.ts must exist and export dojoSwapCharacter");
const quickLib = (): QuickAccessModule =>
  need(quick, "core/hub/quick-access.ts must exist and export the quick-access bar API");
const audioLib = (): HubAudioModule =>
  need(audio, "core/hub/hub-audio.ts must exist and export hubMusicCue");

// --- Fixtures --------------------------------------------------------------------------------

/** Standing next to the Dojo Master (`village-hub.tmx` npc at 464,172.8 px = 29, 10.8 tiles). */
const AT_DOJO = { x: 29, y: 12.3 };

/** Ninja selected, Archer bought early, Mage/Cultivator still locked (chapter 1 only). */
function saveWithArcher(): SaveData {
  return parseSaveData({
    ...createDefaultSave(),
    gold: 120,
    unlockedCharacters: ["ninja", "archer"],
  });
}

function hubAtDojo(save: SaveData): HubState {
  return updateHubPlayerPose(createHubState({ save }), AT_DOJO, "right");
}

function launchRun(hub: HubState): HubState {
  const fading = startHubTransition(hub, { kind: "run", chapter: 1, ascensionLevel: 0 });
  return stepHubTransition(fading, 1000).state;
}

const GATE: HubInteractAction = { kind: "open-expedition", triggerId: "expedition-gate" };
const DOJO: HubInteractAction = { kind: "open-dojo", npcId: "dojo-master" };

function villageHome(): HomeFlowState {
  return stepHomeFlow(initialHomeFlow(), { kind: "title-select", item: "enter-village" });
}

/** `stepHomeFlow` typed loosely so the new `open-settings` event can be fed before it exists. */
function step(state: HomeFlowState, event: QuickRouteEvent | { readonly kind: "back" }): HomeFlowState {
  return stepHomeFlow(state, event as Parameters<typeof stepHomeFlow>[1]);
}

// --- 1. Dojo live character swap + persistence ---------------------------------------------

describe("#94 Dojo live character swap", () => {
  it("swaps the live hub character and weapon attachment in place, without leaving the village", () => {
    const save = saveWithArcher();
    const hub = hubAtDojo(save);
    expect(hub.characterId).toBe("ninja");

    const result = dojoLib().dojoSwapCharacter(hub, save, "archer");

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.hub.characterId).toBe("archer");
    expect(result.hub.character.defaultLoadout.weaponForm).toBe("attachment");
    expect(result.hub.character.defaultLoadout.attachmentItemId).toBe("bow-hand");
    // Live: same spot, same facing, still walking in the village (no fade, no reload).
    expect(result.hub.location).toBe("village");
    expect(result.hub.playerPos).toEqual(AT_DOJO);
    expect(result.hub.playerFacing).toBe("right");
    expect(result.hub.transition.phase).toBe("idle");
  });

  it("writes the choice into the save, and it survives a save round-trip", () => {
    const save = saveWithArcher();
    const result = dojoLib().dojoSwapCharacter(hubAtDojo(save), save, "archer");
    expect(result.save.selectedCharacter).toBe("archer");
    // The input save is not mutated.
    expect(save.selectedCharacter).toBe("ninja");

    const storage = new MemorySaveStorage();
    new SaveRepository(storage).save(result.save);
    const reloaded = new SaveRepository(storage).load();

    expect(reloaded.selectedCharacter).toBe("archer");
    expect(reloaded.gold).toBe(120);
    expect(reloaded.unlockedCharacters).toEqual(["ninja", "archer"]);
    expect(resolveSelectedCharacter(reloaded).id).toBe("archer");
    // Re-entering the village after a reload spawns the new character.
    expect(createHubState({ save: reloaded }).characterId).toBe("archer");
  });

  it("makes the next run use the new character", () => {
    const save = saveWithArcher();
    const result = dojoLib().dojoSwapCharacter(hubAtDojo(save), save, "archer");

    const launched = launchRun(result.hub);
    expect(launched.pendingRunLaunch).toEqual({
      chapter: 1,
      ascensionLevel: 0,
      characterId: "archer",
    });
    // Runs started from Chapter Select read the save's selection (`ScreenFlow.selectedCharacter`).
    expect(resolveSelectedCharacter(result.save)).toBe(CHARACTERS.archer);
  });

  it("refuses a locked character: live character and save both stay unchanged", () => {
    const save = saveWithArcher();
    const hub = hubAtDojo(save);

    const result = dojoLib().dojoSwapCharacter(hub, save, "mage");

    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.hub.characterId).toBe("ninja");
    expect(result.save.selectedCharacter).toBe("ninja");
    expect(launchRun(result.hub).pendingRunLaunch?.characterId).toBe("ninja");
  });

  it("refuses an unknown id and treats re-picking the current character as a no-op", () => {
    const save = saveWithArcher();
    const hub = hubAtDojo(save);

    const unknown = dojoLib().dojoSwapCharacter(hub, save, "samurai");
    expect(unknown.ok).toBe(false);
    expect(unknown.save.selectedCharacter).toBe("ninja");

    const same = dojoLib().dojoSwapCharacter(hub, save, "ninja");
    expect(same.ok).toBe(true);
    expect(same.changed).toBe(false);
    expect(same.hub.characterId).toBe("ninja");
    expect(same.save.selectedCharacter).toBe("ninja");
  });

  it("can swap back and forth; the last pick wins in the save", () => {
    const save = saveWithArcher();
    const first = dojoLib().dojoSwapCharacter(hubAtDojo(save), save, "archer");
    const back = dojoLib().dojoSwapCharacter(first.hub, first.save, "ninja");
    expect(back.changed).toBe(true);
    expect(back.hub.characterId).toBe("ninja");
    expect(back.hub.character.defaultLoadout.attachmentItemId).toBeNull();
    expect(back.save.selectedCharacter).toBe("ninja");
  });
});

// --- 2. Quick-access bar routing -------------------------------------------------------------

describe("#94 quick-access bar (corner bar + Esc village menu)", () => {
  it("offers Play, Characters, Settings in that order", () => {
    expect(quickLib().VILLAGE_QUICK_ITEMS).toEqual(["play", "characters", "settings"]);
  });

  it("labels each shortcut in vi and en", () => {
    const keys = quickLib().VILLAGE_QUICK_LABEL_KEYS;
    const vi = VI as Readonly<Record<string, string>>;
    const en = EN as Readonly<Record<string, string>>;
    expect(vi[keys.play]).toBe("Cổng Xuất Chinh");
    expect(vi[keys.characters]).toBe("Võ Đường");
    expect(vi[keys.settings]).toBe("Cài Đặt");
    expect(en[keys.play]).toBe("Play");
    expect(en[keys.characters]).toBe("Characters");
    expect(en[keys.settings]).toBe("Settings");
  });

  it("Play routes exactly like the North Gate: Chapter Select, whose Back returns to the village", () => {
    const route = quickLib().villageQuickRoute("play");
    expect(route).toEqual({ kind: "hub-interact", action: GATE });

    const atChapters = step(villageHome(), route);
    expect(atChapters.screen).toBe("chapter-select");
    expect(step(atChapters, { kind: "back" }).screen).toBe("village");
  });

  it("Characters routes exactly like talking to the Dojo Master (Codex opens over the village)", () => {
    const route = quickLib().villageQuickRoute("characters");
    expect(route).toEqual({ kind: "hub-interact", action: DOJO });

    // The Codex is an overlay inside the hub: the home screen stays on the village…
    expect(step(villageHome(), route).screen).toBe("village");

    // …and the action reaches the same Dojo handler the NPC uses.
    const seen: HubInteractAction[] = [];
    const registry = createHubInteractRegistry();
    registry.register("open-dojo", (action) => seen.push(action));
    if (route.kind !== "hub-interact") throw new Error("expected a hub-interact route");
    expect(registry.dispatch(route.action)).toBe(true);
    expect(seen).toEqual([DOJO]);
  });

  it("Settings opens from the village and Back returns to the village, not the Title", () => {
    const route = quickLib().villageQuickRoute("settings");
    expect(route).toEqual({ kind: "open-settings" });

    const atSettings = step(villageHome(), route);
    expect(atSettings.screen).toBe("settings");
    expect(step(atSettings, { kind: "back" }).screen).toBe("village");
  });

  it("keeps Title → Settings → Back on the Title", () => {
    const fromTitle = stepHomeFlow(initialHomeFlow(), { kind: "title-select", item: "settings" });
    expect(fromTitle.screen).toBe("settings");
    expect(step(fromTitle, { kind: "back" }).screen).toBe("title");
  });
});

// --- 3. Music state per hub scene -----------------------------------------------------------

describe("#94 village music per hub scene", () => {
  const VILLAGE_TRACK = "audio/music/village";

  function inShopInterior(): HubState {
    const fading = startHubTransition(createHubState(), { kind: "shop-interior" });
    const inside = stepHubTransition(fading, 1000).state;
    expect(inside.location).toBe("shop-interior");
    return inside;
  }

  it("plays village.mp3 at full level while walking the village", () => {
    expect(audioLib().hubMusicCue(createHubState(), { dialogOpen: false })).toEqual({
      track: VILLAGE_TRACK,
      ducked: false,
    });
  });

  it("ducks the village track while a dialog is open, and restores it after", () => {
    const village = createHubState();
    expect(audioLib().hubMusicCue(village, { dialogOpen: true })).toEqual({
      track: VILLAGE_TRACK,
      ducked: true,
    });
    expect(audioLib().hubMusicCue(village, { dialogOpen: false }).ducked).toBe(false);
  });

  it("keeps the same track but ducks it inside the Shop interior (with or without dialog)", () => {
    const shop = inShopInterior();
    expect(audioLib().hubMusicCue(shop, { dialogOpen: false })).toEqual({
      track: VILLAGE_TRACK,
      ducked: true,
    });
    expect(audioLib().hubMusicCue(shop, { dialogOpen: true })).toEqual({
      track: VILLAGE_TRACK,
      ducked: true,
    });
  });

  it("un-ducks when walking back out of the Shop into the village", () => {
    const shop = inShopInterior();
    const fading = startHubTransition(shop, { kind: "village", from: "shop-interior" });
    const outside = stepHubTransition(fading, 1000).state;
    expect(outside.location).toBe("village");
    expect(audioLib().hubMusicCue(outside, { dialogOpen: false })).toEqual({
      track: VILLAGE_TRACK,
      ducked: false,
    });
  });
});
