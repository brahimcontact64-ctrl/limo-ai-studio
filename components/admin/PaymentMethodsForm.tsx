'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { useToast } from '@/components/ui/Toast';

export interface MethodRow {
  method: string;
  display_name: string;
  enabled: boolean;
  account_holder: string | null;
  account_number: string | null;
  ccp_key: string | null;
  redotpay_uid: string | null;
  instructions: string | null;
}

function MethodCard({ row }: { row: MethodRow }) {
  const { t } = useI18n();
  const a = t.billing.activate;
  const toast = useToast();
  const router = useRouter();
  const [form, setForm] = useState({
    enabled: row.enabled,
    display_name: row.display_name ?? '',
    account_holder: row.account_holder ?? '',
    account_number: row.account_number ?? '',
    ccp_key: row.ccp_key ?? '',
    redotpay_uid: row.redotpay_uid ?? '',
    instructions: row.instructions ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const id = (k: string) => `pm-${row.method}-${k}`;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/payment-methods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: row.method, ...form }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!res?.ok) return setError(body?.error === 'unavailable' ? t.admin.unavailable : t.admin.errors.unknown);
    toast(t.admin.savedToast);
    router.refresh();
  }

  const text = (k: keyof typeof form, label: string, max: number) => (
    <div className="field">
      <label className="field-label" htmlFor={id(k)}>
        {label}
      </label>
      <input id={id(k)} className="input" maxLength={max} value={form[k] as string} onChange={(e) => set(k)(e.target.value)} />
    </div>
  );

  return (
    <form className="panel panel-pad stack" onSubmit={save} aria-labelledby={id('title')}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 id={id('title')} style={{ fontSize: 'var(--fs-lg)' }}>
          {form.display_name || row.method}
        </h2>
        <label className="checkbox">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled')(e.target.checked)} />
          <span>{t.admin.enabled}</span>
        </label>
      </div>
      <div className="form-grid cols-2">
        {text('display_name', t.admin.displayName, 80)}
        {text('account_holder', a.accountHolder, 120)}
        {row.method === 'redotpay' ? text('redotpay_uid', a.redotpayUid, 120) : text('account_number', a.accountNumber, 120)}
        {row.method === 'ccp' && text('ccp_key', a.ccpKey, 40)}
      </div>
      <div className="field">
        <label className="field-label" htmlFor={id('instructions')}>
          {a.instructions}
        </label>
        <textarea id={id('instructions')} className="textarea" rows={3} maxLength={2000} value={form.instructions} onChange={(e) => set('instructions')(e.target.value)} dir="auto" />
      </div>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? t.common.saving : t.admin.save}
        </button>
      </div>
    </form>
  );
}

export function PaymentMethodsForm({ rows }: { rows: MethodRow[] }) {
  return (
    <div className="stack-lg">
      {rows.map((r) => (
        <MethodCard key={r.method} row={r} />
      ))}
    </div>
  );
}
