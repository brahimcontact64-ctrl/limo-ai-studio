import type { Metadata } from 'next';
import { AppShell } from '@/components/app/Shell';
import { requireAppContext } from '@/lib/data/context';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  return (
    <AppShell
      email={ctx.user.email}
      orgId={ctx.org?.organization_id ?? null}
      orgName={ctx.org?.name ?? null}
      role={ctx.org?.role ?? null}
      memberships={ctx.memberships.map((m) => ({ organization_id: m.organization_id, name: m.name }))}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      {children}
    </AppShell>
  );
}
