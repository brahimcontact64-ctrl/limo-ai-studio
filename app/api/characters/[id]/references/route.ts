import { getSupabaseServer } from '@/lib/supabase/server';
import { json, readJson, requireUser } from '@/lib/api/guard';
import { allowRequest } from '@/lib/api/rateLimit';
import { callRpc, isMissingFunction, untyped } from '@/lib/supabase/rpc';
import { CHARACTER_ID_PATTERN, CUSTOM_CHARACTER_PATTERN } from '@/lib/studio/limits';
import { REFERENCE_VIEWS, EXPRESSION_KEYS } from '@/lib/characters/canon';
import { mimeAllowedFor, REFERENCE_MAX_BYTES, type AssetKind, type ReferenceAsset } from '@/lib/characters/references';

export const dynamic = 'force-dynamic';

const ASSET_COLUMNS =
  'id, asset_kind, view, expression_key, outfit_key, spec_version, status, mime_type, provenance, provenance_note, review_note, created_at, size_bytes, width, height, model_meta, object_path';
const SIGNED_SECONDS = 600;
const missingTable = (code?: string) => code === '42P01' || code === 'PGRST205' || code === '42703';

type Target = { kind: 'canonical'; id: string } | { kind: 'custom'; id: string };
function target(raw: string): Target | null {
  const id: string = decodeURIComponent(raw);
  if (CHARACTER_ID_PATTERN.test(id)) return { kind: 'canonical', id };
  return CUSTOM_CHARACTER_PATTERN.test(id) ? { kind: 'custom', id: id.slice('custom:'.length) } : null;
}

type SpecView = { version: number; status: string; spec: Record<string, unknown>; note: string | null; approved_at: string | null };

/**
 * Design spec + reference files for one character. RLS decides what is returned: members see approved
 * canonical files and their own workspace characters' files; platform admins with two-factor see all
 * canonical files. Files are served through short-lived signed URLs only.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const t = target((await params).id);
  if (!t) return json({ error: 'not_found' }, 404);
  const supabase = await getSupabaseServer();
  const db = untyped(supabase);

  let spec: SpecView | null = null;
  let canUpload = false;
  let canReview = false;
  let uploadPrefix: string | null = null;
  let custom: Record<string, unknown> | null = null;

  if (t.kind === 'canonical') {
    const specs = await db.from('character_design_specs').select('version, status, spec, note, approved_at').eq('character_id', t.id).neq('status', 'superseded').order('version', { ascending: false }).limit(1);
    if (specs.error) return json({ error: missingTable(specs.error.code) ? 'unavailable' : 'failed' }, missingTable(specs.error.code) ? 501 : 500);
    spec = (specs.data?.[0] as SpecView | undefined) ?? null;
    const admin = await callRpc<boolean>(supabase, 'is_platform_admin_mfa');
    canUpload = canReview = admin.data === true;
    if (spec && canUpload) uploadPrefix = `canonical/${t.id}/v${spec.version}/`;
  } else {
    const row = await db
      .from('characters')
      .select('id, organization_id, name, description, base_family, age_group, gender_code, spec, spec_version, reference_status, status')
      .eq('id', t.id)
      .maybeSingle();
    if (row.error) return json({ error: missingTable(row.error.code) ? 'unavailable' : 'failed' }, missingTable(row.error.code) ? 501 : 500);
    if (!row.data) return json({ error: 'not_found' }, 404);
    custom = row.data as Record<string, unknown>;
    const role = guard.ctx.memberships.find((m) => m.organization_id === custom!.organization_id)?.role;
    canUpload = role === 'owner' || role === 'admin' || role === 'editor';
    canReview = role === 'owner' || role === 'admin';
    spec = { version: custom.spec_version as number, status: 'approved', spec: custom.spec as Record<string, unknown>, note: null, approved_at: null };
    if (canUpload) uploadPrefix = `${custom.organization_id}/custom/${t.id}/v${custom.spec_version}/`;
  }

  const assetsOf = (cols: string) => db
    .from('character_reference_assets')
    .select(cols)
    .eq(t.kind === 'canonical' ? 'catalog_character_id' : 'custom_character_id', t.id)
    .in('status', ['pending_review', 'approved', 'rejected'])
    .order('created_at', { ascending: false })
    .limit(100);
  // variant_id exists from migration 20261019180000 on; older databases get the files without it.
  let assetsRes = await assetsOf(`${ASSET_COLUMNS}, variant_id`);
  if (assetsRes.error && missingTable(assetsRes.error.code)) assetsRes = await assetsOf(ASSET_COLUMNS);
  // Approved scene variants of this character (costume / expression on the unchanged canonical spec).
  const variantRes = await db.from('character_variants').select('id, variant_key, version, outfit, expression')
    .eq(t.kind === 'canonical' ? 'catalog_character_id' : 'custom_character_id', t.id).eq('status', 'approved').order('version', { ascending: false });
  const variants = ((variantRes.data ?? []) as Array<{ id: string; variant_key: string; version: number; outfit: { key?: string } | null; expression: { key?: string } | null }>)
    .map((v) => ({ id: v.id, key: v.variant_key, version: v.version, outfit_key: v.outfit?.key ?? null, expression_key: v.expression?.key ?? null }));
  if (assetsRes.error) return json({ error: 'failed' }, 500);
  const rows = (assetsRes.data ?? []) as unknown as Array<ReferenceAsset & { object_path: string }>;
  const signed = rows.length ? await supabase.storage.from('character-library').createSignedUrls(rows.map((r) => r.object_path), SIGNED_SECONDS) : { data: [] };
  const urls = new Map((signed.data ?? []).filter((s) => s.signedUrl && s.path).map((s) => [s.path as string, s.signedUrl]));
  const assets: ReferenceAsset[] = rows.map(({ object_path, ...a }) => ({ ...a, url: urls.get(object_path) ?? null }));

  return json({ kind: t.kind, spec, custom, assets, variants, can_upload: canUpload, can_review: canReview, upload_prefix: uploadPrefix });
}

/** Registers a file already uploaded under upload_prefix (the database re-checks path, permissions and type). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(request);
  if (!guard.ok) return guard.response;
  const t = target((await params).id);
  if (!t) return json({ error: 'not_found' }, 404);
  const read = await readJson(request, 8_000);
  if (!read.ok) return json({ error: read.error }, read.status);
  const b = (read.body ?? {}) as Record<string, unknown>;
  const kind = b.asset_kind as AssetKind;
  const mime = typeof b.mime_type === 'string' ? b.mime_type : '';
  const view = typeof b.view === 'string' && b.view ? b.view : null;
  const expression = typeof b.expression_key === 'string' && b.expression_key ? b.expression_key : null;
  const size = Number(b.size_bytes);
  // A scene variant's own expression (e.g. "angry") is accepted only together with that APPROVED variant; the
  // database checks that the variant is approved, belongs to this character and matches the keys.
  const variantId = typeof b.variant_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.variant_id) ? b.variant_id : null;
  if (b.variant_id != null && !variantId) return json({ error: 'invalid_request' }, 400);
  if (!['rendered_reference', 'rigged_model', 'turntable_video'].includes(kind) || !mimeAllowedFor(kind, mime)) return json({ error: 'type_not_allowed' }, 400);
  if (view && !(REFERENCE_VIEWS as readonly string[]).includes(view)) return json({ error: 'invalid_request' }, 400);
  if (expression && !variantId && !(EXPRESSION_KEYS as readonly string[]).includes(expression)) return json({ error: 'invalid_request' }, 400);
  if (expression && !/^[a-z_]{2,40}$/.test(expression)) return json({ error: 'invalid_request' }, 400);
  if (kind === 'rendered_reference' && !view && !expression && !b.outfit_key) return json({ error: 'view_required' }, 400);
  if (!Number.isFinite(size) || size <= 0 || size > REFERENCE_MAX_BYTES) return json({ error: 'too_large' }, 400);
  if (!['uploaded_artwork', 'commissioned', 'ai_generated', '3d_render'].includes(String(b.provenance))) return json({ error: 'provenance_required' }, 400);

  const supabase = await getSupabaseServer();
  if (!(await allowRequest(supabase, 'character_reference', 60, 3600))) return json({ error: 'rate_limited' }, 429);
  const { data, error } = await callRpc<string>(supabase, 'register_character_reference', {
    p_catalog_character_id: t.kind === 'canonical' ? t.id : null,
    p_custom_character_id: t.kind === 'custom' ? t.id : null,
    p_object_path: String(b.object_path ?? ''),
    p_asset_kind: kind,
    p_view: view,
    p_expression_key: expression,
    p_outfit_key: typeof b.outfit_key === 'string' && b.outfit_key ? b.outfit_key.slice(0, 40) : null,
    p_mime_type: mime,
    p_size_bytes: Math.round(size),
    p_width: Number.isInteger(b.width) ? b.width : null,
    p_height: Number.isInteger(b.height) ? b.height : null,
    p_provenance: b.provenance,
    p_provenance_note: typeof b.provenance_note === 'string' ? b.provenance_note.slice(0, 500) : null,
    p_model_meta: b.model_meta && typeof b.model_meta === 'object' ? b.model_meta : {},
    ...(variantId ? { p_variant_id: variantId } : {}),
  });
  if (isMissingFunction(error)) return json({ error: 'unavailable' }, 501);
  if (error || !data) {
    const m = error?.message ?? '';
    if (/not authorized|not found/i.test(m)) return json({ error: 'not_authorized' }, 403);
    if (/uploaded file not found|invalid reference path/i.test(m)) return json({ error: 'invalid_path' }, 400);
    if (/variant|not canonical/i.test(m)) return json({ error: 'variant_invalid' }, 422);
    return json({ error: 'invalid_request' }, 422);
  }
  return json({ asset_id: data }, 201);
}
