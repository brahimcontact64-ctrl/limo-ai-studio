'use client';
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { formatDuration } from '@/lib/i18n/format';
import { LIMITS, SCENE_FIELD_MAX, parseCharacterId } from '@/lib/studio/limits';
import { moveItem, newScene, sceneKey } from '@/lib/studio/draft';
import { totalDuration, type Issue } from '@/lib/studio/validation';
import type { CharacterRecord, ProjectDraft, SceneDraft, SceneTextField } from '@/lib/studio/types';
import { FamilyGlyph } from '@/components/characters/FamilyGlyph';
import { characterLabel } from '@/components/characters/labels';
import { CastStack } from '@/components/app/ProjectBits';
import { Icon } from '@/components/ui/Icon';
import { TextField, issueMessage } from './fields';

type PromptField = Exclude<SceneTextField, 'title'>;
const GROUPS: Array<{ id: 'setting' | 'performance' | 'post'; fields: PromptField[]; multiline: PromptField[] }> = [
  { id: 'setting', fields: ['location_prompt', 'environment_prompt', 'lighting_prompt', 'camera_prompt'], multiline: [] },
  { id: 'performance', fields: ['action_prompt', 'dialogue', 'on_screen_text'], multiline: ['action_prompt', 'dialogue'] },
  { id: 'post', fields: ['music_prompt', 'effects_prompt', 'transition_out', 'continuity_notes'], multiline: ['continuity_notes'] },
];

const tc = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

function sceneHasContent(s: SceneDraft) {
  return Boolean(s.title.trim() || s.action_prompt.trim() || s.dialogue.trim() || s.location_prompt.trim());
}

export function ScenesStep({
  draft,
  setDraft,
  characters,
  issues,
  goToCast,
}: {
  draft: ProjectDraft;
  setDraft: Dispatch<SetStateAction<ProjectDraft>>;
  characters: CharacterRecord[];
  issues: Issue[];
  goToCast: () => void;
}) {
  const { t } = useI18n();
  const [selectedKey, setSelectedKey] = useState<string>(() => draft.scenes[0]?.key ?? '');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const charMap = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);

  const index = Math.max(0, draft.scenes.findIndex((s) => s.key === selectedKey));
  const scene = draft.scenes[index];
  useEffect(() => {
    if (!draft.scenes.some((s) => s.key === selectedKey) && draft.scenes[0]) setSelectedKey(draft.scenes[0].key);
  }, [draft.scenes, selectedKey]);

  const total = totalDuration(draft.scenes);
  const sceneIssues = (i: number) => issues.filter((x) => x.scene === i);

  const updateScene = (key: string, patch: Partial<SceneDraft>) =>
    setDraft((d) => ({ ...d, scenes: d.scenes.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));

  const addScene = (afterIndex = draft.scenes.length - 1) => {
    if (draft.scenes.length >= LIMITS.scenesMax) return;
    const prev = draft.scenes[afterIndex];
    // Carry the setting forward so consecutive scenes stay in the same place by default.
    const s = newScene({
      participants: prev ? [...prev.participants] : [],
      location_prompt: prev?.location_prompt ?? '',
      environment_prompt: prev?.environment_prompt ?? '',
      lighting_prompt: prev?.lighting_prompt ?? '',
    });
    setDraft((d) => {
      const scenes = [...d.scenes];
      scenes.splice(afterIndex + 1, 0, s);
      return { ...d, scenes };
    });
    setSelectedKey(s.key);
  };

  const duplicateScene = (i: number) => {
    const src = draft.scenes[i];
    if (!src || draft.scenes.length >= LIMITS.scenesMax) return;
    const fresh: SceneDraft = { ...src, participants: [...src.participants], key: sceneKey() };
    setDraft((d) => {
      const scenes = [...d.scenes];
      scenes.splice(i + 1, 0, fresh);
      return { ...d, scenes };
    });
    setSelectedKey(fresh.key);
  };

  const removeScene = (i: number) => {
    const s = draft.scenes[i];
    if (!s || draft.scenes.length <= LIMITS.scenesMin) return;
    if (sceneHasContent(s) && !window.confirm(fmt(t.studio.scenes.removeConfirm, { n: i + 1 }))) return;
    const neighbour = draft.scenes[i + 1] ?? draft.scenes[i - 1];
    setDraft((d) => ({ ...d, scenes: d.scenes.filter((x) => x.key !== s.key) }));
    if (neighbour) setSelectedKey(neighbour.key);
  };

  const move = (from: number, to: number) => setDraft((d) => ({ ...d, scenes: moveItem(d.scenes, from, to) }));

  const toggleParticipant = (id: string) => {
    if (!scene) return;
    updateScene(scene.key, {
      participants: scene.participants.includes(id) ? scene.participants.filter((p) => p !== id) : [...scene.participants, id],
    });
  };

  let elapsed = 0;

  return (
    <div className="step scenes-step">
      <div className="scenes-layout">
        {/* Scene rail */}
        <aside className="scene-rail" aria-label={t.studio.scenes.list}>
          <div className="scene-rail-head">
            <span className="mono xsmall muted ltr">{fmt(t.studio.scenes.limitScenes, { n: draft.scenes.length, max: LIMITS.scenesMax })}</span>
            <span className="mono xsmall ltr">{tc(total)}</span>
          </div>
          <ol className="scene-list">
            {draft.scenes.map((s, i) => {
              const start = elapsed;
              elapsed += s.duration_seconds || 0;
              const hasError = sceneIssues(i).some((x) => x.severity === 'error');
              return (
                <li
                  key={s.key}
                  className={`scene-item${s.key === scene?.key ? ' is-active' : ''}${overIndex === i && dragIndex !== null && dragIndex !== i ? ' drop-target' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(i);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(i));
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverIndex(i);
                  }}
                  onDragLeave={() => setOverIndex((o) => (o === i ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) move(dragIndex, i);
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                >
                  <span className="scene-grip" aria-hidden="true" title={fmt(t.studio.scenes.dragHandle, { n: i + 1 })}>
                    <Icon name="grip" size={14} />
                  </span>
                  <button type="button" className="scene-select" onClick={() => setSelectedKey(s.key)} aria-current={s.key === scene?.key ? 'true' : undefined}>
                    <span className="scene-num mono ltr">
                      SC {String(i + 1).padStart(2, '0')}
                      {hasError && <span className="tab-dot" aria-hidden="true" />}
                    </span>
                    <span className="scene-name">{s.title.trim() || t.studio.scenes.untitledScene}</span>
                    <span className="scene-sub">
                      <CastStack ids={s.participants} max={4} size={18} />
                      <span className="mono ltr">
                        {tc(start)} · {s.duration_seconds}s
                      </span>
                    </span>
                  </button>
                  <span className="scene-order">
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`${t.studio.scenes.moveUp} (${i + 1})`}>
                      <Icon name="chevronUp" size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      disabled={i === draft.scenes.length - 1}
                      onClick={() => move(i, i + 1)}
                      aria-label={`${t.studio.scenes.moveDown} (${i + 1})`}
                    >
                      <Icon name="chevronDown" size={14} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <button type="button" className="btn btn-block" onClick={() => addScene()} disabled={draft.scenes.length >= LIMITS.scenesMax}>
            <Icon name="plus" />
            {t.studio.scenes.add}
          </button>
        </aside>

        {/* Scene editor */}
        {scene ? (
          <section className="scene-editor" aria-labelledby="scene-editor-h">
            <div className="scene-editor-head">
              <div>
                <span className="eyebrow ltr">SC {String(index + 1).padStart(2, '0')}</span>
                <h2 id="scene-editor-h">{scene.title.trim() || fmt(t.studio.scenes.sceneN, { n: index + 1 })}</h2>
              </div>
              <div className="row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => duplicateScene(index)} disabled={draft.scenes.length >= LIMITS.scenesMax}>
                  <Icon name="copy" />
                  <span className="hide-xs">{t.studio.scenes.duplicate}</span>
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeScene(index)} disabled={draft.scenes.length <= LIMITS.scenesMin}>
                  <Icon name="trash" />
                  <span className="hide-xs">{t.studio.scenes.remove}</span>
                </button>
              </div>
            </div>

            {sceneIssues(index).filter((x) => x.severity === 'error').length > 0 && (
              <ul className="issue-list" role="alert">
                {sceneIssues(index)
                  .filter((x) => x.severity === 'error')
                  .map((x, k) => (
                    <li key={k}>{issueMessage(t, { ...x, scene: undefined })}</li>
                  ))}
              </ul>
            )}

            <details className="scene-group" open>
              <summary>
                {t.studio.scenes.groups.basics}
                <Icon name="chevronDown" />
              </summary>
              <div className="scene-group-body">
                <div className="basics-grid">
                  <TextField
                    label={t.studio.scenes.fields.title}
                    value={scene.title}
                    onChange={(v) => updateScene(scene.key, { title: v })}
                    max={SCENE_FIELD_MAX.title}
                    placeholder={fmt(t.studio.scenes.sceneN, { n: index + 1 })}
                    optional
                    dir="auto"
                  />
                  <div className="field">
                    <label className="field-label" htmlFor={`dur-${scene.key}`}>
                      {t.studio.scenes.fields.duration}
                      <small className="mono ltr">{fmt(t.common.seconds, { n: scene.duration_seconds })}</small>
                    </label>
                    <div className="duration-control">
                      <input
                        id={`dur-${scene.key}`}
                        className="range"
                        type="range"
                        min={LIMITS.sceneDurationMin}
                        max={LIMITS.sceneDurationMax}
                        step={1}
                        value={scene.duration_seconds}
                        onChange={(e) => updateScene(scene.key, { duration_seconds: Number(e.target.value) })}
                        aria-describedby={`dur-hint-${scene.key}`}
                      />
                      <input
                        className="input duration-number ltr"
                        type="number"
                        inputMode="numeric"
                        min={LIMITS.sceneDurationMin}
                        max={LIMITS.sceneDurationMax}
                        step={1}
                        value={scene.duration_seconds}
                        aria-label={t.studio.scenes.fields.duration}
                        onChange={(e) => updateScene(scene.key, { duration_seconds: Math.round(Number(e.target.value)) })}
                      />
                    </div>
                    <span id={`dur-hint-${scene.key}`} className="field-hint">
                      {t.studio.scenes.fields.durationHint}
                    </span>
                  </div>
                </div>

                <fieldset className="field plain-fieldset">
                  <legend className="field-label">{t.studio.scenes.fields.participants}</legend>
                  {draft.cast.length === 0 ? (
                    <div className="callout">
                      <Icon name="info" />
                      <div>
                        {t.studio.scenes.emptyCast}
                        <div style={{ marginTop: 8 }}>
                          <button type="button" className="btn btn-sm" onClick={goToCast}>
                            {t.studio.scenes.goToCast}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="participant-grid">
                        {draft.cast.map((id) => {
                          const p = parseCharacterId(id);
                          const on = scene.participants.includes(id);
                          return (
                            <button key={id} type="button" className="chip participant" aria-pressed={on} onClick={() => toggleParticipant(id)}>
                              {p && <FamilyGlyph family={p.family} variant={p.variant} size={22} />}
                              {characterLabel(t, id, charMap.get(id)?.name)}
                            </button>
                          );
                        })}
                      </div>
                      <span className="field-hint">
                        {scene.participants.length === 0 ? t.studio.scenes.noParticipantsWarning : t.studio.scenes.fields.participantsHint}
                      </span>
                    </>
                  )}
                </fieldset>
              </div>
            </details>

            {GROUPS.map((g) => (
              <details key={g.id} className="scene-group" open>
                <summary>
                  {t.studio.scenes.groups[g.id]}
                  <span className="scene-group-count mono xsmall ltr">
                    {g.fields.filter((f) => scene[f].trim()).length}/{g.fields.length}
                  </span>
                  <Icon name="chevronDown" />
                </summary>
                <div className="scene-group-body fields-2">
                  {g.fields.map((f) => (
                    <TextField
                      key={f}
                      label={t.studio.scenes.fields[f]}
                      value={scene[f]}
                      onChange={(v) => updateScene(scene.key, { [f]: v } as Partial<SceneDraft>)}
                      max={SCENE_FIELD_MAX[f]}
                      placeholder={t.studio.scenes.fields[`${f}Placeholder` as const]}
                      multiline={g.multiline.includes(f) || f === 'continuity_notes'}
                      rows={f === 'dialogue' ? 4 : 3}
                      dir="auto"
                      optional
                    />
                  ))}
                </div>
              </details>
            ))}

            <div className="scene-editor-foot">
              <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => setSelectedKey(draft.scenes[index - 1]?.key ?? scene.key)}>
                <Icon name="chevronLeft" className="flip-rtl" />
                {fmt(t.studio.scenes.sceneN, { n: index })}
              </button>
              {index < draft.scenes.length - 1 ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedKey(draft.scenes[index + 1]?.key ?? scene.key)}>
                  {fmt(t.studio.scenes.sceneN, { n: index + 2 })}
                  <Icon name="chevronRight" className="flip-rtl" />
                </button>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => addScene(index)} disabled={draft.scenes.length >= LIMITS.scenesMax}>
                  <Icon name="plus" />
                  {t.studio.scenes.add}
                </button>
              )}
            </div>
          </section>
        ) : (
          <p className="muted">{t.studio.scenes.selectScene}</p>
        )}
      </div>

      {/* Timeline */}
      <div className="timeline" aria-label={t.studio.scenes.timeline}>
        <div className="timeline-head">
          <span className="eyebrow">{t.studio.scenes.timeline}</span>
          <span className="mono xsmall ltr">
            {fmt(t.studio.scenes.total, { duration: formatDuration(t, total) })}
          </span>
        </div>
        <div className="timeline-track">
          {draft.scenes.map((s, i) => (
            <button
              key={s.key}
              type="button"
              className={`timeline-clip${s.key === scene?.key ? ' is-active' : ''}`}
              style={{ flexGrow: Math.max(1, s.duration_seconds) }}
              onClick={() => setSelectedKey(s.key)}
              aria-label={`${fmt(t.studio.scenes.sceneN, { n: i + 1 })} · ${s.duration_seconds}s`}
            >
              <span className="mono ltr">{i + 1}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
