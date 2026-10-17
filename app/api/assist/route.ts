import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { getCatalogs } from '@/lib/data/catalog';
import { ASSIST_ACTIONS, ASSIST_TONES, runMockAssist, type AssistInput, type AssistScene } from '@/lib/ai/script';
import { isCreationMode, sanitizeBrief } from '@/lib/create/modes';
import { SCENE_FIELD_MAX } from '@/lib/studio/limits';

export const dynamic = 'force-dynamic';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Script assistant. Paid generation is disabled, so this always uses the deterministic mock: no
 * external API is called and no credits are used. The result is a proposal; nothing is saved here.
 */
export async function POST(request: Request) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.canEdit) return json({ error: 'not_authorized' }, 403);
  const read = await readJson(request, 256_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const p = (b.project ?? {}) as Record<string, unknown>;
  const mode = p.creation_mode;
  if (!ASSIST_ACTIONS.includes(b.action as never) || !isCreationMode(mode) || !Array.isArray(p.scenes) || p.scenes.length < 1 || p.scenes.length > 25) {
    return json({ error: 'invalid_request' }, 400);
  }
  const catalogs = await getCatalogs();
  const languages = new Set(catalogs.ok ? catalogs.languages.map((l) => l.code) : ['en', 'fr', 'ar', 'de']);
  const target = typeof b.target_language === 'string' && languages.has(b.target_language) ? b.target_language : undefined;
  if (b.action === 'translate' && !target) return json({ error: 'invalid_request' }, 400);

  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'script_assist', 30, 60))) return json({ error: 'rate_limited' }, 429);

  const scenes: AssistScene[] = (p.scenes as Array<Record<string, unknown>>).map((s) => ({
    title: text(s.title, SCENE_FIELD_MAX.title),
    duration_seconds: Number(s.duration_seconds) || 5,
    participants: Array.isArray(s.participants) ? s.participants.filter((x): x is string => typeof x === 'string').slice(0, 18) : [],
    narration: text(s.narration, SCENE_FIELD_MAX.narration),
    dialogue: text(s.dialogue, SCENE_FIELD_MAX.dialogue),
    on_screen_text: text(s.on_screen_text, SCENE_FIELD_MAX.on_screen_text),
    visual_prompt: text(s.visual_prompt, SCENE_FIELD_MAX.visual_prompt),
    camera_prompt: text(s.camera_prompt, SCENE_FIELD_MAX.camera_prompt),
  }));
  const input: AssistInput = {
    action: b.action as AssistInput['action'],
    scenes: Array.isArray(b.scenes) ? b.scenes.filter((x): x is number => Number.isInteger(x)).slice(0, 25) : [],
    tone: ASSIST_TONES.includes(b.tone as never) ? (b.tone as AssistInput['tone']) : undefined,
    target_language: target,
    variant: Number.isInteger(b.variant) ? (b.variant as number) % 1000 : 0,
    project: {
      title: text(p.title, 200),
      creation_mode: mode,
      creation_brief: sanitizeBrief(mode, p.creation_brief),
      brief: text(p.brief, 8000),
      visual_style: text(p.visual_style, 1000),
      language_code: typeof p.language_code === 'string' && languages.has(p.language_code) ? p.language_code : 'en',
      scenes,
    },
  };
  const result = runMockAssist(input);
  // Keep proposals within the database limits.
  for (const s of result.scenes) for (const f of s.fields) f.after = f.after.slice(0, SCENE_FIELD_MAX[f.field]);
  return json({ ...result, label: 'Mock AI' });
}
