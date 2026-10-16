'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { formatRelative } from '@/lib/i18n/format';
import { draftFingerprint, toSaveRequest } from '@/lib/studio/draft';
import { hasErrors, validateDraft, type Issue } from '@/lib/studio/validation';
import { EDITABLE_STATUSES, type CatalogOption, type CharacterRecord, type ExportPresetOption, type ProjectDraft, type ProjectStatus } from '@/lib/studio/types';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { StatusBadge } from '@/components/app/ProjectBits';
import { SetupStep } from './SetupStep';
import { CastStep } from './CastStep';
import { ScenesStep } from './ScenesStep';
import { ReviewStep } from './ReviewStep';
import { ProjectMenu } from './ProjectMenu';

export interface StudioCatalogs {
  contentTypes: CatalogOption[];
  languages: Array<CatalogOption & { native_name: string }>;
  exportPresets: ExportPresetOption[];
  characters: CharacterRecord[];
}

export type StepId = 'setup' | 'cast' | 'scenes' | 'review';
const STEPS: StepId[] = ['setup', 'cast', 'scenes', 'review'];
const STEP_FIELDS: Record<StepId, (i: Issue) => boolean> = {
  setup: (i) => ['title', 'content_type', 'language_code', 'brief', 'goal', 'visual_style', 'export_presets'].includes(i.field ?? ''),
  cast: (i) => i.field === 'cast',
  scenes: (i) => i.scene !== undefined || i.field === 'scenes',
  review: () => false,
};

export interface StudioEditorProps {
  initialDraft: ProjectDraft;
  status: ProjectStatus;
  updatedAt: string | null;
  catalogs: StudioCatalogs;
  canEdit: boolean;
  subscriptionActive: boolean;
}

export function StudioEditor({ initialDraft, status, updatedAt, catalogs, canEdit, subscriptionActive }: StudioEditorProps) {
  const { t, intl } = useI18n();
  const toast = useToast();
  const [draft, setDraft] = useState<ProjectDraft>(initialDraft);
  const [savedFingerprint, setSavedFingerprint] = useState(() => (initialDraft.id ? draftFingerprint(initialDraft) : ''));
  const [savedAt, setSavedAt] = useState<string | null>(updatedAt);
  const [step, setStep] = useState<StepId>(() => (initialDraft.id ? 'scenes' : 'setup'));
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  const editable = canEdit && EDITABLE_STATUSES.includes(status);
  const ctx = useMemo(
    () => ({
      contentTypes: new Set(catalogs.contentTypes.map((c) => c.code)),
      languages: new Set(catalogs.languages.map((l) => l.code)),
      exportPresets: new Set(catalogs.exportPresets.map((p) => p.code)),
    }),
    [catalogs],
  );
  const issues = useMemo(() => validateDraft(toSaveRequest(draft), ctx), [draft, ctx]);
  const fingerprint = useMemo(() => draftFingerprint(draft), [draft]);
  const dirty = fingerprint !== savedFingerprint;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty && editable;

  // Refresh relative "saved x ago" label.
  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Warn before leaving with unsaved changes (tab close + in-app links).
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm(t.studio.leaveWarning)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [t.studio.leaveWarning]);

  const save = useCallback(async () => {
    if (!editable || saving) return;
    setShowErrors(true);
    setSaveError(null);
    if (hasErrors(issues)) {
      setSaveError(t.studio.saveErrors.fixIssues);
      const firstStep = STEPS.find((s) => issues.some((i) => i.severity === 'error' && STEP_FIELDS[s](i)));
      if (firstStep) setStep(firstStep);
      return;
    }
    setSaving(true);
    const snapshot = draft;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toSaveRequest(snapshot)),
      });
      const body = (await res.json().catch(() => ({}))) as { project_id?: string; updated_at?: string; error?: string };
      if (!res.ok || !body.project_id) {
        const key = (body.error ?? 'unknown') as keyof typeof t.studio.saveErrors;
        const message = t.studio.saveErrors[key] ?? t.studio.saveErrors.unknown;
        setSaveError(message);
        toast(message, 'error');
        return;
      }
      const created = !snapshot.id;
      const next = { ...snapshot, id: body.project_id };
      setDraft((current) => (current === snapshot ? next : { ...current, id: body.project_id ?? null }));
      setSavedFingerprint(draftFingerprint(next));
      setSavedAt(body.updated_at ?? new Date().toISOString());
      toast(created ? t.studio.createdToast : t.studio.savedToast);
      if (created) {
        // Keep editor state; only update the address bar to the canonical project URL.
        window.history.replaceState(null, '', `/app/projects/${body.project_id}`);
      }
    } catch {
      setSaveError(t.studio.saveErrors.network);
      toast(t.studio.saveErrors.network, 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, editable, issues, saving, t, toast]);

  // Ctrl/Cmd + S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const stepErrors = (s: StepId) => showErrors && issues.some((i) => i.severity === 'error' && STEP_FIELDS[s](i));
  const stepIndex = STEPS.indexOf(step);
  const nextStep = STEPS[stepIndex + 1];
  const prevStep = STEPS[stepIndex - 1];

  const saveLabel = saving
    ? t.common.saving
    : dirty || !draft.id
      ? draft.id
        ? t.studio.unsaved
        : t.studio.neverSaved
      : savedAt
        ? fmt(t.studio.savedAt, { when: formatRelative(intl, savedAt) })
        : t.studio.saved;

  return (
    <div className="studio">
      <header className="studio-bar">
        <Link href="/app/projects" className="btn btn-ghost btn-icon btn-sm" aria-label={t.common.back}>
          <Icon name="chevronLeft" className="flip-rtl" />
        </Link>
        <div className="studio-title">
          <label className="sr-only" htmlFor="project-title-bar">
            {t.studio.setup.projectTitle}
          </label>
          <input
            id="project-title-bar"
            className="studio-title-input"
            value={draft.title}
            placeholder={t.studio.titlePlaceholder}
            maxLength={200}
            disabled={!editable}
            aria-invalid={showErrors && issues.some((i) => i.field === 'title' && i.severity === 'error')}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <div className="studio-title-meta">
            <StatusBadge status={draft.id ? status : 'draft'} t={t} />
            <span className={`save-state${dirty && draft.id ? ' dirty' : ''}`} aria-live="polite">
              {saveLabel}
            </span>
          </div>
        </div>
        <div className="studio-bar-actions">
          {draft.id && <ProjectMenu projectId={draft.id} title={draft.title} status={status} canEdit={canEdit} draft={draft} dirty={dirty} />}
          {editable && (
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || (!dirty && Boolean(draft.id))} title={t.studio.saveShortcut}>
              <Icon name="save" />
              <span className="hide-xs">{saving ? t.common.saving : t.common.save}</span>
            </button>
          )}
        </div>
      </header>

      <div className="studio-steps" role="tablist" aria-label={t.studio.stepsLabel}>
        {STEPS.map((s, i) => (
          <button
            key={s}
            role="tab"
            id={`tab-${s}`}
            aria-controls={`panel-${s}`}
            aria-selected={step === s}
            className="tab"
            onClick={() => setStep(s)}
            type="button"
          >
            <span className="tab-index ltr">{i + 1}</span>
            {t.studio.steps[s]}
            {s === 'cast' && draft.cast.length > 0 && <span className="mono xsmall muted ltr">{draft.cast.length}</span>}
            {s === 'scenes' && <span className="mono xsmall muted ltr">{draft.scenes.length}</span>}
            {stepErrors(s) && <span className="tab-dot" aria-label="!" />}
          </button>
        ))}
      </div>

      <div className="studio-notices">
        {!canEdit && <p className="callout">{t.app.viewerReadOnly}</p>}
        {canEdit && !EDITABLE_STATUSES.includes(status) && (
          <p className="callout">{fmt(t.studio.readOnly, { status: t.projects.status[status] })}</p>
        )}
        {editable && !subscriptionActive && (
          <div className="callout callout-warning" role="note">
            <Icon name="alert" />
            <div>
              <strong>{t.app.subscriptionMissingTitle}</strong>
              {t.app.subscriptionMissingBody}
            </div>
          </div>
        )}
        {saveError && (
          <div className="callout callout-danger" role="alert">
            <Icon name="alert" />
            <div>{saveError}</div>
          </div>
        )}
      </div>

      <fieldset className="studio-body" disabled={!editable} id={`panel-${step}`} role="tabpanel" aria-labelledby={`tab-${step}`}>
        {step === 'setup' && <SetupStep draft={draft} setDraft={setDraft} catalogs={catalogs} issues={showErrors ? issues : []} />}
        {step === 'cast' && <CastStep draft={draft} setDraft={setDraft} characters={catalogs.characters} issues={showErrors ? issues : []} />}
        {step === 'scenes' && (
          <ScenesStep draft={draft} setDraft={setDraft} characters={catalogs.characters} issues={showErrors ? issues : []} goToCast={() => setStep('cast')} />
        )}
        {step === 'review' && <ReviewStep draft={draft} issues={issues} catalogs={catalogs} />}
      </fieldset>

      <nav className="studio-stepper" aria-label={fmt(t.studio.stepOf, { n: stepIndex + 1, total: STEPS.length })}>
        {prevStep ? (
          <button type="button" className="btn btn-ghost" onClick={() => setStep(prevStep)}>
            <Icon name="chevronLeft" className="flip-rtl" />
            {t.studio.steps[prevStep]}
          </button>
        ) : (
          <span />
        )}
        <span className="mono xsmall muted">{fmt(t.studio.stepOf, { n: stepIndex + 1, total: STEPS.length })}</span>
        {nextStep ? (
          <button type="button" className="btn" onClick={() => setStep(nextStep)}>
            {fmt(t.studio.next, { step: t.studio.steps[nextStep] })}
            <Icon name="chevronRight" className="flip-rtl" />
          </button>
        ) : editable ? (
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </button>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
