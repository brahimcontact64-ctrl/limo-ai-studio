import 'server-only';
import type { ServerSupabase } from '../supabase/server';
import { untyped } from '../supabase/rpc';
import { normalizeVideoSettings } from '../video/settings';
import type { RenderStatus, VideoSettings } from '../video/types';

export interface RenderJobRow {
  id: string;
  project_id: string;
  status: RenderStatus;
  progress: number;
  stage: string | null;
  aspect: string;
  width: number;
  height: number;
  quality: string;
  script_revision_number: number;
  total_duration_ms: number;
  notes: string[];
  error_code: string | null;
  attempt_count: number;
  cancel_requested: boolean;
  output_size_bytes: number | null;
  output_duration_ms: number | null;
  output_media_asset_id: string | null;
  created_at: string;
  completed_at: string | null;
}

const COLUMNS =
  'id, project_id, status, progress, stage, aspect, width, height, quality, script_revision_number, total_duration_ms, notes, error_code, attempt_count, cancel_requested, output_size_bytes, output_duration_ms, output_media_asset_id, created_at, completed_at';

/** Render jobs of a project, newest first (RLS: workspace members). null before migration 20261017200000. */
export async function listRenderJobs(supabase: ServerSupabase, projectId: string): Promise<RenderJobRow[] | null> {
  const { data, error } = await untyped(supabase).from('render_jobs').select(COLUMNS).eq('project_id', projectId).order('created_at', { ascending: false }).limit(30);
  if (error) return null;
  return ((data ?? []) as RenderJobRow[]).map((j) => ({ ...j, progress: Number(j.progress) }));
}

export async function loadRenderJob(supabase: ServerSupabase, id: string): Promise<(RenderJobRow & { organization_id: string; output_object_path: string | null }) | null> {
  const { data } = await untyped(supabase).from('render_jobs').select(`${COLUMNS}, organization_id, output_object_path`).eq('id', id).maybeSingle();
  return (data as (RenderJobRow & { organization_id: string; output_object_path: string | null }) | null) ?? null;
}

export async function loadVideoSettings(supabase: ServerSupabase, projectId: string): Promise<VideoSettings> {
  const { data } = await untyped(supabase).from('video_settings').select('settings').eq('project_id', projectId).maybeSingle();
  return normalizeVideoSettings((data as { settings?: unknown } | null)?.settings);
}
