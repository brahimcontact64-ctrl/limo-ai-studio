import 'server-only';
import type { ServerSupabase } from '@/lib/supabase/server';
import { getBrandKit } from '@/lib/data/assets';
import { listImageProjects, signedImageUrls } from '@/lib/data/images';
import { listPages, listVideoCandidates, loadControls } from '@/lib/data/social';
import { assetIds } from '@/lib/images/doc';
import type { ComposerDesign } from '@/components/social/Composer';

/** Everything the composer needs: designs, MP4 exports, Pages, pause state and preview URLs. */
export async function loadComposerData(supabase: ServerSupabase, organizationId: string, orgName: string, mediaAssetId: string | null) {
  const [projects, kit, videos, pages, controls] = await Promise.all([
    listImageProjects(supabase, organizationId),
    getBrandKit(supabase, organizationId),
    listVideoCandidates(supabase, organizationId),
    listPages(supabase, organizationId),
    loadControls(supabase, organizationId),
  ]);
  const designs: ComposerDesign[] = (projects ?? []).slice(0, 24).map((p) => ({ id: p.id, title: p.title, status: p.status, document: p.document }));
  const urls = await signedImageUrls(supabase, [
    ...new Set([...designs.flatMap((d) => assetIds(d.document)), ...(mediaAssetId ? [mediaAssetId] : []), ...videos.map((v) => v.media_asset_id).filter(Boolean)]),
  ]);
  return {
    designs,
    urls,
    videos: videos.map((v) => ({ ...v, url: urls[v.media_asset_id] ?? null })),
    mediaUrl: mediaAssetId ? (urls[mediaAssetId] ?? null) : null,
    pages: pages.filter((p) => p.status === 'active'),
    paused: controls.paused,
    pageName: kit?.brand_name || orgName,
  };
}
