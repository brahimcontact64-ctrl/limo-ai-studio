import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { normalizeRules } from '@/lib/social/automation';
import { socialError } from '@/lib/social/errors';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/**
 * save {id?, name, rules}: every save is a new version and leaves the policy NOT active.
 * authorize {id, version, confirmed}: owner/admin turns on exactly that version (needs the platform flag).
 * pause / revoke {id}.
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org || !canEditOrg(guard.ctx, org.organization_id)) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 20_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const policyId = typeof b.id === 'string' && isUuid(b.id) ? b.id : null;
  const supabase = await getSupabaseServer();
  let res;
  if (b.action === 'save') {
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
    if (!name) return json({ error: 'name_required' }, 400);
    res = await callRpc<unknown>(supabase, 'save_automation_policy', { p_organization_id: org.organization_id, p_policy_id: policyId, p_name: name, p_rules: normalizeRules(b.rules) });
  } else if (b.action === 'authorize' && policyId) {
    res = await callRpc<unknown>(supabase, 'authorize_automation_policy', { p_policy_id: policyId, p_version: Number(b.version), p_confirmed: b.confirmed === true });
  } else if ((b.action === 'pause' || b.action === 'revoke') && policyId) {
    res = await callRpc<unknown>(supabase, 'set_automation_policy_state', { p_policy_id: policyId, p_state: b.action === 'pause' ? 'paused' : 'revoked' });
  } else return json({ error: 'invalid_action' }, 400);
  if (isMissingFunction(res.error)) return json({ error: 'unavailable' }, 501);
  if (res.error) {
    const e = socialError(res.error.message);
    return json({ error: e.code }, e.status);
  }
  return json(res.data);
}
