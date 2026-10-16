import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShellFromContext } from '@/components/app/ShellFromContext';
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
  return <ShellFromContext ctx={ctx}>{children}</ShellFromContext>;
}
