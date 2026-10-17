import 'server-only';
import type { ServerSupabase } from '@/lib/supabase/server';
import { getBrandKit } from '@/lib/data/assets';
import { listImageProjects, signedImageUrls } from '@/lib/data/images';
import { assetIds } from '@/lib/images/doc';
import type { ComposerImage } from './PostComposer';

/** Designs the composer can attach (newest first) with preview URLs, plus the page name for the preview card. */
export async function loadComposerData(supabase: ServerSupabase, organizationId: string, orgName: string, mediaAssetId: string | null) {
  const [projects, kit] = await Promise.all([listImageProjects(supabase, organizationId), getBrandKit(supabase, organizationId)]);
  const images: ComposerImage[] = (projects ?? []).slice(0, 24).map((p) => ({ id: p.id, title: p.title, status: p.status, document: p.document }));
  const urls = await signedImageUrls(supabase, [...new Set([...images.flatMap((i) => assetIds(i.document)), ...(mediaAssetId ? [mediaAssetId] : [])])]);
  return { images, urls, mediaUrl: mediaAssetId ? (urls[mediaAssetId] ?? null) : null, pageName: kit?.brand_name || orgName };
}
