'use client';
import { fmt } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

export interface StoryResponse<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  body: T & { error?: string; detail?: string; issues?: Array<Record<string, unknown>> };
}

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<StoryResponse<T>> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as StoryResponse<T>['body'] };
  } catch {
    return { ok: false, status: 0, body: { error: 'network' } as StoryResponse<T>['body'] };
  }
}

/** Localised message for a Story Engine API error. */
export function storyMessage(t: Dictionary, body: { error?: string; detail?: string }): string {
  if (body.error === 'rate_limited') return t.rateLimited;
  const template = (t.stories.errors as Record<string, string>)[body.error ?? ''];
  return template ? fmt(template, { detail: body.detail ?? '' }) : t.common.errorGeneric;
}

/** Localised message for one validation issue from lib/story/bible.ts. */
export function issueText(t: Dictionary, issue: Record<string, unknown>): string {
  const template = (t.stories.issues as Record<string, string>)[String(issue.code)] ?? String(issue.code);
  const index = typeof issue.index === 'number' ? issue.index + 1 : '';
  return fmt(template, { ...(issue as Record<string, string | number>), n: index });
}
