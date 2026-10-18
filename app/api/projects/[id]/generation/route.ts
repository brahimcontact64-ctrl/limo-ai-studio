import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { isUuid } from '@/lib/studio/validation';
import { generationError, proposalItems, type DecisionRow, type StageRow } from '@/lib/generation/proposals';

export const dynamic = 'force-dynamic';

/**
 * AI generation state of a project (Milestone 10): availability with the exact estimate the customer must confirm,
 * the latest run, and its proposals (generated media per scene) with short-lived signed previews.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const db = untyped(supabase);
  const { data: project } = await db.from('studio_projects').select('organization_id').eq('id', id).maybeSingle();
  if (!project) return json({ error: 'not_found' }, 404);
  const org = (project as { organization_id: string }).organization_id;
  const avail = await callRpc<Record<string, unknown>>(supabase, 'generation_availability', { p_project_id: id });
  const availability = isMissingFunction(avail.error) || avail.error || !avail.data ? { available: false, reason: 'unavailable' } : avail.data;
  const { data: run } = await db.from('generation_runs').select('id, status, estimated_cost_cents, actual_cost_cents, failure_code, created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  let items: ReturnType<typeof proposalItems> = [];
  const assets: Record<string, { url: string | null; label: string; mock: boolean; mime: string }> = {};
  if (run) {
    const r = run as { id: string };
    const { data: stages } = await db.from('generation_run_stages').select('stage_type, scene_number, status, output_asset_id, output_payload').eq('run_id', r.id);
    const { data: decisions } = await db.from('generation_proposal_decisions').select('scene_number, asset_id, decision').eq('run_id', r.id);
    items = proposalItems((stages ?? []) as StageRow[], (decisions ?? []) as DecisionRow[]);
    const ids = [...new Set(items.map((i) => i.asset_id))];
    if (ids.length) {
      const { data: rows } = await db.from('media_assets').select('id, bucket_id, object_path, label, mime_type, provenance').eq('organization_id', org).in('id', ids);
      const list = (rows ?? []) as Array<{ id: string; bucket_id: string; object_path: string; label: string | null; mime_type: string | null; provenance: { mock?: boolean } | null }>;
      const signed = list.length ? ((await supabase.storage.from('workspace-assets').createSignedUrls(list.map((a) => a.object_path), 600)).data ?? []) : [];
      list.forEach((a, i) => (assets[a.id] = { url: signed[i]?.signedUrl ?? null, label: a.label ?? '', mock: a.provenance?.mock === true, mime: a.mime_type ?? '' }));
    }
  }
  return json({ availability, run: run ?? null, items, assets, can_edit: canEditOrg(guard.ctx, org) });
}

/** Starts a generation after the customer confirmed the exact estimate (no paid call happens while disabled). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 2_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as { confirm_cents?: unknown; idempotency_key?: unknown };
  const key = typeof b.idempotency_key === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(b.idempotency_key) ? b.idempotency_key : null;
  if (!key || typeof b.confirm_cents !== 'number' || !Number.isInteger(b.confirm_cents)) return json({ error: 'invalid_request' }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'generation_request', 10, 3600))) return json({ error: 'rate_limited' }, 429);
  const avail = await callRpc<{ available: boolean; reason: string | null; estimate_cents?: number }>(supabase, 'generation_availability', { p_project_id: id });
  if (isMissingFunction(avail.error)) return json({ error: 'unavailable' }, 501);
  if (avail.error || !avail.data) return json({ error: generationError(avail.error?.message).code }, generationError(avail.error?.message).status);
  if (!avail.data.available) return json({ error: avail.data.reason ?? 'not_enabled' }, 409);
  if (avail.data.estimate_cents !== b.confirm_cents) return json({ error: 'estimate_changed', estimate_cents: avail.data.estimate_cents }, 409);
  const res = await callRpc<string>(supabase, 'request_studio_generation', { p_project_id: id, p_request_key: `ui-${key}`, p_policy_code: 'standard_v1' });
  if (res.error || !res.data) {
    const e = generationError(res.error?.message);
    return json({ error: e.code }, e.status);
  }
  return json({ run_id: res.data }, 201);
}
