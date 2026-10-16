import 'server-only';
import type { ServerSupabase } from '../supabase/server';
import { castFromDb, projectFromDb, type DbProjectRow, type DbSceneRow } from '../studio/draft';
import { isCreationMode, type CreationMode } from '../create/modes';
import type { ProjectDraft, ProjectStatus } from '../studio/types';

export interface ProjectSummary {
  id: string;
  title: string;
  status: ProjectStatus;
  creation_mode: CreationMode;
  content_type: string;
  language_code: string;
  cast: string[];
  scene_count: number;
  total_duration_seconds: number;
  created_at: string;
  updated_at: string;
}

const BASE_SUMMARY = 'id, title, status, content_type, language_code, project_cast, total_duration_seconds, created_at, updated_at, project_scenes(count)';
const BASE_PROJECT = 'id, organization_id, title, content_type, language_code, brief, goal, visual_style, project_cast, status, created_at, updated_at';
const BASE_SCENE =
  'scene_number, title, duration_seconds, participants, location_prompt, environment_prompt, camera_prompt, lighting_prompt, action_prompt, dialogue, on_screen_text, effects_prompt, music_prompt, transition_out, continuity_notes';

/** Postgres "undefined column": the database predates migration 20261017100000. */
const missingColumn = (error: { code?: string } | null) => error?.code === '42703';

type SummaryRow = {
  id: string;
  title: string;
  status: string;
  creation_mode?: string | null;
  content_type: string;
  language_code: string;
  project_cast: unknown;
  total_duration_seconds: number;
  created_at: string;
  updated_at: string;
  project_scenes: Array<{ count: number }> | null;
};

function toSummary(row: SummaryRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as ProjectStatus,
    creation_mode: isCreationMode(row.creation_mode) ? row.creation_mode : 'story',
    content_type: row.content_type,
    language_code: row.language_code,
    cast: castFromDb(row.project_cast),
    scene_count: row.project_scenes?.[0]?.count ?? 0,
    total_duration_seconds: row.total_duration_seconds,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Lists projects of one organization. RLS (is_org_member) is the security boundary; the filter scopes the workspace. */
export async function listProjects(supabase: ServerSupabase, organizationId: string, limit = 200): Promise<ProjectSummary[] | null> {
  const run = (columns: string) =>
    supabase.from('studio_projects').select(columns).eq('organization_id', organizationId).order('updated_at', { ascending: false }).limit(limit);
  let res = await run(`${BASE_SUMMARY}, creation_mode`);
  if (missingColumn(res.error)) res = await run(BASE_SUMMARY);
  if (res.error) return null;
  return (res.data as unknown as SummaryRow[]).map(toSummary);
}

export interface LoadedProject {
  draft: ProjectDraft;
  organization_id: string;
  status: ProjectStatus;
  updated_at: string;
  created_at: string;
}

export async function loadProject(supabase: ServerSupabase, projectId: string): Promise<LoadedProject | null> {
  const runProject = (columns: string) => supabase.from('studio_projects').select(columns).eq('id', projectId).maybeSingle();
  let projectRes = await runProject(`${BASE_PROJECT}, creation_mode, creation_brief`);
  if (missingColumn(projectRes.error)) projectRes = await runProject(BASE_PROJECT);
  const row = projectRes.data as unknown as (DbProjectRow & { organization_id: string; status: string; created_at: string; updated_at: string }) | null;
  if (projectRes.error || !row) return null;

  const runScenes = (columns: string) => supabase.from('project_scenes').select(columns).eq('project_id', projectId).order('scene_number');
  let scenes = await runScenes(`${BASE_SCENE}, narration, visual_prompt, asset_ids`);
  if (missingColumn(scenes.error)) scenes = await runScenes(BASE_SCENE);
  const presets = await supabase.from('project_export_choices').select('preset_code').eq('project_id', projectId).order('preset_code');
  if (scenes.error || presets.error) return null;

  return {
    draft: projectFromDb(row, (scenes.data ?? []) as unknown as DbSceneRow[], (presets.data ?? []).map((p) => p.preset_code)),
    organization_id: row.organization_id,
    status: row.status as ProjectStatus,
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}
