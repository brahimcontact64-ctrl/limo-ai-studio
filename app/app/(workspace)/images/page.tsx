import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { listImageProjects, signedImageUrls } from '@/lib/data/images';
import { assetIds } from '@/lib/images/doc';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { Icon } from '@/components/ui/Icon';
import { ImageGrid } from '@/components/images/ImageGrid';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.images.title };
}

export default async function ImagesPage() {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const projects = ctx.org ? await listImageProjects(supabase, ctx.org.organization_id) : [];
  const urls = projects ? await signedImageUrls(supabase, [...new Set(projects.slice(0, 60).flatMap((p) => assetIds(p.document)))]) : {};
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t.images.title}</h1>
          <p>{t.images.lead}</p>
        </div>
        {ctx.canEdit && projects !== null && (
          <div className="page-actions">
            <Link className="btn" href="/app/posts">
              {t.nav.posts}
            </Link>
            <Link className="btn btn-primary" href="/app/images/new">
              <Icon name="plus" />
              {t.images.newImage}
            </Link>
          </div>
        )}
      </div>
      {projects === null ? (
        <p className="callout callout-warning">{t.images.unavailable}</p>
      ) : projects.length === 0 ? (
        <p className="empty">{t.images.empty}</p>
      ) : (
        <ImageGrid
          urls={urls}
          items={projects.slice(0, 60).map((p) => ({ id: p.id, title: p.title, purpose: p.purpose, status: p.status, updated_at: p.updated_at, document: p.document }))}
        />
      )}
    </div>
  );
}
