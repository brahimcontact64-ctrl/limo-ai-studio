import { getSupabaseServer } from '@/lib/supabase/server';
import { canEditOrg, json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction } from '@/lib/supabase/rpc';
import { isUuid } from '@/lib/studio/validation';
import { animationError } from '@/lib/animation/errors';
import { loadAnimation } from '@/lib/data/animation';
import { listCustomCharacters } from '@/lib/data/characters';
import { CANONICAL_CHARACTER_IDS, readinessBlockers, storyboard, validateScenario, type CharacterReadiness } from '@/lib/animation/scenario';
import { continuityIssues, dialogueTimeline, toSavePayload, toScenario, type ProjectRow, type ShotRow } from '@/lib/animation/storyboard';

export const dynamic = 'force-dynamic';

/** Readiness per character in the shape the planner expects (approved views from the attached references). */
function readinessMap(data: NonNullable<Awaited<ReturnType<typeof loadAnimation>>>, language: string): Record<string, CharacterReadiness> {
  if (data.unavailable) return {};
  const out: Record<string, CharacterReadiness> = {};
  for (const [id, r] of Object.entries(data.readiness.characters ?? {})) {
    const refs = data.references.filter((x) => x.character === id);
    const view = (v: string) => (r.gaps.includes(`missing_${v}`) ? undefined : refs.find((x) => x.view === v)?.id);
    out[id] = { specApproved: !r.gaps.includes('spec_not_approved'), approvedViews: { front: view('front'), three_quarter: view('three_quarter'), side: view('side') }, voices: r.voice ? { [language]: { provider: r.voice.provider, voiceRef: r.voice.voice_ref } } : {} };
  }
  return out;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const data = await loadAnimation(supabase, id);
  if (!data) return json({ error: 'not_found' }, 404);
  if (data.unavailable) return json({ error: 'unavailable' }, 501);
  const p = data.project;
  const scenario = toScenario(p, data.shots);
  const state = readinessMap(data, p.language_code);
  const voiceMode = p.settings.voice_mode ?? 'separate';
  const plan = data.shots.length
    ? storyboard(scenario, state, { tier: p.settings.tier ?? 'fast', resolution: p.settings.resolution ?? '720p', voiceMode, lipSync: p.settings.lip_sync === true, takes: Math.max(1, Math.min(5, p.settings.takes ?? 2)) })
    : null;
  const customs = await listCustomCharacters(supabase, p.organization_id).catch(() => []);
  return json({
    ...data,
    can_edit: canEditOrg(guard.ctx, p.organization_id),
    characters: { canonical: CANONICAL_CHARACTER_IDS, custom: customs.map((c) => ({ id: `custom:${c.id}`, name: c.name })) },
    planning: {
      issues: validateScenario(scenario),
      continuity: continuityIssues(data.shots, Object.fromEntries(data.references.map((r) => [r.id, r.character]))),
      blockers: readinessBlockers(scenario, state, voiceMode),
      timeline: dialogueTimeline(data.shots),
      cost: plan ? { per_take_usd: plan.perTakeUsd, expected_usd: plan.expectedUsd, seconds: plan.seconds, prices: 'researched list prices (unverified), planning only' } : null,
    },
  });
}

/** Saves the project settings and the whole storyboard (optimistic revision check). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  if (!isUuid(id)) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 200_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as { project?: Partial<ProjectRow>; shots?: Array<Partial<ShotRow>>; revision?: number };
  if (!b.project || !Array.isArray(b.shots) || b.shots.length > 15) return json({ error: 'invalid_request' }, 400);
  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'animation_save', 240, 3600))) return json({ error: 'rate_limited' }, 429);
  const current = await loadAnimation(supabase, id);
  if (!current) return json({ error: 'not_found' }, 404);
  if (current.unavailable) return json({ error: 'unavailable' }, 501);
  const p = b.project;
  const settings = {
    tier: p.settings?.tier === 'standard' ? 'standard' : 'fast', resolution: p.settings?.resolution === '1080p' ? '1080p' : '720p',
    voice_mode: p.settings?.voice_mode === 'native' ? 'native' : 'separate', lip_sync: p.settings?.lip_sync === true, takes: Math.max(1, Math.min(5, Number(p.settings?.takes ?? 2) || 2)),
  };
  const saved = await callRpc<string>(supabase, 'save_animation_project', {
    p_organization_id: current.project.organization_id, p_project_id: id, p_title: String(p.title ?? current.project.title).slice(0, 150),
    p_language: ['en', 'fr', 'ar', 'de'].includes(p.language_code as string) ? p.language_code : current.project.language_code,
    p_aspect: p.aspect === '16:9' ? '16:9' : '9:16', p_music_asset_id: isUuid(p.music_asset_id) ? p.music_asset_id : null, p_music_note: String(p.music_note ?? '').slice(0, 500), p_settings: settings,
  });
  if (isMissingFunction(saved.error)) return json({ error: 'unavailable' }, 501);
  if (saved.error) return json({ error: animationError(saved.error.message).code }, animationError(saved.error.message).status);
  const shots = b.shots.map((s) => ({ ...s, duration_seconds: ([4, 6, 8] as const).includes(Number(s.duration_seconds) as 4) ? (Number(s.duration_seconds) as 4 | 6 | 8) : 8, id: isUuid(s.id) ? s.id : undefined }));
  const r = await callRpc<{ id: string; revision: number; total_seconds: number }>(supabase, 'save_animation_shots', { p_project_id: id, p_shots: toSavePayload(shots), p_expected_revision: typeof b.revision === 'number' ? b.revision : null });
  if (r.error || !r.data) {
    const e = animationError(r.error?.message);
    return json({ error: e.code, detail: r.error?.message?.slice(0, 200) }, e.status);
  }
  return json(r.data);
}
