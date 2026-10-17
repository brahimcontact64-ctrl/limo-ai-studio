import type { ProjectDraft, SceneDraft, SceneTextField } from './types.ts';

export type DiffSegment = { type: 'same' | 'add' | 'del'; text: string };

const MAX_TOKENS = 1500;

/** Word-level diff (LCS). Whitespace is kept as tokens so the output reproduces both texts exactly. */
export function diffWords(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ type: 'same', text: before }] : [];
  const a = before.split(/(\s+)/).filter(Boolean);
  const b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > MAX_TOKENS * MAX_TOKENS || a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return [...(before ? [{ type: 'del' as const, text: before }] : []), ...(after ? [{ type: 'add' as const, text: after }] : [])];
  }
  const n = a.length;
  const m = b.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }
  const out: DiffSegment[] = [];
  const emit = (type: DiffSegment['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      emit('same', a[i]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) emit('del', a[i++]!);
    else emit('add', b[j++]!);
  }
  while (i < n) emit('del', a[i++]!);
  while (j < m) emit('add', b[j++]!);
  return out;
}

export const COMPARED_SCENE_FIELDS: SceneTextField[] = [
  'title',
  'narration',
  'dialogue',
  'visual_prompt',
  'camera_prompt',
  'on_screen_text',
  'action_prompt',
  'location_prompt',
  'environment_prompt',
  'lighting_prompt',
  'effects_prompt',
  'music_prompt',
  'transition_out',
  'continuity_notes',
];
const PROJECT_FIELDS = ['title', 'brief', 'goal', 'visual_style'] as const;

export type DraftChange =
  | { kind: 'project'; field: (typeof PROJECT_FIELDS)[number] | 'creation_brief' | 'cast' | 'language_code' | 'creation_mode'; before: string; after: string }
  | { kind: 'scene_added'; index: number; title: string }
  | { kind: 'scene_removed'; index: number; title: string }
  | { kind: 'scene'; index: number; field: SceneTextField | 'duration_seconds' | 'participants' | 'asset_ids'; before: string; after: string };

const list = (v: string[]) => v.join(', ');

/** Changes needed to go from `before` to `after`. Scenes are compared by position (scene order). */
export function compareDrafts(before: ProjectDraft, after: ProjectDraft): DraftChange[] {
  const out: DraftChange[] = [];
  for (const f of PROJECT_FIELDS) if (before[f] !== after[f]) out.push({ kind: 'project', field: f, before: before[f], after: after[f] });
  if (before.creation_mode !== after.creation_mode) out.push({ kind: 'project', field: 'creation_mode', before: before.creation_mode, after: after.creation_mode });
  if (before.language_code !== after.language_code) out.push({ kind: 'project', field: 'language_code', before: before.language_code, after: after.language_code });
  const bb = JSON.stringify(before.creation_brief);
  const ab = JSON.stringify(after.creation_brief);
  if (bb !== ab) out.push({ kind: 'project', field: 'creation_brief', before: briefText(before.creation_brief), after: briefText(after.creation_brief) });
  if (list(before.cast) !== list(after.cast)) out.push({ kind: 'project', field: 'cast', before: list(before.cast), after: list(after.cast) });

  const max = Math.max(before.scenes.length, after.scenes.length);
  for (let i = 0; i < max; i++) {
    const b = before.scenes[i];
    const a = after.scenes[i];
    if (!b && a) out.push({ kind: 'scene_added', index: i, title: a.title });
    else if (b && !a) out.push({ kind: 'scene_removed', index: i, title: b.title });
    else if (a && b) out.push(...compareScene(i, b, a));
  }
  return out;
}

function compareScene(index: number, b: SceneDraft, a: SceneDraft): DraftChange[] {
  const out: DraftChange[] = [];
  for (const f of COMPARED_SCENE_FIELDS) if (b[f] !== a[f]) out.push({ kind: 'scene', index, field: f, before: b[f], after: a[f] });
  if (b.duration_seconds !== a.duration_seconds) out.push({ kind: 'scene', index, field: 'duration_seconds', before: String(b.duration_seconds), after: String(a.duration_seconds) });
  if (list(b.participants) !== list(a.participants)) out.push({ kind: 'scene', index, field: 'participants', before: list(b.participants), after: list(a.participants) });
  if (list(b.asset_ids) !== list(a.asset_ids)) out.push({ kind: 'scene', index, field: 'asset_ids', before: String(b.asset_ids.length), after: String(a.asset_ids.length) });
  return out;
}

function briefText(b: Record<string, string | string[]>): string {
  return Object.keys(b)
    .sort()
    .map((k) => `${k}: ${Array.isArray(b[k]) ? (b[k] as string[]).join(', ') : b[k]}`)
    .join('\n');
}
