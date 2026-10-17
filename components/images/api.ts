'use client';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

export { postJson } from '@/components/stories/api';

/** Localised message for an Image Studio / social post API error code. */
export function imageMessage(t: Dictionary, body: { error?: string }): string {
  if (body.error === 'rate_limited') return t.rateLimited;
  return (t.images.errors as Record<string, string>)[body.error ?? ''] ?? t.common.errorGeneric;
}
