import { getSupabaseServer } from '@/lib/supabase/server';
import { json, requireUser } from '@/lib/api/guard';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

/**
 * Lifecycle operations backed by SECURITY DEFINER functions from migration
 * 20261016120000_limo_studio_project_lifecycle_v1 (authorization is enforced in the database).
 * Until that migration is applied the functions do not exist and we answer 501.
 */
async function lifecycle(request: Request, id: string, fn: 'archive_studio_project' | 'restore_studio_project' | 'delete_studio_project') {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
  const { data, error } = await rpc(fn, { p_project_id: id });
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return json({ error: 'lifecycle_unavailable' }, 501);
    const m = error.message.toLowerCase();
    if (m.includes('not found')) return json({ error: 'not_found' }, 404);
    if (m.includes('not authorized')) return json({ error: 'not_authorized' }, 403);
    if (m.includes('generation history')) return json({ error: 'has_generation_history' }, 409);
    return json({ error: 'not_allowed' }, 409);
  }
  return json({ status: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return lifecycle(request, (await params).id, 'delete_studio_project');
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let action: unknown;
  try {
    action = ((await request.clone().json()) as { action?: unknown }).action;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (action === 'archive') return lifecycle(request, id, 'archive_studio_project');
  if (action === 'restore') return lifecycle(request, id, 'restore_studio_project');
  return json({ error: 'invalid_action' }, 400);
}
