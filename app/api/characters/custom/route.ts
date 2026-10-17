import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { buildCustomSpec, parseCustomCharacter } from '@/lib/characters/custom';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Create (no id) or update a workspace character. The organisation comes from the row or the active workspace. */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const read = await readJson(request, 16_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const parsed = parseCustomCharacter(read.body);
  if (!parsed.ok) return json({ error: parsed.issue }, 400);
  const id = (read.body as { id?: unknown }).id;
  if (id !== undefined && id !== null && !isUuid(id)) return json({ error: 'not_found' }, 404);

  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'save_character', 60, 3600))) return json({ error: 'rate_limited' }, 429);
  let organizationId: string | undefined;
  if (typeof id === 'string') {
    const { data } = await untyped(supabase).from('characters').select('organization_id').eq('id', id).maybeSingle();
    organizationId = (data as { organization_id?: string } | null)?.organization_id;
    if (!organizationId) return json({ error: 'not_found' }, 404);
  } else {
    organizationId = guard.ctx.org?.organization_id;
    if (!organizationId) return json({ error: 'no_workspace' }, 403);
  }
  if (!canEditOrg(guard.ctx, organizationId)) return json({ error: 'not_authorized' }, 403);

  const v = parsed.value;
  const { data, error } = await callRpc<string>(supabase, 'save_custom_character', {
    p_organization_id: organizationId,
    p_character_id: typeof id === 'string' ? id : null,
    p_name: v.name,
    p_description: v.description,
    p_base_family: v.base_family,
    p_age_group: v.age_group,
    p_gender_code: v.gender_code,
    p_spec: buildCustomSpec(v),
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const m = error?.message ?? '';
    if (/at most 50/i.test(m)) return json({ error: 'limit_reached' }, 422);
    if (/not authorized|not found/i.test(m)) return json({ error: 'not_authorized' }, 403);
    return json({ error: 'failed' }, 422);
  }
  return json({ id: data }, typeof id === 'string' ? 200 : 201);
}
