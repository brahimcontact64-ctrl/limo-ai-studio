import { parseCharacterId } from '@/lib/studio/limits';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

/** Localized "Limo · Boy" label derived from the stable id; falls back to the catalog name. */
export function characterLabel(t: Dictionary, id: string, fallback?: string): string {
  const p = parseCharacterId(id);
  if (!p) return fallback ?? id;
  return `${t.characters.family[p.family]} · ${t.characters.variant[p.variant]}`;
}

export function referenceLabel(t: Dictionary, status: string): string {
  return (t.characters.reference as Record<string, string>)[status] ?? status;
}
