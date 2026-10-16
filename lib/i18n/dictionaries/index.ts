import type { Locale } from '../config';
import en, { type Dictionary } from './en';
import fr from './fr';
import ar from './ar';
import de from './de';

const dictionaries: Record<Locale, Dictionary> = { en, fr, ar, de };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export type { Dictionary };
