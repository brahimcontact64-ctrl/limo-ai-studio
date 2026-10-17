import { getSupabaseServer } from '@/lib/supabase/server';
import { json, requireUser } from '@/lib/api/guard';
import { isUuid } from '@/lib/studio/validation';
import { untyped } from '@/lib/supabase/rpc';

export const dynamic = 'force-dynamic';

export interface RevisionSummary {
  id: string;
  revision_number: number;
  source: 'created' | 'manual' | 'autosave' | 'mock_ai' | 'restore' | 'approval';
  label: string | null;
  scene_count: number;
  total_duration_seconds: number;
  created_at: string;
  updated_at: string;
}

/** Revision history of one project (RLS: workspace members only). Snapshots are fetched one at a time. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const { data, error } = await untyped(supabase)
    .from('project_revisions')
    .select('id, revision_number, source, label, scene_count, total_duration_seconds, created_at, updated_at')
    .eq('project_id', id)
    .order('revision_number', { ascending: false })
    .limit(100);
  if (error) {
    const missing = error.code === '42P01' || error.code === 'PGRST205';
    return json({ error: missing ? 'unavailable' : 'failed' }, missing ? 501 : 500);
  }
  return json({ revisions: (data ?? []) as RevisionSummary[] });
}
