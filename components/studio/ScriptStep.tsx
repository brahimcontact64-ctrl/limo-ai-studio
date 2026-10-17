'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { formatDuration } from '@/lib/i18n/format';
import { LIMITS, SCENE_FIELD_MAX } from '@/lib/studio/limits';
import { moveItem } from '@/lib/studio/draft';
import { totalDuration } from '@/lib/studio/validation';
import { ASSIST_TONES, SCRIPT_FIELDS, type AssistAction, type AssistResult, type AssistTone } from '@/lib/ai/script';
import type { ContinuityIssue } from '@/lib/story/continuity';
import type { ProjectDraft } from '@/lib/studio/types';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { ProposalDialog, type AppliedChange } from './ProposalDialog';
import { StepHeader, TextField } from './fields';

const SCENE_ACTIONS: AssistAction[] = ['rewrite', 'shorten', 'expand', 'translate', 'tone', 'regenerate_scene'];
const SCRIPT_ACTIONS: AssistAction[] = ['draft', 'rewrite', 'shorten', 'expand', 'translate', 'tone'];

export function ScriptStep({
  draft,
  setDraft,
  locked,
  languages,
  continuity,
  onAiApplied,
}: {
  draft: ProjectDraft;
  setDraft: Dispatch<SetStateAction<ProjectDraft>>;
  locked: boolean;
  languages: Array<{ code: string; native_name: string }>;
  continuity: ContinuityIssue[];
  onAiApplied: (label: string) => void;
}) {
  const { t } = useI18n();
  const s = t.studio.script;
  const toast = useToast();
  const [tone, setTone] = useState<AssistTone>('friendly');
  const [target, setTarget] = useState(() => languages.find((l) => l.code !== draft.language_code)?.code ?? 'en');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<AssistResult | null>(null);
  const [variant, setVariant] = useState(0);
  const [lastLabel, setLastLabel] = useState('');
  const total = totalDuration(draft.scenes);

  async function assist(action: AssistAction, scenes: number[]) {
    const id = `${action}:${scenes.join(',')}`;
    setBusy(id);
    try {
      const res = await fetch('/api/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, scenes, tone, target_language: target, variant, project: { ...draft, scenes: draft.scenes.map(({ key: _k, ...rest }) => rest) } }),
      });
      const body = (await res.json().catch(() => ({}))) as AssistResult & { error?: string };
      if (!res.ok) return toast(body.error === 'rate_limited' ? t.rateLimited : t.common.errorGeneric, 'error');
      if (action === 'regenerate_scene') setVariant((v) => v + 1);
      if (body.scenes.length === 0) return toast(s.noChanges);
      setLastLabel(`Mock AI: ${s.actions[action]}${scenes.length === 1 ? ` (${fmt(s.sceneN, { n: scenes[0]! + 1 })})` : ''}`);
      setResult(body);
    } catch {
      toast(t.common.errorGeneric, 'error');
    } finally {
      setBusy(null);
    }
  }

  function apply(changes: AppliedChange[]) {
    setDraft((d) => ({
      ...d,
      scenes: d.scenes.map((sc, i) => {
        const mine = changes.filter((c) => c.index === i);
        if (!mine.length) return sc;
        const next = { ...sc };
        for (const c of mine) next[c.field] = c.after;
        return next;
      }),
    }));
    onAiApplied(lastLabel);
    toast(fmt(s.applied, { n: changes.length }));
  }

  const actionDisabled = locked || busy !== null;
  const controls = (
    <div className="script-controls">
      <label className="field inline-field">
        <span className="field-label">{s.tone}</span>
        <select className="select select-sm" value={tone} onChange={(e) => setTone(e.target.value as AssistTone)} disabled={locked}>
          {ASSIST_TONES.map((x) => (
            <option key={x} value={x}>
              {(t.create.options as Record<string, string>)[x] ?? x}
            </option>
          ))}
        </select>
      </label>
      <label className="field inline-field">
        <span className="field-label">{s.targetLanguage}</span>
        <select className="select select-sm" value={target} onChange={(e) => setTarget(e.target.value)} disabled={locked}>
          {languages.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.native_name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div className="studio-step">
      <StepHeader
        title={s.title}
        lead={s.lead}
        aside={
          <span className="badge badge-accent plain mono ltr">
            {draft.scenes.length} · {formatDuration(t, total)}
          </span>
        }
      />

      {continuity.length > 0 && (
        <div className="callout callout-warning" role="note" aria-label={s.continuityTitle}>
          <Icon name="alert" />
          <div>
            <strong>{s.continuityTitle}</strong>
            <ul className="plain-list">
              {continuity.map((c, i) => (
                <li key={i} className={c.severity === 'error' ? 'field-error' : undefined}>
                  {fmt(s.continuity[c.code], { ...c.params, scene: (c.scene ?? 0) + 1 })}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <section className="panel panel-pad stack script-ai" aria-labelledby="script-ai-h">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 id="script-ai-h" className="section-title">
            <span className="badge badge-warning plain">{s.mockAi}</span> {s.wholeScript}
          </h3>
          {controls}
        </div>
        <p className="small muted">{s.mockNotice}</p>
        <div className="row">
          {SCRIPT_ACTIONS.map((a) => (
            <button key={a} type="button" className={`btn btn-sm${a === 'draft' ? ' btn-primary' : ''}`} disabled={actionDisabled} onClick={() => void assist(a, [])}>
              {a === 'draft' && <Icon name="sparkle" />}
              {busy === `${a}:` ? s.working : s.actions[a]}
            </button>
          ))}
        </div>
      </section>

      <ol className="script-doc">
        {draft.scenes.map((scene, i) => (
          <li key={scene.key} className="panel script-scene" aria-labelledby={`script-h-${scene.key}`}>
            <header className="script-scene-head">
              <span className="step-num ltr">{i + 1}</span>
              <div className="field grow">
                <label className="sr-only" htmlFor={`script-title-${scene.key}`}>
                  {fmt(s.sceneN, { n: i + 1 })}
                </label>
                <input
                  id={`script-title-${scene.key}`}
                  className="input script-scene-title"
                  value={scene.title}
                  maxLength={SCENE_FIELD_MAX.title}
                  onChange={(e) => setDraft((d) => ({ ...d, scenes: d.scenes.map((x) => (x.key === scene.key ? { ...x, title: e.target.value } : x)) }))}
                  dir="auto"
                />
                <span id={`script-h-${scene.key}`} className="sr-only">
                  {fmt(s.sceneN, { n: i + 1 })}
                </span>
              </div>
              <div className="duration-input">
                <input
                  type="number"
                  className="input ltr"
                  min={LIMITS.sceneDurationMin}
                  max={LIMITS.sceneDurationMax}
                  value={scene.duration_seconds}
                  aria-label={`${t.studio.scenes.fields.duration} · ${fmt(s.sceneN, { n: i + 1 })}`}
                  onChange={(e) => setDraft((d) => ({ ...d, scenes: d.scenes.map((x) => (x.key === scene.key ? { ...x, duration_seconds: Math.round(Number(e.target.value)) } : x)) }))}
                />
                <span className="xsmall muted">s</span>
              </div>
              <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`${s.moveUp} ${i + 1}`} disabled={i === 0} onClick={() => setDraft((d) => ({ ...d, scenes: moveItem(d.scenes, i, i - 1) }))}>
                  <Icon name="chevronUp" />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  aria-label={`${s.moveDown} ${i + 1}`}
                  disabled={i === draft.scenes.length - 1}
                  onClick={() => setDraft((d) => ({ ...d, scenes: moveItem(d.scenes, i, i + 1) }))}
                >
                  <Icon name="chevronDown" />
                </button>
              </div>
            </header>
            <div className="fields-2 script-fields">
              {SCRIPT_FIELDS.map((f) => (
                <TextField
                  key={f}
                  label={s.fields[f]}
                  value={scene[f]}
                  onChange={(v) => setDraft((d) => ({ ...d, scenes: d.scenes.map((x) => (x.key === scene.key ? { ...x, [f]: v } : x)) }))}
                  max={SCENE_FIELD_MAX[f]}
                  multiline
                  rows={f === 'narration' || f === 'dialogue' ? 3 : 2}
                  optional
                  dir="auto"
                />
              ))}
            </div>
            <details className="script-scene-ai">
              <summary>
                <span className="badge badge-warning plain">{s.mockAi}</span> {s.thisScene}
              </summary>
              <div className="row">
                {SCENE_ACTIONS.map((a) => (
                  <button key={a} type="button" className="btn btn-sm" disabled={actionDisabled} onClick={() => void assist(a, [i])}>
                    {busy === `${a}:${i}` ? s.working : s.actions[a]}
                  </button>
                ))}
              </div>
            </details>
          </li>
        ))}
      </ol>

      <ProposalDialog result={result} sceneTitles={draft.scenes.map((x) => x.title)} onApply={apply} onClose={() => setResult(null)} />
    </div>
  );
}
