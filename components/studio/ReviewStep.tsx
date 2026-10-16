'use client';
import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { formatDuration, plural } from '@/lib/i18n/format';
import { estimateSlots } from '@/lib/studio/limits';
import { buildStoryboard } from '@/lib/studio/prompts';
import { downloadProjectJson } from '@/lib/studio/export';
import { totalDuration, type Issue } from '@/lib/studio/validation';
import type { ProjectDraft } from '@/lib/studio/types';
import { Icon } from '@/components/ui/Icon';
import { CastStack } from '@/components/app/ProjectBits';
import type { StudioCatalogs } from './StudioEditor';
import { StepHeader, issueMessage } from './fields';

export function ReviewStep({ draft, issues, catalogs }: { draft: ProjectDraft; issues: Issue[]; catalogs: StudioCatalogs }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<number | null>(null);
  const charMap = useMemo(() => new Map(catalogs.characters.map((c) => [c.id, c])), [catalogs.characters]);
  const board = useMemo(() => buildStoryboard(draft, charMap), [draft, charMap]);
  const total = totalDuration(draft.scenes);
  const slots = estimateSlots(total);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const missingRefs = [...new Set(board.flatMap((b) => b.missingReferences))];
  const presetLabels = draft.export_presets.map((code) => catalogs.exportPresets.find((p) => p.code === code)?.aspect_ratio ?? code);

  const copy = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="studio-step">
      <StepHeader
        title={t.studio.review.title}
        lead={t.studio.review.lead}
        aside={
          <button type="button" className="btn btn-sm" onClick={() => downloadProjectJson(draft)}>
            <Icon name="download" />
            {t.studio.review.exportJson}
          </button>
        }
      />

      <div className="review-grid">
        <section className="panel" aria-labelledby="sum-h">
          <div className="panel-head">
            <h3 id="sum-h">{t.studio.review.summary}</h3>
          </div>
          <div className="panel-body">
            <dl className="dl">
              <div>
                <dt>{t.studio.review.totalDuration}</dt>
                <dd className="mono ltr">{formatDuration(t, total)}</dd>
              </div>
              <div>
                <dt>{t.studio.review.scenes}</dt>
                <dd className="mono ltr">{draft.scenes.length}</dd>
              </div>
              <div>
                <dt>{t.studio.review.cast}</dt>
                <dd>
                  <CastStack ids={draft.cast} max={8} size={22} />
                </dd>
              </div>
              <div>
                <dt>{t.studio.review.formats}</dt>
                <dd className="ltr">{presetLabels.join(' · ') || '—'}</dd>
              </div>
              <div>
                <dt>{t.studio.review.estimatedSlots}</dt>
                <dd>{plural(slots, t.studio.review.slot, t.studio.review.slots)}</dd>
              </div>
            </dl>
            <p className="xsmall muted" style={{ marginTop: 12 }}>
              {t.studio.review.slotRule}
            </p>
          </div>
        </section>

        <section className="panel" aria-labelledby="checks-h">
          <div className="panel-head">
            <h3 id="checks-h">{t.studio.review.issues}</h3>
            <span className={`badge ${errors.length ? 'badge-danger' : 'badge-success'}`}>{errors.length}</span>
          </div>
          <div className="panel-body">
            {errors.length === 0 && warnings.length === 0 ? (
              <p className="small" style={{ color: 'var(--success)' }}>
                {t.studio.review.noIssues}
              </p>
            ) : (
              <ul className="check-list">
                {errors.map((i, k) => (
                  <li key={`e${k}`} className="error">
                    <Icon name="alert" size={14} />
                    {issueMessage(t, i)}
                  </li>
                ))}
                {warnings.map((i, k) => (
                  <li key={`w${k}`} className="warning">
                    <Icon name="info" size={14} />
                    {issueMessage(t, i)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="panel review-wide" aria-labelledby="gen-h">
          <div className="panel-head">
            <h3 id="gen-h">{t.studio.review.generationTitle}</h3>
            <span className="badge badge-warning">{t.common.comingSoon}</span>
          </div>
          <div className="panel-body stack">
            <p className="small muted">{t.studio.review.generationDisabled}</p>
            {missingRefs.length > 0 && <p className="small muted">{t.studio.review.generationNeedsRefs}</p>}
          </div>
        </section>
      </div>

      <section className="storyboard" aria-labelledby="sb-h">
        <StepHeader title={t.studio.review.storyboard} lead={t.studio.review.storyboardLead} />
        <ol className="storyboard-list">
          {board.map((b, i) => (
            <li key={draft.scenes[i]?.key ?? i} className="panel">
              <div className="panel-head">
                <span className="mono xsmall ltr">
                  SC {String(b.sceneNumber).padStart(2, '0')} · {b.durationSeconds}s
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy(i, b.text)}>
                  <Icon name={copied === i ? 'check' : 'copy'} />
                  {copied === i ? t.studio.review.copied : t.studio.review.copyPrompt}
                </button>
              </div>
              <pre className="prompt" dir="auto">
                {b.text}
              </pre>
              {b.missingReferences.length > 0 && (
                <p className="prompt-note">{fmt(t.studio.review.missingRefs, { ids: b.missingReferences.join(', ') })}</p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
