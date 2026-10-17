import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { listRenderJobs, loadVideoSettings } from '@/lib/data/video';
import { normalizeVideoSettings, renderError } from '@/lib/video/settings';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Video export state of a project: saved settings, render jobs, approval and the workspace's video slots. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const { data: project } = await untyped(supabase).from('studio_projects').select('organization_id, script_status, approved_revision_id').eq('id', id).maybeSingle();
  if (!project) return json({ error: 'not_found' }, 404);
  const p = project as { organization_id: string; script_status: string | null; approved_revision_id: string | null };
  const jobs = await listRenderJobs(supabase, id);
  if (jobs === null) return json({ error: 'unavailable' }, 501);
  const { data: usage } = await untyped(supabase).from('usage_balances').select('base_video_slots, extra_video_slots, used_video_slots').eq('organization_id', p.organization_id).maybeSingle();
  const u = usage as { base_video_slots: number; extra_video_slots: number; used_video_slots: number } | null;
  return json({
    settings: await loadVideoSettings(supabase, id),
    jobs,
    approved: p.script_status === 'approved' && !!p.approved_revision_id,
    can_edit: canEditOrg(guard.ctx, p.organization_id),
    slots: u ? { total: u.base_video_slots + u.extra_video_slots, used: u.used_video_slots } : null,
  });
}

/** Saves the presentation settings (format, transitions, music, subtitles, per-scene media). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 40_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const supabase = await getSupabaseServer();
  const settings = normalizeVideoSettings((read.body as Record<string, unknown> | null)?.settings);
  const { data, error } = await callRpc<Record<string, unknown>>(supabase, 'save_video_settings', { p_project_id: id, p_settings: settings });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = renderError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data);
}
