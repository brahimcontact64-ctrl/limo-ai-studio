'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { draftFingerprint, toSaveRequest } from '@/lib/studio/draft';
import { createHistory, pushHistory, redo, undo, type History } from '@/lib/studio/history';
import { hasErrors, validateDraft, type Issue } from '@/lib/studio/validation';
import { checkContinuity, type SeriesContext } from '@/lib/story/continuity';
import type { ScriptApproval } from '@/lib/data/projects';
import { EDITABLE_STATUSES, type CatalogOption, type CharacterRecord, type ExportPresetOption, type ProjectDraft, type ProjectStatus } from '@/lib/studio/types';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusBadge } from '@/components/app/ProjectBits';
import { SetupStep } from './SetupStep';
import { CastStep } from './CastStep';
import { ScenesStep } from './ScenesStep';
import { ScriptStep } from './ScriptStep';
import { ReviewStep } from './ReviewStep';
import { ProjectMenu } from './ProjectMenu';
import { RevisionsDialog } from './RevisionsDialog';
import { ApprovalPanel } from './ApprovalPanel';
import { VideoStep } from './VideoStep';

export interface StudioCatalogs {
  contentTypes: CatalogOption[];
  languages: Array<CatalogOption & { native_name: string }>;
  exportPresets: ExportPresetOption[];
  characters: CharacterRecord[];
}

export type StepId = 'setup' | 'cast' | 'scenes' | 'script' | 'review' | 'video';
const STEPS: StepId[] = ['setup', 'cast', 'scenes', 'script', 'review', 'video'];
const STEP_FIELDS: Record<StepId, (i: Issue) => boolean> = {
  setup: (i) => ['title', 'content_type', 'language_code', 'brief', 'goal', 'visual_style', 'export_presets'].includes(i.field ?? ''),
  cast: (i) => i.field === 'cast',
  scenes: (i) => i.scene !== undefined || i.field === 'scenes',
  script: () => false,
  review: () => false,
  video: () => false,
};
/** Autosave runs this long after the last change (existing projects only). */
const AUTOSAVE_MS = 3000;
/** Project types that can open the Image Studio with their brief and photos. */
const IMAGE_MODES: string[] = ['product_ad', 'business_promo', 'social_post'];
const NO_SCRIPT: ScriptApproval = { status: 'draft', approved_at: null, approved_revision_number: null, available: false };

export interface StudioEditorProps {
  initialDraft: ProjectDraft;
  status: ProjectStatus;
  updatedAt: string | null;
  catalogs: StudioCatalogs;
  canEdit: boolean;
  subscriptionActive: boolean;
  script?: ScriptApproval;
  series?: SeriesContext | null;
}

type SaveResponse = { project_id?: string; updated_at?: string; script_status?: ScriptApproval['status']; revision_number?: number; error?: string };

const isTyping = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
};

export function StudioEditor({ initialDraft, status, updatedAt, catalogs, canEdit, subscriptionActive, script: initialScript, series = null }: StudioEditorProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [hist, setHist] = useState<History<ProjectDraft>>(() => createHistory(initialDraft));
  const draft = hist.present;
  const setDraft: Dispatch<SetStateAction<ProjectDraft>> = useCallback(
    (action) => setHist((h) => pushHistory(h, typeof action === 'function' ? (action as (d: ProjectDraft) => ProjectDraft)(h.present) : action, Date.now())),
    [],
  );
  // Discrete edits (e.g. applying Mock AI suggestions): always a separate undo step.
  const applyDraft = useCallback((fn: (d: ProjectDraft) => ProjectDraft) => setHist((h) => pushHistory(h, fn(h.present), Date.now(), false)), []);
  const [savedFingerprint, setSavedFingerprint] = useState(() => (initialDraft.id ? draftFingerprint(initialDraft) : ''));
  const [savedAt, setSavedAt] = useState<string | null>(updatedAt);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(updatedAt);
  const [autosaved, setAutosaved] = useState(false);
  const [step, setStepState] = useState<StepId>(() => (initialDraft.id ? 'scenes' : 'setup'));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [script, setScript] = useState<ScriptApproval>(initialScript ?? NO_SCRIPT);
  const [aiLabel, setAiLabel] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmUnlock, setConfirmUnlock] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);

  // Keep the open step when the editor remounts after a restore or approval refresh (same tab only).
  // Written on user navigation, not from an effect, so React's development double-mount cannot reset it.
  const draftIdRef = useRef(initialDraft.id);
  draftIdRef.current = draft.id;
  const setStep = useCallback((s: StepId) => {
    setStepState(s);
    try {
      if (draftIdRef.current) window.sessionStorage.setItem(`limo-step-${draftIdRef.current}`, s);
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    if (!initialDraft.id) return;
    try {
      const saved = window.sessionStorage.getItem(`limo-step-${initialDraft.id}`) as StepId | null;
      if (saved && STEPS.includes(saved)) setStepState(saved);
    } catch {
      /* storage unavailable */
    }
  }, [initialDraft.id]);

  const editable = canEdit && EDITABLE_STATUSES.includes(status);
  const locked = script.status === 'approved';
  const canChange = editable && !locked && !conflict;
  const ctx = useMemo(
    () => ({
      contentTypes: new Set(catalogs.contentTypes.map((c) => c.code)),
      languages: new Set(catalogs.languages.map((l) => l.code)),
      exportPresets: new Set(catalogs.exportPresets.map((p) => p.code)),
    }),
    [catalogs],
  );
  const issues = useMemo(() => validateDraft(toSaveRequest(draft), ctx), [draft, ctx]);
  const continuity = useMemo(() => (series ? checkContinuity(draft, series) : []), [draft, series]);
  const fingerprint = useMemo(() => draftFingerprint(draft), [draft]);
  const dirty = fingerprint !== savedFingerprint;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty && canChange;

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

  const save = useCallback(
    async (source: 'manual' | 'autosave' = 'manual') => {
      if (!canChange || savingRef.current) return;
      const manual = source === 'manual';
      if (manual) {
        setShowErrors(true);
        setSaveError(null);
      }
      if (hasErrors(issues)) {
        if (!manual) return;
        setSaveError(t.studio.saveErrors.fixIssues);
        const firstStep = STEPS.find((s) => issues.some((i) => i.severity === 'error' && STEP_FIELDS[s](i)));
        if (firstStep) setStep(firstStep);
        return;
      }
      savingRef.current = true;
      setSaving(true);
      const snapshot = draft;
      try {
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...toSaveRequest(snapshot),
            base_updated_at: baseUpdatedAt,
            revision_source: aiLabel ? 'mock_ai' : source,
            revision_label: aiLabel,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as SaveResponse;
        if (!res.ok || !body.project_id) {
          if (body.error === 'conflict') {
            setConflict(true);
            return;
          }
          const key = (body.error ?? 'unknown') as keyof typeof t.studio.saveErrors;
          const message = body.error === 'rate_limited' ? t.rateLimited : (t.studio.saveErrors[key] ?? t.studio.saveErrors.unknown);
          setSaveError(message);
          if (manual) toast(message, 'error');
          return;
        }
        const id = body.project_id;
        const created = !snapshot.id;
        // Every history entry belongs to the saved project now (undo must never create a copy).
        setHist((h) => {
          const withId = (d: ProjectDraft) => (d.id === id ? d : { ...d, id });
          return { ...h, past: h.past.map(withId), present: withId(h.present), future: h.future.map(withId) };
        });
        setSavedFingerprint(draftFingerprint({ ...snapshot, id }));
        const at = body.updated_at ?? new Date().toISOString();
        setSavedAt(at);
        setBaseUpdatedAt(at);
        setAutosaved(!manual);
        setAiLabel(null);
        setSaveError(null);
        setScript((s) => ({ ...s, status: body.script_status ?? s.status, available: s.available || body.revision_number !== undefined }));
        if (manual) toast(created ? t.studio.createdToast : t.studio.savedToast);
        if (created) window.history.replaceState(null, '', `/app/projects/${id}`);
      } catch {
        setSaveError(t.studio.saveErrors.network);
        if (manual) toast(t.studio.saveErrors.network, 'error');
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [aiLabel, baseUpdatedAt, canChange, draft, issues, t, toast],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  // Autosave: existing projects, valid drafts only, never over an approved script.
  const autosaveReady = canChange && Boolean(draft.id) && dirty && !hasErrors(issues) && subscriptionActive;
  useEffect(() => {
    if (!autosaveReady) return;
    const timer = window.setTimeout(() => void saveRef.current('autosave'), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [autosaveReady, fingerprint]);

  // Ctrl/Cmd+S saves; Ctrl/Cmd+Z / Shift+Z / Y undo and redo outside text fields (fields keep their own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void saveRef.current('manual');
      } else if (canChange && !isTyping(e.target) && (k === 'z' || k === 'y')) {
        e.preventDefault();
        setHist((h) => (k === 'y' || e.shiftKey ? redo(h) : undo(h)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canChange]);

  async function approval(action: 'approve' | 'remove') {
    if (!draft.id) return;
    setApprovalBusy(true);
    const res = await fetch(`/api/projects/${draft.id}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, base_updated_at: baseUpdatedAt }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { updated_at?: string; revision_number?: number; script_status?: ScriptApproval['status']; error?: string } | undefined;
    setApprovalBusy(false);
    if (!res?.ok || !body) {
      if (body?.error === 'conflict') return setConflict(true);
      return toast(body?.error === 'unavailable' ? t.studio.approval.unavailable : t.common.errorGeneric, 'error');
    }
    if (body.updated_at) {
      setBaseUpdatedAt(body.updated_at);
      setSavedAt(body.updated_at);
    }
    if (action === 'approve') {
      setScript((s) => ({ ...s, status: 'approved', approved_at: new Date().toISOString(), approved_revision_number: body.revision_number ?? null }));
      toast(t.studio.approval.approvedToast);
    } else {
      setScript((s) => ({ ...s, status: body.script_status ?? 'changed' }));
      toast(t.studio.approval.removeToast);
    }
  }

  const stepErrors = (s: StepId) => showErrors && issues.some((i) => i.severity === 'error' && STEP_FIELDS[s](i));
  const stepIndex = STEPS.indexOf(step);
  const nextStep = STEPS[stepIndex + 1];
  const prevStep = STEPS[stepIndex - 1];
  const approvalBlocker = !draft.id || dirty ? t.studio.approval.needsSave : hasErrors(issues) || continuity.some((c) => c.severity === 'error') ? t.studio.approval.needsFix : null;

  const saveLabel = saving ? (
    t.common.saving
  ) : dirty || !draft.id ? (
    draft.id ? (
      autosaveReady ? t.studio.unsaved : hasErrors(issues) && canChange ? t.studio.autosavePaused : t.studio.unsaved
    ) : (
      t.studio.neverSaved
    )
  ) : savedAt ? (
    <RelativeTime iso={savedAt} template={autosaved ? t.studio.autosaved : t.studio.savedAt} />
  ) : (
    t.studio.saved
  );

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
            disabled={!canChange}
            aria-invalid={showErrors && issues.some((i) => i.field === 'title' && i.severity === 'error')}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          />
          <div className="studio-title-meta">
            <StatusBadge status={draft.id ? status : 'draft'} t={t} />
            {script.available && script.status !== 'draft' && (
              <span className={`badge ${script.status === 'approved' ? 'badge-success' : 'badge-warning'}`}>{t.studio.approval.status[script.status]}</span>
            )}
            <span className={`save-state${dirty && draft.id ? ' dirty' : ''}`} aria-live="polite">
              {saveLabel}
            </span>
          </div>
        </div>
        <div className="studio-bar-actions">
          {canChange && (
            <>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t.studio.undo} title={t.studio.undo} disabled={hist.past.length === 0} onClick={() => setHist(undo)}>
                <Icon name="restore" />
              </button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t.studio.redo} title={t.studio.redo} disabled={hist.future.length === 0} onClick={() => setHist(redo)}>
                <Icon name="restore" style={{ transform: 'scaleX(-1)' }} />
              </button>
            </>
          )}
          {draft.id && script.available && (
            <button type="button" className="btn btn-ghost btn-sm" aria-label={t.studio.history.open} onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
              <span className="hide-xs">{t.studio.history.open}</span>
            </button>
          )}
          {draft.id && canEdit && IMAGE_MODES.includes(draft.creation_mode) && (
            <Link className="btn btn-ghost btn-sm" href={`/app/images/new?project=${draft.id}`} prefetch={false} data-testid="project-create-image">
              <Icon name="brush" />
              <span className="hide-xs">{t.images.projectButton}</span>
            </Link>
          )}
          {draft.id && canEdit && IMAGE_MODES.includes(draft.creation_mode) && (
            <Link className="btn btn-ghost btn-sm" href={`/app/posts/new?project=${draft.id}`} prefetch={false} data-testid="project-create-post">
              <Icon name="share" />
              <span className="hide-xs">{t.social.projectButton}</span>
            </Link>
          )}
          {draft.id && <ProjectMenu projectId={draft.id} title={draft.title} status={status} canEdit={canEdit} draft={draft} dirty={dirty} />}
          {editable && !locked && (
            <button type="button" className="btn btn-primary" onClick={() => void save('manual')} disabled={saving || conflict || (!dirty && Boolean(draft.id))} title={t.studio.saveShortcut}>
              <Icon name="save" />
              <span className="hide-xs">{saving ? t.common.saving : t.common.save}</span>
            </button>
          )}
        </div>
      </header>

      <div className="studio-steps" role="tablist" aria-label={t.studio.stepsLabel}>
        {STEPS.map((s, i) => (
          <button key={s} role="tab" id={`tab-${s}`} aria-controls={`panel-${s}`} aria-selected={step === s} className="tab" onClick={() => setStep(s)} type="button">
            <span className="tab-index ltr">{i + 1}</span>
            {t.studio.steps[s]}
            {s === 'cast' && draft.cast.length > 0 && <span className="mono xsmall muted ltr">{draft.cast.length}</span>}
            {s === 'scenes' && <span className="mono xsmall muted ltr">{draft.scenes.length}</span>}
            {(stepErrors(s) || (s === 'script' && continuity.some((c) => c.severity === 'error'))) && <span className="tab-dot" aria-label="!" />}
          </button>
        ))}
      </div>

      <div className="studio-notices">
        {!canEdit && <p className="callout">{t.app.viewerReadOnly}</p>}
        {canEdit && !EDITABLE_STATUSES.includes(status) && <p className="callout">{fmt(t.studio.readOnly, { status: t.projects.status[status] })}</p>}
        {editable && !subscriptionActive && (
          <div className="callout callout-warning" role="note">
            <Icon name="alert" />
            <div>
              <strong>{t.app.subscriptionMissingTitle}</strong>
              {t.app.subscriptionMissingBody}
            </div>
          </div>
        )}
        {series?.episode_number && (
          <div className="callout" role="note" data-testid="episode-banner">
            <Icon name="book" />
            <div>
              {fmt(t.stories.studioBanner, { n: series.episode_number, series: series.title })}
              <div style={{ marginTop: 8 }}>
                <Link className="btn btn-sm" prefetch={false} href={`/app/stories/${series.series_id}/episodes/${series.episode_number}`}>
                  {t.stories.openStory}
                </Link>
              </div>
            </div>
          </div>
        )}
        {locked && (
          <div className="callout callout-success" role="note" data-testid="script-locked">
            <Icon name="lock" />
            <div>
              {fmt(t.studio.script.locked, { n: script.approved_revision_number ?? '—' })}
              {editable && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setConfirmUnlock(true)}>
                    {t.studio.script.editApproved}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {conflict && (
          <div className="callout callout-danger" role="alert">
            <Icon name="alert" />
            <div>
              {t.studio.saveErrors.conflict}
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    dirtyRef.current = false;
                    window.location.reload();
                  }}
                >
                  {t.studio.reloadLatest}
                </button>
              </div>
            </div>
          </div>
        )}
        {saveError && !conflict && (
          <div className="callout callout-danger" role="alert">
            <Icon name="alert" />
            <div>{saveError}</div>
          </div>
        )}
      </div>

      {step === 'video' ? (
        // Outside the disabled fieldset: an approved (locked) script is exactly what gets exported.
        <div className="studio-body" id="panel-video" role="tabpanel" aria-labelledby="tab-video">
          {draft.id ? (
            <VideoStep
              projectId={draft.id}
              draft={draft}
              setDraft={setDraft}
              canChange={canChange}
              approved={locked}
              approvedRevision={script.approved_revision_number}
              dirty={dirty}
              onUnlock={() => setConfirmUnlock(true)}
            />
          ) : (
            <p className="callout">{t.video.saveFirst}</p>
          )}
        </div>
      ) : (
      <fieldset className="studio-body" disabled={!canChange} id={`panel-${step}`} role="tabpanel" aria-labelledby={`tab-${step}`}>
        {step === 'setup' && <SetupStep draft={draft} setDraft={setDraft} catalogs={catalogs} issues={showErrors ? issues : []} />}
        {step === 'cast' && <CastStep draft={draft} setDraft={setDraft} characters={catalogs.characters} issues={showErrors ? issues : []} />}
        {step === 'scenes' && <ScenesStep draft={draft} setDraft={setDraft} characters={catalogs.characters} issues={showErrors ? issues : []} goToCast={() => setStep('cast')} />}
        {step === 'script' && <ScriptStep draft={draft} setDraft={setDraft} applyDraft={applyDraft} locked={!canChange} languages={catalogs.languages} continuity={continuity} onAiApplied={setAiLabel} />}
        {step === 'review' && <ReviewStep draft={draft} issues={issues} catalogs={catalogs} />}
      </fieldset>
      )}

      {step === 'review' && draft.id && (
        <div className="studio-approval">
          <ApprovalPanel script={script} editable={editable && !conflict} blocker={approvalBlocker} busy={approvalBusy} onApprove={() => void approval('approve')} onRemove={() => setConfirmUnlock(true)} />
        </div>
      )}

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
        ) : canChange ? (
          <button type="button" className="btn btn-primary" onClick={() => void save('manual')} disabled={saving}>
            {saving ? t.common.saving : t.common.save}
          </button>
        ) : (
          <span />
        )}
      </nav>

      {draft.id && (
        <RevisionsDialog
          open={historyOpen}
          projectId={draft.id}
          draft={draft}
          baseUpdatedAt={baseUpdatedAt}
          approvedRevisionNumber={script.approved_revision_number}
          locked={locked}
          onClose={() => setHistoryOpen(false)}
          onConflict={() => setConflict(true)}
        />
      )}
      <ConfirmDialog
        open={confirmUnlock}
        title={t.studio.script.editApprovedTitle}
        body={t.studio.script.editApprovedBody}
        confirmLabel={t.studio.script.editApprovedConfirm}
        busy={approvalBusy}
        onClose={() => setConfirmUnlock(false)}
        onConfirm={() => {
          setConfirmUnlock(false);
          void approval('remove');
        }}
      />
    </div>
  );
}
