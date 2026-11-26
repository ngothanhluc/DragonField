/**
 * Localization types and constants (M16, ADR-024).
 *
 * Pure TypeScript — zero `cc` imports, unit-tested in vitest.
 * Vietnamese (`'vi'`) is the default locale; English (`'en'`) is toggleable in Settings.
 */

export const SUPPORTED_LOCALES = ['vi', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Default player-facing locale for fresh saves and migrated v5 saves (ADR-024). */
export const DEFAULT_LOCALE: Locale = 'vi';

/** Interpolation parameter values accepted by `t(key, params)`. */
export type TranslationParams = Readonly<Record<string, string | number>>;

/** Type guard checking whether `value` is a supported `Locale`. */
export function isLocale(value: unknown): value is Locale {
  return value === 'vi' || value === 'en';
}

/** Toggle between `'vi'` and `'en'`. */
export function nextLocale(current: Locale): Locale {
  return current === 'vi' ? 'en' : 'vi';
}
