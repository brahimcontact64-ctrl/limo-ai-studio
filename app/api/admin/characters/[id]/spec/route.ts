import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { isCastVariantId } from '@/lib/studio/limits';

export const dynamic = 'force-dynamic';

/** Approve the latest written design spec of a canonical character (platform admins with two-factor). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.isPlatformAdmin) return json({ error: 'not_found' }, 404);
  const { id } = await params;
  if (!isCastVariantId(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 1_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as { action?: unknown; version?: unknown };
  if (b.action !== 'approve' || !Number.isInteger(b.version)) return json({ error: 'invalid_action' }, 400);
  const supabase = await getSupabaseServer();
  const { data, error } = await callRpc<string>(supabase, 'admin_approve_character_spec', { p_character_id: id, p_version: b.version });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error) return json({ error: /two-factor/i.test(error.message) ? 'mfa_required' : /latest/i.test(error.message) ? 'not_latest' : 'failed' }, 422);
  return json({ reference_status: data });
}
