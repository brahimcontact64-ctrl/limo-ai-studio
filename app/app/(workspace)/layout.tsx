import type { Metadata } from 'next';
import { ShellFromContext } from '@/components/app/ShellFromContext';
import { requireAppContext } from '@/lib/data/context';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAppContext();
  return <ShellFromContext ctx={ctx}>{children}</ShellFromContext>;
}
