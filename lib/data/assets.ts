import 'server-only';
import type { ServerSupabase } from '../supabase/server';

export const ASSET_KINDS = ['product', 'logo', 'background', 'reference', 'photo', 'video', 'audio', 'render', 'design', 'other'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface AssetItem {
  id: string;
  kind: AssetKind;
  media_type: 'image' | 'video' | 'audio' | 'other';
  file_name: string;
  label: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: string;
  url: string | null;
}

export interface BrandKit {
  brand_name: string;
  tagline: string;
  website: string;
  primary_color: string;
  secondary_color: string;
  logo_asset_id: string | null;
  default_cta: string;
  tone: string;
}

export const EMPTY_BRAND_KIT: BrandKit = {
  brand_name: '',
  tagline: '',
  website: '',
  primary_color: '#7157ef',
  secondary_color: '#211e2b',
  logo_asset_id: null,
  default_cta: '',
  tone: '',
};

type Untyped = (table: string) => ReturnType<ServerSupabase['from']>;

/**
 * Lists workspace-library assets with 1-hour signed URLs (private bucket).
 * Returns null when the library is not deployed (migration 20261017100000).
 */
export async function listAssets(supabase: ServerSupabase, organizationId: string, ids?: string[]): Promise<AssetItem[] | null> {
  let query = (supabase.from as unknown as Untyped)('media_assets')
    .select('id, kind, media_type, file_name, label, mime_type, size_bytes, width, height, duration_ms, created_at, object_path, bucket_id')
    .eq('organization_id', organizationId)
    .eq('bucket_id', 'workspace-assets')
    .order('created_at', { ascending: false })
    .limit(500);
  if (ids) query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const { data, error } = await query;
  if (error) return null;
  const rows = (data ?? []) as unknown as Array<Omit<AssetItem, 'url'> & { object_path: string }>;
  const paths = rows.map((r) => r.object_path);
  const signed = paths.length ? ((await supabase.storage.from('workspace-assets').createSignedUrls(paths, 3600)).data ?? []) : [];
  const byPath = new Map(signed.filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
  return rows.map(({ object_path, ...r }) => ({ ...r, url: byPath.get(object_path) ?? null }));
}

export async function getBrandKit(supabase: ServerSupabase, organizationId: string): Promise<BrandKit | null> {
  const { data, error } = await (supabase.from as unknown as Untyped)('brand_kits')
    .select('brand_name, tagline, website, primary_color, secondary_color, logo_asset_id, default_cta, tone')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) return null;
  return { ...EMPTY_BRAND_KIT, ...((data as Partial<BrandKit> | null) ?? {}) };
}
