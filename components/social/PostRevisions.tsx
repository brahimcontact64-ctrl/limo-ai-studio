'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { Icon } from '@/components/ui/Icon';

interface Rev {
  id: string;
  revision_number: number;
  source: string;
  label: string | null;
  snapshot: { caption?: string; headline?: string; cta?: string; hashtags?: string[] };
  updated_at: string;
}

/** Post history: every save, AI suggestion, approval and restore. Restoring saves a new revision. */
export function PostRevisions({ open, postId, canRestore, busy, onRestore, onClose }: { open: boolean; postId: string; canRestore: boolean; busy: boolean; onRestore: (id: string, n: number) => void; onClose: () => void }) {
  const { t } = useI18n();
  const r = t.social.revisions;
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [revs, setRevs] = useState<Rev[] | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setRevs(null);
      void fetch(`/api/posts/${postId}/revisions`)
        .then((x) => x.json())
        .then((b: { revisions?: Rev[] }) => setRevs(b.revisions ?? []))
        .catch(() => setRevs([]));
    }
    if (!open && d.open) d.close();
  }, [open, postId]);
  return (
    <dialog ref={ref} className="dialog wide" onClose={onClose} aria-labelledby={`${id}-h`}>
      <div className="dialog-body stack">
        <h2 id={`${id}-h`}>{r.title}</h2>
        {!revs && <div className="skeleton" style={{ height: 120 }} />}
        <ol className="plain-list stack-sm" data-testid="post-revisions">
          {(revs ?? []).map((v, i) => (
            <li key={v.id} className="panel panel-pad stack-xs">
              <div className="row">
                <b className="small">{fmt(r.revision, { n: v.revision_number })}</b>
                <span className="badge plain">{(r.sources as Record<string, string>)[v.source] ?? v.source}</span>
                <span className="xsmall muted">
                  <RelativeTime iso={v.updated_at} />
                </span>
                <span className="spacer" />
                {canRestore && i > 0 && (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onRestore(v.id, v.revision_number)}>
                    <Icon name="restore" />
                    {r.restore}
                  </button>
                )}
              </div>
              {v.snapshot.headline && (
                <p className="small" dir="auto">
                  <b>{v.snapshot.headline}</b>
                </p>
              )}
              <p className="small pre clamp-3" dir="auto">
                {v.snapshot.caption}
              </p>
            </li>
          ))}
        </ol>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={() => ref.current?.close()}>
          {t.common.close}
        </button>
      </div>
    </dialog>
  );
}
