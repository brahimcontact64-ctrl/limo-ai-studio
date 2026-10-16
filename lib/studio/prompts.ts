import type { CharacterRecord, ProjectDraft, SceneDraft } from './types.ts';

/**
 * Deterministic, provider-agnostic scene prompt assembly.
 *
 * Consistency strategy:
 * - Every character is referenced by its stable catalog id, never by a free-text name alone.
 * - The catalog visual_description is injected verbatim as the appearance specification.
 * - When a character has an approved canonical reference (reference_status = 'approved' and
 *   visual_ref set), adapters that support reference images must attach it; otherwise the
 *   prompt is flagged as text-only and generation must stay blocked for that character.
 * - Continuity notes of the previous scene are carried forward.
 */

export interface ScenePrompt {
  sceneNumber: number;
  text: string;
  characterIds: string[];
  /** Character ids whose canonical reference image is not approved yet. */
  missingReferences: string[];
  durationSeconds: number;
}

type CharacterLookup = ReadonlyMap<string, Pick<CharacterRecord, 'id' | 'name' | 'visual_description' | 'reference_status' | 'visual_ref'>>;

function line(label: string, value: string): string | null {
  const v = value.trim();
  return v ? `${label}: ${v}` : null;
}

export function hasApprovedReference(c: { reference_status: string; visual_ref: string | null } | undefined): boolean {
  return Boolean(c && c.reference_status === 'approved' && c.visual_ref);
}

export function buildScenePrompt(
  project: Pick<ProjectDraft, 'title' | 'visual_style' | 'language_code' | 'content_type'>,
  scene: Omit<SceneDraft, 'key'>,
  sceneIndex: number,
  characters: CharacterLookup,
  previousScene?: Omit<SceneDraft, 'key'>,
): ScenePrompt {
  const cast = scene.participants.map((id) => characters.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const castLines = cast.map((c) => {
    const spec = c.visual_description?.trim() || 'Appearance specification pending.';
    return `- [${c.id}] ${c.name}: ${spec}`;
  });

  const parts = [
    `Project: ${project.title.trim() || 'Untitled'} | content type: ${project.content_type} | dialogue language: ${project.language_code}`,
    line('Global visual style', project.visual_style),
    `Scene ${sceneIndex + 1}${scene.title.trim() ? ` — ${scene.title.trim()}` : ''} (${scene.duration_seconds}s)`,
    line('Location', scene.location_prompt),
    line('Environment', scene.environment_prompt),
    line('Lighting', scene.lighting_prompt),
    line('Camera', scene.camera_prompt),
    line('Action', scene.action_prompt),
    line('Dialogue', scene.dialogue),
    line('On-screen text', scene.on_screen_text),
    line('Effects', scene.effects_prompt),
    line('Music direction', scene.music_prompt),
    line('Transition out', scene.transition_out),
    castLines.length ? `Characters (keep identical across all scenes):\n${castLines.join('\n')}` : 'Characters: none (environment-only shot).',
    previousScene?.continuity_notes.trim() ? `Continuity from previous scene: ${previousScene.continuity_notes.trim()}` : null,
    line('Continuity notes', scene.continuity_notes),
    cast.length
      ? 'Constraints: do not alter character colors, facial features, crown/leaf shapes, body proportions or outfits between scenes; no additional characters.'
      : null,
  ];

  return {
    sceneNumber: sceneIndex + 1,
    text: parts.filter((p): p is string => Boolean(p)).join('\n'),
    characterIds: scene.participants,
    missingReferences: scene.participants.filter((id) => !hasApprovedReference(characters.get(id))),
    durationSeconds: scene.duration_seconds,
  };
}

export function buildStoryboard(
  project: Pick<ProjectDraft, 'title' | 'visual_style' | 'language_code' | 'content_type' | 'scenes'>,
  characters: CharacterLookup,
): ScenePrompt[] {
  return project.scenes.map((scene, i) => buildScenePrompt(project, scene, i, characters, i > 0 ? project.scenes[i - 1] : undefined));
}
