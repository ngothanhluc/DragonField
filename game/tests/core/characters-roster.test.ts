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
  getAvailableCharacters,
  getCharacter,
  isCharacterAvailable,
  isCharacterId,
  resolveCharacterAnimKey,
  resolveSelectedCharacter,
} from '../../assets/scripts/core/characters/roster';
import { createDefaultSave, withSelectedCharacter } from '../../assets/scripts/core/save/save-data';
import { DEFAULT_SETTINGS } from '../../assets/scripts/core/save/settings';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, '../../assets/resources/data');
const manifest = validateManifest(
  JSON.parse(readFileSync(join(DATA_DIR, 'animations.json'), 'utf8')),
);
const attachments = validateAttachments(
  JSON.parse(readFileSync(join(DATA_DIR, 'attachments.json'), 'utf8')),
);

describe('Character roster — data integrity', () => {
  it('defaults to ninja and lists every CHARACTER_IDS entry in order', () => {
    expect(DEFAULT_CHARACTER_ID).toBe('ninja');
    expect(CHARACTER_ROSTER.map((entry) => entry.id)).toEqual([...CHARACTER_IDS]);
    for (const id of CHARACTER_IDS) {
      expect(CHARACTERS[id].id).toBe(id);
      expect(CHARACTERS[id].name.length).toBeGreaterThan(0);
      expect(CHARACTERS[id].subtitle.length).toBeGreaterThan(0);
      expect(CHARACTERS[id].animPrefix.length).toBeGreaterThan(0);
    }
  });

  it('ninja uses player.* animations and projectile-only loadout (no attachment node)', () => {
    const ninja = getCharacter('ninja');
    expect(ninja.animPrefix).toBe('player');
    expect(ninja.rigId).toBeNull();
    expect(ninja.featureFlag).toBeNull();
    expect(ninja.defaultLoadout.weaponForm).toBe('projectile');
    expect(ninja.defaultLoadout.attachmentItemId).toBeNull();
    expect(ninja.defaultLoadout.defaultProjectileKey).toBe('fx.shuriken');
    expect(ninja.defaultLoadout.attachmentSkillId).toBeNull();
  });

  it('cultivator uses cultivator.* body, cultivator rig, back sword attachment, and is flag-gated', () => {
    const cultivator = getCharacter('cultivator');
    expect(cultivator.animPrefix).toBe('cultivator');
    expect(cultivator.rigId).toBe('cultivator');
    expect(cultivator.featureFlag).toBe('cultivatorEnabled');
    expect(cultivator.defaultLoadout.weaponForm).toBe('attachment');
    expect(cultivator.defaultLoadout.attachmentItemId).toBe('sword-back');
    expect(cultivator.defaultLoadout.attachmentSkillId).toBe('ten-thousand-swords');
  });

  it('every roster entry matches real entries in animations.json and attachments.json', () => {
    for (const entry of CHARACTER_ROSTER) {
      // Every playable character must have all 4 idle directions and a valid default projectile.
      for (const dir of DIRECTIONS) {
        const idleKey = `${entry.animPrefix}.idle.${dir}`;
        expect(manifest.sprites[idleKey], `${entry.id} missing ${idleKey}`).toBeDefined();
      }
      expect(
        manifest.sprites[entry.defaultLoadout.defaultProjectileKey],
        `${entry.id} missing projectile ${entry.defaultLoadout.defaultProjectileKey}`,
      ).toBeDefined();

      // Projectile weapons never create an attachment node (GDD §14, M10).
      if (entry.defaultLoadout.weaponForm === 'projectile') {
        expect(entry.defaultLoadout.attachmentItemId).toBeNull();
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

describe('Character roster — lookup and feature flag gating', () => {
  it('isCharacterId and getCharacter distinguish valid and unknown ids', () => {
    expect(isCharacterId('ninja')).toBe(true);
    expect(isCharacterId('cultivator')).toBe(true);
    expect(isCharacterId('archer')).toBe(false);
    expect(isCharacterId('')).toBe(false);
    expect(isCharacterId(null)).toBe(false);
    expect(isCharacterId(42)).toBe(false);

    expect(getCharacter('ninja')).toBe(CHARACTERS.ninja);
    expect(getCharacter('cultivator')).toBe(CHARACTERS.cultivator);
    expect(getCharacter('archer')).toBeUndefined();
  });

  it('cultivator is hidden behind cultivatorEnabled by default and unlocked when enabled', () => {
    expect(DEFAULT_SETTINGS.cultivatorEnabled).toBe(false);

    expect(getAvailableCharacters()).toEqual([CHARACTERS.ninja]);
    expect(getAvailableCharacters({ cultivatorEnabled: false })).toEqual([CHARACTERS.ninja]);
    expect(isCharacterAvailable('ninja', { cultivatorEnabled: false })).toBe(true);
    expect(isCharacterAvailable('cultivator', { cultivatorEnabled: false })).toBe(false);

    expect(getAvailableCharacters({ cultivatorEnabled: true })).toEqual([
      CHARACTERS.ninja,
      CHARACTERS.cultivator,
    ]);
    expect(isCharacterAvailable('cultivator', { cultivatorEnabled: true })).toBe(true);
    expect(isCharacterAvailable('unknown', { cultivatorEnabled: true })).toBe(false);
  });

  it('resolveSelectedCharacter honors valid enabled choices and falls back to ninja otherwise', () => {
    const base = createDefaultSave();
    expect(resolveSelectedCharacter(base)).toBe(CHARACTERS.ninja);

    const enabledSave = {
      ...withSelectedCharacter(base, 'cultivator'),
      settings: { ...base.settings, cultivatorEnabled: true },
    };
    expect(resolveSelectedCharacter(enabledSave)).toBe(CHARACTERS.cultivator);

    // If the flag is turned off again while cultivator is saved, fall back cleanly to ninja.
    const disabledSave = {
      ...enabledSave,
      settings: { ...enabledSave.settings, cultivatorEnabled: false },
    };
    expect(resolveSelectedCharacter(disabledSave)).toBe(CHARACTERS.ninja);

    // Unknown/corrupt selection always falls back to default ninja.
    expect(
      resolveSelectedCharacter({
        selectedCharacter: 'archer',
        settings: { cultivatorEnabled: true },
      }),
    ).toBe(CHARACTERS.ninja);
    expect(
      resolveSelectedCharacter({
        selectedCharacter: 123,
        settings: { cultivatorEnabled: true },
      }),
    ).toBe(CHARACTERS.ninja);
    expect(resolveSelectedCharacter({})).toBe(CHARACTERS.ninja);
  });
});

describe('Character roster — animation key resolution', () => {
  it('builds primary and fallback keys per clip kind', () => {
    expect(characterAnimationKeys(CHARACTERS.ninja, 'idle', 'up')).toEqual({
      key: 'player.idle.up',
      fallback: 'player.idle.down',
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

  it('resolves exact keys for ninja and falls back safely to idle for unstaged cultivator clips', () => {
    expect(resolveCharacterAnimKey(manifest, CHARACTERS.ninja, 'idle', 'down')).toBe(
      'player.idle.down',
    );
    expect(resolveCharacterAnimKey(manifest, CHARACTERS.ninja, 'walk', 'left')).toBe(
      'player.walk.left',
    );
    expect(resolveCharacterAnimKey(manifest, CHARACTERS.ninja, 'attack', 'up')).toBe(
      'player.attack.up',
    );
    expect(resolveCharacterAnimKey(manifest, CHARACTERS.ninja, 'hit', 'right')).toBe(
      'player.hit.right',
    );
    expect(resolveCharacterAnimKey(manifest, CHARACTERS.ninja, 'dash', 'down')).toBe(
      'player.dash.down',
    );
    expect(resolveCharacterAnimKey(manifest, CHARACTERS.ninja, 'dead')).toBe('player.dead');

    for (const dir of DIRECTIONS) {
      expect(resolveCharacterAnimKey(manifest, CHARACTERS.cultivator, 'idle', dir)).toBe(
        `cultivator.idle.${dir}`,
      );
      // Cultivator clips are now staged; walk/dash resolve directly to cultivator.*.
      const walkKey = resolveCharacterAnimKey(manifest, CHARACTERS.cultivator, 'walk', dir);
      expect(manifest.sprites[walkKey]).toBeDefined();
      expect(walkKey).toBe(`cultivator.walk.${dir}`);
      expect(resolveCharacterAnimKey(manifest, CHARACTERS.cultivator, 'dash', dir)).toBe(
        `cultivator.dash.${dir}`,
      );
    }
    const deadKey = resolveCharacterAnimKey(manifest, CHARACTERS.cultivator, 'dead');
    expect(manifest.sprites[deadKey]).toBeDefined();
    expect(deadKey.startsWith('cultivator.')).toBe(true);
  });

  it('uses a staged cultivator clip automatically when present in the manifest', () => {
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
