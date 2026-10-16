'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import { useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icon';

export interface QueueItem {
  id: string;
  organization_name: string;
  submitter_email: string | null;
  item_label: string;
  method: string;
  amount: string;
  transaction_ref: string;
  receipt_url: string | null;
  status: string;
  review_note: string | null;
  created_at: string;
}

const TONE: Record<string, string> = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger' };

function ReviewDialog({ item, approve, onClose }: { item: QueueItem; approve: boolean; onClose: (done: boolean) => void }) {
  const { t } = useI18n();
  const a = t.admin;
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function confirm() {
    if (!approve && note.trim().length < 3) return setError(a.reasonRequired);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/payments/${item.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve, note: note.trim() }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) {
      const key = (body?.error ?? 'unknown') as keyof typeof a.errors;
      setError(body?.error === 'unavailable' ? a.unavailable : (a.errors[key] ?? a.errors.unknown));
      return;
    }
    toast(approve ? a.approvedToast : a.rejectedToast);
    ref.current?.close();
    onClose(true);
  }

  return (
    <dialog ref={ref} className="dialog" onClose={() => onClose(false)} aria-labelledby="review-title">
      <div className="dialog-body">
        <h2 id="review-title">{approve ? a.approveTitle : a.rejectTitle}</h2>
        <p>{approve ? fmt(a.approveBody, { item: item.item_label, workspace: item.organization_name }) : a.rejectBody}</p>
        <dl className="dl">
          <div>
            <dt>{a.amount}</dt>
            <dd className="ltr">{item.amount}</dd>
          </div>
          <div>
            <dt>{a.reference}</dt>
            <dd className="ltr">{item.transaction_ref}</dd>
          </div>
        </dl>
        <div className="field">
          <label className="field-label" htmlFor="review-note">
            {approve ? a.note : a.reason}
            {approve && <small>({t.common.optional})</small>}
          </label>
          <textarea id="review-note" className="textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
        </div>
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => ref.current?.close()}>
          {t.common.cancel}
        </button>
        <button type="button" className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`} disabled={busy} onClick={() => void confirm()}>
          {busy ? t.common.loading : approve ? a.approve : a.reject}
        </button>
      </div>
    </dialog>
  );
}

export function PaymentQueue({ items }: { items: QueueItem[] }) {
  const { t, intl } = useI18n();
  const a = t.admin;
  const router = useRouter();
  const [review, setReview] = useState<{ item: QueueItem; approve: boolean } | null>(null);

  if (items.length === 0) {
    return (
      <div className="empty">
        <p>{a.empty}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="queue">
        {items.map((p) => (
          <li key={p.id} className="queue-item panel">
            <div className="queue-main">
              <div className="row">
                <b>{p.organization_name}</b>
                <span className={`badge ${TONE[p.status] ?? ''}`}>{(t.billing.paymentStatus as Record<string, string>)[p.status] ?? p.status}</span>
              </div>
              <dl className="queue-facts">
                <div>
                  <dt>{a.item}</dt>
                  <dd>{p.item_label}</dd>
                </div>
                <div>
                  <dt>{a.amount}</dt>
                  <dd className="ltr">{p.amount}</dd>
                </div>
                <div>
                  <dt>{a.method}</dt>
                  <dd>{p.method}</dd>
                </div>
                <div>
                  <dt>{a.reference}</dt>
                  <dd className="ltr">{p.transaction_ref}</dd>
                </div>
                <div>
                  <dt>{a.submittedBy}</dt>
                  <dd className="ltr">{p.submitter_email ?? '—'}</dd>
                </div>
                <div>
                  <dt>{t.settings.created}</dt>
                  <dd>{formatDate(intl, p.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
                </div>
              </dl>
              {p.review_note && (
                <p className="xsmall muted" dir="auto">
                  {a.note}: {p.review_note}
                </p>
              )}
            </div>
            <div className="queue-actions">
              {p.receipt_url ? (
                <a className="btn btn-sm" href={p.receipt_url} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" />
                  {a.viewReceipt}
                </a>
              ) : (
                <span className="xsmall muted">{a.noReceipt}</span>
              )}
              {p.status === 'pending' && (
                <>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setReview({ item: p, approve: false })}>
                    {a.reject}
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setReview({ item: p, approve: true })}>
                    <Icon name="check" />
                    {a.approve}
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {review && (
        <ReviewDialog
          item={review.item}
          approve={review.approve}
          onClose={(done) => {
            setReview(null);
            if (done) router.refresh();
          }}
        />
      )}
    </>
  );
}
