import type { Brief, CreationMode } from '../create/modes.ts';

/**
 * Script assistant. Only the deterministic mock is implemented: it never calls an external API and
 * never invents facts. Drafts reuse what the user typed in the brief; missing facts become visible
 * [placeholders]. Results are proposals; the editor applies them only after the user reviews them.
 */
export const ASSIST_ACTIONS = ['draft', 'rewrite', 'shorten', 'expand', 'translate', 'tone', 'regenerate_scene'] as const;
export type AssistAction = (typeof ASSIST_ACTIONS)[number];
export const ASSIST_TONES = ['friendly', 'professional', 'playful', 'premium', 'energetic', 'calm'] as const;
export type AssistTone = (typeof ASSIST_TONES)[number];
export const ASSIST_LANGUAGES = ['en', 'fr', 'ar', 'de'] as const;

export const SCRIPT_FIELDS = ['narration', 'dialogue', 'on_screen_text', 'visual_prompt', 'camera_prompt'] as const;
export type ScriptField = (typeof SCRIPT_FIELDS)[number];

export interface AssistScene {
  title: string;
  duration_seconds: number;
  participants: string[];
  narration: string;
  dialogue: string;
  on_screen_text: string;
  visual_prompt: string;
  camera_prompt: string;
}

export interface AssistInput {
  action: AssistAction;
  /** Scenes to act on (0-based). Empty = whole script. */
  scenes: number[];
  tone?: AssistTone;
  target_language?: string;
  /** Changes the variation of draft/regenerate output. */
  variant?: number;
  project: {
    title: string;
    creation_mode: CreationMode;
    creation_brief: Brief;
    brief: string;
    visual_style: string;
    language_code: string;
    scenes: AssistScene[];
  };
}

export interface FieldProposal {
  field: ScriptField;
  before: string;
  after: string;
}
export interface SceneProposal {
  index: number;
  fields: FieldProposal[];
}
export interface AssistResult {
  provider: 'mock';
  action: AssistAction;
  scenes: SceneProposal[];
}

type Lang = 'en' | 'fr' | 'ar' | 'de';
const PHRASES: Record<Lang, { open: string; addOpening: string; addPoint: string; addCta: string; lead: string; expand: string; friendly: string; premium: string }> = {
  en: { open: 'Meet {s}.', addOpening: '[Add an opening line]', addPoint: '[Add a key point for this scene]', addCta: '[Add your call to action]', lead: 'In short:', expand: 'Here is how it works.', friendly: 'Hi there!', premium: 'Introducing:' },
  fr: { open: 'Voici {s}.', addOpening: '[Ajoutez une phrase d’ouverture]', addPoint: '[Ajoutez un point clé pour cette scène]', addCta: '[Ajoutez votre appel à l’action]', lead: 'En bref :', expand: 'Voici comment ça marche.', friendly: 'Bonjour !', premium: 'Découvrez :' },
  ar: { open: 'تعرّفوا على {s}.', addOpening: '[أضف جملة افتتاحية]', addPoint: '[أضف نقطة رئيسية لهذا المشهد]', addCta: '[أضف دعوتك إلى الإجراء]', lead: 'باختصار:', expand: 'إليك كيف يعمل.', friendly: 'مرحبًا!', premium: 'نقدّم لكم:' },
  de: { open: 'Das ist {s}.', addOpening: '[Einleitungssatz hinzufügen]', addPoint: '[Kernaussage für diese Szene hinzufügen]', addCta: '[Handlungsaufforderung hinzufügen]', lead: 'Kurz gesagt:', expand: 'So funktioniert es.', friendly: 'Hallo!', premium: 'Vorgestellt:' },
};
const lang = (code: string): Lang => (code === 'fr' || code === 'ar' || code === 'de' ? code : 'en');

const CAMERA: Record<'open' | 'body' | 'close', string[]> = {
  open: ['Slow push-in, eye level', 'Wide establishing shot, slow dolly', 'Top-down reveal, then tilt up'],
  body: ['Medium shot, gentle pan', 'Close-up detail, shallow depth of field', 'Over-the-shoulder, handheld'],
  close: ['Close-up, static, centred', 'Slow pull-back to wide', 'Static medium shot, subject facing camera'],
};

const str = (b: Brief, k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '');
const arr = (b: Brief, k: string) => (Array.isArray(b[k]) ? (b[k] as string[]).filter((x) => x.trim()) : []);
const sentence = (t: string) => (/[.!?؟…]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
const fill = (tpl: string, s: string) => tpl.replace('{s}', s);

function facts(p: AssistInput['project']) {
  const b = p.creation_brief;
  const subject = str(b, 'productName') || str(b, 'businessName') || str(b, 'topic') || p.title.trim();
  const points = [...arr(b, 'sellingPoints'), ...arr(b, 'keyPoints'), ...arr(b, 'talkingPoints')];
  if (points.length === 0) for (const k of ['productDescription', 'problem', 'premise', 'description']) if (str(b, k)) points.push(str(b, k));
  const offer = [str(b, 'offer'), str(b, 'price')].filter(Boolean).join(' — ');
  return { subject, points, hook: str(b, 'hook'), cta: str(b, 'callToAction'), offer, direction: str(b, 'visualDirection') };
}

function beat(index: number, total: number): 'open' | 'body' | 'close' {
  if (index === 0) return 'open';
  if (index === total - 1 && total > 1) return 'close';
  return 'body';
}

/** Draft for one scene, built only from the brief. */
export function draftScene(p: AssistInput['project'], index: number, variant = 0): Record<ScriptField, string> {
  const L = PHRASES[lang(p.language_code)];
  const f = facts(p);
  const scene = p.scenes[index]!;
  const total = p.scenes.length;
  const b = beat(index, total);
  const bodyIndex = index - 1;
  const lastBody = index === total - 2;
  let narration: string;
  let onScreen = '';
  if (b === 'open') {
    narration = f.hook ? sentence(f.hook) : f.subject ? fill(L.open, f.subject) : L.addOpening;
    onScreen = f.subject;
  } else if (b === 'close') {
    narration = f.cta ? sentence(f.cta) : L.addCta;
    onScreen = f.cta;
  } else if (lastBody && f.offer) {
    narration = sentence(f.offer);
    onScreen = f.offer;
  } else {
    const point = f.points.length ? f.points[(bodyIndex + variant) % f.points.length]! : '';
    narration = point ? sentence(point) : L.addPoint;
  }
  const subjectForVisual = f.subject || scene.title || 'the subject';
  const direction = f.direction ? `${f.direction} ` : '';
  const visual = `${direction}shot of ${subjectForVisual}: ${scene.title || `scene ${index + 1}`}${p.visual_style ? `. Style: ${p.visual_style}` : ''}`.trim();
  const ugc = p.creation_mode === 'ugc_ad';
  const speakers = scene.participants;
  const dialogue = ugc ? `CREATOR: ${narration}` : speakers.length > 0 ? speakers.map((id, i) => `${id.toUpperCase()}: ${i === 0 ? narration : L.addPoint}`).join('\n') : '';
  return {
    narration: ugc || speakers.length > 0 ? '' : narration,
    dialogue,
    on_screen_text: onScreen,
    visual_prompt: visual.charAt(0).toUpperCase() + visual.slice(1),
    camera_prompt: CAMERA[b][variant % CAMERA[b].length]!,
  };
}

const splitSentences = (t: string) => t.split(/(?<=[.!?؟…])\s+/).filter(Boolean);

/** Applies a text transform to each "NAME: line" of dialogue, keeping speaker labels. */
function perLine(text: string, fn: (s: string) => string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = /^([A-Z0-9_ ]{2,40}):\s*(.*)$/.exec(line);
      return m ? `${m[1]}: ${m[2] ? fn(m[2]) : ''}` : line.trim() ? fn(line) : line;
    })
    .join('\n');
}

export function rewriteText(t: string, code: string): string {
  const parts = splitSentences(t.trim());
  if (parts.length === 0) return t;
  if (parts.length > 1) return [...parts.slice(1), parts[0]].join(' ');
  return `${PHRASES[lang(code)].lead} ${parts[0]}`;
}

export function shortenText(t: string): string {
  const words = t.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 4) return t;
  const keep = Math.max(3, Math.ceil(words.length * 0.6));
  return `${words.slice(0, keep).join(' ').replace(/[.,;:!?؟…]+$/, '')}…`;
}

export function expandText(t: string, extra: string): string {
  if (!t.trim()) return t;
  return `${sentence(t)} ${sentence(extra)}`;
}

export function toneText(t: string, tone: AssistTone, code: string): string {
  if (!t.trim()) return t;
  const L = PHRASES[lang(code)];
  const plain = t.replace(/!+/g, '.').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s{2,}/g, ' ').trim();
  switch (tone) {
    case 'energetic':
      return splitSentences(t.trim()).map((s) => s.replace(/[.…]$/, '') + (/[!?؟]$/.test(s) ? '' : '!')).join(' ');
    case 'calm':
    case 'professional':
      return plain;
    case 'friendly':
      return t.startsWith(L.friendly) ? t : `${L.friendly} ${t.trim()}`;
    case 'playful':
      return t.trim().endsWith('✨') ? t : `${t.trim()} ✨`;
    case 'premium':
      return t.startsWith(L.premium) ? t : `${L.premium} ${plain}`;
  }
}

/** Mock translation is clearly marked: real translation needs an AI provider (Milestone 10). */
export function mockTranslate(t: string, target: string): string {
  if (!t.trim()) return t;
  return `[Mock translation → ${target.toUpperCase()}] ${t.replace(/^\[Mock translation → [A-Z]{2}\] /, '')}`;
}

const TEXT_FIELDS: ScriptField[] = ['narration', 'dialogue'];

export function runMockAssist(input: AssistInput): AssistResult {
  const p = input.project;
  const indexes = input.scenes.length ? input.scenes.filter((i) => i >= 0 && i < p.scenes.length) : p.scenes.map((_, i) => i);
  const f = facts(p);
  const L = PHRASES[lang(p.language_code)];
  const out: SceneProposal[] = [];
  for (const i of indexes) {
    const s = p.scenes[i]!;
    let next: Partial<Record<ScriptField, string>> = {};
    switch (input.action) {
      case 'draft':
        next = draftScene(p, i, input.variant ?? 0);
        break;
      case 'regenerate_scene':
        next = draftScene(p, i, (input.variant ?? 0) + 1);
        break;
      case 'rewrite':
        for (const k of TEXT_FIELDS) next[k] = k === 'dialogue' ? perLine(s[k], (x) => rewriteText(x, p.language_code)) : rewriteText(s[k], p.language_code);
        break;
      case 'shorten':
        for (const k of [...TEXT_FIELDS, 'on_screen_text'] as ScriptField[]) next[k] = k === 'dialogue' ? perLine(s[k], shortenText) : shortenText(s[k]);
        break;
      case 'expand': {
        const unused = f.points.find((pt) => !p.scenes.some((sc) => sc.narration.includes(pt) || sc.dialogue.includes(pt)));
        next.narration = expandText(s.narration, unused ?? L.expand);
        break;
      }
      case 'translate': {
        const target = input.target_language ?? 'en';
        for (const k of [...TEXT_FIELDS, 'on_screen_text'] as ScriptField[]) next[k] = k === 'dialogue' ? perLine(s[k], (x) => mockTranslate(x, target)) : mockTranslate(s[k], target);
        break;
      }
      case 'tone': {
        const tone = input.tone ?? 'friendly';
        for (const k of TEXT_FIELDS) next[k] = k === 'dialogue' ? perLine(s[k], (x) => toneText(x, tone, p.language_code)) : toneText(s[k], tone, p.language_code);
        break;
      }
    }
    const fields: FieldProposal[] = [];
    for (const k of SCRIPT_FIELDS) {
      const after = next[k];
      if (after !== undefined && after !== s[k]) fields.push({ field: k, before: s[k], after });
    }
    if (fields.length) out.push({ index: i, fields });
  }
  return { provider: 'mock', action: input.action, scenes: out };
}
