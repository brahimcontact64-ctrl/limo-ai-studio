import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app/Shell';
import { requireAppContext } from '@/lib/data/context';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Platform administration. Access is decided on the server by public.is_platform_admin()
 * (platform_admins table); non-admins get a 404 so the area is not discoverable.
 * Every query below also runs under RLS policies that check is_platform_admin().
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  if (!ctx.isPlatformAdmin) notFound();
  return (
    <AppShell
      email={ctx.user.email}
      orgId={ctx.org?.organization_id ?? null}
      orgName={ctx.org?.name ?? null}
      role={ctx.org?.role ?? null}
      memberships={ctx.memberships.map((m) => ({ organization_id: m.organization_id, name: m.name }))}
      isPlatformAdmin
    >
      {children}
    </AppShell>
  );
}
