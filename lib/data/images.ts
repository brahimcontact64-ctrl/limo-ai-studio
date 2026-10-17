import 'server-only';
import type { ServerSupabase } from '../supabase/server';
import { untyped } from '../supabase/rpc';
import { normalizeDoc } from '../images/doc';
import { ASPECTS, EMPTY_BRIEF, type Aspect, type ImageBrief, type ImageDoc, type ImagePurpose, type ImageStyle } from '../images/types';
import { normalizeHashtags } from '../images/posts';

export interface ImageProjectRow {
  id: string;
  organization_id: string;
  title: string;
  purpose: ImagePurpose;
  aspect: Aspect;
  style: ImageStyle;
  prompt: string;
  brief: ImageBrief;
  document: ImageDoc;
  status: 'draft' | 'approved';
  approved_at: string | null;
  series_id: string | null;
  source_project_id: string | null;
  updated_at: string;
}

const PROJECT_COLUMNS = 'id, organization_id, title, purpose, aspect, style, prompt, brief, document, status, approved_at, series_id, source_project_id, updated_at';

function toRow(r: Record<string, unknown>): ImageProjectRow {
  const aspect = (ASPECTS as readonly string[]).includes(r.aspect as string) ? (r.aspect as Aspect) : '1:1';
  return { ...(r as unknown as ImageProjectRow), aspect, brief: { ...EMPTY_BRIEF, ...((r.brief as object) ?? {}) }, document: normalizeDoc(r.document, aspect) };
}

/** Image projects of a workspace (RLS: members). null before migration 20261017180000. */
export async function listImageProjects(supabase: ServerSupabase, organizationId: string): Promise<ImageProjectRow[] | null> {
  const { data, error } = await untyped(supabase).from('image_projects').select(PROJECT_COLUMNS).eq('organization_id', organizationId).order('updated_at', { ascending: false }).limit(200);
  if (error) return null;
  return (data ?? []).map(toRow);
}

export async function loadImageProject(supabase: ServerSupabase, id: string): Promise<ImageProjectRow | null> {
  const { data } = await untyped(supabase).from('image_projects').select(PROJECT_COLUMNS).eq('id', id).maybeSingle();
  return data ? toRow(data) : null;
}

export async function listImageRevisions(supabase: ServerSupabase, projectId: string, aspect: Aspect) {
  const { data } = await untyped(supabase)
    .from('image_revisions')
    .select('id, revision_number, source, label, document, created_at, updated_at')
    .eq('image_project_id', projectId)
    .order('revision_number', { ascending: false })
    .limit(40);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    revision_number: r.revision_number as number,
    source: r.source as string,
    label: (r.label as string | null) ?? null,
    updated_at: r.updated_at as string,
    document: normalizeDoc(r.document, aspect),
  }));
}

export async function listImageExports(supabase: ServerSupabase, projectId: string) {
  const { data } = await untyped(supabase)
    .from('image_exports')
    .select('id, format, width, height, size_bytes, from_approved, revision_number, created_at, media_asset_id')
    .eq('image_project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(30);
  return (data ?? []) as Array<{ id: string; format: string; width: number; height: number; size_bytes: number; from_approved: boolean; revision_number: number | null; created_at: string; media_asset_id: string }>;
}

export interface SocialPostRow {
  id: string;
  organization_id: string;
  title: string;
  caption: string;
  hashtags: string[];
  image_project_id: string | null;
  media_asset_id: string | null;
  status: 'draft' | 'approved';
  approved_at: string | null;
  updated_at: string;
}

const POST_COLUMNS = 'id, organization_id, title, caption, hashtags, image_project_id, media_asset_id, status, approved_at, updated_at';

export async function listPosts(supabase: ServerSupabase, organizationId: string): Promise<SocialPostRow[] | null> {
  const { data, error } = await untyped(supabase).from('social_posts').select(POST_COLUMNS).eq('organization_id', organizationId).order('updated_at', { ascending: false }).limit(200);
  if (error) return null;
  return (data ?? []).map((p: Record<string, unknown>) => ({ ...(p as unknown as SocialPostRow), hashtags: normalizeHashtags(p.hashtags) }));
}

export async function loadPost(supabase: ServerSupabase, id: string): Promise<SocialPostRow | null> {
  const { data } = await untyped(supabase).from('social_posts').select(POST_COLUMNS).eq('id', id).maybeSingle();
  return data ? { ...(data as SocialPostRow), hashtags: normalizeHashtags((data as SocialPostRow).hashtags) } : null;
}

/** Short-lived URLs for specific workspace images (RLS on storage decides access). */
export async function signedImageUrls(supabase: ServerSupabase, assetIds: string[]): Promise<Record<string, string>> {
  if (assetIds.length === 0) return {};
  const { data } = await untyped(supabase).from('media_assets').select('id, object_path, bucket_id').in('id', assetIds);
  const rows = (data ?? []) as Array<{ id: string; object_path: string; bucket_id: string }>;
  const out: Record<string, string> = {};
  const byBucket = new Map<string, typeof rows>();
  for (const r of rows) byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r]);
  for (const [bucket, list] of byBucket) {
    const signed = await supabase.storage.from(bucket).createSignedUrls(list.map((r) => r.object_path), 3600);
    for (const s of signed.data ?? []) {
      const row = list.find((r) => r.object_path === s.path);
      if (row && s.signedUrl) out[row.id] = s.signedUrl;
    }
  }
  return out;
}
