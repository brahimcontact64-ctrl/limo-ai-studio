import { LIMITS, SCENE_FIELD_MAX, isCastVariantId } from './limits.ts';
import type { ProjectDraft, SaveProjectRequest, SceneDraft } from './types.ts';

export type IssueCode =
  | 'title_required'
  | 'title_too_long'
  | 'content_type_invalid'
  | 'language_invalid'
  | 'brief_too_long'
  | 'goal_too_long'
  | 'visual_style_too_long'
  | 'cast_min'
  | 'cast_max'
  | 'cast_duplicate'
  | 'cast_invalid_id'
  | 'scenes_min'
  | 'scenes_max'
  | 'scene_duration_range'
  | 'total_duration_max'
  | 'participant_not_in_cast'
  | 'participant_duplicate'
  | 'scene_field_too_long'
  | 'scene_no_participants'
  | 'preset_invalid'
  | 'preset_duplicate';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning';
  /** 0-based scene index when the issue belongs to a scene. */
  scene?: number;
  field?: string;
  params?: Record<string, string | number>;
}

export interface CatalogContext {
  contentTypes?: ReadonlySet<string>;
  languages?: ReadonlySet<string>;
  exportPresets?: ReadonlySet<string>;
}

type DraftLike = Pick<ProjectDraft, 'title' | 'content_type' | 'language_code' | 'brief' | 'goal' | 'visual_style' | 'cast' | 'export_presets'> & {
  scenes: Array<Omit<SceneDraft, 'key'>>;
};

export function totalDuration(scenes: ReadonlyArray<{ duration_seconds: number }>): number {
  return scenes.reduce((sum, s) => sum + (Number.isFinite(s.duration_seconds) ? s.duration_seconds : 0), 0);
}

export function validateDraft(draft: DraftLike, ctx: CatalogContext = {}): Issue[] {
  const issues: Issue[] = [];
  const err = (i: Omit<Issue, 'severity'>) => issues.push({ ...i, severity: 'error' });

  const title = draft.title.trim();
  if (!title) err({ code: 'title_required', field: 'title' });
  else if (title.length > LIMITS.titleMax) err({ code: 'title_too_long', field: 'title', params: { max: LIMITS.titleMax } });

  if (!draft.content_type || (ctx.contentTypes && !ctx.contentTypes.has(draft.content_type))) {
    err({ code: 'content_type_invalid', field: 'content_type' });
  }
  if (!draft.language_code || (ctx.languages && !ctx.languages.has(draft.language_code))) {
    err({ code: 'language_invalid', field: 'language_code' });
  }
  if (draft.brief.length > LIMITS.briefMax) err({ code: 'brief_too_long', field: 'brief', params: { max: LIMITS.briefMax } });
  if (draft.goal.length > LIMITS.goalMax) err({ code: 'goal_too_long', field: 'goal', params: { max: LIMITS.goalMax } });
  if (draft.visual_style.length > LIMITS.visualStyleMax) {
    err({ code: 'visual_style_too_long', field: 'visual_style', params: { max: LIMITS.visualStyleMax } });
  }

  const cast = draft.cast;
  if (cast.length < LIMITS.castMin) err({ code: 'cast_min', field: 'cast', params: { min: LIMITS.castMin } });
  if (cast.length > LIMITS.castMax) err({ code: 'cast_max', field: 'cast', params: { max: LIMITS.castMax } });
  if (new Set(cast).size !== cast.length) err({ code: 'cast_duplicate', field: 'cast' });
  for (const id of cast) if (!isCastVariantId(id)) err({ code: 'cast_invalid_id', field: 'cast', params: { id: String(id) } });
  const castSet = new Set(cast);

  const scenes = draft.scenes;
  if (scenes.length < LIMITS.scenesMin) err({ code: 'scenes_min', field: 'scenes', params: { min: LIMITS.scenesMin } });
  if (scenes.length > LIMITS.scenesMax) err({ code: 'scenes_max', field: 'scenes', params: { max: LIMITS.scenesMax } });

  scenes.forEach((scene, index) => {
    const d = scene.duration_seconds;
    if (!Number.isInteger(d) || d < LIMITS.sceneDurationMin || d > LIMITS.sceneDurationMax) {
      err({ code: 'scene_duration_range', scene: index, field: 'duration_seconds', params: { min: LIMITS.sceneDurationMin, max: LIMITS.sceneDurationMax } });
    }
    if (new Set(scene.participants).size !== scene.participants.length) {
      err({ code: 'participant_duplicate', scene: index, field: 'participants' });
    }
    for (const id of scene.participants) {
      if (!castSet.has(id)) err({ code: 'participant_not_in_cast', scene: index, field: 'participants', params: { id } });
    }
    if (scene.participants.length === 0) {
      issues.push({ code: 'scene_no_participants', severity: 'warning', scene: index, field: 'participants' });
    }
    for (const [field, max] of Object.entries(SCENE_FIELD_MAX)) {
      const value = scene[field as keyof typeof SCENE_FIELD_MAX];
      if (typeof value === 'string' && value.length > max) {
        err({ code: 'scene_field_too_long', scene: index, field, params: { max } });
      }
    }
  });

  const total = totalDuration(scenes);
  if (total > LIMITS.totalDurationMax) err({ code: 'total_duration_max', field: 'scenes', params: { max: LIMITS.totalDurationMax } });

  if (new Set(draft.export_presets).size !== draft.export_presets.length) err({ code: 'preset_duplicate', field: 'export_presets' });
  if (ctx.exportPresets) {
    for (const p of draft.export_presets) if (!ctx.exportPresets.has(p)) err({ code: 'preset_invalid', field: 'export_presets', params: { id: p } });
  }

  return issues;
}

export function hasErrors(issues: ReadonlyArray<Issue>): boolean {
  return issues.some((i) => i.severity === 'error');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strArray = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;

/**
 * Parses an untrusted request body into a SaveProjectRequest.
 * Shape errors return null; semantic rules are checked with validateDraft.
 */
export function parseSaveRequest(body: unknown): SaveProjectRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const projectId = b.project_id ?? null;
  if (projectId !== null && !isUuid(projectId)) return null;
  const cast = strArray(b.cast);
  const presets = strArray(b.export_presets ?? []);
  if (!cast || !presets || !Array.isArray(b.scenes)) return null;
  if (b.scenes.length > LIMITS.scenesMax * 2) return null;

  const scenes: SaveProjectRequest['scenes'] = [];
  for (const raw of b.scenes) {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    const participants = strArray(s.participants ?? []);
    const duration = typeof s.duration_seconds === 'number' ? s.duration_seconds : Number.NaN;
    if (!participants) return null;
    scenes.push({
      title: str(s.title),
      duration_seconds: duration,
      participants,
      location_prompt: str(s.location_prompt),
      environment_prompt: str(s.environment_prompt),
      camera_prompt: str(s.camera_prompt),
      lighting_prompt: str(s.lighting_prompt),
      action_prompt: str(s.action_prompt),
      dialogue: str(s.dialogue),
      on_screen_text: str(s.on_screen_text),
      effects_prompt: str(s.effects_prompt),
      music_prompt: str(s.music_prompt),
      transition_out: str(s.transition_out),
      continuity_notes: str(s.continuity_notes),
    });
  }

  return {
    project_id: projectId as string | null,
    title: str(b.title),
    content_type: str(b.content_type),
    language_code: str(b.language_code),
    brief: str(b.brief),
    goal: str(b.goal),
    visual_style: str(b.visual_style),
    cast,
    scenes,
    export_presets: presets,
  };
}

/** Builds the exact argument object for public.save_studio_project. */
export function toRpcArgs(organizationId: string, req: SaveProjectRequest) {
  return {
    p_organization_id: organizationId,
    p_project_id: req.project_id,
    p_title: req.title.trim(),
    p_content_type: req.content_type,
    p_language_code: req.language_code,
    p_brief: req.brief,
    p_goal: req.goal,
    p_visual_style: req.visual_style,
    p_series_id: null,
    p_continuation_mode: false,
    p_project_cast: req.cast.map((id) => ({ id })),
    p_scenes: req.scenes.map((s, i) => ({
      scene_number: i + 1,
      title: s.title.trim(),
      duration_seconds: s.duration_seconds,
      participants: s.participants,
      location_prompt: s.location_prompt,
      environment_prompt: s.environment_prompt,
      camera_prompt: s.camera_prompt,
      lighting_prompt: s.lighting_prompt,
      action_prompt: s.action_prompt,
      dialogue: s.dialogue,
      on_screen_text: s.on_screen_text,
      effects_prompt: s.effects_prompt,
      music_prompt: s.music_prompt,
      transition_out: s.transition_out,
      continuity_notes: s.continuity_notes,
    })),
    p_export_presets: req.export_presets,
  };
}

/** Maps a database exception message from save_studio_project to a stable error code. */
export type SaveErrorCode =
  | 'subscription_required'
  | 'not_authorized'
  | 'not_editable'
  | 'cast_limit'
  | 'character_unavailable'
  | 'scene_duration'
  | 'invalid_catalog'
  | 'validation'
  | 'unknown';

export function mapSaveError(message: string | undefined | null): SaveErrorCode {
  const m = (message ?? '').toLowerCase();
  if (m.includes('active subscription required')) return 'subscription_required';
  if (m.includes('not authorized') || m.includes('authentication required')) return 'not_authorized';
  if (m.includes('no longer editable') || m.includes('project not found')) return 'not_editable';
  if (m.includes('project_cast_check') || m.includes('between 1 and 18 characters')) return 'cast_limit';
  if (m.includes('characters are unavailable') || m.includes('not in the project cast')) return 'character_unavailable';
  if (m.includes('scene must be between') || m.includes('scene duration') || m.includes('limited to 10 minutes')) return 'scene_duration';
  if (m.includes('invalid content type') || m.includes('invalid language') || m.includes('invalid export preset')) return 'invalid_catalog';
  if (m.includes('scene') || m.includes('title') || m.includes('character')) return 'validation';
  return 'unknown';
}
