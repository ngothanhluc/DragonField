/**
 * Data-driven 4-class playable character roster (GDD §14, §15.4, M14).
 *
 * Pure TS — zero `cc` imports, testable with vitest.
 *
 * Covers all 4 classes across all 3 weapon forms (`projectile`, `hand`, `back`):
 * - **Ninja** (`ninja`, unlocked from start): `projectile` shuriken/kunai, *Shadow Agility*, *Shadow Barrage*.
 * - **Archer** (`archer`, Ch1 clear OR early gold): `hand` bow (`bow-hand`), *Keen Sight*, *Piercing Volley*.
 * - **Mage** (`mage`, Ch2 clear OR early gold): `hand` staff (`staff-hand`), *Arcane Attunement*, *Arcane Nova*.
 * - **Cultivator** (`cultivator`, Ch3 clear OR early gold): `back` sword (`sword-back`), *Sword Heart*, *Ten Thousand Swords*.
 *
 * Unlock milestones and early-buy gold prices are read from `CHARACTERS_TUNING` (`config/tuning.json`).
 */
import { resolve, type AnimationManifest, type Direction, type SpriteEntry } from '../art/manifest';
import { CHARACTERS_TUNING } from '../enemies/tuning';
import { getLocale, t, type Locale } from '../i18n';
import type { SignatureSkillId } from '../input/active-skill';

/** Playable character identifiers in roster display order. */
export const CHARACTER_IDS = ['ninja', 'archer', 'mage', 'cultivator'] as const;

/** Union of all known playable character IDs. */
export type CharacterId = (typeof CHARACTER_IDS)[number];

/** Default playable character (always unlocked from the start). */
export const DEFAULT_CHARACTER_ID: CharacterId = 'ninja';

/** Source texel dimensions of M19 character & NPC pixel-art portraits (`64×64`). */
export const PORTRAIT_SOURCE_SIZE_PX = 64;

/** Default fallback portrait manifest key (`icon.portrait-ninja`). */
export const DEFAULT_PORTRAIT_KEY = 'icon.portrait-ninja';

/**
 * Visual weapon form (GDD §14).
 * - `projectile`: spawned per shot as an FX sprite, never attached to the body.
 * - `attachment`: separate sprite mounted on the body's `hand` or `back` point.
 */
export type WeaponForm = 'projectile' | 'attachment';

/** Default visual weapon loadout for a playable character. */
export interface CharacterLoadout {
  readonly weaponForm: WeaponForm;
  /**
   * Item id in `assets/resources/data/attachments.json` (`items[id]`), or `null` when
   * `weaponForm === 'projectile'` (projectile weapons never create an attachment node).
   */
  readonly attachmentItemId: string | null;
  /** Default projectile key in `assets/resources/data/animations.json`. */
  readonly defaultProjectileKey: string;
  /**
   * Optional skill event identifier that temporarily hides this character's worn attachment
   * while the skill effect is active (e.g. `'ten-thousand-swords'` for the cultivator).
   */
  readonly attachmentSkillId: string | null;
}

/** Logical player animation clips requested by the player controller. */
export type CharacterAnimKind = 'idle' | 'walk' | 'attack' | 'hit' | 'dead' | 'dash';

/** Primary manifest key plus a guaranteed-present fallback key for a character animation. */
export interface CharacterAnimKeys {
  readonly key: string;
  readonly fallback: string;
}

/** Data-driven definition of one playable character with full 3-layer class identity. */
export interface CharacterDef {
  readonly id: CharacterId;
  readonly name: string;
  readonly subtitle: string;
  /** Prefix in `animations.json` (`'player'` for NinjaGreen, `'archer'`, `'mage'`, `'cultivator'`). */
  readonly animPrefix: string;
  /** Logical 64×64 portrait key in `animations.json` (`icon.portrait-<id>`, M19 ADR-027). */
  readonly portraitKey: string;
  /**
   * Character id in `attachments.json` (`characters[rigId]`), or `null` when the character
   * has no attachment rig (baked / projectile-only body).
   */
  readonly rigId: string | null;
  readonly defaultLoadout: CharacterLoadout;
  /**
   * Chapter clear milestone required for free unlock:
   * - `0`: unlocked by default (`ninja`)
   * - `1`: clear Ch1 (`chaptersUnlocked >= 2`)
   * - `2`: clear Ch2 (`chaptersUnlocked >= 3`)
   * - `3`: clear Ch3 (`chaptersUnlocked >= 4`)
   */
  readonly unlockChapter: number;
  /** Early Meta gold purchase cost (`0` for Ninja). */
  readonly unlockGoldCost: number;
  /** Layer 1 summary: auto-fire weapon & base stat identity. */
  readonly weaponSummary: string;
  /** Layer 2 starting passive name. */
  readonly passiveName: string;
  /** Layer 2 starting passive effect summary. */
  readonly passiveSummary: string;
  /** Layer 3 Signature Active skill identifier. */
  readonly signatureSkillId: SignatureSkillId;
  /** Layer 3 Signature Active display name. */
  readonly signatureName: string;
  /** Layer 3 Signature Active effect summary. */
  readonly signatureSummary: string;
}

/** Minimal save-like shape accepted by unlock helpers (avoids circular imports with `save-data.ts`). */
export interface CharacterUnlockSource {
  readonly chaptersUnlocked?: number;
  readonly unlockedCharacters?: readonly string[];
}

/** Minimal save-like shape accepted by `resolveSelectedCharacter`. */
export interface CharacterSelectionSource extends CharacterUnlockSource {
  readonly selectedCharacter?: unknown;
}

/** Ordered data-driven roster of all 4 playable characters. */
export const CHARACTER_ROSTER: readonly CharacterDef[] = [
  {
    id: 'ninja',
    name: 'Ninja',
    subtitle: 'Shuriken & kunai',
    animPrefix: 'player',
    portraitKey: 'icon.portrait-ninja',
    rigId: null,
    defaultLoadout: {
      weaponForm: 'projectile',
      attachmentItemId: null,
      defaultProjectileKey: 'fx.shuriken',
      attachmentSkillId: null,
    },
    unlockChapter: CHARACTERS_TUNING.ninja.unlockChapter,
    unlockGoldCost: CHARACTERS_TUNING.ninja.unlockGoldCost,
    weaponSummary: 'Balanced shuriken auto-fire (100 HP)',
    passiveName: 'Shadow Agility',
    passiveSummary: '+10% move speed & -15% Dash cooldown',
    signatureSkillId: 'shadow-barrage',
    signatureName: 'Shadow Barrage',
    signatureSummary: '10 piercing homing shadow shurikens in a fan',
  },
  {
    id: 'archer',
    name: 'Archer',
    subtitle: 'Hand bow · keen sight',
    animPrefix: 'archer',
    portraitKey: 'icon.portrait-archer',
    rigId: 'archer',
    defaultLoadout: {
      weaponForm: 'attachment',
      attachmentItemId: 'bow-hand',
      defaultProjectileKey: 'fx.arrow',
      attachmentSkillId: null,
    },
    unlockChapter: CHARACTERS_TUNING.archer.unlockChapter,
    unlockGoldCost: CHARACTERS_TUNING.archer.unlockGoldCost,
    weaponSummary: 'Fast long-range arrows (85 HP)',
    passiveName: 'Keen Sight',
    passiveSummary: '+1 pierce & +12% crit chance',
    signatureSkillId: 'piercing-volley',
    signatureName: 'Piercing Volley',
    signatureSummary: '7 high-speed piercing arrows in a focused fan',
  },
  {
    id: 'mage',
    name: 'Mage',
    subtitle: 'Hand staff · arcane nova',
    animPrefix: 'mage',
    portraitKey: 'icon.portrait-mage',
    rigId: 'mage',
    defaultLoadout: {
      weaponForm: 'attachment',
      attachmentItemId: 'staff-hand',
      defaultProjectileKey: 'fx.arcane-bolt',
      attachmentSkillId: null,
    },
    unlockChapter: CHARACTERS_TUNING.mage.unlockChapter,
    unlockGoldCost: CHARACTERS_TUNING.mage.unlockGoldCost,
    weaponSummary: 'Heavy long-range arcane bolts (85 HP)',
    passiveName: 'Arcane Attunement',
    passiveSummary: '-20% Active cooldown & +25% AoE/Active power',
    signatureSkillId: 'arcane-nova',
    signatureName: 'Arcane Nova',
    signatureSummary: 'Freezing radial arcane ring + 8 outward bolts',
  },
  {
    id: 'cultivator',
    name: 'Cultivator',
    subtitle: 'Back sword · sword heart',
    animPrefix: 'cultivator',
    portraitKey: 'icon.portrait-cultivator',
    rigId: 'cultivator',
    defaultLoadout: {
      weaponForm: 'attachment',
      attachmentItemId: 'sword-back',
      defaultProjectileKey: 'fx.spirit-sword',
      attachmentSkillId: 'ten-thousand-swords',
    },
    unlockChapter: CHARACTERS_TUNING.cultivator.unlockChapter,
    unlockGoldCost: CHARACTERS_TUNING.cultivator.unlockGoldCost,
    weaponSummary: 'Swift spirit blades & sturdy body (120 HP)',
    passiveName: 'Sword Heart',
    passiveSummary: '+15% damage & +10% execute bonus (<30% HP)',
    signatureSkillId: 'ten-thousand-swords',
    signatureName: 'Ten Thousand Swords',
    signatureSummary: '14 sweeping homing spirit blades (hides back sword)',
  },
];

/** Indexed lookup table from `CharacterId` to its `CharacterDef`. */
export const CHARACTERS: Readonly<Record<CharacterId, CharacterDef>> = {
  ninja: CHARACTER_ROSTER[0]!,
  archer: CHARACTER_ROSTER[1]!,
  mage: CHARACTER_ROSTER[2]!,
  cultivator: CHARACTER_ROSTER[3]!,
};

const CHARACTER_ID_SET: ReadonlySet<string> = new Set(CHARACTER_IDS);

/** Type guard checking whether `value` is a known `CharacterId`. */
export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && CHARACTER_ID_SET.has(value);
}

/** Look up a playable character by id. Typed `CharacterId` always resolves; unknown strings return `undefined`. */
export function getCharacter(id: CharacterId): CharacterDef;
export function getCharacter(id: string): CharacterDef | undefined;
export function getCharacter(id: string): CharacterDef | undefined {
  return isCharacterId(id) ? CHARACTERS[id] : undefined;
}

function isUnlockedByChapter(def: CharacterDef, save: CharacterUnlockSource): boolean {
  if (def.unlockChapter <= 0) return true;
  const chaptersUnlocked = save.chaptersUnlocked;
  if (typeof chaptersUnlocked !== 'number' || !Number.isFinite(chaptersUnlocked)) return false;
  return chaptersUnlocked >= def.unlockChapter + 1;
}

function isUnlockedByPurchase(def: CharacterDef, save: CharacterUnlockSource): boolean {
  return Array.isArray(save.unlockedCharacters) && save.unlockedCharacters.includes(def.id);
}

/**
 * Whether a character id is unlocked under `save`:
 * - Default (`unlockChapter === 0`, Ninja): always unlocked;
 * - Chapter clear milestone (`chaptersUnlocked >= unlockChapter + 1`);
 * - OR early Meta gold purchase (`save.unlockedCharacters.includes(id)`).
 */
export function isCharacterUnlocked(id: string, save: CharacterUnlockSource = {}): boolean {
  const def = getCharacter(id);
  if (def === undefined) return false;
  return isUnlockedByChapter(def, save) || isUnlockedByPurchase(def, save);
}

/** Human-readable unlock status or requirement for Character Select & Meta Shop UI. */
export function characterUnlockReason(
  id: string,
  save: CharacterUnlockSource = {},
  locale: Locale = getLocale(),
): string {
  const def = getCharacter(id);
  if (def === undefined) return t('charSelect.reasonUnknown', undefined, locale);
  if (def.unlockChapter <= 0) return t('charSelect.reasonDefault', undefined, locale);
  if (isUnlockedByChapter(def, save)) {
    return t('charSelect.reasonChapter', { chapter: def.unlockChapter }, locale);
  }
  if (isUnlockedByPurchase(def, save)) {
    return t('charSelect.reasonPurchased', undefined, locale);
  }
  return t(
    'charSelect.reasonLocked',
    { chapter: def.unlockChapter, cost: def.unlockGoldCost },
    locale,
  );
}

/** Return the ordered list of playable characters unlocked under `save`. */
export function getUnlockedCharacters(
  save: CharacterUnlockSource = {},
): readonly CharacterDef[] {
  return CHARACTER_ROSTER.filter((entry) => isCharacterUnlocked(entry.id, save));
}

/**
 * Resolve the active character for a save.
 * Falls back cleanly to `DEFAULT_CHARACTER_ID` (`ninja`) if `selectedCharacter` is missing,
 * unknown, corrupt, or still locked.
 */
export function resolveSelectedCharacter(save: CharacterSelectionSource = {}): CharacterDef {
  const candidate = save.selectedCharacter;
  if (isCharacterId(candidate) && isCharacterUnlocked(candidate, save)) {
    return CHARACTERS[candidate];
  }
  return CHARACTERS[DEFAULT_CHARACTER_ID];
}

/**
 * Build the primary manifest key and safe fallback key for a character's logical animation clip.
 */
export function characterAnimationKeys(
  character: CharacterDef,
  kind: CharacterAnimKind,
  direction: Direction = 'down',
): CharacterAnimKeys {
  const prefix = character.animPrefix;
  if (kind === 'dead') {
    return { key: `${prefix}.dead`, fallback: `${prefix}.idle.down` };
  }
  if (kind === 'idle') {
    return { key: `${prefix}.idle.${direction}`, fallback: `${prefix}.idle.down` };
  }
  return { key: `${prefix}.${kind}.${direction}`, fallback: `${prefix}.idle.${direction}` };
}

/**
 * Resolve a character animation clip against a loaded `AnimationManifest`, returning the
 * primary key when present or its fallback key when the clip is not yet staged.
 */
export function resolveCharacterAnimKey(
  manifest: AnimationManifest,
  character: CharacterDef,
  kind: CharacterAnimKind,
  direction: Direction = 'down',
): string {
  const { key, fallback } = characterAnimationKeys(character, kind, direction);
  if (manifest.sprites[key] !== undefined) return key;
  if (manifest.sprites[fallback] !== undefined) return fallback;
  return `${character.animPrefix}.idle.down`;
}

/** Manifest-verified 64×64 portrait sheet table (1:1 parity enforced by `art-files.test.ts`). */
export const HERO_PORTRAIT_SHEETS: Readonly<Record<CharacterId, string>> = {
  ninja: 'resources/art/generated/portraits/portrait-ninja.png',
  archer: 'resources/art/generated/portraits/portrait-archer.png',
  mage: 'resources/art/generated/portraits/portrait-mage.png',
  cultivator: 'resources/art/generated/portraits/portrait-cultivator.png',
};

/** Logical `animations.json` portrait key (`icon.portrait-<id>`) for a playable character, falling back to Ninja. */
export function characterPortraitKey(id: CharacterId | string | undefined): string {
  if (id !== undefined && isCharacterId(id)) {
    return CHARACTERS[id].portraitKey;
  }
  return DEFAULT_PORTRAIT_KEY;
}

/** Resolve a character's 64×64 `SpriteEntry` from `animations.json` with `icon.portrait-ninja` fallback. */
export function resolveCharacterPortraitEntry(
  manifest: AnimationManifest,
  id: CharacterId | string | undefined,
): SpriteEntry {
  return resolve(manifest, characterPortraitKey(id), DEFAULT_PORTRAIT_KEY);
}

/**
 * Resources sheet path for a character's 64×64 portrait (`animations.json` primary when `manifest`
 * is provided, falling back to the manifest-verified `HERO_PORTRAIT_SHEETS` table for standalone UI).
 */
export function characterPortraitSheet(
  id: CharacterId | string | undefined,
  manifest?: AnimationManifest | null,
): string {
  if (manifest !== undefined && manifest !== null) {
    return resolveCharacterPortraitEntry(manifest, id).sheet;
  }
  const resolvedId = id !== undefined && isCharacterId(id) ? id : DEFAULT_CHARACTER_ID;
  return HERO_PORTRAIT_SHEETS[resolvedId];
}
