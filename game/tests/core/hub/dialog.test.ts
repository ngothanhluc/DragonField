/**
 * Unit tests for `core/hub/dialog.ts` (Shopkeeper contextual greetings + 3 choices,
 * rotating Villager lore/tips, portrait resolution, and typewriter + blip cadence).
 */
import { describe, expect, it } from 'vitest';
import {
  HUB_VILLAGER_IDS,
  SHOPKEEPER_CHOICE_IDS,
  SHOPKEEPER_RICH_GOLD_THRESHOLD,
  advanceDialog,
  moveDialogChoice,
  openShopkeeperDialog,
  openVillagerDialog,
  pickShopkeeperGreeting,
  resolveDialogPortrait,
  selectDialogChoice,
  stepDialogTypewriter,
  type VillagerTalkCounts,
} from '../../../assets/scripts/core/hub';

describe('RPG DialogBox state machine', () => {
  it('selects contextual Shopkeeper greetings and builds all 3 choices with hero unlock badges', () => {
    expect(
      pickShopkeeperGreeting({ gold: 80, chaptersUnlocked: 2, lastRunOutcome: 'victory' })
        .greetingKey,
    ).toBe('hub.dialog.shopkeeper.greetVictory');

    expect(
      pickShopkeeperGreeting({ gold: SHOPKEEPER_RICH_GOLD_THRESHOLD + 10, chaptersUnlocked: 1 })
        .greetingKey,
    ).toBe('hub.dialog.shopkeeper.greetRich');

    expect(pickShopkeeperGreeting({ gold: 40, chaptersUnlocked: 3 }).greetingKey).toBe(
      'hub.dialog.shopkeeper.greetChapter',
    );

    expect(pickShopkeeperGreeting({ gold: 0, chaptersUnlocked: 1 }).greetingKey).toBe(
      'hub.dialog.shopkeeper.greetBroke',
    );

    expect(pickShopkeeperGreeting({ gold: 35, chaptersUnlocked: 1 }).greetingKey).toBe(
      'hub.dialog.shopkeeper.greetDefault',
    );

    const dialog = openShopkeeperDialog(
      { gold: 9999, chaptersUnlocked: 1, unlockedCharacters: [] },
      60,
    );
    expect(dialog.open).toBe(true);
    expect(dialog.choices.map((c) => c.id)).toEqual([...SHOPKEEPER_CHOICE_IDS]);
    const unlockChoice = dialog.choices.find((c) => c.id === 'unlock-heroes')!;
    // Ninja is unlocked by default; Archer, Mage, Cultivator are locked and affordable at 9999 gold.
    expect(unlockChoice.remainingLockedCount).toBe(3);
    expect(unlockChoice.affordableCount).toBe(3);
  });

  it('cycles typewriter reveal, throttles voice blips, navigates choices, and confirms selection', () => {
    const initial = openShopkeeperDialog({ gold: 50, chaptersUnlocked: 1 }, 20);
    expect(initial.isFullyRevealed).toBe(false);

    // Step typewriter by 100 ms (`~4` chars → 1 voice blip!).
    const stepped = stepDialogTypewriter(initial, 100, 40);
    expect(stepped.state.revealedChars).toBe(4);
    expect(stepped.blipCount).toBe(1);

    // Pressing `[E]` while still typing reveals the full text immediately without closing!
    const revealed = advanceDialog(stepped.state);
    expect(revealed.kind).toBe('revealed');
    expect(revealed.state.isFullyRevealed).toBe(true);
    expect(revealed.state.open).toBe(true);

    // Navigate down (`+1` → `unlock-heroes`), wrap up (`-2` → `leave`), then back (`-1` → `unlock-heroes`).
    const onUnlock = moveDialogChoice(revealed.state, 1);
    expect(onUnlock.selectedChoiceIndex).toBe(1);
    const wrapped = moveDialogChoice(revealed.state, -1);
    expect(wrapped.selectedChoiceIndex).toBe(2);

    // Pressing `[E]` when revealed activates the highlighted choice (`leave` at index 2).
    const confirmed = advanceDialog(wrapped);
    expect(confirmed).toMatchObject({ kind: 'choice', choice: 'leave' });
    expect(confirmed.state.open).toBe(false);

    // Direct mouse click on `'meta-shop'` selects `'meta-shop'` cleanly.
    const clicked = selectDialogChoice(revealed.state, 'meta-shop');
    expect(clicked).toMatchObject({ kind: 'choice', choice: 'meta-shop' });
    expect(clicked.state.open).toBe(false);
  });

  it('rotates localized lore and gameplay tips per villager without consecutive repeats', () => {
    let counts: VillagerTalkCounts = {};
    for (const villagerId of HUB_VILLAGER_IDS) {
      const seenKeys: string[] = [];
      for (let round = 0; round < 4; round += 1) {
        const res = openVillagerDialog(villagerId, counts, 30);
        counts = res.talkCounts;
        seenKeys.push(res.dialog.bodyKey);
      }
      // First 3 talks produce 3 distinct keys, 4th talk wraps cleanly back to the 1st key!
      expect(new Set(seenKeys.slice(0, 3)).size, villagerId).toBe(3);
      expect(seenKeys[3]).toBe(seenKeys[0]);

      // Advancing revealed villager dialog closes cleanly.
      const open = openVillagerDialog(villagerId, counts, 0).dialog;
      expect(open.isFullyRevealed).toBe(true);
      const closed = advanceDialog(open);
      expect(closed.kind).toBe('closed');
      expect(closed.state.open).toBe(false);
    }
  });

  it('resolves 64×64 portrait paths for all 4 heroes, Shopkeeper, Dojo Master, and villager Facesets', () => {
    for (const hero of ['ninja', 'archer', 'mage', 'cultivator'] as const) {
      expect(resolveDialogPortrait(hero)).toEqual({
        speakerId: hero,
        primaryPath: `art/generated/portraits/portrait-${hero}`,
        fallbackPath: null,
        displaySizePx: 64,
      });
    }

    expect(resolveDialogPortrait('shopkeeper')).toEqual({
      speakerId: 'shopkeeper',
      primaryPath: 'art/generated/portraits/portrait-shopkeeper',
      fallbackPath: 'art/npc/shopkeeper/Faceset',
      displaySizePx: 64,
    });

    expect(resolveDialogPortrait('dojo-master')).toEqual({
      speakerId: 'dojo-master',
      primaryPath: 'art/generated/portraits/portrait-dojo-master',
      fallbackPath: 'art/npc/dojo-master/Faceset',
      displaySizePx: 64,
    });

    expect(resolveDialogPortrait('villager-2')).toEqual({
      speakerId: 'villager-2',
      primaryPath: 'art/npc/villager-2/Faceset',
      fallbackPath: 'art/npc/villager-2/Faceset',
      displaySizePx: 64,
    });
  });
});
