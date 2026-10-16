'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/client';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Enrollment {
  factorId: string;
  qr: string;
  secret: string;
}

/** TOTP two-factor authentication through Supabase Auth MFA. */
export function SecurityPanel() {
  const { t } = useI18n();
  const s = t.security;
  const toast = useToast();
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enrolling, setEnrolling] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const load = useCallback(async () => {
    const { data } = await getSupabaseBrowser().auth.mfa.listFactors();
    setFactorId(data?.totp.find((f) => f.status === 'verified')?.id ?? null);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    setError(null);
    setBusy(true);
    const supabase = getSupabaseBrowser();
    // Remove abandoned, unverified factors first so enrolment can be retried.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `LIMO ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (err || !data) return setError(t.common.errorGeneric);
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!enrolling) return;
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabaseBrowser().auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code: code.trim() });
    setBusy(false);
    if (err) return setError(s.invalidCode);
    setEnrolling(null);
    setCode('');
    toast(s.turnedOn);
    await load();
    router.refresh();
  }

  async function turnOff() {
    if (!factorId) return;
    setBusy(true);
    const { error: err } = await getSupabaseBrowser().auth.mfa.unenroll({ factorId });
    setBusy(false);
    setConfirmOff(false);
    if (err) return toast(t.common.errorGeneric, 'error');
    toast(s.turnedOff);
    await load();
    router.refresh();
  }

  if (!loaded) return <div className="skeleton" style={{ height: 40 }} />;

  return (
    <div className="stack">
      <p className="small muted">{s.lead}</p>
      {factorId ? (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="badge badge-success">{s.enabled}</span>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirmOff(true)} disabled={busy}>
            {s.remove}
          </button>
        </div>
      ) : enrolling ? (
        <form className="stack" onSubmit={verify}>
          <p className="small">{s.scan}</p>
          {/* Supabase returns the QR code as an SVG data URI. */}
          <img src={enrolling.qr} alt="" width={180} height={180} style={{ background: '#fff', borderRadius: 12, border: '1px solid var(--line)' }} />
          <div className="field">
            <span className="field-label">{s.secret}</span>
            <code className="ltr small" style={{ userSelect: 'all', overflowWrap: 'anywhere' }}>
              {enrolling.secret}
            </code>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="mfa-code">
              {s.code}
            </label>
            <input id="mfa-code" className="input ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </div>
          {error && (
            <p className="form-message error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
              {s.verify}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEnrolling(null)}>
              {s.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="badge badge-warning">{s.disabled}</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void start()} disabled={busy}>
            {s.setUp}
          </button>
        </div>
      )}
      {error && !enrolling && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      <ConfirmDialog open={confirmOff} title={s.remove} body={s.removeConfirm} confirmLabel={s.remove} danger busy={busy} onClose={() => setConfirmOff(false)} onConfirm={() => void turnOff()} />
    </div>
  );
}
