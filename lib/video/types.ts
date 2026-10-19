/**
 * Video export (Milestone 7). A render spec is created by the database (`enqueue_render_job`) from one
 * APPROVED script revision: scene order, durations and text are copied from that revision; presentation
 * choices (format, quality, transitions, music, subtitles, text style, logo, per-scene media) come from
 * the video settings. The worker renders exactly this spec. Nothing here is AI-generated footage.
 */
export const VIDEO_ASPECTS = ['9:16', '16:9', '1:1', '4:5'] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];

export const RESOLUTIONS = [480, 720, 1080] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const QUALITIES = ['draft', 'standard', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];

export const TRANSITIONS = ['cut', 'fade', 'crossfade', 'slide', 'wipe'] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const SUBTITLE_MODES = ['off', 'narration', 'dialogue'] as const;
export type SubtitleMode = (typeof SUBTITLE_MODES)[number];

/** Mirrors `limo_render_size` in the migration (short side 480 / 720 / 1080; even sizes for H.264). */
export function renderSize(aspect: VideoAspect, resolution: Resolution): { width: number; height: number } {
  const long = resolution === 480 ? 854 : resolution === 720 ? 1280 : 1920;
  const portrait45 = resolution === 480 ? 600 : resolution === 720 ? 900 : 1350;
  if (aspect === '9:16') return { width: resolution, height: long };
  if (aspect === '16:9') return { width: long, height: resolution };
  if (aspect === '1:1') return { width: resolution, height: resolution };
  return { width: resolution, height: portrait45 };
}

export interface SpecMedia {
  asset_id: string;
  path: string;
  media_type: 'image' | 'video' | 'audio';
  mime: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
}

export interface SpecScene {
  scene_number: number;
  title: string;
  duration_ms: number;
  start_ms: number;
  on_screen_text: string;
  narration: string;
  dialogue: string;
  transition: Transition;
  visual: SpecMedia | null;
  audio: SpecMedia | null;
  fit: 'cover' | 'contain';
  show_text: boolean;
  participants: string[];
  /** Animation exports: keep the clip's own sound (e.g. Veo native audio) at this volume (0 = mute). */
  clip_audio?: { volume: number } | null;
  /** Animation exports: voice lines mixed into the shot at their offsets (ms from the start of the shot). */
  audio_layers?: Array<SpecMedia & { offset_ms: number; volume: number }>;
}

export interface RenderSpec {
  version: 1;
  title: string;
  language_code: string;
  width: number;
  height: number;
  fps: number;
  quality: Quality;
  transition_seconds: number;
  subtitles: SubtitleMode;
  text_position: 'top' | 'center' | 'bottom';
  text_size: 'small' | 'medium' | 'large';
  music: (SpecMedia & { volume: number }) | null;
  logo: SpecMedia | null;
  brand: { primary: string; secondary: string };
  scenes: SpecScene[];
}

/** Presentation settings saved per project (`video_settings`) and sent with an export request. */
export interface VideoSettings {
  aspect: VideoAspect;
  resolution: Resolution;
  quality: Quality;
  transition: Transition;
  transition_seconds: number;
  music_asset_id: string | null;
  music_volume: number;
  subtitles: SubtitleMode;
  text_position: 'top' | 'center' | 'bottom';
  text_size: 'small' | 'medium' | 'large';
  logo: boolean;
  scenes: Record<string, { media_asset_id?: string | null; fit?: 'cover' | 'contain'; show_text?: boolean; transition?: Transition | '' }>;
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspect: '9:16',
  resolution: 720,
  quality: 'standard',
  transition: 'fade',
  transition_seconds: 0.5,
  music_asset_id: null,
  music_volume: 0.3,
  subtitles: 'off',
  text_position: 'bottom',
  text_size: 'medium',
  logo: false,
  scenes: {},
};

export type RenderStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
