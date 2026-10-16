export const LOCALES = ['en', 'fr', 'ar', 'de'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'limo_locale';

export const LOCALE_META: Record<Locale, { label: string; native: string; dir: 'ltr' | 'rtl'; intl: string }> = {
  en: { label: 'English', native: 'English', dir: 'ltr', intl: 'en-GB' },
  fr: { label: 'French', native: 'Français', dir: 'ltr', intl: 'fr-FR' },
  ar: { label: 'Arabic', native: 'العربية', dir: 'rtl', intl: 'ar' },
  de: { label: 'German', native: 'Deutsch', dir: 'ltr', intl: 'de-DE' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { base: tag.toLowerCase().split('-')[0] ?? '', q: q ? Number(q.split('=')[1]) || 0 : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { base } of ranked) if (isLocale(base)) return base;
  return DEFAULT_LOCALE;
}

/** Replaces {name} placeholders. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}
