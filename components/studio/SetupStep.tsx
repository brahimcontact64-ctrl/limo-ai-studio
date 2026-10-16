'use client';
import type { Dispatch, SetStateAction } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { LIMITS } from '@/lib/studio/limits';
import type { Issue } from '@/lib/studio/validation';
import type { ProjectDraft } from '@/lib/studio/types';
import type { StudioCatalogs } from './StudioEditor';
import { StepHeader, TextField, issueMessage } from './fields';

export function SetupStep({
  draft,
  setDraft,
  catalogs,
  issues,
}: {
  draft: ProjectDraft;
  setDraft: Dispatch<SetStateAction<ProjectDraft>>;
  catalogs: StudioCatalogs;
  issues: Issue[];
}) {
  const { t } = useI18n();
  const err = (field: string) => {
    const i = issues.find((x) => x.field === field && x.severity === 'error' && x.scene === undefined);
    return i ? issueMessage(t, i) : undefined;
  };
  const set = <K extends keyof ProjectDraft>(key: K) => (value: ProjectDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const togglePreset = (code: string) =>
    setDraft((d) => ({ ...d, export_presets: d.export_presets.includes(code) ? d.export_presets.filter((p) => p !== code) : [...d.export_presets, code] }));

  return (
    <div className="step">
      <StepHeader title={t.studio.setup.title} lead={t.studio.setup.lead} />
      <div className="setup-grid">
        <div className="stack-lg">
          <TextField label={t.studio.setup.projectTitle} value={draft.title} onChange={set('title')} max={LIMITS.titleMax} placeholder={t.studio.titlePlaceholder} error={err('title')} large />
          <TextField
            label={t.studio.setup.brief}
            value={draft.brief}
            onChange={set('brief')}
            max={LIMITS.briefMax}
            placeholder={t.studio.setup.briefPlaceholder}
            multiline
            rows={6}
            optional
            error={err('brief')}
            dir="auto"
          />
          <TextField label={t.studio.setup.goal} value={draft.goal} onChange={set('goal')} max={LIMITS.goalMax} placeholder={t.studio.setup.goalPlaceholder} multiline rows={2} optional error={err('goal')} dir="auto" />
          <TextField
            label={t.studio.setup.visualStyle}
            value={draft.visual_style}
            onChange={set('visual_style')}
            max={LIMITS.visualStyleMax}
            placeholder={t.studio.setup.visualStylePlaceholder}
            multiline
            rows={2}
            optional
            error={err('visual_style')}
            dir="auto"
          />
        </div>

        <aside className="stack-lg setup-side">
          <div className="field">
            <label className="field-label" htmlFor="content-type">
              {t.studio.setup.contentType}
            </label>
            <select id="content-type" className="select" value={draft.content_type} onChange={(e) => set('content_type')(e.target.value)} aria-invalid={Boolean(err('content_type'))}>
              {catalogs.contentTypes.map((c) => (
                <option key={c.code} value={c.code}>
                  {(t.contentTypes as Record<string, string>)[c.code] ?? c.label}
                </option>
              ))}
            </select>
            {err('content_type') && <span className="field-error">{err('content_type')}</span>}
          </div>

          <fieldset className="field plain-fieldset">
            <legend className="field-label">{t.studio.setup.language}</legend>
            <div className="segmented" role="radiogroup" aria-label={t.studio.setup.language}>
              {catalogs.languages.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={draft.language_code === l.code}
                  lang={l.code}
                  onClick={() => set('language_code')(l.code)}
                >
                  {l.native_name}
                </button>
              ))}
            </div>
            <span className="field-hint">{t.studio.setup.languageHint}</span>
            {err('language_code') && <span className="field-error">{err('language_code')}</span>}
          </fieldset>

          <fieldset className="field plain-fieldset">
            <legend className="field-label">{t.studio.setup.formats}</legend>
            <div className="format-grid">
              {catalogs.exportPresets.map((p) => {
                const [w, h] = p.aspect_ratio.split(':').map(Number);
                const ratio = w && h ? w / h : 1;
                const on = draft.export_presets.includes(p.code);
                return (
                  <button key={p.code} type="button" className="format-option" aria-pressed={on} onClick={() => togglePreset(p.code)}>
                    <span className="format-shape" style={{ aspectRatio: String(ratio), height: ratio >= 1 ? undefined : 34, width: ratio >= 1 ? 44 : undefined }} aria-hidden="true" />
                    <span className="format-label">
                      <b className="ltr">{p.aspect_ratio}</b>
                      <span>{p.recommended_for.slice(0, 2).join(', ')}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <span className="field-hint">{t.studio.setup.formatsHint}</span>
          </fieldset>
        </aside>
      </div>
    </div>
  );
}
