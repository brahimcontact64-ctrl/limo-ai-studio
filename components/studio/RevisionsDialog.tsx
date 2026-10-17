'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { formatDuration } from '@/lib/i18n/format';
import { compareDrafts, type DraftChange } from '@/lib/studio/diff';
import { draftFromSnapshot, type RevisionSnapshot } from '@/lib/studio/draft';
import type { ProjectDraft } from '@/lib/studio/types';
import type { RevisionSummary } from '@/app/api/projects/[id]/revisions/route';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { useToast } from '@/components/ui/Toast';
import { DiffText } from './DiffText';

/**
 * Revision history: list, compare a revision with the editor, restore (as a new revision).
 * Restoring an approved script requires removing the approval first.
 */
export function RevisionsDialog({
  open,
  projectId,
  draft,
  baseUpdatedAt,
  approvedRevisionNumber,
  locked,
  onClose,
  onConflict,
}: {
  open: boolean;
  projectId: string;
  draft: ProjectDraft;
  baseUpdatedAt: string | null;
  approvedRevisionNumber: number | null;
  locked: boolean;
  onClose: () => void;
  onConflict: () => void;
}) {
  const { t } = useI18n();
  const h = t.studio.history;
  const toast = useToast();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [revisions, setRevisions] = useState<RevisionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ number: number; id: string; draft: ProjectDraft } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setSelected(null);
      setConfirming(false);
      setError(null);
      setRevisions(null);
      fetch(`/api/projects/${projectId}/revisions`)
        .then(async (r) => {
          const body = (await r.json()) as { revisions?: RevisionSummary[]; error?: string };
          if (!r.ok) setError(body.error === 'unavailable' ? h.unavailable : t.common.errorGeneric);
          else setRevisions(body.revisions ?? []);
        })
        .catch(() => setError(t.common.errorGeneric));
    }
    if (!open && d.open) d.close();
  }, [open, projectId, h.unavailable, t.common.errorGeneric]);

  async function pick(r: RevisionSummary) {
    const res = await fetch(`/api/projects/${projectId}/revisions/${r.id}`).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { revision?: { snapshot: RevisionSnapshot } } | undefined;
    if (!res?.ok || !body?.revision) return toast(t.common.errorGeneric, 'error');
    setConfirming(false);
    setSelected({ number: r.revision_number, id: r.id, draft: draftFromSnapshot(projectId, body.revision.snapshot) });
  }

  // What restoring would change: editor → revision.
  const changes = useMemo(() => (selected ? compareDrafts(draft, selected.draft) : []), [draft, selected]);

  async function restore() {
    if (!selected) return;
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}/revisions/${selected.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_updated_at: baseUpdatedAt }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) {
      if (body?.error === 'conflict') {
        onConflict();
        ref.current?.close();
        return;
      }
      return toast(body?.error === 'script_approved' ? h.approvedLocked : t.common.errorGeneric, 'error');
    }
    toast(fmt(h.restored, { n: selected.number }));
    ref.current?.close();
    // The editor remounts with the restored project (keyed by updated_at).
    router.refresh();
  }

  const label = (c: DraftChange): string => {
    // Changes are editor → revision: a scene "added" by restoring exists only in the revision.
    if (c.kind === 'scene_added' || c.kind === 'scene_removed') return fmt(c.kind === 'scene_added' ? h.sceneAdded : h.sceneRemoved, { n: c.index + 1, title: c.title });
    const name = (h.labels as Record<string, string>)[c.field] ?? (t.studio.script.fields as Record<string, string>)[c.field] ?? c.field;
    return c.kind === 'scene' ? `${fmt(t.studio.script.sceneN, { n: c.index + 1 })} · ${name}` : name;
  };

  return (
    <dialog ref={ref} className="dialog wide" onClose={onClose} aria-labelledby="history-h">
      <div className="dialog-body stack">
        <div>
          <h2 id="history-h">{h.title}</h2>
          <p className="small muted">{h.lead}</p>
        </div>
        {error && <p className="callout callout-warning">{error}</p>}
        {!revisions && !error && <div className="skeleton" style={{ height: 120 }} />}
        {revisions && revisions.length === 0 && <p className="small muted">{h.empty}</p>}
        <div className="history-layout">
          {revisions && revisions.length > 0 && (
            <ul className="history-list" aria-label={h.title}>
              {revisions.map((r) => (
                <li key={r.id}>
                  <button type="button" className="history-item" aria-pressed={selected?.id === r.id} onClick={() => void pick(r)}>
                    <b>{fmt(h.revisionN, { n: r.revision_number })}</b>
                    <span className={`badge plain${r.source === 'approval' ? ' badge-success' : r.source === 'mock_ai' ? ' badge-warning' : ''}`}>{h.sources[r.source]}</span>
                    {approvedRevisionNumber === r.revision_number && <span className="badge badge-success">{h.approvedMarker}</span>}
                    <span className="xsmall muted">
                      <RelativeTime iso={r.updated_at} /> · <span className="ltr">{r.scene_count}</span> · <span className="ltr">{formatDuration(t, r.total_duration_seconds)}</span>
                    </span>
                    {r.label && (
                      <span className="xsmall muted" dir="auto">
                        {r.label}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <section className="history-compare stack" aria-labelledby="compare-h">
              <h3 id="compare-h" className="section-title">
                {fmt(h.compareTitle, { n: selected.number })}
              </h3>
              {changes.length === 0 ? (
                <p className="small muted">{h.noDifferences}</p>
              ) : (
                <>
                  <p className="xsmall muted">{h.compareHint}</p>
                  <ul className="change-list">
                    {changes.map((c, i) => (
                      <li key={i}>
                        <span className="field-label">{label(c)}</span>
                        {c.kind === 'project' || c.kind === 'scene' ? <DiffText before={c.before} after={c.after} /> : null}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {locked ? (
                <p className="callout small">{h.approvedLocked}</p>
              ) : confirming ? (
                <div className="callout callout-warning stack-sm" role="alert">
                  <strong>{fmt(h.restoreTitle, { n: selected.number })}</strong>
                  <span>{fmt(h.restoreBody, { n: selected.number })}</span>
                  <div className="row">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={busy}>
                      {t.common.cancel}
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void restore()} disabled={busy}>
                      {busy ? t.common.saving : h.restore}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button type="button" className="btn btn-sm" disabled={changes.length === 0} onClick={() => setConfirming(true)}>
                    {h.restore}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
          {t.common.close}
        </button>
      </div>
    </dialog>
  );
}
