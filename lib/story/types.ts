/**
 * Story Engine data model (Milestone 5).
 *
 * - The Story Bible is the series canon. It is versioned (story_bible_versions); every change is an explicit,
 *   user-confirmed save that creates a new version, and any version can be restored.
 * - Each episode is a studio project (script, revisions, approval from Milestone 3) plus an ending
 *   checkpoint: where everyone is, how they feel, what happened, which threads are open.
 * - "Continue Story" starts episode N+1 from episode N's *approved* checkpoint, never from a draft.
 * - The timeline is built only from approved checkpoints, so no earlier event can be invented.
 */

export interface BibleCharacter {
  /** Stable identity: a catalog id ("limo_boy") or a workspace character ("custom:<uuid>"). Never changes. */
  ref: string;
  name: string;
  role: string;
  traits: string[];
  goals: string[];
  motivations: string[];
}

export interface BibleRelationship {
  a: string;
  b: string;
  kind: string;
  note: string;
}

export interface BibleLocation {
  key: string;
  name: string;
  description: string;
}

export interface WorldRule {
  id: string;
  text: string;
  kind: 'rule' | 'forbidden';
}

export interface PlotArc {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'resolved';
  opened_in: number | null;
  resolved_in: number | null;
}

export interface StoryBible {
  premise: string;
  genre: string;
  tone: string;
  characters: BibleCharacter[];
  relationships: BibleRelationship[];
  locations: BibleLocation[];
  world_rules: WorldRule[];
  arcs: PlotArc[];
}

export interface CharacterState {
  ref: string;
  present: boolean;
  location_key: string;
  emotional_state: string;
  physical_state: string;
  current_goal: string;
}

export interface CheckpointEvent {
  text: string;
  characters: string[];
  /** 1-based scene numbers of this episode where the event happens (events must come from the script). */
  scenes: number[];
}

export interface EpisodeCheckpoint {
  summary: string;
  ending_hook: string;
  location_key: string;
  time_label: string;
  characters: CharacterState[];
  events: CheckpointEvent[];
  /** Arc ids progressed in this episode. */
  arcs_progressed: string[];
  /** Arc ids resolved in this episode (applied to the bible when the episode is approved). */
  arcs_resolved: string[];
  /** New arcs opened in this episode (added to the bible when the episode is approved). */
  arcs_opened: Array<{ id: string; title: string; description: string }>;
}

export type EpisodeReviewStatus = 'ok' | 'needs_review';
export interface ReviewReason {
  episode_number: number;
  kind: 'earlier_episode_reopened' | 'earlier_episode_changed';
  /** "direct": this episode involves a changed character or arc; "downstream": only through the chain. */
  impact: 'direct' | 'downstream';
  characters: string[];
  arcs: string[];
  at: string;
}

export const EMPTY_BIBLE: StoryBible = { premise: '', genre: '', tone: '', characters: [], relationships: [], locations: [], world_rules: [], arcs: [] };

export const EMPTY_CHECKPOINT: EpisodeCheckpoint = {
  summary: '',
  ending_hook: '',
  location_key: '',
  time_label: '',
  characters: [],
  events: [],
  arcs_progressed: [],
  arcs_resolved: [],
  arcs_opened: [],
};
