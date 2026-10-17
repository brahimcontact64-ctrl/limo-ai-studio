import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAppContext } from '@/lib/data/context';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { PostComposer } from '@/components/posts/PostComposer';
import { loadComposerData } from '@/components/posts/loadComposer';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.posts.newPost };
}

export default async function NewPostPage() {
  const ctx = await requireAppContext();
  if (!ctx.org || !ctx.canEdit) redirect('/app/posts');
  const { t } = await getI18n();
  const data = await loadComposerData(await getSupabaseServer(), ctx.org.organization_id, ctx.org.name, null);
  return (
    <div className="content-inner stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <Link className="eyebrow" href="/app/posts">
            {t.posts.title}
          </Link>
          <h1>{t.posts.newPost}</h1>
        </div>
      </div>
      <PostComposer
        organizationId={ctx.org.organization_id}
        post={{ id: null, title: '', caption: '', hashtags: [], image_project_id: null, media_asset_id: null, status: 'draft', updated_at: null }}
        images={data.images}
        urls={data.urls}
        mediaUrl={null}
        pageName={data.pageName}
        canEdit
      />
    </div>
  );
}
