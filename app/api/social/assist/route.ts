import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { expandText, mockTranslate, rewriteText, shortenText, toneText } from '@/lib/ai/script';
import { POST_LANGUAGES, POST_TONES, type PostTone } from '@/lib/social/types';

export const dynamic = 'force-dynamic';

const ACTIONS = ['rewrite', 'shorten', 'expand', 'tone', 'translate'] as const;

/**
 * Mock AI rewrite of ONE paragraph the customer selected. Returns a proposal only; the composer shows
 * it next to the original and the customer accepts or rejects it. Mock translations are marked
 * "[Mock translation → XX]", which keeps the post from being approved until a person rewrites it.
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.canEdit) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 20_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const text = typeof b.text === 'string' ? b.text.slice(0, 2000) : '';
  const action = b.action as (typeof ACTIONS)[number];
  const language = (POST_LANGUAGES as readonly string[]).includes(b.language as string) ? (b.language as string) : 'en';
  if (!text.trim() || !ACTIONS.includes(action)) return json({ error: 'invalid_request' }, 400);
  if (action === 'translate' && !(POST_LANGUAGES as readonly string[]).includes(b.target as string)) return json({ error: 'invalid_request' }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'social_assist', 120, 3600))) return json({ error: 'rate_limited' }, 429);
  const tone = ((POST_TONES as readonly string[]).includes(b.tone as string) ? b.tone : 'friendly') as PostTone;
  const out =
    action === 'rewrite' ? rewriteText(text, language)
    : action === 'shorten' ? shortenText(text)
    : action === 'expand' ? expandText(text, '[Add one more detail]') // never invented: a placeholder the customer fills in
    : action === 'tone' ? toneText(text, tone, language)
    : mockTranslate(text, b.target as string);
  return json({ provider: 'mock', text: out });
}
