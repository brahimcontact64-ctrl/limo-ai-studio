import 'server-only';
import type { ServerSupabase } from '../supabase/server';
import { untyped } from '../supabase/rpc';
import { normalizeHashtags } from '../images/posts';
import type { PostStatus } from '../social/types';

export interface PageRow {
  id: string;
  page_name: string;
  is_mock: boolean;
  status: 'active' | 'disconnected';
  connection_status: string;
  expires_at: string | null;
}

export async function listPages(supabase: ServerSupabase, organizationId: string): Promise<PageRow[]> {
  const { data } = await untyped(supabase)
    .from('facebook_pages')
    .select('id, page_name, is_mock, status, social_connections(status, expires_at)')
    .eq('organization_id', organizationId)
    .order('created_at');
  return ((data ?? []) as Array<Record<string, any>>).map((p) => ({
    id: p.id,
    page_name: p.page_name,
    is_mock: p.is_mock === true,
    status: p.status,
    connection_status: p.social_connections?.status ?? 'revoked',
    expires_at: p.social_connections?.expires_at ?? null,
  }));
}

export async function loadControls(supabase: ServerSupabase, organizationId: string): Promise<{ paused: boolean; reason: string | null }> {
  const { data } = await untyped(supabase).from('publishing_controls').select('paused, reason').eq('organization_id', organizationId).maybeSingle();
  return { paused: (data as { paused?: boolean } | null)?.paused === true, reason: (data as { reason?: string | null } | null)?.reason ?? null };
}

export interface FullPostRow {
  id: string;
  organization_id: string;
  title: string;
  caption: string;
  headline: string;
  cta: string;
  hashtags: string[];
  language_code: string;
  tone: string;
  media_kind: 'image' | 'video';
  image_project_id: string | null;
  media_asset_id: string | null;
  render_job_id: string | null;
  source_project_id: string | null;
  origin: 'manual' | 'ai' | 'automation';
  automation_policy_id: string | null;
  automation_policy_version: number | null;
  page_id: string | null;
  scheduled_at: string | null;
  timezone: string | null;
  published_at: string | null;
  external_post_id: string | null;
  simulated: boolean;
  last_error: string | null;
  review_note: string | null;
  revision_number: number;
  status: PostStatus;
  updated_at: string;
  created_at: string;
}

const POST_COLUMNS =
  'id, organization_id, title, caption, headline, cta, hashtags, language_code, tone, media_kind, image_project_id, media_asset_id, render_job_id, source_project_id, origin, automation_policy_id, automation_policy_version, page_id, scheduled_at, timezone, published_at, external_post_id, simulated, last_error, review_note, revision_number, status, updated_at, created_at';

const toPost = (p: Record<string, unknown>) => ({ ...(p as unknown as FullPostRow), hashtags: normalizeHashtags(p.hashtags) });

export async function listFullPosts(supabase: ServerSupabase, organizationId: string): Promise<FullPostRow[] | null> {
  const { data, error } = await untyped(supabase).from('social_posts').select(POST_COLUMNS).eq('organization_id', organizationId).order('updated_at', { ascending: false }).limit(300);
  if (error) return null;
  return (data ?? []).map(toPost);
}

export async function loadFullPost(supabase: ServerSupabase, id: string): Promise<FullPostRow | null> {
  const { data } = await untyped(supabase).from('social_posts').select(POST_COLUMNS).eq('id', id).maybeSingle();
  return data ? toPost(data as Record<string, unknown>) : null;
}

export interface VideoCandidate {
  id: string;
  title: string;
  aspect: string;
  width: number;
  height: number;
  duration_ms: number | null;
  media_asset_id: string;
  approved: boolean;
  completed_at: string;
}

/** Finished MP4 exports; "approved" = made from the script version that is still approved. */
export async function listVideoCandidates(supabase: ServerSupabase, organizationId: string): Promise<VideoCandidate[]> {
  const { data } = await untyped(supabase)
    .from('render_jobs')
    .select('id, aspect, width, height, output_duration_ms, output_media_asset_id, script_revision_id, completed_at, studio_projects(title, script_status, approved_revision_id)')
    .eq('organization_id', organizationId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(30);
  return ((data ?? []) as Array<Record<string, any>>).map((r) => ({
    id: r.id,
    title: r.studio_projects?.title ?? 'Video',
    aspect: r.aspect,
    width: r.width,
    height: r.height,
    duration_ms: r.output_duration_ms,
    media_asset_id: r.output_media_asset_id,
    approved: r.studio_projects?.script_status === 'approved' && r.studio_projects?.approved_revision_id === r.script_revision_id,
    completed_at: r.completed_at,
  }));
}

export interface PolicyRow {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'revoked';
  version: number;
  authorized_version: number | null;
  authorized_at: string | null;
  paused_reason: string | null;
  rules: Record<string, unknown>;
  updated_at: string;
}

export async function listPolicies(supabase: ServerSupabase, organizationId: string): Promise<PolicyRow[]> {
  const { data } = await untyped(supabase)
    .from('automation_policies')
    .select('id, name, status, version, authorized_version, authorized_at, paused_reason, rules, updated_at')
    .eq('organization_id', organizationId)
    .order('created_at');
  return (data ?? []) as PolicyRow[];
}

export async function featureFlag(supabase: ServerSupabase, key: string): Promise<boolean> {
  const { data } = await untyped(supabase).from('feature_flags').select('enabled').eq('key', key).maybeSingle();
  return (data as { enabled?: boolean } | null)?.enabled === true;
}
