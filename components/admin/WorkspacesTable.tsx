'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import { useToast } from '@/components/ui/Toast';

export interface WorkspaceRow {
  id: string;
  name: string;
  owner_email: string | null;
  members: number;
  plan_code: string | null;
  subscription_status: string | null;
  renews_at: string | null;
  video_slots_used: number | null;
  video_slots_total: number | null;
  projects: number;
  pending_payments: number;
}

function SubscriptionDialog({ ws, plans, onClose }: { ws: WorkspaceRow; plans: Array<{ code: string; name: string }>; onClose: (done: boolean) => void }) {
  const { t } = useI18n();
  const w = t.adminWs;
  const toast = useToast();
  const ref = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState(ws.plan_code ?? plans[0]?.code ?? '');
  const [status, setStatus] = useState(ws.subscription_status === 'past_due' || ws.subscription_status === 'canceled' ? ws.subscription_status : 'active');
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => ref.current?.showModal(), []);

  async function save() {
    if (reason.trim().length < 5) return setError(w.reasonRequired);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/workspaces/${ws.id}/subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_code: plan, status, days: days.trim() ? Number(days) : null, reason: reason.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(t.common.errorGeneric);
    toast(w.saved);
    ref.current?.close();
    onClose(true);
  }

  return (
    <dialog ref={ref} className="dialog" onClose={() => onClose(false)} aria-labelledby="ws-dialog-h">
      <div className="dialog-body">
        <h2 id="ws-dialog-h">{fmt(w.dialogTitle, { workspace: ws.name })}</h2>
        <div className="form-grid cols-2">
          <div className="field">
            <label className="field-label" htmlFor="ws-plan">
              {w.plan}
            </label>
            <select id="ws-plan" className="select" value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ws-status">
              {w.status}
            </label>
            <select id="ws-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {(['active', 'past_due', 'canceled'] as const).map((s) => (
                <option key={s} value={s}>
                  {t.billing.status[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ws-days">
            {w.days}
          </label>
          <input id="ws-days" className="input ltr" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} aria-describedby="ws-days-hint" />
          <span id="ws-days-hint" className="field-hint">
            {w.daysHint}
          </span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ws-reason">
            {w.reason}
          </label>
          <textarea id="ws-reason" className="textarea" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" />
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
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          {busy ? t.common.saving : w.save}
        </button>
      </div>
    </dialog>
  );
}

export function WorkspacesTable({ rows, plans }: { rows: WorkspaceRow[]; plans: Array<{ code: string; name: string }> }) {
  const { t, intl } = useI18n();
  const w = t.adminWs;
  const router = useRouter();
  const [editing, setEditing] = useState<WorkspaceRow | null>(null);
  const planName = (code: string | null) => (code ? (plans.find((p) => p.code === code)?.name ?? code) : w.none);

  if (rows.length === 0) return <p className="empty">{w.empty}</p>;
  return (
    <section className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t.settings.name}</th>
              <th scope="col">{w.owner}</th>
              <th scope="col">{w.plan}</th>
              <th scope="col">{w.renews}</th>
              <th scope="col">{w.usage}</th>
              <th scope="col">{w.projects}</th>
              <th scope="col">{w.pending}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                  <div className="xsmall muted">
                    {r.members} · <span className="ltr">{r.id.slice(0, 8)}</span>
                  </div>
                  {/* First column so the action stays reachable without scrolling the table on phones. */}
                  <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setEditing(r)}>
                    {w.manage}
                  </button>
                </td>
                <td className="small ltr">{r.owner_email ?? '—'}</td>
                <td>
                  {planName(r.plan_code)}{' '}
                  {r.subscription_status && (
                    <span className={`badge ${r.subscription_status === 'active' ? 'badge-success' : 'badge-warning'}`}>{(t.billing.status as Record<string, string>)[r.subscription_status] ?? r.subscription_status}</span>
                  )}
                </td>
                <td className="small">{r.renews_at ? formatDate(intl, r.renews_at) : '—'}</td>
                <td className="small ltr">{r.video_slots_total !== null ? `${r.video_slots_used}/${r.video_slots_total}` : '—'}</td>
                <td className="small ltr">{r.projects}</td>
                <td className="small ltr">{r.pending_payments || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <SubscriptionDialog
          ws={editing}
          plans={plans}
          onClose={(done) => {
            setEditing(null);
            if (done) router.refresh();
          }}
        />
      )}
    </section>
  );
}
