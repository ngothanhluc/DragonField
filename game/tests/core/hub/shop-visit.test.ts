/**
 * #93 unit tests beside the acceptance test: the Shop Visit session's extra surface
 * (`stepShopVisit`, panel/choice edge cases) and the `createHubState` shop start.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceShopDialog,
  closeShopPanel,
  createHubState,
  createShopVisit,
  DEFAULT_DIALOG_CHARS_PER_SEC,
  isShopVisitBusy,
  parseHubTmx,
  selectShopChoice,
  spawnsFromHubMaps,
  stepShopVisit,
  talkToShopkeeper,
} from '../../../assets/scripts/core/hub';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVELS = join(HERE, '../../../assets/resources/data/levels/village');
const village = parseHubTmx(readFileSync(join(LEVELS, 'village-hub.tmx'), 'utf8'), {
  source: 'village-hub.tmx',
});
const shop = parseHubTmx(readFileSync(join(LEVELS, 'shop-interior.tmx'), 'utf8'), {
  source: 'shop-interior.tmx',
});

const CONTEXT = { gold: 42, chaptersUnlocked: 1, unlockedCharacters: ['ninja'] as const };

describe('#93 Shop Visit session helpers', () => {
  it('advances the typewriter one step at a time and emits a blip while text appears', () => {
    const visit = talkToShopkeeper(createShopVisit(), CONTEXT, 'en');
    const dialog = visit.dialog!;
    expect(dialog.revealedChars).toBe(0);

    const stepped = stepShopVisit(visit, (1000 / DEFAULT_DIALOG_CHARS_PER_SEC) * 3);
    expect(stepped.state.dialog!.revealedChars).toBeGreaterThan(0);
    expect(stepped.blipCount).toBe(1);
    expect(isShopVisitBusy(stepped.state)).toBe(true);

    // Nothing open → nothing to step.
    const idle = stepShopVisit(createShopVisit(), 16);
    expect(idle.state).toEqual(createShopVisit());
    expect(idle.blipCount).toBe(0);
  });

  it('ignores clicks and confirmations when no dialog is open', () => {
    const idle = createShopVisit();
    expect(selectShopChoice(idle, 'meta-shop')).toBe(idle);
    expect(advanceShopDialog(idle)).toBe(idle);
    expect(closeShopPanel(idle)).toBe(idle);
  });

  it('closeShopPanel is a no-op without a panel and leaves an open dialog alone', () => {
    const talking = talkToShopkeeper(createShopVisit(), CONTEXT, 'vi');
    expect(closeShopPanel(talking)).toBe(talking);
  });
});

describe('#93 createHubState start location', () => {
  it('starts in the Shop Interior at its entry, static and quiet', () => {
    const spawns = spawnsFromHubMaps(village, shop);
    const state = createHubState({ entryOrigin: 'title', spawns, startLocation: 'shop-interior' });
    expect(state.location).toBe('shop-interior');
    expect(state.playerPos).toEqual(shop.playerStart);
    expect(state.playerFacing).toBe('up');
    expect(state.cameraMode).toBe('static');
    expect(state.dashEnabled).toBe(false);
    expect(state.musicDucked).toBe(true);
    expect(state.autoFireEnabled).toBe(false);
  });

  it('still starts in the village by default', () => {
    const spawns = spawnsFromHubMaps(village, shop);
    const state = createHubState({ entryOrigin: 'shop-interior', spawns });
    expect(state.location).toBe('village');
    expect(state.playerPos).toEqual(village.entryPoints['shop-interior']!.at);
    expect(state.cameraMode).toBe('follow');
  });
});
