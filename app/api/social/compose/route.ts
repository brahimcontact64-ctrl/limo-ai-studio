import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { untyped } from '@/lib/supabase/rpc';
import { getBrandKit } from '@/lib/data/assets';
import { listVideoCandidates } from '@/lib/data/social';
import { composePost } from '@/lib/social/compose';
import { isValidTimeZone } from '@/lib/social/schedule';
import { BUSINESS_TYPES, EMPTY_FACTS, POST_LANGUAGES, POST_TONES, type BusinessType, type MediaCandidate, type PostFacts, type PostLanguage, type PostTone } from '@/lib/social/types';

export const dynamic = 'force-dynamic';

const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => ((list as readonly unknown[]).includes(v) ? (v as T) : d);

/**
 * Mock AI composer. Paid AI is disabled: this returns deterministic drafts written only from the
 * customer's request and the facts they typed (missing facts become blocking [placeholders]). Nothing
 * is saved here; the customer accepts or rejects each suggestion in the composer.
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org) return json({ error: 'no_workspace' }, 403);
  if (!guard.ctx.canEdit) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 20_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim().slice(0, 2000) : '';
  if (!prompt) return json({ error: 'prompt_required' }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'social_compose', 60, 3600))) return json({ error: 'rate_limited' }, 429);

  const rawFacts = (b.facts ?? {}) as Record<string, unknown>;
  const facts = Object.fromEntries(Object.keys(EMPTY_FACTS).map((k) => [k, typeof rawFacts[k] === 'string' ? (rawFacts[k] as string).trim().slice(0, 200) : ''])) as unknown as PostFacts;
  const kit = await getBrandKit(supabase, org.organization_id);
  // Approved media of this workspace only (RLS + organisation filter).
  const { data: designs } = await untyped(supabase).from('image_projects').select('id, title, status, updated_at').eq('organization_id', org.organization_id).order('updated_at', { ascending: false }).limit(30);
  const media: MediaCandidate[] = [
    ...((designs ?? []) as Array<{ id: string; title: string; status: string; updated_at: string }>).map((d) => ({ kind: 'image' as const, id: d.id, title: d.title, approved: d.status === 'approved', created_at: d.updated_at })),
    ...(await listVideoCandidates(supabase, org.organization_id)).map((v) => ({ kind: 'video' as const, id: v.id, title: v.title, approved: v.approved, created_at: v.completed_at })),
  ];
  const result = composePost({
    prompt,
    business_type: pick<BusinessType>(BUSINESS_TYPES, b.business_type, 'other'),
    tone: pick<PostTone>(POST_TONES, b.tone, (POST_TONES as readonly string[]).includes(kit?.tone ?? '') ? (kit!.tone as PostTone) : 'friendly'),
    language: pick<PostLanguage>(POST_LANGUAGES, b.language, 'en'),
    brand: { name: kit?.brand_name ?? '', cta: kit?.default_cta ?? '' },
    facts: { ...facts, business_name: facts.business_name || kit?.brand_name || '' },
    media,
    timezone: typeof b.timezone === 'string' && isValidTimeZone(b.timezone) ? b.timezone : 'UTC',
    now: new Date(),
  });
  return json(result);
}
