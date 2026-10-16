'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ACTIVE_ORG_COOKIE, loadAppContext } from './context';
import { getSupabaseServer } from '../supabase/server';

/** Switches the active workspace. The cookie is only set for organizations the user belongs to. */
export async function setActiveOrgAction(organizationId: string): Promise<{ ok: boolean }> {
  const ctx = await loadAppContext();
  if (!ctx || !ctx.memberships.some((m) => m.organization_id === organizationId)) return { ok: false };
  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 180 });
  revalidatePath('/app', 'layout');
  return { ok: true };
}

export type OnboardingResult = { ok: true } | { ok: false; error: 'age' | 'required' | 'dobLocked' | 'accept' | 'generic' };

// Policy versions recorded in policy_acceptance_events. Bump when the legal texts change.
const TERMS_VERSION = 'terms-2026-10';
const SAFETY_POLICY_VERSION = 'safety-2026-10';

export async function completeProfileAction(form: {
  firstName: string;
  lastName: string;
  countryName: string;
  countryCode: string;
  region: string;
  dateOfBirth: string;
  accountType: string;
  acceptTerms: boolean;
  acceptSafety: boolean;
}): Promise<OnboardingResult> {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'generic' };
  if (!form.acceptTerms || !form.acceptSafety) return { ok: false, error: 'accept' };
  const required = [form.firstName, form.lastName, form.countryName, form.countryCode, form.region, form.dateOfBirth];
  if (required.some((v) => typeof v !== 'string' || !v.trim())) return { ok: false, error: 'required' };
  if (!['creator', 'business', 'agency'].includes(form.accountType)) return { ok: false, error: 'required' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth)) return { ok: false, error: 'required' };

  const { error } = await supabase.rpc('complete_registration_profile_v2', {
    p_first_name: form.firstName.trim().slice(0, 80),
    p_last_name: form.lastName.trim().slice(0, 80),
    p_country_name: form.countryName.trim().slice(0, 120),
    p_country_code: form.countryCode.trim().toUpperCase().slice(0, 3),
    p_state_region: form.region.trim().slice(0, 120),
    p_date_of_birth: form.dateOfBirth,
    p_account_type: form.accountType,
    p_terms_version: TERMS_VERSION,
    p_safety_policy_version: SAFETY_POLICY_VERSION,
  });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes('18 or older')) return { ok: false, error: 'age' };
    if (m.includes('date of birth cannot be changed')) return { ok: false, error: 'dobLocked' };
    if (m.includes('required') || m.includes('invalid')) return { ok: false, error: 'required' };
    return { ok: false, error: 'generic' };
  }
  revalidatePath('/app', 'layout');
  return { ok: true };
}

/** Requires migration 20261016120000 (rename_organization). */
export async function renameWorkspaceAction(organizationId: string, name: string): Promise<{ ok: boolean; unavailable?: boolean }> {
  const ctx = await loadAppContext();
  const membership = ctx?.memberships.find((m) => m.organization_id === organizationId);
  if (!membership || !['owner', 'admin'].includes(membership.role)) return { ok: false };
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 120) return { ok: false };
  const supabase = await getSupabaseServer();
  const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>;
  const { error } = await rpc('rename_organization', { p_organization_id: organizationId, p_name: trimmed });
  if (error) return { ok: false, unavailable: error.code === 'PGRST202' };
  revalidatePath('/app', 'layout');
  return { ok: true };
}
