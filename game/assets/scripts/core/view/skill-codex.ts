/**
 * Character Detail & Skill Codex view-model (M20, GDD `docs/gdd/m19-m20-class-skills-and-art.md` §4).
 *
 * Pure TS — zero `cc` imports, testable with vitest. Turns the roster + class-skill + tuning data
 * into one flat, UI-ready view per class: base stats, Nội Tại (passive), Tuyệt Kỹ `[E]`
 * (signature active) with its base cooldown, the 4 class-exclusive skills and the Class Evolution
 * recipe, plus the current lock state. Locked classes stay fully inspectable.
 *
 * The Cocos adapter (`game/screens/character-select-screen.ts`) only renders these fields; it
 * never reads roster/skill data for display text.
 */
import {
  CHARACTERS,
  CHARACTER_IDS,
  characterUnlockReason,
  isCharacterUnlocked,
  resolveSelectedCharacter,
  type CharacterDef,
  type CharacterId,
} from '../characters/roster';
import { CHARACTERS_TUNING } from '../enemies/tuning';
import { localizeCharacterField, localizeSkillName, t, type Locale } from '../i18n';
import { applyCharacterBaseStats } from '../meta/run-stats';
import { DEFAULT_COMBAT } from '../config';
import type { SaveData } from '../save/save-data';
import { classEvolutionFor, classSkillsFor } from '../skills/class-skills';
import { describeSkill } from '../skills/description';
import { skillIconSheet } from '../skills/icons';
import type { Rarity, SkillDef } from '../skills/pool';

/** Lock state of a class in the Codex. */
export type CodexLockStatus = 'selected' | 'unlocked' | 'locked';

/** Weapon attachment form shown by the live preview and the stats block. */
export type CodexWeaponForm = 'projectile' | 'hand' | 'back';

/** One class-exclusive skill or Class Evolution card. */
export interface CodexSkillEntry {
  readonly id: string;
  /** Localized skill name. */
  readonly name: string;
  /** Localized mechanic text (same text the 1-of-3 pick card shows). */
  readonly description: string;
  /** Resources path of the 24×24 icon (`skillIconSheet(id)`). */
  readonly iconSheet: string;
  readonly rarity: Rarity;
  readonly maxStacks: number;
}

/** One ingredient of the Evolution recipe, localized. */
export interface CodexRecipeIngredient {
  readonly id: string;
  readonly name: string;
}

export interface CodexEvolutionEntry extends CodexSkillEntry {
  /** The two class skills that unlock this Evolution, in the Evolution's `requires` order. */
  readonly recipe: readonly [CodexRecipeIngredient, CodexRecipeIngredient];
}

export interface CharacterCodexView {
  readonly id: CharacterId;
  readonly name: string;
  /** `icon.portrait-<id>` manifest key for the 64×64 portrait. */
  readonly portraitKey: string;
  readonly lock: {
    readonly status: CodexLockStatus;
    readonly unlocked: boolean;
    /** Localized unlock status / requirement (`characterUnlockReason`). */
    readonly reason: string;
  };
  readonly stats: {
    /** Base max HP before meta upgrades. */
    readonly maxHp: number;
    readonly weaponForm: CodexWeaponForm;
    /** Base auto-fire shots per second before meta upgrades and skills. */
    readonly attacksPerSecond: number;
    /** Localized one-line weapon summary. */
    readonly weaponLine: string;
  };
  readonly passive: {
    readonly heading: string;
    readonly name: string;
    readonly description: string;
  };
  readonly active: {
    readonly heading: string;
    readonly key: 'E';
    readonly name: string;
    readonly description: string;
    /** Base Signature cooldown from tuning (before the Mage passive's multiplier). */
    readonly cooldownMs: number;
    /** Localized cooldown text, e.g. `10s`. */
    readonly cooldownLabel: string;
  };
  readonly exclusives: {
    readonly heading: string;
    readonly skills: readonly CodexSkillEntry[];
    readonly evolution: CodexEvolutionEntry;
  };
}

/** `10 000 ms → "10s"`, `9 500 ms → "9.5s"`. */
export function formatCooldownLabel(cooldownMs: number): string {
  const seconds = cooldownMs / 1000;
  const rounded = Number.isInteger(seconds) ? seconds : Math.round(seconds * 10) / 10;
  return `${rounded}s`;
}

/** Weapon form from the roster loadout: projectile, or the attachment's mount point. */
function weaponFormOf(character: CharacterDef): CodexWeaponForm {
  if (character.defaultLoadout.weaponForm === 'projectile') return 'projectile';
  const itemId = character.defaultLoadout.attachmentItemId ?? '';
  if (itemId.endsWith('-back')) return 'back';
  return 'hand';
}

function skillEntry(def: SkillDef, locale: Locale): CodexSkillEntry {
  return {
    id: def.id,
    name: localizeSkillName(def.id, def.name, locale),
    description: describeSkill(def, locale),
    iconSheet: skillIconSheet(def.id),
    rarity: def.rarity,
    maxStacks: def.maxStacks,
  };
}

/** Build the Codex view for one class. `save` only affects the lock state. */
export function buildCharacterCodex(
  id: CharacterId,
  save: SaveData,
  locale: Locale,
): CharacterCodexView {
  const character = CHARACTERS[id];
  const unlocked = isCharacterUnlocked(id, save);
  const status: CodexLockStatus = !unlocked
    ? 'locked'
    : resolveSelectedCharacter(save).id === id
      ? 'selected'
      : 'unlocked';
  const baseStats = applyCharacterBaseStats(DEFAULT_COMBAT, id);

  const evolutionDef = classEvolutionFor(id);
  const evolution = skillEntry(evolutionDef, locale);
  const recipeIds = evolutionDef.requires ?? [evolutionDef.id, evolutionDef.id];
  const recipe = [
    { id: recipeIds[0], name: localizeSkillName(recipeIds[0], recipeIds[0], locale) },
    { id: recipeIds[1], name: localizeSkillName(recipeIds[1], recipeIds[1], locale) },
  ] as const;

  return {
    id,
    name: localizeCharacterField(id, 'name', locale),
    portraitKey: character.portraitKey,
    lock: {
      status,
      unlocked,
      reason: characterUnlockReason(id, save, locale),
    },
    stats: {
      maxHp: baseStats.playerBaseMaxHp ?? DEFAULT_COMBAT.playerBaseMaxHp,
      weaponForm: weaponFormOf(character),
      attacksPerSecond: baseStats.fireRatePerSecond,
      weaponLine: localizeCharacterField(id, 'weapon', locale),
    },
    passive: {
      heading: t('codex.passiveHeading', undefined, locale),
      name: localizeCharacterField(id, 'passiveName', locale),
      description: localizeCharacterField(id, 'passiveSummary', locale),
    },
    active: {
      heading: t('codex.activeHeading', undefined, locale),
      key: 'E',
      name: localizeCharacterField(id, 'signatureName', locale),
      description: localizeCharacterField(id, 'signatureSummary', locale),
      cooldownMs: CHARACTERS_TUNING[id].signature.cooldownMs,
      cooldownLabel: formatCooldownLabel(CHARACTERS_TUNING[id].signature.cooldownMs),
    },
    exclusives: {
      heading: t('codex.exclusiveHeading', undefined, locale),
      skills: classSkillsFor(id).map((def) => skillEntry(def, locale)),
      evolution: { ...evolution, recipe },
    },
  };
}

/** Build the Codex for the whole roster, in roster display order. */
export function buildSkillCodex(
  save: SaveData,
  locale: Locale,
): readonly CharacterCodexView[] {
  return CHARACTER_IDS.map((id) => buildCharacterCodex(id, save, locale));
}
