import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { listProjects } from '@/lib/data/projects';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { Icon } from '@/components/ui/Icon';
import { ProjectsBrowser } from '@/components/app/ProjectsBrowser';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.projects.title };
}

export default async function ProjectsPage() {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const projects = ctx.org ? await listProjects(supabase, ctx.org.organization_id) : [];

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>{t.projects.title}</h1>
          <p>{t.projects.lead}</p>
        </div>
        {ctx.canEdit && (
          <div className="page-actions">
            <Link className="btn btn-primary" href="/app/projects/new">
              <Icon name="plus" />
              {t.nav.newProject}
            </Link>
          </div>
        )}
      </div>
      {projects === null ? <p className="callout callout-danger">{t.common.errorGeneric}</p> : <ProjectsBrowser projects={projects} canEdit={ctx.canEdit} />}
    </div>
  );
}
