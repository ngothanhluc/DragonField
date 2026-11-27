import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BOSS_IDS } from '../../assets/scripts/core/boss/boss-defs';
import { CHARACTER_IDS } from '../../assets/scripts/core/characters/roster';
import {
  DEFAULT_LOCALE,
  EN,
  SUPPORTED_LOCALES,
  VI,
  getLocale,
  isLocale,
  localeDisplayName,
  localizeBossDisplayName,
  localizeBossName,
  localizeCharacterField,
  localizeCharacterName,
  localizeDoorReward,
  localizeEnemyRole,
  localizeRarity,
  localizeSkillName,
  localizeUpgradeTrack,
  nextLocale,
  onLocaleChange,
  setLocale,
  t,
  type TranslationKey,
} from '../../assets/scripts/core/i18n';
import { UPGRADE_TRACKS } from '../../assets/scripts/core/meta/upgrades';
import { DOOR_REWARDS } from '../../assets/scripts/core/run/doors';
import { CLASS_EVOLUTIONS, CLASS_SKILLS } from '../../assets/scripts/core/skills/class-skills';
import { EVOLUTIONS } from '../../assets/scripts/core/skills/evolutions';
import { RARITIES, SKILLS } from '../../assets/scripts/core/skills/pool';
import { readTtfCodePoints } from './vietnamese-font.test';

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_PATH = join(HERE, '..', '..', 'assets', 'resources', 'art', 'ui', 'fonts', 'NormalFont.ttf');

function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
  return Array.from(new Set(matches)).sort();
}

describe('M16 core/i18n — dictionary parity, interpolation & locale switching', () => {
  afterEach(() => {
    setLocale(DEFAULT_LOCALE);
  });

  it('defaults to Vietnamese ("vi") and supports exactly ["vi", "en"]', () => {
    expect(DEFAULT_LOCALE).toBe('vi');
    expect(SUPPORTED_LOCALES).toEqual(['vi', 'en']);
    expect(getLocale()).toBe('vi');
    expect(isLocale('vi')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('jp')).toBe(false);
    expect(nextLocale('vi')).toBe('en');
    expect(nextLocale('en')).toBe('vi');
    expect(localeDisplayName('vi')).toBe('Tiếng Việt');
    expect(localeDisplayName('en')).toBe('English');
  });

  it('has 100% key parity, non-empty values, and matching interpolation placeholders between vi and en', () => {
    const enKeys = Object.keys(EN).sort();
    const viKeys = Object.keys(VI).sort();
    expect(viKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(150);

    for (const key of enKeys as TranslationKey[]) {
      expect(EN[key].trim().length, `EN["${key}"] empty`).toBeGreaterThan(0);
      expect(VI[key].trim().length, `VI["${key}"] empty`).toBeGreaterThan(0);
      expect(
        extractPlaceholders(VI[key]),
        `placeholder mismatch for key "${key}"`,
      ).toEqual(extractPlaceholders(EN[key]));
    }
  });

  it('every character in both vi and en dictionaries is present in NormalFont.ttf (zero missing glyphs)', () => {
    const codePoints = readTtfCodePoints(readFileSync(FONT_PATH));
    const missing: string[] = [];

    for (const [locale, dict] of [
      ['vi', VI],
      ['en', EN],
    ] as const) {
      for (const [key, value] of Object.entries(dict)) {
        for (const ch of value) {
          if (ch === '\n' || ch === '\r' || ch === '\t') continue;
          const cp = ch.codePointAt(0);
          if (cp !== undefined && !codePoints.has(cp)) {
            missing.push(`${locale}.${key}: U+${cp.toString(16).toUpperCase()} (${ch})`);
          }
        }
      }
    }

    expect(missing, `Unsupported glyphs found in i18n strings:\n${missing.join('\n')}`).toEqual([]);
  });

  it('interpolates parameters cleanly and leaves unknown tokens untouched', () => {
    expect(t('boss.phaseBanner', { phase: 2 }, 'vi')).toBe('GIAI ĐOẠN 2');
    expect(t('boss.phaseBanner', { phase: 2 }, 'en')).toBe('PHASE 2');
    expect(t('boss.enrageBanner', undefined, 'vi')).toBe('CUỒNG NỘ');
    expect(t('boss.enrageBanner', undefined, 'en')).toBe('ENRAGE');
    expect(t('chapter.name', { chapter: 3 }, 'vi')).toBe('Chương 3');
    expect(t('chapter.name', { chapter: 3 }, 'en')).toBe('Chapter 3');
    expect(t('chapter.name', {}, 'en')).toBe('Chapter {chapter}');
  });

  it('switches active locale live and notifies subscribers', () => {
    const seen: string[] = [];
    const unsubscribe = onLocaleChange((next) => seen.push(next));

    expect(t('settings.title')).toBe('CÀI ĐẶT');
    setLocale('en');
    expect(getLocale()).toBe('en');
    expect(t('settings.title')).toBe('SETTINGS');
    setLocale('en'); // no-op
    setLocale('vi');
    expect(t('settings.title')).toBe('CÀI ĐẶT');

    unsubscribe();
    setLocale('en');
    expect(seen).toEqual(['en', 'vi']);
  });

  it('localizes all 21 base skills, 7 Evolutions, 4 characters, 8 bosses, rarities, upgrades, doors, and roles', () => {
    for (const skill of SKILLS) {
      expect(localizeSkillName(skill.id, skill.name, 'vi').length).toBeGreaterThan(0);
      expect(localizeSkillName(skill.id, skill.name, 'en')).toBe(skill.name);
    }
    for (const evo of EVOLUTIONS) {
      expect(localizeSkillName(evo.id, evo.name, 'vi').length).toBeGreaterThan(0);
      expect(localizeSkillName(evo.id, evo.name, 'en')).toBe(evo.name);
    }
    for (const card of [...CLASS_SKILLS, ...CLASS_EVOLUTIONS]) {
      expect(localizeSkillName(card.id, card.name, 'vi').length, card.id).toBeGreaterThan(0);
      expect(localizeSkillName(card.id, card.name, 'en'), card.id).toBe(card.name);
    }
    for (const id of CHARACTER_IDS) {
      expect(localizeCharacterName(id, 'vi').length).toBeGreaterThan(0);
      expect(localizeCharacterField(id, 'weapon', 'vi').length).toBeGreaterThan(0);
      expect(localizeCharacterField(id, 'passiveName', 'vi').length).toBeGreaterThan(0);
      expect(localizeCharacterField(id, 'signatureName', 'vi').length).toBeGreaterThan(0);
    }
    for (const bossId of BOSS_IDS) {
      expect(localizeBossName(bossId, 'vi').length).toBeGreaterThan(0);
      expect(localizeBossName(bossId, 'en').length).toBeGreaterThan(0);
    }
    expect(localizeBossDisplayName('Giant Frog', 'vi')).toBe('Ếch Khổng Lồ');
    expect(localizeBossDisplayName('Tengu', 'vi')).toBe('Thiên Cẩu');
    for (const rarity of RARITIES) {
      expect(localizeRarity(rarity, 'vi').length).toBeGreaterThan(0);
    }
    for (const track of UPGRADE_TRACKS) {
      expect(localizeUpgradeTrack(track, 'vi').length).toBeGreaterThan(0);
    }
    for (const door of [...DOOR_REWARDS, 'boss' as const]) {
      expect(localizeDoorReward(door, 'vi').length).toBeGreaterThan(0);
    }
    for (const role of [
      'chaser',
      'caster',
      'tank',
      'sniper',
      'splitter',
      'splitling',
      'bomber',
      'buffer',
    ] as const) {
      expect(localizeEnemyRole(role, 'vi').length).toBeGreaterThan(0);
    }
  });
});
