/**
 * Unit tests for the M21 #94 pure hub modules: `dojo.ts`, `quick-access.ts`, `hub-audio.ts`
 * and the Settings return rule in `home-flow.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  createHubState,
  dojoSwapCharacter,
  hubMusicCue,
  initialHomeFlow,
  startHubTransition,
  stepHomeFlow,
  stepHubTransition,
  VILLAGE_MUSIC_PATH,
  VILLAGE_QUICK_ITEMS,
  VILLAGE_QUICK_LABEL_KEYS,
  villageQuickRoute,
} from '../../../assets/scripts/core/hub';
import { EN, VI } from '../../../assets/scripts/core/i18n';
import { createDefaultSave, parseSaveData } from '../../../assets/scripts/core/save/save-data';

function saveWithArcher() {
  return parseSaveData({
    ...createDefaultSave(),
    gold: 120,
    unlockedCharacters: ['ninja', 'archer'],
  });
}

describe('dojoSwapCharacter', () => {
  it('does not mutate its hub or save inputs', () => {
    const hub = createHubState({ save: saveWithArcher() });
    const save = saveWithArcher();
    const hubSnapshot = JSON.stringify(hub);
    const saveSnapshot = JSON.stringify(save);

    const result = dojoSwapCharacter(hub, save, 'archer');

    expect(result.changed).toBe(true);
    expect(JSON.stringify(hub)).toBe(hubSnapshot);
    expect(JSON.stringify(save)).toBe(saveSnapshot);
  });

  it('keeps the hub transition untouched (a swap never cancels a fade)', () => {
    const hub = startHubTransition(createHubState({ save: saveWithArcher() }), {
      kind: 'shop-interior',
    });
    const result = dojoSwapCharacter(hub, saveWithArcher(), 'archer');

    expect(result.hub.transition).toEqual(hub.transition);
  });
});

describe('quick-access routes', () => {
  it('every shortcut has a localized label in vi and en', () => {
    for (const item of VILLAGE_QUICK_ITEMS) {
      const key = VILLAGE_QUICK_LABEL_KEYS[item];
      expect(VI[key], `vi ${key}`).toBeTruthy();
      expect(EN[key], `en ${key}`).toBeTruthy();
    }
  });

  it('routes Play through the expedition gate interaction', () => {
    expect(villageQuickRoute('play')).toEqual({
      kind: 'hub-interact',
      action: { kind: 'open-expedition', triggerId: 'expedition-gate' },
    });
  });
});

describe('Settings return screen', () => {
  it('returns to the village when opened from the village', () => {
    const village = stepHomeFlow(initialHomeFlow(), {
      kind: 'title-select',
      item: 'enter-village',
    });
    const settings = stepHomeFlow(village, { kind: 'open-settings' });
    expect(settings.screen).toBe('settings');
    expect(stepHomeFlow(settings, { kind: 'back' }).screen).toBe('village');
    expect(stepHomeFlow(settings, { kind: 'back' }).settingsReturn).toBeNull();
  });

  it('returns to the title when opened from the title', () => {
    const settings = stepHomeFlow(initialHomeFlow(), {
      kind: 'title-select',
      item: 'settings',
    });
    expect(stepHomeFlow(settings, { kind: 'back' }).screen).toBe('title');
  });

  it('ignores open-settings on screens that have no Settings entry', () => {
    const title = initialHomeFlow();
    expect(stepHomeFlow(title, { kind: 'open-settings' })).toEqual(title);
  });
});

describe('hubMusicCue', () => {
  it('plays the village track unducked by default', () => {
    expect(hubMusicCue(createHubState(), { dialogOpen: false })).toEqual({
      track: VILLAGE_MUSIC_PATH,
      ducked: false,
    });
  });

  it('ducks for an open dialog and inside the shop interior', () => {
    expect(hubMusicCue(createHubState(), { dialogOpen: true }).ducked).toBe(true);

    const fading = startHubTransition(createHubState(), { kind: 'shop-interior' });
    const shop = stepHubTransition(fading, 1000).state;
    expect(shop.location).toBe('shop-interior');
    expect(hubMusicCue(shop, { dialogOpen: false })).toEqual({
      track: VILLAGE_MUSIC_PATH,
      ducked: true,
    });
  });
});
