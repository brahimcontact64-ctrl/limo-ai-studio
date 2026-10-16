import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_META, isLocale, type Locale } from './config';
import { getDictionary } from './dictionaries';

export const getLocale = cache(async (): Promise<Locale> => {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
});

export const getI18n = cache(async () => {
  const locale = await getLocale();
  return { locale, dir: LOCALE_META[locale].dir, intl: LOCALE_META[locale].intl, t: getDictionary(locale) };
});
