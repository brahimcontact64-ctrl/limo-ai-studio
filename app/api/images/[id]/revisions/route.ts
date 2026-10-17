import { getSupabaseServer } from '@/lib/supabase/server';
import { json, requireUser } from '@/lib/api/guard';
import { listImageRevisions, loadImageProject, signedImageUrls } from '@/lib/data/images';
import { assetIds } from '@/lib/images/doc';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Current revision list of a design (RLS: workspace members) with preview URLs for its images. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const project = await loadImageProject(supabase, id);
  if (!project) return json({ error: 'not_found' }, 404);
  const revisions = await listImageRevisions(supabase, id, project.aspect);
  const urls = await signedImageUrls(supabase, [...new Set(revisions.flatMap((r) => assetIds(r.document)))]);
  return json({ revisions, urls });
}
