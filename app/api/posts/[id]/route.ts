import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { socialError } from '@/lib/social/errors';
import { isValidTimeZone } from '@/lib/social/schedule';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/**
 * Post workflow: submit (for review) | approve | unapprove | reject {note} | schedule {page_id, local_time
 * "YYYY-MM-DDTHH:mm" or null for now, timezone} | unschedule | cancel | restore {revision_id}.
 * Every rule (approval, media, pages, quotas, pause, duplicates) is enforced in the database.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const base = typeof b.base_updated_at === 'string' ? b.base_updated_at : null;
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'post_action', 240, 3600))) return json({ error: 'rate_limited' }, 429);

  let fn: string;
  let args: Record<string, unknown>;
  switch (b.action) {
    case 'submit':
      [fn, args] = ['submit_social_post_review', { p_post_id: id, p_base_updated_at: base }];
      break;
    case 'approve':
      [fn, args] = ['approve_social_post', { p_post_id: id, p_base_updated_at: base }];
      break;
    case 'unapprove':
      [fn, args] = ['set_social_post_approval', { p_post_id: id, p_approve: false, p_base_updated_at: base }];
      break;
    case 'reject':
      [fn, args] = ['reject_social_post', { p_post_id: id, p_note: typeof b.note === 'string' ? b.note.slice(0, 1000) : '' }];
      break;
    case 'schedule': {
      const local = b.local_time === null ? null : typeof b.local_time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(b.local_time) ? b.local_time : undefined;
      const tz = typeof b.timezone === 'string' && isValidTimeZone(b.timezone) ? b.timezone : null;
      if (local === undefined || !tz || typeof b.page_id !== 'string' || !isUuid(b.page_id)) return json({ error: 'invalid_request' }, 400);
      [fn, args] = ['schedule_social_post', { p_post_id: id, p_base_updated_at: base, p_page_id: b.page_id, p_local_time: local, p_timezone: tz }];
      break;
    }
    case 'unschedule':
      [fn, args] = ['unschedule_social_post', { p_post_id: id, p_cancel: false }];
      break;
    case 'cancel':
      [fn, args] = ['unschedule_social_post', { p_post_id: id, p_cancel: true }];
      break;
    case 'restore':
      if (typeof b.revision_id !== 'string' || !isUuid(b.revision_id)) return json({ error: 'invalid_request' }, 400);
      [fn, args] = ['restore_social_post_revision', { p_revision_id: b.revision_id, p_base_updated_at: base }];
      break;
    default:
      return json({ error: 'invalid_action' }, 400);
  }
  const { data, error } = await callRpc<Record<string, unknown>>(supabase, fn, args);
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = socialError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json(data);
}
