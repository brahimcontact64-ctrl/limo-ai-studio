import type { ProjectDraft, SaveProjectRequest, SceneDraft } from './types.ts';
import { isCreationMode, sanitizeBrief, type Brief, type CreationMode } from '../create/modes.ts';

let keySeq = 0;
export function sceneKey(): string {
  keySeq += 1;
  return `s${Date.now().toString(36)}${keySeq.toString(36)}`;
}

export const DEFAULT_SCENE_DURATION = 8;

export function newScene(partial: Partial<SceneDraft> = {}): SceneDraft {
  return {
    key: sceneKey(),
    title: '',
    duration_seconds: DEFAULT_SCENE_DURATION,
    participants: [],
    location_prompt: '',
    environment_prompt: '',
    camera_prompt: '',
    lighting_prompt: '',
    action_prompt: '',
    dialogue: '',
    on_screen_text: '',
    effects_prompt: '',
    music_prompt: '',
    transition_out: '',
    continuity_notes: '',
    narration: '',
    visual_prompt: '',
    asset_ids: [],
    ...partial,
  };
}

export function emptyProject(defaults: {
  content_type: string;
  language_code: string;
  export_presets?: string[];
  creation_mode?: CreationMode;
  creation_brief?: Brief;
}): ProjectDraft {
  return {
    id: null,
    title: '',
    creation_mode: defaults.creation_mode ?? 'story',
    creation_brief: defaults.creation_brief ?? {},
    content_type: defaults.content_type,
    language_code: defaults.language_code,
    brief: '',
    goal: '',
    visual_style: '',
    cast: [],
    scenes: [newScene()],
    export_presets: defaults.export_presets ?? ['vertical_9_16'],
  };
}

export interface DbProjectRow {
  id: string;
  title: string;
  content_type: string;
  language_code: string;
  brief: string | null;
  goal: string | null;
  visual_style: string | null;
  project_cast: unknown;
  /** Absent before migration 20261017100000. */
  creation_mode?: string | null;
  creation_brief?: unknown;
}

export interface DbSceneRow {
  scene_number: number;
  title: string | null;
  duration_seconds: number;
  participants: string[] | null;
  location_prompt: string | null;
  environment_prompt: string | null;
  camera_prompt: string | null;
  lighting_prompt: string | null;
  action_prompt: string | null;
  dialogue: string | null;
  on_screen_text: string | null;
  effects_prompt: string | null;
  music_prompt: string | null;
  transition_out: string | null;
  continuity_notes: string | null;
  narration?: string | null;
  visual_prompt?: string | null;
  asset_ids?: string[] | null;
}

/** Reads project_cast in the shape written by save_studio_project: [{ "id": "limo_boy" }]. */
export function castFromDb(projectCast: unknown): string[] {
  if (!Array.isArray(projectCast)) return [];
  const ids: string[] = [];
  for (const entry of projectCast) {
    if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
      ids.push((entry as { id: string }).id);
    }
  }
  return ids;
}

export function projectFromDb(row: DbProjectRow, scenes: DbSceneRow[], presets: string[]): ProjectDraft {
  const ordered = [...scenes].sort((a, b) => a.scene_number - b.scene_number);
  const mode: CreationMode = isCreationMode(row.creation_mode) ? row.creation_mode : 'story';
  return {
    id: row.id,
    title: row.title,
    creation_mode: mode,
    creation_brief: sanitizeBrief(mode, row.creation_brief),
    content_type: row.content_type,
    language_code: row.language_code,
    brief: row.brief ?? '',
    goal: row.goal ?? '',
    visual_style: row.visual_style ?? '',
    cast: castFromDb(row.project_cast),
    scenes: ordered.map((s) =>
      newScene({
        title: s.title ?? '',
        duration_seconds: s.duration_seconds,
        participants: s.participants ?? [],
        location_prompt: s.location_prompt ?? '',
        environment_prompt: s.environment_prompt ?? '',
        camera_prompt: s.camera_prompt ?? '',
        lighting_prompt: s.lighting_prompt ?? '',
        action_prompt: s.action_prompt ?? '',
        dialogue: s.dialogue ?? '',
        on_screen_text: s.on_screen_text ?? '',
        effects_prompt: s.effects_prompt ?? '',
        music_prompt: s.music_prompt ?? '',
        transition_out: s.transition_out ?? '',
        continuity_notes: s.continuity_notes ?? '',
        narration: s.narration ?? '',
        visual_prompt: s.visual_prompt ?? '',
        asset_ids: s.asset_ids ?? [],
      }),
    ),
    export_presets: presets,
  };
}

export function toSaveRequest(draft: ProjectDraft): SaveProjectRequest {
  return {
    project_id: draft.id,
    title: draft.title,
    creation_mode: draft.creation_mode,
    creation_brief: draft.creation_brief,
    content_type: draft.content_type,
    language_code: draft.language_code,
    brief: draft.brief,
    goal: draft.goal,
    visual_style: draft.visual_style,
    cast: draft.cast,
    scenes: draft.scenes.map(({ key: _key, ...rest }) => rest),
    export_presets: draft.export_presets,
  };
}

/** Stable serialization used to detect unsaved changes (ignores client-only keys). */
export function draftFingerprint(draft: ProjectDraft): string {
  return JSON.stringify(toSaveRequest(draft));
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

/** Removing a character from the cast also removes it from every scene. */
export function removeFromCast(draft: ProjectDraft, id: string): ProjectDraft {
  return {
    ...draft,
    cast: draft.cast.filter((c) => c !== id),
    scenes: draft.scenes.map((s) => ({ ...s, participants: s.participants.filter((p) => p !== id) })),
  };
}
