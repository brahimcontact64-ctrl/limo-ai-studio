/**
 * Persisted storyboard (migration 20261019090000) ⇄ Scenario (scenario.ts), timelines, continuity and audio mix
 * planning. Pure and shared by the API, the editor and the worker.
 */
import type { ExpressionKey } from '../characters/canon.ts';
import type { Locale } from '../providers/contracts.ts';
import { MAX_WORDS_PER_SECOND, type DialogueLine, type Scenario, type ScenarioScene } from './scenario.ts';

export const SHOT_STATUSES = ['draft', 'keyframe_queued', 'keyframe_review', 'keyframe_approved', 'clip_queued', 'clip_review', 'approved'] as const;
export type ShotStatus = (typeof SHOT_STATUSES)[number];

export interface Continuity {
  /** The shot continues the previous one (same place and moment). */
  continues_from_previous?: boolean;
  /** Use the previous shot's approved last frame as this shot's first frame (Veo image-to-video). */
  use_previous_last_frame?: boolean;
  environment_key?: string;
  lighting?: string;
  time_of_day?: string;
  notes?: string;
}

export interface VoiceTrack {
  line: number;
  speaker: string;
  asset_id: string;
  offset_ms: number;
  duration_ms: number;
}

export interface ShotRow {
  id: string;
  shot_number: number;
  duration_seconds: 4 | 6 | 8;
  description: string;
  environment: string;
  camera: string;
  characters: string[];
  actions: Record<string, string>;
  expressions: Record<string, ExpressionKey>;
  dialogue: DialogueLine[];
  narration: string;
  sound: string;
  continuity: Continuity;
  reference_asset_ids: string[];
  status: ShotStatus;
  keyframe_asset_id: string | null;
  first_frame_asset_id: string | null;
  last_frame_asset_id: string | null;
  clip_asset_id: string | null;
  voice_tracks: VoiceTrack[];
  clip_audio: 'keep' | 'mute';
  revision: number;
  last_error: string | null;
}

export interface ProjectRow {
  id: string;
  organization_id: string;
  title: string;
  language_code: Locale;
  aspect: '9:16' | '16:9';
  music_asset_id: string | null;
  music_note: string;
  settings: { tier?: 'fast' | 'standard'; resolution?: '720p' | '1080p'; voice_mode?: 'native' | 'separate'; lip_sync?: boolean; takes?: number };
  status: 'draft' | 'in_production' | 'ready' | 'archived';
  revision: number;
}

export function toScenario(p: Pick<ProjectRow, 'title' | 'language_code' | 'aspect' | 'music_note'>, shots: ShotRow[]): Scenario {
  return {
    title: p.title, language: p.language_code, aspect: p.aspect, music: p.music_note || undefined,
    scenes: [...shots].sort((a, b) => a.shot_number - b.shot_number).map((s): ScenarioScene => ({
      number: s.shot_number, durationSeconds: s.duration_seconds, description: s.description, environment: s.environment, characters: s.characters,
      actions: s.actions, expressions: s.expressions, camera: s.camera, dialogue: s.dialogue, narration: s.narration || undefined, sound: s.sound || undefined,
    })),
  };
}

/** Payload for save_animation_shots (only editable fields; status and generated files are server-owned). */
export function toSavePayload(shots: Array<Partial<ShotRow> & Pick<ShotRow, 'duration_seconds'>>): Array<Record<string, unknown>> {
  return shots.map((s) => ({
    id: s.id ?? null, duration_seconds: s.duration_seconds, description: s.description ?? '', environment: s.environment ?? '', camera: s.camera ?? '',
    characters: s.characters ?? [], actions: s.actions ?? {}, expressions: s.expressions ?? {}, dialogue: s.dialogue ?? [], narration: s.narration ?? '',
    sound: s.sound ?? '', continuity: s.continuity ?? {}, reference_asset_ids: s.reference_asset_ids ?? [], clip_audio: s.clip_audio ?? 'keep',
  }));
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

export interface TimelineItem {
  shot: number;
  kind: 'narration' | 'dialogue';
  speaker: string | null;
  text: string;
  /** Position in the whole video. */
  start_ms: number;
  end_ms: number;
  /** Measured from generated audio (true) or planned from the text length (false). */
  measured: boolean;
}

/**
 * Dialogue and narration timeline for the whole video. Generated voice tracks give measured positions; otherwise
 * lines are planned in order inside their shot at a natural pace (≤ 2.5 words/s), starting 300 ms after the cut.
 */
export function dialogueTimeline(shots: ShotRow[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  let shotStart = 0;
  for (const s of [...shots].sort((a, b) => a.shot_number - b.shot_number)) {
    const lines: Array<{ kind: 'narration' | 'dialogue'; speaker: string | null; text: string }> = [
      ...(s.narration.trim() ? [{ kind: 'narration' as const, speaker: null, text: s.narration }] : []),
      ...s.dialogue.map((d) => ({ kind: 'dialogue' as const, speaker: d.speaker, text: d.text })),
    ];
    let t = 300;
    lines.forEach((l, i) => {
      const track = s.voice_tracks.find((v) => v.line === i);
      const dur = track ? track.duration_ms : Math.round((words(l.text) / MAX_WORDS_PER_SECOND) * 1000);
      const start = track ? track.offset_ms : t;
      out.push({ shot: s.shot_number, ...l, start_ms: shotStart + start, end_ms: shotStart + start + dur, measured: !!track });
      t = start + dur + 250;
    });
    shotStart += s.duration_seconds * 1000;
  }
  return out;
}

export interface ContinuityIssue {
  shot: number;
  code: 'speech_overruns_shot' | 'previous_last_frame_missing' | 'continuity_environment_changed' | 'reference_missing' | 'overlapping_speech';
  detail: string;
}

/** Shot-to-shot continuity checks shown in the editor before anything is generated. */
export function continuityIssues(shots: ShotRow[]): ContinuityIssue[] {
  const sorted = [...shots].sort((a, b) => a.shot_number - b.shot_number);
  const tl = dialogueTimeline(sorted);
  const out: ContinuityIssue[] = [];
  let start = 0;
  sorted.forEach((s, i) => {
    const end = start + s.duration_seconds * 1000;
    const mine = tl.filter((x) => x.shot === s.shot_number);
    if (mine.some((x) => x.end_ms > end)) out.push({ shot: s.shot_number, code: 'speech_overruns_shot', detail: 'the lines do not fit in the shot; shorten them or lengthen the shot' });
    for (let k = 1; k < mine.length; k++) if (mine[k]!.start_ms < mine[k - 1]!.end_ms) out.push({ shot: s.shot_number, code: 'overlapping_speech', detail: 'two lines overlap' });
    const prev = sorted[i - 1];
    if (s.continuity.use_previous_last_frame && (!prev || (!prev.last_frame_asset_id && !prev.clip_asset_id))) {
      out.push({ shot: s.shot_number, code: 'previous_last_frame_missing', detail: 'the previous shot has no approved clip or last frame yet' });
    }
    if (prev && s.continuity.continues_from_previous && s.continuity.environment_key && prev.continuity.environment_key && s.continuity.environment_key !== prev.continuity.environment_key) {
      out.push({ shot: s.shot_number, code: 'continuity_environment_changed', detail: 'marked as continuing the previous shot but the environment differs' });
    }
    const refChars = new Set(s.characters);
    if (refChars.size > 0 && s.reference_asset_ids.length === 0) out.push({ shot: s.shot_number, code: 'reference_missing', detail: 'attach the approved references of the characters in this shot' });
    start = end;
  });
  return out;
}

export interface AudioMixPlan {
  total_ms: number;
  music: { asset_id: string; volume: number } | null;
  shots: Array<{ shot: number; start_ms: number; clip_audio_volume: number; layers: Array<{ asset_id: string; offset_ms: number; volume: number }> }>;
}

/** What the render worker mixes: each clip's own audio (Veo native sound) unless muted, voice lines at their offsets, music. */
export function audioMixPlan(p: Pick<ProjectRow, 'music_asset_id'>, shots: ShotRow[], musicVolume = 0.25): AudioMixPlan {
  let start = 0;
  const out: AudioMixPlan['shots'] = [];
  for (const s of [...shots].sort((a, b) => a.shot_number - b.shot_number)) {
    out.push({ shot: s.shot_number, start_ms: start, clip_audio_volume: s.clip_audio === 'keep' ? 1 : 0, layers: s.voice_tracks.map((v) => ({ asset_id: v.asset_id, offset_ms: v.offset_ms, volume: 1 })) });
    start += s.duration_seconds * 1000;
  }
  return { total_ms: start, music: p.music_asset_id ? { asset_id: p.music_asset_id, volume: musicVolume } : null, shots: out };
}

/** The first frame Veo should start from: the approved keyframe, or the previous shot's last frame when chosen. */
export function firstFrameFor(shot: ShotRow, previous: ShotRow | undefined): string | null {
  if (shot.continuity.use_previous_last_frame && previous?.last_frame_asset_id) return previous.last_frame_asset_id;
  return shot.first_frame_asset_id ?? shot.keyframe_asset_id;
}

/** UI step of a shot: what the owner can do next. */
export function nextAction(s: Pick<ShotRow, 'status'>): 'request_keyframe' | 'wait' | 'review_keyframe' | 'request_clip' | 'review_clip' | 'done' {
  switch (s.status) {
    case 'draft':
      return 'request_keyframe';
    case 'keyframe_queued':
    case 'clip_queued':
      return 'wait';
    case 'keyframe_review':
      return 'review_keyframe';
    case 'keyframe_approved':
      return 'request_clip';
    case 'clip_review':
      return 'review_clip';
    default:
      return 'done';
  }
}
