import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callRpc, untyped } from '@/lib/supabase/rpc';
import type { ProjectRow, ShotRow } from '@/lib/animation/storyboard';

type ServerSupabase = SupabaseClient<any, any, any>;

export interface AnimationListItem { id: string; title: string; language_code: string; aspect: string; status: string; updated_at: string; shots: number; seconds: number }
export interface JobRow { id: string; kind: string; shot_id: string | null; status: string; error_code: string | null; output: Record<string, unknown>; output_asset_ids: string[]; created_at: string }
export interface ReferenceRow { id: string; character: string; view: string | null; url: string | null }
export interface AssetView { url: string | null; mime: string; label: string; mock: boolean; ai: boolean }

const missing = (code?: string) => code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883';

/** Animation projects of a workspace (null = migration not applied). */
export async function listAnimationProjects(supabase: ServerSupabase, organizationId: string): Promise<AnimationListItem[] | null> {
  const db = untyped(supabase);
  const { data, error } = await db.from('animation_projects').select('id, title, language_code, aspect, status, updated_at').eq('organization_id', organizationId).neq('status', 'archived').order('updated_at', { ascending: false }).limit(100);
  if (error) return missing(error.code) ? null : [];
  const ids = (data ?? []).map((p: { id: string }) => p.id);
  const { data: shots } = ids.length ? await db.from('animation_shots').select('project_id, duration_seconds').in('project_id', ids) : { data: [] };
  return ((data ?? []) as Array<Omit<AnimationListItem, 'shots' | 'seconds'>>).map((p) => {
    const mine = ((shots ?? []) as Array<{ project_id: string; duration_seconds: number }>).filter((s) => s.project_id === p.id);
    return { ...p, shots: mine.length, seconds: mine.reduce((a, s) => a + s.duration_seconds, 0) };
  });
}

/** Everything the storyboard editor needs, with short-lived signed previews (RLS decides visibility). */
export async function loadAnimation(supabase: ServerSupabase, id: string) {
  const db = untyped(supabase);
  const { data: project, error } = await db.from('animation_projects').select('*').eq('id', id).maybeSingle();
  if (error) return missing(error.code) ? { unavailable: true as const } : null;
  if (!project) return null;
  const p = project as ProjectRow;
  const { data: shotRows } = await db.from('animation_shots').select('*').eq('project_id', id).order('shot_number');
  const shots = (shotRows ?? []) as ShotRow[];
  const shotIds = shots.map((s) => s.id);
  const { data: jobs } = shotIds.length ? await db.from('ai_jobs').select('id, kind, shot_id, status, error_code, output, output_asset_ids, created_at').in('shot_id', shotIds).order('created_at', { ascending: false }).limit(200) : { data: [] };
  const { data: events } = shotIds.length ? await db.from('animation_shot_events').select('shot_id, event, stage, note, created_at').in('shot_id', shotIds).order('created_at', { ascending: false }).limit(200) : { data: [] };
  const readiness = await callRpc<{ flags: Record<string, boolean>; characters: Record<string, { gaps: string[]; voice: { provider: string; voice_ref: string } | null }> }>(supabase, 'animation_readiness', { p_project_id: id });

  // Generated / workspace files (keyframes, frames, clips, voices, music).
  const assetIds = [...new Set(shots.flatMap((s) => [s.keyframe_asset_id, s.first_frame_asset_id, s.last_frame_asset_id, s.clip_asset_id, ...s.voice_tracks.map((v) => v.asset_id)]).concat(p.music_asset_id).filter(Boolean) as string[])];
  const assets: Record<string, AssetView> = {};
  if (assetIds.length) {
    const { data: rows } = await db.from('media_assets').select('id, object_path, mime_type, label, provenance').eq('organization_id', p.organization_id).in('id', assetIds);
    const list = (rows ?? []) as Array<{ id: string; object_path: string; mime_type: string | null; label: string | null; provenance: { mock?: boolean; ai_generated?: boolean } | null }>;
    const signed = list.length ? ((await supabase.storage.from('workspace-assets').createSignedUrls(list.map((a) => a.object_path), 600)).data ?? []) : [];
    list.forEach((a, i) => (assets[a.id] = { url: signed[i]?.signedUrl ?? null, mime: a.mime_type ?? '', label: a.label ?? '', mock: a.provenance?.mock === true, ai: a.provenance?.ai_generated === true }));
  }

  // Approved view references of every character the workspace can cast (canonical: global approved files; custom:
  // this workspace's), so references can be attached right after adding a character or importing a scenario.
  const refRows: Array<{ id: string; catalog_character_id: string | null; custom_character_id: string | null; view: string | null; bucket_id: string; object_path: string }> = [];
  const cols = 'id, catalog_character_id, custom_character_id, view, bucket_id, object_path';
  refRows.push(...(((await db.from('character_reference_assets').select(cols).eq('status', 'approved').eq('asset_kind', 'rendered_reference').not('view', 'is', null).not('catalog_character_id', 'is', null).limit(200)).data ?? []) as typeof refRows));
  refRows.push(...(((await db.from('character_reference_assets').select(cols).eq('status', 'approved').eq('asset_kind', 'rendered_reference').not('view', 'is', null).eq('organization_id', p.organization_id).limit(200)).data ?? []) as typeof refRows));
  const refSigned = refRows.length ? ((await supabase.storage.from('character-library').createSignedUrls(refRows.map((r) => r.object_path), 600)).data ?? []) : [];
  const references: ReferenceRow[] = refRows.map((r, i) => ({ id: r.id, character: r.catalog_character_id ?? `custom:${r.custom_character_id}`, view: r.view, url: refSigned[i]?.signedUrl ?? null }));

  return {
    unavailable: false as const, project: p, shots, jobs: (jobs ?? []) as JobRow[], events: (events ?? []) as Array<{ shot_id: string; event: string; stage: string | null; note: string | null; created_at: string }>,
    readiness: readiness.data ?? { flags: {}, characters: {} }, assets, references,
  };
}
