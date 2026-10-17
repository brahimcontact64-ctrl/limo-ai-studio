import { getSupabaseServer } from '@/lib/supabase/server';
import { json, requireUser } from '@/lib/api/guard';
import { loadRenderJob } from '@/lib/data/video';
import { isUuid } from '@/lib/studio/validation';

export const dynamic = 'force-dynamic';

/** Signed links expire quickly; the page asks for a new one each time. */
const LINK_SECONDS = 600;

/**
 * Short-lived link to a finished MP4. Access is checked twice: the job must be visible to the user
 * (RLS: workspace members) and the signed URL is created with the user's own session, so storage
 * policies apply too. ?inline=1 for the preview player, otherwise the browser downloads the file.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const job = await loadRenderJob(supabase, id);
  if (!job) return json({ error: 'not_found' }, 404);
  if (job.status !== 'completed' || !job.output_object_path) return json({ error: 'not_ready' }, 409);
  const inline = new URL(request.url).searchParams.get('inline') === '1';
  const name = `limo-${job.aspect.replace(':', 'x')}-${job.width}x${job.height}-r${job.script_revision_number}.mp4`;
  const { data, error } = await supabase.storage.from('workspace-assets').createSignedUrl(job.output_object_path, LINK_SECONDS, inline ? undefined : { download: name });
  if (error || !data?.signedUrl) return json({ error: 'not_found' }, 404);
  return json({ url: data.signedUrl, expires_in: LINK_SECONDS, file_name: name });
}
