import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireAppContext, canEditRole, isSubscriptionActive } from '@/lib/data/context';
import { getCatalogs } from '@/lib/data/catalog';
import { loadProject } from '@/lib/data/projects';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { isUuid } from '@/lib/studio/validation';
import { StudioEditor } from '@/components/studio/StudioEditor';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { t } = await getI18n();
  if (!isUuid(id)) return { title: t.nav.projects };
  const supabase = await getSupabaseServer();
  const { data } = await supabase.from('studio_projects').select('title').eq('id', id).maybeSingle();
  return { title: data?.title ?? t.nav.projects };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireAppContext();
  const supabase = await getSupabaseServer();
  const [project, catalogs] = await Promise.all([loadProject(supabase, id), getCatalogs()]);
  // RLS returns nothing for projects outside the user's workspaces: treat as not found.
  if (!project) notFound();

  const membership = ctx.memberships.find((m) => m.organization_id === project.organization_id);
  let subscriptionActive = ctx.subscriptionActive;
  if (project.organization_id !== ctx.org?.organization_id) {
    const { data: sub } = await supabase
      .from('organization_subscriptions')
      .select('status, renews_at')
      .eq('organization_id', project.organization_id)
      .maybeSingle();
    subscriptionActive = isSubscriptionActive(sub ?? null);
  }

  return (
    <StudioEditor
      key={project.updated_at}
      initialDraft={project.draft}
      status={project.status}
      updatedAt={project.updated_at}
      catalogs={{ contentTypes: catalogs.contentTypes, languages: catalogs.languages, exportPresets: catalogs.exportPresets, characters: catalogs.characters }}
      canEdit={canEditRole(membership?.role)}
      subscriptionActive={subscriptionActive}
    />
  );
}
