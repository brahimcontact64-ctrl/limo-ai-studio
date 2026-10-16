/**
 * Only allow same-origin relative paths as post-auth destinations.
 * Rejects absolute URLs, protocol-relative URLs (//evil.com) and backslash tricks.
 */
export function safeNext(value: string | null | undefined, fallback = '/app'): string {
  if (!value || typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'http://local.invalid');
    if (url.origin !== 'http://local.invalid') return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

export type AuthErrorKey =
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'rateLimited'
  | 'userExists'
  | 'weakPassword'
  | 'linkInvalid'
  | 'sessionMissing';

export function authErrorKey(error: { code?: string; message?: string; status?: number } | null | undefined): AuthErrorKey | null {
  if (!error) return null;
  const code = error.code ?? '';
  const msg = (error.message ?? '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'invalidCredentials';
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'emailNotConfirmed';
  if (code.startsWith('over_') || error.status === 429 || msg.includes('rate limit')) return 'rateLimited';
  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered')) return 'userExists';
  if (code === 'weak_password' || msg.includes('password should')) return 'weakPassword';
  if (code === 'otp_expired' || code === 'flow_state_expired' || code === 'bad_code_verifier') return 'linkInvalid';
  if (code === 'session_not_found' || msg.includes('auth session missing')) return 'sessionMissing';
  return null;
}
