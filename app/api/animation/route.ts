import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { animationError } from '@/lib/animation/errors';
import { listAnimationProjects } from '@/lib/data/animation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.org) return json({ error: 'no_workspace' }, 403);
  const list = await listAnimationProjects(await getSupabaseServer(), guard.ctx.org.organization_id);
  if (list === null) return json({ error: 'unavailable' }, 501);
  return json({ projects: list });
}

/** Creates an empty animation project (the owner writes the scenario shot by shot). */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const org = guard.ctx.org;
  if (!org) return json({ error: 'no_workspace' }, 403);
  if (!guard.ctx.canEdit) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 4_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const title = typeof b.title === 'string' ? b.title.trim().slice(0, 150) : '';
  const language = ['en', 'fr', 'ar', 'de'].includes(b.language as string) ? (b.language as string) : 'fr';
  const aspect = b.aspect === '16:9' ? '16:9' : '9:16';
  if (!title) return json({ error: 'title_required' }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'animation_create', 30, 3600))) return json({ error: 'rate_limited' }, 429);
  const { data, error } = await callRpc<string>(supabase, 'save_animation_project', {
    p_organization_id: org.organization_id, p_project_id: null, p_title: title, p_language: language, p_aspect: aspect, p_music_asset_id: null, p_music_note: '',
    p_settings: { tier: 'fast', resolution: '720p', voice_mode: 'separate', lip_sync: false, takes: 2 },
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const e = animationError(error?.message);
    return json({ error: e.code }, e.status);
  }
  return json({ id: data }, 201);
}
