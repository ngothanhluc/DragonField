/**
 * Pure TypeScript client-side localization runtime (`core/i18n/`, M16, ADR-024).
 *
 * - Zero `cc` or DOM imports.
 * - Default locale is `'vi'` (Vietnamese); `'en'` (English) is selectable in Settings.
 * - `t(key, params, locale?)` resolves typed keys with `{param}` interpolation.
 * - Domain helpers (`localizeSkillName`, `localizeCharacterField`, `localizeBossName`, etc.)
 *   keep entity data files clean while routing every player-facing label through `t(...)`.
 */
import type { BossId } from '../boss/boss-defs';
import type { CharacterId } from '../characters/roster';
import type { EnemyRole } from '../level/level-data';
import type { UpgradeTrack } from '../meta/upgrades';
import type { DoorReward } from '../run/doors';
import type { Rarity } from '../skills/pool';
import { EN, type TranslationKey } from './en';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isLocale,
  nextLocale,
  type Locale,
  type TranslationParams,
} from './types';
import { VI } from './vi';

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isLocale,
  nextLocale,
  EN,
  VI,
  type Locale,
  type TranslationKey,
  type TranslationParams,
};

const DICTIONARIES: Readonly<Record<Locale, Readonly<Record<TranslationKey, string>>>> = {
  vi: VI,
  en: EN,
};

export type LocaleChangeListener = (locale: Locale) => void;

let currentLocale: Locale = DEFAULT_LOCALE;
const listeners = new Set<LocaleChangeListener>();

/** Current active UI locale (`'vi'` by default). */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Switch the active UI locale and notify subscribed listeners (e.g. live open screens).
 * Non-supported inputs are ignored and the current locale is returned unchanged.
 */
export function setLocale(locale: Locale): Locale {
  if (!isLocale(locale)) return currentLocale;
  if (locale === currentLocale) return currentLocale;
  currentLocale = locale;
  for (const listener of Array.from(listeners)) {
    listener(locale);
  }
  return currentLocale;
}

/** Subscribe to active locale changes. Returns an unsubscribe callback. */
export function onLocaleChange(listener: LocaleChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Translate a typed key in `locale` (defaults to the active locale `getLocale()`),
 * interpolating `{name}` tokens from `params`.
 */
export function t(
  key: TranslationKey,
  params?: TranslationParams,
  locale: Locale = currentLocale,
): string {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
  const template = dict[key];
  if (params === undefined) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Display name of a locale (`Tiếng Việt` / `English`). */
export function localeDisplayName(locale: Locale): string {
  return t(locale === 'vi' ? 'locale.vi' : 'locale.en', undefined, locale);
}

const SKILL_KEYS: Readonly<Record<string, TranslationKey>> = {
  sharpen: 'skill.sharpen',
  'rapid-fire': 'skill.rapid-fire',
  'twin-shot': 'skill.twin-shot',
  piercing: 'skill.piercing',
  ricochet: 'skill.ricochet',
  homing: 'skill.homing',
  explosive: 'skill.explosive',
  'crit-eye': 'skill.crit-eye',
  freeze: 'skill.freeze',
  poison: 'skill.poison',
  ignite: 'skill.ignite',
  'chain-lightning': 'skill.chain-lightning',
  lifesteal: 'skill.lifesteal',
  vitality: 'skill.vitality',
  shield: 'skill.shield',
  swift: 'skill.swift',
  'phantom-dash': 'skill.phantom-dash',
  'dash-nova': 'skill.dash-nova',
  'shadow-conduit': 'skill.shadow-conduit',
  'arcane-surge': 'skill.arcane-surge',
  afterimage: 'skill.afterimage',
  'phantom-volley': 'evolution.phantom-volley',
  cataclysm: 'evolution.cataclysm',
  blightfrost: 'evolution.blightfrost',
  'starfall-kunai': 'evolution.starfall-kunai',
  'aegis-retribution': 'evolution.aegis-retribution',
  shadowstep: 'evolution.shadowstep',
  'tempest-barrage': 'evolution.tempest-barrage',

  // Class-exclusive skills & Class Evolutions (M20, ADR-027).
  'ninja-shadow-clone': 'skill.ninja-shadow-clone',
  'ninja-venom-shuriken': 'skill.ninja-venom-shuriken',
  'ninja-kunai-burst': 'skill.ninja-kunai-burst',
  'ninja-smoke-bomb': 'skill.ninja-smoke-bomb',
  'ninja-phantom-assassin': 'skill.ninja-phantom-assassin',
  'archer-arrow-rain': 'skill.archer-arrow-rain',
  'archer-split-arrow': 'skill.archer-split-arrow',
  'archer-hunters-mark': 'skill.archer-hunters-mark',
  'archer-wind-arrow': 'skill.archer-wind-arrow',
  'archer-sky-tempest': 'skill.archer-sky-tempest',
  'mage-meteor': 'skill.mage-meteor',
  'mage-frost-orbs': 'skill.mage-frost-orbs',
  'mage-storm-strike': 'skill.mage-storm-strike',
  'mage-arcane-pulse': 'skill.mage-arcane-pulse',
  'mage-elemental-cataclysm': 'skill.mage-elemental-cataclysm',
  'cultivator-orbit-swords': 'skill.cultivator-orbit-swords',
  'cultivator-sword-array': 'skill.cultivator-sword-array',
  'cultivator-sword-qi': 'skill.cultivator-sword-qi',
  'cultivator-qi-barrier': 'skill.cultivator-qi-barrier',
  'cultivator-myriad-swords': 'skill.cultivator-myriad-swords',
};

/** Class-exclusive card description keys (M20, ADR-027): they have no `tags` to derive text from. */
const SKILL_DESCRIPTION_KEYS: Readonly<Record<string, TranslationKey>> = {
  'ninja-shadow-clone': 'skill.desc.ninja-shadow-clone',
  'ninja-venom-shuriken': 'skill.desc.ninja-venom-shuriken',
  'ninja-kunai-burst': 'skill.desc.ninja-kunai-burst',
  'ninja-smoke-bomb': 'skill.desc.ninja-smoke-bomb',
  'ninja-phantom-assassin': 'skill.desc.ninja-phantom-assassin',
  'archer-arrow-rain': 'skill.desc.archer-arrow-rain',
  'archer-split-arrow': 'skill.desc.archer-split-arrow',
  'archer-hunters-mark': 'skill.desc.archer-hunters-mark',
  'archer-wind-arrow': 'skill.desc.archer-wind-arrow',
  'archer-sky-tempest': 'skill.desc.archer-sky-tempest',
  'mage-meteor': 'skill.desc.mage-meteor',
  'mage-frost-orbs': 'skill.desc.mage-frost-orbs',
  'mage-storm-strike': 'skill.desc.mage-storm-strike',
  'mage-arcane-pulse': 'skill.desc.mage-arcane-pulse',
  'mage-elemental-cataclysm': 'skill.desc.mage-elemental-cataclysm',
  'cultivator-orbit-swords': 'skill.desc.cultivator-orbit-swords',
  'cultivator-sword-array': 'skill.desc.cultivator-sword-array',
  'cultivator-sword-qi': 'skill.desc.cultivator-sword-qi',
  'cultivator-qi-barrier': 'skill.desc.cultivator-qi-barrier',
  'cultivator-myriad-swords': 'skill.desc.cultivator-myriad-swords',
};

/** Localized name of a base skill or Legendary Evolution (`fallback` used if unknown id). */
export function localizeSkillName(
  id: string,
  fallback: string = id,
  locale: Locale = currentLocale,
): string {
  const key = SKILL_KEYS[id];
  return key === undefined ? fallback : t(key, undefined, locale);
}

/** Localized mechanic text of a class-exclusive skill/Evolution, or `undefined` for shared cards. */
export function localizeSkillDescription(
  id: string,
  locale: Locale = currentLocale,
): string | undefined {
  const key = SKILL_DESCRIPTION_KEYS[id];
  return key === undefined ? undefined : t(key, undefined, locale);
}

export type CharacterTextField =
  | 'name'
  | 'subtitle'
  | 'weapon'
  | 'passiveName'
  | 'passiveSummary'
  | 'signatureName'
  | 'signatureSummary';

/** Localized text field for one of the 4 playable characters. */
export function localizeCharacterField(
  id: CharacterId,
  field: CharacterTextField,
  locale: Locale = currentLocale,
): string {
  const key = `char.${id}.${field}` as TranslationKey;
  return t(key, undefined, locale);
}

/** Localized display name for a playable character. */
export function localizeCharacterName(
  id: CharacterId,
  locale: Locale = currentLocale,
): string {
  return localizeCharacterField(id, 'name', locale);
}

const BOSS_KEYS: Readonly<Record<BossId, TranslationKey>> = {
  tengu: 'boss.tengu',
  squid: 'boss.squid',
  samurai: 'boss.samurai',
  frog: 'boss.frog',
  slime: 'boss.slime',
  bamboo: 'boss.bamboo',
  racoon: 'boss.racoon',
  redtengu: 'boss.redtengu',
};

/** Localized display name of a boss id. */
export function localizeBossName(id: BossId, locale: Locale = currentLocale): string {
  return t(BOSS_KEYS[id], undefined, locale);
}

/** Lookup localized boss name from an English displayName or BossId (for HUD compatibility). */
const BOSS_ID_BY_ENGLISH: Readonly<Record<string, BossId>> = {
  tengu: 'tengu',
  squid: 'squid',
  samurai: 'samurai',
  'giant frog': 'frog',
  'giant slime': 'slime',
  'giant bamboo': 'bamboo',
  'giant racoon': 'racoon',
  'red tengu': 'redtengu',
};

export function localizeBossDisplayName(
  nameOrId: string,
  locale: Locale = currentLocale,
): string {
  const lowered = nameOrId.trim().toLowerCase();
  const id = BOSS_ID_BY_ENGLISH[lowered] ?? (lowered in BOSS_KEYS ? (lowered as BossId) : undefined);
  return id === undefined ? nameOrId : localizeBossName(id, locale);
}

const ENEMY_ROLE_KEYS: Readonly<Record<EnemyRole, TranslationKey>> = {
  chaser: 'enemy.chaser',
  caster: 'enemy.caster',
  tank: 'enemy.tank',
  sniper: 'enemy.sniper',
  splitter: 'enemy.splitter',
  splitling: 'enemy.splitling',
  bomber: 'enemy.bomber',
  buffer: 'enemy.buffer',
  dasher: 'enemy.dasher',
  gunner: 'enemy.gunner',
};

export function localizeEnemyRole(role: EnemyRole, locale: Locale = currentLocale): string {
  const key = ENEMY_ROLE_KEYS[role];
  return key === undefined ? t('enemy.fallback', undefined, locale) : t(key, undefined, locale);
}

const RARITY_KEYS: Readonly<Record<Rarity, TranslationKey>> = {
  common: 'rarity.common',
  rare: 'rarity.rare',
  epic: 'rarity.epic',
  legendary: 'rarity.legendary',
};

export function localizeRarity(rarity: Rarity, locale: Locale = currentLocale): string {
  return t(RARITY_KEYS[rarity], undefined, locale);
}

const UPGRADE_KEYS: Readonly<Record<UpgradeTrack, TranslationKey>> = {
  hearts: 'upgrade.hearts',
  damage: 'upgrade.damage',
  fireRate: 'upgrade.fireRate',
  xpMagnet: 'upgrade.xpMagnet',
  goldBonus: 'upgrade.goldBonus',
  freeRerolls: 'upgrade.freeRerolls',
};

export function localizeUpgradeTrack(track: UpgradeTrack, locale: Locale = currentLocale): string {
  return t(UPGRADE_KEYS[track], undefined, locale);
}

const DOOR_KEYS: Readonly<Record<DoorReward, TranslationKey>> = {
  xp: 'door.xp',
  gold: 'door.gold',
  heal: 'door.heal',
  shop: 'door.shop',
  chest: 'door.chest',
  boss: 'door.boss',
};

export function localizeDoorReward(reward: DoorReward, locale: Locale = currentLocale): string {
  return t(DOOR_KEYS[reward], undefined, locale);
}
