import type { Brief, CreationMode } from '../create/modes.ts';

export type ProjectStatus = 'draft' | 'ready' | 'queued' | 'generating' | 'generated' | 'approved' | 'archived';

export const EDITABLE_STATUSES: ReadonlyArray<ProjectStatus> = ['draft', 'ready'];

export interface SceneDraft {
  /** Client-only stable key for React lists and drag & drop. */
  key: string;
  title: string;
  duration_seconds: number;
  participants: string[];
  location_prompt: string;
  environment_prompt: string;
  camera_prompt: string;
  lighting_prompt: string;
  action_prompt: string;
  dialogue: string;
  on_screen_text: string;
  effects_prompt: string;
  music_prompt: string;
  transition_out: string;
  continuity_notes: string;
  narration: string;
  visual_prompt: string;
  /** Workspace media (media_assets ids) used by this scene. */
  asset_ids: string[];
}

export type SceneTextField = Exclude<keyof SceneDraft, 'key' | 'duration_seconds' | 'participants' | 'asset_ids'>;

export interface ProjectDraft {
  id: string | null;
  title: string;
  creation_mode: CreationMode;
  creation_brief: Brief;
  content_type: string;
  language_code: string;
  brief: string;
  goal: string;
  visual_style: string;
  cast: string[];
  scenes: SceneDraft[];
  export_presets: string[];
}

/** Payload accepted by POST /api/projects. Scene numbers are derived from order on the server. */
export interface SaveProjectRequest {
  project_id: string | null;
  title: string;
  creation_mode: CreationMode;
  creation_brief: Brief;
  content_type: string;
  language_code: string;
  brief: string;
  goal: string;
  visual_style: string;
  cast: string[];
  scenes: Array<Omit<SceneDraft, 'key'>>;
  export_presets: string[];
}

export interface CharacterRecord {
  id: string;
  name: string;
  family_code: string | null;
  age_group: string | null;
  gender_code: string | null;
  reference_status: string;
  visual_description: string | null;
  tone: string;
  visual_ref: string | null;
  sort_order: number;
  /** Canonical identity text from the latest design spec (consistency metadata for generation). */
  identity_prompt?: string | null;
  /** Latest design spec version and its review status (canonical characters). */
  spec_version?: number | null;
  spec_status?: string | null;
  /** Workspace character ("custom:<uuid>"); base family is optional styling guidance. */
  custom?: boolean;
  base_family?: string | null;
}

export interface CatalogOption {
  code: string;
  label: string;
}

export interface ExportPresetOption {
  code: string;
  label: string;
  aspect_ratio: string;
  width: number;
  height: number;
  recommended_for: string[];
}
