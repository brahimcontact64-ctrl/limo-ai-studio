/**
 * Imports the owner's scenario (JSON template, docs/ANIMATION_PIPELINE.md §9) into storyboard shots. Only shape and
 * types are checked here; the editor then shows the full validation (30 s, 4/6/8 s, speakers, references) and the
 * database enforces it on save. Nothing is invented: missing text stays empty.
 */
import { EXPRESSION_KEYS, type ExpressionKey } from '../characters/canon.ts';
import type { DialogueLine } from './scenario.ts';
import type { Continuity } from './storyboard.ts';

export interface ImportedShot {
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
  /** Optional continuity metadata (same keys as the editor). */
  continuity: Continuity;
  clip_audio: 'keep' | 'mute';
}
export interface ImportedScenario {
  title?: string;
  language?: 'en' | 'fr' | 'ar' | 'de';
  aspect?: '9:16' | '16:9';
  music?: string;
  shots: ImportedShot[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const isExpr = (v: unknown): v is ExpressionKey => typeof v === 'string' && (EXPRESSION_KEYS as readonly string[]).includes(v);

function continuityOf(v: unknown, hasPrevious: boolean): Continuity {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const c = v as Record<string, unknown>;
  const out: Continuity = {};
  if (hasPrevious && c.continuesFromPrevious === true) out.continues_from_previous = true;
  if (hasPrevious && c.usePreviousLastFrame === true) out.use_previous_last_frame = true;
  for (const [k, key] of [['environmentKey', 'environment_key'], ['lighting', 'lighting'], ['timeOfDay', 'time_of_day'], ['notes', 'notes']] as const) {
    if (typeof c[k] === 'string' && (c[k] as string).trim()) out[key] = (c[k] as string).slice(0, k === 'notes' ? 300 : 120);
  }
  return out;
}

export function parseScenarioJson(text: string): { scenario: ImportedScenario | null; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { scenario: null, errors: ['not valid JSON'] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { scenario: null, errors: ['the scenario must be an object'] };
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];
  const scenes = Array.isArray(r.scenes) ? r.scenes : null;
  if (!scenes || scenes.length === 0) errors.push('"scenes" must be a non-empty list');
  if (scenes && scenes.length > 15) errors.push('at most 15 scenes');
  const shots: ImportedShot[] = [];
  (scenes ?? []).slice(0, 15).forEach((s, i) => {
    const n = i + 1;
    if (!s || typeof s !== 'object') return errors.push(`scene ${n}: not an object`);
    const x = s as Record<string, unknown>;
    const d = Number(x.durationSeconds ?? x.duration_seconds);
    if (![4, 6, 8].includes(d)) errors.push(`scene ${n}: durationSeconds must be 4, 6 or 8`);
    const characters = Array.isArray(x.characters) ? x.characters.filter((c): c is string => typeof c === 'string').slice(0, 5) : [];
    const actions = x.actions && typeof x.actions === 'object' && !Array.isArray(x.actions) ? Object.fromEntries(Object.entries(x.actions as Record<string, unknown>).filter(([k]) => characters.includes(k)).map(([k, v]) => [k, str(v, 300)])) : {};
    const expressions = x.expressions && typeof x.expressions === 'object' ? Object.fromEntries(Object.entries(x.expressions as Record<string, unknown>).filter(([k, v]) => characters.includes(k) && isExpr(v))) as Record<string, ExpressionKey> : {};
    const dialogue: DialogueLine[] = Array.isArray(x.dialogue)
      ? x.dialogue.filter((l): l is Record<string, unknown> => !!l && typeof l === 'object').map((l) => ({ speaker: str(l.speaker, 80), text: str(l.text, 400), ...(isExpr(l.emotion) ? { emotion: l.emotion } : {}) }))
      : [];
    dialogue.forEach((l) => {
      if (!characters.includes(l.speaker)) errors.push(`scene ${n}: speaker "${l.speaker}" is not in "characters"`);
    });
    shots.push({
      duration_seconds: ([4, 6, 8].includes(d) ? d : 8) as 4 | 6 | 8,
      description: str(x.description, 2000), environment: str(x.environment, 1000), camera: str(x.camera, 500),
      characters, actions, expressions, dialogue, narration: str(x.narration, 1000), sound: str(x.sound, 500),
      continuity: continuityOf(x.continuity, n > 1),
      clip_audio: x.clipAudio === 'mute' || x.clip_audio === 'mute' ? 'mute' : 'keep',
    });
  });
  const total = shots.reduce((a, s) => a + s.duration_seconds, 0);
  if (total > 30) errors.push(`total ${total} s is over the 30 s limit`);
  return {
    scenario: {
      title: typeof r.title === 'string' ? r.title.slice(0, 150) : undefined,
      language: ['en', 'fr', 'ar', 'de'].includes(r.language as string) ? (r.language as ImportedScenario['language']) : undefined,
      aspect: r.aspect === '16:9' || r.aspect === '9:16' ? r.aspect : undefined,
      music: typeof r.music === 'string' ? r.music.slice(0, 500) : undefined,
      shots,
    },
    errors,
  };
}
