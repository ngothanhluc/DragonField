/**
 * Unit tests for `core/hub/hub-state.ts` (locations, spawn/return coords, fade transitions,
 * auto-fire disabled invariant, and live Dojo character switching).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HUB_FADE_MS,
  VILLAGE_MUSIC_PATH,
  canControlPlayerInHub,
  createHubState,
  findStepTrigger,
  isHubTransitioning,
  parseHubTmx,
  spawnsFromHubMaps,
  startHubTransition,
  stepHubTransition,
  switchHubCharacter,
  updateHubPlayerPose,
} from '../../../assets/scripts/core/hub';

const HERE = dirname(fileURLToPath(import.meta.url));
const VILLAGE_DIR = join(HERE, '../../../assets/resources/data/levels/village');
const villageMap = parseHubTmx(readFileSync(join(VILLAGE_DIR, 'village-hub.tmx'), 'utf8'));
const shopMap = parseHubTmx(readFileSync(join(VILLAGE_DIR, 'shop-interior.tmx'), 'utf8'));
const spawns = spawnsFromHubMaps(villageMap, shopMap);

describe('HubState & fade transition state machine', () => {
  it('spawns in Village Square with auto-fire strictly disabled, follow camera, and village music', () => {
    const state = createHubState({
      save: { selectedCharacter: 'archer', chaptersUnlocked: 2 },
      spawns,
    });

    expect(state.location).toBe('village');
    expect(state.characterId).toBe('archer');
    expect(state.character.defaultLoadout.attachmentItemId).toBe('bow-hand');
    expect(state.autoFireEnabled).toBe(false);
    expect(state.dashEnabled).toBe(true);
    expect(state.cameraMode).toBe('follow');
    expect(state.musicTrack).toBe(VILLAGE_MUSIC_PATH);
    expect(state.musicDucked).toBe(false);
    expect(state.playerPos).toEqual(villageMap.playerStart);
    expect(canControlPlayerInHub(state)).toBe(true);
  });

  it('transitions smoothly Village → Shop Interior → Village with distinct doorway return coords', () => {
    let state = createHubState({ spawns });
    state = updateHubPlayerPose(state, { x: 7, y: 11.5 }, 'up');

    // Enter West Shop (`200 ms` fade-out + `200 ms` fade-in).
    state = startHubTransition(state, { kind: 'shop-interior' });
    expect(isHubTransitioning(state)).toBe(true);
    expect(canControlPlayerInHub(state)).toBe(false);

    // Duplicate start calls while fading are ignored.
    const duplicate = startHubTransition(state, { kind: 'run', chapter: 1 });
    expect(duplicate).toBe(state);

    // Halfway through fade-out (`100 ms`): still in village at alpha `0.5`.
    const midOut = stepHubTransition(state, DEFAULT_HUB_FADE_MS / 2, spawns);
    expect(midOut.switchedLocation).toBe(false);
    expect(midOut.state.location).toBe('village');
    expect(midOut.state.transition.fadeAlpha).toBeCloseTo(0.5, 5);

    // Reach full black (`+100 ms`): switches to `shop-interior`, static camera, ducked music, auto-fire false!
    const atBlack = stepHubTransition(midOut.state, DEFAULT_HUB_FADE_MS / 2, spawns);
    expect(atBlack.switchedLocation).toBe(true);
    expect(atBlack.destinationReached).toEqual({ kind: 'shop-interior' });
    expect(atBlack.state.location).toBe('shop-interior');
    expect(atBlack.state.autoFireEnabled).toBe(false);
    expect(atBlack.state.dashEnabled).toBe(false);
    expect(atBlack.state.cameraMode).toBe('static');
    expect(atBlack.state.musicDucked).toBe(true);
    expect(atBlack.state.playerPos).toEqual(shopMap.playerStart);
    expect(atBlack.state.playerFacing).toBe('up');
    expect(atBlack.state.transition.phase).toBe('fading-in');
    expect(atBlack.state.transition.fadeAlpha).toBe(1);

    // Complete fade-in (`200 ms`): player regains control inside Shop Interior!
    const insideShop = stepHubTransition(atBlack.state, DEFAULT_HUB_FADE_MS, spawns);
    expect(insideShop.state.transition.phase).toBe('idle');
    expect(insideShop.state.transition.fadeAlpha).toBe(0);
    expect(canControlPlayerInHub(insideShop.state)).toBe(true);

    // Exit Shop Interior back to Village in a single combined frame (`400 ms` spans fade-out + fade-in).
    const exiting = startHubTransition(insideShop.state, {
      kind: 'village',
      from: 'shop-interior',
    });
    const backOutside = stepHubTransition(exiting, DEFAULT_HUB_FADE_MS * 2, spawns);
    expect(backOutside.switchedLocation).toBe(true);
    expect(backOutside.state.location).toBe('village');
    expect(backOutside.state.cameraMode).toBe('follow');
    expect(backOutside.state.musicDucked).toBe(false);
    expect(backOutside.state.autoFireEnabled).toBe(false);
    expect(backOutside.state.transition.phase).toBe('idle');
    expect(backOutside.state.transition.fadeAlpha).toBe(0);
    expect(backOutside.state.playerPos).toEqual(villageMap.entryPoints['shop-interior']!.at);
    // Crucially: outside return point does NOT re-trigger `shop-entrance`!
    expect(findStepTrigger(backOutside.state.playerPos, villageMap.triggers)).toBeNull();
  });

  it('transitions Village → Run at Expedition Gate and records Victory/Defeat return state', () => {
    const base = createHubState({
      save: { selectedCharacter: 'cultivator', unlockedCharacters: ['cultivator'] },
      spawns,
    });
    const fadingToRun = startHubTransition(
      base,
      { kind: 'run', chapter: 3, ascensionLevel: 2 },
      150,
    );
    const launched = stepHubTransition(fadingToRun, 200, spawns);

    expect(launched.switchedLocation).toBe(true);
    expect(launched.state.pendingRunLaunch).toEqual({
      chapter: 3,
      ascensionLevel: 2,
      characterId: 'cultivator',
    });
    expect(launched.state.transition.fadeAlpha).toBe(1);
    expect(canControlPlayerInHub(launched.state)).toBe(false);

    // Returning to Village after Victory starts at Central Square with fade-in and `lastRunOutcome = 'victory'`.
    const returned = createHubState({
      save: { selectedCharacter: 'cultivator', unlockedCharacters: ['cultivator'] },
      entryOrigin: 'run-victory',
      spawns,
      fadeInOnEnter: true,
    });
    expect(returned.lastRunOutcome).toBe('victory');
    expect(returned.playerPos).toEqual(villageMap.playerStart);
    expect(returned.transition.phase).toBe('fading-in');
    const settled = stepHubTransition(returned, DEFAULT_HUB_FADE_MS, spawns);
    expect(settled.state.transition.phase).toBe('idle');
    expect(settled.state.transition.fadeAlpha).toBe(0);
  });

  it('switches playable character & weapon loadout live at the Dojo and rejects locked heroes', () => {
    const start = updateHubPlayerPose(createHubState({ spawns }), { x: 28.5, y: 11.2 }, 'right');
    const save = { chaptersUnlocked: 3, unlockedCharacters: ['cultivator'] as const };

    const toMage = switchHubCharacter(start, 'mage', save);
    expect(toMage.ok).toBe(true);
    expect(toMage.changed).toBe(true);
    expect(toMage.state.characterId).toBe('mage');
    expect(toMage.state.character.defaultLoadout.attachmentItemId).toBe('staff-hand');
    // Preserves exact village tile position & facing!
    expect(toMage.state.playerPos).toEqual({ x: 28.5, y: 11.2 });
    expect(toMage.state.playerFacing).toBe('right');

    // Selecting the already-active hero is a clean no-op.
    const same = switchHubCharacter(toMage.state, 'mage', save);
    expect(same.ok).toBe(true);
    expect(same.changed).toBe(false);

    // Locked hero is rejected without mutating state.
    const lockedSave = { chaptersUnlocked: 1, unlockedCharacters: [] as const };
    const denied = switchHubCharacter(toMage.state, 'archer', lockedSave);
    expect(denied.ok).toBe(false);
    expect(denied.changed).toBe(false);
    expect(denied.state).toBe(toMage.state);
  });
});
