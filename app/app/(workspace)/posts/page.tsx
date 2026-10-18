import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppContext } from '@/lib/data/context';
import { listFullPosts, loadControls } from '@/lib/data/social';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { Icon } from '@/components/ui/Icon';
import { PostPlanner } from '@/components/social/PostPlanner';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.posts.title };
}

export default async function PostsPage() {
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const [posts, controls] = ctx.org ? await Promise.all([listFullPosts(supabase, ctx.org.organization_id), loadControls(supabase, ctx.org.organization_id)]) : [[], { paused: false, reason: null }];
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>{t.posts.title}</h1>
          <p>{t.social.lead}</p>
        </div>
        {ctx.canEdit && posts !== null && (
          <div className="page-actions">
            <Link className="btn" href="/app/social">
              <Icon name="settings" />
              {t.nav.social}
            </Link>
            <Link className="btn btn-primary" href="/app/posts/new">
              <Icon name="plus" />
              {t.posts.newPost}
            </Link>
          </div>
        )}
      </div>
      <p className="callout small">
        <Icon name="info" />
        <span>{t.social.notConnected}</span>
      </p>
      {controls.paused && (
        <p className="callout callout-warning small">
          <Icon name="alert" />
          <span>{t.social.pausedNote}</span>
        </p>
      )}
      {posts === null ? (
        <p className="callout callout-warning">{t.images.unavailable}</p>
      ) : (
        <PostPlanner
          posts={posts.map((p) => ({ id: p.id, title: p.title, caption: p.caption, status: p.status, simulated: p.simulated, origin: p.origin, scheduled_at: p.scheduled_at, published_at: p.published_at, updated_at: p.updated_at, last_error: p.last_error }))}
        />
      )}
    </div>
  );
}
