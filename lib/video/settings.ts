import { DEFAULT_VIDEO_SETTINGS, QUALITIES, RESOLUTIONS, SUBTITLE_MODES, TRANSITIONS, VIDEO_ASPECTS, type Transition, type VideoSettings } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const O = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const pick = <T extends string | number>(list: readonly T[], v: unknown, d: T): T => ((list as readonly unknown[]).includes(v) ? (v as T) : d);
const num = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);

/** Normalises untrusted video settings (browser input or stored JSON). Unknown fields are dropped. */
export function normalizeVideoSettings(raw: unknown): VideoSettings {
  const r = O(raw);
  const d = DEFAULT_VIDEO_SETTINGS;
  const scenes: VideoSettings['scenes'] = {};
  for (const [key, value] of Object.entries(O(r.scenes)).slice(0, 60)) {
    if (!/^\d{1,3}$/.test(key)) continue;
    const s = O(value);
    const t = s.transition === '' ? '' : pick<Transition | ''>(TRANSITIONS, s.transition, '');
    scenes[key] = {
      media_asset_id: id(s.media_asset_id),
      fit: s.fit === 'contain' ? 'contain' : 'cover',
      show_text: s.show_text !== false,
      transition: t,
    };
  }
  return {
    aspect: pick(VIDEO_ASPECTS, r.aspect, d.aspect),
    resolution: pick(RESOLUTIONS, r.resolution, d.resolution),
    quality: pick(QUALITIES, r.quality, d.quality),
    transition: pick(TRANSITIONS, r.transition, d.transition),
    transition_seconds: Math.round(num(r.transition_seconds, d.transition_seconds, 0.2, 1.5) * 10) / 10,
    music_asset_id: id(r.music_asset_id),
    music_volume: Math.round(num(r.music_volume, d.music_volume, 0, 1) * 100) / 100,
    subtitles: pick(SUBTITLE_MODES, r.subtitles, d.subtitles),
    text_position: pick(['top', 'center', 'bottom'] as const, r.text_position, d.text_position),
    text_size: pick(['small', 'medium', 'large'] as const, r.text_size, d.text_size),
    logo: r.logo === true,
    scenes,
  };
}

/** Maps render database errors to stable API codes. */
export function renderError(message: string | undefined | null): { code: string; status: number } {
  const m = message ?? '';
  if (/approve the script/i.test(m)) return { code: 'script_not_approved', status: 409 };
  if (/approve the episode/i.test(m)) return { code: 'episode_not_approved', status: 409 };
  if (/needs review/i.test(m)) return { code: 'episode_needs_review', status: 409 };
  if (/too many videos/i.test(m)) return { code: 'too_many_renders', status: 429 };
  if (/video (slot|credit) limit/i.test(m)) return { code: 'video_limit_reached', status: 402 };
  if (/active subscription/i.test(m)) return { code: 'subscription_required', status: 402 };
  if (/videos are limited to/i.test(m)) return { code: 'too_long', status: 422 };
  if (/scene media|background music|this workspace/i.test(m)) return { code: 'foreign_asset', status: 403 };
  if (/brand kit/i.test(m)) return { code: 'no_logo', status: 422 };
  if (/has no duration|no scenes|timeline is inconsistent/i.test(m)) return { code: 'invalid_timeline', status: 422 };
  if (/approval changed/i.test(m)) return { code: 'approval_changed', status: 409 };
  if (/already finished|only failed or cancelled/i.test(m)) return { code: 'invalid_state', status: 409 };
  if (/not authorized|authentication required/i.test(m)) return { code: 'not_authorized', status: 403 };
  if (/not found/i.test(m)) return { code: 'not_found', status: 404 };
  return { code: 'invalid', status: 422 };
}
