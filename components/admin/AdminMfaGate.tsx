'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/client';

/** Shown instead of the admin area until the session reaches aal2 (second factor verified). */
export function AdminMfaGate({ factorId }: { factorId: string | null }) {
  const { t } = useI18n();
  const g = t.adminGate;
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabaseBrowser().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (err) return setError(t.security.invalidCode);
    router.refresh();
  }

  return (
    <div className="content-inner" style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      <section className="auth-card narrow" aria-labelledby="gate-h">
        <span className="eyebrow accent">{t.nav.admin}</span>
        <h1 id="gate-h">{factorId ? g.title : g.needsSetupTitle}</h1>
        <p className="lead">{factorId ? g.lead : g.needsSetup}</p>
        {factorId ? (
          <form className="stack" onSubmit={verify}>
            <div className="field">
              <label className="field-label" htmlFor="gate-code">
                {t.security.code}
              </label>
              <input id="gate-code" className="input ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </div>
            {error && (
              <p className="form-message error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || code.length !== 6}>
              {g.verify}
            </button>
          </form>
        ) : (
          <div style={{ marginTop: 20 }}>
            <Link className="btn btn-primary btn-block" href="/app/settings#security">
              {g.goToSetup}
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
