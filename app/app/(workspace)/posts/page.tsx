import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { listPosts } from '@/lib/data/images';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { Icon } from '@/components/ui/Icon';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.posts.title };
}

export default async function PostsPage() {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const posts = ctx.org ? await listPosts(supabase, ctx.org.organization_id) : [];
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t.posts.title}</h1>
          <p>{t.posts.lead}</p>
        </div>
        {ctx.canEdit && posts !== null && (
          <div className="page-actions">
            <Link className="btn btn-primary" href="/app/posts/new">
              <Icon name="plus" />
              {t.posts.newPost}
            </Link>
          </div>
        )}
      </div>
      <p className="callout small">
        <Icon name="info" />
        <span>{t.posts.notConnected}</span>
      </p>
      {posts === null ? (
        <p className="callout callout-warning">{t.images.unavailable}</p>
      ) : posts.length === 0 ? (
        <p className="empty">{t.posts.empty}</p>
      ) : (
        <ul className="project-list panel">
          {posts.map((p) => (
            <li key={p.id} className="project-row">
              <div className="project-row-main">
                <div className="project-row-title">
                  <Link href={`/app/posts/${p.id}`} dir="auto" prefetch={false}>
                    {p.title}
                  </Link>
                  <span className={`badge ${p.status === 'approved' ? 'badge-success' : 'badge-info'}`}>{p.status === 'approved' ? t.posts.approved : t.posts.draft}</span>
                </div>
                <div className="project-meta">
                  <span className="clamp-1" dir="auto">
                    {p.caption.trim() || t.posts.noCaption}
                  </span>
                  {p.media_asset_id && (
                    <span>
                      <Icon name="image" size={12} /> {t.posts.image.title}
                    </span>
                  )}
                  <RelativeTime iso={p.updated_at} template={t.common.updated} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
