import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAppContext, canEditRole } from '@/lib/data/context';
import { getBrandKit } from '@/lib/data/assets';
import { listImageExports, listImageRevisions, loadImageProject, signedImageUrls } from '@/lib/data/images';
import { assetIds } from '@/lib/images/doc';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getI18n } from '@/lib/i18n/server';
import { isUuid } from '@/lib/studio/validation';
import { ImageEditor } from '@/components/images/ImageEditor';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { t } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) return { title: t.images.title };
  const project = await loadImageProject(await getSupabaseServer(), id);
  return { title: project?.title ?? t.images.title };
}

export default async function ImageProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ post?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireAppContext();
  const { t } = await getI18n();
  const supabase = await getSupabaseServer();
  // RLS returns nothing for designs outside the user's workspaces (the middleware answers 404 first).
  const project = await loadImageProject(supabase, id);
  if (!project) notFound();
  const [revisions, exports, kit] = await Promise.all([listImageRevisions(supabase, id, project.aspect), listImageExports(supabase, id), getBrandKit(supabase, project.organization_id)]);
  const logo = kit?.logo_asset_id ?? null;
  const urls = await signedImageUrls(supabase, [...new Set([...assetIds(project.document), ...revisions.flatMap((r) => assetIds(r.document)), ...(logo ? [logo] : [])])]);
  const canEdit = canEditRole(ctx.memberships.find((m) => m.organization_id === project.organization_id)?.role);
  const post = (await searchParams).post;

  return (
    <div className="content-inner stack">
      <Link className="eyebrow" href="/app/images">
        {t.images.title}
      </Link>
      <ImageEditor
        key={project.updated_at}
        project={project}
        urls={urls}
        canEdit={canEdit}
        revisions={revisions}
        exports={exports}
        brandLogo={logo && urls[logo] ? { id: logo, url: urls[logo] } : null}
        postId={post && isUuid(post) ? post : null}
      />
    </div>
  );
}
