import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { normalizeDoc } from '@/lib/images/doc';
import { imageError } from '@/lib/images/errors';
import { ASPECTS, EMPTY_BRIEF, IMAGE_PURPOSES, IMAGE_STYLES, type Aspect } from '@/lib/images/types';
import { parseBrief } from '@/lib/images/brief';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

const S = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Create (no id) or save an image project. The organisation comes from the row or the active workspace. */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const read = await readJson(request, 600_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const aspect = b.aspect as Aspect;
  if (!(ASPECTS as readonly string[]).includes(aspect) || !(IMAGE_PURPOSES as readonly string[]).includes(b.purpose as string)) return json({ error: 'invalid_request' }, 400);
  const title = S(b.title, 200).trim();
  if (!title) return json({ error: 'title_required' }, 400);
  const id = typeof b.id === 'string' && isUuid(b.id) ? b.id : null;

  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'image_save', 240, 3600))) return json({ error: 'rate_limited' }, 429);
  let organizationId = guard.ctx.org?.organization_id;
  if (id) {
    const { data } = await untyped(supabase).from('image_projects').select('organization_id').eq('id', id).maybeSingle();
    organizationId = (data as { organization_id?: string } | null)?.organization_id;
    if (!organizationId) return json({ error: 'not_found' }, 404);
  }
  if (!organizationId) return json({ error: 'no_workspace' }, 403);
  if (!canEditOrg(guard.ctx, organizationId)) return json({ error: 'not_authorized' }, 403);

  const { data, error } = await callRpc<Record<string, unknown>>(supabase, 'save_image_project', {
    p_organization_id: organizationId,
    p_project_id: id,
    p_base_updated_at: typeof b.base_updated_at === 'string' ? b.base_updated_at : null,
    p_title: title,
    p_purpose: b.purpose,
    p_aspect: aspect,
    p_style: (IMAGE_STYLES as readonly string[]).includes(b.style as string) ? b.style : 'modern',
    p_prompt: S(b.prompt, 4000),
    p_brief: b.brief ? parseBrief(b.brief) : EMPTY_BRIEF,
    p_document: normalizeDoc(b.document, aspect),
    p_source: b.source === 'autosave' || b.source === 'mock_generation' ? b.source : 'manual',
    p_label: S(b.label, 200) || null,
    p_series_id: typeof b.series_id === 'string' && isUuid(b.series_id) ? b.series_id : null,
    p_source_project_id: typeof b.source_project_id === 'string' && isUuid(b.source_project_id) ? b.source_project_id : null,
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = imageError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data, id ? 200 : 201);
}
