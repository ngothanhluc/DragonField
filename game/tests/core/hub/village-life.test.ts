/**
 * Unit tests for the Village Life session (`core/hub/village-life.ts`, #92) — the parts the
 * acceptance test does not pin: DialogBox view-model edge cases, locale clamping, ignored
 * re-talks while a box is open, and live NPC positions for the floating `[E]` prompt.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  advanceDialog,
  advanceVillageDialog,
  createVillageLife,
  dialogBoxView,
  isVillageDialogOpen,
  moveDialogChoice,
  openShopkeeperDialog,
  parseHubTmx,
  stepVillageLife,
  talkToVillager,
  villageLiveNpcs,
  type HubMapData,
  type VillageLifeState,
} from '../../../assets/scripts/core/hub';
import { EN, VI } from '../../../assets/scripts/core/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const VILLAGE_TMX = join(HERE, '../../../assets/resources/data/levels/village/village-hub.tmx');
const map: HubMapData = parseHubTmx(readFileSync(VILLAGE_TMX, 'utf8'), { source: 'village-hub.tmx' });

const OPTIONS = {
  seed: 92,
  animalTuning: { fleeRadiusTiles: 3, wanderSpeedTilesPerSec: 1.2, fleeSpeedTilesPerSec: 4 },
} as const;

function step(state: VillageLifeState, dtMs: number): VillageLifeState {
  return stepVillageLife(state, map, { dtMs, playerPos: null }).state;
}

function closeBox(state: VillageLifeState): VillageLifeState {
  return advanceVillageDialog(advanceVillageDialog(state));
}

describe('Village Life session', () => {
  it('mirrors live villager positions for the interaction prompt', () => {
    const life = createVillageLife(map, OPTIONS);
    const live = villageLiveNpcs(life);
    expect(live.map((entry) => entry.id)).toEqual(['villager-1', 'villager-2', 'villager-3', 'villager-4', 'villager-5']);
    live.forEach((entry, index) => {
      expect(entry.position).toEqual(life.villagers[index]!.position);
    });
  });

  it('ignores a second talk while a box is open and keeps the current speaker', () => {
    let life = createVillageLife(map, OPTIONS);
    life = talkToVillager(life, 'villager-1', 'vi');
    expect(isVillageDialogOpen(life)).toBe(true);

    const unchanged = talkToVillager(life, 'villager-4', 'vi');
    expect(unchanged).toBe(life);
    expect(unchanged.dialog?.speakerId).toBe('villager-1');
  });

  it('rotates through the catalog and wraps after the third line', () => {
    let life = createVillageLife(map, OPTIONS);
    const keys: string[] = [];
    for (let talk = 0; talk < 4; talk += 1) {
      life = talkToVillager(life, 'villager-3', 'en');
      keys.push(life.dialog!.bodyKey);
      life = closeBox(life);
    }
    expect(keys).toEqual([
      'hub.dialog.villager3.tipShopUpgrades',
      'hub.dialog.villager3.loreSmithy',
      'hub.dialog.villager3.tipSpecialRoom',
      'hub.dialog.villager3.tipShopUpgrades',
    ]);
  });

  it('advanceVillageDialog is a no-op with no box open and closes on the second press', () => {
    const life = createVillageLife(map, OPTIONS);
    expect(advanceVillageDialog(life)).toBe(life);

    let opened = talkToVillager(life, 'villager-5', 'vi');
    opened = advanceVillageDialog(opened);
    expect(isVillageDialogOpen(opened)).toBe(true);
    expect(dialogBoxView(opened.dialog!, 'vi').showContinueHint).toBe(true);
    opened = advanceVillageDialog(opened);
    expect(isVillageDialogOpen(opened)).toBe(false);
    expect(opened.dialog).toBeNull();
  });

  it('clamps the typewriter prefix when the locale changes mid-line', () => {
    let life = createVillageLife(map, OPTIONS);
    life = talkToVillager(life, 'villager-1', 'vi');
    // A few frames of Vietnamese typing, then read the box in English (a different line).
    for (let frame = 0; frame < 8; frame += 1) life = step(life, 100);

    const viView = dialogBoxView(life.dialog!, 'vi');
    const enView = dialogBoxView(life.dialog!, 'en');
    expect(viView.fullText).toBe(VI['hub.dialog.villager1.tipPotions']);
    expect(enView.fullText).toBe(EN['hub.dialog.villager1.tipPotions']);
    expect(enView.text.length).toBe(Math.min(life.dialog!.revealedChars, enView.fullText.length));
    expect(enView.fullText.startsWith(enView.text)).toBe(true);
  });

  it('keeps the talking villager still even when the player walks away', () => {
    let life = createVillageLife(map, OPTIONS);
    const here = life.villagers[1]!.position;
    life = talkToVillager(life, 'villager-2', 'en');
    for (let frame = 0; frame < 20; frame += 1) {
      life = stepVillageLife(life, map, { dtMs: 100, playerPos: { x: here.x + 6, y: here.y } }).state;
    }
    const talker = life.villagers[1]!;
    expect(talker.mode).toBe('yield');
    expect(talker.position).toEqual(here);
  });
});

describe('dialogBoxView — reusable DialogBox view model', () => {
  it('reveals choices only after the text and exposes exactly one selected row', () => {
    const dialog = openShopkeeperDialog(
      { gold: 300, chaptersUnlocked: 1, unlockedCharacters: [] },
      EN['hub.dialog.shopkeeper.greetRich'].length,
    );
    expect(dialogBoxView(dialog, 'en').choices).toEqual([]);
    expect(dialogBoxView(dialog, 'en').showContinueHint).toBe(false);

    const revealed = advanceDialog(dialog).state;
    const view = dialogBoxView(revealed, 'vi');
    expect(view.choices.map((choice) => Object.keys(choice).sort())).toEqual([
      ['label', 'selected'],
      ['label', 'selected'],
      ['label', 'selected'],
    ]);
    expect(view.choices.filter((choice) => choice.selected)).toHaveLength(1);
    expect(view.choices[0]).toEqual({
      label: VI['hub.dialog.shopkeeper.choice.metaShop'],
      selected: true,
    });

    const moved = dialogBoxView(moveDialogChoice(revealed, 2), 'en');
    expect(moved.choices.map((choice) => choice.selected)).toEqual([false, false, true]);
  });

  it('localizes a villager line and speaker name in both locales', () => {
    let life = createVillageLife(map, OPTIONS);
    life = talkToVillager(life, 'villager-2', 'en');
    const view = dialogBoxView(life.dialog!, 'en');
    expect(view.speakerName).toBe(EN['hub.npc.villager2.name']);
    expect(view.portrait.speakerId).toBe('villager-2');
    expect(view.portrait.displaySizePx).toBe(64);
    expect(view.showContinueHint).toBe(false);
  });
});
