import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { animationError } from '@/lib/animation/errors';
import { getBrandKit } from '@/lib/data/assets';
import { validateSocialInput, type SocialInput } from '@/lib/ai/jobs';

export const dynamic = 'force-dynamic';

/** Whether AI captions / images are switched on (for the composer and Image Studio buttons). */
export async function GET(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { data, error } = await untyped(await getSupabaseServer()).from('feature_flags').select('key, enabled').in('key', ['ai_social_text', 'ai_social_images', 'paid_generation']);
  if (error) return json({ text: false, images: false, paid: false });
  const f = Object.fromEntries(((data ?? []) as Array<{ key: string; enabled: boolean }>).map((x) => [x.key, x.enabled]));
  return json({ text: f.ai_social_text === true, images: f.ai_social_images === true, paid: f.paid_generation === true });
}

/**
 * Facebook Content Studio AI request: caption, rewrite or promotional image. The generator worker produces it
 * (mock or a real provider behind every gate); the customer then reviews and edits it. Brand Kit name, CTA, tone
 * and colours are added server-side from the workspace's own kit.
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org) return json({ error: 'no_workspace' }, 403);
  if (!guard.ctx.canEdit) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 20_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as { kind?: string; input?: SocialInput; idempotency_key?: string; confirm_cents?: number };
  const kind = b.kind as 'social_caption' | 'social_rewrite' | 'social_image';
  if (!['social_caption', 'social_rewrite', 'social_image'].includes(kind) || !b.input || typeof b.idempotency_key !== 'string' || !/^[A-Za-z0-9_-]{8,120}$/.test(b.idempotency_key)) return json({ error: 'invalid_request' }, 400);
  const problems = validateSocialInput(kind, b.input);
  if (problems.length) return json({ error: 'invalid_request', problems }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'social_ai', 60, 3600))) return json({ error: 'rate_limited' }, 429);
  const kit = await getBrandKit(supabase, org.organization_id);
  const k = kit as unknown as { brand_name?: string; default_cta?: string; tone?: string; primary_color?: string; secondary_color?: string } | null;
  const input: SocialInput = { ...b.input, brand: { name: k?.brand_name ?? '', cta: k?.default_cta ?? '', tone: k?.tone ?? '', primary: k?.primary_color ?? '', secondary: k?.secondary_color ?? '' } };
  const { data, error } = await callRpc(supabase, 'request_social_ai_job', { p_organization_id: org.organization_id, p_kind: kind, p_input: input, p_request_key: b.idempotency_key, p_confirmed_cents: Number.isInteger(b.confirm_cents) ? b.confirm_cents : 0 });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error) {
    const e = animationError(error.message);
    return json({ error: e.code }, e.status);
  }
  return json(data, 201);
}
