'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { LOCALE_META, type Locale } from './config';
import type { Dictionary } from './dictionaries/en';

interface I18nValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  intl: string;
  t: Dictionary;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, dictionary, children }: { locale: Locale; dictionary: Dictionary; children: ReactNode }) {
  const value = useMemo(
    () => ({ locale, dir: LOCALE_META[locale].dir, intl: LOCALE_META[locale].intl, t: dictionary }),
    [locale, dictionary],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
