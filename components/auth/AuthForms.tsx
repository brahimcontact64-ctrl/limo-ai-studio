'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/client';
import { fmt } from '@/lib/i18n/config';
import { authErrorKey, safeNext } from '@/lib/auth/redirect';

type Status = { kind: 'error' | 'success'; text: string } | null;

function useAuthError() {
  const { t } = useI18n();
  return (error: unknown) => {
    const key = authErrorKey(error as { code?: string; message?: string; status?: number });
    return key ? t.auth[key] : t.common.errorGeneric;
  };
}

function Message({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p className={`form-message ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
      {status.text}
    </p>
  );
}

export function SignInForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const toMessage = useAuthError();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(params.get('error') === 'link' ? { kind: 'error', text: t.auth.linkInvalid } : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const { error } = await getSupabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      router.replace(safeNext(params.get('next')));
      router.refresh();
    } catch (err) {
      setStatus({ kind: 'error', text: toMessage(err) });
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate={false}>
      <Message status={status} />
      <label className="field">
        <span className="field-label">{t.common.email}</span>
        <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <div className="field">
        <div className="field-label">
          <label htmlFor="signin-password">{t.common.password}</label>
          <Link className="link xsmall" href="/forgot-password">
            {t.auth.forgotLink}
          </Link>
        </div>
        <input
          id="signin-password"
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
        {busy ? t.common.loading : t.common.signIn}
      </button>
      <p className="auth-alt">
        <Link href="/signup">{t.auth.newCustomer}</Link>
      </p>
    </form>
  );
}

export function SignUpForm() {
  const { t } = useI18n();
  const router = useRouter();
  const toMessage = useAuthError();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setStatus({ kind: 'error', text: t.auth.passwordTooShort });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const { data, error } = await getSupabaseBrowser().auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/app/onboarding` },
      });
      if (error) throw error;
      // Supabase returns a user with no identities when the email is already registered.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setStatus({ kind: 'error', text: t.auth.userExists });
        setBusy(false);
        return;
      }
      if (data.session) {
        router.replace('/app/onboarding');
        router.refresh();
        return;
      }
      setStatus({ kind: 'success', text: fmt(t.auth.confirmEmail, { email: email.trim() }) });
      setBusy(false);
    } catch (err) {
      setStatus({ kind: 'error', text: toMessage(err) });
      setBusy(false);
    }
  }

  const terms = t.auth.termsAgree.split(/(\{terms\}|\{privacy\})/);
  return (
    <form className="stack" onSubmit={submit}>
      <Message status={status} />
      <label className="field">
        <span className="field-label">{t.common.email}</span>
        <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <div className="field">
        <label className="field-label" htmlFor="signup-password">
          {t.common.password}
        </label>
        <input
          id="signup-password"
          className="input"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="pw-hint"
        />
        <span id="pw-hint" className="field-hint">
          {t.auth.passwordHint}
        </span>
      </div>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
        {busy ? t.common.loading : t.common.signUp}
      </button>
      <p className="auth-alt xsmall">
        {terms.map((part, i) =>
          part === '{terms}' ? (
            <Link key={i} href="/legal/terms">
              {t.legal.termsTitle}
            </Link>
          ) : part === '{privacy}' ? (
            <Link key={i} href="/legal/privacy">
              {t.legal.privacyTitle}
            </Link>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
      <p className="auth-alt">
        <Link href="/login">{t.auth.existingCustomer}</Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const toMessage = useAuthError();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const { error } = await getSupabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    // Do not reveal whether the account exists; only surface rate limiting.
    if (error && authErrorKey(error) === 'rateLimited') setStatus({ kind: 'error', text: toMessage(error) });
    else setStatus({ kind: 'success', text: fmt(t.auth.checkEmail, { email: email.trim() }) });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Message status={status} />
      <label className="field">
        <span className="field-label">{t.common.email}</span>
        <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
        {busy ? t.common.loading : t.auth.sendLink}
      </button>
      <p className="auth-alt">
        <Link href="/login">{t.common.back}</Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm() {
  const { t } = useI18n();
  const router = useRouter();
  const toMessage = useAuthError();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setStatus({ kind: 'error', text: t.auth.passwordTooShort });
    if (password !== confirm) return setStatus({ kind: 'error', text: t.auth.passwordMismatch });
    setBusy(true);
    const { error } = await getSupabaseBrowser().auth.updateUser({ password });
    if (error) {
      setStatus({ kind: 'error', text: toMessage(error) });
      setBusy(false);
      return;
    }
    setStatus({ kind: 'success', text: t.auth.passwordUpdated });
    router.replace('/app');
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Message status={status} />
      <label className="field">
        <span className="field-label">{t.auth.newPassword}</span>
        <input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">{t.auth.confirmPassword}</span>
        <input className="input" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy}>
        {busy ? t.common.loading : t.auth.updatePassword}
      </button>
    </form>
  );
}
