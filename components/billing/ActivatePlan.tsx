'use client';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES, type PaymentMethod } from '@/lib/billing/payments';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';

export interface PlanOption {
  code: string;
  name: string;
  monthly_dzd: number;
  redotpay_usdt: number;
  video_slots: number;
  ai_images: number;
}

export interface MethodOption {
  method: PaymentMethod;
  display_name: string;
  account_holder: string | null;
  account_number: string | null;
  ccp_key: string | null;
  redotpay_uid: string | null;
  instructions: string | null;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="pay-field">
      <span className="pay-field-label">{label}</span>
      <span className="pay-field-value ltr">{value}</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable: value stays selectable */
          }
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} />
        {copied ? t.billing.activate.copied : t.billing.activate.copy}
      </button>
    </div>
  );
}

export function ActivatePlan({
  organizationId,
  canPay,
  plans,
  methods,
  defaultPlan,
}: {
  organizationId: string;
  canPay: boolean;
  plans: PlanOption[];
  methods: MethodOption[];
  defaultPlan: string | null;
}) {
  const { t, intl } = useI18n();
  const a = t.billing.activate;
  const toast = useToast();
  const router = useRouter();
  const ids = useId();
  const [planCode, setPlanCode] = useState(defaultPlan ?? plans[1]?.code ?? plans[0]?.code ?? '');
  const [method, setMethod] = useState<PaymentMethod | ''>(methods[0]?.method ?? '');
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = plans.find((p) => p.code === planCode);
  const m = methods.find((x) => x.method === method);
  const amount = useMemo(() => {
    if (!plan || !m) return null;
    return m.method === 'redotpay'
      ? `${new Intl.NumberFormat(intl, { maximumFractionDigits: 2 }).format(plan.redotpay_usdt)} USDT`
      : `${new Intl.NumberFormat(intl, { maximumFractionDigits: 0 }).format(plan.monthly_dzd)} DZD`;
  }, [plan, m, intl]);

  if (!canPay) return <p className="callout">{a.ownerOnly}</p>;
  if (methods.length === 0) {
    return (
      <div className="callout callout-warning">
        <Icon name="info" />
        <div>{a.noMethods}</div>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const ref = reference.trim();
    if (ref.length < 3 || ref.length > 200) return setError(a.errors.invalid_reference);
    if (!plan || !m) return setError(a.errors.invalid_item);
    let receiptPath: string | null = null;
    if (file) {
      const ext = RECEIPT_TYPES[file.type];
      if (!ext || file.size > RECEIPT_MAX_BYTES) return setError(a.errors.receipt_invalid);
      setBusy(true);
      receiptPath = `${organizationId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await getSupabaseBrowser().storage.from('payment-receipts').upload(receiptPath, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setBusy(false);
        return setError(a.errors.upload_failed);
      }
    }
    setBusy(true);
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchase_type: 'subscription', item_code: plan.code, method: m.method, transaction_ref: ref, receipt_path: receiptPath }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const key = (body.error ?? 'unknown') as keyof typeof a.errors;
        setError(a.errors[key] ?? a.errors.unknown);
        return;
      }
      toast(a.submitted);
      setReference('');
      setFile(null);
      router.refresh();
    } catch {
      setError(t.studio.saveErrors.network);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="activate" onSubmit={submit}>
      <fieldset className="plain-fieldset activate-step">
        <legend>
          <span className="step-num ltr">1</span>
          {a.choosePlan}
        </legend>
        <div className="activate-plans" role="radiogroup" aria-label={a.choosePlan}>
          {plans.map((p) => (
            <button key={p.code} type="button" role="radio" aria-checked={p.code === planCode} className="activate-plan" onClick={() => setPlanCode(p.code)}>
              <b>{p.name}</b>
              <span className="ltr">{new Intl.NumberFormat(intl).format(p.monthly_dzd)} DZD</span>
              <small>
                {fmt(t.pricing.videoSlots, { n: p.video_slots })} · {fmt(t.pricing.images, { n: p.ai_images })}
              </small>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="plain-fieldset activate-step">
        <legend>
          <span className="step-num ltr">2</span>
          {a.chooseMethod}
        </legend>
        <div className="segmented" role="radiogroup" aria-label={a.chooseMethod}>
          {methods.map((x) => (
            <button key={x.method} type="button" role="radio" aria-checked={x.method === method} onClick={() => setMethod(x.method)}>
              {x.display_name}
            </button>
          ))}
        </div>
        {m && (
          <div className="pay-details">
            {amount && <CopyField label={a.amountDue} value={amount} />}
            {m.account_holder && <CopyField label={a.accountHolder} value={m.account_holder} />}
            {m.account_number && <CopyField label={a.accountNumber} value={m.account_number} />}
            {m.ccp_key && <CopyField label={a.ccpKey} value={m.ccp_key} />}
            {m.redotpay_uid && <CopyField label={a.redotpayUid} value={m.redotpay_uid} />}
            {m.instructions && (
              <div className="pay-instructions">
                <span className="pay-field-label">{a.instructions}</span>
                <p dir="auto">{m.instructions}</p>
              </div>
            )}
          </div>
        )}
      </fieldset>

      <fieldset className="plain-fieldset activate-step">
        <legend>
          <span className="step-num ltr">3</span>
          {a.payAndSubmit}
        </legend>
        <div className="form-grid cols-2">
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-ref`}>
              {a.reference}
            </label>
            <input id={`${ids}-ref`} className="input ltr" value={reference} maxLength={200} required onChange={(e) => setReference(e.target.value)} aria-describedby={`${ids}-ref-hint`} />
            <span id={`${ids}-ref-hint`} className="field-hint">
              {a.referenceHint}
            </span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-receipt`}>
              {a.receipt}
            </label>
            <input
              id={`${ids}-receipt`}
              className="input"
              type="file"
              accept={Object.keys(RECEIPT_TYPES).join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-describedby={`${ids}-receipt-hint`}
            />
            <span id={`${ids}-receipt-hint`} className="field-hint">
              {a.receiptHint}
            </span>
          </div>
        </div>
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
            {busy ? t.common.loading : a.submit}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
