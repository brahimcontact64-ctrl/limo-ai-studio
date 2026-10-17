import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAppContext, canEditRole } from '@/lib/data/context';
import { loadPost } from '@/lib/data/images';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { isUuid } from '@/lib/studio/validation';
import { PostComposer } from '@/components/posts/PostComposer';
import { loadComposerData } from '@/components/posts/loadComposer';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { t } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) return { title: t.posts.title };
  const post = await loadPost(await getSupabaseServer(), id);
  return { title: post?.title ?? t.posts.title };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  const post = await loadPost(supabase, id);
  if (!post) notFound();
  const membership = ctx.memberships.find((m) => m.organization_id === post.organization_id);
  const data = await loadComposerData(supabase, post.organization_id, membership?.name ?? '', post.media_asset_id);
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <Link className="eyebrow" href="/app/posts">
            {t.posts.title}
          </Link>
          <h1 dir="auto">{post.title}</h1>
        </div>
      </div>
      <PostComposer
        key={post.updated_at}
        organizationId={post.organization_id}
        post={post}
        images={data.images}
        urls={data.urls}
        mediaUrl={data.mediaUrl}
        pageName={data.pageName}
        canEdit={canEditRole(membership?.role)}
      />
    </div>
  );
}
