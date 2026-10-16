import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShellFromContext } from '@/components/app/ShellFromContext';
import { AdminMfaGate } from '@/components/admin/AdminMfaGate';
import { requireAppContext } from '@/lib/data/context';
import { getSupabaseServer } from '@/lib/supabase/server';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Platform administration.
 * 1. is_platform_admin() decides access; non-admins get a 404 so the area is not discoverable.
 * 2. The session must have passed a second factor (aal2). Admin database functions enforce the same
 *    rule (is_platform_admin_mfa), so this gate is a UX layer over a database guarantee.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  if (!ctx.isPlatformAdmin) notFound();

  const supabase = await getSupabaseServer();
  const [{ data: aal }, { data: factors }] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
  const verifiedFactor = factors?.totp.find((f) => f.status === 'verified')?.id ?? null;
  const strong = aal?.currentLevel === 'aal2';

  return <ShellFromContext ctx={ctx}>{strong ? children : <AdminMfaGate factorId={verifiedFactor} />}</ShellFromContext>;
}
