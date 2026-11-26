import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAttachments } from '../../assets/scripts/core/art/attachments';
import { DIRECTIONS, validateManifest } from '../../assets/scripts/core/art/manifest';
import {
  CHARACTERS,
  CHARACTER_IDS,
  CHARACTER_ROSTER,
  DEFAULT_CHARACTER_ID,
  characterAnimationKeys,
  characterUnlockReason,
  getCharacter,
  getUnlockedCharacters,
  isCharacterId,
  isCharacterUnlocked,
  resolveCharacterAnimKey,
  resolveSelectedCharacter,
} from '../../assets/scripts/core/characters/roster';
import { CHARACTERS_TUNING } from '../../assets/scripts/core/enemies/tuning';
import { SIGNATURE_SKILL_IDS, getSignatureSpec } from '../../assets/scripts/core/input/active-skill';
import {
  buyCharacter,
  createDefaultSave,
  unlockNextChapter,
  withSelectedCharacter,
} from '../../assets/scripts/core/save/save-data';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '../../assets/resources/data');
const manifest = validateManifest(
  JSON.parse(readFileSync(join(DATA_DIR, 'animations.json'), 'utf8')),
);
const attachments = validateAttachments(
  JSON.parse(readFileSync(join(DATA_DIR, 'attachments.json'), 'utf8')),
);

describe('Character roster — 4-class data integrity & 3-layer identity', () => {
  it('defaults to ninja and defines all 4 classes in canonical display order', () => {
    expect(DEFAULT_CHARACTER_ID).toBe('ninja');
    expect(CHARACTER_IDS).toEqual(['ninja', 'archer', 'mage', 'cultivator']);
    expect(CHARACTER_ROSTER.map((entry) => entry.id)).toEqual([...CHARACTER_IDS]);

    for (const id of CHARACTER_IDS) {
      const entry = CHARACTERS[id];
      const tuning = CHARACTERS_TUNING[id];
      expect(entry.id).toBe(id);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.subtitle.length).toBeGreaterThan(0);
      expect(entry.animPrefix.length).toBeGreaterThan(0);
      expect(entry.unlockChapter).toBe(tuning.unlockChapter);
      expect(entry.unlockGoldCost).toBe(tuning.unlockGoldCost);
      expect(entry.weaponSummary.length).toBeGreaterThan(0);
      expect(entry.passiveName.length).toBeGreaterThan(0);
      expect(entry.passiveSummary.length).toBeGreaterThan(0);
      expect(entry.signatureName.length).toBeGreaterThan(0);
      expect(entry.signatureSummary.length).toBeGreaterThan(0);
      expect(SIGNATURE_SKILL_IDS).toContain(entry.signatureSkillId);
      expect(getSignatureSpec(entry.signatureSkillId).name).toBe(entry.signatureName);
    }
  });

  it('covers all 3 weapon forms and expected class specs across ninja, archer, mage, cultivator', () => {
    const ninja = getCharacter('ninja');
    expect(ninja.animPrefix).toBe('player');
    expect(ninja.rigId).toBeNull();
    expect(ninja.unlockChapter).toBe(0);
    expect(ninja.unlockGoldCost).toBe(0);
    expect(ninja.defaultLoadout).toEqual({
      weaponForm: 'projectile',
      attachmentItemId: null,
      defaultProjectileKey: 'fx.shuriken',
      attachmentSkillId: null,
    });
    expect(ninja.passiveName).toBe('Shadow Agility');
    expect(ninja.signatureSkillId).toBe('shadow-barrage');

    const archer = getCharacter('archer');
    expect(archer.animPrefix).toBe('archer');
    expect(archer.rigId).toBe('archer');
    expect(archer.unlockChapter).toBe(1);
    expect(archer.unlockGoldCost).toBeGreaterThan(0);
    expect(archer.defaultLoadout).toEqual({
      weaponForm: 'attachment',
      attachmentItemId: 'bow-hand',
      defaultProjectileKey: 'fx.arrow',
      attachmentSkillId: null,
    });
    expect(archer.passiveName).toBe('Keen Sight');
    expect(archer.signatureSkillId).toBe('piercing-volley');

    const mage = getCharacter('mage');
    expect(mage.animPrefix).toBe('mage');
    expect(mage.rigId).toBe('mage');
    expect(mage.unlockChapter).toBe(2);
    expect(mage.unlockGoldCost).toBeGreaterThan(archer.unlockGoldCost);
    expect(mage.defaultLoadout).toEqual({
      weaponForm: 'attachment',
      attachmentItemId: 'staff-hand',
      defaultProjectileKey: 'fx.arcane-bolt',
      attachmentSkillId: null,
    });
    expect(mage.passiveName).toBe('Arcane Attunement');
    expect(mage.signatureSkillId).toBe('arcane-nova');

    const cultivator = getCharacter('cultivator');
    expect(cultivator.animPrefix).toBe('cultivator');
    expect(cultivator.rigId).toBe('cultivator');
    expect(cultivator.unlockChapter).toBe(3);
    expect(cultivator.unlockGoldCost).toBeGreaterThan(mage.unlockGoldCost);
    expect(cultivator.defaultLoadout).toEqual({
      weaponForm: 'attachment',
      attachmentItemId: 'sword-back',
      defaultProjectileKey: 'fx.spirit-sword',
      attachmentSkillId: 'ten-thousand-swords',
    });
    expect(cultivator.passiveName).toBe('Sword Heart');
    expect(cultivator.signatureSkillId).toBe('ten-thousand-swords');
  });

  it('every roster entry matches real entries in animations.json and attachments.json', () => {
    for (const entry of CHARACTER_ROSTER) {
      // Every playable character must have all 4 idle directions and a valid default projectile.
      for (const dir of DIRECTIONS) {
        for (const kind of ['idle', 'walk', 'attack', 'hit', 'dash'] as const) {
          const clipKey = `${entry.animPrefix}.${kind}.${dir}`;
          expect(manifest.sprites[clipKey], `${entry.id} missing ${clipKey}`).toBeDefined();
        }
      }
      expect(
        manifest.sprites[`${entry.animPrefix}.dead`],
        `${entry.id} missing ${entry.animPrefix}.dead`,
      ).toBeDefined();
      expect(
        manifest.sprites[entry.defaultLoadout.defaultProjectileKey],
        `${entry.id} missing projectile ${entry.defaultLoadout.defaultProjectileKey}`,
      ).toBeDefined();

      // Projectile weapons never create an attachment node (GDD §14, M10).
      if (entry.defaultLoadout.weaponForm === 'projectile') {
        expect(entry.defaultLoadout.attachmentItemId).toBeNull();
        expect(entry.rigId).toBeNull();
      } else {
        expect(entry.rigId).not.toBeNull();
        expect(entry.defaultLoadout.attachmentItemId).not.toBeNull();
      }

      if (entry.rigId !== null) {
        expect(
          attachments.characters[entry.rigId],
          `${entry.id} missing rig "${entry.rigId}" in attachments.json`,
        ).toBeDefined();
      }

      if (entry.defaultLoadout.attachmentItemId !== null) {
        const item = attachments.items[entry.defaultLoadout.attachmentItemId];
        expect(
          item,
          `${entry.id} missing item "${entry.defaultLoadout.attachmentItemId}" in attachments.json`,
        ).toBeDefined();
        if (item !== undefined) {
          for (const dir of DIRECTIONS) {
            expect(
              manifest.sprites[`${item.sprite}.${dir}`],
              `${entry.id} missing attachment sprite ${item.sprite}.${dir}`,
            ).toBeDefined();
          }
        }
      }
    }
  });
});

describe('Character roster — lookup and chapter-clear OR gold-buy unlock rules', () => {
  it('isCharacterId and getCharacter distinguish all 4 valid ids from unknown inputs', () => {
    for (const id of CHARACTER_IDS) {
      expect(isCharacterId(id)).toBe(true);
      expect(getCharacter(id)).toBe(CHARACTERS[id]);
    }
    expect(isCharacterId('samurai')).toBe(false);
    expect(isCharacterId('')).toBe(false);
    expect(isCharacterId(null)).toBe(false);
    expect(isCharacterId(42)).toBe(false);
    expect(getCharacter('samurai')).toBeUndefined();
  });

  it('fresh save starts with only ninja unlocked and clear unlock reasons for locked classes', () => {
    const fresh = createDefaultSave();
    expect(getUnlockedCharacters(fresh)).toEqual([CHARACTERS.ninja]);
    expect(isCharacterUnlocked('ninja', fresh)).toBe(true);
    expect(isCharacterUnlocked('archer', fresh)).toBe(false);
    expect(isCharacterUnlocked('mage', fresh)).toBe(false);
    expect(isCharacterUnlocked('cultivator', fresh)).toBe(false);
    expect(isCharacterUnlocked('unknown', fresh)).toBe(false);

    expect(characterUnlockReason('ninja', fresh)).toBe('Mở sẵn từ đầu');
    expect(characterUnlockReason('archer', fresh)).toBe(
      `Vượt Chương 1 hoặc mua ${CHARACTERS.archer.unlockGoldCost} vàng`,
    );
    expect(characterUnlockReason('ninja', fresh, 'en')).toBe('Unlocked by default');
    expect(characterUnlockReason('archer', fresh, 'en')).toBe(
      `Clear Chapter 1 or buy for ${CHARACTERS.archer.unlockGoldCost} gold`,
    );
    expect(characterUnlockReason('mage', fresh, 'en')).toBe(
      `Clear Chapter 2 or buy for ${CHARACTERS.mage.unlockGoldCost} gold`,
    );
    expect(characterUnlockReason('cultivator', fresh, 'en')).toBe(
      `Clear Chapter 3 or buy for ${CHARACTERS.cultivator.unlockGoldCost} gold`,
    );
    expect(characterUnlockReason('unknown', fresh, 'en')).toBe('Unknown character');
  });

  it('unlocks archer after Ch1 clear, mage after Ch2 clear, and cultivator after Ch3 clear', () => {
    const afterCh1 = unlockNextChapter(createDefaultSave(), 1);
    expect(afterCh1.chaptersUnlocked).toBe(2);
    expect(getUnlockedCharacters(afterCh1).map((c) => c.id)).toEqual(['ninja', 'archer']);
    expect(characterUnlockReason('archer', afterCh1)).toBe('Đã mở (Vượt Chương 1)');
    expect(characterUnlockReason('archer', afterCh1, 'en')).toBe('Unlocked (Chapter 1 cleared)');
    expect(isCharacterUnlocked('mage', afterCh1)).toBe(false);

    const afterCh2 = unlockNextChapter(afterCh1, 2);
    expect(afterCh2.chaptersUnlocked).toBe(3);
    expect(getUnlockedCharacters(afterCh2).map((c) => c.id)).toEqual(['ninja', 'archer', 'mage']);
    expect(characterUnlockReason('mage', afterCh2, 'en')).toBe('Unlocked (Chapter 2 cleared)');
    expect(isCharacterUnlocked('cultivator', afterCh2)).toBe(false);

    const afterCh3 = unlockNextChapter(afterCh2, 3);
    expect(afterCh3.chaptersUnlocked).toBe(4);
    expect(getUnlockedCharacters(afterCh3).map((c) => c.id)).toEqual([
      'ninja',
      'archer',
      'mage',
      'cultivator',
    ]);
    expect(characterUnlockReason('cultivator', afterCh3, 'en')).toBe(
      'Unlocked (Chapter 3 cleared)',
    );
  });

  it('unlocks locked classes early via Meta gold purchase even at chaptersUnlocked === 1', () => {
    const rich = { ...createDefaultSave(), gold: 1000 };
    const withMage = buyCharacter(rich, 'mage');
    expect(isCharacterUnlocked('mage', withMage)).toBe(true);
    expect(isCharacterUnlocked('archer', withMage)).toBe(false);
    expect(isCharacterUnlocked('cultivator', withMage)).toBe(false);
    expect(getUnlockedCharacters(withMage).map((c) => c.id)).toEqual(['ninja', 'mage']);
    expect(characterUnlockReason('mage', withMage)).toBe('Đã mở (Đã mua)');
    expect(characterUnlockReason('mage', withMage, 'en')).toBe('Unlocked (Purchased)');
  });

  it('resolveSelectedCharacter honors valid unlocked choices and falls back to ninja when locked or corrupt', () => {
    const base = createDefaultSave();
    expect(resolveSelectedCharacter(base)).toBe(CHARACTERS.ninja);

    // Selecting a locked class in raw save data falls back safely to ninja.
    const lockedSelection = withSelectedCharacter(base, 'cultivator');
    expect(resolveSelectedCharacter(lockedSelection)).toBe(CHARACTERS.ninja);

    // Unlocking via gold purchase makes the selection active.
    const bought = buyCharacter({ ...lockedSelection, gold: 500 }, 'cultivator');
    expect(resolveSelectedCharacter(bought)).toBe(CHARACTERS.cultivator);

    // Unlocking via chapter milestone also makes the selection active.
    const clearedCh1 = withSelectedCharacter(unlockNextChapter(base, 1), 'archer');
    expect(resolveSelectedCharacter(clearedCh1)).toBe(CHARACTERS.archer);

    // Unknown/corrupt selection always falls back to default ninja.
    expect(
      resolveSelectedCharacter({
        selectedCharacter: 'samurai',
        chaptersUnlocked: 4,
      }),
    ).toBe(CHARACTERS.ninja);
    expect(
      resolveSelectedCharacter({
        selectedCharacter: 123,
        chaptersUnlocked: 4,
      }),
    ).toBe(CHARACTERS.ninja);
    expect(resolveSelectedCharacter({})).toBe(CHARACTERS.ninja);
  });
});

describe('Character roster — animation key resolution', () => {
  it('builds primary and fallback keys per clip kind for all 4 classes', () => {
    expect(characterAnimationKeys(CHARACTERS.ninja, 'idle', 'up')).toEqual({
      key: 'player.idle.up',
      fallback: 'player.idle.down',
    });
    expect(characterAnimationKeys(CHARACTERS.archer, 'attack', 'right')).toEqual({
      key: 'archer.attack.right',
      fallback: 'archer.idle.right',
    });
    expect(characterAnimationKeys(CHARACTERS.mage, 'dash', 'down')).toEqual({
      key: 'mage.dash.down',
      fallback: 'mage.idle.down',
    });
    expect(characterAnimationKeys(CHARACTERS.cultivator, 'walk', 'left')).toEqual({
      key: 'cultivator.walk.left',
      fallback: 'cultivator.idle.left',
    });
    expect(characterAnimationKeys(CHARACTERS.cultivator, 'dead')).toEqual({
      key: 'cultivator.dead',
      fallback: 'cultivator.idle.down',
    });
  });

  it('resolves exact staged keys for all 4 classes and falls back safely to idle when a clip is absent', () => {
    for (const entry of CHARACTER_ROSTER) {
      for (const dir of DIRECTIONS) {
        expect(resolveCharacterAnimKey(manifest, entry, 'idle', dir)).toBe(
          `${entry.animPrefix}.idle.${dir}`,
        );
        expect(resolveCharacterAnimKey(manifest, entry, 'walk', dir)).toBe(
          `${entry.animPrefix}.walk.${dir}`,
        );
        expect(resolveCharacterAnimKey(manifest, entry, 'attack', dir)).toBe(
          `${entry.animPrefix}.attack.${dir}`,
        );
        expect(resolveCharacterAnimKey(manifest, entry, 'hit', dir)).toBe(
          `${entry.animPrefix}.hit.${dir}`,
        );
        expect(resolveCharacterAnimKey(manifest, entry, 'dash', dir)).toBe(
          `${entry.animPrefix}.dash.${dir}`,
        );
      }
      expect(resolveCharacterAnimKey(manifest, entry, 'dead')).toBe(`${entry.animPrefix}.dead`);
    }

    // When a clip is missing from a partial manifest, fallback resolves safely to the character's idle.
    const partialSprites = { ...manifest.sprites };
    delete partialSprites['cultivator.walk.right'];
    expect(
      resolveCharacterAnimKey(
        { ...manifest, sprites: partialSprites },
        CHARACTERS.cultivator,
        'walk',
        'right',
      ),
    ).toBe('cultivator.idle.right');
  });

  it('uses a staged clip automatically when present in the manifest', () => {
    const withWalk = {
      ...manifest,
      sprites: {
        ...manifest.sprites,
        'cultivator.walk.right': manifest.sprites['cultivator.idle.right']!,
      },
    };
    expect(resolveCharacterAnimKey(withWalk, CHARACTERS.cultivator, 'walk', 'right')).toBe(
      'cultivator.walk.right',
    );
  });
});
