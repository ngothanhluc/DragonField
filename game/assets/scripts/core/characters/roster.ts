/**
 * Data-driven playable character roster (GDD §14, M10).
 *
 * Pure TS — no `cc` import, testable with vitest.
 *
 * Each entry describes a playable body sheet and its default visual weapon loadout:
 * - **Ninja** (`ninja`, default): existing NinjaGreen sheet (`player.*`), projectile weapons only
 *   (`attachmentItemId: null` — projectile weapons never create an attachment node).
 * - **Cultivator** (`cultivator`): unarmed body (`cultivator.*`) + worn `back` sword
 *   (`sword-back` in `attachments.json`), gated behind `settings.cultivatorEnabled` until
 *   acceptance is complete (M10 work item 5).
 *
 * **No balance stat overrides:** a different body must not change hitbox, damage, fire rate,
 * movement speed, or spawn numbers (`tuning.json` stays untouched).
 */
import type { AnimationManifest, Direction } from '../art/manifest';

/** Playable character identifiers in roster display order. */
export const CHARACTER_IDS = ['ninja', 'cultivator'] as const;

/** Union of all known playable character IDs. */
export type CharacterId = (typeof CHARACTER_IDS)[number];

/** Default playable character (NinjaGreen stays default until migrated characters pass acceptance). */
export const DEFAULT_CHARACTER_ID: CharacterId = 'ninja';

/**
 * Visual weapon form (GDD §14).
 * - `projectile`: spawned per shot as an FX sprite, never attached to the body.
 * - `attachment`: separate sprite mounted on the body's `hand` or `back` point.
 */
export type WeaponForm = 'projectile' | 'attachment';

/**
 * Default visual weapon loadout for a playable character.
 * Intentionally carries no combat stat modifiers.
 */
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

/** Settings/data flags controlling gated roster entries. */
export interface CharacterFeatureFlags {
  readonly cultivatorEnabled: boolean;
}

/** Key of `CharacterFeatureFlags` that gates a character. */
export type CharacterFeatureFlag = keyof CharacterFeatureFlags;

/** Logical player animation clips requested by the player controller. */
export type CharacterAnimKind = 'idle' | 'walk' | 'attack' | 'hit' | 'dead' | 'dash';

/** Primary manifest key plus a guaranteed-present fallback key for a character animation. */
export interface CharacterAnimKeys {
  readonly key: string;
  readonly fallback: string;
}

/** Data-driven definition of one playable character. */
export interface CharacterDef {
  readonly id: CharacterId;
  readonly name: string;
  readonly subtitle: string;
  /** Prefix in `animations.json` (`'player'` for NinjaGreen, `'cultivator'` for Cultivator). */
  readonly animPrefix: string;
  /**
   * Character id in `attachments.json` (`characters[rigId]`), or `null` when the character
   * has no attachment rig (baked / projectile-only body).
   */
  readonly rigId: string | null;
  readonly defaultLoadout: CharacterLoadout;
  /**
   * Optional settings flag required to unlock/select this character.
   * `null` means always available.
   */
  readonly featureFlag: CharacterFeatureFlag | null;
}

/** Minimal save-like shape accepted by `resolveSelectedCharacter` (avoids circular imports). */
export interface CharacterSelectionSource {
  readonly selectedCharacter?: unknown;
  readonly settings?: Partial<CharacterFeatureFlags>;
}

/** Ordered data-driven roster of all playable characters. */
export const CHARACTER_ROSTER: readonly CharacterDef[] = [
  {
    id: 'ninja',
    name: 'Ninja',
    subtitle: 'Shuriken & kunai',
    animPrefix: 'player',
    rigId: null,
    defaultLoadout: {
      weaponForm: 'projectile',
      attachmentItemId: null,
      defaultProjectileKey: 'fx.shuriken',
      attachmentSkillId: null,
    },
    featureFlag: null,
  },
  {
    id: 'cultivator',
    name: 'Cultivator',
    subtitle: 'Unarmed body · back sword',
    animPrefix: 'cultivator',
    rigId: 'cultivator',
    defaultLoadout: {
      weaponForm: 'attachment',
      attachmentItemId: 'sword-back',
      defaultProjectileKey: 'fx.kunai',
      attachmentSkillId: 'ten-thousand-swords',
    },
    featureFlag: 'cultivatorEnabled',
  },
];

/** Indexed lookup table from `CharacterId` to its `CharacterDef`. */
export const CHARACTERS: Readonly<Record<CharacterId, CharacterDef>> = {
  ninja: CHARACTER_ROSTER[0]!,
  cultivator: CHARACTER_ROSTER[1]!,
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

/** Whether a character id exists in the roster and passes its feature-flag gate. */
export function isCharacterAvailable(
  id: string,
  flags: Partial<CharacterFeatureFlags> = {},
): boolean {
  const def = getCharacter(id);
  if (def === undefined) return false;
  if (def.featureFlag === null) return true;
  return flags[def.featureFlag] === true;
}

/** Return the ordered list of playable characters unlocked under `flags`. */
export function getAvailableCharacters(
  flags: Partial<CharacterFeatureFlags> = {},
): readonly CharacterDef[] {
  return CHARACTER_ROSTER.filter((entry) => isCharacterAvailable(entry.id, flags));
}

/**
 * Resolve the active character for a save.
 * Falls back cleanly to `DEFAULT_CHARACTER_ID` (`ninja`) if `selectedCharacter` is missing,
 * unknown, corrupt, or gated off by its feature flag.
 */
export function resolveSelectedCharacter(save: CharacterSelectionSource): CharacterDef {
  const candidate = save.selectedCharacter;
  if (isCharacterId(candidate) && isCharacterAvailable(candidate, save.settings)) {
    return CHARACTERS[candidate];
  }
  return CHARACTERS[DEFAULT_CHARACTER_ID];
}

/**
 * Build the primary manifest key and safe fallback key for a character's logical animation clip.
 * Characters that only have `idle` staged so far (like Cultivator) fall back to their own
 * directional `idle` clip rather than breaking or morphing into another character's sprite.
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
