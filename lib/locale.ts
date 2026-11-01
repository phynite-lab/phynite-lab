export type Locale = 'en' | 'id';
export type LocalePreference = Locale | 'auto';
export const LOCALE_STORAGE_KEY = 'phynite:language';

export function localePreference(value: unknown): LocalePreference {
  return value === 'en' || value === 'id' ? value : 'auto';
}

export function resolveLocale(preference: LocalePreference, languages: readonly string[], country?: string): Locale {
  if (preference !== 'auto') return preference;
  for (const language of languages) {
    const primary = language.toLowerCase().split(/[-_]/)[0];
    if (primary === 'id' || primary === 'in') return 'id';
    if (primary === 'en') return 'en';
  }
  return country?.toUpperCase() === 'ID' ? 'id' : 'en';
}

export function acceptedLanguages(header: string): string[] {
  return header.split(',').map((entry, index) => {
    const [language, ...parameters] = entry.trim().split(';');
    const quality = parameters.find(value => value.trim().startsWith('q='));
    return { language, quality: quality ? Number(quality.trim().slice(2)) : 1, index };
  }).filter(entry => entry.language && entry.quality > 0 && entry.quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index).map(entry => entry.language);
}
